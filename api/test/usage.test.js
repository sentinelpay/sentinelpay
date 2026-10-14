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
    const figures = html.indexOf('class="sheet chapter"');
    assert.ok(cover !== -1 && cover < statement && statement < figures, 'the cover, the statement and the figures are out of order');
    // the statement is a letter: our name and seal under it, and one place for
    // the organisation to confirm it, at the foot of the same page
    const letter = html.slice(statement, figures);
    assert.ok(letter.includes('Confirmation by the organisation'), 'the confirmation is not with the statement');
    // the reference is a sentence of the statement, not a box of its own,
    // and the confirmation sits at the foot of the page
    assert.match(letter, /<p>Every export of this period, CSV, Excel or JSON, carries the same reference, <span class="ref">sha256:[0-9a-f]{64}<\/span>, so a copy/, 'the reference is not in the statement');
    assert.doesNotMatch(letter, /class="seal"|Made automatically from the records/, 'the closing block is back');
    assert.match(html, /\.confirm \{ margin-top:auto;/, 'the confirmation is not held at the foot of the page');
    assert.equal((letter.match(/class="fields"/g) || []).length, 1, 'the statement asks for more than one signature');
    // every page after the cover carries our head, the mark and the name as
    // one picture so they line up, with a line under it across the page
    assert.match(html, /@top-left \{ content:url\("data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+"\); vertical-align:bottom;[^}]*border-bottom:1px solid/, 'the pages have no head');
    assert.match(html, /@top-center \{ content:""; [^}]*border-bottom/, 'the line under the head stops short');
    assert.match(html, /@page :first \{ margin:0; @top-left \{ content:none; \} @top-center \{ content:none; \} @top-right \{ content:none; \}/, 'the head prints on the cover');
    const head = Buffer.from(/@top-left \{ content:url\("data:image\/svg\+xml;base64,([^"]+)"/.exec(html)[1], 'base64').toString();
    assert.match(head, /<path transform="translate\(190 [\d.]+\)" fill="#0e2358" d="M/, 'the name is not drawn beside the mark');
    // on screen each sheet draws the same head, and on paper it leaves that to the page
    assert.match(letter, /<div class="lh sheet-lh">/, 'the statement has no head on screen');
    assert.match(html, /\.sheet-lh \{ display:none; \}/, 'the head prints twice on paper');
    // A5 is narrower than a phone breakpoint: the phone's layout is for screens
    assert.match(html, /@media screen and \(max-width: 700px\)/, 'the phone layout applies to printed A5');
    // after the statement, the overview and the chapters, each a sheet of its
    // own and a page of its own
    const chapters = html.split('class="sheet chapter"').slice(1);
    assert.deepEqual(chapters.map((c) => (/<h2 class="big">([^<]*)<\/h2>/.exec(c) || [])[1]),
        ['Overview of the period', 'Screenings and review', 'Sanctions coverage', 'API, team and evidence', 'Day by day'], 'the chapters are not the ones they were');
    assert.match(html, /\.chapter \{ break-before:page; \}/, 'a chapter does not start a page of its own');
    assert.match(html, /\.chapter \.part\.keep \{ break-inside:avoid; \}/, 'a short section can leave two rows alone at the top of a page');
    // the statement page is the letter and the confirmation; the report's
    // particulars come last, with the full reference
    assert.doesNotMatch(letter, /class="facts"/, 'the particulars are back on the statement page');
    const about = html.slice(html.search(/<div class="part[^"]*\babout">/));
    assert.match(about, /<h3>Report details<\/h3><dl class="facts">[\s\S]*Reference[\s\S]*sha256:[0-9a-f]{64}/, 'the particulars are not at the end');
    // Screenings and review: what each part measures, a bar beside every
    // count with the ordinary outcome in grey, the two review tables side by
    // side, and no table of one row for projects nobody used
    const detail = chapters[1];
    assert.match(detail, /<p class="part-what">Every check in the period/, 'the screenings do not say what they measure');
    assert.match(detail, /<table class="has-bars">/, 'the breakdowns have no bars');
    assert.match(detail, /<div class="pair"><div><h4 class="pair-t">Time to a decision<\/h4>/, 'the review tables are not side by side');
    assert.doesNotMatch(html, /\.sh-bar i \{[^}]*border-radius/, 'a rounded gradient bar goes into the PDF as a picture');
    // coverage, the API, the team and the evidence read the way the
    // screenings do: what each measures in a line, and a bar beside every count
    const [coverage, rest] = [chapters[2], chapters[3]];
    assert.match(coverage, /<p class="part-what">What the checks are matched against/, 'the coverage does not say what it measures');
    for (const what of ['Calls to the API in the period', 'The people in the organisation', 'The sealed records the organisation holds']) {
        assert.match(rest, new RegExp('<p class="part-what">' + what), what + ' is not said');
    }
    assert.match(rest, /<div class="pair"><div><h4 class="pair-t">By role<\/h4>/, 'the team tables are not side by side');
    assert.match(rest, /<div class="pair"><div><h4 class="pair-t">Records, by age<\/h4>/, 'the evidence tables are not side by side');
    // the overview: two sentences, the days as columns, the figures beside the
    // period before, and what the words in them mean
    const overview = chapters[0];
    assert.match(overview, /<p class="lede">The total number of checks between/, 'the overview does not say what happened');
    // a period with no days in it draws no columns rather than failing
    assert.doesNotMatch(overview, /<svg class="chart"/, 'columns drawn for a period with no days');
    assert.doesNotMatch(overview, /kept for  years/, 'a retention nobody gave is printed as a blank');
    assert.match(overview, /<table class="sum">[\s\S]*This period[\s\S]*The period before[\s\S]*Change/, 'the figures are not set beside the period before');
    assert.equal((overview.match(/<sup>\d<\/sup>/g) || []).length, 5, 'the figures do not point to their notes');
    assert.equal((overview.match(/<div><span>\d<\/span>/g) || []).length, 5, 'the notes are not there');
    // a name cannot close the style it is quoted in
    const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    assert.ok(!style.includes('</style><b>'), 'the organisation name broke out of the stylesheet');
    for (const [key, w, h] of [['letter', 215.9, 279.4], ['legal', 215.9, 355.6], ['a3', 297, 420], ['a5', 148, 210]]) {
        assert.match(exports_.report(list, { ...meta, paper: key }, out), new RegExp('size:' + w + 'mm ' + h + 'mm;'), key);
    }
});

// The cover is the brand's: the grid of shapes taken from the logo, the logo
// itself in the middle, and under it the title, whose report it is and the
// period. The grid is drawn in the paper's own millimetres, so its modules
// stay square on every size.
test('the cover is the brand grid on every paper', () => {
    const out = {
        period: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-03T00:00:00.000Z' },
        scope: 'live', zone: 'UTC',
        screenings: { total: 1, verdicts: {}, assets: [], projects: [], days: [] },
        org: {},
    };
    const list = exports_.sheets(out, { name: 'Acme' }, null);
    const meta = { reference: exports_.reference(list), generated: '2026-09-03T00:00:00.000Z', organisation: 'Acme', back: '/' };
    for (const key of Object.keys(exports_.PAPERS)) {
        const paper = exports_.PAPERS[key];
        const html = exports_.report(list, { ...meta, paper: key }, out);
        const cover = html.slice(html.indexOf('class="sheet cover"'), html.indexOf('class="sheet statement"'));
        assert.match(cover, new RegExp('class="c-art" viewBox="0 0 ' + paper.w + ' ' + paper.h + '"'), key + ': the art is not drawn to the paper');
        assert.match(cover, /class="c-title">Usage and<br>evidence report</, key + ': no title');
        assert.match(cover, /<b>Acme<\/b>/, key + ': the organisation is not on the cover');
        // three modules across the width: the first row's middle square starts a third in
        const m = Math.round(paper.w / 3 * 100) / 100;
        assert.ok(cover.includes('<rect x="' + m + '" y="0" width="' + m + '" height="' + m + '"'), key + ': the grid is not three across');
    }
});

// Every word a report can print, in every language the dashboard speaks, and
// one reference for all of them: the language changes what is printed and
// nothing about the figures.
test('the report is printed in the language asked for, every word of it', () => {
    const line = (n) => ({ total: n, days: [{ day: '2026-09-01', n }, { day: '2026-09-02', n: 0 }] });
    const full = {
    period: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-03T00:00:00.000Z' },
    scope: 'live', zone: 'Europe/Zagreb',
    screenings: { total: 10, flagged: 3, clear: 7, addresses: 9, assetCount: 2,
        verdicts: { severe: 1, review: 2, clear: 7 }, assets: [{ asset: 'XBT', n: 6 }, { asset: 'ETH', n: 4 }],
        projects: [{ id: '1', name: 'Card program', n: 6 }, { id: '', name: '', n: 4 }],
        days: [{ day: '2026-09-01', n: 6, flagged: 2, severe: 1, addresses: 5 }, { day: '2026-09-02', n: 4, flagged: 1, severe: 0, addresses: 4 }] },
    kinds: { live: line(8), history: line(1), rescreen: line(1), transaction: line(0), bulk: line(0), other: line(5) },
    review: { decisions: line(3), cleared: line(2), confirmed: line(1), holding: line(0),
        took: { hour: 1, day: 1, week: 1, longer: 0 }, queue: { open: 4, holding: 0, oldest: '2026-08-01T00:00:00Z', age: { day: 1, week: 1, month: 1, older: 1 } } },
    lists: { byList: { ofac: 100, ofacOther: 0, eu: 0, uk: 0, un: 0, ca: 0, au: 0, ch: 0, jp: 0 },
        byTheme: { cyber: 10, drugs: 10, terror: 10, dprk: 10, crime: 10, russia: 10, iran: 10, weapons: 10, other: 20 },
        byChain: [{ asset: 'XBT', n: 60 }, { asset: 'TRX', n: 40 }] },
    api: { calls: line(5), deliveries: line(2), byEndpoint: [{ path: 'POST /v1/screen', n: 5 }] },
    team: { state: { mfa: 1, roles: { owner: 1, admin: 1, analyst: 1, viewer: 1 }, seen: { today: 1, week: 1, month: 1, older: 1, never: 0 } } },
    evidence: { state: { checks: 100, sealed: 100, decisions: 10, oldest: '2026-06-01T00:00:00Z', retentionYears: 5, age: { month: 25, quarter: 25, year: 25, older: 25 } } },
    previous: { from: '2026-08-30T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z', total: 8, flagged: 2, severe: 1, addresses: 7, assetCount: 2,
        kinds: { history: line(0), other: line(2) }, review: { decisions: line(2), cleared: line(1), confirmed: line(1) }, api: { calls: line(1), deliveries: line(0) } },
    cycle: { used: 10 },
    org: { members: 4, projects: 1, tokens: 1 },
};
    const sub = { planName: 'Growth', included: { screenings: 30000 } };
    exports_.MISSED.clear();
    for (const scope of ['live', 'sandbox']) {
        const o = { ...full, scope };
        const list = exports_.sheets(o, { name: 'Acme' }, sub);
        const refs = new Set();
        for (const lang of ['en', 'hr', 'de']) {
            for (const paper of Object.keys(exports_.PAPERS)) {
                const meta = { reference: exports_.reference(list), generated: '2026-09-03T00:00:00.000Z', organisation: 'Acme', back: '/', lang, paper };
                const html = exports_.report(list, meta, o);
                assert.match(html, new RegExp('<html lang="' + lang + '">'), lang + ': the page does not say its language');
                assert.match(html, /<svg class="chart"[^>]*role="img"/, lang + ': the overview has no chart of the days');
                refs.add(meta.reference);
            }
        }
        assert.strictEqual(refs.size, 1, 'the reference changes with the language');
    }
    assert.deepStrictEqual([...exports_.MISSED], [], 'printed without a translation: ' + [...exports_.MISSED].join(' | '));
    assert.equal(exports_.langOf('HR'), 'hr');
    assert.equal(exports_.langOf('fr'), 'en', 'a language the dashboard does not speak is printed in English');
});

// The page the PDF is made from has to carry everything it needs: the server
// renders it with every request refused. Its fonts are fixed weights, because
// a variable font goes into a PDF as a drawing of each letter, and every
// weight the report sets has its file.
test('the page a PDF is made from needs nothing from outside it', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const out = {
        period: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-03T00:00:00.000Z' },
        scope: 'live', zone: 'UTC',
        screenings: { total: 1, verdicts: {}, assets: [], projects: [], days: [] },
        org: {},
    };
    const list = exports_.sheets(out, { name: 'Acme' }, null);
    const meta = { reference: exports_.reference(list), generated: '2026-09-03T00:00:00.000Z', organisation: 'Acme', back: '/', forPdf: true };
    const html = exports_.report(list, meta, out);
    assert.doesNotMatch(html, /<script/, 'the PDF page runs a script');
    assert.doesNotMatch(html, /(href|src)="\//, 'the PDF page links something from the site');
    assert.doesNotMatch(html, /url\(['"]?\//, 'the PDF page loads a font from the site');
    assert.doesNotMatch(html, /class="bar"/, 'the PDF carries the toolbar');
    assert.match(html, /<body class="is-embed/, 'the PDF page is not the bare paper');
    const faces = [...html.matchAll(/@font-face\{font-family:'([^']+)';font-style:normal;font-weight:(\d+);src:url\(data:font\/woff2;base64,/g)]
        .map((m) => m[1] + ' ' + m[2]);
    assert.ok(faces.length > 0, 'the PDF page has no fonts of its own');
    assert.doesNotMatch(html, /font-weight:\s*\d+ \d+;/, 'a variable font is in the PDF page');
    // every weight the stylesheet sets, in the family it sets it in
    const css = html.slice(html.indexOf('<style>'), html.indexOf('</head>')).replace(/@font-face\{[^}]*\}/g, '');
    const asked = new Set(['Inter 400']);
    for (const m of css.matchAll(/font:(\d{3}) [^;]*?(?:\/[\d.]+)? ('Plus Jakarta Sans'|Inter)/g)) {
        asked.add((m[2] === 'Inter' ? 'Inter' : 'Plus Jakarta Sans') + ' ' + m[1]);
    }
    for (const m of css.matchAll(/font-weight:(\d{3})/g)) asked.add('Inter ' + m[1]);
    const have = new Set(faces);
    const missing = [...asked].filter((f) => !have.has(f));
    assert.deepStrictEqual(missing, [], 'set in a weight the PDF has no file for: ' + missing.join(', '));
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'print-fonts')), 'the fixed weights are not there');
    // the usage page's own sheet rules are stronger than the print ones and
    // printed: a shadow drawn as a picture on every page, and 4px that pushed
    // the cover onto a second, empty one
    const print = css.slice(css.indexOf('@media print'));
    assert.match(print, /\.is-embed \.sheet \{ box-shadow:none; \}/, 'the embedded sheet prints its shadow');
    assert.match(print, /\.is-embed \.doc \{ padding:0; \}/, 'the embedded page prints its padding');
});

// The PDF's bookmarks, each with the page it points at: every bookmark names
// its page by object number, and the page tree lists the pages in order.
function outline(bytes) {
    const s = Buffer.from(bytes).toString('latin1');
    const objects = new Map();
    // a dictionary ends at endobj, or at stream where binary data follows
    for (const m of s.matchAll(/(?:^|[\r\n])(\d+) 0 obj\s*<<([\s\S]*?)>>\s*(endobj|stream)/g)) {
        if (m[3] === 'endobj') objects.set(m[1], m[2]);
    }
    const root = [...objects.entries()].find(([, d]) => /\/Type\s*\/Pages\b/.test(d) && !/\/Parent\s/.test(d));
    const order = [];
    const walk = (num, depth) => {
        const d = objects.get(num) || '';
        if (depth > 20) return;
        if (/\/Type\s*\/Pages\b/.test(d)) {
            const kids = /\/Kids\s*\[([^\]]*)\]/.exec(d);
            for (const k of (kids ? kids[1].match(/\d+(?= 0 R)/g) || [] : [])) walk(k, depth + 1);
        } else order.push(num);
    };
    if (root) walk(root[0], 0);
    const text = (raw) => {
        if (raw[0] === '<') {
            const b = Buffer.from(raw.slice(1, -1).replace(/\s+/g, ''), 'hex');
            return b[0] === 0xfe && b[1] === 0xff ? b.slice(2).swap16().toString('utf16le') : b.toString('latin1');
        }
        return raw.slice(1, -1).replace(/\\([()\\])/g, '$1');
    };
    const out = [];
    for (const d of objects.values()) {
        const t = /\/Title\s*(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>)/.exec(d);
        const dest = /\/Dest\s*\[\s*(\d+) 0 R/.exec(d);
        if (t && dest) out.push({ title: text(t[1]), page: order.indexOf(dest[1]) + 1 });
    }
    return out.sort((a, b) => a.page - b.page);
}

// The PDF itself, where this machine has a browser to make it with: the
// paper asked for, a page for the cover, real fonts rather than drawings of
// them, and no picture anywhere.
test('the PDF comes out on the paper asked for, set in real fonts', { timeout: 120000 }, async (t) => {
    const pdf = require('../pdf.js');
    if (!pdf.available()) { t.skip('no browser here to make a PDF with'); return; }
    const out = {
        period: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-03T00:00:00.000Z' },
        scope: 'live', zone: 'UTC',
        screenings: { total: 1, verdicts: {}, assets: [], projects: [], days: [] },
        org: {},
    };
    const list = exports_.sheets(out, { name: 'Acme' }, null);
    const meta = { reference: exports_.reference(list), generated: '2026-09-03T00:00:00.000Z', organisation: 'Acme', back: '/', forPdf: true };
    for (const [paper, w, h, mended] of [['a4', 595, 842, false], ['letter', 612, 792, false], ['a5', 420, 595, true], ['a3', 842, 1191, true]]) {
        const bytes = await pdf.render(exports_.report(list, { ...meta, paper }, out), exports_.PAPERS[paper]);
        const s = bytes.toString('latin1');
        assert.ok(s.startsWith('%PDF-'), paper + ': not a PDF');
        const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(s);
        assert.ok(box && Math.abs(Number(box[1]) - w) < 2 && Math.abs(Number(box[2]) - h) < 2, paper + ': the page is ' + (box ? box[1] + ' by ' + box[2] : 'missing'));
        assert.doesNotMatch(s, /\/Type3/, paper + ': the letters are drawings, not a font');
        assert.match(s, /\/BaseFont \/[A-Z]{6}\+Inter-Regular/, paper + ': the body is not set in Inter');
        assert.doesNotMatch(s, /\/Subtype \/Image/, paper + ': a picture got into the PDF');
        assert.ok(bytes.length < 400 * 1024, paper + ': ' + bytes.length + ' bytes');
        // the outline: a bookmark for the statement and for every chapter, in
        // order, each on a later page than the one before
        const titles = ['Statement on screening', 'Overview of the period', 'Screenings and review', 'Sanctions coverage', 'API, team and evidence', 'Day by day'];
        const marks = outline(bytes);
        const at = titles.map((t) => (marks.find((m) => m.title === t) || {}).page);
        assert.ok(at.every((n) => n > 1), paper + ': bookmarks missing: ' + JSON.stringify(marks));
        assert.ok(at.every((n, i) => !i || n > at[i - 1]), paper + ': chapters out of order: ' + at.join(', '));
        // On A5 and A3 the page Chromium writes is a fraction of a point larger
        // than the one it lays out, which left white along the cover's edge;
        // the cover is stretched to the page in an update to the file. On A4
        // and Letter the two agree, and the file is left as it was written.
        if (mended) {
            assert.match(s, /\/Prev \d+>>\nstartxref\n\d+\n%%EOF\n$/, paper + ': the cover was not stretched to its page');
            // the back is dark to its edges too
            assert.equal((s.match(/stream\nq 1\.\d+ 0 0 1\.\d+ 0 -?[\d.]+ cm\nendstream/g) || []).length, 2, paper + ': the covers are not both stretched');
        } else {
            assert.doesNotMatch(s, /\/Prev \d+>>\nstartxref/, paper + ': mended when there was nothing to mend');
        }
    }
});

// The paper at its largest: the longest organisation name the product
// allows, numbers in the millions, German, on A5, the smallest sheet. Nothing
// may be cut off: the statement still ends on its page with its confirmation,
// the overview starts on the page after it, and the overview's notes stay
// together however far the table pushes them.
test('the paper holds the largest report a period can make', { timeout: 120000 }, async (t) => {
    const pdf = require('../pdf.js');
    if (!pdf.available()) { t.skip('no browser here to make a PDF with'); return; }
    const line = (n) => ({ total: n, days: [{ day: '2026-09-01', n }, { day: '2026-09-02', n: 0 }] });
    const big = {
        period: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-03T00:00:00.000Z' }, scope: 'live', zone: 'Europe/Zagreb',
        screenings: { total: 12345678, flagged: 1234567, clear: 11111111, addresses: 9876543, assetCount: 2,
            verdicts: { severe: 654321, review: 580246, clear: 11111111 }, assets: [{ asset: 'XBT', n: 7345678 }, { asset: 'ETH', n: 5000000 }],
            projects: [{ id: '', name: '', n: 12345678 }],
            days: [{ day: '2026-09-01', n: 7345678, flagged: 734567, severe: 354321, addresses: 5876543 }, { day: '2026-09-02', n: 5000000, flagged: 500000, severe: 300000, addresses: 4000000 }] },
        kinds: { live: line(12000000), history: line(345678) },
        review: { decisions: line(4567890), cleared: line(4000000), confirmed: line(567890), holding: line(0),
            took: { hour: 1000000, day: 2000000, week: 1000000, longer: 567890 }, queue: { open: 3456789, holding: 0, oldest: '2026-08-01T00:00:00Z', age: { day: 1, week: 456789, month: 1000000, older: 1999999 } } },
        lists: { byList: { ofac: 1050 }, byTheme: {}, byChain: [{ asset: 'XBT', n: 528 }] },
        api: { calls: line(98765432), deliveries: line(12345678), byEndpoint: [{ path: 'POST /v1/screen', n: 98765432 }] },
        team: { state: { mfa: 1, roles: { owner: 1 }, seen: { today: 1 } } },
        evidence: { state: { checks: 98765432, sealed: 98765432, decisions: 4567890, oldest: '2026-06-01T00:00:00Z', retentionYears: 5, age: { month: 1, quarter: 1, year: 1, older: 1 } } },
        previous: { from: '2026-08-30T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z', total: 23456789, flagged: 2345678, severe: 1234567, addresses: 8765432, assetCount: 2,
            review: { decisions: line(2) } },
        cycle: { used: 12345678 }, org: { members: 1, projects: 0, tokens: 1 },
    };
    const name = 'Wolfsburger Kryptowährungsbörse und Zahlungsdienstleister Gesellschaft mbH & Co KG'.slice(0, 80);
    const list = exports_.sheets(big, { name }, { planName: 'Enterprise Custom Agreement 2026', included: { screenings: 99999999 } });
    const html = exports_.report(list, { reference: exports_.reference(list), generated: '2026-09-03T00:00:00.000Z',
        organisation: name, back: '/', lang: 'de', paper: 'a5', forPdf: true }, big);
    assert.match(html, /\.notes, \.cmp, \.lede \{ break-inside:avoid; \}/, 'the notes can be split across pages');
    assert.match(html, /table\.sum tr td\.n, table\.sum tr th\.n \{ padding-left:14px; white-space:nowrap; \}/, 'a long number can run into the one beside it');
    const marks = outline(await pdf.render(html, exports_.PAPERS.a5));
    const at = (t) => (marks.find((m) => m.title === t) || {}).page;
    assert.equal(at('Erklärung zu den Prüfungen'), 2, 'the statement does not start on page 2');
    assert.equal(at('Überblick über den Zeitraum'), 3, 'the statement runs onto a second page');
    assert.ok(at('Prüfungen und Entscheidungen') > 3, 'the chapters after the overview are out of place');
});

// A company using every chain, two hundred projects and fifteen endpoints.
// The chapters show the ten largest of each and the rest as one row, so the
// table still reads in a glance; every row is in the appendix, largest
// first, so the paper still holds all of it.
test('a long list shows its ten largest and keeps every row in the appendix', { timeout: 120000 }, async (t) => {
    const line = (n) => ({ total: n, days: [{ day: '2026-09-01', n }, { day: '2026-09-02', n: 0 }] });
    const chains = Array.from({ length: 64 }, (_, i) => ({ asset: 'C' + String(i).padStart(2, '0'), n: 6400 - i * 100 }));
    const out = {
        period: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-03T00:00:00.000Z' }, scope: 'live', zone: 'UTC',
        screenings: { total: chains.reduce((a, c) => a + c.n, 0), flagged: 0, clear: 1, addresses: 1, assetCount: 64, verdicts: { clear: 1 },
            assets: chains, projects: Array.from({ length: 200 }, (_, i) => ({ id: String(i + 1), name: 'Project ' + (i + 1), n: 1000 - i })),
            days: [{ day: '2026-09-01', n: 1, flagged: 0, severe: 0, addresses: 1 }, { day: '2026-09-02', n: 0, flagged: 0, severe: 0, addresses: 0 }] },
        kinds: { live: line(1) },
        api: { calls: line(1), deliveries: line(0), byEndpoint: Array.from({ length: 15 }, (_, i) => ({ path: 'GET /v1/e' + i, n: 100 - i })) },
        lists: { byList: { ofac: 1 }, byTheme: {}, byChain: chains.slice(0, 24) },
        org: {},
    };
    const list = exports_.sheets(out, { name: 'Acme' }, null);
    const meta = { reference: exports_.reference(list), generated: '2026-09-03T00:00:00.000Z', organisation: 'Acme', back: '/', forPdf: true };
    const html = exports_.report(list, meta, out);
    const chapters = html.split('class="sheet chapter"').slice(1);
    const detail = chapters[1];
    assert.equal((detail.match(/<td>C\d\d<\/td>/g) || []).length, 10, 'the chapter does not show ten chains');
    assert.match(detail, /<td>Other chains \(54\)<\/td>/, 'the rest of the chains are not one row');
    assert.match(detail, /<td>Other projects \(190\)<\/td>/, 'the rest of the projects are not one row');
    assert.match(chapters[3], /<td>Other endpoints \(5\)<\/td>/, 'the rest of the endpoints are not one row');
    assert.match(chapters[2], /<table class="has-bars">/, 'the coverage has no bars');
    // a group of a breakdown short enough to keep is kept whole on paper, so
    // its last two rows never go over to a page of their own
    assert.match(chapters[2], /<tbody class="g-keep"><tr class="grp">/, 'a short group can be split over two pages');
    assert.match(html, /tbody\.g-keep \{ break-inside:avoid; \}/, 'a short group can be split over two pages');
    // day by day: every day under its month, the quiet ones set back, the
    // period's totals at the foot
    const days = chapters[4];
    assert.match(days, /<p class="part-what">Every day in the period, in the organisation’s time zone, UTC\.<\/p>/, 'the days do not say whose clock they keep');
    assert.match(days, /<table class="days">[\s\S]*<tr class="grp"><th colspan="6">September 2026<\/th><\/tr>/, 'the days are not under their month');
    assert.match(days, /<tr class="is-zero"><td>Wed 2<\/td>/, 'a day with nothing on it is not set back');
    assert.match(days, /<tfoot><tr class="tot"><td>Total<\/td><td class="n">1<\/td>/, 'the days have no total');
    assert.match(detail, /The full list is in the appendix at the end of this report\./, 'the chapter does not say where the rest is');
    const appendix = chapters[5] || '';
    assert.match(appendix, /<h2 class="big">Appendix<\/h2>/, 'there is no appendix');
    for (const [title, n] of [['Checks by chain', 64], ['Checks by project', 200], ['Designated addresses by chain', 24], ['API calls by endpoint', 15]]) {
        const part = appendix.split('<div class="part').find((x) => x.includes('<h3>' + title + '</h3>')) || '';
        assert.equal((part.match(/<tbody>[\s\S]*<\/tbody>/)[0].match(/<tr>/g) || []).length, n, title + ' does not list every row');
    }
    // a part longer than a page breaks between rows rather than leaving an
    // empty page behind it; only a short one is kept whole
    assert.match(html, /\.chapter \.part\.keep \{ break-inside:avoid; \}/, 'a long part can leave an empty page');
    assert.match(detail, /<div class="part">/, 'the long part is held whole');
    // and a report with a handful of each has no appendix at all
    const small = exports_.sheets({ ...out, screenings: { ...out.screenings, assets: chains.slice(0, 3), projects: [] },
        api: { ...out.api, byEndpoint: [] }, lists: { ...out.lists, byChain: [] } }, { name: 'Acme' }, null);
    assert.doesNotMatch(exports_.report(small, meta, out), /Other chains|<h2 class="big">Appendix/, 'a short list is cut anyway');
    const pdf = require('../pdf.js');
    if (!pdf.available()) { t.skip('no browser here to make a PDF with'); return; }
    const marks = outline(await pdf.render(html, exports_.PAPERS.a4));
    const order = ['Overview of the period', 'Screenings and review', 'Sanctions coverage', 'API, team and evidence', 'Day by day', 'Appendix']
        .map((x) => (marks.find((m) => m.title === x) || {}).page);
    assert.ok(order.every((n, i) => n && (!i || n > order[i - 1])), 'the chapters are out of order: ' + order.join(', '));
});

// The sample a whole year fills: every chapter full, the appendix holding
// what the chapters cut, and an axis wide enough for numbers in the tens of
// thousands. A fixed one printed a day's 60.000 as "0.000".
test('the full sample fills every chapter, and the chart has room for its numbers', { timeout: 120000 }, async (t) => {
    const sample = require('../report-sample.js').full(new Date('2026-10-14T10:00:00Z'));
    const list = exports_.sheets(sample.out, sample.org, sample.sub);
    for (const lang of ['en', 'de', 'hr']) {
        const meta = { reference: exports_.reference(list), generated: '2026-10-14T10:00:00Z', organisation: sample.org.name, back: '/', forPdf: true, lang, paper: 'a5' };
        const html = exports_.report(list, meta, sample.out);
        const chapters = html.split('class="sheet chapter"').slice(1);
        assert.equal(chapters.length, 6, lang + ': a chapter is missing');
        const days = chapters[4].match(/<table class="days">[\s\S]*?<\/table>/)[0];
        assert.equal((days.match(/<tr( class="is-zero")?><td>/g) || []).length, 365, lang + ': a day of the year is missing');
        assert.equal((days.match(/<tr class="grp">/g) || []).length, 13, lang + ': the days are not under their months');
        for (const [, x, label] of chapters[0].matchAll(/<text x="([\d.]+)" y="[\d.]+" text-anchor="end">([^<]+)<\/text>/g)) {
            assert.ok(Number(x) >= label.length * 8, lang + ': "' + label + '" has ' + x + ' units to stand in');
        }
        // a group breaks over a page only with three rows on either side:
        // its head and first three are one body, its last three another
        assert.doesNotMatch(html, /<tbody( class="g-keep")?><\/tbody>/, lang + ': an empty body in a table');
        assert.match(days, /<tbody class="g-keep"><tr class="grp"><th colspan="6">[^<]+<\/th><\/tr>(<tr[^>]*>(?:(?!<\/tr>)[\s\S])*<\/tr>){3}<\/tbody><tbody>/, lang + ': a month does not hold its first three days');
    }
    assert.equal(sample.org.name.length, 80, 'the sample name is not the longest one allowed');
});

// A cover for each plan, front and back: its own colours and its own
// arrangement of the shapes. A report with no plan takes Starter's. The
// overview's chart names no day: the axis says how high a column is.
test('each plan has its own cover, and the report closes on the back of it', () => {
    const sample = require('../report-sample.js').full(new Date('2026-10-14T10:00:00Z'));
    const list = exports_.sheets(sample.out, sample.org, sample.sub);
    const meta = { reference: exports_.reference(list), generated: '2026-10-14T10:00:00Z', organisation: sample.org.name, back: '/', forPdf: true };
    const art = (html, back) => (html.match(/<svg class="c-art"[\s\S]*?<\/svg>/g) || [])[back ? 1 : 0] || '';
    const seen = new Set();
    for (const plan of ['starter', 'growth', 'enterprise']) {
        const html = exports_.report(list, { ...meta, plan }, sample.out);
        const covers = html.match(/<section class="sheet cover( back)?"/g) || [];
        assert.deepEqual(covers, ['<section class="sheet cover"', '<section class="sheet cover back"'], plan + ': not one cover at each end');
        assert.ok(html.lastIndexOf('class="sheet cover back"') > html.lastIndexOf('<h3>Report details</h3>'), plan + ': the back is not last');
        assert.doesNotMatch(html, /End of report/, plan + ': the report still says it has ended before its back cover');
        assert.notEqual(art(html), art(html, true), plan + ': the back is the front again');
        // the back is the shapes and the eye, and nothing written on it
        assert.match(art(html, true), /stroke="url\(#backInk\)"/, plan + ': the back has no eye at its centre');
        assert.match(html, /<section class="sheet cover back" style="[^"]*"><svg class="c-art"[\s\S]*?<\/svg><\/section>/, plan + ': there is writing on the back');
        seen.add(art(html));
        assert.doesNotMatch(html, /busiest/, plan + ': the chart still names its busiest day');
    }
    assert.equal(seen.size, 3, 'two plans share a cover');
    assert.equal(art(exports_.report(list, meta, sample.out)), art(exports_.report(list, { ...meta, plan: 'starter' }, sample.out)), 'a report with no plan does not take Starter\'s cover');
    assert.match(exports_.report(list, meta, sample.out), /@page bare \{ margin:0;/, 'the back is printed inside a margin');
});

// The sample is invented numbers, and it is only ever served where that is
// what a reader expects: on staging, which says so, and on a laptop. A
// production server, or any deployed one that does not say it is staging,
// serves none of it, whatever else its environment says.
test('the full sample is served on staging and in development, never in production', () => {
    const { enabled } = require('../report-sample.js');
    assert.equal(enabled({ APP_ENV: 'staging', NODE_ENV: 'production', RAILWAY_ENVIRONMENT_NAME: 'staging' }), true, 'staging');
    assert.equal(enabled({ NODE_ENV: 'development' }), true, 'a laptop');
    assert.equal(enabled({ NODE_ENV: 'test' }), true, 'a test run');
    assert.equal(enabled({ NODE_ENV: 'production', RAILWAY_ENVIRONMENT_NAME: 'production' }), false, 'production');
    assert.equal(enabled({ NODE_ENV: 'production' }), false, 'production off Railway');
    assert.equal(enabled({ RAILWAY_ENVIRONMENT_NAME: 'production' }), false, 'a deployed server that does not say what it is');
    assert.equal(enabled({ NODE_ENV: 'development', RAILWAY_ENVIRONMENT_NAME: 'production' }), false, 'a deployed server set to development');
    assert.equal(enabled({}), false, 'a server that says nothing');
    assert.equal(enabled(), false, 'no environment at all');
});

// A file's name says what it is before it is opened: ours, whose, the first
// and last day it covers, and the language of the two a person reads.
test('an export is named for whose it is, the days it covers and its language', () => {
    const out = { period: { from: '2026-09-14T00:00:00.000Z', to: '2026-10-14T00:00:00.000Z' }, scope: 'live' };
    const name = (f, organisation, lang, o) => exports_.filename(o || out, f, { organisation, lang });
    assert.equal(name('pdf', 'Čistoća d.o.o.', 'hr'), 'sentinelpay-usage_cistoca-d-o-o_2026-09-14_2026-10-13_hr.pdf');
    assert.equal(name('xlsx', 'Straße & Söhne GmbH', 'de'), 'sentinelpay-usage_strasse-sohne-gmbh_2026-09-14_2026-10-13_de.xlsx');
    // a program's formats are in one language, so they carry none
    assert.equal(name('csv', 'Acme', 'hr'), 'sentinelpay-usage_acme_2026-09-14_2026-10-13.csv');
    assert.equal(name('json', 'Acme', 'de'), 'sentinelpay-usage_acme_2026-09-14_2026-10-13.json');
    assert.equal(name('csv', 'Acme', '', { ...out, scope: 'sandbox' }), 'sentinelpay-usage_acme_2026-09-14_2026-10-13_sandbox.csv');
    // a long name ends at a word, and a name with no letters drops out
    assert.equal(name('pdf', 'Internationale Handels- und Verwahrungsgesellschaft für digitale Vermögenswerte', 'en'),
        'sentinelpay-usage_internationale-handels-und_2026-09-14_2026-10-13_en.pdf');
    assert.equal(name('json', '***', 'en'), 'sentinelpay-usage_2026-09-14_2026-10-13.json');
    for (const n of [name('pdf', '"; rm -rf / <x>', 'en'), name('csv', '../../etc/passwd', 'en')]) {
        assert.match(n, /^[a-z0-9_.-]+$/, 'a name carries a character a header or a path would read: ' + n);
    }
});

// The CSV is one table: the same seven columns on every line, the report
// itself as the first rows, every day's figure a row of its own.
test('the csv is one table a program can read without being told where parts begin', () => {
    const sample = require('../report-sample.js').full(new Date('2026-10-14T10:00:00Z'));
    const list = exports_.sheets(sample.out, sample.org, sample.sub);
    const meta = { reference: exports_.reference(list), generated: '2026-10-14T10:00:00.000Z', organisation: sample.org.name };
    const text = exports_.csv(list, meta);
    assert.ok(text.startsWith('﻿section,date,breakdown,item,value,share_percent,period_before\r\n'), 'the heading is not the first line');
    const lines = text.slice(1).trim().split('\r\n');
    // the cells of a line, a quoted comma not ending one
    const cells = (line) => {
        const outCells = [''];
        let quoted = false;
        for (const ch of line) {
            if (ch === '"') quoted = !quoted;
            else if (ch === ',' && !quoted) outCells.push('');
            else outCells[outCells.length - 1] += ch;
        }
        return outCells;
    };
    for (const line of lines) assert.equal(cells(line).length, 7, 'a line is not seven columns: ' + line);
    assert.ok(lines.includes('Report,,,Reference,sha256:' + meta.reference + ',,'), 'the reference is not in the table');
    assert.equal(lines.filter((l) => l.startsWith('Daily,')).length, 365 * 9, 'a day\'s figure is missing');
    assert.ok(lines.includes('Summary,,,Period to,2026-10-13,,2025-10-13'), 'the period does not end on its last day');
    assert.ok(lines.some((l) => l.startsWith('API,,By endpoint,POST /v1/screen,')), 'the endpoints are not under a breakdown');
    // a number is written as a number, even a negative one
    assert.equal(exports_.csvCell(-3), '-3');
    assert.equal(exports_.csvCell('-3'), "'-3");
});

// The JSON is the same figures as objects a program addresses by name.
test('the json addresses every figure by name', () => {
    const sample = require('../report-sample.js').full(new Date('2026-10-14T10:00:00Z'));
    const list = exports_.sheets(sample.out, sample.org, sample.sub);
    const meta = { reference: exports_.reference(list), generated: '2026-10-14T10:00:00.000Z', organisation: sample.org.name };
    const doc = JSON.parse(exports_.json(list, meta, sample.out));
    assert.equal(doc.version, 2);
    assert.deepEqual(doc.period, { firstDay: '2025-10-14', lastDay: '2026-10-13', from: '2025-10-14T00:00:00.000Z',
        to: '2026-10-14T00:00:00.000Z', zone: 'Europe/Zagreb', unit: 'day' });
    assert.equal(doc.summary.screenings.value, sample.out.screenings.total);
    assert.equal(doc.summary.screeningsIncludedThisCycle.periodBefore, null, 'a figure with nothing before it is not null');
    assert.equal(doc.summary.organisation, undefined, 'the head of the report is repeated in the summary');
    assert.equal(doc.daily.length, 365);
    assert.deepEqual(Object.keys(doc.daily[0]), ['date', 'screenings', 'flagged', 'sanctioned', 'distinctAddresses',
        'decisions', 'cleared', 'confirmed', 'apiCalls', 'webhookDeliveries']);
    assert.equal(doc.breakdowns.screenings.byChain.length, 64);
    assert.deepEqual(Object.keys(doc.breakdowns.screenings.byKind[0]), ['item', 'count', 'sharePercent']);
    assert.equal(doc.breakdowns.api.byEndpoint[0].endpoint, 'POST /v1/screen');
    assert.deepEqual(Object.keys(doc.breakdowns.review), ['timeToADecision', 'stillOpenByAge']);
});

// The workbook, opened: its parts read back out of the zip.
function unzip(buf) {
    const zlib = require('zlib');
    const files = {};
    for (let at = 0; buf.readUInt32LE(at) === 0x04034b50;) {
        const size = buf.readUInt32LE(at + 18);
        const nameLen = buf.readUInt16LE(at + 26);
        const name = buf.slice(at + 30, at + 30 + nameLen).toString('utf8');
        const start = at + 30 + nameLen + buf.readUInt16LE(at + 28);
        files[name] = zlib.inflateRawSync(buf.slice(start, start + size)).toString('utf8');
        at = start + size;
    }
    return files;
}

test('the workbook is in the reader\'s language, dressed as the report, with its figures still figures', () => {
    const sample = require('../report-sample.js').full(new Date('2026-10-14T10:00:00Z'));
    const list = exports_.sheets(sample.out, sample.org, sample.sub);
    const meta = { reference: exports_.reference(list), generated: '2026-10-14T10:00:00.000Z', organisation: sample.org.name, lang: 'hr' };
    const files = unzip(exports_.xlsx(list, meta, sample.out));
    const wb = files['xl/workbook.xml'];
    const names = [...wb.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(names, ['O izvješću', 'Sažetak', 'Dan po dan', 'Provjere', 'Pregled', 'Pokrivenost', 'API', 'Tim', 'Dokazi']);
    const sheet = (i) => files['xl/worksheets/sheet' + i + '.xml'];
    const styles = files['xl/styles.xml'];
    const xf = [...styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)[1].matchAll(/<xf [^>]*>[\s\S]*?<\/xf>/g)].map((m) => m[0]);
    const fmts = new Map([...styles.matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]+)"\/>/g)].map((m) => [m[1], m[2]]));
    const fmtOf = (cell) => {
        const s = /s="(\d+)"/.exec(cell);
        const id = /numFmtId="(\d+)"/.exec(xf[s ? +s[1] : 0])[1];
        return id === '3' ? '#,##0' : fmts.get(id) || id;
    };
    const cell = (xml, ref) => (xml.match(new RegExp('<c r="' + ref + '"[^>]*?(/>|>[\\s\\S]*?</c>)')) || [''])[0];
    // the first sheet says whose it is, links to every other, carries the reference
    assert.match(sheet(1), new RegExp('sha256:' + meta.reference));
    assert.equal((sheet(1).match(/<hyperlink /g) || []).length, 8, 'the first sheet does not link to every sheet');
    assert.match(files['docProps/core.xml'], /<dc:creator>Sentinelpay<\/dc:creator>/);
    assert.match(files['docProps/core.xml'], /<dc:language>hr<\/dc:language>/);
    for (let i = 1; i <= names.length; i++) {
        // every sheet under the cover's band, with no grid and the reference at its foot
        assert.match(sheet(i), /showGridLines="0"/, names[i - 1] + ': the grid shows');
        assert.match(sheet(i), /<mergeCell ref="A1:[A-Z]+1"\/>/, names[i - 1] + ': no band over the sheet');
        assert.match(sheet(i), /<oddFooter>&amp;L&amp;8&amp;K6B7898Referenca [0-9a-f]{16}&amp;R&amp;8&amp;K6B7898Stranica &amp;P od &amp;N<\/oddFooter>/, names[i - 1] + ': no reference at the foot');
    }
    assert.match(styles, /<fgColor rgb="FF0B1020"\/>/, 'the band is not the cover\'s dark');
    assert.match(styles, /<fgColor rgb="FF00E0FF"\/>[\s\S]*<fgColor rgb="FFA020F0"\/>/, 'the logo\'s colours are not under the band');
    // the summary beside the period before, with how far it moved
    const summary = sheet(2);
    assert.match(summary, /Ovo razdoblje[\s\S]*Prethodno razdoblje[\s\S]*Promjena/);
    assert.equal(fmtOf(cell(summary, 'D9')), '+0.0%;−0.0%;0.0%', 'the change is not a percentage');
    // a day is a date in the report's language, a count a number with its thousands marked
    const daily = sheet(3);
    assert.match(cell(daily, 'A8'), /<v>45944<\/v>/, 'the first day is not the date 2025-10-14');
    assert.equal(fmtOf(cell(daily, 'A8')), '[$-41A]ddd d mmm yyyy');
    assert.equal(fmtOf(cell(daily, 'B8')), '#,##0');
    // filtered, frozen, printed with its heading on every page, added up with what a filter leaves
    assert.match(daily, /<autoFilter ref="A7:J372"\/>/);
    assert.match(daily, /<pane xSplit="1" ySplit="7" topLeftCell="B8"/);
    assert.match(daily, /<c r="B373" s="\d+"><f>SUBTOTAL\(109,B8:B372\)<\/f><v>\d+<\/v><\/c>/);
    assert.match(wb, /<definedName name="_xlnm\._FilterDatabase" localSheetId="2" hidden="1">'Dan po dan'!\$A\$7:\$J\$372<\/definedName>/);
    assert.match(wb, /<definedName name="_xlnm\.Print_Titles" localSheetId="2">'Dan po dan'!\$7:\$7<\/definedName>/);
    // a breakdown: its groups under headings, a bar beside each count, shares as percentages
    const checks = sheet(4);
    assert.match(checks, /<t xml:space="preserve">Po vrsti<\/t>/);
    assert.match(checks, /<t xml:space="preserve">█{22}<\/t>/, 'the largest count has no full bar');
    assert.equal(fmtOf(cell(checks, 'D9')), '0.0%');
    assert.match(cell(checks, 'D9'), /<v>0\.61<\/v>/);
    // names given by people are printed as they were given
    assert.match(checks, /<t xml:space="preserve">Card program 01, Frankfurt/);
    assert.doesNotMatch(Object.values(files).join(''), /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/, 'a character XML cannot carry');
});
