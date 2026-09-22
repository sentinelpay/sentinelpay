'use strict';

// Periods are date arithmetic, which is the kind of code that looks right and
// is wrong on the 31st. A cycle that overlaps the one before it counts the same
// screening twice; one that leaves a gap loses a day of work. Neither throws,
// and on a usage page nobody notices until somebody is asked to explain a
// number to an auditor.

const test = require('node:test');
const assert = require('node:assert');
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
    const text = usage.csv(out, { name: '=cmd|\' /c calc\'!A1' });
    assert.ok(text.indexOf("'=cmd") !== -1, 'the formula was not made inert');
    assert.ok(!/(^|,)=/m.test(text), 'a cell still begins with =');
});

test('every csv row has the same number of columns as its header', () => {
    const out = {
        period: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-04T00:00:00.000Z' },
        scope: 'sandbox',
        screenings: {
            total: 3, flagged: 1, clear: 2, addresses: 3, assetCount: 1,
            days: [{ day: '2026-09-01', n: 2, flagged: 1 }, { day: '2026-09-02', n: 1, flagged: 0 }],
        },
        org: { members: 2, projects: 1, tokensUsed: 0 },
    };
    const lines = usage.csv(out, { name: 'Acme, Inc' }).trim().split('\r\n');
    const head = lines.indexOf('Day,Screenings,Flagged');
    assert.ok(head !== -1, 'no day header');
    lines.slice(head).forEach((line) => {
        assert.equal(line.split(',').length, 3, 'wrong number of columns: ' + line);
    });
});
