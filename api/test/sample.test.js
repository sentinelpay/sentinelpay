'use strict';

// The handful of checks the usage screen shows, and the doors out of it.
//
// This screen is not the log -- the log is its own page, with a search box, a
// verdict filter and a cursor -- so the rows here are a sample. What matters
// about a sample is which rows it is made of and whether the numbers around it
// can be opened, and both of those have been wrong:
//
//   the rows were the newest six, which on an account running three thousand
//   checks a month is six clear checks forever, while the hundred that scored
//   sat where nobody on this screen would meet them;
//
//   and "47 flagged" opened a list of every check in the month, leaving the
//   reader to find the forty-seven by hand on a screen that already knew how
//   to filter for them.
//
// Read out of the shipped file rather than kept as a copy, because a copy is a
// thing that agrees with the product until it does not.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'dash-app.js'), 'utf8');
const CSS = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'dash.css'), 'utf8');

function body(sig, span) {
    const at = SRC.indexOf(sig);
    assert.notStrictEqual(at, -1, sig + ' is gone');
    return SRC.slice(at, at + (span || 7000));
}

test('the first screen asks for the queue, not for the newest', () => {
    const fn = body('function viewOverview(');
    assert.match(fn, /\/queue\?limit=/,
        'the first screen does not ask what is waiting');
    assert.match(fn, /out\.open/, 'the first screen never says how many are open');
    assert.match(fn, /out\.holding/,
        'an alert somebody is already on is counted as nobody\'s');
    assert.match(fn, /lastRow\(r, true\)/,
        'a queue row does not say what state it is in');
});

// The list of checks used to sit on the usage screen, ordered by what needed a
// person. It was the right list on the wrong screen: that page answers how much
// was screened and against what allowance. A list on two screens drifts on one
// of them.
test('the usage screen does not carry the checks list any more', () => {
    const at = SRC.indexOf('function viewUsage(');
    assert.notStrictEqual(at, -1);
    const usage = SRC.slice(at, SRC.indexOf('\n    function ', at + 40));
    assert.doesNotMatch(usage, /'use-screening',/,
        'the checks section is back on the usage screen');
    assert.doesNotMatch(usage, /lastChecks\(/,
        'the usage screen fetches rows of checks again');
});

// The count is measured, the way everything else on this screen is measured.
// It was six, which is a number that suited a laptop: on a tall monitor the
// card ended a third of the way down its own screen.
test('how many rows is measured, not guessed', () => {
    const fn = body('function sampleSize(');
    assert.match(fn, /clientHeight/, 'nothing measures the screen');
    assert.match(fn, /probe/, 'the height of a row is assumed rather than measured');
    assert.match(fn, /offsetHeight/, 'the row is never actually read');
    assert.match(fn, /SAMPLE_MIN/, 'there is no floor');
    assert.match(fn, /SAMPLE_MAX/, 'there is no ceiling, and this is not the log');

    // and the probe has to be laid out or it measures nothing, which would
    // quietly send every screen back to the floor
    assert.doesNotMatch(fn, /display\s*=\s*'none'/,
        'the probe is not laid out, so its height is zero');
    assert.match(fn, /visibility/, 'the probe is visible to a reader');
});

test('a card trimmed to fit keeps a floor, and gives up the oldest', () => {
    const fn = body('function trimToScreen(');
    assert.match(fn, /rows\.length <= SAMPLE_MIN/, 'the list can be trimmed away to nothing');
    assert.match(fn, /rows\[rows\.length - 1\]/,
        'rows are given up from the front, and in a queue the front is what nobody has seen yet');
    assert.match(fn, /guard/, 'the loop has no way to stop if the card never fits');
});

// Every number that can be opened, opens.
test('what came back opens the checks it counted', () => {
    const fn = body('function useTally(', 1800);
    assert.match(fn, /createElement\(r\.href \? 'a' : 'div'\)/,
        'a line with somewhere to go is not made a link');
    assert.match(SRC, /logHref\(org, out, \{ verdict: r\.key \}\)/,
        'the verdicts do not open the log filtered');
    // a check with no project is filed under 'none', which is a filter and
    // not the absence of one
    assert.match(SRC, /logHref\(org, out, \{ project: r\.id \? String\(r\.id\) : 'none' \}\)/,
        'the projects do not open the log filtered');
    // and the chains do not, because the log has no filter for a chain: a link
    // that drops the filter on the way is worse than no link
    assert.doesNotMatch(SRC, /logHref\(org, out, \{ asset/,
        'a chain links to a filter the log does not have');
});

test('the log takes the filter it is handed', () => {
    const fn = body('function viewChecks(', 2000);
    assert.match(fn, /asked\.get\('verdict'\)/, 'the log ignores a verdict in the address');
    assert.match(fn, /asked\.get\('project'\)/, 'the log ignores a project in the address');
    assert.match(fn, /VERDICTS_ASKABLE\.indexOf/,
        'any word at all is taken as a verdict, and an unknown one matches nothing silently');

    // "show every check" has to mean every check
    const all = SRC.slice(SRC.indexOf("t('Show every check')"));
    const click = all.slice(0, 900);
    assert.match(click, /want\.verdict = ''/, 'show-every-check leaves a verdict on');
    assert.match(click, /want\.project = ''/, 'show-every-check leaves a project on');
});

test('the door says how many it is a door to', () => {
    const fn = body('function viewOverview(');
    assert.match(fn, /count\.className = 'use-open-n'/,
        'the way into the alerts never says how many there are');
    assert.match(fn, /state=waiting/,
        'the door opens every check rather than the ones still waiting');
    assert.match(CSS, /\.use-open-n\s*\{[^}]*tabular-nums/,
        'the count is not set in tabular figures');
});

// A column of lines in link colour is a menu. This is a reading of what came
// back that some of the lines happen to be a way into, so nothing changes until
// the pointer is on one.
test('a share line looks like a line first and a link second', () => {
    assert.match(CSS, /\.use-share-l\.is-open\s*\{[^}]*color:\s*inherit/,
        'a share line that is a link is painted as one at rest');
    assert.match(CSS, /\.use-share-l\.is-open\s*\{[^}]*text-decoration:\s*none/,
        'a share line that is a link is underlined at rest');
    assert.match(CSS, /\.use-share-l\.is-open:hover/, 'nothing answers the pointer');
    assert.match(CSS, /\.use-share-l\.is-open:focus-visible/, 'nothing answers the keyboard');
});

test('the verdicts are in the order the work is in, not the order the numbers are', () => {
    const at = SRC.indexOf("var VERDICT_ORDER");
    assert.notStrictEqual(at, -1, 'nothing fixes the order of the verdicts');
    const where = SRC.slice(at, at + 900);
    assert.match(where, /\['severe', 'review', 'clear'\]/,
        'the order is not by what needs a person');
    assert.doesNotMatch(where, /sort\(function \(a, b\) \{ return b\.n - a\.n; \}\)/,
        'the verdicts are sorted by count again, which puts clear on top for ever');
    assert.match(where, /indexOf\(a\.key\)/, 'the order is not applied');
    // a verdict the dictionary does not know must not quietly sort to the top
    assert.match(where, /=== -1\) x = VERDICT_ORDER\.length/,
        'an unknown verdict sorts above sanctioned');
});

// 46 of 872 is a different fact from 46, and the reader was being left to do
// the division.
test('a share says what it is a share of', () => {
    const fn = body('function pct(', 900);
    assert.match(fn, /toLocaleString\(navLang\(\)\)/,
        'the decimal mark is not the reader\'s');
    assert.match(fn, /share < 1 \? share\.toFixed\(1\)/,
        'a share under one percent is rounded away');
    assert.match(fn, /< 0\.1\) return '<'/,
        'a part that exists can print as 0%');
    assert.match(SRC, /share\.className = 'use-tally-s'/, 'the lists have no shares');
    assert.match(body('function useTally(', 1800), /pct\(r\.n, total\)/,
        'the lists work out their own shares and can print a part that exists as 0%');
});

// The breakdowns under the screenings card are written in the shape of the
// facts table above them -- a name, a figure, a share, a hairline -- and not as
// bars. A table of figures, then bars, then a short list of amounts was three
// shapes for one kind of statement, and the reader was asked to switch between
// them to read one section.
test('every breakdown in the section is one shape, the table above it', () => {
    assert.doesNotMatch(SRC, /function useSplit\(/, 'a second kind of share list is back');
    assert.doesNotMatch(CSS, /\.use-split/, 'the old share list still has styles waiting for it');
    assert.doesNotMatch(SRC, /function useShare\(/, 'the bar list is back');
    assert.doesNotMatch(SRC, /function useAmounts\(/, 'the short list of amounts is back');
    const at = SRC.indexOf('function viewUsage(');
    const usage = SRC.slice(at, SRC.indexOf('\n    function ', at + 40));
    const uses = usage.match(/useTally\(/g) || [];
    assert.strictEqual(uses.length, 3,
        'by project, by chain and what came back are not all written as one table');
    assert.match(SRC, /box\.className = 'use-facts use-tally'/,
        'the breakdown does not use the facts table\'s rows');
});

// The decision counts belong where the work is, not in a billing window. The
// queue endpoint already had them; the overview already calls it.
test('the work done is visible somewhere', () => {
    const fn = body('function viewOverview(');
    assert.match(fn, /out\.cleared/, 'nothing says how many alerts were cleared');
    assert.match(fn, /out\.confirmed/, 'nothing says how many were confirmed');
    const usageSrc = fs.readFileSync(path.join(__dirname, '..', 'usage.js'), 'utf8');
    assert.doesNotMatch(usageSrc, /decisions: byDecision/,
        'a billing window counts decisions, which are not consumption');
});

// The top of the page is gone: the verdict sentence, the headline card with
// its chart, and the row of allowance tiles. The card has since come back,
// one section down, where it is the picture of the figures beside it. All three printed the same
// number within one screen, each one needing to be kept in agreement with
// the other two.
test('the page does not say the same number three times', () => {
    const at = SRC.indexOf('function viewUsage(');
    const usage = SRC.slice(at, SRC.indexOf('\n    function ', at + 40));
    assert.doesNotMatch(usage, /use-verdict/,
        'the verdict sentence is back');
    // The card itself came back, asked for, inside the screenings section --
    // under the figures it draws and a screen below the grid. What must not
    // come back is the card at the top, printing the grid's number beside it.
    assert.doesNotMatch(usage, /body\.appendChild\(useHeadline\(/,
        'the headline card is back at the top of the page');
    assert.doesNotMatch(usage, /sum\.body\.appendChild\(useHeadline\(/,
        'the headline card is inside the usage summary');
    assert.match(usage, /var cardEl = kindCard\(\);\s*smain\.appendChild\(cardEl\);/,
        'the screenings section has lost its chart');
});

// The kinds of work under the card are its switch: picking one redraws the
// card with that kind's line, and the choice outlives a change of period. Kept
// outside draw(), or switching to the last week would quietly put live checks
// back under somebody who had just asked for sweeps.
test('the kind under the screenings card is what the card draws', () => {
    const at = SRC.indexOf('function viewUsage(');
    const usage = SRC.slice(at, SRC.indexOf('\n    function ', at + 40));
    const draw = usage.indexOf('function draw(out)');
    assert.ok(usage.indexOf('var pickedKind') !== -1 && usage.indexOf('var pickedKind') < draw,
        'the picked kind is reset every time the period changes');
    assert.match(usage, /cardEl\.parentNode\.replaceChild\(next, cardEl\)/,
        'picking a kind does not redraw the card');
    assert.match(usage, /kindName\(pickedKind\)/,
        'the card is not told which kind it is drawing');
    assert.doesNotMatch(usage, /appendChild\(useStrip\(/,
        'the allowance tiles are back');
});

// Three cuts of one number laid out as three sections made the page look longer
// than it is and left a reader wondering what the difference between them was.
test('what the allowance went on is one place, not three sections', () => {
    const at = SRC.indexOf('function viewUsage(');
    const usage = SRC.slice(at, SRC.indexOf('\n    function ', at + 40));
    for (const gone of ["'use-flagged'", "'use-assets'", "'use-projects'"]) {
        assert.ok(usage.indexOf('useSection(' + gone) === -1,
            gone + ' is a section of its own again');
    }
    assert.match(usage, /useSection\('use-screenings'/,
        'there is no section for the thing this page meters');
    // each cut carries its own heading, and nothing is stacked over them
    assert.match(usage, /h\.className = 'use-spent-t';\s*h\.textContent = t\(part\.title\)/,
        'the cuts of the number have no headings of their own');
    assert.doesNotMatch(usage, /'What this period went on'/,
        'the overline is back over headings that already say what it says');
});
