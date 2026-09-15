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
        phoneVerified: Boolean(row.verified_at),
        startedAt: row.started_at,
        expiresAt: row.expires_at,
        daysLeft,
        note: row.note || '',
    };
}

async function get(userId) {
    if (!(await init())) return shape(null);
    const res = await db.query('SELECT * FROM trials WHERE user_id = $1', [userId]);
    return shape(res.rows[0] || null);
}

async function devGrant(userId, email) {
    if (!DEV_PLAN_ON) return false;
    const who = String(email || '').trim().toLowerCase();
    if (!who || !DEV_PLAN_EMAILS.has(who)) return false;
    if (!(await init())) return false;
    const res = await db.query(
        `INSERT INTO trials (user_id, state, started_at, expires_at, note)
         VALUES ($1, 'enterprise', now(), now() + interval '365 days', 'staging dev grant')
         ON CONFLICT (user_id) DO UPDATE
            SET state = 'enterprise',
                started_at = COALESCE(trials.started_at, now()),
                expires_at = now() + interval '365 days',
                note = 'staging dev grant',
                updated_at = now()
            WHERE trials.state <> 'enterprise'
         RETURNING user_id`,
        [userId]
    );
    if (res.rows.length) console.warn('[trial] staging dev grant applied to user ' + userId);
    return true;
}

async function ensure(userId, email) {
    if (!(await init())) return shape(null);
    if (DEV_PLAN_ON && email) {
        try {
            await devGrant(userId, email);
        } catch (err) {
            console.error('[trial] dev grant failed: ' + err.message);
        }
    }
    await db.query(
        `INSERT INTO trials (user_id, state) VALUES ($1, 'none') ON CONFLICT (user_id) DO NOTHING`,
        [userId]
    );
    return get(userId);
}

async function activate(userId, input) {
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

    const existing = await db.query(
        `SELECT user_id FROM trials
         WHERE company_host = $1 AND user_id <> $2 AND state IN ('pending','starter','verified')`,
        [host, userId]
    );
    if (existing.rows.length) return { ok: false, reason: 'company-already-has-a-trial' };

    const now = Date.now();
    const started = matches ? new Date(now) : null;
    const expires = matches ? new Date(now + TRIAL_DAYS * 86400000) : null;

    try {
        await db.query(
            `INSERT INTO trials (user_id, state, company_host, company_enc, requested_at, started_at, expires_at, updated_at)
             VALUES ($1, $2, $3, $4, now(), $5, $6, now())
             ON CONFLICT (user_id) DO UPDATE SET
                state = EXCLUDED.state,
                company_host = EXCLUDED.company_host,
                company_enc = EXCLUDED.company_enc,
                requested_at = now(),
                started_at = COALESCE(trials.started_at, EXCLUDED.started_at),
                expires_at = COALESCE(trials.expires_at, EXCLUDED.expires_at),
                updated_at = now()
             WHERE trials.state IN ('none','pending','expired')`,
            [userId, state, host, db.seal('trial-company:' + userId, company), started, expires]
        );
    } catch (err) {
        if (err.code === '23505') return { ok: false, reason: 'company-already-has-a-trial' };
        throw err;
    }

    return { ok: true, ...(await get(userId)) };
}

async function spend(userId, kind) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const t = await get(userId);

    if (t.state === 'none') return { ok: false, reason: 'no-trial' };
    if (t.state === 'pending') return { ok: false, reason: 'awaiting-approval' };
    if (t.state === 'expired') return { ok: false, reason: 'trial-expired' };

    if (kind === 'history') {
        if (t.historyOpen) {
            await db.query('UPDATE trials SET history_used = history_used + 1, updated_at = now() WHERE user_id = $1', [userId]);
            return { ok: true, ...(await get(userId)) };
        }
        const res = await db.query(
            `UPDATE trials SET history_used = history_used + 1, updated_at = now()
             WHERE user_id = $1 AND history_used < $2 RETURNING user_id`,
            [userId, QUOTA[t.state].historyScans]
        );
        if (!res.rows.length) return { ok: false, reason: 'history-locked', ...t };
        return { ok: true, ...(await get(userId)) };
    }

    const res = await db.query(
        `UPDATE trials SET live_used = live_used + 1, updated_at = now()
         WHERE user_id = $1 AND live_used < $2 RETURNING user_id`,
        [userId, QUOTA[t.state].liveChecks]
    );
    if (!res.rows.length) return { ok: false, reason: 'out-of-checks', ...t };
    return { ok: true, ...(await get(userId)) };
}

async function markPhoneVerified(userId, phone) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const hash = db.blindIndex(phone);
    const res = await db.query(
        `UPDATE trials SET state = 'verified', verified_at = now(), phone_hash = $2, phone_enc = $3, updated_at = now()
         WHERE user_id = $1 AND state = 'starter' RETURNING user_id`,
        [userId, hash, db.seal('trial-phone:' + userId, phone)]
    );
    if (!res.rows.length) return { ok: false, reason: 'not-in-starter' };
    return { ok: true, ...(await get(userId)) };
}

async function approve(userId) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const res = await db.query(
        `UPDATE trials SET state = 'starter', started_at = now(),
            expires_at = now() + ($2 || ' days')::interval, updated_at = now()
         WHERE user_id = $1 AND state = 'pending' RETURNING user_id`,
        [userId, String(TRIAL_DAYS)]
    );
    if (!res.rows.length) return { ok: false, reason: 'not-pending' };
    return { ok: true, ...(await get(userId)) };
}

module.exports = { get, ensure, activate, spend, markPhoneVerified, approve, hostOf, QUOTA, TRIAL_DAYS };
