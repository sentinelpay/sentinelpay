'use strict';

const db = require('./db.js');
const months = require('./months.js');

// What an organisation has done in a period.
//
// The screenings table is already the record: every check is a row with the
// time it happened, the organisation it belonged to, what came back, and
// whether it was sandbox work. So this file counts what is there rather than
// keeping a second set of counters beside it. Two counters for one fact drift
// apart, and on a compliance tool the number on this screen is the one somebody
// may have to stand behind.
//
// The quota counters on the trials row are a different thing and stay where
// they are: they are what the plan has left, counted since the plan started,
// not what was done between two dates.
//
// Periods are monthly, anchored on the day the plan started. A month is what an
// invoice covers, and anchoring on the plan rather than on the calendar means
// the page and the invoice describe the same window. Without a plan the
// organisation's own birthday is the anchor, so the page still works before
// anybody has paid for anything.

// A year of invoices, not a quarter of them.
//
// Three was enough to prove the screen worked and far too few to use it. A
// customer asked what they screened in March, by a regulator or by their own
// auditor, could not answer from this page at all: the dropdown stopped four
// months back and there was nothing else to ask. Twelve covers the year an
// audit tends to reach for, and `cycles` still stops at the day the
// organisation started, so nobody is offered a month they did not exist for.
const CYCLES_BACK = 12;

// One copy of the month arithmetic, shared with billing. Two copies would be
// two answers to "which month is this", and the day they disagree is the day a
// screening is counted in a period it did not happen in.
const atUTC = months.atUTC;
const addMonths = months.addMonths;

// Every cycle boundary from the anchor, newest first. `back` of them.
//
// `span` is the length of one, in months, and it is the term: a quarterly plan
// is invoiced for three months and allowed a quarter's worth of screening, so
// the window this page counts is the window the invoice covers. Without a plan
// it is a month, because there is no term to take a length from.
function cycles(anchorAt, now, back, span) {
    const step = Math.max(1, Number(span) || 1);
    // the day it began, not the minute: a cycle is whole days, or the date it
    // starts on is also the date the one before it appears to end on
    const anchor = months.startOfDay(anchorAt || Date.now());
    const today = new Date(now || Date.now());

    // walk the boundaries from the anchor rather than guessing one: with a span
    // of three the cycle a day falls in depends on where the anchor is, not
    // just on which month it is
    let start = anchor;
    let guard = 0;
    while (guard++ < 2400) {
        const to = addMonths(start, step);
        if (today.getTime() < to.getTime()) break;
        start = to;
    }

    const out = [];
    for (let i = 0; i < Math.max(1, back || CYCLES_BACK); i++) {
        const from = addMonths(start, -i * step);
        const to = addMonths(from, step);
        // a cycle that begins before the anchor is a month this organisation
        // did not exist for, and an empty window nobody asked about
        if (to.getTime() <= anchor.getTime()) break;
        out.push({
            key: 'c' + i,
            from: (from.getTime() < anchor.getTime() ? anchor : from).toISOString(),
            to: to.toISOString(),
            current: i === 0,
            grain: 'day',
        });
    }
    return out;
}

// A plan that started this morning makes for a cycle that started this morning,
// and a page that says almost nothing although the organisation has been
// working for months. So the periods on offer are not only the invoice's: a
// plain rolling window answers "how much do we screen" without anybody having
// to think about billing at all.
function rolling(days, now, birth) {
    const end = new Date(now || Date.now());
    let from = new Date(end.getTime() - days * 86400000);
    // Never before the organisation existed. Thirty days of history for a
    // company that is three days old is twenty-seven days of flat nothing, and
    // a chart of mostly nothing says the wrong thing about a new customer.
    if (birth && new Date(birth).getTime() > from.getTime()) {
        from = months.startOfDay(birth);
    }
    return { key: 'd' + days, from: from.toISOString(), to: end.toISOString(), days, grain: 'day' };
}

// A window short enough that a day is the wrong unit.
//
// Thirty days of work is a shape you read in days. What happened this morning
// is not: a single column for today answers "how busy was today" with one
// number and hides the whole of it. So the short windows are counted by the
// hour, which is also the only thing that puts a time of day on the axis
// honestly -- a daily bucket has no hour in it to print.
//
// Never before the organisation existed, same as the daily windows, but to the
// instant rather than the start of that day: an account four hours old has
// four hours of history, not a day of mostly nothing.
function rollingHours(hours, now, birth) {
    const end = new Date(now || Date.now());
    let from = new Date(end.getTime() - hours * 3600000);
    if (birth && new Date(birth).getTime() > from.getTime()) {
        from = new Date(birth);
    }
    return {
        key: 'h' + hours,
        from: from.toISOString(),
        to: end.toISOString(),
        hours,
        grain: 'hour',
    };
}

function periods(anchorAt, now, birth, span) {
    const when = now || Date.now();
    return cycles(anchorAt, when, CYCLES_BACK, span)
        .concat([
            // only the last day is counted by the hour. a week of hours is a
            // hundred and sixty eight points to say what seven of them say
            // better, and the time of day stops being the question that far
            // out.
            rollingHours(24, when, birth),
            rolling(7, when, birth),
            rolling(30, when, birth),
            rolling(90, when, birth),
        ]);
}

function pickCycle(list, key) {
    for (let i = 0; i < list.length; i++) {
        if (list[i].key === key) return list[i];
    }
    return list[0];
}

// Every day in the window, including the ones nothing happened on. A chart with
// the quiet days left out is a chart that lies about the shape of the work.
//
// It stops at today. The rest of a billing period has not happened yet, and a
// line drawn flat across it says there was no work on days nobody has lived.
//
// Days are stepped from the middle of each one rather than its start: midday is
// the same date in every timezone and on both sides of a clock change, so the
// walk cannot skip a day or count one twice.
// Midday of the day a moment falls in. The walk below steps a day at a time
// from the middle of a day, so that it cannot skip one or count one twice
// across a clock change -- but "from plus twelve hours" is only the middle of a
// day when the window began at midnight. A billing period does; a rolling
// window begins at whatever time of day it is now, and starting the walk at
// half past six in the evening put every step half past six in the morning,
// which quietly dropped the last day of the window.
function noonOf(ms) {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + 12 * 3600 * 1000;
}

function dayIn(ms, zone) {
    try {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date(ms));
    } catch (err) {
        return new Date(ms).toISOString().slice(0, 10);
    }
}

// The same, to the hour. Named in the reader's zone like a day is, so a bucket
// is an hour of their clock rather than an hour of UTC -- which matters most
// exactly where it is least expected: half an hour off UTC, an hour of utc is
// two halves of two of their hours.
function hourIn(ms, zone) {
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', hourCycle: 'h23',
        }).formatToParts(new Date(ms));
        const of = (type) => (parts.find((p) => p.type === type) || {}).value;
        return of('year') + '-' + of('month') + '-' + of('day') + ' ' + of('hour') + ':00';
    } catch (err) {
        return new Date(ms).toISOString().slice(0, 13).replace('T', ' ') + ':00';
    }
}

// What a bucket is, in the three places that have to agree about it: how
// postgres groups the rows, how a moment is named, and how far one step is.
//
// They have to agree or the chart quietly loses data -- the walk names a
// bucket the query never produced, so it fills it with a zero and the work
// that happened in it is drawn as an empty hour. One table, read by all three.
const GRAIN = {
    day: {
        step: 86400000,
        // midday, so a step cannot skip a day or count one twice across a
        // clock change
        anchor: (ms) => noonOf(ms),
        nameOf: dayIn,
        column: "to_char(date_trunc('day', at AT TIME ZONE $5), 'YYYY-MM-DD')",
    },
    hour: {
        step: 3600000,
        // the middle of the hour, for the same reason
        anchor: (ms) => Math.floor(ms / 3600000) * 3600000 + 1800000,
        nameOf: hourIn,
        column: "to_char(date_trunc('hour', at AT TIME ZONE $5), 'YYYY-MM-DD HH24:00')",
    },
};

function grainOf(period) {
    return GRAIN[(period && period.grain) === 'hour' ? 'hour' : 'day'];
}

// Every one of the reader's days the window touches, in order and once each.
//
// The walk has to step in one calendar and stop in another, and getting that
// wrong is what put a twenty-third between two twenty-seconds on somebody's
// chart. It stepped at midday UTC and tested that midnight UTC had not passed
// "now" -- true for a few hours yet -- while naming the day it landed on in the
// reader's zone, which nine hours behind was still the day before. So it drew a
// day the reader has not started, and then the line that adds today put today
// after it.
//
// The fix is to have one calendar decide: the first and last day are named in
// the reader's zone, and a day is kept only if it falls between them. The walk
// itself is still UTC and still steps from the middle of a day, because that is
// what makes it safe across a clock change -- it just no longer has an opinion
// about where the window ends. It starts a day early and ends a day late, since
// a zone can be fourteen hours from UTC and the reader's own first and last day
// can sit outside the UTC dates of the bounds.
function walkDays(fromMs, stopMs, zone, grain) {
    const g = grain || GRAIN.day;
    const first = g.nameOf(fromMs, zone);
    const last = g.nameOf(stopMs, zone);
    const out = [];
    let cursor = g.anchor(fromMs) - g.step;
    const end = g.anchor(stopMs) + g.step;
    let guard = 0;
    let seen = '';
    // a week of hours is 168 of them, and the walk starts one early and ends
    // one late, so the old limit of five hundred was a day and a half short of
    // silently truncating the axis
    while (cursor <= end && guard++ < 5000) {
        const key = g.nameOf(cursor, zone);
        // Where a zone puts its clocks back, two of these steps land in the
        // same named hour. The query grouped by that name too, so the row
        // already holds both -- naming it once keeps the count whole rather
        // than drawing the hour twice with half of it in each.
        if (key !== seen && key >= first && key <= last) {
            out.push(key);
            seen = key;
        }
        cursor += g.step;
    }
    // a window too short to contain a whole bucket is still one on the chart
    if (!out.length) out.push(last);
    return out;
}

// A bucket a query never returned is a bucket nothing happened in, which is a
// zero and not a gap: a chart with the quiet days left out lies about the shape
// of the work.
//
// severe, addresses and assets are here so each measure under the chart can
// show its own shape rather than borrowing the shape of the total. Note that
// the daily distinct counts do not add up to the period's distinct count, and
// should not: an address asked about on Monday and again on Thursday is one
// address that week and one on each of two days. Both numbers are right about
// different questions, and nobody should later "fix" one to match the other.
function pickDays(seen, days) {
    return days.map((day) => {
        const row = seen.get(day);
        return {
            day,
            n: row ? row.n : 0,
            flagged: row ? row.flagged : 0,
            severe: row && row.severe ? row.severe : 0,
            addresses: row && row.addresses ? row.addresses : 0,
            assets: row && row.assets ? row.assets : 0,
        };
    });
}

function fillDays(rows, from, to, zone, grain) {
    // the last day is the one holding the last instant the window contains,
    // not the one its exclusive end lands on. a period that ends at midnight
    // on the twentieth is over on the nineteenth, and drawing a twentieth on
    // it adds a day of no work that never belonged to it
    const now = Date.now();
    const stop = Math.min(new Date(to).getTime() - 1, now);
    const out = pickDays(new Map(rows.map((r) => [r.d, r])),
        walkDays(new Date(from).getTime(), stop, zone, grain));
    return out;
}

// Only a real zone name, and postgres is asked to hold it in a parameter
// rather than have it pasted into the statement.
function safeZone(value) {
    const zone = String(value || '').trim();
    return /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(zone) && zone.length < 64
        ? zone : 'UTC';
}

// The day-by-day of a window that is over, and nothing else about it. It is
// the same bucketing as the current period's, so the two can be laid over each
// other; it walks to the end of the window rather than to today, because for a
// window in the past there is no day still being lived through.
// Nothing later than this instant. A window that is still running ends in the
// future, and counting to its end while the chart stops at today would put a
// number in the headline that the days underneath it cannot add up to. No real
// screening happens after now, but a database whose clock is a minute ahead of
// the application's writes one, and this is the page somebody is asked to stand
// behind.
function until(to) {
    return new Date(Math.min(new Date(to).getTime(), Date.now())).toISOString();
}

async function daysIn(orgId, from, to, sandbox, zone, grain) {
    to = until(to);
    const g = grain || GRAIN.day;
    const rows = await db.query(
        // the same five measures the current window returns, because every
        // one of them is drawn against its own earlier self. two of them were
        // missing here, so the cards for severe and for addresses had a
        // window before them made entirely of zeros -- a comparison that
        // would have drawn a line along the floor and called it last month.
        `SELECT ${g.column} AS d,
                count(*)::int AS n,
                count(*) FILTER (WHERE verdict <> 'clear')::int AS flagged,
                count(*) FILTER (WHERE verdict = 'severe')::int AS severe,
                count(DISTINCT address)::int AS addresses,
                count(DISTINCT NULLIF(asset, ''))::int AS assets
           FROM screenings
          WHERE org_id = $1 AND at >= $2 AND at < $3 AND sandbox = $4
       GROUP BY 1 ORDER BY 1`,
        [Number(orgId), from, to, Boolean(sandbox), zone]
    );
    // the same walk as the window this one is compared against, so the two
    // come out the same length: they are drawn over each other by day number,
    // and a window one bucket shorter is a line that stops before the end of
    // the card. one function, so there is one answer to what a day is
    const stop = Math.min(new Date(to).getTime() - 1, Date.now());
    return pickDays(new Map(rows.rows.map((r) => [r.d, r])),
        walkDays(new Date(from).getTime(), stop, zone, grain));
}

async function screeningsIn(orgId, from, to, sandbox, zone, grain) {
    to = until(to);
    const g = grain || GRAIN.day;
    const args = [Number(orgId), from, to, Boolean(sandbox), zone];
    const [sum, days, verdicts, assets, byProject] = await Promise.all([
        db.query(
            `SELECT count(*)::int AS n,
                    count(*) FILTER (WHERE verdict <> 'clear')::int AS flagged,
                    count(DISTINCT address)::int AS addresses,
                    count(DISTINCT NULLIF(asset, ''))::int AS assets
               FROM screenings
              WHERE org_id = $1 AND at >= $2 AND at < $3 AND sandbox = $4`,
            args.slice(0, 4)
        ),
        db.query(
            // A day is the reader's day. Bucketing in utc puts an evening in
            // one column for somebody in Zagreb and the next column for
            // somebody in New York, and both of them are looking at their own
            // working day. The same holds of an hour, and more sharply: a zone
            // half an hour off utc has no hour in common with it at all.
            `SELECT ${g.column} AS d,
                    count(*)::int AS n,
                    count(*) FILTER (WHERE verdict <> 'clear')::int AS flagged,
                    count(*) FILTER (WHERE verdict = 'severe')::int AS severe,
                    count(DISTINCT address)::int AS addresses,
                    count(DISTINCT NULLIF(asset, ''))::int AS assets
               FROM screenings
              WHERE org_id = $1 AND at >= $2 AND at < $3 AND sandbox = $4
           GROUP BY 1 ORDER BY 1`,
            args
        ),
        db.query(
            `SELECT verdict, count(*)::int AS n
               FROM screenings
              WHERE org_id = $1 AND at >= $2 AND at < $3 AND sandbox = $4
           GROUP BY 1`,
            args.slice(0, 4)
        ),
        db.query(
            `SELECT COALESCE(NULLIF(asset, ''), 'other') AS asset, count(*)::int AS n
               FROM screenings
              WHERE org_id = $1 AND at >= $2 AND at < $3 AND sandbox = $4
           GROUP BY 1 ORDER BY n DESC, 1 LIMIT 12`,
            args.slice(0, 4)
        ),
        // Which part of the business did the work. A company running an
        // exchange and a card product has one bill and two sets of rules, and
        // "who is spending the allowance" is the question they ask first when
        // it starts running out. Checks with no project are its own row rather
        // than being dropped: work done from the dashboard is still work.
        db.query(
            `SELECT s.project_id AS id, p.name AS name, count(*)::int AS n
               FROM screenings s
               LEFT JOIN projects p ON p.id = s.project_id
              WHERE s.org_id = $1 AND s.at >= $2 AND s.at < $3 AND s.sandbox = $4
           GROUP BY 1, 2 ORDER BY n DESC LIMIT 12`,
            args.slice(0, 4)
        ),
    ]);

    const head = sum.rows[0] || { n: 0, flagged: 0, addresses: 0, assets: 0 };
    const byVerdict = {};
    verdicts.rows.forEach((r) => { byVerdict[r.verdict] = r.n; });
    return {
        total: head.n,
        flagged: head.flagged,
        clear: head.n - head.flagged,
        addresses: head.addresses,
        assetCount: head.assets,
        days: fillDays(days.rows, from, to, zone, grain),
        verdicts: byVerdict,
        assets: assets.rows.map((r) => ({ asset: r.asset, n: r.n })),
        projects: byProject.rows.map((r) => ({
            id: r.id ? String(r.id) : '',
            name: r.name || '',
            n: r.n,
        })),
    };
}

// The organisation itself: things that are true now rather than counted over a
// window, plus the three that are (a token used, a person let in, a check
// decided).
async function shapeOf(orgId, from, to) {
    const [members, projects, tokens, invited, ever, decided] = await Promise.all([
        db.query('SELECT count(*)::int AS n FROM memberships WHERE org_id = $1', [Number(orgId)]),
        db.query(
            `SELECT count(*)::int AS n,
                    count(*) FILTER (WHERE archived_at IS NULL)::int AS live
               FROM projects WHERE org_id = $1`,
            [Number(orgId)]
        ),
        db.query(
            `SELECT count(*) FILTER (WHERE revoked_at IS NULL
                        AND (expires_at IS NULL OR expires_at > now()))::int AS live,
                    count(*) FILTER (WHERE last_used_at >= $2 AND last_used_at < $3)::int AS used
               FROM api_tokens WHERE org_id = $1`,
            [Number(orgId), from, to]
        ),
        db.query(
            `SELECT count(*)::int AS n FROM memberships
              WHERE org_id = $1 AND created_at >= $2 AND created_at < $3`,
            [Number(orgId), from, to]
        ),
        // Whether this organisation has ever screened anything, in any period
        // and either scope. A period with nothing in it means one of two very
        // different things -- we stopped, or we have not started -- and the
        // page has no business showing the same empty columns for both.
        db.query('SELECT EXISTS (SELECT 1 FROM screenings WHERE org_id = $1) AS yes',
            [Number(orgId)]),
        // Checks a person signed off in this window. Not how many are waiting
        // -- that is a queue and it is counted elsewhere -- but how much of
        // the work the product cannot do alone actually got done.
        db.query(
            `SELECT count(*)::int AS n FROM check_decisions
              WHERE org_id = $1 AND at >= $2 AND at < $3`,
            [Number(orgId), from, to]
        ),
    ]);
    return {
        members: members.rows[0].n,
        projects: projects.rows[0].live,
        projectsAll: projects.rows[0].n,
        tokens: tokens.rows[0].live,
        tokensUsed: tokens.rows[0].used,
        joined: invited.rows[0].n,
        decisions: decided.rows[0].n,
        everScreened: Boolean(ever.rows[0].yes),
    };
}

// The same window, one step back. A number on its own says how much; the same
// number beside the one before it says whether that is a lot -- which is the
// question somebody opening this page actually has.
function previousOf(period) {
    const from = new Date(period.from);
    const to = new Date(period.to);
    const now = Date.now();

    // Like for like. A period two days old compared against a whole month
    // before it reads as a collapse, and it is not one: it is two days against
    // thirty. So when the period is still running, the window before it is cut
    // to the same length that has elapsed.
    const done = Math.min(now, to.getTime()) - from.getTime();
    const running = now < to.getTime();

    if (period.days || period.hours) {
        const span = to.getTime() - from.getTime();
        const start = new Date(from.getTime() - span);
        return { from: start.toISOString(), to: new Date(start.getTime() + (running ? done : span)).toISOString() };
    }
    const start = months.addMonths(from, -1);
    const end = running ? new Date(start.getTime() + done) : from;
    return { from: start.toISOString(), to: end.toISOString(), partial: running };
}

// Things that happened to the plan itself inside this window: it started, it
// renewed, it changed. They are marked on the chart rather than cutting it
// short -- a rolling window that stopped at the last renewal would hide the
// month before it, and the question "did anything change here" is answered by
// a mark on the day, not by a missing half of the chart.
async function marksIn(orgId, from, to) {
    try {
        const res = await db.query(
            `SELECT to_char(date_trunc('day', at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS d,
                    kind, plan
               FROM subscription_events
              WHERE org_id = $1 AND at >= $2 AND at < $3
                AND kind IN ('started', 'renewed', 'changed')
           ORDER BY at`,
            [Number(orgId), from, to]
        );
        return res.rows.map((r) => ({ day: r.d, kind: r.kind, plan: r.plan }));
    } catch (err) {
        console.error('[usage] could not read plan marks: ' + err.message);
        return [];
    }
}

// The whole screen's worth, for one organisation and one period.
async function forOrg(orgId, opts) {
    const o = opts || {};
    const list = periods(o.anchor, Date.now(), o.birth, o.span);
    const period = pickCycle(list, o.period);
    const sandbox = o.scope === 'sandbox';
    const zone = safeZone(o.zone);
    // how finely this window is counted. it belongs to the window rather than
    // to a setting: the same chart is read in hours over a day and in days
    // over a quarter, and nobody should have to ask for that.
    const grain = grainOf(period);

    if (!db.available()) {
        return { ok: false, reason: 'unavailable', period, periods: list, scope: sandbox ? 'sandbox' : 'live' };
    }

    try {
        // A window before this one only exists if the organisation did. A plan
        // taken on the day the company was created has nothing behind it, and
        // "+100% on nothing" is a sentence about arithmetic rather than about
        // the business.
        const before = previousOf(period);
        const born = o.birth ? months.startOfDay(o.birth).getTime() : null;
        const comparable = !born || new Date(before.from).getTime() >= born;

        // The shape of the window before, wherever there is one. This was
        // held back from the rolling windows on the grounds that "the thirty
        // days before these thirty" is a window nobody is billed for -- which
        // is true, and beside the point: the percentage is already printed
        // there, so the comparison is already being made. Offering the number
        // and refusing the picture of it is a distinction only the person who
        // wrote it can see. The two windows are also exactly the same length
        // here, which they are not for two calendar months.
        const alongside = comparable;

        // The billing cycle this organisation is in, whichever window is being
        // looked at. The allowance belongs to the cycle and not to the window:
        // "how much of the quarter is spent" has one answer, and it should not
        // disappear because somebody asked to see yesterday. Counted here so
        // the meter can say the same thing on every period rather than
        // vanishing on four of them and taking the card's height with it.
        const cycle = list.find((p) => p.current) || null;
        const sameWindow = cycle && cycle.key === period.key;

        const [work, shape, shapeBefore, past, marks, ghost, spent] = await Promise.all([
            screeningsIn(orgId, period.from, period.to, sandbox, zone, grain),
            shapeOf(orgId, period.from, period.to),
            // The same shape over the window before this one. Only the counted
            // part of it means anything there -- how many people are in the
            // organisation is not a fact about last week -- but it is one query
            // either way and the counted part is what a comparison needs.
            shapeOf(orgId, before.from, before.to),
            comparable
                ? db.query(
                    // the same counts the tiles show, so each of them can say
                    // whether it is more or less than last time. it is the
                    // query that was already being run, with three more
                    // columns on it rather than three more round trips.
                    `SELECT count(*)::int AS n,
                            count(*) FILTER (WHERE verdict <> 'clear')::int AS flagged,
                            count(*) FILTER (WHERE verdict = 'severe')::int AS severe,
                            count(DISTINCT address)::int AS addresses,
                            count(DISTINCT NULLIF(asset, ''))::int AS assets
                       FROM screenings
                      WHERE org_id = $1 AND at >= $2 AND at < $3 AND sandbox = $4`,
                    [Number(orgId), before.from, before.to, sandbox]
                )
                : Promise.resolve({ rows: [] }),
            marksIn(orgId, period.from, period.to),
            alongside
                ? daysIn(orgId, before.from, before.to, sandbox, zone, grain)
                : Promise.resolve(null),
            // free when the window already is the cycle
            !cycle || sameWindow
                ? Promise.resolve(null)
                : db.query(
                    `SELECT count(*)::int AS n
                       FROM screenings
                      WHERE org_id = $1 AND at >= $2 AND at < $3 AND sandbox = $4`,
                    [Number(orgId), cycle.from, until(cycle.to), Boolean(sandbox)]
                ),
        ]);
        const head = past.rows[0] || null;
        return {
            ok: true,
            period,
            periods: list,
            scope: sandbox ? 'sandbox' : 'live',
            zone,
            screenings: work,
            marks,
            // what the plan's allowance is measured against, always the cycle
            cycle: cycle ? {
                from: cycle.from,
                to: cycle.to,
                used: sameWindow ? work.total : ((spent && spent.rows[0]) || { n: 0 }).n,
            } : null,
            previous: head ? {
                from: before.from, to: before.to,
                total: head.n, flagged: head.flagged, severe: head.severe,
                addresses: head.addresses, assetCount: head.assets,
                // Counted the same way as this window's, so the two can be
                // subtracted. A number beside a number from a different kind
                // of question is not a comparison.
                decisions: shapeBefore ? shapeBefore.decisions : 0,
                // the same stretch of it, not all of it, while this one runs
                partial: Boolean(before.partial),
                days: ghost,
            } : null,
            org: shape,
        };
    } catch (err) {
        console.error('[usage] could not read: ' + err.message);
        return { ok: false, reason: 'unavailable', period, periods: list, scope: sandbox ? 'sandbox' : 'live' };
    }
}

function csvCell(value) {
    const s = String(value === null || value === undefined ? '' : value);
    // a cell that begins with one of these is run as a formula by a spreadsheet,
    // which is how a file of numbers becomes something that does things
    const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
    return /[",\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

// The same period as a file. This exists because on a compliance tool the usage
// page is also evidence: somebody is asked how much was screened in March and
// has to hand over something an auditor can keep.
function csv(out, org) {
    const lines = [];
    const put = (a, b) => lines.push(csvCell(a) + ',' + csvCell(b));
    lines.push('Sentinelpay usage');
    put('Organisation', (org && org.name) || '');
    put('From', out.period.from);
    put('To', out.period.to);
    put('Scope', out.scope === 'sandbox' ? 'sandbox' : 'production');
    put('Generated', new Date().toISOString());
    lines.push('');
    put('Screenings', out.screenings.total);
    put('Flagged', out.screenings.flagged);
    put('Clear', out.screenings.clear);
    put('Distinct addresses', out.screenings.addresses);
    put('Assets seen', out.screenings.assetCount);
    put('Members', out.org.members);
    put('Projects', out.org.projects);
    put('Tokens in use', out.org.tokensUsed);
    lines.push('');
    lines.push('Day,Screenings,Flagged');
    out.screenings.days.forEach((d) => {
        lines.push([csvCell(d.day), csvCell(d.n), csvCell(d.flagged)].join(','));
    });
    // a trailing newline, so the last row is a row and not the end of the file
    return lines.join('\r\n') + '\r\n';
}

module.exports = {
    forOrg, cycles, periods, csv, addMonths, CYCLES_BACK,
    // the bucketing, so a test can hold it to what it claims without a
    // database: what a window is cut into is the part that has been wrong
    // before, and it is arithmetic over a calendar rather than a query
    GRAIN, grainOf, walkDays, previousOf,
};
