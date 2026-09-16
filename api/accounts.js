'use strict';

const crypto = require('crypto');
const db = require('./db');
const totp = require('./totp');

const CODE_TTL_MIN = Math.min(Math.max(Number(process.env.SIGNUP_CODE_TTL_MIN || 15), 5), 60);
const CODE_MAX_ATTEMPTS = 5;
const CODE_MAX_SENDS = 5;
const CODE_RESEND_WAIT_S = 60;
const PENDING_MAX_AGE_H = 24;
const RESET_TTL_MIN = Math.min(Math.max(Number(process.env.RESET_TTL_MIN || 60), 5), 240);
const RESET_MAX_SENDS = 3;
const RESET_RESEND_WAIT_S = 60;
const ACCOUNT_MAX_IDLE_MONTHS = Math.max(Number(process.env.ACCOUNT_RETENTION_MONTHS || 24), 1);
const SESSION_MAX_DAYS = Math.min(Math.max(Number(process.env.SESSION_DAYS || 30), 1), 90);
const SESSION_IDLE_DAYS = Math.min(Math.max(Number(process.env.SESSION_IDLE_DAYS || 7), 1), SESSION_MAX_DAYS);
const SESSIONS_PER_USER = 20;
const AUDIT_RETENTION_DAYS = Math.min(Math.max(Number(process.env.AUDIT_RETENTION_DAYS || 400), 30), 3650);

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

CREATE TABLE IF NOT EXISTS login_fails (
    email_hash    text        PRIMARY KEY,
    fails         integer     NOT NULL DEFAULT 0,
    first_at      timestamptz NOT NULL DEFAULT now(),
    last_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_fails_last_idx ON login_fails (last_at);

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

ALTER TABLE signup_codes ADD COLUMN IF NOT EXISTS origin_hash text;

ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enc  text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_at   timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last bigint;

CREATE TABLE IF NOT EXISTS recovery_codes (
    user_id    bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    used_at    timestamptz,
    PRIMARY KEY (user_id, code_hash)
);

CREATE TABLE IF NOT EXISTS totp_pending (
    token_hash text        PRIMARY KEY,
    user_id    bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    tries      integer     NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS totp_pending_expiry_idx ON totp_pending (expires_at);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mfa boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS known_devices (
    user_id     bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_hash text        NOT NULL,
    first_at    timestamptz NOT NULL DEFAULT now(),
    last_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, device_hash)
);

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
            ready = null;
            return false;
        });
    return ready;
}

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

function newCode() {
    return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

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

async function exists(email) {
    if (!(await init())) return false;
    const res = await db.query('SELECT 1 FROM users WHERE email_hash = $1', [db.blindIndex(email)]);
    return res.rowCount > 0;
}

async function startSignup({ email, name, password, lang, flags }) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const emailHash = db.blindIndex(email);
    if (!emailHash) return { ok: false, reason: 'unavailable' };

    if (await exists(email)) return { ok: false, reason: 'exists' };

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
        const gone = await client.query('DELETE FROM signup_codes WHERE email_hash = $1 RETURNING 1', [emailHash]);
        if (!gone.rowCount) { await client.query('ROLLBACK'); return { ok: false, reason: 'bad-code' }; }
        const made = await client.query(
            `INSERT INTO users (email_hash, email_enc, name_enc, password_hash, lang, flags)
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (email_hash) DO NOTHING RETURNING id`,
            [emailHash, row.email_enc, row.name_enc, row.password_hash, row.lang, row.flags]
        );
        userId = made.rowCount ? made.rows[0].id : null;
        if (userId === null) {
            const found = await client.query('SELECT id FROM users WHERE email_hash = $1', [emailHash]);
            userId = found.rowCount ? found.rows[0].id : null;
        }
        await client.query('COMMIT');
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (rbErr) {  }
        console.error('[accounts] could not finish sign-up: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    } finally {
        client.release();
    }

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

function hashToken(token) {
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

// the same person a session would give you, looked up by id. the api token path
// needs this: it has an owner but no session row to join through.
async function readUser(userId) {
    if (!(await init())) return null;
    try {
        const res = await db.query(
            `SELECT id, email_hash, email_enc, name_enc, lang, created_at, totp_at
               FROM users WHERE id = $1`,
            [userId]
        );
        if (!res.rowCount) return null;
        const row = res.rows[0];
        return {
            userId: row.id,
            email: db.open('signup-email:' + row.email_hash, row.email_enc),
            name: db.open('signup-name:' + row.email_hash, row.name_enc),
            lang: row.lang || 'en',
            since: row.created_at,
            mfa: false,
            totpOn: Boolean(row.totp_at),
            emailHash: row.email_hash,
        };
    } catch (err) {
        console.error('[accounts] user lookup failed: ' + err.message);
        return null;
    }
}

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
        db.query(
            "UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1 AND last_seen_at < now() - interval '1 minute'",
            [row.token_hash]
        ).catch(() => {  });
        let email = db.open('signup-email:' + row.email_hash, row.email_enc);
        if (!email) {
            const fromReset = db.open('reset-email:' + row.email_hash, row.email_enc);
            if (fromReset) {
                email = fromReset;
                db.query('UPDATE users SET email_enc = $1 WHERE id = $2',
                    [db.seal('signup-email:' + row.email_hash, fromReset), row.user_id]
                ).then(() => {
                    console.log('[accounts] resealed an address written by the reset path');
                }).catch(() => {  });
            }
        }
        return {
            userId: row.user_id,
            email: email,
            name: db.open('signup-name:' + row.email_hash, row.name_enc),
            lang: row.lang || 'en',
            since: row.created_at,
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

function deviceHash(parts) {
    return crypto.createHmac('sha256', db.indexKey() || Buffer.alloc(32))
        .update('device:' + (parts || []).join('|'), 'utf8')
        .digest('hex');
}

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
const LOGIN_FREE_TRIES = 5;
const LOGIN_BASE_WAIT_S = 30;
const LOGIN_MAX_WAIT_S = 30 * 60;
const LOGIN_FORGET_H = 1;
function loginWaitFor(fails) {
    if (fails <= LOGIN_FREE_TRIES) return 0;
    const steps = Math.min(fails - LOGIN_FREE_TRIES - 1, 20);
    return Math.min(LOGIN_BASE_WAIT_S * Math.pow(2, steps), LOGIN_MAX_WAIT_S);
}

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
async function setName(userId, name) {
    if (!db.available()) return { ok: false, reason: 'unavailable' };
    const res = await db.query('SELECT email_hash FROM users WHERE id = $1', [userId]);
    if (!res.rows.length) return { ok: false, reason: 'no-user' };
    const emailHash = res.rows[0].email_hash;
    await db.query('UPDATE users SET name_enc = $2 WHERE id = $1',
        [userId, db.seal('signup-name:' + emailHash, name)]);
    return { ok: true, name };
}

async function signIn(email, password) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const emailHash = db.blindIndex(email);
    if (!emailHash) return { ok: false, reason: 'unavailable' };
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
    if (!String(row.password_hash || '').startsWith('scrypt$' + SCRYPT.N + '$' + SCRYPT.r + '$' + SCRYPT.p + '$')) {
        hashPassword(String(password || '')).then((fresh) =>
            db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [fresh, row.id])
        ).then(() => console.log('[accounts] rehashed a password at the current cost'))
            .catch((err) => console.error('[accounts] could not rehash: ' + err.message));
    }
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
        email: db.open('signup-email:' + row.email_hash, row.email_enc),
        lang: row.lang || 'en',
    };
}

async function startTotp(userId) {
    if (!(await init())) return null;
    const secret = totp.newSecret();
    try {
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
        await client.query('COMMIT');
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (rbErr) {  }
        console.error('[accounts] could not switch on 2fa: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    } finally {
        client.release();
    }
    audit('2fa-on', { actor: userId });
    return { ok: true, codes };
}
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

    if (row.tries >= 6) {
        await db.query('DELETE FROM totp_pending WHERE token_hash = $1', [row.token_hash]).catch(() => {});
        audit('2fa-refused', { actor: row.user_id, detail: 'out of tries' });
        return { ok: false, reason: 'too-many-attempts' };
    }
    const secret = db.open('totp:' + row.user_id, row.totp_enc);
    const step = secret ? totp.checkCode(secret, code) : null;
    let usedRecovery = false;
    if (step !== null) {
        if (row.totp_last !== null && String(row.totp_last) === String(step)) {

            audit('2fa-refused', { actor: row.user_id, detail: 'code reused' });
            return { ok: false, reason: 'code-used' };
        }
        await db.query('UPDATE users SET totp_last = $1 WHERE id = $2', [String(step), row.user_id]).catch(() => {});
    } else {
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
    if (!(await verifyPassword(String(current || ''), row.password_hash))) {
        audit('password-change-refused', { actor: userId, detail: 'wrong current password' });
        return { ok: false, reason: 'bad-password' };
    }
    const fresh = await hashPassword(next);
    try {
        await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [fresh, userId]);
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

        await db.query('DELETE FROM users WHERE id = $1', [userId]);
        await db.query('DELETE FROM reset_tokens WHERE email_hash = $1', [row.email_hash]);
        await db.query('DELETE FROM signup_codes WHERE email_hash = $1', [row.email_hash]);
        await db.query('DELETE FROM login_fails WHERE email_hash = $1', [row.email_hash]);
    } catch (err) {
        console.error('[accounts] could not delete the account: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }
    audit('account-deleted', { actor: userId, subject: row.email_hash });
    return { ok: true, email };
}
const DUMMY_HASH = 'scrypt$32768$8$1$' +
    Buffer.alloc(16, 7).toString('base64') + '$' + Buffer.alloc(64, 11).toString('base64');
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
        note: user.rowCount > 0
            ? 'this address already has an account, so registering again sends the "you already have one" notice rather than a code'
            : (p ? 'a sign-up is in progress and a code has been sent' : 'no account and no sign-up in progress for this address'),
    };
}

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

            name: user.rowCount ? db.open('signup-name:' + row.email_hash, user.rows[0].name_enc) : '',
            lang: row.lang || 'en',
        };
    } catch (err) {
        console.error('[accounts] could not read a reset token: ' + err.message);
        return null;
    }
}
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

                    db.seal('signup-email:' + row.email_hash,
                        db.open('reset-email:' + row.email_hash, row.email_enc)),
                    db.seal('signup-name:' + row.email_hash, name),
                    passwordHash, row.lang || 'en', (flags || []).join(',').slice(0, 200),
                ]
            );
            userId = insert.rows[0].id;
            made = true;
        }
        await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM signup_codes WHERE email_hash = $1', [row.email_hash]);
        await client.query('COMMIT');
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (rbErr) {  }
        console.error('[accounts] could not finish a reset: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    } finally {
        client.release();
    }
    const session = await startSession(userId);
    db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId])
        .catch((err) => console.error('[accounts] could not record the sign-in: ' + err.message));
    audit(made ? 'account-created-by-reset' : 'password-changed', { actor: userId, subject: emailHash });
    return { ok: true, created: made, session, email: resetEmail, lang: resetLang };
}
async function forget(email) {
    if (!(await init())) return 0;
    const hash = db.blindIndex(email);
    if (!hash) return 0;
    const a = await db.query('DELETE FROM users WHERE email_hash = $1', [hash]);
    const b = await db.query('DELETE FROM signup_codes WHERE email_hash = $1', [hash]);

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
    readUser,
    hashPassword, verifyPassword,
    signIn, startSession, readSession, endSession,
    CODE_TTL_MIN, CODE_MAX_SENDS, CODE_RESEND_WAIT_S, setName };