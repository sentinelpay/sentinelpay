'use strict';

// Where the dates sit along the bottom of the usage chart.
//
// The rule is one a reader checks with their eyes before reading a single
// date: five marks, the same distance apart, from the left edge of the line to
// the right. Under five days there are not five dates to name, so each day is
// named once.
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
    do {
        if (SRC[i] === '{') depth++;
        else if (SRC[i] === '}') depth--;
        i++;
    } while (depth > 0 && i < SRC.length);
    assert.strictEqual(depth, 0, name + '() has unbalanced braces');
    return SRC.slice(at, i);
}

const COUNT = Number(/var AXIS_TICKS = (\d+);/.exec(SRC)[1]);
// eslint-disable-next-line no-new-func
const ticks = new Function(
    'shortDay', 'AXIS_TICKS',
    lift('ticks') + '; return ticks;'
)((iso) => iso, COUNT);

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
const close = (a, b) => Math.abs(a - b) < 1e-9;

test('always five, from five days up to four hundred', () => {
    assert.strictEqual(COUNT, 5);
    for (let n = 5; n <= 400; n++) {
        assert.strictEqual(ticks(window_(n)).length, 5, n + ' days did not give five marks');
    }
});

test('every gap along the axis is the same, the last one included', () => {
    for (let n = 5; n <= 400; n++) {
        const at = ticks(window_(n)).map((t) => t.at);
        const step = at[1] - at[0];
        for (let i = 1; i < at.length; i++) {
            assert.ok(close(at[i] - at[i - 1], step),
                n + ' days: gaps ' + at.join(', ') + ' are not all equal');
        }
    }
});

test('the axis begins on the first day and ends on today', () => {
    for (let n = 1; n <= 400; n++) {
        const days = window_(n);
        const out = ticks(days);
        assert.strictEqual(out[0].at, 0, n + ' days: the axis does not start at the left edge');
        assert.strictEqual(out[0].label, days[0].day);
        assert.strictEqual(out[out.length - 1].at, n - 1,
            n + ' days: the axis does not reach the right edge');
        assert.strictEqual(out[out.length - 1].label, days[n - 1].day);
    }
});

test('every label is a real day, and the day under its mark', () => {
    for (let n = 1; n <= 200; n++) {
        const days = window_(n);
        const have = new Set(days.map((d) => d.day));
        for (const t of ticks(days)) {
            assert.ok(have.has(t.label), n + ' days: "' + t.label + '" is not one of them');
            assert.strictEqual(t.label, days[Math.round(t.at)].day,
                n + ' days: the mark at ' + t.at + ' names a day that is not under it');
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

test('under five days, every day once', () => {
    for (let n = 1; n < COUNT; n++) {
        const out = ticks(window_(n));
        assert.deepStrictEqual(out.map((t) => t.at), window_(n).map((d, i) => i));
    }
});

// The two cases that were described when this was first asked for.
test('20 september to 28 reads 20, 22, 24, 26, 28', () => {
    assert.deepStrictEqual(ticks(window_(9)).map((t) => dayOf(t.label)), [20, 22, 24, 26, 28]);
});

test('20 september to 22 reads 20, 21, 22', () => {
    assert.deepStrictEqual(ticks(window_(3)).map((t) => dayOf(t.label)), [20, 21, 22]);
});

test('a day of hours steps by six', () => {
    const hours = [];
    const start = Date.UTC(2026, 8, 26, 12);
    for (let i = 0; i < 25; i++) {
        const d = new Date(start + i * 3600000).toISOString();
        hours.push({ day: d.slice(0, 10) + ' ' + d.slice(11, 13) + ':00', n: 0 });
    }
    assert.deepStrictEqual(ticks(hours).map((t) => t.at), [0, 6, 12, 18, 24]);
});

// The shapes this axis has had and must not have again: marks at uneven
// positions, a short last gap, and fewer than five where five fit.
test('none of the old axes comes back', () => {
    const month = ticks(window_(31)).map((t) => t.at);
    assert.notDeepStrictEqual(month, [0, 7, 14, 21, 30], 'a short last gap is back');
    assert.notDeepStrictEqual(month, [0, 7, 14, 21], 'the axis stops short again');
    const week = ticks(window_(8)).map((t) => t.at);
    assert.notDeepStrictEqual(week, [0, 2, 4, 5, 7], 'positions rounded to days are back');
    assert.notDeepStrictEqual(week, [3, 4, 5, 6, 7], 'the marks are bunched against today');
});

// The chart is one size whether or not a period is laid under it.
//
// Where there is a window behind this one the card holds two charts stacked --
// this period, and this period with the last one under it -- and the code that
// works out how tall the chart should be found only the first of them with a
// querySelector. So one was sized and the other kept whatever the stylesheet
// said, and asking to compare took the chart from 280 points to 148. Worse on
// a page that opened already comparing: the chart it measured was the hidden
// one, a hidden element measures zero, and zero said there was no room to give
// up or to take, so the fitting did nothing at all.
test('every chart on the screen is sized, not the first one', () => {
    const at = SRC.indexOf('function fitFold(');
    assert.notStrictEqual(at, -1, 'the overview no longer fits itself to the screen');
    const body = SRC.slice(at, SRC.indexOf('\n    }', at));

    assert.doesNotMatch(body, /querySelector\('\.use-plot'\)/,
        'the height is worked out for the first chart only');
    assert.match(body, /querySelectorAll\('\.use-plot'\)/,
        'the charts are not gathered together');
    assert.match(body, /querySelectorAll\('\.use-plot-a'\)/,
        'the height is still read off one chart');
    assert.match(body, /offsetHeight\)\s*\{[\s\S]{0,80}break;/,
        'a chart that is not laid out can still be the one measured');

    // And only the charts above the fold. This fitter buys room for the first
    // screen by taking height off a chart, and the screenings chart sits a
    // whole screen below the grid it would be paying for.
    assert.doesNotMatch(body, /body\.querySelectorAll\('\.use-plot'\)/,
        'every chart on the page is sized, including the ones below the fold');
    assert.match(body, /node !== gap/,
        'the gathering no longer stops at the fold');
});

// And the two of them sit in one cell, so the card cannot change height when
// the reader swaps between them: their legends say different things and wrap
// at different widths.
test('the two charts share a cell rather than taking turns in the flow', () => {
    const css = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'dash.css'), 'utf8');
    assert.match(css, /\.use-plots\s*\{[^}]*display:\s*grid/,
        'the charts are not stacked');
    assert.match(css, /\.use-plots > \.use-alone[\s\S]{0,60}grid-area:\s*1 \/ 1/,
        'the charts are not in the same cell');
    assert.doesNotMatch(css, /\.use-against\s*\{\s*display:\s*none/,
        'the hidden chart is out of the flow again, so the card resizes under the reader');
    assert.match(SRC, /stack\.className = 'use-plots'/,
        'nothing builds the stack the stylesheet lays out');
});

// Switching a card between metrics swaps its scale, and a column sized to its
// widest number slid the whole plot sideways: 38 points in for a chart that
// tops out at 4, 52 for one at 500. The scale's column is a set width.
test('the plot starts in the same place whatever its scale', () => {
    const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'dash.css'), 'utf8');
    const at = CSS.indexOf('.use-plot {');
    const rule = CSS.slice(at, CSS.indexOf('}', at));
    const cols = /grid-template-columns:\s*([^;]+);/.exec(rule);
    assert.ok(cols, 'the plot has no columns of its own');
    assert.doesNotMatch(cols[1], /^\s*auto\b/, 'the scale column is sized to its numbers again');
    assert.match(cols[1], /minmax\(\s*[\d.]+rem/, 'the scale column has no set width');
});
