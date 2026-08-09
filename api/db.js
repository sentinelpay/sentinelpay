'use strict';

// The one place that talks to postgres.
//
// Everything the forms collect is personal data belonging to someone who has
// not become a customer yet, so this file is written defensively:
//
//   - the connection refuses to run in the clear over a public network
//   - every value reaches the database as a bound parameter, never as text
//   - the personal fields are encrypted before they leave this process, so a
//     copy of the database on its own is not a copy of the leads
//   - lookups still work through a blind index, which is a keyed hash rather
//     than the address itself
//   - rows delete themselves once the retention window is up
//
// Without DATABASE_URL the module reports itself as unavailable and the caller
// falls back to the append-only file. That is deliberate: a database that is
// missing or down must never cost us a lead.

const crypto = require('crypto');
const { Pool } = require('pg');

const URL_RAW = process.env.DATABASE_URL || '';

// ---------------------------------------------------------------------------
// transport
// ---------------------------------------------------------------------------

// Railway hands services a private address that never leaves its network. Any
// other host is on the public internet as far as we are concerned, and gets no
// choice about tls. sslmode=disable in the url is refused rather than honoured:
// a connection string is exactly the kind of thing that gets pasted from an
// older environment and quietly downgrades everything.
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

    // A managed provider's certificate chain is not always in the system store.
    // Give it the CA when one is provided and verify properly; without one, still
    // encrypt, because an encrypted connection without chain verification is a
    // long way better than plaintext.
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
            // A form insert is a handful of milliseconds. Anything still running
            // after ten seconds is a fault, and holding the connection open makes
            // it everyone's fault.
            statement_timeout: 10000,
            query_timeout: 10000,
            application_name: 'sentinelpay-web',
        });
        // A pool error is an idle client dropped by the server, which is normal
        // and must not take the process down.
        pool.on('error', (err) => {
            console.error('[db] idle client error: ' + err.message);
        });
    } catch (err) {
        poolError = err.message;
        console.error('[db] not connecting: ' + err.message);
    }
}

// ---------------------------------------------------------------------------
// encryption
// ---------------------------------------------------------------------------
//
// AES-256-GCM per row, with a random 12-byte nonce and the row's own id as
// additional authenticated data, so a ciphertext cannot be moved from one row
// to another without the decrypt failing.
//
// SUBMISSIONS_KEY is 32 bytes, base64. Generate one with:
//     node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
//
// Losing the key loses the data, which is the point of it existing.

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
// A separate key for the blind index. Sharing one key between encryption and
// the lookup hash would let anyone holding the index confirm guesses against
// the ciphertext.
const INDEX_KEY = readKey('SUBMISSIONS_INDEX_KEY') || (DATA_KEY
    ? crypto.createHmac('sha256', DATA_KEY).update('blind-index-v1').digest()
    : null);

function encrypt(plain, aad) {
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', DATA_KEY, nonce, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    // v1 | nonce | tag | ciphertext, so the format can change later without guessing
    return Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), body]).toString('base64');
}

function decrypt(blob, aad) {
    const buf = Buffer.from(blob, 'base64');
    if (buf.length < 29 || buf[0] !== 1) throw new Error('unrecognised ciphertext');
    const nonce = buf.subarray(1, 13);
    const tag = buf.subarray(13, 29);
    const decipher = crypto.createDecipheriv('aes-256-gcm', DATA_KEY, nonce, { authTagLength: 16 });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(buf.subarray(29)), decipher.final()]).toString('utf8');
}

// Keyed hash of the lowercased address. Lets us count how often someone has
// applied, or find their rows on request, without the address being in the
// table in a form anyone can read.
function blindIndex(email) {
    if (!INDEX_KEY || !email) return null;
    return crypto.createHmac('sha256', INDEX_KEY)
        .update(String(email).trim().toLowerCase(), 'utf8')
        .digest('hex');
}

const ENCRYPTED = Boolean(DATA_KEY);

// ---------------------------------------------------------------------------
// schema
// ---------------------------------------------------------------------------
//
// Created on boot and safe to run every time. The personal fields live in one
// encrypted blob rather than a column each: a column per field leaks its shape
// through the lengths, and every one of them would need the same treatment
// anyway. What stays in the clear is only what we need to query on.

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
            ready = null; // let the next write try again rather than staying broken
            return false;
        });
    return ready;
}

// ---------------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------------

// Everything the caller passes goes in the encrypted blob except the few fields
// worth querying on. Those are kept deliberately coarse: a country and a
// language identify nobody on their own.
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
    };

    // The id is part of the authenticated data, so the row has to exist before
    // the blob can be sealed to it. Insert, then seal, in one transaction: a
    // half-written row is worse than no row.
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const res = await client.query(
            `INSERT INTO submissions (kind, outcome, country, lang, email_hash, payload, encrypted)
             VALUES ($1, $2, $3, $4, $5, '', $6) RETURNING id`,
            [row.kind, row.outcome, row.country, row.lang, row.emailHash, ENCRYPTED]
        );
        const id = res.rows[0].id;
        const sealed = ENCRYPTED ? encrypt(payload, 'submission:' + id) : payload;
        await client.query('UPDATE submissions SET payload = $1 WHERE id = $2', [sealed, id]);
        await client.query('COMMIT');
        return true;
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (rbErr) { /* connection already gone */ }
        console.error('[db] insert failed: ' + err.message);
        return false;
    } finally {
        client.release();
    }
}

// ---------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------

async function recent(limit, kind) {
    if (!pool) return null;
    if (!(await init())) return null;

    const max = Math.min(Math.max(Number(limit) || 50, 1), 500);
    const params = [max];
    let where = '';
    if (kind) {
        where = 'WHERE kind = $2';
        params.push(String(kind).slice(0, 32));
    }
    const res = await pool.query(
        `SELECT id, received_at, kind, outcome, country, lang, payload, encrypted
         FROM submissions ${where} ORDER BY received_at DESC, id DESC LIMIT $1`,
        params
    );

    return res.rows.map((r) => {
        let fields;
        try {
            fields = JSON.parse(r.encrypted ? decrypt(r.payload, 'submission:' + r.id) : r.payload);
        } catch (err) {
            // A row we cannot read is reported as such rather than dropped: a
            // rotated key should be visible, not silently thin out the results.
            fields = { unreadable: err.message };
        }
        return Object.assign({
            id: String(r.id),
            ts: r.received_at.toISOString(),
            kind: r.kind,
            outcome: r.outcome,
        }, fields);
    });
}

// ---------------------------------------------------------------------------
// retention
// ---------------------------------------------------------------------------
//
// A lead nobody has acted on in a year is not a lead, it is a liability. The
// window is a plain number of days so the privacy policy can quote it.

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

// Once at boot, then daily. unref so it never holds the process open.
function startRetention() {
    if (!pool) return;
    setTimeout(() => { purge(); }, 30000).unref();
    setInterval(() => { purge(); }, 24 * 60 * 60 * 1000).unref();
}

// Erasure requests: find and remove by address without ever storing it.
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

module.exports = { insert, recent, purge, forget, startRetention, status, available: () => Boolean(pool) };
