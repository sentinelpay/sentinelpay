'use strict';

// A period is what an invoice covers and what the usage screen counts inside.
// If the arithmetic slips by a day, one of two things happens and neither is
// noticed at the time: a screening is counted in a month it did not happen in,
// or a subscription is billed for a month that already ended.
//
// The database parts of billing are covered by running it against a real
// postgres; what is here is the arithmetic, which needs no database and must
// never be wrong.

const test = require('node:test');
const assert = require('node:assert');
const months = require('../months.js');
const plans = require('../plans.js');

const at = (iso) => new Date(iso);
const day = (d) => d.toISOString().slice(0, 10);

test('a month later is the same day of the next month', () => {
    assert.equal(day(months.addMonths(at('2026-09-21T10:00:00Z'), 1)), '2026-10-21');
    assert.equal(day(months.addMonths(at('2026-09-21T10:00:00Z'), 12)), '2027-09-21');
    assert.equal(day(months.addMonths(at('2026-09-21T10:00:00Z'), 3)), '2026-12-21');
});

test('the time of day is kept, so a term does not drift to midnight', () => {
    const out = months.addMonths(at('2026-09-21T14:05:09.250Z'), 3);
    assert.equal(out.toISOString(), '2026-12-21T14:05:09.250Z');
});

test('a day that does not exist in the next month clamps down', () => {
    assert.equal(day(months.addMonths(at('2026-01-31T00:00:00Z'), 1)), '2026-02-28');
    assert.equal(day(months.addMonths(at('2026-03-31T00:00:00Z'), 1)), '2026-04-30');
    // and a leap year has the 29th
    assert.equal(day(months.addMonths(at('2028-01-31T00:00:00Z'), 1)), '2028-02-29');
});

test('the period around a moment contains it, and the next one begins where it ends', () => {
    const now = at('2026-09-21T12:00:00Z').getTime();
    const p = months.periodAround(at('2026-03-05T08:30:00Z'), now);
    assert.ok(p.from.getTime() <= now && now < p.to.getTime(), 'today is not inside its own period');
    assert.equal(day(p.from), '2026-09-05');
    assert.equal(day(p.to), '2026-10-05');
});

test('periods never overlap and never leave a gap, month after month', () => {
    // a year of them from a 31st anchor, which is where clamping could make two
    // periods share a day or skip one
    const anchor = at('2026-01-31T09:00:00Z');
    let cursor = months.startOfDay(anchor);
    for (let i = 0; i < 24; i++) {
        const next = months.addMonths(cursor, 1);
        const inside = months.periodAround(anchor, cursor.getTime() + 60000);
        assert.equal(inside.from.getTime(), cursor.getTime(),
            'period ' + i + ' does not begin where the last one ended');
        assert.equal(inside.to.getTime(), next.getTime());
        cursor = next;
    }
});

test('a period is whole days, so no date is both its last and the next one\'s first', () => {
    // bought at 17:37, the period used to run 17:37 to 17:37: its last instant
    // fell on the same date its successor began on, and the screen showed that
    // date at both ends of a window that then looked a day too long
    const p = months.periodAround(at('2026-09-20T17:37:07Z'), at('2026-10-01T00:00:00Z').getTime());
    assert.equal(p.from.toISOString(), '2026-09-20T00:00:00.000Z');
    assert.equal(p.to.toISOString(), '2026-10-20T00:00:00.000Z');
    const lastInstant = new Date(p.to.getTime() - 1);
    assert.equal(day(lastInstant), '2026-10-19', 'the period still ends on the day it next begins');
});

test('a period that has not started yet is the first one, not a walk backwards', () => {
    const p = months.periodAround(at('2026-12-01T00:00:00Z'), at('2026-09-21T00:00:00Z').getTime());
    assert.equal(day(p.from), '2026-12-01');
    assert.equal(day(p.to), '2027-01-01');
});

test('the catalogue is the prices the page shows', () => {
    // these are read back from the pricing page. changing one here without
    // changing it there is how a customer is charged something they were not
    // shown, so the numbers are written out rather than computed.
    assert.equal(plans.listPrice('starter', 'quarterly'), 29700);
    assert.equal(plans.listPrice('starter', 'yearly'), 98400);
    assert.equal(plans.listPrice('growth', 'quarterly'), 119700);
    assert.equal(plans.listPrice('growth', 'yearly'), 398400);
    assert.equal(plans.listPrice('enterprise', 'quarterly'), 447000);
    assert.equal(plans.listPrice('enterprise', 'yearly'), 1488000);
});

test('per scan has no list price, because it is billed on what was used', () => {
    assert.equal(plans.listPrice('growth', 'scan'), null);
    assert.equal(plans.term('scan').termMonths, null);
    assert.equal(plans.term('scan').metered, true);
});

test('a yearly term is twelve months and a quarterly one is three', () => {
    assert.equal(plans.term('yearly').termMonths, 12);
    assert.equal(plans.term('quarterly').termMonths, 3);
});

test('nothing outside the catalogue is a plan or a term', () => {
    assert.equal(plans.isPlan('trial'), false, 'a trial is not something you buy');
    assert.equal(plans.isPlan('verified'), false, 'that is a trial state, not a plan');
    assert.equal(plans.isPlan(''), false);
    assert.equal(plans.isTerm('monthly'), false, 'we do not sell a monthly term');
    assert.equal(plans.isTerm(null), false);
});

test('included allowances are the ones on the cards', () => {
    assert.equal(plans.plan('starter').screenings, 1000);
    assert.equal(plans.plan('starter').seats, 3);
    assert.equal(plans.plan('growth').screenings, 10000);
    assert.equal(plans.plan('growth').seats, 10);
    assert.equal(plans.plan('enterprise').screenings, 50000);
    assert.equal(plans.plan('enterprise').seats, 25);
});
