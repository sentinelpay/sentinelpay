'use strict';

// Where the dates sit along the bottom of the usage chart.
//
// The rule is one a reader can check without being told it: the marks are
// evenly spaced, there are never more than five, and the first and last are
// the first and last day of the window. An axis that breaks any of those is
// still readable one label at a time, and still wrong -- unequal gaps drawn
// as unequal widths look like they mean something.
//
// This reads the function out of the shipped file rather than keeping a copy,
// because a copy is a thing that agrees with the product until it does not.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'dash-app.js'), 'utf8');

function lift(name) {
    const at = SRC.indexOf('function ' + name + '(');
    assert.notStrictEqual(at, -1, 'dash-app.js no longer has a ' + name + '()');
    let i = SRC.indexOf('{', at);
    let depth = 0;
    const from = i;
    do {
        if (SRC[i] === '{') depth++;
        else if (SRC[i] === '}') depth--;
        i++;
    } while (depth > 0 && i < SRC.length);
    assert.strictEqual(depth, 0, name + '() has unbalanced braces');
    return SRC.slice(at, i);
}

const MOST = Number(/var MOST_TICKS = (\d+);/.exec(SRC)[1]);
const list = (name) => JSON.parse(
    new RegExp('var ' + name + ' = (\\[[^\\]]*\\]);').exec(SRC)[1]);
// eslint-disable-next-line no-new-func
const ticks = new Function(
    'shortDay', 'isHourBucket', 'MOST_TICKS', 'NICE_DAYS', 'NICE_HOURS',
    lift('ticks') + '; return ticks;'
)((iso) => iso, (key) => String(key).length > 10, MOST, list('NICE_DAYS'), list('NICE_HOURS'));

// Days as the chart gets them: one row each, in order, named by date.
function window_(n, from) {
    const start = Date.UTC(2026, 8, from === undefined ? 20 : from);
    const out = [];
    for (let i = 0; i < n; i++) {
        out.push({ day: new Date(start + i * 86400000).toISOString().slice(0, 10), n: 0 });
    }
    return out;
}
const dayOf = (label) => Number(String(label).slice(8, 10));

test('five at the most, however long the window', () => {
    for (let n = 1; n <= 400; n++) {
        assert.ok(ticks(window_(n)).length <= MOST,
            n + ' days produced more than ' + MOST + ' marks');
    }
});

test('the gaps along the axis are the same, but for the last', () => {
    for (let n = 1; n <= 400; n++) {
        const at = ticks(window_(n)).map((t) => t.at);
        if (at.length < 3) continue;
        const step = at[1] - at[0];
        // Every gap but the final one. A window whose length has no divisor
        // small enough cannot both step evenly and end on its last bucket,
        // and ending on it is worth more: a short gap at the end of a line
        // reads as the line stopping, where an uneven gap in the middle
        // reads as the axis lying.
        for (let i = 1; i < at.length - 1; i++) {
            assert.strictEqual(at[i] - at[i - 1], step,
                n + ' days: gaps ' + at.join(', ') + ' are not equal before the end');
        }
        // Measured across every length from three to four hundred, the final
        // gap lands between half a step and one and a half: appending leaves
        // the remainder, replacing leaves the remainder plus a step, and half
        // a step is where the rule swaps between them.
        const lastGap = at[at.length - 1] - at[at.length - 2];
        assert.ok(lastGap >= step * 0.5 && lastGap <= step * 1.5,
            n + ' days: the final gap of ' + lastGap + ' is out of step with ' + step);
    }
});

test('the axis begins on the first day and ends on the last', () => {
    for (let n = 1; n <= 400; n++) {
        const days = window_(n);
        const out = ticks(days);
        assert.strictEqual(out[0].at, 0, n + ' days: the axis does not start at the first day');
        assert.strictEqual(out[0].label, days[0].day);
        // Both ends, always. The first mark sitting against the left edge
        // while the last stopped short of the right read as an axis that had
        // run out rather than one that had been measured.
        assert.strictEqual(out[out.length - 1].at, n - 1,
            n + ' days: the axis does not end on the last day');
        assert.strictEqual(out[out.length - 1].label, days[n - 1].day);
    }
});

// Two labels a day apart at the end of a year of work is a collision, not a
// reading: where the end falls close to the mark before it, it takes that
// mark's place rather than crowding against it.
test('the end never crowds the mark before it', () => {
    for (let n = 3; n <= 400; n++) {
        const at = ticks(window_(n)).map((t) => t.at);
        if (at.length < 3) continue;
        const step = at[1] - at[0];
        assert.ok(at[at.length - 1] - at[at.length - 2] >= step * 0.5,
            n + ' days: ' + at.join(', ') + ' ends with two marks on top of each other');
    }
});

test('every label is a day that is really in the window', () => {
    for (let n = 1; n <= 200; n++) {
        const days = window_(n);
        const have = new Set(days.map((d) => d.day));
        for (const t of ticks(days)) {
            assert.ok(have.has(t.label), n + ' days: "' + t.label + '" is not one of them');
        }
    }
});

test('no day is named twice', () => {
    for (let n = 1; n <= 200; n++) {
        const labels = ticks(window_(n)).map((t) => t.label);
        assert.strictEqual(new Set(labels).size, labels.length,
            n + ' days: the same date appears more than once');
    }
});

test('a short window names every day it has', () => {
    for (let n = 1; n <= MOST; n++) {
        const out = ticks(window_(n));
        assert.strictEqual(out.length, n);
        assert.deepStrictEqual(out.map((t) => t.at), window_(n).map((d, i) => i));
    }
});

// The case that was reported: a billing cycle eight days into its run. Five
// evenly spaced marks cannot land on evenly spaced days across seven of them,
// so it stepped 2, 2, 1, 2 and looked exactly as wrong as it was.
test('eight days step by two, not by two two one two', () => {
    const out = ticks(window_(8)).map((t) => dayOf(t.label));
    // seven has no divisor that leaves three marks, so the end takes the
    // place of the mark before it and the axis still closes on the 27th
    assert.deepStrictEqual(out, [20, 22, 24, 26, 27]);
});

// An hour window divides by four, which is why this only ever looked wrong on
// a billing cycle.
test('a day of hours steps by six', () => {
    const hours = [];
    const start = Date.UTC(2026, 8, 26, 12);
    for (let i = 0; i < 25; i++) {
        const d = new Date(start + i * 3600000).toISOString();
        hours.push({ day: d.slice(0, 10) + ' ' + d.slice(11, 13) + ':00', n: 0 });
    }
    const out = ticks(hours);
    assert.deepStrictEqual(out.map((t) => t.at), [0, 6, 12, 18, 24]);
});

// The two cases that were described when this was reported.
test('20 september to 28 reads 20, 22, 24, 26, 28', () => {
    const out = ticks(window_(9)).map((t) => dayOf(t.label));
    assert.deepStrictEqual(out, [20, 22, 24, 26, 28]);
});

test('20 september to 22 reads 20, 21, 22', () => {
    const out = ticks(window_(3)).map((t) => dayOf(t.label));
    assert.deepStrictEqual(out, [20, 21, 22]);
});

// Both of the shapes this has been wrong in, kept as the things that must not
// come back: marks at uneven positions, and marks at even positions naming
// unevenly spaced days.
test('neither of the old axes comes back', () => {
    const at = ticks(window_(8)).map((t) => t.at);
    assert.notDeepStrictEqual(at, [0, 2, 4, 5, 7], 'the uneven positions are back');
    assert.notDeepStrictEqual(at, [0, 1.75, 3.5, 5.25, 7], 'the uneven dates are back');
    assert.notDeepStrictEqual(at, [0, 2, 4, 6], 'the axis stops short of the end again');
    for (const v of at) {
        assert.strictEqual(v, Math.round(v), 'a mark landed between two days');
    }
});

// Every mark on a whole bucket, so every label names the day it is drawn over
// rather than the day nearest to where it happened to land.
test('no mark falls between two days', () => {
    for (let n = 1; n <= 400; n++) {
        for (const t of ticks(window_(n))) {
            assert.strictEqual(t.at, Math.round(t.at), n + ' days: a mark landed at ' + t.at);
        }
    }
});
