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
// eslint-disable-next-line no-new-func
const ticks = new Function(
    'shortDay', 'MOST_TICKS',
    lift('ticks') + '; return ticks;'
)((iso) => iso, MOST);

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

test('the gaps along the axis are all the same', () => {
    for (let n = 1; n <= 400; n++) {
        const at = ticks(window_(n)).map((t) => t.at);
        if (at.length < 3) continue;
        const step = at[1] - at[0];
        for (let i = 1; i < at.length; i++) {
            // the positions are exact fractions, so this is arithmetic rather
            // than a rounding allowance: marks that differ by a hair are the
            // bug this test exists for
            assert.ok(Math.abs((at[i] - at[i - 1]) - step) < 1e-9,
                n + ' days: gaps ' + at.map((x) => Math.round(x * 100) / 100).join(', ') +
                ' are not equal');
        }
    }
});

test('the first and last day are always named', () => {
    for (let n = 1; n <= 400; n++) {
        const days = window_(n);
        const out = ticks(days);
        assert.strictEqual(out[0].at, 0, n + ' days: the axis does not start at the first day');
        assert.strictEqual(out[out.length - 1].at, n - 1,
            n + ' days: the axis does not end at the last day');
        assert.strictEqual(out[0].label, days[0].day);
        assert.strictEqual(out[out.length - 1].label, days[n - 1].day);
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

// The two cases that were described when this was reported.
test('20 september to 28 reads 20, 22, 24, 26, 28', () => {
    const out = ticks(window_(9)).map((t) => dayOf(t.label));
    assert.deepStrictEqual(out, [20, 22, 24, 26, 28]);
});

test('20 september to 22 reads 20, 21, 22', () => {
    const out = ticks(window_(3)).map((t) => dayOf(t.label));
    assert.deepStrictEqual(out, [20, 21, 22]);
});

// What it used to do, kept as the thing that must not come back: eight days
// put marks at 0, 2, 4, 5, 7 -- three gaps of one width and one of half it.
test('the uneven axis does not come back', () => {
    const at = ticks(window_(8)).map((t) => t.at);
    assert.notDeepStrictEqual(at, [0, 2, 4, 5, 7]);
    assert.deepStrictEqual(at, [0, 1.75, 3.5, 5.25, 7]);
});
