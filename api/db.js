'use strict';

const crypto = require('crypto');
const { Pool } = require('pg');

const URL_RAW = process.env.DATABASE_URL || '';

function sslFor(rawUrl) {
    let host = '';
    try {
        host = new URL(rawUrl).hostname;
    } catch (err) {
        return undefined;
    }
    const isPrivate =
        host.endsWith('.railway.internal') ||
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1';

    if (isPrivate) return false;

    if (/sslmode=disable/i.test(rawUrl)) {
        throw new Error('DATABASE_URL asks for sslmode=disable on a public host; refusing to connect in the clear');
    }

    const ca = process.env.DATABASE_CA_CERT || '';
    if (ca) return { rejectUnauthorized: true, ca };
    return { rejectUnauthorized: false };
}

let pool = null;
let poolError = '';

if (URL_RAW) {
    try {
        pool = new Pool({
            connectionString: URL_RAW,
            ssl: sslFor(URL_RAW),
            max: Number(process.env.DATABASE_POOL_MAX || 8),
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 8000,
            statement_timeout: 10000,
            query_timeout: 10000,
            application_name: 'sentinelpay-web',
        });
        pool.on('error', (err) => {
            console.error('[db] idle client error: ' + err.message);
        });
    } catch (err) {
        poolError = err.message;
        console.error('[db] not connecting: ' + err.message);
    }
}

function readKey(name) {
    const raw = process.env[name] || '';
    if (!raw) return null;
    let buf;
    try {
        buf = Buffer.from(raw, 'base64');
    } catch (err) {
        return null;
    }
    if (buf.length !== 32) {
        console.error('[db] ' + name + ' must be 32 bytes base64, got ' + buf.length + '; ignoring it');
        return null;
    }
    return buf;
}

const DATA_KEY = readKey('SUBMISSIONS_KEY');
const DATA_KEY_PREVIOUS = readKey('SUBMISSIONS_KEY_PREVIOUS');
const INDEX_KEY = readKey('SUBMISSIONS_INDEX_KEY') || (DATA_KEY
    ? crypto.createHmac('sha256', DATA_KEY).update('blind-index-v1').digest()
    : null);

function encrypt(plain, aad) {
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', DATA_KEY, nonce, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), body]).toString('base64');
}

function decryptWith(key, buf, aad) {
    const nonce = buf.subarray(1, 13);
    const tag = buf.subarray(13, 29);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(buf.subarray(29)), decipher.final()]).toString('utf8');
}

function decrypt(blob, aad) {
    const buf = Buffer.from(blob, 'base64');
    if (buf.length < 29 || buf[0] !== 1) throw new Error('unrecognised ciphertext');
    try {
        return decryptWith(DATA_KEY, buf, aad);
    } catch (err) {
        if (!DATA_KEY_PREVIOUS) throw err;
        return decryptWith(DATA_KEY_PREVIOUS, buf, aad);
    }
}

function blindIndex(email) {
    if (!INDEX_KEY || !email) return null;
    return crypto.createHmac('sha256', INDEX_KEY)
        .update(String(email).trim().toLowerCase(), 'utf8')
        .digest('hex');
}

const ENCRYPTED = Boolean(DATA_KEY);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS submissions (
    id           bigserial PRIMARY KEY,
    received_at  timestamptz NOT NULL DEFAULT now(),
    kind         text        NOT NULL,
    outcome      text        NOT NULL,
    country      text,
    lang         text,
    email_hash   text,
    payload      text        NOT NULL,
    encrypted    boolean     NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS submissions_received_idx ON submissions (received_at DESC);
CREATE INDEX IF NOT EXISTS submissions_kind_idx     ON submissions (kind, received_at DESC);
CREATE INDEX IF NOT EXISTS submissions_email_idx    ON submissions (email_hash);

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS flags text;
CREATE INDEX IF NOT EXISTS submissions_flags_idx    ON submissions (flags) WHERE flags <> '';
`;

let ready = null;

function init() {
    if (!pool) return Promise.resolve(false);
    if (ready) return ready;
    ready = pool.query(SCHEMA)
        .then(() => {
            console.log('[db] connected, submissions table ready, payload ' +
                (ENCRYPTED ? 'encrypted (aes-256-gcm)' : 'IN THE CLEAR: set SUBMISSIONS_KEY'));
            return true;
        })
        .catch((err) => {
            console.error('[db] schema failed: ' + err.message);
            ready = null;
            return false;
        });
    return ready;
}

async function insert(kind, outcome, fields) {
    if (!pool) return false;
    if (!(await init())) return false;

    const payload = JSON.stringify(fields);
    const row = {
        kind: String(kind).slice(0, 32),
        outcome: String(outcome).slice(0, 64),
        country: fields.country ? String(fields.country).slice(0, 8) : null,
        lang: fields.lang ? String(fields.lang).slice(0, 8) : null,
        emailHash: blindIndex(fields.email),
        flags: Array.isArray(fields.flags) ? fields.flags.join(',').slice(0, 200) : '',
    };

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const res = await client.query(
            `INSERT INTO submissions (kind, outcome, country, lang, email_hash, flags, payload, encrypted)
             VALUES ($1, $2, $3, $4, $5, $6, '', $7) RETURNING id`,
            [row.kind, row.outcome, row.country, row.lang, row.emailHash, row.flags, ENCRYPTED]
        );
        const id = res.rows[0].id;
        const sealed = ENCRYPTED ? encrypt(payload, 'submission:' + id) : payload;
        await client.query('UPDATE submissions SET payload = $1 WHERE id = $2', [sealed, id]);
        await client.query('COMMIT');
        return true;
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (rbErr) {  }
        console.error('[db] insert failed: ' + err.message);
        return false;
    } finally {
        client.release();
    }
}

async function recent(limit, kind, flaggedOnly, offset) {
    if (!pool) return null;
    if (!(await init())) return null;

    const max = Math.min(Math.max(Number(limit) || 50, 1), 500);
    const skip = Math.max(Number(offset) || 0, 0);
    const params = [max, skip];
    const where = [];
    if (kind) {
        params.push(String(kind).slice(0, 32));
        where.push('kind = $' + params.length);
    }
    if (flaggedOnly) where.push("flags IS NOT NULL AND flags <> ''");
    const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const res = await pool.query(
        `SELECT id, received_at, kind, outcome, country, lang, flags, payload, encrypted
         FROM submissions ${clause} ORDER BY received_at DESC, id DESC LIMIT $1 OFFSET $2`,
        params
    );

    return res.rows.map((r) => {
        let fields;
        try {
            fields = JSON.parse(r.encrypted ? decrypt(r.payload, 'submission:' + r.id) : r.payload);
        } catch (err) {
            fields = { unreadable: err.message };
        }
        return Object.assign({
            id: String(r.id),
            ts: r.received_at.toISOString(),
            kind: r.kind,
            outcome: r.outcome,
            flags: r.flags ? r.flags.split(',') : [],
        }, fields);
    });
}

const RETENTION_DAYS = Math.max(Number(process.env.SUBMISSIONS_RETENTION_DAYS || 365), 1);

async function purge() {
    if (!pool) return 0;
    if (!(await init())) return 0;
    try {
        const res = await pool.query(
            "DELETE FROM submissions WHERE received_at < now() - ($1 || ' days')::interval",
            [String(RETENTION_DAYS)]
        );
        if (res.rowCount) console.log('[db] retention: removed ' + res.rowCount + ' submissions older than ' + RETENTION_DAYS + ' days');
        return res.rowCount;
    } catch (err) {
        console.error('[db] retention sweep failed: ' + err.message);
        return 0;
    }
}

function startRetention() {
    if (!pool) return;
    setTimeout(() => { purge(); }, 30000).unref();
    setInterval(() => { purge(); }, 24 * 60 * 60 * 1000).unref();
}

async function count(kind, flaggedOnly) {
    if (!pool) return 0;
    if (!(await init())) return 0;
    const params = [];
    const where = [];
    if (kind) { params.push(String(kind).slice(0, 32)); where.push('kind = $' + params.length); }
    if (flaggedOnly) where.push("flags IS NOT NULL AND flags <> ''");
    const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const res = await pool.query(`SELECT count(*)::int AS n FROM submissions ${clause}`, params);
    return res.rows[0] ? res.rows[0].n : 0;
}

async function remove(id) {
    if (!pool) return 0;
    if (!(await init())) return 0;
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) return 0;
    const res = await pool.query('DELETE FROM submissions WHERE id = $1', [n]);
    return res.rowCount;
}

async function forget(email) {
    if (!pool) return 0;
    if (!(await init())) return 0;
    const hash = blindIndex(email);
    if (!hash) return 0;
    const res = await pool.query('DELETE FROM submissions WHERE email_hash = $1', [hash]);
    return res.rowCount;
}

function status() {
    return {
        configured: Boolean(URL_RAW),
        connected: Boolean(pool),
        encrypted: ENCRYPTED,
        blindIndex: Boolean(INDEX_KEY),
        retentionDays: RETENTION_DAYS,
        error: poolError || null,
    };
}

function query(text, params) {
    if (!pool) return Promise.reject(new Error('no database configured'));
    return pool.query(text, params);
}
function connect() {
    if (!pool) return Promise.reject(new Error('no database configured'));
    return pool.connect();
}
function seal(aad, plain) {
    return ENCRYPTED ? encrypt(String(plain == null ? '' : plain), aad) : String(plain == null ? '' : plain);
}
function open(aad, blob) {
    if (!ENCRYPTED) return String(blob == null ? '' : blob);
    try {
        return decrypt(blob, aad);
    } catch (err) {
        return '';
    }
}

function openCurrent(aad, blob) {
    if (!ENCRYPTED) return String(blob == null ? '' : blob);
    try {
        const buf = Buffer.from(String(blob || ''), 'base64');
        if (buf.length < 29 || buf[0] !== 1) return '';
        return decryptWith(DATA_KEY, buf, aad);
    } catch (err) {
        return '';
    }
}

module.exports = {
    insert, recent, count, remove, purge, forget, startRetention, status,
    available: () => Boolean(pool),
    close: () => (pool ? pool.end() : Promise.resolve()),
    rotating: () => Boolean(DATA_KEY_PREVIOUS),
    query, connect, seal, open, openCurrent, blindIndex,
    indexKey: () => INDEX_KEY,
    encrypted: () => ENCRYPTED,
};
