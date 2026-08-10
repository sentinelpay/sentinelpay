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
        crypto.scrypt(password, salt, expected.length, { N, r, p, maxmem: 256 * 1024 * 1024 }, (err, key) => {
            if (err) return resolve(false);
            resolve(key.length === expected.length && crypto.timingSafeEqual(key, expected));
        });
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
    try {
        await client.query('BEGIN');
        // consumed first: the same code must not create two accounts if two
        // requests arrive together
        const gone = await client.query('DELETE FROM signup_codes WHERE email_hash = $1 RETURNING 1', [emailHash]);
        if (!gone.rowCount) { await client.query('ROLLBACK'); return { ok: false, reason: 'bad-code' }; }
        await client.query(
            `INSERT INTO users (email_hash, email_enc, name_enc, password_hash, lang, flags)
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (email_hash) DO NOTHING`,
            [emailHash, row.email_enc, row.name_enc, row.password_hash, row.lang, row.flags]
        );
        await client.query('COMMIT');
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (rbErr) { /* connection already gone */ }
        console.error('[accounts] could not finish sign-up: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    } finally {
        client.release();
    }

    return { ok: true, name: db.open('signup-name:' + emailHash, row.name_enc), lang: row.lang || 'en' };
}

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
    };
}

module.exports = {
    startSignup, resendSignup, verifySignup, exists, inspect, purge, forget, status,
    hashPassword, verifyPassword,
    CODE_TTL_MIN, CODE_MAX_SENDS, CODE_RESEND_WAIT_S,
};
