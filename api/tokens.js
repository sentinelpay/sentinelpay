'use strict';

const crypto = require('crypto');
const db = require('./db.js');

// what a token can be allowed to do. only endpoints we actually serve are on
// this list: a scope that grants nothing real is a promise we have not kept.
const SCOPES = [
    { key: 'screenings:write', label: 'Run screenings' },
    { key: 'screenings:read', label: 'Read screenings' },
];
const SCOPE_KEYS = SCOPES.map((s) => s.key);

const PREFIX = 'sp_live_';
const NAME_MAX = 60;
const PER_USER = 25;
const TTL_CHOICES = [30, 90, 180, 365, 0];
const TOUCH_AFTER_MS = 5 * 60 * 1000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS api_tokens (
    id           bigserial   PRIMARY KEY,
    user_id      bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    name         text        NOT NULL DEFAULT '',
    secret_hash  text        NOT NULL,
    tail         text        NOT NULL DEFAULT '',
    scopes       text        NOT NULL DEFAULT '',
    expires_at   timestamptz,
    last_used_at timestamptz,
    revoked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS api_tokens_user_idx ON api_tokens (user_id, created_at DESC);
`;

let ready = null;

function init() {
    if (!db.available()) return Promise.resolve(false);
    if (ready) return ready;
    ready = db.query(SCHEMA)
        .then(() => {
            console.log('[tokens] table ready');
            return true;
        })
        .catch((err) => {
            console.error('[tokens] schema failed: ' + err.message);
            ready = null;
            return false;
        });
    return ready;
}

// the secret carries 256 bits from the random source, so a keyed hash is enough
// to store it. scrypt guards passwords because people choose those; nobody
// chooses this one, and every api call would have to pay for it.
function hashSecret(secret) {
    return crypto.createHmac('sha256', db.indexKey() || Buffer.alloc(32))
        .update('api-token:' + secret, 'utf8')
        .digest('hex');
}

function sameHash(a, b) {
    const x = Buffer.from(String(a || ''), 'utf8');
    const y = Buffer.from(String(b || ''), 'utf8');
    if (x.length !== y.length) return false;
    return crypto.timingSafeEqual(x, y);
}

function cleanScopes(list) {
    const want = Array.isArray(list) ? list : [];
    const kept = SCOPE_KEYS.filter((k) => want.indexOf(k) !== -1);
    return kept;
}

function cleanName(name) {
    return String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

// the token reads sp_live_<id>_<secret>. the id is in the clear on purpose: it
// turns verification into one indexed lookup instead of a scan over every row.
function splitToken(raw) {
    const s = String(raw || '').trim();
    if (s.slice(0, PREFIX.length) !== PREFIX) return null;
    const rest = s.slice(PREFIX.length);
    const cut = rest.indexOf('_');
    if (cut < 1) return null;
    const id = rest.slice(0, cut);
    const secret = rest.slice(cut + 1);
    if (!/^[0-9a-z]+$/.test(id) || secret.length < 20) return null;
    const asNumber = parseInt(id, 36);
    if (!Number.isSafeInteger(asNumber) || asNumber < 1) return null;
    return { id: asNumber, secret: secret };
}

function shape(row) {
    const scopes = row.scopes ? row.scopes.split(' ').filter(Boolean) : [];
    return {
        id: String(row.id),
        name: row.name || '',
        tail: row.tail || '',
        scopes: scopes,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
    };
}

async function mint(userId, name, scopes, days) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };

    const keep = cleanScopes(scopes);
    if (!keep.length) return { ok: false, reason: 'no-scopes' };
    const label = cleanName(name);
    if (!label) return { ok: false, reason: 'no-name' };

    const ttl = TTL_CHOICES.indexOf(Number(days)) === -1 ? 90 : Number(days);

    try {
        const live = await db.query(
            'SELECT count(*)::int AS n FROM api_tokens WHERE user_id = $1 AND revoked_at IS NULL',
            [userId]
        );
        if (live.rows[0] && live.rows[0].n >= PER_USER) {
            return { ok: false, reason: 'too-many' };
        }

        const secret = crypto.randomBytes(32).toString('base64url');
        const res = await db.query(
            `INSERT INTO api_tokens (user_id, name, secret_hash, tail, scopes, expires_at)
             VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 = 0 THEN NULL
                                              ELSE now() + ($6 || ' days')::interval END)
             RETURNING *`,
            [userId, label, hashSecret(secret), secret.slice(-4), keep.join(' '), ttl]
        );
        const row = res.rows[0];
        const id = Number(row.id).toString(36);
        return { ok: true, token: PREFIX + id + '_' + secret, row: shape(row) };
    } catch (err) {
        console.error('[tokens] could not mint: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }
}

async function list(userId) {
    if (!(await init())) return [];
    try {
        const res = await db.query(
            `SELECT * FROM api_tokens
             WHERE user_id = $1 AND (revoked_at IS NULL OR revoked_at > now() - interval '7 days')
             ORDER BY revoked_at IS NOT NULL, created_at DESC`,
            [userId]
        );
        return res.rows.map(shape);
    } catch (err) {
        console.error('[tokens] could not list: ' + err.message);
        return [];
    }
}

async function revoke(userId, id) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const n = Number(id);
    if (!Number.isSafeInteger(n) || n < 1) return { ok: false, reason: 'missing' };
    try {
        const res = await db.query(
            `UPDATE api_tokens SET revoked_at = now()
             WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
             RETURNING id`,
            [n, userId]
        );
        if (!res.rowCount) return { ok: false, reason: 'missing' };
        return { ok: true };
    } catch (err) {
        console.error('[tokens] could not revoke: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }
}

// resolves a bearer token to its owner. returns the reason it failed so the
// caller can say something useful, but never says which part was wrong to
// anyone holding a token that is simply not ours.
async function read(raw) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const parts = splitToken(raw);
    if (!parts) return { ok: false, reason: 'bad' };
    try {
        const res = await db.query('SELECT * FROM api_tokens WHERE id = $1', [parts.id]);
        if (!res.rowCount) return { ok: false, reason: 'bad' };
        const row = res.rows[0];
        if (!sameHash(row.secret_hash, hashSecret(parts.secret))) return { ok: false, reason: 'bad' };
        if (row.revoked_at) return { ok: false, reason: 'revoked' };
        if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
            return { ok: false, reason: 'expired' };
        }

        const seen = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
        if (Date.now() - seen > TOUCH_AFTER_MS) {
            db.query('UPDATE api_tokens SET last_used_at = now() WHERE id = $1', [row.id])
                .catch(() => {  });
        }
        return {
            ok: true,
            userId: row.user_id,
            tokenId: String(row.id),
            name: row.name || '',
            scopes: row.scopes ? row.scopes.split(' ').filter(Boolean) : [],
        };
    } catch (err) {
        console.error('[tokens] could not read: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }
}

module.exports = {
    SCOPES, SCOPE_KEYS, TTL_CHOICES, PER_USER, NAME_MAX, PREFIX,
    mint, list, revoke, read, splitToken, init,
};
