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

// a readable id for the url. the random tail is what makes it unique, so two
// companies of the same name never race for the same slug.
function slugFor(name, host) {
    const base = String(name || host || 'org')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32) || 'org';
    return base + '-' + crypto.randomBytes(3).toString('hex');
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
                    [label, hostOf(host), slugFor(label, host)]
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
        const res = await db.query(
            `SELECT o.*, m.role,
                    (SELECT count(*)::int FROM memberships m2 WHERE m2.org_id = o.id) AS members
               FROM memberships m
               JOIN organisations o ON o.id = m.org_id
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

function roleAtLeast(role, needed) {
    return (ROLE_RANK[role] || 0) >= (ROLE_RANK[needed] || 0);
}

module.exports = {
    ROLES, ROLE_KEYS, ROLE_RANK, NAME_MAX, ORGS_PER_USER,
    init, create, listFor, membership, bySlug, roleAtLeast,
    hostOf, nameFromHost, cleanName,
};
