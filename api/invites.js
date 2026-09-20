'use strict';

const crypto = require('crypto');
const db = require('./db.js');
const orgs = require('./orgs.js');

// An invitation to join an organisation.
//
// The link in the mail is a credential: whoever holds it can walk into a
// company's screenings and cases. So it is treated the way the api tokens are
// rather than the way a database row usually is.
//
//   - the secret is never stored. what is kept is a keyed hash of it, so a
//     stolen copy of this table cannot be used to accept anything.
//   - it expires, and the person who sent it chooses when. an invitation that
//     never expires is one somebody forgets they sent.
//   - it can be withdrawn before it is used.
//   - the address it was sent to is checked at acceptance, so forwarding the
//     mail to somebody else does not let them in.
//
// Two conditions the sender can attach, both of which exist because of what
// this product is for rather than because they were on somebody else's screen:
//
//   - a second step is required before joining, so nobody is holding a
//     compliance tool behind a password alone.
//   - only an address on the organisation's own domain may accept, which is how
//     you stop a colleague's personal address becoming a way in.

const ROLE_KEYS = orgs.ROLE_KEYS.filter((k) => k !== 'owner');
const PENDING_PER_ORG = 50;
const DAY_OPTIONS = [1, 3, 7, 14, 30];
const DEFAULT_DAYS = 7;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS invites (
    id          bigserial   PRIMARY KEY,
    org_id      bigint      NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    email_hash  text        NOT NULL,
    email_enc   text        NOT NULL,
    role        text        NOT NULL DEFAULT 'analyst',
    token_hash  text        NOT NULL UNIQUE,
    invited_by  bigint      REFERENCES users(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    accepted_at timestamptz,
    revoked_at  timestamptz,
    need_mfa    boolean     NOT NULL DEFAULT false,
    same_domain boolean     NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS invites_org_idx ON invites (org_id);
-- one live invitation per address per organisation. a second one is the same
-- request repeated, and two working links to the same place is one more than
-- anybody needs to keep track of.
CREATE UNIQUE INDEX IF NOT EXISTS invites_one_open
    ON invites (org_id, email_hash)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;
`;

let ready = null;

function init() {
    if (!db.available()) return Promise.resolve(false);
    if (ready) return ready;
    ready = db.query(SCHEMA)
        .then(() => {
            console.log('[invites] tables ready');
            return true;
        })
        .catch((err) => {
            console.error('[invites] schema failed: ' + err.message);
            ready = null;
            return false;
        });
    return ready;
}

// the same shape the api tokens use: enough bytes that guessing is not a plan
function newSecret() {
    return crypto.randomBytes(32).toString('base64url');
}

function hashSecret(secret) {
    return crypto.createHmac('sha256', db.indexKey() || Buffer.alloc(32))
        .update('invite:' + secret, 'utf8')
        .digest('hex');
}

function cleanEmail(value) {
    return String(value || '').trim().toLowerCase().slice(0, 160);
}

function looksLikeEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function domainOf(email) {
    return String(email || '').split('@').pop().toLowerCase();
}

function state(row) {
    if (row.accepted_at) return 'accepted';
    if (row.revoked_at) return 'withdrawn';
    if (new Date(row.expires_at).getTime() < Date.now()) return 'expired';
    return 'sent';
}

function shape(row) {
    return {
        id: String(row.id),
        email: db.open('invite:' + row.email_hash, row.email_enc) || '',
        role: row.role,
        createdAt: row.created_at,
        // the date rather than a countdown, so a copy of this row kept in a
        // browser for a week does not go on claiming six days are left
        expiresAt: row.expires_at,
        state: state(row),
        needMfa: Boolean(row.need_mfa),
        sameDomain: Boolean(row.same_domain),
    };
}

// Everything sent for one organisation, newest first, with what became of it.
async function listFor(orgId) {
    if (!(await init())) return [];
    try {
        const res = await db.query(
            `SELECT * FROM invites
              WHERE org_id = $1 AND accepted_at IS NULL
           ORDER BY created_at DESC LIMIT 100`,
            [Number(orgId)]
        );
        return res.rows.map(shape);
    } catch (err) {
        console.error('[invites] could not list: ' + err.message);
        return [];
    }
}

// Send one. Returns the secret exactly once, to be put in a link and then
// forgotten: it is not stored and cannot be read back.
async function create(orgId, byUserId, { email, role, days, needMfa, sameDomain, domain }) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };

    const to = cleanEmail(email);
    if (!looksLikeEmail(to)) return { ok: false, reason: 'bad-email' };
    if (ROLE_KEYS.indexOf(role) === -1) return { ok: false, reason: 'bad-role' };

    const keep = DAY_OPTIONS.indexOf(Number(days)) === -1 ? DEFAULT_DAYS : Number(days);
    if (sameDomain && domain && domainOf(to) !== String(domain).toLowerCase()) {
        return { ok: false, reason: 'wrong-domain' };
    }

    const hash = db.blindIndex(to);
    if (!hash) return { ok: false, reason: 'unavailable' };

    try {
        // somebody already inside does not need letting in
        const already = await db.query(
            `SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
              WHERE m.org_id = $1 AND u.email_hash = $2`,
            [Number(orgId), hash]
        );
        if (already.rowCount) return { ok: false, reason: 'already-in' };

        const open = await db.query(
            `SELECT count(*)::int AS n FROM invites
              WHERE org_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
                AND expires_at > now()`,
            [Number(orgId)]
        );
        if (open.rows[0] && open.rows[0].n >= PENDING_PER_ORG) {
            return { ok: false, reason: 'too-many' };
        }

        const secret = newSecret();
        const res = await db.query(
            `INSERT INTO invites
                (org_id, email_hash, email_enc, role, token_hash, invited_by,
                 expires_at, need_mfa, same_domain)
             VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 || ' days')::interval, $8, $9)
             ON CONFLICT (org_id, email_hash) WHERE accepted_at IS NULL AND revoked_at IS NULL
             DO UPDATE SET
                role = EXCLUDED.role,
                token_hash = EXCLUDED.token_hash,
                invited_by = EXCLUDED.invited_by,
                created_at = now(),
                expires_at = EXCLUDED.expires_at,
                need_mfa = EXCLUDED.need_mfa,
                same_domain = EXCLUDED.same_domain
             RETURNING *`,
            [Number(orgId), hash, db.seal('invite:' + hash, to), role, hashSecret(secret),
             Number(byUserId), String(keep), Boolean(needMfa), Boolean(sameDomain)]
        );
        return { ok: true, invite: shape(res.rows[0]), secret };
    } catch (err) {
        console.error('[invites] could not create: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }
}

async function revoke(orgId, inviteId) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    try {
        const res = await db.query(
            `UPDATE invites SET revoked_at = now()
              WHERE id = $1 AND org_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL
          RETURNING *`,
            [Number(inviteId), Number(orgId)]
        );
        if (!res.rowCount) return { ok: false, reason: 'missing' };
        return { ok: true, invite: shape(res.rows[0]) };
    } catch (err) {
        console.error('[invites] could not withdraw: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }
}

// What a link is worth, without spending it. Used to show somebody what they
// are about to join before they decide.
async function read(secret) {
    if (!(await init())) return null;
    const hash = hashSecret(String(secret || ''));
    try {
        const res = await db.query(
            `SELECT i.*, o.name AS org_name, o.slug AS org_slug
               FROM invites i JOIN organisations o ON o.id = i.org_id
              WHERE i.token_hash = $1`,
            [hash]
        );
        if (!res.rowCount) return null;
        const row = res.rows[0];
        return {
            ...shape(row),
            orgId: String(row.org_id),
            orgName: row.org_name || '',
            orgSlug: row.org_slug,
        };
    } catch (err) {
        console.error('[invites] could not read: ' + err.message);
        return null;
    }
}

// Spend it. Every condition is checked here rather than at the screen, because
// the screen is not what somebody with the link has to get past.
async function accept(secret, me) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const found = await read(secret);
    if (!found) return { ok: false, reason: 'missing' };
    if (found.state !== 'sent') return { ok: false, reason: found.state };

    // the invitation was addressed to somebody. forwarding the mail does not
    // change who that was.
    if (cleanEmail(me.email) !== cleanEmail(found.email)) {
        return { ok: false, reason: 'not-yours' };
    }
    if (found.needMfa && !me.totpOn) return { ok: false, reason: 'need-mfa' };

    try {
        await db.query(
            `INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, $3)
             ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
            [Number(found.orgId), Number(me.userId), found.role]
        );
        await db.query('UPDATE invites SET accepted_at = now() WHERE id = $1', [Number(found.id)]);
        return { ok: true, invite: found };
    } catch (err) {
        console.error('[invites] could not accept: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }
}

module.exports = {
    init, listFor, create, revoke, read, accept,
    ROLE_KEYS, DAY_OPTIONS, DEFAULT_DAYS, PENDING_PER_ORG,
    cleanEmail, looksLikeEmail, domainOf,
};
