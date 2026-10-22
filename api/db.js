'use strict';

const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

// The tools reach the database through this file and nothing else, and none of
// them loaded the .env the server loads. So every one of them had to be handed
// DATABASE_URL and SUBMISSIONS_KEY on the command line, which is a different
// incantation in bash and in powershell and is how somebody ends up seeding a
// database with no key and writing personal data in the clear.
//
// Loading it here covers the server and all ten tools at once. The path is
// absolute because a tool is run from the repository root and the server from
// api/, and dotenv looks next to the working directory. Nothing is overridden:
// a variable already set by Railway or by a shell wins, as it must.
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

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
    // Encrypted, but nobody checks who answers: whoever sits between here and
    // a public host could take the password and everything read after it.
    console.error('[security] the database at ' + host + ' is reached without checking its certificate; set DATABASE_CA_CERT');
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
            // Eight seconds is plenty from a container sitting beside the
            // database and is not always enough from a laptop on the other
            // side of an ocean, which is exactly where a fixture gets run from.
            connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 8000),
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
// Set only while the index key is being changed. Until tools/rotate-index-key.js
// has rewritten every address, the addresses in the database are still under
// this one, so it is the key in use; the database says when that changes.
const INDEX_KEY_PREVIOUS = readKey('SUBMISSIONS_INDEX_KEY_PREVIOUS');
// Sessions, API tokens, invitation links and reset links are 256 random bits
// each. Their hash cannot be turned back into them with the key or without it,
// so they keep the key they were made under when the index key changes, and
// nobody is signed out or has an integration stop working. Unset, it is the
// index key as it was before any rotation.
const TOKEN_KEY = readKey('SUBMISSIONS_TOKEN_KEY') || INDEX_KEY_PREVIOUS || INDEX_KEY;
let liveIndex = INDEX_KEY_PREVIOUS || INDEX_KEY;

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

function macWith(key, text) {
    return crypto.createHmac('sha256', key || Buffer.alloc(32)).update(String(text), 'utf8').digest('hex');
}
// The hash under the index key in use. Low-entropy things go here, where a
// copy of the database without the key cannot be searched: addresses, phone
// numbers, six-digit codes, recovery codes, a device's description.
function indexHash(text) {
    return macWith(liveIndex, text);
}
// While the key is changing, the same thing under both keys, the one in use
// first, for what can only be moved over when somebody next presents it.
function indexHashes(text) {
    const out = [indexHash(text)];
    const other = liveIndex === INDEX_KEY ? INDEX_KEY_PREVIOUS : INDEX_KEY;
    if (other && !other.equals(liveIndex || Buffer.alloc(0))) out.push(macWith(other, text));
    return out;
}
function tokenHash(text) {
    return macWith(TOKEN_KEY, text);
}
function blindIndex(email) {
    if (!liveIndex || !email) return null;
    return indexHash(String(email).trim().toLowerCase());
}
// What the database records about a key, so a server can tell it was started
// with the wrong one before anybody tries to sign in. A keyed hash of a fixed
// string: it says which key, and nothing about the key.
function fingerprint(key) {
    return key ? macWith(key, 'sentinelpay key fingerprint').slice(0, 24) : '';
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

-- Which keys the hashes in this database were made under, as fingerprints.
-- The first server to start writes it; tools/rotate-index-key.js moves the
-- index one over in the same transaction that rewrites the addresses.
CREATE TABLE IF NOT EXISTS hash_keys (
    id          integer     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    index_fp    text        NOT NULL,
    token_fp    text        NOT NULL,
    index_since timestamptz NOT NULL DEFAULT now()
);
`;

let ready = null;

// Reads which index key the database is under and uses that one. Run once at
// start, and every two seconds while a rotation is under way, so the server
// follows the tool's commit without a restart.
let keyWarned = '';
function warnOnce(text) {
    if (keyWarned === text) return;
    keyWarned = text;
    console.error('[db] ' + text);
}
async function readKeys() {
    if (!pool || !INDEX_KEY) return null;
    await pool.query('INSERT INTO hash_keys (id, index_fp, token_fp) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING',
        [fingerprint(INDEX_KEY_PREVIOUS || INDEX_KEY), fingerprint(TOKEN_KEY)]);
    const row = (await pool.query('SELECT index_fp, token_fp, index_since FROM hash_keys WHERE id = 1')).rows[0];
    if (row.index_fp === fingerprint(INDEX_KEY)) liveIndex = INDEX_KEY;
    else if (INDEX_KEY_PREVIOUS && row.index_fp === fingerprint(INDEX_KEY_PREVIOUS)) liveIndex = INDEX_KEY_PREVIOUS;
    else warnOnce('the addresses in this database are indexed under a key this server does not have, so nobody can be ' +
        'found by email. Put the key they are under back, as SUBMISSIONS_INDEX_KEY or SUBMISSIONS_INDEX_KEY_PREVIOUS.');
    if (row.token_fp !== fingerprint(TOKEN_KEY)) {
        warnOnce('sessions and API tokens in this database were made under a different key than this server hashes them ' +
            'with, so none of them work. SUBMISSIONS_TOKEN_KEY has to be the index key from before the first rotation.');
    }
    return row;
}
let keyTimer = null;
function followKeys() {
    if (!INDEX_KEY_PREVIOUS || keyTimer) return;
    keyTimer = setInterval(() => {
        readKeys().catch((err) => console.error('[db] could not read the key marker: ' + err.message));
    }, 2000);
    keyTimer.unref();
}

function init() {
    if (!pool) return Promise.resolve(false);
    if (ready) return ready;
    ready = pool.query(SCHEMA)
        .then(() => readKeys())
        .then(() => {
            console.log('[db] connected, submissions table ready, payload ' +
                (ENCRYPTED ? 'encrypted (aes-256-gcm)' : 'IN THE CLEAR: set SUBMISSIONS_KEY'));
            if (INDEX_KEY_PREVIOUS) {
                console.log('[db] index key rotation under way, addresses read under the ' +
                    (liveIndex === INDEX_KEY ? 'new' : 'previous') + ' key');
                followKeys();
            }
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

// Where we were trying to reach, for an error that otherwise does not say.
//
// "Connection terminated due to connection timeout" is the whole of what pg
// offers, and from a laptop it is true of a dozen different mistakes: the
// internal host that only resolves inside Railway, the public one with no TCP
// proxy in front of it, the right host on the wrong port, a network that
// blocks the high port a proxy listens on. The address is not a secret -- the
// password in it is, and that is the one part left out.
function reaching() {
    try {
        const u = new URL(URL_RAW);
        return u.hostname + ':' + (u.port || '5432') +
            (u.hostname.endsWith('.railway.internal')
                ? ' (this host only resolves from inside Railway)'
                : '');
    } catch (err) {
        return 'the address in DATABASE_URL';
    }
}

function withWhere(err) {
    if (!err || !/timeout|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT/i.test(err.message || '')) {
        return err;
    }
    err.message = err.message + ' -- trying ' + reaching();
    return err;
}

function query(text, params) {
    if (!pool) return Promise.reject(new Error('no database configured'));
    return pool.query(text, params).catch((err) => { throw withWhere(err); });
}
function connect() {
    if (!pool) return Promise.reject(new Error('no database configured'));
    return pool.connect().catch((err) => { throw withWhere(err); });
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

// open, but null where it could not be opened, so an empty value and a value
// nobody can read are told apart
function tryOpen(aad, blob) {
    if (!ENCRYPTED) return String(blob == null ? '' : blob);
    try {
        return decrypt(blob, aad);
    } catch (err) {
        return null;
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
    init, insert, recent, count, remove, purge, forget, startRetention, status,
    available: () => Boolean(pool),
    close: () => (pool ? pool.end() : Promise.resolve()),
    rotating: () => Boolean(DATA_KEY_PREVIOUS),
    query, connect, seal, open, tryOpen, openCurrent, blindIndex, indexHash, indexHashes, tokenHash, readKeys,
    indexKey: () => liveIndex,
    keys: () => ({ index: INDEX_KEY, previous: INDEX_KEY_PREVIOUS, token: TOKEN_KEY, live: liveIndex }),
    fingerprint,
    encrypted: () => ENCRYPTED,
};
