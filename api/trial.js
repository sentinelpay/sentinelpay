'use strict';

const crypto = require('crypto');
const db = require('./db.js');

const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 14);

const QUOTA = {
    starter: { liveChecks: 1, historyScans: 1, historyOpen: false },
    verified: { liveChecks: 10, historyScans: 0, historyOpen: true },
    enterprise: { liveChecks: 1000000, historyScans: 0, historyOpen: true },
};

const IS_STAGING = String(process.env.APP_ENV || '').toLowerCase() === 'staging';
const DEV_PLAN_EMAILS = new Set(
    String(process.env.DEV_PLAN_EMAILS || '')
        .split(',')
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean)
);
const DEV_PLAN_ON = IS_STAGING && DEV_PLAN_EMAILS.size > 0;

if (DEV_PLAN_EMAILS.size && !IS_STAGING) {
    console.error('[trial] DEV_PLAN_EMAILS is set but APP_ENV is not staging. Refusing to grant anything.');
}
if (DEV_PLAN_ON) {
    console.warn('[trial] staging dev grant active for ' + DEV_PLAN_EMAILS.size + ' address(es)');
}

// The plan belongs to the organisation, not to the person. The organisation is
// the company: it holds the contract, the invoice and the people, and a company
// cannot have a different allowance depending on which colleague signed in.
//
// user_id stays on the row as who started it, which is an attribution and not a
// key. org_id is what everything reads by, and it is unique, so one organisation
// has one plan.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS trials (
    user_id        bigint      PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    state          text        NOT NULL DEFAULT 'none',
    company_host   text        NOT NULL DEFAULT '',
    company_enc    text        NOT NULL DEFAULT '',
    live_used      integer     NOT NULL DEFAULT 0,
    history_used   integer     NOT NULL DEFAULT 0,
    phone_hash     text,
    phone_enc      text        NOT NULL DEFAULT '',
    requested_at   timestamptz,
    started_at     timestamptz,
    expires_at     timestamptz,
    verified_at    timestamptz,
    note           text        NOT NULL DEFAULT '',
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS trials_one_per_company
    ON trials (company_host)
    WHERE company_host <> '' AND state IN ('pending', 'starter', 'verified');
ALTER TABLE trials ADD COLUMN IF NOT EXISTS org_id bigint
    REFERENCES organisations(id) ON DELETE CASCADE;
-- Plain rather than partial. A partial unique index cannot be inferred by
-- ON CONFLICT (org_id) without repeating its predicate at every insert, and it
-- buys nothing here: postgres already treats nulls as distinct, so rows not yet
-- attached to an organisation do not collide with each other.
DROP INDEX IF EXISTS trials_one_per_org;
CREATE UNIQUE INDEX IF NOT EXISTS trials_org_uniq ON trials (org_id);
-- the old key said one plan per person, which is what this is moving away
-- from: one person can own two companies and each pays for itself.
ALTER TABLE trials DROP CONSTRAINT IF EXISTS trials_pkey;
CREATE INDEX IF NOT EXISTS trials_user_idx ON trials (user_id);
`;

let ready = null;

function init() {
    if (!db.available()) return Promise.resolve(false);
    if (ready) return ready;
    ready = db.query(SCHEMA)
        .then(() => {
            console.log('[trial] table ready');
            return true;
        })
        .catch((err) => {
            console.error('[trial] schema failed: ' + err.message);
            ready = null;
            return false;
        });
    return ready;
}

function hostOf(value) {
    return String(value || '')
        .trim()
        .replace(/^https?:\/\//i, '')
        .replace(/\/.*$/, '')
        .replace(/^www\./i, '')
        .toLowerCase();
}

function domainOf(email) {
    return String(email || '').split('@').pop().trim().toLowerCase();
}

function expired(row) {
    return Boolean(row.expires_at && new Date(row.expires_at).getTime() < Date.now());
}

function shape(row) {
    if (!row) {
        return { state: 'none', liveLeft: 0, historyLeft: 0, historyOpen: false, daysLeft: 0 };
    }
    const state = expired(row) && (row.state === 'starter' || row.state === 'verified')
        ? 'expired'
        : row.state;
    const quota = QUOTA[state] || { liveChecks: 0, historyScans: 0, historyOpen: false };
    const daysLeft = row.expires_at
        ? Math.max(0, Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / 86400000))
        : 0;
    return {
        state,
        companyHost: row.company_host || '',
        liveUsed: row.live_used,
        liveIncluded: quota.liveChecks,
        liveLeft: Math.max(0, quota.liveChecks - row.live_used),
        historyUsed: row.history_used,
        historyIncluded: quota.historyScans,
        historyLeft: quota.historyOpen ? Infinity : Math.max(0, quota.historyScans - row.history_used),
        historyOpen: quota.historyOpen,
        // A staging grant moves its own expiry forward on every dashboard load,
        // so the date it carries is one that never arrives. Saying so is the
        // only honest thing the screen can do with it.
        devGrant: row.note === 'staging dev grant',
        phoneVerified: Boolean(row.verified_at),
        startedAt: row.started_at,
        expiresAt: row.expires_at,
        daysLeft,
        note: row.note || '',
    };
}

async function get(orgId) {
    if (!(await init())) return shape(null);
    const n = Number(orgId);
    if (!Number.isSafeInteger(n) || n < 1) return shape(null);
    const res = await db.query('SELECT * FROM trials WHERE org_id = $1', [n]);
    return shape(res.rows[0] || null);
}

// the grant lands on the organisation being looked at, because that is what a
// plan belongs to now. one listed address working in three organisations gets
// three granted plans, which is the same thing that would happen if they paid.
async function devGrant(orgId, userId, email) {
    if (!DEV_PLAN_ON) return false;
    const who = String(email || '').trim().toLowerCase();
    if (!who || !DEV_PLAN_EMAILS.has(who)) return false;
    if (!(await init())) return false;
    const n = Number(orgId);
    if (!Number.isSafeInteger(n) || n < 1) return false;
    const res = await db.query(
        `INSERT INTO trials (org_id, user_id, state, started_at, expires_at, note)
         VALUES ($1, $2, 'enterprise', now(), now() + interval '365 days', 'staging dev grant')
         ON CONFLICT (org_id) DO UPDATE
            SET state = 'enterprise',
                started_at = COALESCE(trials.started_at, now()),
                expires_at = now() + interval '365 days',
                note = 'staging dev grant',
                updated_at = now()
            WHERE trials.state <> 'enterprise'
         RETURNING org_id`,
        [n, userId]
    );
    if (res.rows.length) console.warn('[trial] staging dev grant applied to organisation ' + n);
    return true;
}

// The plan of one organisation, made if it is not there yet. Without an
// organisation there is nothing for a plan to belong to, so it says none rather
// than inventing a row nobody can reach.
async function ensure(orgId, userId, email) {
    if (!(await init())) return shape(null);
    const n = Number(orgId);
    if (!Number.isSafeInteger(n) || n < 1) return shape(null);
    if (DEV_PLAN_ON && email) {
        try {
            await devGrant(n, userId, email);
        } catch (err) {
            console.error('[trial] dev grant failed: ' + err.message);
        }
    }
    await db.query(
        `INSERT INTO trials (org_id, user_id, state) VALUES ($1, $2, 'none')
         ON CONFLICT (org_id) DO NOTHING`,
        [n, userId]
    );
    return get(n);
}

async function activate(orgId, userId, input) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };

    const email = String(input.email || '').trim().toLowerCase();
    const website = String(input.website || '').trim();
    const company = String(input.company || '').trim().slice(0, 120);

    if (input.consent !== true || input.notGambling !== true) {
        return { ok: false, reason: 'both-confirmations-required' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, reason: 'bad-email' };

    const host = hostOf(website);
    if (!host || host.indexOf('.') === -1) return { ok: false, reason: 'bad-website' };

    const emailDomain = domainOf(email);
    const matches = emailDomain === host || emailDomain.endsWith('.' + host) || host.endsWith('.' + emailDomain);
    const state = matches ? 'starter' : 'pending';

    // one trial per company, and the company is the organisation now, so the
    // row that would clash is one belonging to a different organisation.
    const existing = await db.query(
        `SELECT org_id FROM trials
         WHERE company_host = $1 AND org_id IS DISTINCT FROM $2
           AND state IN ('pending','starter','verified')`,
        [host, Number(orgId)]
    );
    if (existing.rows.length) return { ok: false, reason: 'company-already-has-a-trial' };

    const now = Date.now();
    const started = matches ? new Date(now) : null;
    const expires = matches ? new Date(now + TRIAL_DAYS * 86400000) : null;

    try {
        await db.query(
            `INSERT INTO trials (org_id, user_id, state, company_host, company_enc, requested_at, started_at, expires_at, updated_at)
             VALUES ($7, $1, $2, $3, $4, now(), $5, $6, now())
             ON CONFLICT (org_id) DO UPDATE SET
                state = EXCLUDED.state,
                company_host = EXCLUDED.company_host,
                company_enc = EXCLUDED.company_enc,
                requested_at = now(),
                started_at = COALESCE(trials.started_at, EXCLUDED.started_at),
                expires_at = COALESCE(trials.expires_at, EXCLUDED.expires_at),
                updated_at = now()
             WHERE trials.state IN ('none','pending','expired')`,
            [userId, state, host, db.seal('trial-company:' + orgId, company), started, expires,
             Number(orgId)]
        );
    } catch (err) {
        if (err.code === '23505') return { ok: false, reason: 'company-already-has-a-trial' };
        throw err;
    }

    return { ok: true, ...(await get(orgId)) };
}

async function spend(orgId, kind) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const t = await get(orgId);

    if (t.state === 'none') return { ok: false, reason: 'no-trial' };
    if (t.state === 'pending') return { ok: false, reason: 'awaiting-approval' };
    if (t.state === 'expired') return { ok: false, reason: 'trial-expired' };
    // A state this file does not have a quota for is a row that should not
    // exist, and the two statements below would read a limit off undefined and
    // take the whole check down with a 500. It is refused instead: the caller
    // already knows how to say "not available on this trial", and a screening
    // endpoint is the last place that should fall over on a bad row.
    if (!QUOTA[t.state]) return { ok: false, reason: 'no-trial', ...t };

    if (kind === 'history') {
        if (t.historyOpen) {
            await db.query('UPDATE trials SET history_used = history_used + 1, updated_at = now() WHERE org_id = $1', [Number(orgId)]);
            return { ok: true, ...(await get(orgId)) };
        }
        const res = await db.query(
            `UPDATE trials SET history_used = history_used + 1, updated_at = now()
             WHERE org_id = $1 AND history_used < $2 RETURNING org_id`,
            [Number(orgId), QUOTA[t.state].historyScans]
        );
        if (!res.rows.length) return { ok: false, reason: 'history-locked', ...t };
        return { ok: true, ...(await get(orgId)) };
    }

    const res = await db.query(
        `UPDATE trials SET live_used = live_used + 1, updated_at = now()
         WHERE org_id = $1 AND live_used < $2 RETURNING org_id`,
        [Number(orgId), QUOTA[t.state].liveChecks]
    );
    if (!res.rows.length) return { ok: false, reason: 'out-of-checks', ...t };
    return { ok: true, ...(await get(orgId)) };
}

async function markPhoneVerified(orgId, phone) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const hash = db.blindIndex(phone);
    const res = await db.query(
        `UPDATE trials SET state = 'verified', verified_at = now(), phone_hash = $2, phone_enc = $3, updated_at = now()
         WHERE org_id = $1 AND state = 'starter' RETURNING org_id`,
        [Number(orgId), hash, db.seal('trial-phone:' + orgId, phone)]
    );
    if (!res.rows.length) return { ok: false, reason: 'not-in-starter' };
    return { ok: true, ...(await get(orgId)) };
}

async function approve(orgId) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const res = await db.query(
        `UPDATE trials SET state = 'starter', started_at = now(),
            expires_at = now() + ($2 || ' days')::interval, updated_at = now()
         WHERE org_id = $1 AND state = 'pending' RETURNING org_id`,
        [Number(orgId), String(TRIAL_DAYS)]
    );
    if (!res.rows.length) return { ok: false, reason: 'not-pending' };
    return { ok: true, ...(await get(orgId)) };
}

// Plans made before they belonged to an organisation. Each one joins the
// earliest organisation its owner belongs to, which is the one they made when
// they signed up. A row whose owner has no organisation is left alone: there is
// nothing to attach it to, and it is reached by nothing until there is.
//
// Runs once and is then a no-op, because it only ever looks at rows with no
// organisation on them.
async function adopt() {
    if (!(await init())) return 0;
    try {
        const res = await db.query(`
            UPDATE trials t
               SET org_id = pick.org_id, updated_at = now()
              FROM (
                SELECT DISTINCT ON (m.user_id) m.user_id, m.org_id
                  FROM memberships m
              ORDER BY m.user_id, m.created_at
              ) AS pick
             WHERE t.org_id IS NULL
               AND t.user_id = pick.user_id
               AND NOT EXISTS (SELECT 1 FROM trials o WHERE o.org_id = pick.org_id)
         RETURNING t.org_id`);
        if (res.rowCount) {
            console.log('[trial] ' + res.rowCount + ' plan(s) joined their organisation');
        }
        return res.rowCount;
    } catch (err) {
        console.error('[trial] could not attach plans to organisations: ' + err.message);
        return 0;
    }
}

module.exports = { get, ensure, activate, spend, markPhoneVerified, approve, adopt, hostOf, QUOTA, TRIAL_DAYS };
