'use strict';

const db = require('./db.js');
const months = require('./months.js');
const sanctions = require('./sanctions.js');

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
    const [sum, days, verdicts, assets, byProject, signed] = await Promise.all([
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
        // Decisions, bucketed the same way as the screenings they conclude.
        //
        // The grid draws a shape beside every count that has one, and a count
        // with no shape next to five that have is read as nothing happening
        // rather than as nothing measured. Decisions are the half of this
        // product a machine does not do, so they are the last number on that
        // page that should be the one without a line.
        //
        // No sandbox column on this table: a decision belongs to the check it
        // concludes, so the join carries the scope.
        db.query(
            `SELECT ${g.column.replace(/\bat\b/g, 'd.at')} AS d, count(*)::int AS n
               FROM check_decisions d
               JOIN screenings s ON s.id = d.screening_id
              WHERE d.org_id = $1 AND d.at >= $2 AND d.at < $3 AND s.sandbox = $4
           GROUP BY 1 ORDER BY 1`,
            args
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
        decisionDays: fillDays(signed.rows, from, to, zone, grain),
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
// The kinds of work one window's screenings were, day by day.
//
// A screening already says what it was: the kind column has held 'live' and
// 'history' since the first sweep was written, and nothing read it. The
// screenings section splits the allowance by it, and each part has to be a
// line of its own the chart can switch to -- so it is counted per day, per
// kind, and per scope in one pass, and cut up here.
//
// The kinds not written yet are asked for by name anyway. They come back
// empty today, and the day a re-screen is recorded as 'rescreen' it is
// counted here without anybody touching this.
//
// "Other" is the scope not being looked at. On the production view that is
// sandbox work, which spends nothing and is shown so the reader can see it
// spends nothing; on the sandbox view it is left out, because there is no
// cell for it to go in.
const KINDS = ['live', 'history', 'rescreen', 'transaction', 'bulk'];

async function kindsIn(orgId, from, to, sandbox, zone, grain) {
    to = until(to);
    const g = grain || GRAIN.day;
    const rows = await db.query(
        `SELECT ${g.column.replace(/\$5/g, '$4')} AS d, kind, sandbox,
                count(*)::int AS n,
                count(*) FILTER (WHERE verdict <> 'clear')::int AS flagged
           FROM screenings
          WHERE org_id = $1 AND at >= $2 AND at < $3
       GROUP BY 1, 2, 3 ORDER BY 1`,
        [Number(orgId), from, to, zone]
    );
    const pick = (keep) => {
        const byDay = new Map();
        let total = 0;
        rows.rows.filter(keep).forEach((r) => {
            const was = byDay.get(r.d) || { d: r.d, n: 0, flagged: 0 };
            was.n += r.n;
            was.flagged += r.flagged;
            byDay.set(r.d, was);
            total += r.n;
        });
        return { total, days: fillDays([...byDay.values()], from, to, zone, grain) };
    };
    const out = {};
    KINDS.forEach((k) => {
        out[k] = pick((r) => r.kind === k && r.sandbox === Boolean(sandbox));
    });
    out.other = sandbox ? null : pick((r) => r.sandbox === true);
    return out;
}

// What people did with what the screenings found, over one window.
//
// Bucketed on the decision's own time, as the summary's count already is: a
// check made in June and signed off in October is October's work. Every row a
// person wrote is counted -- taking one up, putting it on hold, concluding it
// -- and split by what it said, so the card can draw any of them and the line
// under "Decisions" can carry the confirmed ones the way the screenings card
// carries the flagged ones.
//
// How long a conclusion took is counted only for the two that close a finding.
// Putting one on hold is not an answer, and timing it as one would make a team
// that parks everything look fast.
const REVIEW_STATES = ['cleared', 'confirmed', 'holding'];

async function reviewIn(orgId, from, to, sandbox, zone, grain) {
    to = until(to);
    const g = grain || GRAIN.day;
    const args = [Number(orgId), from, to, Boolean(sandbox), zone];
    const [days, took] = await Promise.all([
        db.query(
            `SELECT ${g.column.replace(/\bat\b/g, 'd.at')} AS d, d.decision AS state, count(*)::int AS n
               FROM check_decisions d
               JOIN screenings s ON s.id = d.screening_id
              WHERE d.org_id = $1 AND d.at >= $2 AND d.at < $3 AND s.sandbox = $4
           GROUP BY 1, 2`,
            args
        ),
        db.query(
            `SELECT count(*) FILTER (WHERE d.at - s.at < interval '1 hour')::int AS hour,
                    count(*) FILTER (WHERE d.at - s.at >= interval '1 hour'
                                       AND d.at - s.at < interval '1 day')::int AS day,
                    count(*) FILTER (WHERE d.at - s.at >= interval '1 day'
                                       AND d.at - s.at < interval '7 days')::int AS week,
                    count(*) FILTER (WHERE d.at - s.at >= interval '7 days')::int AS longer
               FROM check_decisions d
               JOIN screenings s ON s.id = d.screening_id
              WHERE d.org_id = $1 AND d.at >= $2 AND d.at < $3 AND s.sandbox = $4
                AND d.decision IN ('cleared', 'confirmed')`,
            args.slice(0, 4)
        ),
    ]);

    const series = (keep) => {
        const byDay = new Map();
        let total = 0;
        days.rows.filter(keep).forEach((r) => {
            const was = byDay.get(r.d) || { d: r.d, n: 0, flagged: 0 };
            was.n += r.n;
            if (r.state === 'confirmed') was.flagged += r.n;
            byDay.set(r.d, was);
            total += r.n;
        });
        return { total, days: fillDays([...byDay.values()], from, to, zone, grain) };
    };
    const out = { decisions: series(() => true) };
    REVIEW_STATES.forEach((k) => { out[k] = series((r) => r.state === k); });
    const t = took.rows[0] || {};
    out.took = { hour: t.hour || 0, day: t.day || 0, week: t.week || 0, longer: t.longer || 0 };
    return out;
}

// The queue as it stands, whatever window is open: a finding nobody has
// concluded about is waiting now, not in a period.
async function queueNow(orgId, sandbox) {
    const r = await db.query(
        `SELECT count(*) FILTER (WHERE decision = '')::int AS open,
                count(*) FILTER (WHERE decision = 'holding')::int AS holding,
                min(at) FILTER (WHERE decision IN ('', 'holding')) AS oldest,
                count(*) FILTER (WHERE decision = '' AND at >= now() - interval '1 day')::int AS d1,
                count(*) FILTER (WHERE decision = '' AND at < now() - interval '1 day'
                                   AND at >= now() - interval '7 days')::int AS d7,
                count(*) FILTER (WHERE decision = '' AND at < now() - interval '7 days'
                                   AND at >= now() - interval '30 days')::int AS d30,
                count(*) FILTER (WHERE decision = '' AND at < now() - interval '30 days')::int AS older
           FROM screenings
          WHERE org_id = $1 AND sandbox = $2 AND verdict <> 'clear'`,
        [Number(orgId), Boolean(sandbox)]
    );
    const q = r.rows[0] || {};
    return {
        open: q.open || 0,
        holding: q.holding || 0,
        oldest: q.oldest || null,
        age: { day: q.d1 || 0, week: q.d7 || 0, month: q.d30 || 0, older: q.older || 0 },
    };
}

// Addresses watched after their first check, and what changed about them.
//
// Nothing writes this yet: there is no table of watched addresses and no job
// that re-checks them. It is the shape the screen is built against, with every
// count at nought and every day of the window present, so the section draws a
// true picture of an organisation that is watching nothing -- and the day the
// monitor exists, this is the one function that changes.
const ALERT_REASONS = ['listing', 'exposure', 'watchlist', 'score'];
const MONITOR_LINES = ['alerts', 'added', 'removed', 'matches', 'rechecks', 'resolved'];

async function monitoringIn(orgId, from, to, sandbox, zone, grain) {
    to = until(to);
    const empty = () => ({ total: 0, days: fillDays([], from, to, zone, grain) });
    const out = { watched: 0, watchlist: 0, lastAlert: null };
    MONITOR_LINES.forEach((k) => { out[k] = empty(); });
    out.byReason = {};
    ALERT_REASONS.forEach((k) => { out.byReason[k] = 0; });
    out.byRisk = { clear: 0, review: 0, severe: 0 };
    return out;
}

// The lists every check is matched against, and what changed on them.
//
// Counted from the list itself wherever the list says it. An address on our
// copy carries the moment it was first loaded, so additions by day are a true
// count, and so is the number of people and entities they belong to; the first
// load shows as one tall day, because that is when it happened. What is on the
// lists now -- by list, by sanctions programme, by chain -- is the table as it
// stands, and how often it is fetched again is the refresh job's own setting.
//
// The rest is the shape the screen is built against, at nought: no history of
// refreshes is kept, a delisted address is simply gone, nothing re-screens past
// checks when a list changes, no list but OFAC's is loaded, and no address is
// attributed to a sanctioned entity beyond the ones the list names. Each of
// those fills in when the thing that would count it exists.
//
// A sanctions list is the same list for everybody, so none of this is the
// organisation's own, and none of it depends on the scope.
const LIST_LINES = ['updates', 'added', 'entities', 'removed', 'rescreens', 'hits'];
const LISTS = ['ofac', 'ofacOther', 'eu', 'uk', 'un', 'ca', 'au', 'ch', 'jp'];

// What a programme is about, the way an analyst asks it: not CYBER2 or DPRK4
// but "cyber" and "North Korea". An address listed under several is counted
// once, under the first, so the themes add up to the addresses on the list.
const PROGRAMME_THEMES = [
    ['cyber', /^CYBER/],
    ['dprk', /^DPRK/],
    ['russia', /RUSSIA|UKRAINE|ELECTION/],
    ['iran', /^IRAN|^IRGC|^HRIT-IR|^IFSR/],
    ['terror', /^FTO$|^SDGT$/],
    ['drugs', /ILLICIT-DRUGS|^SDNTK$/],
    ['crime', /^TCO$/],
    ['weapons', /^NPWMD$/],
];
function themeOf(programs) {
    const first = String(programs || '').split(',')[0].trim();
    for (const [key, test] of PROGRAMME_THEMES) if (test.test(first)) return key;
    return 'other';
}

async function listsIn(from, to, zone, grain) {
    to = until(to);
    const g = grain || GRAIN.day;
    const col = g.column.replace(/\bat\b/g, 'added_at').replace(/\$5/g, '$3');
    const [added, chains, programmes, who] = await Promise.all([
        db.query(
            `SELECT ${col} AS d, count(*)::int AS n, count(DISTINCT entity_uid)::int AS entities
               FROM sanctioned_addresses
              WHERE added_at >= $1 AND added_at < $2
           GROUP BY 1`,
            [from, to, zone]
        ),
        db.query('SELECT asset, count(*)::int AS n FROM sanctioned_addresses GROUP BY 1 ORDER BY 2 DESC, 1'),
        db.query('SELECT programs, count(*)::int AS n FROM sanctioned_addresses GROUP BY 1'),
        db.query(
            `SELECT count(DISTINCT entity_uid)::int AS n,
                    count(DISTINCT entity_uid) FILTER (WHERE entity_type = 'Individual')::int AS people
               FROM sanctioned_addresses`
        ),
    ]);
    const empty = () => ({ total: 0, days: fillDays([], from, to, zone, grain) });
    const out = {};
    LIST_LINES.forEach((k) => { out[k] = empty(); });
    out.added = {
        total: added.rows.reduce((a, r) => a + r.n, 0),
        days: fillDays(added.rows, from, to, zone, grain),
    };
    // a person or entity added in two batches on two days is counted on each:
    // what a day shows is who was named that day
    out.entities = {
        total: added.rows.reduce((a, r) => a + r.entities, 0),
        days: fillDays(added.rows.map((r) => ({ d: r.d, n: r.entities })), from, to, zone, grain),
    };

    const onList = chains.rows.reduce((a, r) => a + r.n, 0);
    out.byList = {};
    LISTS.forEach((k) => { out.byList[k] = 0; });
    out.byList.ofac = onList;
    out.byChain = chains.rows.map((r) => ({ asset: r.asset, n: r.n }));
    out.byTheme = {};
    PROGRAMME_THEMES.forEach(([k]) => { out.byTheme[k] = 0; });
    out.byTheme.other = 0;
    programmes.rows.forEach((r) => { out.byTheme[themeOf(r.programs)] += r.n; });

    const w = who.rows[0] || {};
    out.state = {
        lists: LISTS.length,
        addresses: onList,
        entities: w.n || 0,
        people: w.people || 0,
        attributed: 0,
        refreshEveryMs: sanctions.refreshEveryMs(),
    };
    return out;
}

// What an organisation's own systems asked of the API, and what it sent back.
//
// The tokens are real: which are live, and which project each answers for. The
// traffic is the shape the screen is built against, at nought -- requests are
// not logged per token, a screening does not record whether it came from a
// token or the dashboard, and there are no webhooks to deliver. The endpoints
// are the five a token can call today, so that row fills in by name the day
// requests are counted.
const API_LINES = ['calls', 'screens', 'limited', 'errors', 'deliveries', 'failed'];
const API_ENDPOINTS = [
    'POST /v1/screen',
    'GET /v1/screenings',
    'GET /v1/screenings/stats',
    'GET /v1/screenings/:id',
    'GET /v1/screenings/:id/evidence',
];

async function apiIn(orgId, from, to, zone, grain) {
    to = until(to);
    const empty = () => ({ total: 0, days: fillDays([], from, to, zone, grain) });
    const out = {};
    API_LINES.forEach((k) => { out[k] = empty(); });
    out.byEndpoint = API_ENDPOINTS.map((path) => ({ path, n: 0 }));
    const tokens = await db.query(
        `SELECT t.project_id AS id, p.name AS name, count(*)::int AS n
           FROM api_tokens t
           LEFT JOIN projects p ON p.id = t.project_id
          WHERE t.org_id = $1 AND t.revoked_at IS NULL
            AND (t.expires_at IS NULL OR t.expires_at > now())
       GROUP BY 1, 2 ORDER BY 3 DESC`,
        [Number(orgId)]
    );
    out.byProject = tokens.rows.map((r) => ({ id: r.id ? String(r.id) : '', name: r.name || '', n: r.n }));
    out.webhooks = 0;
    out.answerMs = null;
    return out;
}

// The people in an organisation and the projects they work in, over one window.
//
// Counted from what is kept: when each member joined, every invite sent and
// when it was accepted, each sign-in a member's sessions record, and when each
// project was made. Who holds which role, who has a second factor on, what is
// still waiting to be accepted and when each member last signed in are the
// table as it stands.
//
// A member who leaves is simply removed, so departures have no history and
// that line is at nought until removals are recorded. A sign-in is a session
// begun, and sessions are pruned per person, so a busy member's oldest ones
// are not there to count: it says at least, never more than happened.
const TEAM_LINES = ['joined', 'left', 'invited', 'accepted', 'signins', 'projects'];

async function teamIn(orgId, from, to, zone, grain) {
    to = until(to);
    const g = grain || GRAIN.day;
    const on = (col) => g.column.replace(/\bat\b/g, col);
    const args = [Number(orgId), from, to, zone];
    const day = (col, table, where) => db.query(
        `SELECT ${on(col).replace(/\$5/g, '$4')} AS d, count(*)::int AS n
           FROM ${table}
          WHERE ${where} AND ${col} >= $2 AND ${col} < $3
       GROUP BY 1`, args);
    const [joined, invited, acceptedRows, signins, made, now] = await Promise.all([
        day('created_at', 'memberships', 'org_id = $1'),
        day('created_at', 'invites', 'org_id = $1'),
        day('accepted_at', 'invites', 'org_id = $1'),
        day('s.created_at', 'sessions s JOIN memberships m ON m.user_id = s.user_id', 'm.org_id = $1'),
        day('created_at', 'projects', 'org_id = $1'),
        db.query(
            `SELECT
                (SELECT count(*) FROM invites WHERE org_id = $1 AND accepted_at IS NULL
                    AND revoked_at IS NULL AND expires_at > now())::int AS pending,
                (SELECT count(*) FROM memberships m JOIN users u ON u.id = m.user_id
                    WHERE m.org_id = $1 AND u.totp_at IS NOT NULL)::int AS mfa,
                (SELECT json_object_agg(role, n) FROM (
                    SELECT role, count(*)::int AS n FROM memberships WHERE org_id = $1 GROUP BY role) r) AS roles,
                (SELECT json_build_object(
                    'today', count(*) FILTER (WHERE u.last_login_at >= now() - interval '1 day'),
                    'week', count(*) FILTER (WHERE u.last_login_at < now() - interval '1 day'
                                               AND u.last_login_at >= now() - interval '7 days'),
                    'month', count(*) FILTER (WHERE u.last_login_at < now() - interval '7 days'
                                                AND u.last_login_at >= now() - interval '30 days'),
                    'older', count(*) FILTER (WHERE u.last_login_at < now() - interval '30 days'),
                    'never', count(*) FILTER (WHERE u.last_login_at IS NULL))
                   FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1) AS seen`,
            [Number(orgId)]
        ),
    ]);
    const line = (r) => ({ total: r.rows.reduce((a, x) => a + x.n, 0), days: fillDays(r.rows, from, to, zone, grain) });
    const out = {};
    TEAM_LINES.forEach((k) => { out[k] = { total: 0, days: fillDays([], from, to, zone, grain) }; });
    out.joined = line(joined);
    // invites sent, with the accepted ones as the card's second line
    out.invited = line(invited);
    const acc = new Map(acceptedRows.rows.map((r) => [r.d, r.n]));
    out.invited.days = out.invited.days.map((d) => ({ ...d, flagged: acc.get(d.day) || 0 }));
    out.accepted = line(acceptedRows);
    out.signins = line(signins);
    out.projects = line(made);
    const st = now.rows[0] || {};
    out.state = {
        pending: st.pending || 0,
        mfa: st.mfa || 0,
        roles: st.roles || {},
        seen: st.seen || { today: 0, week: 0, month: 0, older: 0, never: 0 },
    };
    return out;
}

// The record this organisation could hand to a regulator, and what has been
// done with it.
//
// Every check and every decision is sealed with a digest when it is written,
// so what is sealed in a window is counted from the rows themselves, and so is
// what is on record now: how many, the oldest, and how old the rest are. The
// time it is kept for is the retention the product commits to -- five years,
// the period the AML directives and the travel rule both ask a firm to keep
// its customer due diligence for.
//
// What people did with it is the shape the screen is built against, at
// nought: exports, evidence files opened and usage files downloaded are not
// logged, and nothing re-verifies a digest on a schedule yet.
const EVIDENCE_LINES = ['sealed', 'decisions', 'exports', 'opened', 'downloads', 'verified'];
const RETENTION_YEARS = 5;

async function evidenceIn(orgId, from, to, sandbox, zone, grain) {
    to = until(to);
    const g = grain || GRAIN.day;
    const args = [Number(orgId), from, to, Boolean(sandbox), zone];
    const [checks, decided, now] = await Promise.all([
        db.query(
            `SELECT ${g.column} AS d, count(*)::int AS n
               FROM screenings
              WHERE org_id = $1 AND at >= $2 AND at < $3 AND sandbox = $4 AND digest <> ''
           GROUP BY 1`,
            args
        ),
        db.query(
            `SELECT ${g.column.replace(/\bat\b/g, 'd.at')} AS d, count(*)::int AS n
               FROM check_decisions d JOIN screenings s ON s.id = d.screening_id
              WHERE d.org_id = $1 AND d.at >= $2 AND d.at < $3 AND s.sandbox = $4 AND d.digest <> ''
           GROUP BY 1`,
            args
        ),
        db.query(
            `SELECT count(*)::int AS checks,
                    count(*) FILTER (WHERE digest <> '')::int AS sealed,
                    min(at) AS oldest,
                    count(*) FILTER (WHERE at >= now() - interval '30 days')::int AS a30,
                    count(*) FILTER (WHERE at < now() - interval '30 days'
                                       AND at >= now() - interval '90 days')::int AS a90,
                    count(*) FILTER (WHERE at < now() - interval '90 days'
                                       AND at >= now() - interval '365 days')::int AS a365,
                    count(*) FILTER (WHERE at < now() - interval '365 days')::int AS older,
                    (SELECT count(*) FROM check_decisions d JOIN screenings s2 ON s2.id = d.screening_id
                      WHERE d.org_id = $1 AND s2.sandbox = $2 AND d.digest <> '')::int AS decisions
               FROM screenings
              WHERE org_id = $1 AND sandbox = $2`,
            [Number(orgId), Boolean(sandbox)]
        ),
    ]);
    const line = (r) => ({ total: r.rows.reduce((a, x) => a + x.n, 0), days: fillDays(r.rows, from, to, zone, grain) });
    const out = {};
    EVIDENCE_LINES.forEach((k) => { out[k] = { total: 0, days: fillDays([], from, to, zone, grain) }; });
    out.sealed = line(checks);
    out.decisions = line(decided);
    const n = now.rows[0] || {};
    out.state = {
        checks: n.checks || 0,
        sealed: n.sealed || 0,
        decisions: n.decisions || 0,
        oldest: n.oldest || null,
        retentionYears: RETENTION_YEARS,
        lastExport: null,
        age: { month: n.a30 || 0, quarter: n.a90 || 0, year: n.a365 || 0, older: n.older || 0 },
    };
    return out;
}

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

        const [work, shape, shapeBefore, past, marks, ghost, spent, kinds, kindsBefore, review, reviewBefore, waiting, watching, watchingBefore, lists, listsBefore, api, apiBefore, team, teamBefore, evidence, evidenceBefore] = await Promise.all([
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
                    // and the sweeps in it, which have an allowance of their own
                    `SELECT count(*)::int AS n,
                            count(*) FILTER (WHERE kind = 'history')::int AS sweeps
                       FROM screenings
                      WHERE org_id = $1 AND at >= $2 AND at < $3 AND sandbox = $4`,
                    [Number(orgId), cycle.from, until(cycle.to), Boolean(sandbox)]
                ),
            kindsIn(orgId, period.from, period.to, sandbox, zone, grain),
            kindsIn(orgId, before.from, before.to, sandbox, zone, grain),
            reviewIn(orgId, period.from, period.to, sandbox, zone, grain),
            reviewIn(orgId, before.from, before.to, sandbox, zone, grain),
            queueNow(orgId, sandbox),
            monitoringIn(orgId, period.from, period.to, sandbox, zone, grain),
            monitoringIn(orgId, before.from, before.to, sandbox, zone, grain),
            listsIn(period.from, period.to, zone, grain),
            listsIn(before.from, before.to, zone, grain),
            apiIn(orgId, period.from, period.to, zone, grain),
            apiIn(orgId, before.from, before.to, zone, grain),
            teamIn(orgId, period.from, period.to, zone, grain),
            teamIn(orgId, before.from, before.to, zone, grain),
            evidenceIn(orgId, period.from, period.to, sandbox, zone, grain),
            evidenceIn(orgId, before.from, before.to, sandbox, zone, grain),
        ]);
        const head = past.rows[0] || null;
        return {
            ok: true,
            period,
            periods: list,
            scope: sandbox ? 'sandbox' : 'live',
            zone,
            screenings: work,
            kinds,
            review: Object.assign({}, review, { queue: waiting }),
            monitoring: watching,
            lists,
            api,
            team,
            evidence,
            marks,
            // what the plan's allowance is measured against, always the cycle
            cycle: cycle ? {
                from: cycle.from,
                to: cycle.to,
                used: sameWindow ? work.total : ((spent && spent.rows[0]) || { n: 0 }).n,
                sweeps: sameWindow
                    ? (kinds && kinds.history ? kinds.history.total : 0)
                    : ((spent && spent.rows[0]) || { sweeps: 0 }).sweeps,
            } : null,
            previous: head ? {
                from: before.from, to: before.to,
                total: head.n, flagged: head.flagged, severe: head.severe,
                addresses: head.addresses, assetCount: head.assets,
                // Counted the same way as this window's, so the two can be
                // subtracted. A number beside a number from a different kind
                // of question is not a comparison.
                decisions: shapeBefore ? shapeBefore.decisions : 0,
                kinds: kindsBefore,
                review: reviewBefore,
                monitoring: watchingBefore,
                lists: listsBefore,
                api: apiBefore,
                team: teamBefore,
                evidence: evidenceBefore,
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
