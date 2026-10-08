'use strict';

// How a window is cut into buckets.
//
// This is the part of the usage page that has been wrong the most times, and
// always for the same reason: the walk that names the buckets, the query that
// groups the rows and the label that prints them disagreed about what a bucket
// is. None of those disagreements is visible in a screenshot unless you know
// the reader's timezone, so they are checked here instead.

const test = require('node:test');
const assert = require('node:assert');
const usage = require('../usage.js');

const HOUR = 3600000;
const DAY = 86400000;
const at = (iso) => new Date(iso).getTime();

test('a window is offered in hours as well as in days', () => {
    const list = usage.periods(at('2026-01-01T00:00:00Z'), at('2026-09-27T07:40:00Z'), null, 3);
    const keys = list.map((p) => p.key);
    assert.ok(keys.includes('h24'), 'no last-24-hours window');
    assert.ok(keys.includes('d7') && keys.includes('d30') && keys.includes('d90'),
        'the daily windows went missing');
    // a week of hours is a hundred and sixty eight points to say what seven
    // say better, so only the last day is counted that finely
    assert.ok(!keys.some((k) => k !== 'h24' && k[0] === 'h'),
        'only the last day should be counted by the hour');
    for (const p of list) {
        assert.ok(p.grain === 'day' || p.grain === 'hour',
            p.key + ' does not say how finely it is counted');
    }
    assert.strictEqual(list.find((p) => p.key === 'h24').grain, 'hour');
    assert.strictEqual(list.find((p) => p.key === 'd7').grain, 'day');
    assert.strictEqual(list.find((p) => p.key === 'd30').grain, 'day');
});

test('an hourly window is exactly as long as it says', () => {
    const now = at('2026-09-27T07:40:00Z');
    for (const [key, hours] of [['h24', 24]]) {
        const p = usage.periods(at('2020-01-01T00:00:00Z'), now, null, 3)
            .find((x) => x.key === key);
        assert.strictEqual(at(p.to) - at(p.from), hours * HOUR, key + ' is the wrong length');
    }
});

test('an hourly window never begins before the organisation did', () => {
    const now = at('2026-09-27T07:40:00Z');
    const born = now - 4 * HOUR;
    const p = usage.periods(born, now, new Date(born).toISOString(), 3)
        .find((x) => x.key === 'h24');
    assert.strictEqual(at(p.from), born,
        'a four hour old account should have four hours of history, not a day of nothing');
});

// The bug this replaces: an hourly window has no `days`, so it fell past the
// rolling branch and was compared against the whole month before it.
test('an hourly window is compared with the hours before it', () => {
    // a window that is over, so nothing here depends on what time the test
    // is run: a window still running is deliberately compared against only
    // as much of the one before as has elapsed
    const from = '2026-09-01T00:00:00.000Z';
    const to = '2026-09-02T00:00:00.000Z';
    const before = usage.previousOf({ key: 'h24', from, to, hours: 24, grain: 'hour' });
    assert.strictEqual(at(to) - at(from), 24 * HOUR);
    assert.strictEqual(at(before.to) - at(before.from), 24 * HOUR,
        'the window before is not the same length as the window');
    assert.strictEqual(at(before.to), at(from), 'the two windows do not meet');
});

const namesIn = (fromIso, toIso, zone, grain) =>
    usage.walkDays(at(fromIso), at(toIso), zone, grain);

test('a day of hours is twenty four of them, in order and once each', () => {
    for (const zone of ['UTC', 'Europe/Zagreb', 'America/Anchorage', 'Pacific/Kiritimati']) {
        // on the hour, so the window covers twenty four whole ones
        const out = namesIn('2026-09-26T06:00:00Z', '2026-09-27T05:59:59Z', zone, usage.GRAIN.hour);
        assert.strictEqual(out.length, 24, zone + ' produced ' + out.length + ' hours');
        assert.deepStrictEqual(out.slice().sort(), out, zone + ': the hours are out of order');
        assert.strictEqual(new Set(out).size, out.length, zone + ': an hour appears twice');
    }
});

// India and Nepal are half an hour and three quarters of an hour from UTC, so
// their hours begin where ours are halfway through. A window cut on a UTC hour
// therefore reaches into twenty five of theirs, and it owns all twenty five --
// the first and last hold part of an hour each. Bucketing in UTC would hide
// that by drawing their evening across two of our columns, which is the thing
// counting in the reader's zone exists to prevent.
test('a zone half an hour from utc keeps its own hours', () => {
    for (const zone of ['Asia/Kolkata', 'Asia/Kathmandu']) {
        const out = namesIn('2026-09-26T06:00:00Z', '2026-09-27T05:59:59Z', zone, usage.GRAIN.hour);
        assert.strictEqual(out.length, 25, zone + ' produced ' + out.length + ' hours');
        assert.strictEqual(new Set(out).size, out.length, zone + ': an hour appears twice');
        assert.deepStrictEqual(out.slice().sort(), out, zone + ': the hours are out of order');
    }
});

test('every hour is named in the reader own clock', () => {
    // 05:00 UTC is 07:00 in Zagreb, 22:00 the day before in Anchorage, and
    // half past ten in Kolkata -- which truncates to its ten, not to an hour
    // of UTC that Kolkata does not share.
    const one = (zone) => namesIn('2026-09-26T05:00:00Z', '2026-09-26T05:59:00Z', zone,
        usage.GRAIN.hour)[0];
    assert.strictEqual(one('UTC'), '2026-09-26 05:00');
    assert.strictEqual(one('Europe/Zagreb'), '2026-09-26 07:00');
    assert.strictEqual(one('America/Anchorage'), '2026-09-25 21:00');
    assert.strictEqual(one('Asia/Kolkata'), '2026-09-26 10:00');
    assert.strictEqual(one('Asia/Kathmandu'), '2026-09-26 10:00');
});

// Clocks going back repeat an hour of the reader's wall clock. The query
// groups by that same wall clock, so the row it returns already holds both --
// naming it once keeps the count whole. Naming it twice would draw the hour
// twice with the work split between two identical labels.
test('an hour that happens twice is named once', () => {
    // Europe/Zagreb turns its clocks back at 03:00 local on 25 October 2026
    const out = namesIn('2026-10-25T00:00:00Z', '2026-10-25T04:00:00Z',
        'Europe/Zagreb', usage.GRAIN.hour);
    assert.strictEqual(new Set(out).size, out.length,
        'the repeated hour was named twice: ' + out.join(', '));
});

test('a long window of hours is not silently cut short', () => {
    // a week of hours, which is more than the walk guard used to allow
    const out = namesIn('2026-09-20T07:00:00Z', '2026-09-27T06:59:00Z', 'Europe/Zagreb',
        usage.GRAIN.hour);
    assert.strictEqual(out.length, 168, 'a week of hours came out as ' + out.length);
});

test('days still behave exactly as they did', () => {
    // midnight to midnight in the reader's own zone, which in Zagreb is
    // 22:00 UTC the evening before
    const out = namesIn('2026-09-19T22:00:00Z', '2026-09-27T21:59:59Z', 'Europe/Zagreb',
        usage.GRAIN.day);
    assert.deepStrictEqual(out, [
        '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23',
        '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27',
    ]);
    assert.strictEqual(out.length * DAY, 8 * DAY);
});

// A bucket the window reaches into is a bucket the window has. Half an hour of
// work at ten to six belongs to the five o'clock hour and has to be drawn
// somewhere, so a window that starts at 05:40 touches twenty five hours rather
// than twenty four. The same rule, and the same arithmetic, for a day.
test('a window owns every bucket it reaches into', () => {
    const hours = namesIn('2026-09-26T05:40:00Z', '2026-09-27T05:39:59Z', 'UTC',
        usage.GRAIN.hour);
    assert.strictEqual(hours.length, 25);
    assert.strictEqual(hours[0], '2026-09-26 05:00');
    assert.strictEqual(hours[hours.length - 1], '2026-09-27 05:00');

    const days = namesIn('2026-09-20T09:15:00Z', '2026-09-22T01:00:00Z', 'UTC',
        usage.GRAIN.day);
    assert.deepStrictEqual(days, ['2026-09-20', '2026-09-21', '2026-09-22']);
});

test('the grain is chosen by the window, not guessed', () => {
    assert.strictEqual(usage.grainOf({ grain: 'hour' }), usage.GRAIN.hour);
    assert.strictEqual(usage.grainOf({ grain: 'day' }), usage.GRAIN.day);
    assert.strictEqual(usage.grainOf({}), usage.GRAIN.day);
    assert.strictEqual(usage.grainOf(null), usage.GRAIN.day);
    assert.strictEqual(usage.grainOf({ grain: 'fortnight' }), usage.GRAIN.day,
        'an unknown grain should fall back to a day rather than to nothing');
});

// The three places that have to agree about what a bucket is: the walk names
// them, postgres groups by them, and both have to produce the same string or
// the chart fills a real bucket with a zero.
test('the query and the walk agree on the shape of a key', () => {
    assert.match(usage.GRAIN.day.column, /'YYYY-MM-DD'/);
    assert.match(usage.GRAIN.hour.column, /'YYYY-MM-DD HH24:00'/);
    assert.match(namesIn('2026-09-26T05:00:00Z', '2026-09-26T05:10:00Z', 'UTC',
        usage.GRAIN.day)[0], /^\d{4}-\d{2}-\d{2}$/);
    assert.match(namesIn('2026-09-26T05:00:00Z', '2026-09-26T05:10:00Z', 'UTC',
        usage.GRAIN.hour)[0], /^\d{4}-\d{2}-\d{2} \d{2}:00$/);
    // and both name their bucket in the zone they are given, which is the
    // parameter postgres is handed as well
    assert.match(usage.GRAIN.hour.column, /AT TIME ZONE \$5/);
    assert.match(usage.GRAIN.day.column, /AT TIME ZONE \$5/);
});

// Each measure under the chart draws its own shape, so each needs its own
// series out of the bucket query. Dropping a column here does not break
// anything loudly: the field arrives undefined, the client reads it as zero,
// and the card shows a flat line for a measure that was never flat.
test('every measure under the chart has a series to draw', () => {
    const src = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '..', 'usage.js'), 'utf8');
    const at = src.indexOf('const [sum, days, verdicts, assets, byProject, signed]');
    assert.notStrictEqual(at, -1, 'screeningsIn no longer reads its windows in one go');
    const query = src.slice(at, at + 3600);
    for (const column of ['AS n', 'AS flagged', 'AS severe', 'AS addresses', 'AS assets']) {
        assert.ok(query.includes(column),
            'the bucket query no longer returns ' + column.replace('AS ', ''));
    }
    // Decisions are bucketed by their own time, not the screening's. A check
    // made in June and signed off in October is October's work, and joining on
    // the screening to get the scope makes it easy to bucket the wrong column.
    assert.ok(/FROM check_decisions d/.test(query), 'decisions are no longer bucketed');
    assert.ok(/d\.at >= \$2 AND d\.at < \$3/.test(query),
        'the decision bucket is cut on the screening date rather than the decision date');
    assert.ok(src.includes('decisionDays:'), 'the decision series never reaches the payload');
});
