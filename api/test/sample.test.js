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
    return SRC.slice(at, at + (span || 5200));
}

test('the sample asks for what needs a person, not only for what is newest', () => {
    const fn = body('function lastChecks(');
    assert.match(fn, /verdict=flagged/,
        'the flagged checks of the window are never asked for');
    assert.match(fn, /Promise\.all/,
        'the two lists are fetched one after the other, so the reader waits twice');
    assert.doesNotMatch(fn, /limit=6\b/,
        'the sample is a fixed six again');
});

test('a check is never shown twice when it is both flagged and recent', () => {
    const fn = body('function lastChecks(');
    assert.match(fn, /seen\[/, 'nothing keeps the two lists from overlapping');
});

test('the groups are named only where there are two of them', () => {
    const fn = body('function lastChecks(');
    assert.match(fn, /var split = shown\.length > 0 && rest\.length > 0/,
        'the labels do not depend on there being two groups');
    assert.match(fn, /sampleLabel\('Needs your attention'/,
        'the flagged group is not named');
    assert.match(fn, /sampleLabel\('Latest'/,
        'the rest of the sample is not named');
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

test('a row given up to make the page fit is never a flagged one', () => {
    const fn = body('function trimToScreen(');
    assert.match(fn, /rows\.length <= SAMPLE_MIN/, 'the list can be trimmed away to nothing');
    assert.match(fn, /rows\[rows\.length - 1\]/,
        'rows are given up from the front, which is where the flagged ones are');
    assert.match(fn, /guard/, 'the loop has no way to stop if the section never fits');
});

// Every number that can be opened, opens.
test('what came back opens the checks it counted', () => {
    const fn = body('function useShare(', 1800);
    assert.match(fn, /linkOf/, 'a share line can never be a link');
    assert.match(fn, /createElement\(href \? 'a' : 'div'\)/,
        'a line with somewhere to go is not made a link');
    assert.match(SRC, /logHref\(org, out, \{ verdict: r\.key \}\)/,
        'the verdicts do not open the log filtered');
    assert.match(SRC, /logHref\(org, out, \{ project: r\.key \}\)/,
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
    assert.match(SRC, /howMany\.className = 'use-open-n'/,
        'the way into the log never says how many checks are in there');
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

// A month with forty-four hits used to fill every row with hits: the card
// stopped being a sample of the period -- nothing on the screen said what an
// ordinary check looks like any more -- and it showed eleven of forty-four
// while saying nothing about the other thirty-three.
test('the flagged group never takes the whole card', () => {
    const fn = body('function lastChecks(');
    assert.match(fn, /var most = Math\.max\(1, Math\.floor\(want \/ 2\)\)/,
        'the flagged group has no ceiling of its own');
    assert.match(fn, /flagged\.slice\(0, most\)/,
        'the flagged group is still taking the whole sample');
});

test('a group that shows some of its rows says how many there are', () => {
    const fn = body('function lastChecks(');
    assert.match(fn, /flaggedAll/, 'nothing counts the flagged checks of the window');
    assert.match(fn, /flaggedAll > shown\.length \? flaggedAll : 0/,
        'the count is printed even when the group is all of itself, which is noise');
    assert.match(fn, /logHref\(org, out, \{ verdict: 'flagged' \}\)/,
        'the band does not open the checks it names');

    const label = body('function sampleLabel(');
    assert.match(label, /createElement\(href \? 'a' : 'div'\)/,
        'the band cannot be a way through to the rest of its rows');
    assert.match(CSS, /\.use-last-gn\s*\{[^}]*tabular-nums/,
        'the count on a band is not set in tabular figures');
});
