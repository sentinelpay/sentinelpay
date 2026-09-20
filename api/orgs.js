'use strict';

const crypto = require('crypto');
const db = require('./db.js');

// An organisation is the company, not the person. Everything a compliance team
// does is shared work: one colleague screens an address, another clears the
// alert it raised, a third signs the report. Hanging that off a user id means
// none of them can see each other's work, so it hangs off here instead.
//
// A person is attributed individually all the same. The audit log keeps the user
// id of whoever acted, because a regulator asks who approved something, not
// which account it happened under.

// Roles, widest first. They exist for segregation of duties: the person who runs
// a check should not always be the person who can change what counts as a hit.
const ROLES = [
    {
        key: 'owner',
        label: 'Owner',
        hint: 'Everything, including billing and closing the organisation.',
        rank: 4,
    },
    {
        key: 'admin',
        label: 'Admin',
        hint: 'Members, tokens and policy. Not billing.',
        rank: 3,
    },
    {
        key: 'analyst',
        label: 'Analyst',
        hint: 'Screens, works alerts and cases. Cannot change policy or members.',
        rank: 2,
    },
    {
        key: 'viewer',
        label: 'Viewer',
        hint: 'Reads the work and pulls evidence. Changes nothing.',
        rank: 1,
    },
];
const ROLE_KEYS = ROLES.map((r) => r.key);
const ROLE_RANK = {};
ROLES.forEach((r) => { ROLE_RANK[r.key] = r.rank; });

const NAME_MAX = 80;
const ORGS_PER_USER = 20;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS organisations (
    id          bigserial   PRIMARY KEY,
    created_at  timestamptz NOT NULL DEFAULT now(),
    name        text        NOT NULL DEFAULT '',
    host        text        NOT NULL DEFAULT '',
    slug        text        NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS organisations_host_idx ON organisations (host) WHERE host <> '';

CREATE TABLE IF NOT EXISTS memberships (
    org_id      bigint      NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    user_id     bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        text        NOT NULL DEFAULT 'analyst',
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships (user_id);
`;

let ready = null;

function init() {
    if (!db.available()) return Promise.resolve(false);
    if (ready) return ready;
    ready = db.query(SCHEMA)
        .then(() => {
            console.log('[orgs] tables ready');
            return true;
        })
        .catch((err) => {
            console.error('[orgs] schema failed: ' + err.message);
            ready = null;
            return false;
        });
    return ready;
}

function cleanName(name) {
    return String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

function hostOf(value) {
    return String(value || '')
        .trim()
        .replace(/^https?:\/\//i, '')
        .replace(/\/.*$/, '')
        .replace(/^www\./i, '')
        .toLowerCase();
}

// The id an organisation carries in the url. Twenty characters drawn at random
// rather than made from the name, for two reasons: the name is not ours to put
// in a link somebody may paste anywhere, and a name cannot collide with another
// company's if it is never used. Twenty characters of this alphabet is about a
// hundred bits, so a clash is not something that happens; the unique constraint
// behind it is there because "not something that happens" is not a guarantee.
const SLUG_ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';
const SLUG_LENGTH = 20;
const SLUG_SHAPE = /^[a-z0-9]{20}$/;

function newSlug() {
    const bytes = crypto.randomBytes(SLUG_LENGTH * 2);
    let out = '';
    for (let i = 0; out.length < SLUG_LENGTH && i < bytes.length; i++) {
        // rejection sampling, so every character is as likely as every other
        if (bytes[i] >= 256 - (256 % SLUG_ALPHABET.length)) continue;
        out += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
    }
    return out.length === SLUG_LENGTH ? out : newSlug();
}

// the name we would give a company we have only ever seen the domain of.
function nameFromHost(host) {
    const bare = hostOf(host).split('.')[0] || '';
    if (!bare) return '';
    return bare.charAt(0).toUpperCase() + bare.slice(1);
}

function shape(row) {
    return {
        id: String(row.id),
        name: row.name || '',
        host: row.host || '',
        slug: row.slug,
        createdAt: row.created_at,
        role: row.role || '',
        members: row.members === undefined ? undefined : Number(row.members),
        plan: row.plan_state === undefined ? undefined : planOf(row),
    };
}

// What the list says about an organisation's plan.
//
// The date it ends, not the days remaining. A countdown is only true at the
// moment it is computed, and this row is cached in the browser for a week, so
// sending a number would mean a plan that ended on tuesday still reading "nine
// days left" on the following monday. The date stays true, and whoever draws it
// works out the rest.
function planOf(row) {
    return {
        state: row.plan_state || 'none',
        endsAt: row.plan_expires || null,
    };
}

async function create(userId, name, host, role) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const label = cleanName(name);
    if (!label) return { ok: false, reason: 'no-name' };
    const keepRole = ROLE_KEYS.indexOf(role) === -1 ? 'owner' : role;

    try {
        const mine = await db.query(
            'SELECT count(*)::int AS n FROM memberships WHERE user_id = $1', [userId]);
        if (mine.rows[0] && mine.rows[0].n >= ORGS_PER_USER) {
            return { ok: false, reason: 'too-many' };
        }

        // the slug carries random bytes, so a clash is a collision rather than a
        // name someone else took. trying again is the right answer to it.
        let row = null;
        for (let attempt = 0; attempt < 3 && !row; attempt++) {
            try {
                const res = await db.query(
                    `INSERT INTO organisations (name, host, slug) VALUES ($1, $2, $3) RETURNING *`,
                    [label, hostOf(host), newSlug()]
                );
                row = res.rows[0];
            } catch (err) {
                if (err.code !== '23505') throw err;
            }
        }
        if (!row) return { ok: false, reason: 'unavailable' };

        await db.query(
            'INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, $3)',
            [row.id, userId, keepRole]
        );
        return { ok: true, org: shape({ ...row, role: keepRole, members: 1 }) };
    } catch (err) {
        console.error('[orgs] could not create: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }
}

async function listFor(userId) {
    if (!(await init())) return [];
    try {
        // the plan comes along, because the list is where somebody decides
        // which organisation to walk into and a company with no plan cannot be
        // worked in. left joined: an organisation without one is not an error.
        const res = await db.query(
            `SELECT o.*, m.role,
                    (SELECT count(*)::int FROM memberships m2 WHERE m2.org_id = o.id) AS members,
                    t.state AS plan_state,
                    t.expires_at AS plan_expires
               FROM memberships m
               JOIN organisations o ON o.id = m.org_id
          LEFT JOIN trials t ON t.org_id = o.id
              WHERE m.user_id = $1
           ORDER BY o.created_at`,
            [userId]
        );
        return res.rows.map(shape);
    } catch (err) {
        console.error('[orgs] could not list: ' + err.message);
        return [];
    }
}

// the membership row, or null. every request that touches org data goes through
// this: it is what stops one company reading another's work.
async function membership(userId, orgId) {
    if (!(await init())) return null;
    const n = Number(orgId);
    if (!Number.isSafeInteger(n) || n < 1) return null;
    try {
        const res = await db.query(
            `SELECT o.*, m.role,
                    (SELECT count(*)::int FROM memberships m2 WHERE m2.org_id = o.id) AS members
               FROM memberships m
               JOIN organisations o ON o.id = m.org_id
              WHERE m.user_id = $1 AND m.org_id = $2`,
            [userId, n]
        );
        if (!res.rowCount) return null;
        return shape(res.rows[0]);
    } catch (err) {
        console.error('[orgs] membership lookup failed: ' + err.message);
        return null;
    }
}

async function bySlug(userId, slug) {
    if (!(await init())) return null;
    try {
        const res = await db.query(
            `SELECT o.*, m.role,
                    (SELECT count(*)::int FROM memberships m2 WHERE m2.org_id = o.id) AS members
               FROM memberships m
               JOIN organisations o ON o.id = m.org_id
              WHERE m.user_id = $1 AND o.slug = $2`,
            [userId, String(slug || '').slice(0, 64)]
        );
        if (!res.rowCount) return null;
        return shape(res.rows[0]);
    } catch (err) {
        console.error('[orgs] slug lookup failed: ' + err.message);
        return null;
    }
}

// Everyone in the organisation, for the team screen. The membership check runs
// first: this hands out colleagues' names and addresses, so it answers only to
// somebody already inside.
//
// Names and addresses are encrypted per row and keyed by the email hash. The
// prefixes belong to accounts.js, which is the only other place that knows
// them; they are repeated here rather than exported because a third caller
// should have to think about why it wants them.
async function members(userId, orgId) {
    if (!(await init())) return null;
    const mine = await membership(userId, orgId);
    if (!mine) return null;
    try {
        const res = await db.query(
            `SELECT u.id, u.email_hash, u.email_enc, u.name_enc, u.totp_at,
                    m.role, m.created_at
               FROM memberships m
               JOIN users u ON u.id = m.user_id
              WHERE m.org_id = $1
           ORDER BY m.created_at`,
            [Number(orgId)]
        );
        return res.rows.map((row) => ({
            id: String(row.id),
            name: db.open('signup-name:' + row.email_hash, row.name_enc) || '',
            email: db.open('signup-email:' + row.email_hash, row.email_enc) || '',
            role: row.role,
            joinedAt: row.created_at,
            // whether this person has a second step on their own account. a team
            // that clears sanctions alerts should be able to see at a glance who
            // among them is protected by a password alone.
            mfa: Boolean(row.totp_at),
            you: String(row.id) === String(userId),
        }));
    } catch (err) {
        console.error('[orgs] could not list members: ' + err.message);
        return null;
    }
}

// Renaming is an admin's job, not an owner's alone: it is a label, and the
// people who run the place have to be able to fix a typo in it.
async function rename(userId, orgId, name) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const label = cleanName(name);
    if (!label) return { ok: false, reason: 'no-name' };
    const mine = await membership(userId, orgId);
    if (!mine) return { ok: false, reason: 'missing' };
    if (!roleAtLeast(mine.role, 'admin')) return { ok: false, reason: 'not-allowed' };
    try {
        await db.query('UPDATE organisations SET name = $1 WHERE id = $2', [label, Number(orgId)]);
        return { ok: true, org: { ...mine, name: label } };
    } catch (err) {
        console.error('[orgs] could not rename: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }
}

function roleAtLeast(role, needed) {
    return (ROLE_RANK[role] || 0) >= (ROLE_RANK[needed] || 0);
}

// Changing what somebody may do here.
//
// The rules are about who is left holding the place rather than about rank:
// an owner is not demoted by an admin, because that is how an organisation
// ends up with nobody who can close it or pay for it, and nobody sets their own
// role, because a permission you can hand yourself is not a permission.
async function setRole(actorId, orgId, userId, role) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    if (ROLE_KEYS.indexOf(role) === -1) return { ok: false, reason: 'bad-role' };

    const mine = await membership(actorId, orgId);
    if (!mine) return { ok: false, reason: 'missing' };
    if (!roleAtLeast(mine.role, 'admin')) return { ok: false, reason: 'not-allowed' };
    if (String(actorId) === String(userId)) return { ok: false, reason: 'not-yourself' };

    const theirs = await membership(userId, orgId);
    if (!theirs) return { ok: false, reason: 'not-a-member' };
    if (theirs.role === 'owner') return { ok: false, reason: 'not-the-owner' };
    if (role === 'owner') return { ok: false, reason: 'one-owner' };

    try {
        await db.query('UPDATE memberships SET role = $1 WHERE org_id = $2 AND user_id = $3',
            [role, Number(orgId), Number(userId)]);
        return { ok: true, role };
    } catch (err) {
        console.error('[orgs] could not change a role: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }
}

// Taking somebody out, and walking out yourself: the same row is removed, so it
// is the same function, and the difference is only in what is allowed.
async function removeMember(actorId, orgId, userId) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const mine = await membership(actorId, orgId);
    if (!mine) return { ok: false, reason: 'missing' };

    const leaving = String(actorId) === String(userId);
    if (!leaving && !roleAtLeast(mine.role, 'admin')) return { ok: false, reason: 'not-allowed' };

    const theirs = leaving ? mine : await membership(userId, orgId);
    if (!theirs) return { ok: false, reason: 'not-a-member' };
    // the owner stays until the organisation is closed or handed on, whether
    // they are being removed or are trying to walk out of their own company
    if (theirs.role === 'owner') return { ok: false, reason: 'not-the-owner' };

    try {
        await db.query('DELETE FROM memberships WHERE org_id = $1 AND user_id = $2',
            [Number(orgId), Number(userId)]);
        return { ok: true, left: leaving };
    } catch (err) {
        console.error('[orgs] could not remove a member: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }
}

// Closing an organisation. Only an owner may, and the cascade takes its tokens
// and its checks with it, which is why the caller is made to say the name back
// before this is reached.
async function remove(userId, orgId) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const mine = await membership(userId, orgId);
    if (!mine) return { ok: false, reason: 'missing' };
    if (mine.role !== 'owner') return { ok: false, reason: 'not-owner' };
    try {
        await db.query('DELETE FROM organisations WHERE id = $1', [Number(orgId)]);
        return { ok: true, org: mine };
    } catch (err) {
        console.error('[orgs] could not remove: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }
}

// what goes with it, so the confirmation can say rather than imply.
async function weightOf(orgId) {
    if (!(await init())) return { tokens: 0, checks: 0, members: 0 };
    try {
        const res = await db.query(`
            SELECT (SELECT count(*)::int FROM api_tokens WHERE org_id = $1 AND revoked_at IS NULL) AS tokens,
                   (SELECT count(*)::int FROM screenings WHERE org_id = $1) AS checks,
                   (SELECT count(*)::int FROM memberships WHERE org_id = $1) AS members
        `, [Number(orgId)]);
        const r = res.rows[0];
        return { tokens: r.tokens, checks: r.checks, members: r.members };
    } catch (err) {
        return { tokens: 0, checks: 0, members: 0 };
    }
}

// Slugs made before the twenty character format existed are replaced, once. No
// link to one has been shared, so nothing breaks, and leaving two shapes in the
// same column would mean neither is the rule.
async function reslug() {
    if (!(await init())) return 0;
    try {
        const old = await db.query('SELECT id, slug FROM organisations');
        let done = 0;
        for (const row of old.rows) {
            if (SLUG_SHAPE.test(row.slug || '')) continue;
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    await db.query('UPDATE organisations SET slug = $1 WHERE id = $2', [newSlug(), row.id]);
                    done++;
                    break;
                } catch (err) {
                    if (err.code !== '23505') throw err;
                }
            }
        }
        if (done) console.log('[orgs] gave ' + done + ' organisation(s) the new slug shape');
        return done;
    } catch (err) {
        console.error('[orgs] reslug failed: ' + err.message);
        return 0;
    }
}

module.exports = {
    ROLES, ROLE_KEYS, ROLE_RANK, NAME_MAX, ORGS_PER_USER,
    init, create, listFor, membership, bySlug, roleAtLeast, remove, weightOf, reslug,
    members, rename, setRole, removeMember,
    SLUG_LENGTH, SLUG_SHAPE,
    hostOf, nameFromHost, cleanName,
};
