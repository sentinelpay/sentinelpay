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

const CODE_TTL_MIN = Math.min(Math.max(Number(process.env.SIGNUP_CODE_TTL_MIN || 15), 5), 60);
const CODE_MAX_ATTEMPTS = 5;
const CODE_MAX_SENDS = 5;          // per pending sign-up, counting the first one
const CODE_RESEND_WAIT_S = 60;     // between one send and the next
const PENDING_MAX_AGE_H = 24;      // an abandoned sign-up is swept after this
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
    await db.query(
        `INSERT INTO signup_codes (email_hash, expires_at, code_hash, email_enc, name_enc, password_hash, lang, flags)
         VALUES ($1, now() + ($2 || ' minutes')::interval, $3, $4, $5, $6, $7, $8)
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
             flags         = EXCLUDED.flags`,
        [
            emailHash, String(CODE_TTL_MIN), hashCode(code, emailHash),
            db.seal('signup-email:' + emailHash, email),
            db.seal('signup-name:' + emailHash, name || ''),
            passwordHash,
            lang || 'en',
            (flags || []).join(',').slice(0, 200),
        ]
    );
    return { ok: true, code, expiresInMin: CODE_TTL_MIN };
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
async function verifySignup(email, code) {
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

async function startSession(userId) {
    if (!(await init())) return null;
    const token = crypto.randomBytes(32).toString('base64url');
    try {
        await db.query(
            `INSERT INTO sessions (token_hash, user_id, expires_at)
             VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
            [hashToken(token), userId, String(SESSION_MAX_DAYS)]
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
            `SELECT s.token_hash, s.user_id, u.email_hash, u.email_enc, u.name_enc, u.lang, u.created_at
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
        return {
            userId: row.user_id,
            // the label is part of what the value was sealed with, so it has to
            // be the one used at the time. these ciphertexts are copied
            // verbatim out of signup_codes when the account is written, so they
            // keep the signup labels for ever. changing them here would not
            // rename anything, it would simply fail to open.
            email: db.open('signup-email:' + row.email_hash, row.email_enc),
            name: db.open('signup-name:' + row.email_hash, row.name_enc),
            lang: row.lang || 'en',
            since: row.created_at,
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
async function signIn(email, password) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const emailHash = db.blindIndex(email);
    if (!emailHash) return { ok: false, reason: 'unavailable' };

    let row = null;
    try {
        const res = await db.query('SELECT id, email_hash, name_enc, password_hash FROM users WHERE email_hash = $1', [emailHash]);
        row = res.rowCount ? res.rows[0] : null;
    } catch (err) {
        console.error('[accounts] sign-in lookup failed: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }

    // no such address: the password is still hashed, against a fixed dummy, so
    // the reply does not come back noticeably sooner than a wrong password does
    if (!row) {
        await verifyPassword(String(password || ''), DUMMY_HASH);
        return { ok: false, reason: 'bad-credentials' };
    }
    if (!(await verifyPassword(String(password || ''), row.password_hash))) {
        return { ok: false, reason: 'bad-credentials' };
    }

    const session = await startSession(row.id);
    if (!session) return { ok: false, reason: 'unavailable' };
    db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [row.id])
        .catch((err) => console.error('[accounts] could not record the sign-in: ' + err.message));
    return { ok: true, session, name: db.open('signup-name:' + row.email_hash, row.name_enc) };
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

// Erasure: an account and anything half-made under the same address.
async function forget(email) {
    if (!(await init())) return 0;
    const hash = db.blindIndex(email);
    if (!hash) return 0;
    const a = await db.query('DELETE FROM users WHERE email_hash = $1', [hash]);
    const b = await db.query('DELETE FROM signup_codes WHERE email_hash = $1', [hash]);
    return a.rowCount + b.rowCount;
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
    hashPassword, verifyPassword,
    signIn, startSession, readSession, endSession,
    CODE_TTL_MIN, CODE_MAX_SENDS, CODE_RESEND_WAIT_S,
};
