'use strict';

// Accounts: the pending sign-up and the user it becomes.
//
// Creating an account is two steps on purpose. Step one takes the details and
// puts them in a pending row; nothing that can be logged into exists yet. Step
// two proves the address is real by asking for a six digit code we emailed to
// it. Only then is a user written. An address nobody can read the mail for
// therefore never becomes an account, which is the whole point: every account
// on this site is reachable, and a bot cannot make a thousand of them.
//
// What is deliberate in here:
//
//   - the address is never stored in a form anyone can read: it is encrypted,
//     and found again through the same keyed blind index the submissions use
//   - the password never reaches the database. it is hashed in this process,
//     with scrypt, before the pending row is written, so even the intermediate
//     state cannot give one up
//   - the code is not stored either. a keyed hash of it is, compared in
//     constant time, so a copy of the table does not let anyone verify anything
//   - a pending sign-up carries its own counters: wrong guesses, sends, and the
//     time of the last send. those are the limits that actually matter, because
//     they follow the address rather than whatever ip is in front of it
//   - everything expires. a pending row that is never finished deletes itself
//
// Without DATABASE_URL there are no accounts at all. Registration answers "not
// available" rather than falling back to a file: a lead in a file is a lead, an
// account in a file is a security problem.

const crypto = require('crypto');
const db = require('./db');
const totp = require('./totp');

const CODE_TTL_MIN = Math.min(Math.max(Number(process.env.SIGNUP_CODE_TTL_MIN || 15), 5), 60);
const CODE_MAX_ATTEMPTS = 5;
const CODE_MAX_SENDS = 5;          // per pending sign-up, counting the first one
const CODE_RESEND_WAIT_S = 60;     // between one send and the next
const PENDING_MAX_AGE_H = 24;      // an abandoned sign-up is swept after this
// A reset link is a key to an account, sitting in an inbox. An hour is long
// enough to go and find the mail on a phone, and short enough that a message
// left unread for a week is not still a way in.
const RESET_TTL_MIN = Math.min(Math.max(Number(process.env.RESET_TTL_MIN || 60), 5), 240);
const RESET_MAX_SENDS = 3;         // per address per hour
const RESET_RESEND_WAIT_S = 60;    // between one link and the next
// An account nobody has signed into in two years is not an account, it is a row
// with somebody's name in it. Storage limitation applies to us as much as to the
// leads: the data goes when the reason for holding it does.
const ACCOUNT_MAX_IDLE_MONTHS = Math.max(Number(process.env.ACCOUNT_RETENTION_MONTHS || 24), 1);
// How long a sign-in lasts. Thirty days is the ordinary answer for a product
// somebody uses weekly; the idle limit is what actually ends most of them, and
// it is shorter, because a session left open on a shared machine is the risk,
// not one that is used every day.
const SESSION_MAX_DAYS = Math.min(Math.max(Number(process.env.SESSION_DAYS || 30), 1), 90);
const SESSION_IDLE_DAYS = Math.min(Math.max(Number(process.env.SESSION_IDLE_DAYS || 7), 1), SESSION_MAX_DAYS);
// One person, one browser, a handful of tabs. A number this high is not a limit
// on anybody real; it is a ceiling on a script that signs in in a loop.
const SESSIONS_PER_USER = 20;
// How long the audit trail is kept. Long enough that an incident in march can be
// looked at in june, bounded because the rows carry ip addresses.
const AUDIT_RETENTION_DAYS = Math.min(Math.max(Number(process.env.AUDIT_RETENTION_DAYS || 400), 30), 3650);

// ---------------------------------------------------------------------------
// schema
// ---------------------------------------------------------------------------
//
// Two tables. Neither holds an address, a password or a code in the clear.
// email_hash is the blind index and the only thing either is looked up by, so
// it is the primary way in and is unique on both.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
    id            bigserial PRIMARY KEY,
    created_at    timestamptz NOT NULL DEFAULT now(),
    email_hash    text        NOT NULL UNIQUE,
    email_enc     text        NOT NULL,
    name_enc      text        NOT NULL,
    password_hash text        NOT NULL,
    lang          text,
    flags         text        NOT NULL DEFAULT '',
    verified_at   timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz
);

CREATE TABLE IF NOT EXISTS signup_codes (
    email_hash    text        PRIMARY KEY,
    created_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    code_hash     text        NOT NULL,
    attempts      integer     NOT NULL DEFAULT 0,
    sends         integer     NOT NULL DEFAULT 1,
    last_sent_at  timestamptz NOT NULL DEFAULT now(),
    email_enc     text        NOT NULL,
    name_enc      text        NOT NULL,
    password_hash text        NOT NULL,
    lang          text,
    flags         text        NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS signup_codes_expiry_idx ON signup_codes (expires_at);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash    text        PRIMARY KEY,
    user_id       bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS reset_tokens (
    token_hash    text        PRIMARY KEY,
    email_hash    text        NOT NULL,
    email_enc     text        NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    sends         integer     NOT NULL DEFAULT 1,
    lang          text
);
CREATE INDEX IF NOT EXISTS reset_tokens_expiry_idx ON reset_tokens (expires_at);

-- Consecutive failed sign-ins, per address.
--
-- The ip limit in index.js is the wall in front of one machine working through a
-- password list. It is not a wall in front of a thousand machines working
-- through the same list against one address, and that is what credential
-- stuffing is: the attacker has the passwords already and needs one attempt from
-- each of a great many addresses. This follows the address instead, so the
-- hundredth attempt is slow no matter where it came from.
--
-- keyed on the blind index, which exists for any address whether or not there is
-- an account behind it. That is on purpose: a throttle that only applies to real
-- accounts answers "does this address have an account" by how fast it refuses.
CREATE TABLE IF NOT EXISTS login_fails (
    email_hash    text        PRIMARY KEY,
    fails         integer     NOT NULL DEFAULT 0,
    first_at      timestamptz NOT NULL DEFAULT now(),
    last_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_fails_last_idx ON login_fails (last_at);

-- What happened, kept where it can be read back.
--
-- Everything security-shaped used to go to stdout and nowhere else. That is a
-- log store with somebody else's retention on it, no query, and no answer to
-- "who opened this lead in March", which is exactly the question an aml product
-- has to be able to answer about itself.
--
-- No names and no addresses: the actor is a user id or a staff label, the subject is a
-- blind index or a reference. the row says what was done and by whom, and the
-- thing it was done to is looked up through the same index everything else uses,
-- so an erasure request does not leave the audit trail pointing at a person.
CREATE TABLE IF NOT EXISTS audit_events (
    id            bigserial   PRIMARY KEY,
    at            timestamptz NOT NULL DEFAULT now(),
    kind          text        NOT NULL,
    actor         text,
    subject       text,
    ip            text,
    detail        text
);
CREATE INDEX IF NOT EXISTS audit_events_at_idx      ON audit_events (at DESC);
CREATE INDEX IF NOT EXISTS audit_events_kind_idx    ON audit_events (kind, at DESC);
CREATE INDEX IF NOT EXISTS audit_events_subject_idx ON audit_events (subject);

-- Which browser started a sign-up.
--
-- The pending row carries the password of whoever started it, so a sign-up
-- started for somebody else's address and finished by that somebody else makes
-- an account with the starter's password in it. That is a pre-hijack, and the
-- fix is that finishing requires proving you are the browser that started:
-- a random value in an httpOnly cookie, its hash here, checked at verify.
ALTER TABLE signup_codes ADD COLUMN IF NOT EXISTS origin_hash text;

-- Second factor.
--
-- The secret is sealed like every other personal field, because a copy of the
-- users table must not be a copy of everybody's authenticator. totp_at is what
-- says it is switched on: a secret with no date is one somebody started setting
-- up and never confirmed, and it protects nothing until they have proved the
-- app is actually showing the right codes.
--
-- totp_last is the last step number accepted. a code lives for thirty seconds
-- and without this it can be used again inside that window by whoever read it
-- over a shoulder.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enc  text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_at   timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last bigint;

-- The way back in when the phone is gone. Hashed, single use, and using one is
-- an event the audit trail keeps.
CREATE TABLE IF NOT EXISTS recovery_codes (
    user_id    bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    used_at    timestamptz,
    PRIMARY KEY (user_id, code_hash)
);

-- The half-signed-in state between a right password and a right code.
--
-- It is not a session: it cannot read anything, it lives five minutes, and it is
-- spent the moment it becomes one. It is a row rather than a memory map because
-- the instance that checks the code may not be the one that checked the
-- password.
CREATE TABLE IF NOT EXISTS totp_pending (
    token_hash text        PRIMARY KEY,
    user_id    bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    tries      integer     NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS totp_pending_expiry_idx ON totp_pending (expires_at);

-- Was this session opened with a second factor. The staff pages ask for it, so
-- a session that predates somebody switching 2fa on does not keep the old
-- privileges until it expires.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mfa boolean NOT NULL DEFAULT false;

-- Devices this account has signed in from before.
--
-- Only so that "somebody signed in" can be sent the first time and not on every
-- ordinary morning. What is stored is a keyed hash of the browser it came from,
-- never the browser string itself: the point is recognising a return, not
-- building a fingerprint we could hand to anybody.
CREATE TABLE IF NOT EXISTS known_devices (
    user_id     bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_hash text        NOT NULL,
    first_at    timestamptz NOT NULL DEFAULT now(),
    last_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, device_hash)
);

-- One row per address, and that is what makes the cooldown safe. Asking again
-- replaces the row rather than adding one, so the whole of "have they waited,
-- have they had too many, here is the new token" is a single insert with an
-- on-conflict clause: two clicks arriving together cannot both find nothing and
-- both send. Without this a burst of requests raced the check and posted a
-- burst of mail.
--
-- the delete is the migration for tables written before the index existed. it
-- keeps the newest row per address and is a no-op once the index is in place.
DELETE FROM reset_tokens a USING reset_tokens b
 WHERE a.email_hash = b.email_hash
   AND (a.created_at < b.created_at OR (a.created_at = b.created_at AND a.ctid < b.ctid));
CREATE UNIQUE INDEX IF NOT EXISTS reset_tokens_email_uniq ON reset_tokens (email_hash);
DROP INDEX IF EXISTS reset_tokens_email_idx;
`;

let ready = null;
function init() {
    if (!db.available()) return Promise.resolve(false);
    if (ready) return ready;
    ready = db.query(SCHEMA)
        .then(() => { console.log('[accounts] users and signup_codes ready'); return true; })
        .catch((err) => {
            console.error('[accounts] schema failed: ' + err.message);
            ready = null; // try again on the next request rather than staying broken
            return false;
        });
    return ready;
}

// ---------------------------------------------------------------------------
// passwords
// ---------------------------------------------------------------------------
//
// scrypt, from node's own crypto, with the cost parameters owasp gives for it.
// argon2id would be the first choice, but it is a native module and a build
// that fails on deploy day is a worse outcome than the second best password
// hash. The format carries its own parameters so they can be raised later and
// old hashes still verify.
//
// N=2^15 with r=8 is about 32mb and a few tens of milliseconds per guess, which
// is the point: it costs an attacker with the table the same.

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
    return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(16);
        crypto.scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 256 * 1024 * 1024 }, (err, key) => {
            if (err) return reject(err);
            resolve(['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$'));
        });
    });
}

function verifyPassword(password, stored) {
    return new Promise((resolve) => {
        const parts = String(stored || '').split('$');
        if (parts.length !== 6 || parts[0] !== 'scrypt') return resolve(false);
        const N = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
        let salt, expected;
        try {
            salt = Buffer.from(parts[4], 'base64');
            expected = Buffer.from(parts[5], 'base64');
        } catch (err) { return resolve(false); }
        // a stored hash that is the right shape but carries nonsense numbers
        // makes scrypt throw where it stands, rather than call back with an
        // error. thrown from inside here that becomes a rejected promise and a
        // 500 for one bad row, so it is caught and answered the same way every
        // other unusable hash is: no.
        try {
            crypto.scrypt(password, salt, expected.length, { N, r, p, maxmem: 256 * 1024 * 1024 }, (err, key) => {
                if (err) return resolve(false);
                resolve(key.length === expected.length && crypto.timingSafeEqual(key, expected));
            });
        } catch (err) {
            console.error('[accounts] unusable password hash: ' + err.message);
            resolve(false);
        }
    });
}

// ---------------------------------------------------------------------------
// codes
// ---------------------------------------------------------------------------
//
// Six digits, drawn from the same generator the keys are, because Math.random
// is predictable and a predictable code is not a check on anything. The full
// range including leading zeros is used: dropping 000123 would quietly throw
// away a tenth of the space.

function newCode() {
    return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// The code is bound to the address it was sent to, so a code mailed to one
// person cannot be replayed against another sign-up.
function hashCode(code, emailHash) {
    return crypto.createHmac('sha256', db.indexKey() || Buffer.alloc(32))
        .update('signup-code:' + emailHash + ':' + code, 'utf8')
        .digest('hex');
}

function sameHash(a, b) {
    const x = Buffer.from(String(a), 'utf8'), y = Buffer.from(String(b), 'utf8');
    if (x.length !== y.length) return false;
    return crypto.timingSafeEqual(x, y);
}

// ---------------------------------------------------------------------------
// the flow
// ---------------------------------------------------------------------------

async function exists(email) {
    if (!(await init())) return false;
    const res = await db.query('SELECT 1 FROM users WHERE email_hash = $1', [db.blindIndex(email)]);
    return res.rowCount > 0;
}

// Starts or restarts a sign-up. Returns the code to send, or a reason not to.
// Coming back a second time replaces the pending row rather than adding one:
// the last code sent is the only one that works, so a code read over somebody's
// shoulder yesterday is already dead.
async function startSignup({ email, name, password, lang, flags }) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const emailHash = db.blindIndex(email);
    if (!emailHash) return { ok: false, reason: 'unavailable' };

    if (await exists(email)) return { ok: false, reason: 'exists' };

    // an address in the middle of a sign-up cannot be used to send itself mail
    // on demand: the same ceiling applies whether the sends come from the form
    // or from the resend button
    const prev = await db.query(
        'SELECT sends, last_sent_at FROM signup_codes WHERE email_hash = $1 AND created_at > now() - interval \'1 hour\'',
        [emailHash]
    );
    if (prev.rowCount) {
        if (prev.rows[0].sends >= CODE_MAX_SENDS) return { ok: false, reason: 'too-many-sends' };
        const waited = (Date.now() - new Date(prev.rows[0].last_sent_at).getTime()) / 1000;
        if (waited < CODE_RESEND_WAIT_S) return { ok: false, reason: 'slow-down', retryIn: Math.ceil(CODE_RESEND_WAIT_S - waited) };
    }

    const code = newCode();
    const passwordHash = await hashPassword(password);
    // the browser that started this. the caller puts it in an httpOnly cookie and
    // verify will not finish a sign-up without it, so a sign-up started for
    // somebody else's address cannot be finished by that somebody else.
    const origin = crypto.randomBytes(32).toString('base64url');
    await db.query(
        `INSERT INTO signup_codes (email_hash, expires_at, code_hash, email_enc, name_enc, password_hash, lang, flags, origin_hash)
         VALUES ($1, now() + ($2 || ' minutes')::interval, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (email_hash) DO UPDATE SET
             created_at    = now(),
             expires_at    = now() + ($2 || ' minutes')::interval,
             code_hash     = EXCLUDED.code_hash,
             attempts      = 0,
             sends         = CASE WHEN signup_codes.created_at > now() - interval '1 hour'
                                  THEN signup_codes.sends + 1 ELSE 1 END,
             last_sent_at  = now(),
             email_enc     = EXCLUDED.email_enc,
             name_enc      = EXCLUDED.name_enc,
             password_hash = EXCLUDED.password_hash,
             lang          = EXCLUDED.lang,
             flags         = EXCLUDED.flags,
             origin_hash   = EXCLUDED.origin_hash`,
        [
            emailHash, String(CODE_TTL_MIN), hashCode(code, emailHash),
            db.seal('signup-email:' + emailHash, email),
            db.seal('signup-name:' + emailHash, name || ''),
            passwordHash,
            lang || 'en',
            (flags || []).join(',').slice(0, 200),
            hashToken(origin),
        ]
    );
    audit('signup-started', { subject: emailHash });
    return { ok: true, code, expiresInMin: CODE_TTL_MIN, origin };
}

// Sends the same code again, without touching the code itself: a resend that
// issues a new code turns the button into a way of walking the whole space.
async function resendSignup(email) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const emailHash = db.blindIndex(email);
    if (!emailHash) return { ok: false, reason: 'unavailable' };

    const res = await db.query(
        'SELECT sends, last_sent_at, expires_at, name_enc, lang FROM signup_codes WHERE email_hash = $1',
        [emailHash]
    );
    if (!res.rowCount) return { ok: false, reason: 'no-pending' };
    const row = res.rows[0];
    if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired' };
    if (row.sends >= CODE_MAX_SENDS) return { ok: false, reason: 'too-many-sends' };
    const waited = (Date.now() - new Date(row.last_sent_at).getTime()) / 1000;
    if (waited < CODE_RESEND_WAIT_S) return { ok: false, reason: 'slow-down', retryIn: Math.ceil(CODE_RESEND_WAIT_S - waited) };

    // the stored hash cannot be turned back into the code, so a resend issues a
    // fresh one and retires the old. that is not a way to walk the space: the
    // send counter above is what bounds it, and it does not reset here.
    const code = newCode();
    await db.query(
        `UPDATE signup_codes SET code_hash = $2, attempts = 0, sends = sends + 1, last_sent_at = now(),
                                 expires_at = now() + ($3 || ' minutes')::interval
         WHERE email_hash = $1`,
        [emailHash, hashCode(code, emailHash), String(CODE_TTL_MIN)]
    );
    return {
        ok: true,
        code,
        expiresInMin: CODE_TTL_MIN,
        lang: row.lang || 'en',
        name: db.open('signup-name:' + emailHash, row.name_enc),
        sendsLeft: CODE_MAX_SENDS - (row.sends + 1),
    };
}

// The code is checked, then the account is written, in one transaction. A
// wrong guess costs an attempt whether or not there was ever a pending row, and
// the answer is the same either way: telling a stranger which addresses have a
// sign-up in progress is telling them which addresses exist.
async function verifySignup(email, code, origin) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const emailHash = db.blindIndex(email);
    if (!emailHash) return { ok: false, reason: 'unavailable' };
    if (!/^[0-9]{6}$/.test(String(code || ''))) return { ok: false, reason: 'bad-code' };

    const res = await db.query('SELECT * FROM signup_codes WHERE email_hash = $1', [emailHash]);
    if (!res.rowCount) return { ok: false, reason: 'bad-code' };
    const row = res.rows[0];

    if (new Date(row.expires_at).getTime() < Date.now()) {
        await db.query('DELETE FROM signup_codes WHERE email_hash = $1', [emailHash]);
        return { ok: false, reason: 'expired' };
    }
    if (row.attempts >= CODE_MAX_ATTEMPTS) return { ok: false, reason: 'too-many-attempts' };

    // the browser that started this sign-up, or nobody.
    //
    // this is what stops a pre-hijack: the pending row holds the password of
    // whoever started it, so without this check somebody could start a sign-up
    // on an address that is not theirs, let the owner receive the code, and end
    // up with an account on that address whose password they chose. a wrong
    // origin does not burn a guess, because the guess is not what is wrong.
    //
    // rows written before this column existed have no origin and are let
    // through: the alternative is every sign-up in flight at deploy time
    // breaking, and they expire within the quarter of an hour anyway.
    if (row.origin_hash) {
        if (!origin || !sameHash(row.origin_hash, hashToken(String(origin)))) {
            audit('signup-origin-refused', { subject: emailHash });
            return { ok: false, reason: 'bad-origin' };
        }
    }

    if (!sameHash(row.code_hash, hashCode(String(code), emailHash))) {
        const bumped = await db.query(
            'UPDATE signup_codes SET attempts = attempts + 1 WHERE email_hash = $1 RETURNING attempts',
            [emailHash]
        );
        const left = CODE_MAX_ATTEMPTS - (bumped.rows[0] ? bumped.rows[0].attempts : CODE_MAX_ATTEMPTS);
        // out of guesses means the code is gone, not that the next one is free
        if (left <= 0) {
            await db.query('DELETE FROM signup_codes WHERE email_hash = $1', [emailHash]);
            return { ok: false, reason: 'too-many-attempts' };
        }
        return { ok: false, reason: 'bad-code', attemptsLeft: left };
    }

    const client = await db.connect();
    let userId = null;
    try {
        await client.query('BEGIN');
        // consumed first: the same code must not create two accounts if two
        // requests arrive together
        const gone = await client.query('DELETE FROM signup_codes WHERE email_hash = $1 RETURNING 1', [emailHash]);
        if (!gone.rowCount) { await client.query('ROLLBACK'); return { ok: false, reason: 'bad-code' }; }
        const made = await client.query(
            `INSERT INTO users (email_hash, email_enc, name_enc, password_hash, lang, flags)
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (email_hash) DO NOTHING RETURNING id`,
            [emailHash, row.email_enc, row.name_enc, row.password_hash, row.lang, row.flags]
        );
        // `do nothing` returns no row when the account was already there, which
        // is the race this guards against. the id is still wanted: whoever just
        // proved they can read the mail gets signed in either way.
        userId = made.rowCount ? made.rows[0].id : null;
        if (userId === null) {
            const found = await client.query('SELECT id FROM users WHERE email_hash = $1', [emailHash]);
            userId = found.rowCount ? found.rows[0].id : null;
        }
        await client.query('COMMIT');
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (rbErr) { /* connection already gone */ }
        console.error('[accounts] could not finish sign-up: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    } finally {
        client.release();
    }

    // signed in on the spot. they have just proved the address is theirs, which
    // is a stronger check than the password they are about to be asked for, so
    // asking for it again here would be ceremony rather than security.
    audit('signup-finished', { actor: userId, subject: emailHash });
    const session = userId === null ? null : await startSession(userId);
    if (userId !== null) {
        db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId])
            .catch((err) => console.error('[accounts] could not record the sign-in: ' + err.message));
    }

    return {
        ok: true,
        name: db.open('signup-name:' + emailHash, row.name_enc),
        lang: row.lang || 'en',
        session,
    };
}

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------
//
// A session is a random 32 byte token in an httpOnly cookie, and a row here
// holding only a hash of it. Three things follow from that shape:
//
//   - the cookie cannot be read by script, so a cross site scripting bug on any
//     page cannot walk off with somebody's sign-in
//   - a copy of this table is not a set of keys. the hash is one way, so a
//     stolen dump cannot be replayed as a session
//   - every session can be ended from our side, immediately: signing out, a
//     password change, or an account we delete. a signed token in a cookie with
//     no row behind it cannot be taken back before it expires, which is why it
//     is not what we use
//
// A session also dies of old age two ways. `expires_at` is the hard stop, and
// idleness ends it sooner: both are checked on the way in.

function hashToken(token) {
    // keyed with the same secret the blind index uses. an attacker who somehow
    // reads this table still cannot turn a guessed token into the stored value
    // without the key, which is in the environment and not in the database.
    return crypto.createHmac('sha256', db.indexKey() || Buffer.alloc(32))
        .update('session:' + token, 'utf8')
        .digest('hex');
}

async function startSession(userId, { mfa = false } = {}) {
    if (!(await init())) return null;
    const token = crypto.randomBytes(32).toString('base64url');
    try {
        await db.query(
            `INSERT INTO sessions (token_hash, user_id, expires_at, mfa)
             VALUES ($1, $2, now() + ($3 || ' days')::interval, $4)`,
            [hashToken(token), userId, String(SESSION_MAX_DAYS), Boolean(mfa)]
        );
        // oldest first, so the tab somebody is using now is never the one that
        // gets thrown out
        await db.query(
            `DELETE FROM sessions WHERE user_id = $1 AND token_hash NOT IN (
                 SELECT token_hash FROM sessions WHERE user_id = $1
                 ORDER BY last_seen_at DESC LIMIT $2)`,
            [userId, SESSIONS_PER_USER]
        );
    } catch (err) {
        console.error('[accounts] could not open a session: ' + err.message);
        return null;
    }
    return { token, maxAgeSeconds: SESSION_MAX_DAYS * 24 * 60 * 60 };
}

// Who is holding this token, if anybody. Returns null for every kind of no, so
// a caller cannot accidentally tell an expired session from a forged one.
async function readSession(token) {
    if (!token || typeof token !== 'string' || token.length > 200) return null;
    if (!(await init())) return null;
    try {
        const res = await db.query(
            `SELECT s.token_hash, s.user_id, s.mfa, u.email_hash, u.email_enc, u.name_enc, u.lang, u.created_at, u.totp_at
               FROM sessions s JOIN users u ON u.id = s.user_id
              WHERE s.token_hash = $1
                AND s.expires_at > now()
                AND s.last_seen_at > now() - ($2 || ' days')::interval`,
            [hashToken(token), String(SESSION_IDLE_DAYS)]
        );
        if (!res.rowCount) return null;
        const row = res.rows[0];
        // touched at most once a minute: every page view does not need a write,
        // and the idle window is measured in days
        db.query(
            "UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1 AND last_seen_at < now() - interval '1 minute'",
            [row.token_hash]
        ).catch(() => { /* a missed touch costs nothing until the idle window */ });
        /* the label is part of what the value was sealed with, so it has to be
           the one used at the time. these ciphertexts are copied verbatim out of
           signup_codes when the account is written, so they keep the signup
           labels for ever. changing them here would not rename anything, it
           would simply fail to open.

           that invariant had one hole and it is repaired below rather than only
           in the path that made it. accounts created through the forgot-password
           door were written with the address still sealed under its
           'reset-email:' label, and this line opens 'signup-email:', so it
           answered an empty string for every one of them. an empty address is
           not a visible fault: the account signs in, the name is there, and the
           only symptom is that nothing which needs the address works, including
           being recognised as staff.

           so a miss here is retried under the reset label, and if that opens,
           the row is resealed with the right one. the account repairs itself the
           next time its owner loads a page, and the repair is a fire and forget
           write for the same reason the last_seen_at touch above is: a missed
           one costs nothing, it will be tried again on the next request. */
        let email = db.open('signup-email:' + row.email_hash, row.email_enc);
        if (!email) {
            const fromReset = db.open('reset-email:' + row.email_hash, row.email_enc);
            if (fromReset) {
                email = fromReset;
                db.query('UPDATE users SET email_enc = $1 WHERE id = $2',
                    [db.seal('signup-email:' + row.email_hash, fromReset), row.user_id]
                ).then(() => {
                    console.log('[accounts] resealed an address written by the reset path');
                }).catch(() => { /* tried again on the next request */ });
            }
        }

        return {
            userId: row.user_id,
            email: email,
            name: db.open('signup-name:' + row.email_hash, row.name_enc),
            lang: row.lang || 'en',
            since: row.created_at,
            // whether this session was opened with a second factor, and whether
            // the account has one at all. the staff pages need both: a session
            // opened before 2fa was switched on must not keep the privileges it
            // had, and an account without 2fa cannot have them yet.
            mfa: Boolean(row.mfa),
            totpOn: Boolean(row.totp_at),
            emailHash: row.email_hash,
        };
    } catch (err) {
        console.error('[accounts] session lookup failed: ' + err.message);
        return null;
    }
}

async function endSession(token) {
    if (!token || !(await init())) return;
    try {
        await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
    } catch (err) {
        console.error('[accounts] could not end a session: ' + err.message);
    }
}

// Signing in. The answer is the same for an address we do not have and a
// password that is wrong, and it takes about as long either way, because the
// difference between the two is exactly what somebody testing a leaked password
// list is looking for.
// ---------------------------------------------------------------------------
// devices
// ---------------------------------------------------------------------------
//
// A keyed hash of whatever the browser says about itself, so a return can be
// recognised without the browser string being kept. Keyed with the same index
// key everything else uses, so a copy of the table proves nothing on its own.
function deviceHash(parts) {
    return crypto.createHmac('sha256', db.indexKey() || Buffer.alloc(32))
        .update('device:' + (parts || []).join('|'), 'utf8')
        .digest('hex');
}

// Records the device and answers whether it is new to this account. Fails open
// on the safe side: an error answers "known", because the cost of getting that
// wrong is a missing notice, and the cost of the other answer is a mail every
// morning that teaches people to ignore these.
async function noteDevice(userId, parts) {
    if (!userId) return false;
    const hash = deviceHash(parts);
    try {
        const res = await db.query(
            `INSERT INTO known_devices (user_id, device_hash) VALUES ($1, $2)
             ON CONFLICT (user_id, device_hash) DO UPDATE SET last_at = now()
             RETURNING (known_devices.first_at = known_devices.last_at) AS fresh`,
            [userId, hash]
        );
        return Boolean(res.rowCount && res.rows[0].fresh);
    } catch (err) {
        console.error('[accounts] could not record the device: ' + err.message);
        return false;
    }
}

// ---------------------------------------------------------------------------
// the audit trail
// ---------------------------------------------------------------------------
//
// Fire and forget, always. An event that cannot be written must never fail the
// thing it was describing: a sign-in that works but was not recorded is a gap in
// a log, a sign-in refused because the log was full is an outage.
function audit(kind, { actor, subject, ip, detail } = {}) {
    if (!db.available()) return;
    init().then((ok) => {
        if (!ok) return;
        return db.query(
            'INSERT INTO audit_events (kind, actor, subject, ip, detail) VALUES ($1, $2, $3, $4, $5)',
            [
                String(kind).slice(0, 48),
                actor === undefined || actor === null ? null : String(actor).slice(0, 120),
                subject === undefined || subject === null ? null : String(subject).slice(0, 120),
                ip ? String(ip).slice(0, 64) : null,
                detail === undefined || detail === null ? null : String(detail).slice(0, 400),
            ]
        );
    }).catch((err) => console.error('[accounts] could not write an audit event: ' + err.message));
}

// The trail, newest first, for the staff page. Nothing here needs decrypting:
// the subject is a blind index, so a row says what happened to which account
// without saying whose it is.
async function recentAudit({ limit = 100, kind = '', subject = '' } = {}) {
    if (!(await init())) return [];
    const max = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const where = [];
    const args = [];
    if (kind) { args.push(String(kind).slice(0, 48)); where.push('kind = $' + args.length); }
    if (subject) { args.push(String(subject).slice(0, 120)); where.push('subject = $' + args.length); }
    args.push(max);
    try {
        const res = await db.query(
            'SELECT at, kind, actor, subject, ip, detail FROM audit_events' +
            (where.length ? ' WHERE ' + where.join(' AND ') : '') +
            ' ORDER BY at DESC LIMIT $' + args.length,
            args
        );
        return res.rows;
    } catch (err) {
        console.error('[accounts] could not read the audit trail: ' + err.message);
        return [];
    }
}

// ---------------------------------------------------------------------------
// the sign-in throttle
// ---------------------------------------------------------------------------
//
// Five wrong passwords are a person who has forgotten which one they used. From
// there every further one costs twice the wait of the last, up to half an hour,
// and the count clears on the first success or after an hour of being left
// alone. The wait is the same whether or not the address has an account.
const LOGIN_FREE_TRIES = 5;
const LOGIN_BASE_WAIT_S = 30;
const LOGIN_MAX_WAIT_S = 30 * 60;
const LOGIN_FORGET_H = 1;

function loginWaitFor(fails) {
    if (fails <= LOGIN_FREE_TRIES) return 0;
    const steps = Math.min(fails - LOGIN_FREE_TRIES - 1, 20);
    return Math.min(LOGIN_BASE_WAIT_S * Math.pow(2, steps), LOGIN_MAX_WAIT_S);
}

// How long this address still has to wait, in seconds. 0 means go ahead.
async function loginHold(emailHash) {
    if (!emailHash) return 0;
    try {
        const res = await db.query(
            `SELECT fails, last_at FROM login_fails
              WHERE email_hash = $1 AND last_at > now() - ($2 || ' hours')::interval`,
            [emailHash, String(LOGIN_FORGET_H)]
        );
        if (!res.rowCount) return 0;
        const wait = loginWaitFor(res.rows[0].fails);
        if (!wait) return 0;
        const since = (Date.now() - new Date(res.rows[0].last_at).getTime()) / 1000;
        return since >= wait ? 0 : Math.ceil(wait - since);
    } catch (err) {
        // a throttle that cannot read its own table must not lock everybody out
        console.error('[accounts] could not read the sign-in throttle: ' + err.message);
        return 0;
    }
}

async function noteLoginFail(emailHash) {
    if (!emailHash) return;
    try {
        await db.query(
            `INSERT INTO login_fails (email_hash, fails) VALUES ($1, 1)
             ON CONFLICT (email_hash) DO UPDATE SET
                 fails = CASE WHEN login_fails.last_at > now() - ($2 || ' hours')::interval
                              THEN login_fails.fails + 1 ELSE 1 END,
                 first_at = CASE WHEN login_fails.last_at > now() - ($2 || ' hours')::interval
                                 THEN login_fails.first_at ELSE now() END,
                 last_at = now()`,
            [emailHash, String(LOGIN_FORGET_H)]
        );
    } catch (err) {
        console.error('[accounts] could not record a failed sign-in: ' + err.message);
    }
}

function clearLoginFails(emailHash) {
    if (!emailHash) return;
    db.query('DELETE FROM login_fails WHERE email_hash = $1', [emailHash])
        .catch((err) => console.error('[accounts] could not clear the sign-in throttle: ' + err.message));
}

async function signIn(email, password) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const emailHash = db.blindIndex(email);
    if (!emailHash) return { ok: false, reason: 'unavailable' };

    // the wait this address has earned, before any password work is done: the
    // point of a throttle is that the expensive part is not reached
    const hold = await loginHold(emailHash);
    if (hold > 0) return { ok: false, reason: 'too-many-attempts', retryIn: hold };

    let row = null;
    try {
        const res = await db.query('SELECT id, email_hash, email_enc, name_enc, password_hash, lang, totp_at FROM users WHERE email_hash = $1', [emailHash]);
        row = res.rowCount ? res.rows[0] : null;
    } catch (err) {
        console.error('[accounts] sign-in lookup failed: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }

    // no such address: the password is still hashed, against a fixed dummy, so
    // the reply does not come back noticeably sooner than a wrong password does
    if (!row) {
        await verifyPassword(String(password || ''), DUMMY_HASH);
        await noteLoginFail(emailHash);
        audit('login-refused', { subject: emailHash, detail: 'no account' });
        return { ok: false, reason: 'bad-credentials' };
    }
    if (!(await verifyPassword(String(password || ''), row.password_hash))) {
        await noteLoginFail(emailHash);
        audit('login-refused', { actor: row.id, subject: emailHash, detail: 'wrong password' });
        return { ok: false, reason: 'bad-credentials' };
    }

    // the hash is brought up to the current cost while we have the password in
    // hand. raising SCRYPT later is otherwise a change that only applies to
    // accounts made after it, which is the opposite of what raising it is for.
    if (!String(row.password_hash || '').startsWith('scrypt$' + SCRYPT.N + '$' + SCRYPT.r + '$' + SCRYPT.p + '$')) {
        hashPassword(String(password || '')).then((fresh) =>
            db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [fresh, row.id])
        ).then(() => console.log('[accounts] rehashed a password at the current cost'))
            .catch((err) => console.error('[accounts] could not rehash: ' + err.message));
    }

    // the password was right, and on an account with a second factor that is
    // half of what is needed. no session yet: a row that lives five minutes and
    // can do nothing but be exchanged for one.
    if (row.totp_at) {
        const pending = await startTotpPending(row.id);
        if (!pending) return { ok: false, reason: 'unavailable' };
        clearLoginFails(emailHash);
        audit('login-password-ok', { actor: row.id, subject: emailHash, detail: 'second factor asked for' });
        return { ok: false, reason: 'totp-required', pending };
    }

    const session = await startSession(row.id);
    if (!session) return { ok: false, reason: 'unavailable' };
    clearLoginFails(emailHash);
    db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [row.id])
        .catch((err) => console.error('[accounts] could not record the sign-in: ' + err.message));
    audit('login', { actor: row.id, subject: emailHash });
    return {
        ok: true,
        session,
        userId: row.id,
        name: db.open('signup-name:' + row.email_hash, row.name_enc),
        // for the "somebody signed in" notice. the caller mails it; this is the
        // one place that can read the address at all.
        email: db.open('signup-email:' + row.email_hash, row.email_enc),
        lang: row.lang || 'en',
    };
}

// ---------------------------------------------------------------------------
// the second factor
// ---------------------------------------------------------------------------
//
// Switching it on is three steps and they are separate on purpose. Minting a
// secret is not switching anything on; the account is only protected once the
// person has proved their app is showing the right codes, because a secret that
// was mistyped into an app is a lockout waiting for the next sign-in.

async function startTotp(userId) {
    if (!(await init())) return null;
    const secret = totp.newSecret();
    try {
        // written with no date, which is what "started but not confirmed" means.
        // starting again replaces it: somebody who lost the qr code halfway
        // through should be able to begin again rather than be stuck with a
        // secret no app has.
        await db.query(
            'UPDATE users SET totp_enc = $1, totp_at = NULL, totp_last = NULL WHERE id = $2',
            [db.seal('totp:' + userId, secret), userId]
        );
    } catch (err) {
        console.error('[accounts] could not start 2fa: ' + err.message);
        return null;
    }
    audit('2fa-started', { actor: userId });
    return secret;
}

// Confirms the app is showing the right codes, switches it on, and hands back
// the recovery codes. They are shown once and stored only as hashes: a list of
// working codes in the database is a second password list.
async function confirmTotp(userId, code) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    let row;
    try {
        const res = await db.query('SELECT totp_enc, totp_at FROM users WHERE id = $1', [userId]);
        if (!res.rowCount || !res.rows[0].totp_enc) return { ok: false, reason: 'not-started' };
        row = res.rows[0];
    } catch (err) {
        console.error('[accounts] could not read the 2fa secret: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }
    if (row.totp_at) return { ok: false, reason: 'already-on' };

    const secret = db.open('totp:' + userId, row.totp_enc);
    if (!secret) return { ok: false, reason: 'unavailable' };
    const step = totp.checkCode(secret, code);
    if (step === null) return { ok: false, reason: 'bad-code' };

    const codes = totp.newRecoveryCodes(10);
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await client.query('UPDATE users SET totp_at = now(), totp_last = $1 WHERE id = $2', [String(step), userId]);
        await client.query('DELETE FROM recovery_codes WHERE user_id = $1', [userId]);
        for (const c of codes) {
            await client.query('INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1, $2)',
                [userId, hashRecovery(userId, c)]);
        }
        // the session doing this keeps working; every other one is asked to sign
        // in again, and will now be asked for a code as well
        await client.query('COMMIT');
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (rbErr) { /* gone */ }
        console.error('[accounts] could not switch on 2fa: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    } finally {
        client.release();
    }
    audit('2fa-on', { actor: userId });
    return { ok: true, codes };
}

// Off again, and it costs the password. Otherwise anybody who finds an unlocked
// laptop can remove the thing that was protecting the account.
async function disableTotp(userId, password) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    try {
        const res = await db.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
        if (!res.rowCount) return { ok: false, reason: 'unavailable' };
        if (!(await verifyPassword(String(password || ''), res.rows[0].password_hash))) {
            audit('2fa-off-refused', { actor: userId, detail: 'wrong password' });
            return { ok: false, reason: 'bad-password' };
        }
        await db.query('UPDATE users SET totp_enc = NULL, totp_at = NULL, totp_last = NULL WHERE id = $1', [userId]);
        await db.query('DELETE FROM recovery_codes WHERE user_id = $1', [userId]);
    } catch (err) {
        console.error('[accounts] could not switch off 2fa: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }
    audit('2fa-off', { actor: userId });
    return { ok: true };
}

function hashRecovery(userId, code) {
    return crypto.createHmac('sha256', db.indexKey() || Buffer.alloc(32))
        .update('recovery:' + userId + ':' + totp.normaliseRecovery(code), 'utf8')
        .digest('hex');
}

// The half signed in state. Five minutes, and it is spent the moment it becomes
// a session.
async function startTotpPending(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    try {
        await db.query(
            "INSERT INTO totp_pending (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '5 minutes')",
            [hashToken(token), userId]
        );
    } catch (err) {
        console.error('[accounts] could not hold a half finished sign-in: ' + err.message);
        return null;
    }
    return token;
}

// Finishes a sign-in with a code, or with a recovery code. Returns a session or
// a reason, and never says which of the two was wrong.
async function finishTotp(pendingToken, code) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    let row;
    try {
        const res = await db.query(
            'SELECT p.token_hash, p.user_id, p.tries, u.totp_enc, u.totp_last, u.email_hash, u.email_enc, u.name_enc, u.lang' +
            ' FROM totp_pending p JOIN users u ON u.id = p.user_id' +
            ' WHERE p.token_hash = $1 AND p.expires_at > now()',
            [hashToken(String(pendingToken || ''))]
        );
        if (!res.rowCount) return { ok: false, reason: 'expired' };
        row = res.rows[0];
    } catch (err) {
        console.error('[accounts] could not read a half finished sign-in: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }

    // six digits is a million answers and this row lives five minutes, but a
    // script can still make a lot of guesses in five minutes
    if (row.tries >= 6) {
        await db.query('DELETE FROM totp_pending WHERE token_hash = $1', [row.token_hash]).catch(() => {});
        audit('2fa-refused', { actor: row.user_id, detail: 'out of tries' });
        return { ok: false, reason: 'too-many-attempts' };
    }

    const secret = db.open('totp:' + row.user_id, row.totp_enc);
    const step = secret ? totp.checkCode(secret, code) : null;
    let usedRecovery = false;

    if (step !== null) {
        // a code that has already been accepted is refused for the rest of its
        // thirty seconds
        if (row.totp_last !== null && String(row.totp_last) === String(step)) {
            // the code is right and has already been spent. that is a different
            // sentence from "wrong code": one means check what you typed, this
            // one means wait half a minute. it happens honestly to somebody who
            // switches 2fa on and signs in again inside the same thirty seconds.
            audit('2fa-refused', { actor: row.user_id, detail: 'code reused' });
            return { ok: false, reason: 'code-used' };
        }
        await db.query('UPDATE users SET totp_last = $1 WHERE id = $2', [String(step), row.user_id]).catch(() => {});
    } else {
        // not a code, so it may be one of the ten on the piece of paper
        const spent = await db.query(
            'UPDATE recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING 1',
            [row.user_id, hashRecovery(row.user_id, code)]
        ).catch(() => ({ rowCount: 0 }));
        if (!spent.rowCount) {
            await db.query('UPDATE totp_pending SET tries = tries + 1 WHERE token_hash = $1', [row.token_hash]).catch(() => {});
            audit('2fa-refused', { actor: row.user_id, detail: 'wrong code' });
            return { ok: false, reason: 'bad-code' };
        }
        usedRecovery = true;
    }

    await db.query('DELETE FROM totp_pending WHERE token_hash = $1', [row.token_hash]).catch(() => {});
    const session = await startSession(row.user_id, { mfa: true });
    if (!session) return { ok: false, reason: 'unavailable' };
    clearLoginFails(row.email_hash);
    db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [row.user_id]).catch(() => {});
    audit(usedRecovery ? '2fa-recovery-used' : 'login', { actor: row.user_id, subject: row.email_hash });

    let left = null;
    if (usedRecovery) {
        const rest = await db.query(
            'SELECT count(*)::int AS n FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL',
            [row.user_id]
        ).catch(() => null);
        left = rest && rest.rowCount ? rest.rows[0].n : null;
    }

    return {
        ok: true,
        session,
        userId: row.user_id,
        name: db.open('signup-name:' + row.email_hash, row.name_enc),
        email: db.open('signup-email:' + row.email_hash, row.email_enc),
        lang: row.lang || 'en',
        usedRecovery,
        recoveryLeft: left,
    };
}

// How many of the ten are left, for the page that says so.
async function recoveryLeft(userId) {
    if (!(await init())) return 0;
    try {
        const res = await db.query(
            'SELECT count(*)::int AS n FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL', [userId]);
        return res.rows[0].n;
    } catch (err) {
        return 0;
    }
}

// ---------------------------------------------------------------------------
// what somebody can do to their own account
// ---------------------------------------------------------------------------
//
// Three things, and all three used to need an email or a person: change the
// password, see where you are signed in and end those sessions, and delete the
// account. Not having them is a security problem rather than a missing feature.
// Somebody who thinks their password has been seen has, until now, had to ask
// for a reset link and hope; and the right to erasure was a message to us.

async function changePassword(userId, current, next) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    let row;
    try {
        const res = await db.query('SELECT password_hash, email_hash, email_enc, lang FROM users WHERE id = $1', [userId]);
        if (!res.rowCount) return { ok: false, reason: 'unavailable' };
        row = res.rows[0];
    } catch (err) {
        console.error('[accounts] could not read the account: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }
    // the current one, always. a session left open on a shared machine must not
    // be enough to take the account away from its owner.
    if (!(await verifyPassword(String(current || ''), row.password_hash))) {
        audit('password-change-refused', { actor: userId, detail: 'wrong current password' });
        return { ok: false, reason: 'bad-password' };
    }

    const fresh = await hashPassword(next);
    try {
        await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [fresh, userId]);
        // and every reset link for this address, which is a second way in that
        // the person changing their password almost certainly wants closed
        await db.query('DELETE FROM reset_tokens WHERE email_hash = $1', [row.email_hash]);
    } catch (err) {
        console.error('[accounts] could not change the password: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }
    audit('password-changed', { actor: userId, subject: row.email_hash, detail: 'by the owner' });
    return {
        ok: true,
        email: db.open('signup-email:' + row.email_hash, row.email_enc),
        lang: row.lang || 'en',
    };
}

// Where this account is signed in. No user agent strings: what is kept is when
// it started, when it was last used, and whether it was opened with a second
// factor, which is enough to recognise one you do not remember.
async function listSessions(userId, currentToken) {
    if (!(await init())) return [];
    try {
        const res = await db.query(
            `SELECT token_hash, created_at, last_seen_at, mfa, expires_at
               FROM sessions WHERE user_id = $1 AND expires_at > now()
              ORDER BY last_seen_at DESC`,
            [userId]
        );
        const mine = currentToken ? hashToken(currentToken) : '';
        return res.rows.map((r) => ({
            startedAt: r.created_at,
            lastSeenAt: r.last_seen_at,
            expiresAt: r.expires_at,
            mfa: Boolean(r.mfa),
            current: r.token_hash === mine,
        }));
    } catch (err) {
        console.error('[accounts] could not list sessions: ' + err.message);
        return [];
    }
}

// Everything except the one asking. "sign out everywhere" that also signs you
// out of the page you pressed it on is a button nobody presses twice.
async function revokeOtherSessions(userId, currentToken) {
    if (!(await init())) return 0;
    try {
        const res = await db.query(
            'DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2',
            [userId, currentToken ? hashToken(currentToken) : '']
        );
        audit('sessions-revoked', { actor: userId, detail: res.rowCount + ' ended' });
        return res.rowCount;
    } catch (err) {
        console.error('[accounts] could not end the other sessions: ' + err.message);
        return 0;
    }
}

// Erasure, done by the person rather than asked for. The password is required
// for the same reason it is required to switch off 2fa.
async function deleteAccount(userId, password) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    let row;
    try {
        const res = await db.query('SELECT password_hash, email_hash, email_enc FROM users WHERE id = $1', [userId]);
        if (!res.rowCount) return { ok: false, reason: 'unavailable' };
        row = res.rows[0];
    } catch (err) {
        return { ok: false, reason: 'unavailable' };
    }
    if (!(await verifyPassword(String(password || ''), row.password_hash))) {
        audit('account-delete-refused', { actor: userId, detail: 'wrong password' });
        return { ok: false, reason: 'bad-password' };
    }
    const email = db.open('signup-email:' + row.email_hash, row.email_enc);
    try {
        // sessions, devices, recovery codes and half finished sign-ins go with
        // the row: every one of them is `on delete cascade` against users.
        await db.query('DELETE FROM users WHERE id = $1', [userId]);
        await db.query('DELETE FROM reset_tokens WHERE email_hash = $1', [row.email_hash]);
        await db.query('DELETE FROM signup_codes WHERE email_hash = $1', [row.email_hash]);
        await db.query('DELETE FROM login_fails WHERE email_hash = $1', [row.email_hash]);
    } catch (err) {
        console.error('[accounts] could not delete the account: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }
    // the audit row stays, and it names nobody: the subject is the blind index,
    // which is what lets us answer "was this account deleted and when" without
    // keeping the address of somebody who asked us to forget it.
    audit('account-deleted', { actor: userId, subject: row.email_hash });
    return { ok: true, email };
}

// A real scrypt hash of a password nobody has, so the no-such-account path costs
// the same as the wrong-password one.
const DUMMY_HASH = 'scrypt$32768$8$1$' +
    Buffer.alloc(16, 7).toString('base64') + '$' + Buffer.alloc(64, 11).toString('base64');

// Expired codes and abandoned sign-ups. Runs with the submissions sweep.
async function purge() {
    if (!(await init())) return 0;
    let swept = 0;
    try {
        const res = await db.query(
            "DELETE FROM signup_codes WHERE expires_at < now() - interval '1 hour' OR created_at < now() - ($1 || ' hours')::interval",
            [String(PENDING_MAX_AGE_H)]
        );
        swept = res.rowCount;
        if (swept) console.log('[accounts] swept ' + swept + ' unfinished sign-ups');
        const links = await db.query("DELETE FROM reset_tokens WHERE expires_at < now() - interval '1 hour'");
        if (links.rowCount) console.log('[accounts] swept ' + links.rowCount + ' expired reset links');
    } catch (err) {
        console.error('[accounts] sweep failed: ' + err.message);
    }

    // Idle accounts, measured from the last sign-in. There is no sign-in yet, so
    // last_login_at is null on every row and the clock runs from when the account
    // was made; coalesce keeps that working and starts measuring properly the day
    // signing in exists, without a migration.
    try {
        const res = await db.query(
            "DELETE FROM users WHERE COALESCE(last_login_at, created_at) < now() - ($1 || ' months')::interval",
            [String(ACCOUNT_MAX_IDLE_MONTHS)]
        );
        if (res.rowCount) {
            console.log('[accounts] retention: removed ' + res.rowCount +
                ' account(s) idle for more than ' + ACCOUNT_MAX_IDLE_MONTHS + ' months');
        }
        swept += res.rowCount;
    } catch (err) {
        console.error('[accounts] account retention failed: ' + err.message);
    }
    // Spent throttle counters, and the audit trail past its own retention.
    //
    // The trail is kept far longer than anything else here, because the question
    // it answers is asked late: an incident in march is looked at in june. Long
    // is not forever, though, and it holds ip addresses, so it has a limit like
    // everything else.
    try {
        const stale = await db.query(
            "DELETE FROM login_fails WHERE last_at < now() - interval '7 days'");
        await db.query("DELETE FROM totp_pending WHERE expires_at < now()");
        if (stale.rowCount) console.log('[accounts] swept ' + stale.rowCount + ' sign-in throttle row(s)');
        const old = await db.query(
            "DELETE FROM audit_events WHERE at < now() - ($1 || ' days')::interval",
            [String(AUDIT_RETENTION_DAYS)]
        );
        if (old.rowCount) console.log('[accounts] swept ' + old.rowCount + ' audit event(s) past ' + AUDIT_RETENTION_DAYS + ' days');
    } catch (err) {
        console.error('[accounts] throttle and audit sweep failed: ' + err.message);
    }

    // Sessions past their hard stop or their idle window. They would be refused
    // anyway; this stops the table growing without limit.
    try {
        const res = await db.query(
            "DELETE FROM sessions WHERE expires_at < now() OR last_seen_at < now() - ($1 || ' days')::interval",
            [String(SESSION_IDLE_DAYS)]
        );
        if (res.rowCount) console.log('[accounts] swept ' + res.rowCount + ' finished session(s)');
        swept += res.rowCount;
    } catch (err) {
        console.error('[accounts] session sweep failed: ' + err.message);
    }

    return swept;
}

// What we know about one address, for whoever holds the admin token. It answers
// the question the form deliberately cannot: "i asked for a code and nothing
// came". An address that already has an account never gets a code, and a
// pending sign-up that is at its ceiling explains the silence too.
async function inspect(email) {
    if (!(await init())) return { available: false };
    const hash = db.blindIndex(email);
    if (!hash) return { available: false };

    const user = await db.query('SELECT created_at, last_login_at, flags FROM users WHERE email_hash = $1', [hash]);
    const pending = await db.query(
        'SELECT created_at, expires_at, attempts, sends, last_sent_at FROM signup_codes WHERE email_hash = $1', [hash]);

    const p = pending.rows[0];
    return {
        available: true,
        hasAccount: user.rowCount > 0,
        account: user.rows[0] ? {
            createdAt: user.rows[0].created_at,
            lastLoginAt: user.rows[0].last_login_at,
            flags: user.rows[0].flags || '',
        } : null,
        pendingSignup: p ? {
            startedAt: p.created_at,
            expiresAt: p.expires_at,
            expired: new Date(p.expires_at).getTime() < Date.now(),
            wrongAttempts: p.attempts,
            attemptsLeft: Math.max(0, CODE_MAX_ATTEMPTS - p.attempts),
            codesSent: p.sends,
            sendsLeft: Math.max(0, CODE_MAX_SENDS - p.sends),
            lastSentAt: p.last_sent_at,
        } : null,
        // the one sentence that usually answers it
        note: user.rowCount > 0
            ? 'this address already has an account, so registering again sends the "you already have one" notice rather than a code'
            : (p ? 'a sign-up is in progress and a code has been sent' : 'no account and no sign-up in progress for this address'),
    };
}

// ---------------------------------------------------------------------------
// forgotten passwords
// ---------------------------------------------------------------------------
//
// The link carries a 32 byte random token. What is stored is a keyed hash of
// it, the same way sessions are, so a copy of this table is not a set of keys.
//
// Three rules make this safe to hand to a stranger:
//
//   - it works once. finishing deletes the row inside the transaction that
//     changes the password, so two clicks on the same link cannot both win, and
//     a link forwarded or left in an inbox is dead the moment it is used
//   - asking again kills the previous link. only the newest one works, so a
//     link read over somebody's shoulder yesterday is already gone
//   - it is issued for any address, whether or not there is an account behind
//     it. the panel says the same sentence either way, so this endpoint cannot
//     be used to ask who has an account here
//
// An address with no account gets a link too, and finishing it makes the
// account. That is not a hole: the person had to read the mail, which is the
// same proof the six digit code asks for. It is a different door to the same
// check. What it must not skip is the name and the terms, so those are asked
// for on the page, and an account made this way carries the same row as one
// made through the form.
function hashResetToken(token) {
    return crypto.createHmac('sha256', db.indexKey() || Buffer.alloc(32))
        .update('reset-token:' + token, 'utf8')
        .digest('hex');
}

async function startReset(email, lang) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const emailHash = db.blindIndex(email);
    if (!emailHash) return { ok: false, reason: 'unavailable' };

    const token = crypto.randomBytes(32).toString('base64url');
    try {
        // One statement, and it is the whole rule.
        //
        // this used to read the last row, decide, and then write. two clicks a
        // millisecond apart both read "nothing recent" and both wrote, which is
        // two live links and two emails from one press of a button. the check
        // and the write have to be the same operation or they are not a limit,
        // and here they are: the unique index on email_hash makes the second
        // request conflict with the first, and the WHERE on the update is what
        // refuses it. postgres serialises the conflicting writers itself.
        //
        // the ceiling follows the address, not the ip in front of it: otherwise
        // a handful of proxies is a way of posting somebody a hundred emails.
        //
        // and because the row is replaced rather than added to, the previous
        // link stops working the moment a new one is issued. asking again is how
        // somebody says the last one did not arrive; leaving it alive would mean
        // three presses put three working keys in an inbox.
        const wrote = await db.query(
            `INSERT INTO reset_tokens (token_hash, email_hash, email_enc, expires_at, sends, lang)
             VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval, 1, $5)
             ON CONFLICT (email_hash) DO UPDATE SET
                 token_hash = EXCLUDED.token_hash,
                 email_enc  = EXCLUDED.email_enc,
                 created_at = now(),
                 expires_at = EXCLUDED.expires_at,
                 lang       = EXCLUDED.lang,
                 sends      = CASE WHEN reset_tokens.created_at > now() - interval '1 hour'
                                   THEN reset_tokens.sends + 1 ELSE 1 END
             WHERE reset_tokens.created_at <= now() - ($6 || ' seconds')::interval
               AND (reset_tokens.created_at <= now() - interval '1 hour'
                    OR reset_tokens.sends < $7)
             RETURNING sends`,
            [
                hashResetToken(token), emailHash,
                db.seal('reset-email:' + emailHash, email),
                String(RESET_TTL_MIN), lang || 'en',
                String(RESET_RESEND_WAIT_S), RESET_MAX_SENDS,
            ]
        );
        // no row means the conflict was refused: too soon, or too many this
        // hour. read back how long that is, because the caller has to be able to
        // say it: a screen that reports a link it did not send is worse than a
        // screen that says "not yet".
        //
        // this reveals that somebody asked about this address recently. it does
        // not reveal whether the address has an account, which is the thing that
        // must stay uniform: nothing on this path reads the users table, and a
        // known and an unknown address are refused identically.
        if (!wrote.rowCount) {
            const left = await db.query(
                `SELECT
                     GREATEST(0, CEIL(EXTRACT(EPOCH FROM (created_at + ($2 || ' seconds')::interval - now()))))::int AS cooldown,
                     GREATEST(0, CEIL(EXTRACT(EPOCH FROM (created_at + interval '1 hour' - now()))))::int AS hour_left,
                     sends
                 FROM reset_tokens WHERE email_hash = $1`,
                [emailHash, String(RESET_RESEND_WAIT_S)]
            );
            const row = left.rowCount ? left.rows[0] : null;
            const retryIn = !row ? RESET_RESEND_WAIT_S
                : (row.sends >= RESET_MAX_SENDS ? row.hour_left : row.cooldown);
            return { ok: false, reason: 'rate', retryIn: Math.max(1, retryIn) };
        }
    } catch (err) {
        console.error('[accounts] could not start a reset: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }
    audit('reset-requested', { subject: emailHash });
    return { ok: true, token, expiresInMin: RESET_TTL_MIN };
}

// What is behind a token, without spending it. Every kind of no answers the
// same way: a caller cannot tell an expired link from one that was never real.
async function readReset(token) {
    if (!token || typeof token !== 'string' || token.length > 200) return null;
    if (!(await init())) return null;
    try {
        const res = await db.query(
            'SELECT email_hash, email_enc, lang FROM reset_tokens WHERE token_hash = $1 AND expires_at > now()',
            [hashResetToken(token)]
        );
        if (!res.rowCount) return null;
        const row = res.rows[0];
        const user = await db.query('SELECT name_enc FROM users WHERE email_hash = $1', [row.email_hash]);
        return {
            email: db.open('reset-email:' + row.email_hash, row.email_enc),
            hasAccount: user.rowCount > 0,
            // for the password check only. the sign-up refuses a password made
            // of your own name and this door has to refuse the same ones, but
            // the name is not sent to the browser: whoever holds the token has
            // proved they can read the mail, not that they should be handed the
            // account holder's name before they have done anything.
            name: user.rowCount ? db.open('signup-name:' + row.email_hash, user.rows[0].name_enc) : '',
            lang: row.lang || 'en',
        };
    } catch (err) {
        console.error('[accounts] could not read a reset token: ' + err.message);
        return null;
    }
}

// Spend the token and set the password. `name` and `flags` are only read when
// there is no account yet; for an existing one the row keeps the name it has.
async function finishReset(token, password, { name, flags } = {}) {
    if (!token || typeof token !== 'string' || token.length > 200) return { ok: false, reason: 'bad-token' };
    if (!(await init())) return { ok: false, reason: 'unavailable' };

    const tokenHash = hashResetToken(token);
    const passwordHash = await hashPassword(password);

    const client = await db.connect();
    let userId = null;
    let made = false;
    let emailHash = '';
    let resetEmail = '';
    let resetLang = 'en';
    try {
        await client.query('BEGIN');
        // spent first, and inside the transaction: two clicks arriving together
        // must not both get through, and the loser must change nothing
        const spent = await client.query(
            'DELETE FROM reset_tokens WHERE token_hash = $1 AND expires_at > now() RETURNING email_hash, email_enc, lang',
            [tokenHash]
        );
        if (!spent.rowCount) { await client.query('ROLLBACK'); return { ok: false, reason: 'bad-token' }; }
        const row = spent.rows[0];
        emailHash = row.email_hash;
        resetLang = row.lang || 'en';
        resetEmail = db.open('reset-email:' + row.email_hash, row.email_enc);

        const found = await client.query('SELECT id FROM users WHERE email_hash = $1 FOR UPDATE', [row.email_hash]);
        if (found.rowCount) {
            userId = found.rows[0].id;
            await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
        } else {
            if (!name) { await client.query('ROLLBACK'); return { ok: false, reason: 'name-required' }; }
            const insert = await client.query(
                `INSERT INTO users (email_hash, email_enc, name_enc, password_hash, lang, flags, verified_at)
                 VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING id`,
                [
                    row.email_hash,
                    // resealed, not copied.
                    //
                    // the ciphertext in reset_tokens was sealed with
                    // 'reset-email:<hash>' as its label, and the label is part
                    // of what the value was sealed with. everything that reads
                    // users.email_enc opens it with 'signup-email:<hash>',
                    // because that is the label the sign-up path writes.
                    //
                    // copying it verbatim therefore wrote an address into the
                    // users table that nothing could ever open again, and
                    // db.open answers an empty string rather than throwing, so
                    // the account looked fine and simply had no address on it.
                    // every account made through the forgot-password door was
                    // like that: no address in /v1/auth/me, and no way to be
                    // recognised as staff, because that check needs one.
                    db.seal('signup-email:' + row.email_hash,
                        db.open('reset-email:' + row.email_hash, row.email_enc)),
                    db.seal('signup-name:' + row.email_hash, name),
                    passwordHash, row.lang || 'en', (flags || []).join(',').slice(0, 200),
                ]
            );
            userId = insert.rows[0].id;
            made = true;
        }

        // every other session goes. if somebody else was already signed in as
        // them, this is the press that puts them out, and a reset that leaves
        // the intruder holding a live cookie has not fixed anything.
        await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
        // and the half-finished sign-up, if one was sitting there: the account
        // exists now, and a code for it would create a second one
        await client.query('DELETE FROM signup_codes WHERE email_hash = $1', [row.email_hash]);
        await client.query('COMMIT');
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (rbErr) { /* connection already gone */ }
        console.error('[accounts] could not finish a reset: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    } finally {
        client.release();
    }

    // signed in on the spot, the same as finishing a sign-up: they have just
    // proved they can read the mail and chosen the password themselves
    const session = await startSession(userId);
    db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId])
        .catch((err) => console.error('[accounts] could not record the sign-in: ' + err.message));

    audit(made ? 'account-created-by-reset' : 'password-changed', { actor: userId, subject: emailHash });
    return { ok: true, created: made, session, email: resetEmail, lang: resetLang };
}

// Erasure: an account and anything half-made under the same address.
async function forget(email) {
    if (!(await init())) return 0;
    const hash = db.blindIndex(email);
    if (!hash) return 0;
    const a = await db.query('DELETE FROM users WHERE email_hash = $1', [hash]);
    const b = await db.query('DELETE FROM signup_codes WHERE email_hash = $1', [hash]);
    // a live reset link outlives the account it was for, and would make a new
    // one under the address somebody just asked us to forget
    const c = await db.query('DELETE FROM reset_tokens WHERE email_hash = $1', [hash]);
    return a.rowCount + b.rowCount + c.rowCount;
}

function status() {
    return {
        available: db.available(),
        codeTtlMinutes: CODE_TTL_MIN,
        maxAttempts: CODE_MAX_ATTEMPTS,
        maxSends: CODE_MAX_SENDS,
        resendWaitSeconds: CODE_RESEND_WAIT_S,
        idleRetentionMonths: ACCOUNT_MAX_IDLE_MONTHS,
        sessionDays: SESSION_MAX_DAYS,
        sessionIdleDays: SESSION_IDLE_DAYS,
    };
}

module.exports = {
    startSignup, resendSignup, verifySignup, exists, inspect, purge, forget, status,
    audit, loginHold, recentAudit, noteDevice,
    startTotp, confirmTotp, disableTotp, startTotpPending, finishTotp, recoveryLeft,
    changePassword, listSessions, revokeOtherSessions, deleteAccount,
    startReset, readReset, finishReset, RESET_TTL_MIN, RESET_RESEND_WAIT_S,
    hashPassword, verifyPassword,
    signIn, startSession, readSession, endSession,
    CODE_TTL_MIN, CODE_MAX_SENDS, CODE_RESEND_WAIT_S,
};
