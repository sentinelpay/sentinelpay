'use strict';

// Periods are date arithmetic, which is the kind of code that looks right and
// is wrong on the 31st. A cycle that overlaps the one before it counts the same
// screening twice; one that leaves a gap loses a day of work. Neither throws,
// and on a usage page nobody notices until somebody is asked to explain a
// number to an auditor.

const test = require('node:test');
const assert = require('node:assert');
const exports_ = require('../exports.js');
const usage = require('../usage.js');

const day = (iso) => new Date(iso).getTime();

test('a cycle runs from the plan\'s day of the month to the same day of the next', () => {
    const list = usage.cycles('2026-03-12T09:20:00Z', day('2026-09-20T12:00:00Z'), 3);
    assert.equal(list[0].from.slice(0, 10), '2026-09-12');
    assert.equal(list[0].to.slice(0, 10), '2026-10-12');
    assert.equal(list[0].current, true);
    assert.equal(list[1].from.slice(0, 10), '2026-08-12');
    assert.equal(list[1].to.slice(0, 10), '2026-09-12');
});

test('the current cycle is the one today is inside, not the one starting today', () => {
    // the 20th, with an anchor on the 25th: the cycle running now began last
    // month. picking this month's boundary would put today in the future.
    const list = usage.cycles('2026-01-25T00:00:00Z', day('2026-09-20T12:00:00Z'), 2);
    assert.equal(list[0].from.slice(0, 10), '2026-08-25');
    assert.equal(list[0].to.slice(0, 10), '2026-09-25');
});

test('cycles touch: no day belongs to two of them, and none belongs to none', () => {
    const list = usage.cycles('2026-01-31T00:00:00Z', day('2026-09-20T12:00:00Z'), 3);
    for (let i = 0; i < list.length - 1; i++) {
        assert.equal(list[i].from, list[i + 1].to,
            'cycle ' + i + ' does not begin where the one before it ends');
    }
});

test('a month with no 31st clamps down rather than spilling into the next', () => {
    // anchored on the 31st, the february cycle has to end on the 28th and the
    // march one begin there, or february is billed twice
    const list = usage.cycles('2026-01-31T00:00:00Z', day('2026-03-15T12:00:00Z'), 3);
    const starts = list.map((c) => c.from.slice(0, 10));
    assert.deepStrictEqual(starts, ['2026-02-28', '2026-01-31']);
});

test('nothing is offered from before the organisation existed', () => {
    const list = usage.cycles('2026-09-01T00:00:00Z', day('2026-09-20T12:00:00Z'), 3);
    assert.equal(list.length, 1);
    assert.equal(list[0].from.slice(0, 10), '2026-09-01');
});

test('the first cycle begins on the day the plan did, not on the boundary before it', () => {
    // a plan started mid-cycle has not been running for the whole of it, and a
    // page that says otherwise is claiming work from before there was a plan.
    // the day it began, though, not the minute: a cycle is whole days.
    const list = usage.cycles('2026-09-14T08:00:00Z', day('2026-09-20T12:00:00Z'), 3);
    assert.equal(list[0].from, '2026-09-14T00:00:00.000Z');
});

test('rolling windows are offered as well as the invoice\'s', () => {
    const list = usage.periods('2026-09-19T00:00:00Z', day('2026-09-20T12:00:00Z'));
    const keys = list.map((p) => p.key);
    assert.ok(keys.indexOf('d30') !== -1, 'no 30 day window');
    assert.ok(keys.indexOf('d90') !== -1, 'no 90 day window');
    const d30 = list[keys.indexOf('d30')];
    assert.equal(Math.round((day(d30.to) - day(d30.from)) / 86400000), 30);
});

test('a csv cell cannot become a formula', () => {
    // a spreadsheet runs a cell beginning with = or + as a formula, so an
    // organisation could be named into one. the name is data and stays data.
    const out = {
        period: { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' },
        scope: 'live',
        screenings: { total: 0, flagged: 0, clear: 0, addresses: 0, assetCount: 0, days: [] },
        org: { members: 0, projects: 0, tokensUsed: 0 },
    };
    const list = exports_.sheets(out, { name: '=cmd|\' /c calc\'!A1' }, null);
    const text = exports_.csv(list, { reference: exports_.reference(list), generated: '2026-10-01T00:00:00.000Z' });
    assert.ok(text.indexOf("'=cmd") !== -1, 'the formula was not made inert');
    assert.ok(!/(^|,)=/m.test(text), 'a cell still begins with =');
});

test('every csv row has the same number of columns as its sheet\'s header', () => {
    const out = {
        period: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-04T00:00:00.000Z' },
        scope: 'sandbox',
        screenings: {
            total: 3, flagged: 1, clear: 2, addresses: 3, assetCount: 1,
            days: [{ day: '2026-09-01', n: 2, flagged: 1 }, { day: '2026-09-02', n: 1, flagged: 0 }],
        },
        org: { members: 2, projects: 1, tokensUsed: 0 },
    };
    const list = exports_.sheets(out, { name: 'Acme, Inc' }, null);
    for (const sh of list) {
        for (const row of sh.rows) assert.equal(row.length, sh.head.length, sh.name + ': ' + row.join('|'));
    }
    const daily = list.find((sh) => sh.name === 'Daily');
    assert.equal(daily.rows.length, 2, 'a day went missing on the way into the file');
});

// One set of numbers, one reference: the same period printed and exported as a
// workbook has to be provably the same period.
test('every format carries the same reference over the same numbers', () => {
    const out = {
        period: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-03T00:00:00.000Z' },
        scope: 'live', zone: 'UTC',
        screenings: { total: 2, flagged: 1, clear: 1, addresses: 2, assetCount: 1,
            verdicts: { severe: 1, clear: 1 }, assets: [{ asset: 'XBT', n: 2 }], projects: [],
            days: [{ day: '2026-09-01', n: 1, flagged: 1, severe: 1 }, { day: '2026-09-02', n: 1, flagged: 0 }] },
        org: { members: 1, projects: 0 },
    };
    const list = exports_.sheets(out, { name: 'Acme' }, null);
    const meta = { reference: exports_.reference(list), generated: '2026-09-03T00:00:00.000Z', organisation: 'Acme', back: '/' };
    assert.match(meta.reference, /^[0-9a-f]{64}$/);
    assert.ok(exports_.csv(list, meta).includes(meta.reference), 'the csv has no reference');
    assert.equal(JSON.parse(exports_.json(list, meta, out)).reference, 'sha256:' + meta.reference);
    assert.ok(exports_.report(list, meta, out).includes(meta.reference), 'the report has no reference');
    const book = exports_.xlsx(list, meta);
    assert.equal(book.readUInt32LE(0), 0x04034b50, 'the workbook is not a zip');
    // and the same numbers give the same reference every time
    assert.equal(exports_.reference(exports_.sheets(out, { name: 'Acme' }, null)), meta.reference);
});

test('the workbook\'s checksums are the ones zip readers check', () => {
    assert.equal(exports_.crc32(Buffer.from('123456789')), 0xcbf43926);
});

// The database hands back dates as Date objects. Every format has to print
// them as the day they are, not as whatever String() of a Date begins with.
test('a date from the database prints as its own day in every format', () => {
    const out = {
        period: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z' },
        scope: 'live',
        screenings: { total: 0, days: [] },
        review: { queue: { open: 1, oldest: new Date('2026-06-12T11:59:55Z') } },
        evidence: { state: { oldest: new Date('2026-06-11T09:43:25Z') } },
        org: {},
    };
    const list = exports_.sheets(out, { name: 'Acme' }, null);
    const sum = new Map(list[0].rows);
    assert.equal(sum.get('Oldest open finding'), '2026-06-12');
    assert.equal(sum.get('Oldest record'), '2026-06-11');
    const meta = { reference: exports_.reference(list), generated: '2026-09-02T00:00:00.000Z', organisation: 'Acme', back: '/' };
    assert.ok(exports_.report(list, meta, out).includes('12 June 2026'), 'the report printed the wrong year');
});

// The production report leaves the sandbox out and says how much it left out;
// the sandbox report says on its face that it is not evidence. Neither counts
// the other scope's work among the kinds of work done.
test('a report counts one scope and says what it left out', () => {
    const base = {
        period: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-03T00:00:00.000Z' },
        zone: 'UTC',
        screenings: { total: 3, flagged: 0, clear: 3, verdicts: { clear: 3 }, assets: [], projects: [], days: [] },
        kinds: { live: { total: 3 }, other: { total: 7 } },
        previous: { from: '2026-08-30T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z', total: 2, flagged: 0, severe: 0 },
        cycle: { used: 3 },
        org: {},
    };
    const sub = { planName: 'Growth', included: { screenings: 1000 } };
    const live = { ...base, scope: 'live' };
    const sheets = exports_.sheets(live, { name: 'Acme' }, sub);
    const sum = new Map(sheets[0].rows.map((r) => [r[0], r]));
    assert.deepStrictEqual(sum.get('Screenings'), ['Screenings', 3, 2], 'the period before is not beside the figure');
    assert.equal(sum.get('Sandbox checks not included')[1], 7);
    const kinds = sheets.find((sh) => sh.name === 'Screenings').rows.filter((r) => r[0] === 'By kind').map((r) => r[1]);
    assert.ok(!kinds.includes('Sandbox screens'), 'the sandbox is counted among the work on the production report');
    const meta = { reference: exports_.reference(sheets), generated: '2026-09-03T00:00:00.000Z', organisation: 'Acme', back: '/' };
    const html = exports_.report(sheets, meta, live);
    assert.match(html, /7 sandbox checks were made in this period/);
    assert.doesNotMatch(html, /class="c-sbx"/);

    const sbx = { ...base, scope: 'sandbox' };
    const sheets2 = exports_.sheets(sbx, { name: 'Acme' }, sub);
    const html2 = exports_.report(sheets2, { ...meta, reference: exports_.reference(sheets2) }, sbx);
    assert.match(html2, /class="c-sbx"/, 'a sandbox report does not say it is the sandbox');
    assert.match(html2, /class="wm"/, 'a printed sandbox page carries no mark');
    assert.doesNotMatch(html2, /used this cycle/, 'the sandbox report claims to have spent the allowance');
    assert.ok(!new Map(sheets2[0].rows.map((r) => [r[0], r])).has('Sandbox checks not included'));
});

// The paper: a cover on its own page, the statement and its signatures before
// any figure, the figures after, and a page rule that sizes the paper and
// runs the reference and the page count along every page but the cover.
// A4 unless one of the other sizes it knows is asked for.
test('the report is laid out on the paper asked for, A4 when none is', () => {
    const out = {
        period: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-03T00:00:00.000Z' },
        scope: 'live', zone: 'UTC',
        screenings: { total: 1, verdicts: {}, assets: [], projects: [], days: [] },
        org: {},
    };
    const list = exports_.sheets(out, { name: 'Acme "</style><b>' }, null);
    const meta = { reference: exports_.reference(list), generated: '2026-09-03T00:00:00.000Z', organisation: 'Acme "</style><b>', back: '/' };
    assert.equal(exports_.paperOf(''), 'a4');
    assert.equal(exports_.paperOf('Letter'), 'letter');
    assert.equal(exports_.paperOf('tabloid'), 'a4', 'a size it does not know is not passed through');
    const html = exports_.report(list, meta, out);
    assert.match(html, /@page \{ size:210mm 297mm;/, 'the default is not A4');
    assert.match(html, /@bottom-right \{ content:"Page " counter\(page\) " of " counter\(pages\)/, 'pages are not numbered');
    assert.match(html, /@page :first \{ margin:0; @top-left \{ content:none; \}/, 'the cover carries the running head');
    const cover = html.indexOf('class="sheet cover"');
    const statement = html.indexOf('class="sheet statement"');
    const figures = html.indexOf('<h2>At a glance</h2>');
    assert.ok(cover !== -1 && cover < statement && statement < figures, 'the cover, the statement and the figures are out of order');
    assert.ok(html.slice(statement, figures).includes('Reviewed by'), 'the signatures are not with the statement');
    // a name cannot close the style it is quoted in
    const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    assert.ok(!style.includes('</style><b>'), 'the organisation name broke out of the stylesheet');
    for (const [key, w, h] of [['letter', 215.9, 279.4], ['legal', 215.9, 355.6], ['a3', 297, 420], ['a5', 148, 210]]) {
        assert.match(exports_.report(list, { ...meta, paper: key }, out), new RegExp('size:' + w + 'mm ' + h + 'mm;'), key);
    }
});
