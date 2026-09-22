'use strict';

const db = require('./db.js');
const plans = require('./plans.js');
const months = require('./months.js');

// What an organisation bought, when, for how long, and at what price.
//
// Until now the only thing resembling a plan was the trials row, which knows a
// state and two dates. That is enough for a free trial and not enough for
// anything anybody pays for: it cannot say which of the plans was taken, on
// which term, for how much, whether it renews, or what it was before.
//
// Two tables, and the split matters.
//
//   subscriptions       what is true now, one live row per organisation
//   subscription_events what happened, append-only, never updated
//
// The events table is the one that answers questions afterwards. A row that is
// updated in place can only ever say where things ended up; an invoice, a
// dispute and an auditor all ask what was true on a date that has passed.
//
// The price is written into the row when the subscription starts and never
// read from the catalogue again. Raise prices tomorrow and somebody who bought
// today still has theirs. It is the same rule as keeping the sanctions list
// version beside a screening: what was true then is not what is true now, and
// the record has to hold the first one.
//
// Two dates that are easy to confuse and are not the same thing:
//
//   term_ends_at   when what was paid for runs out
//   period_end     when this billing month ends
//
// A yearly subscription has one term and twelve periods. The usage screen
// counts inside a period; the invoice covers a term.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS subscriptions (
    id           bigserial   PRIMARY KEY,
    org_id       bigint      NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    plan         text        NOT NULL,
    term         text        NOT NULL,
    price_cents  integer,
    currency     text        NOT NULL DEFAULT 'EUR',
    started_at   timestamptz NOT NULL DEFAULT now(),
    term_ends_at timestamptz,
    period_start timestamptz NOT NULL,
    period_end   timestamptz NOT NULL,
    renews_at    timestamptz,
    cancelled_at timestamptz,
    ended_at     timestamptz,
    started_by   bigint      REFERENCES users(id) ON DELETE SET NULL,
    note         text        NOT NULL DEFAULT ''
);
-- Whether money actually arrived. We sell these by talking to people and there
-- is no card flow yet, so a row can exist for a plan nobody has paid for. Left
-- as a column rather than a note, because the day somebody asks which of these
-- were real, a note is not something you can filter on.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS paid_at timestamptz;
-- What this customer's plan allows, when it is not what the catalogue says.
--
-- Starter and Growth are bought off the page and leave these empty, so raising
-- an allowance later raises it for everybody on that plan. Enterprise is agreed
-- one customer at a time, and the number somebody agreed to is the number their
-- screen has to show: printing the listed 50,000 at a company that bought
-- 120,000 is the same kind of lie as a price that is not the one they paid.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS included_screenings integer;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS included_seats integer;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS included_addresses integer;
-- one live subscription per organisation. partial, because an organisation
-- that has been on three plans has three rows and only one of them is now.
CREATE UNIQUE INDEX IF NOT EXISTS subs_one_live
    ON subscriptions (org_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS subs_org_idx ON subscriptions (org_id, started_at DESC);

CREATE TABLE IF NOT EXISTS subscription_events (
    id          bigserial   PRIMARY KEY,
    org_id      bigint      NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    sub_id      bigint      REFERENCES subscriptions(id) ON DELETE SET NULL,
    at          timestamptz NOT NULL DEFAULT now(),
    kind        text        NOT NULL,
    plan        text        NOT NULL DEFAULT '',
    term        text        NOT NULL DEFAULT '',
    price_cents integer,
    currency    text        NOT NULL DEFAULT 'EUR',
    by_user     bigint      REFERENCES users(id) ON DELETE SET NULL,
    detail      text        NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sub_events_org_idx ON subscription_events (org_id, at DESC);
-- Periods written before they were whole days carry the time of day they were
-- bought at, which puts the same date at both ends of the window on screen.
-- Explicitly in UTC: date_trunc on a timestamptz otherwise follows whatever
-- timezone the session happens to be in, which is how a boundary moves by an
-- hour depending on who connected.
UPDATE subscriptions
   SET period_start = date_trunc('day', period_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
       period_end   = date_trunc('day', period_end   AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
 WHERE ended_at IS NULL
   AND (period_start <> date_trunc('day', period_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
     OR period_end   <> date_trunc('day', period_end   AT TIME ZONE 'UTC') AT TIME ZONE 'UTC');
`;

let ready = null;

function init() {
    if (!db.available()) return Promise.resolve(false);
    if (ready) return ready;
    ready = db.query(SCHEMA)
        .then(() => {
            console.log('[billing] tables ready');
            return true;
        })
        .catch((err) => {
            console.error('[billing] schema failed: ' + err.message);
            ready = null;
            return false;
        });
    return ready;
}

function shape(row) {
    if (!row) return null;
    const p = plans.plan(row.plan);
    const t = plans.term(row.term);
    return {
        id: String(row.id),
        plan: row.plan,
        planName: p ? p.name : row.plan,
        term: row.term,
        metered: Boolean(t && t.metered),
        priceCents: row.price_cents === null ? null : Number(row.price_cents),
        currency: row.currency,
        startedAt: row.started_at,
        termEndsAt: row.term_ends_at,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        renewsAt: row.renews_at,
        cancelledAt: row.cancelled_at,
        endedAt: row.ended_at,
        paidAt: row.paid_at || null,
        paid: Boolean(row.paid_at),
        // What the plan allows. The row wins where it has something, the
        // catalogue fills in the rest: a listed allowance is a promise we keep
        // now and can raise for everybody, an agreed one belongs to one
        // customer and nothing else may change it.
        included: allowance(row, p),
        agreed: hasOverride(row),
    };
}

function hasOverride(row) {
    return row.included_screenings !== null || row.included_seats !== null ||
        row.included_addresses !== null;
}

function pick(own, listed) {
    return own === null || own === undefined ? (listed === undefined ? null : listed) : Number(own);
}

function allowance(row, p) {
    if (!p && !hasOverride(row)) return null;
    return {
        screenings: pick(row.included_screenings, p && p.screenings),
        addresses: pick(row.included_addresses, p && p.addresses),
        seats: pick(row.included_seats, p && p.seats),
    };
}

async function record(client, orgId, subId, kind, row, byUser, detail) {
    await client.query(
        `INSERT INTO subscription_events
            (org_id, sub_id, kind, plan, term, price_cents, currency, by_user, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [Number(orgId), subId ? Number(subId) : null, kind,
         (row && row.plan) || '', (row && row.term) || '',
         row && row.price_cents !== undefined ? row.price_cents : null,
         (row && row.currency) || plans.CURRENCY,
         byUser ? Number(byUser) : null, detail || '']
    );
}

// The live subscription, with its period rolled forward if it has gone stale.
async function get(orgId) {
    if (!(await init())) return null;
    const n = Number(orgId);
    if (!Number.isSafeInteger(n) || n < 1) return null;
    try {
        const res = await db.query(
            'SELECT * FROM subscriptions WHERE org_id = $1 AND ended_at IS NULL',
            [n]
        );
        if (!res.rowCount) return null;
        return shape(await freshen(res.rows[0]));
    } catch (err) {
        console.error('[billing] could not read: ' + err.message);
        return null;
    }
}

// Periods do not roll themselves. Rather than a nightly job that has to be
// running for the numbers to be right, the period is brought up to date the
// next time anybody looks: the arithmetic is the same either way, and this
// cannot silently stop working.
async function freshen(row) {
    const now = Date.now();
    if (new Date(row.period_end).getTime() > now) return row;

    const term = plans.term(row.term);
    const ends = row.term_ends_at ? new Date(row.term_ends_at).getTime() : null;

    // a term that has run out and does not renew is over. it is not this
    // function's job to decide that quietly, so it ends the row and says so.
    if (ends !== null && ends <= now && !row.renews_at) {
        try {
            const done = await db.query(
                `UPDATE subscriptions SET ended_at = $2
                  WHERE id = $1 AND ended_at IS NULL RETURNING *`,
                [row.id, new Date(ends).toISOString()]
            );
            if (done.rowCount) {
                await record(db, row.org_id, row.id, 'ended', row, null, 'term ran out');
                return done.rows[0];
            }
        } catch (err) {
            console.error('[billing] could not end: ' + err.message);
        }
        return row;
    }

    const next = months.periodAround(row.period_start, now);
    let termEnds = row.term_ends_at;
    if (ends !== null && ends <= now && row.renews_at && term && term.termMonths) {
        // it renewed: the next term starts where the last one ended
        termEnds = months.addMonths(new Date(ends), term.termMonths).toISOString();
    }

    try {
        const out = await db.query(
            // the casts are not decoration: $4 is read twice, once as a column
            // value and once inside a CASE, and postgres refuses to guess a
            // type for a parameter used in two places that disagree
            `UPDATE subscriptions
                SET period_start = $2::timestamptz,
                    period_end = $3::timestamptz,
                    term_ends_at = $4::timestamptz,
                    renews_at = CASE WHEN renews_at IS NULL THEN NULL ELSE $4::timestamptz END
              WHERE id = $1 AND ended_at IS NULL
          RETURNING *`,
            [row.id, next.from.toISOString(), next.to.toISOString(), termEnds]
        );
        if (!out.rowCount) return row;
        if (termEnds !== row.term_ends_at) {
            await record(db, row.org_id, row.id, 'renewed', out.rows[0], null, '');
        }
        return out.rows[0];
    } catch (err) {
        console.error('[billing] could not roll the period: ' + err.message);
        return row;
    }
}

// An allowance is a count of things, so half of one is not an answer, and a
// negative one is somebody's typo rather than a generous contract.
function whole(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Math.floor(Number(value));
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

// Take a plan. Returns the new subscription, and ends whatever was there.
async function start(orgId, userId, input) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    const planKey = String((input && input.plan) || '').toLowerCase();
    const termKey = String((input && input.term) || '').toLowerCase();
    if (!plans.isPlan(planKey)) return { ok: false, reason: 'bad-plan' };
    if (!plans.isTerm(termKey)) return { ok: false, reason: 'bad-term' };

    const term = plans.term(termKey);
    // the listed price is the price, except where the page itself says the
    // number is a starting point rather than a rate
    const price = input && typeof input.priceCents === 'number'
        ? Math.max(0, Math.round(input.priceCents))
        : plans.listPrice(planKey, termKey);

    const now = new Date();
    const termEnds = term.termMonths ? months.addMonths(now, term.termMonths) : null;
    const period = months.periodAround(now, now.getTime());

    try {
        const live = await db.query(
            'SELECT * FROM subscriptions WHERE org_id = $1 AND ended_at IS NULL',
            [Number(orgId)]
        );
        const before = live.rows[0] || null;
        if (before) {
            await db.query('UPDATE subscriptions SET ended_at = now() WHERE id = $1', [before.id]);
            await record(db, orgId, before.id, 'ended', before, userId, 'replaced');
        }

        const res = await db.query(
            `INSERT INTO subscriptions
                (org_id, plan, term, price_cents, currency, started_at, term_ends_at,
                 period_start, period_end, renews_at, started_by,
                 note, paid_at, included_screenings, included_seats, included_addresses)
             VALUES ($1, $2, $3, $4, $5, now(), $6, $7, $8, $6, $9, $10, $11, $12, $13, $14)
             RETURNING *`,
            [Number(orgId), planKey, termKey, price, plans.CURRENCY,
             termEnds ? termEnds.toISOString() : null,
             period.from.toISOString(), period.to.toISOString(),
             userId ? Number(userId) : null,
             String((input && input.note) || '').slice(0, 200),
             input && input.paid ? new Date().toISOString() : null,
             whole(input && input.screenings), whole(input && input.seats),
             whole(input && input.addresses)]
        );
        const row = res.rows[0];
        await record(db, orgId, row.id, before ? 'changed' : 'started', row, userId,
            before ? 'from ' + before.plan + '/' + before.term : '');
        return { ok: true, subscription: shape(row) };
    } catch (err) {
        console.error('[billing] could not start: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }
}

// Stop it renewing. What was paid for is not taken away: it runs to the end of
// its term, which is the only honest thing to do with money already taken.
async function cancel(orgId, userId) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    try {
        const res = await db.query(
            `UPDATE subscriptions
                SET cancelled_at = now(), renews_at = NULL
              WHERE org_id = $1 AND ended_at IS NULL AND cancelled_at IS NULL
          RETURNING *`,
            [Number(orgId)]
        );
        if (!res.rowCount) return { ok: false, reason: 'nothing-to-cancel' };
        await record(db, orgId, res.rows[0].id, 'cancelled', res.rows[0], userId, '');
        return { ok: true, subscription: shape(res.rows[0]) };
    } catch (err) {
        console.error('[billing] could not cancel: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }
}

// Put it back on renewal before the term is out.
async function resume(orgId, userId) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    try {
        const res = await db.query(
            `UPDATE subscriptions
                SET cancelled_at = NULL, renews_at = term_ends_at
              WHERE org_id = $1 AND ended_at IS NULL AND cancelled_at IS NOT NULL
                AND term_ends_at IS NOT NULL AND term_ends_at > now()
          RETURNING *`,
            [Number(orgId)]
        );
        if (!res.rowCount) return { ok: false, reason: 'nothing-to-resume' };
        await record(db, orgId, res.rows[0].id, 'resumed', res.rows[0], userId, '');
        return { ok: true, subscription: shape(res.rows[0]) };
    } catch (err) {
        console.error('[billing] could not resume: ' + err.message);
        return { ok: false, reason: 'unavailable' };
    }
}

// What happened to this organisation's billing, newest first.
async function history(orgId, limit) {
    if (!(await init())) return [];
    try {
        const res = await db.query(
            `SELECT * FROM subscription_events
              WHERE org_id = $1 ORDER BY at DESC, id DESC LIMIT $2`,
            [Number(orgId), Math.min(Math.max(Number(limit) || 50, 1), 200)]
        );
        return res.rows.map((r) => ({
            id: String(r.id),
            at: r.at,
            kind: r.kind,
            plan: r.plan,
            term: r.term,
            priceCents: r.price_cents === null ? null : Number(r.price_cents),
            currency: r.currency,
            detail: r.detail,
        }));
    } catch (err) {
        console.error('[billing] could not read history: ' + err.message);
        return [];
    }
}

module.exports = { init, get, start, cancel, resume, history, shape };
