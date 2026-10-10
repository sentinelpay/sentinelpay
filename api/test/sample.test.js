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
test('a project opens the checks it counted, a verdict reads like a chain', () => {
    const fn = body('function useTally(', 1800);
    assert.match(fn, /createElement\(r\.href \? 'a' : 'div'\)/,
        'a line with somewhere to go is not made a link');
    // What came back reads like the chain list above it and is not a link:
    // asked for, so that two lists of the same shape in one block behave the
    // same way. The log still takes a verdict in its address for anybody who
    // links to it from elsewhere -- see the next test.
    assert.doesNotMatch(SRC, /logHref\(org, out, \{ verdict: r\.key \}\)/,
        'the verdicts are links again, unlike the chains beside them');
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
    // by project, by chain and what came back -- and the chains folded under
    // by chain, which continue its table rather than starting another shape
    const uses = usage.match(/useTally\(/g) || [];
    assert.ok(uses.length >= 3,
        'by project, by chain and what came back are not all written as one table');
    assert.match(usage, /title: 'What came back',\s*node: useTally\(/, 'what came back is another shape');
    assert.match(usage, /var busy = useTally\(/, 'by chain is another shape');
    assert.match(usage, /var rest = useTally\(/, 'the chains folded under by chain are another shape');
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
    assert.match(usage, /h\.className = 'use-spent-t';[\s\S]{0,120}h\.textContent = part\.raw \? part\.title : t\(part\.title\)/,
        'the cuts of the number have no headings of their own');
    assert.doesNotMatch(usage, /'What this period went on'/,
        'the overline is back over headings that already say what it says');
});

// Review sits directly under Screenings and is built the same way: the queue
// as it stands in a table, the window on a card, a row of cells that switch the
// card, and breakdowns in the table's rows. The two summary cells about review
// open it, and the decisions count is the one the section uses -- cut to the
// scope on screen, where the organisation-wide count it read before came out
// over the section on the production view.
test('review is the section under screenings, and the summary opens it', () => {
    const at = SRC.indexOf('function viewUsage(');
    const usage = SRC.slice(at, SRC.indexOf('\n    function ', at + 40));
    const scr = usage.indexOf('if (!fresh) body.appendChild(scr);');
    const rev = usage.indexOf("useSection('use-review', 'Review'");
    assert.ok(scr !== -1 && rev > scr, 'review is not built straight after screenings');
    assert.ok(usage.indexOf("useSection('use-plan'") > rev, 'something is built between screenings and review');
    assert.match(usage, /label: 'Findings to review'[\s\S]{0,260}go: 'use-review'/, 'findings do not open review');
    assert.match(usage, /label: 'Decisions recorded'[\s\S]{0,900}go: 'use-review'/, 'decisions do not open review');
    assert.match(usage, /out\.review \? out\.review\.decisions\.total/,
        'the summary counts decisions from somewhere other than the section it opens');
    assert.match(usage, /var pickedReview/, 'the review card forgets its line on every redraw');
    const api = fs.readFileSync(path.join(__dirname, '..', 'usage.js'), 'utf8');
    assert.match(api, /async function reviewIn\(/, 'the server does not count review work');
    assert.match(api, /async function queueNow\(/, 'the server does not say what is waiting now');
    assert.match(api, /review: Object\.assign\(\{\}, review, \{ queue: waiting \}\)/,
        'the queue does not reach the payload');
});

// Monitoring follows review, built ahead of the monitor: the server sends the
// shape with every count at nought so the section is a true picture of an
// organisation watching nothing. The plan moved to the end, so the sections run
// in the order the summary's cells do.
test('monitoring follows review, and the page runs in the summary\'s order', () => {
    const at = SRC.indexOf('function viewUsage(');
    const usage = SRC.slice(at, SRC.indexOf('\n    function ', at + 40));
    const order = ["useSection('use-screenings'", "useSection('use-review'", "useSection('use-monitoring'",
        "useSection('use-coverage'", "useSection('use-team'", "useSection('use-plan'"]
        .map((x) => usage.indexOf(x));
    assert.ok(order.every((x) => x !== -1), 'a section is missing');
    for (let i = 1; i < order.length; i++) {
        assert.ok(order[i] > order[i - 1], 'the sections no longer run in the summary\'s order');
    }
    for (const label of ['Addresses monitored', 'Alerts raised', 'Custom watchlist']) {
        assert.match(usage, new RegExp("label: '" + label + "'[^}]*go: 'use-monitoring'"),
            label + ' does not open monitoring');
    }
    const api = fs.readFileSync(path.join(__dirname, '..', 'usage.js'), 'utf8');
    assert.match(api, /async function monitoringIn\(/, 'the server sends no shape for monitoring');
    assert.match(api, /monitoring: watching,/, 'monitoring does not reach the payload');
});

// Sanctions coverage is built like the sections above it, and what it counts
// that is real -- addresses added to the list by day, and what is on the lists
// by list and by chain -- comes from the table that holds the list, not from
// anything typed into the page.
test('sanctions coverage is the same shape, counted from the list itself', () => {
    const at = SRC.indexOf('function viewUsage(');
    const usage = SRC.slice(at, SRC.indexOf('\n    function ', at + 40));
    const from = usage.indexOf("useSection('use-coverage'");
    const sec = usage.slice(from, usage.indexOf('body.appendChild(cov);', from));
    assert.match(sec, /cov\.body\.className \+= ' is-wide'/, 'coverage has its column of prose back');
    assert.doesNotMatch(sec, /useSide\(/, 'coverage has its column of prose back');
    assert.match(sec, /switched\(\[/, 'coverage is not built on the shared card and cells');
    assert.match(sec, /'By list'/, 'coverage has no breakdown by list');
    assert.match(sec, /'Designated addresses, by chain'/, 'coverage has no breakdown by chain');
    assert.match(sec, /'By sanctions programme'/, 'coverage has no breakdown by programme');
    assert.doesNotMatch(usage, /'What we screen against'/, 'the old grid that repeated other sections is back');
    const api = fs.readFileSync(path.join(__dirname, '..', 'usage.js'), 'utf8');
    assert.match(api, /async function listsIn\(/, 'the server does not count the lists');
    assert.match(api, /FROM sanctioned_addresses\s+WHERE added_at >= \$1/, 'additions are not counted from the list');
});

// Programmes are grouped the way an analyst asks about them, and an address
// listed under several is counted once, under its first, so the themes add up
// to the addresses on the list rather than to more than it.
test('a sanctions programme lands in one theme, and the themes add up', () => {
    const api = fs.readFileSync(path.join(__dirname, '..', 'usage.js'), 'utf8');
    const themes = eval('(' + /const PROGRAMME_THEMES = (\[[\s\S]*?\n\]);/.exec(api)[1] + ')');
    const at = api.indexOf('function themeOf(');
    // eslint-disable-next-line no-new-func
    const themeOf = new Function('PROGRAMME_THEMES', api.slice(at, api.indexOf('\n}\n', at) + 2) + '; return themeOf;')(themes);
    const cases = {
        'CYBER2': 'cyber', 'CYBER2,ELECTION-EO13848': 'cyber', 'DPRK4': 'dprk', 'FTO,SDGT': 'terror',
        'ILLICIT-DRUGS-EO14059': 'drugs', 'SDNTK': 'drugs', 'TCO': 'crime', 'RUSSIA-EO14024': 'russia',
        'CAATSA - RUSSIA': 'russia', 'UKRAINE-EO13661': 'russia', 'IRGC': 'iran', 'IRAN-EO13902': 'iran',
        'NPWMD': 'weapons', 'SOMETHING-NEW': 'other', '': 'other',
    };
    for (const [codes, want] of Object.entries(cases)) {
        assert.strictEqual(themeOf(codes), want, codes + ' went to ' + themeOf(codes));
    }
    assert.match(api, /programmes\.rows\.forEach\(\(r\) => \{ out\.byTheme\[themeOf\(r\.programs\)\] \+= r\.n; \}\)/,
        'an address can be counted under more than one theme');
});

// The API section follows coverage. The two limits it states are the
// limiters' own numbers, named once in index.js, so the page cannot say one
// thing while the server enforces another; and the keys, calls and deliveries
// that Team used to repeat are said here and not there.
test('the API section states the limits the server enforces', () => {
    const at = SRC.indexOf('function viewUsage(');
    const usage = SRC.slice(at, SRC.indexOf('\n    function ', at + 40));
    assert.ok(usage.indexOf("useSection('use-api'") > usage.indexOf("useSection('use-coverage'"),
        'the API section is not after coverage');
    assert.ok(usage.indexOf("useSection('use-team'") > usage.indexOf("useSection('use-api'"),
        'the API section is not before team');
    for (const label of ['API tokens', 'API calls', 'Webhook deliveries']) {
        assert.match(usage, new RegExp("label: '" + label + "'[\\s\\S]{0,260}go: 'use-api'"), label + ' does not open the API section');
    }
    const team = usage.slice(usage.indexOf("useSection('use-team'"), usage.indexOf('body.appendChild(team);'));
    assert.doesNotMatch(team, /'API calls'|'Webhook deliveries'|'API tokens'/, 'team repeats the API section');
    const index = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    assert.match(index, /max: REQUESTS_PER_MINUTE,/, 'the request limiter does not use the named limit');
    assert.match(index, /max: SCREENS_PER_HOUR,/, 'the screening limiter does not use the named limit');
    assert.match(index, /limits: \{ perMinute: REQUESTS_PER_MINUTE, screensPerHour: SCREENS_PER_HOUR \}/,
        'the page is told limits other than the ones enforced');
});

// Team is built like the sections above it and counted from what is kept:
// members joining, invites sent and accepted, sign-ins and projects made, and
// the state of the team now -- seats, pending invites, who has a second factor
// on, roles and when each member last signed in.
test('team is the same shape, counted from the people in it', () => {
    const at = SRC.indexOf('function viewUsage(');
    const usage = SRC.slice(at, SRC.indexOf('\n    function ', at + 40));
    const from = usage.indexOf("useSection('use-team'");
    const sec = usage.slice(from, usage.indexOf('body.appendChild(team);', from));
    assert.match(sec, /team\.body\.className \+= ' is-wide'/, 'team has a column of prose again');
    assert.match(sec, /switched\(\[/, 'team is not built on the shared card and cells');
    assert.match(sec, /'Members with two-factor'/, 'team does not say how many members have a second factor');
    assert.match(sec, /'By role'/, 'team has no breakdown by role');
    assert.match(sec, /'Last signed in'/, 'team does not say who has been in lately');
    for (const label of ['Seats', 'Projects', 'SSO users']) {
        assert.match(usage, new RegExp("label: '" + label + "'[^}]*go: 'use-team'"), label + ' does not open team');
    }
    const api = fs.readFileSync(path.join(__dirname, '..', 'usage.js'), 'utf8');
    assert.match(api, /async function teamIn\(/, 'the server does not count the team');
    assert.match(api, /u\.totp_at IS NOT NULL/, 'two-factor is not counted from the members');
});

// Evidence is the last of the sections the summary links to, built like the
// rest, and it now holds the period's CSV that used to sit alone in a footer.
// What it counts as sealed is counted from the digest on each row, so a check
// written without one is never reported as sealed.
test('evidence is the same shape, and its seals come from the rows', () => {
    const at = SRC.indexOf('function viewUsage(');
    const usage = SRC.slice(at, SRC.indexOf('\n    function ', at + 40));
    const ev = usage.indexOf("useSection('use-evidence'");
    assert.ok(ev > usage.indexOf("useSection('use-team'"), 'evidence is not after team');
    assert.ok(ev < usage.indexOf("useSection('use-plan'"), 'evidence is not before the plan');
    const sec = usage.slice(ev, usage.indexOf('body.appendChild(evSec);', ev));
    assert.match(sec, /evSec\.body\.className \+= ' is-wide'/, 'evidence has a column of prose again');
    assert.match(sec, /switched\(\[/, 'evidence is not built on the shared card and cells');
    assert.match(sec, /'Records, by age'/, 'evidence does not say how old the records are');
    assert.match(sec, /usage\.csv\?period=/, 'the period cannot be downloaded from evidence');
    assert.doesNotMatch(usage, /use-foot/, 'the footer the CSV sat in is back');
    assert.match(usage, /label: 'Evidence exports'[^}]*go: 'use-evidence'/, 'Evidence exports does not open evidence');
    const api = fs.readFileSync(path.join(__dirname, '..', 'usage.js'), 'utf8');
    assert.match(api, /async function evidenceIn\(/, 'the server does not count the evidence');
    assert.match(api, /sandbox = \$4 AND digest <> ''/, 'a check without a digest is counted as sealed');
    assert.match(api, /evidence,\s/, 'evidence does not reach the payload');
});
