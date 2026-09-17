'use strict';

const crypto = require('crypto');
const db = require('./db.js');

// A project is a narrower boundary than the organisation. The organisation is
// the company: the people in it and the bill it pays. A project is one thing
// that company screens for.
//
// A payments firm running an exchange and a card product has one compliance
// team, one contract and one invoice, but two sets of rules, two sets of keys
// and two audit trails it does not want mixed. That is the line this draws.
//
// What still sits on the organisation rather than here: checks and tokens. They
// key on org_id today, and moving them under a project is a migration, not a
// column. Until that is done a project is a place to keep, not a place to work.

const NAME_MAX = 60;
const PER_ORG = 20;

// short, because it goes in a url next to the organisation's own twenty
// characters and the pair should still be readable.
const SLUG_ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';
const SLUG_LENGTH = 12;
const SLUG_SHAPE = /^[a-z0-9]{12}$/;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
    id          bigserial   PRIMARY KEY,
    org_id      bigint      NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    name        text        NOT NULL DEFAULT '',
    slug        text        NOT NULL UNIQUE,
    archived_at timestamptz
);
CREATE INDEX IF NOT EXISTS projects_org_idx ON projects (org_id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at timestamptz;
`;

let ready = null;

function init() {
    if (!db.available()) return Promise.resolve(false);
    if (ready) return ready;
    ready = db.query(SCHEMA)
        .then(() => {
            console.log('[projects] tables ready');
            return true;
        })
        .catch((err) => {
            console.error('[projects] schema failed: ' + err.message);
            ready = null;
            return false;
        });
    return ready;
}

function cleanName(name) {
    return String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

function newSlug() {
    const bytes = crypto.randomBytes(SLUG_LENGTH * 2);
    let out = '';
    for (let i = 0; out.length < SLUG_LENGTH && i < bytes.length; i++) {
        // rejection sampling, so no character is likelier than another
        if (bytes[i] >= 256 - (256 % SLUG_ALPHABET.length)) continue;
        out += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
    }
    return out.length === SLUG_LENGTH ? out : newSlug();
}

function shape(row) {
    return {
        id: String(row.id),
        orgId: String(row.org_id),
        name: row.name || '',
        slug: row.slug,
        createdAt: row.created_at,
        archivedAt: row.archived_at || null,
        status: row.archived_at ? 'archived' : 'active',
    };
}

async function listFor(orgId) {
    if (!(await init())) return [];
    try {
        const res = await db.query(
            'SELECT * FROM projects WHERE org_id = $1 ORDER BY created_at',
            [Number(orgId)]
        );
        return res.rows.map(shape);
    } catch (err) {
        console.error('[projects] could not list: ' + err.message);
        return [];
    }
}

async function create(orgId, name) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const label = cleanName(name);
    if (!label) return { ok: false, reason: 'no-name' };
    try {
        const mine = await db.query(
            'SELECT count(*)::int AS n FROM projects WHERE org_id = $1', [Number(orgId)]);
        if (mine.rows[0] && mine.rows[0].n >= PER_ORG) return { ok: false, reason: 'too-many' };

        // the slug is random, so a clash is a collision and not a taken name.
        let row = null;
        for (let attempt = 0; attempt < 3 && !row; attempt++) {
            try {
                const res = await db.query(
                    'INSERT INTO projects (org_id, name, slug) VALUES ($1, $2, $3) RETURNING *',
                    [Number(orgId), label, newSlug()]
                );
                row = res.rows[0];
            } catch (err) {
                if (err.code !== '23505') throw err;
            }
        }
        if (!row) return { ok: false, reason: 'unavailable' };
        return { ok: true, project: shape(row) };
    } catch (err) {
        console.error('[projects] could not create: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }
}

// the org id is passed and matched, so a project id from another company does
// not resolve here however it was come by.
async function one(orgId, projectId) {
    if (!(await init())) return null;
    const n = Number(projectId);
    if (!Number.isSafeInteger(n) || n < 1) return null;
    try {
        const res = await db.query(
            'SELECT * FROM projects WHERE id = $1 AND org_id = $2', [n, Number(orgId)]);
        return res.rowCount ? shape(res.rows[0]) : null;
    } catch (err) {
        console.error('[projects] lookup failed: ' + err.message);
        return null;
    }
}

async function rename(orgId, projectId, name) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const label = cleanName(name);
    if (!label) return { ok: false, reason: 'no-name' };
    const found = await one(orgId, projectId);
    if (!found) return { ok: false, reason: 'missing' };
    try {
        await db.query('UPDATE projects SET name = $1 WHERE id = $2', [label, Number(projectId)]);
        return { ok: true, project: { ...found, name: label } };
    } catch (err) {
        console.error('[projects] could not rename: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }
}

// Archiving is the reversible version of removing. Most of the time what
// somebody wants is for a project to stop being in the way, not for it to stop
// existing, and those are different wishes that deserve different buttons.
async function archive(orgId, projectId, on) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const found = await one(orgId, projectId);
    if (!found) return { ok: false, reason: 'missing' };
    try {
        await db.query(
            'UPDATE projects SET archived_at = ' + (on ? 'now()' : 'NULL') + ' WHERE id = $1',
            [Number(projectId)]
        );
        return {
            ok: true,
            project: { ...found, archivedAt: on ? new Date().toISOString() : null,
                status: on ? 'archived' : 'active' },
        };
    } catch (err) {
        console.error('[projects] could not archive: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }
}

async function remove(orgId, projectId) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const found = await one(orgId, projectId);
    if (!found) return { ok: false, reason: 'missing' };
    try {
        await db.query('DELETE FROM projects WHERE id = $1', [Number(projectId)]);
        return { ok: true, project: found };
    } catch (err) {
        console.error('[projects] could not remove: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }
}

module.exports = {
    NAME_MAX, PER_ORG, SLUG_LENGTH, SLUG_SHAPE,
    init, listFor, create, one, rename, archive, remove, cleanName,
};
