'use strict';

// The edges: what a file handed to a spreadsheet can do, what a page the
// renderer draws can do, which requests count as ours, and which database a
// tool is about to write to.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('a name with a ";" in it is one cell in a Croatian or German Excel', () => {
    const { csvCell } = require('../exports');
    assert.strictEqual(csvCell('Acme;=1+1'), '"Acme;=1+1"');
    assert.strictEqual(csvCell("P;=cmd|' /C calc'!A0;"), "\"P;=cmd|' /C calc'!A0;\"");
    assert.strictEqual(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
    assert.strictEqual(csvCell(-3), '-3', 'a number became text');
});

test('a name keeps its letters and loses what is not text', () => {
    const orgs = require('../orgs');
    const projects = require('../projects');
    for (const clean of [orgs.cleanName, projects.cleanName]) {
        assert.strictEqual(clean('Acme‮gnp.exe'), 'Acmegnp.exe', 'a right-to-left override survived');
        assert.strictEqual(clean('Acme￿\u0007 d.o.o.'), 'Acme d.o.o.');
        assert.strictEqual(clean('Ćevapi & Šljivovica GmbH'), 'Ćevapi & Šljivovica GmbH');
    }
    const ex = read('exports.js');
    assert.match(ex, /\\u000e-\\u001f\\ufffe\\uffff\]/, 'the workbook can be handed a character XML cannot hold');
});

test('the renderer draws with scripting off, a deadline, a short queue and none of our secrets', () => {
    const pdf = read('pdf.js');
    assert.match(pdf, /await page\.setJavaScriptEnabled\(false\);/);
    assert.match(pdf, /const QUEUE_MAX = \d+;/);
    assert.match(pdf, /if \(waiting\.length >= QUEUE_MAX\)/);
    assert.match(pdf, /Promise\.race\(\[drawn\(html, paper/);
    assert.match(pdf, /env: Object\.fromEntries\(\['PATH', 'HOME'/, 'the browser inherits the whole environment');
    const ex = read('exports.js');
    assert.match(ex, /meta\.forPdf \? '<meta http-equiv="Content-Security-Policy" content="default-src \\'none\\'/);
    const index = read('index.js');
    assert.match(index, /keyGenerator: \(req\) => `usage-pdf:\$\{whoForLimit\(req\)\}`/);
    assert.match(index, /wasShown\(me\.userId, mine\.id, ref\)/, 'any reference can be filed as printed');
    assert.match(index, /accounts\.audit\('usage-preview'/, 'a preview leaves no trace');
});

test('a request counts as ours from this host or its www twin, not from anywhere under the domain', () => {
    const index = read('index.js');
    assert.match(index, /return from === to \|\| from === 'www\.' \+ to \|\| to === 'www\.' \+ from;/);
    assert.doesNotMatch(index, /fetchSite === 'same-origin' \|\| fetchSite === 'same-site' \|\| fetchSite === 'none'/);
    assert.doesNotMatch(index, /callback\(new Error\('Not allowed by CORS'\)\)/, 'a foreign origin is a 500');
    const csp = index.slice(index.indexOf("'script-src': ["), index.indexOf("'style-src'"))
        .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.doesNotMatch(csp, /blob:|\*\./, 'scripts may come from a blob or a wildcard host');
    assert.match(index, /fromOurCloudflare\(req\) \|\| \(enforceCloudflare && fromCloudflareEdge\(req\.ip\)\)/,
        'any client can name its own address');
    assert.match(index, /app\.post\('\/v1\/screen', requireCloudflareOrigin,/);
    assert.equal((index.match(/^function escapeHtml/gm) || []).length, 1, 'two escapeHtml, and the weaker one wins');
});

test('a database says what it is, and the tools ask it', () => {
    const { deployedAs } = require('../app-env');
    assert.strictEqual(deployedAs({ APP_ENV: 'staging', NODE_ENV: 'production' }), 'staging');
    assert.strictEqual(deployedAs({ RAILWAY_ENVIRONMENT_NAME: 'production', NODE_ENV: 'production' }), 'production');
    assert.strictEqual(deployedAs({ NODE_ENV: 'production' }), 'production');
    assert.strictEqual(deployedAs({}), 'development');
    for (const tool of ['wipe-orgs', 'reset-plan', 'seed-usage', 'reset-link', 'seed-staging']) {
        const src = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', tool + '.js'), 'utf8');
        assert.match(src, /requireTarget\(/, tool + ' does not ask the database');
        assert.doesNotMatch(src, /I_MEAN_IT/, tool + ' still has an override');
    }
    const snap = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'snapshot-to-staging.js'), 'utf8');
    assert.match(snap, /if \(to !== 'staging'\)/);
    assert.match(snap, /VALUES \(\$1,\$2,\$3,\$4,NULL,NULL\)/, 'audit detail is copied into staging');
    assert.doesNotMatch(snap, /Object\.assign\(\{\}, fields,/, 'every field of a lead is copied into staging');
});

test('the dashboard keeps nothing runnable in the report frame or prototype in a lookup', () => {
    const dash = read('public/dash-app.js');
    assert.match(dash, /frame\.setAttribute\('sandbox', 'allow-same-origin allow-modals'\);/);
    assert.match(dash, /if \(frame && e\.source !== frame\.contentWindow\) return;/);
    const i18n = read('public/i18n.js');
    assert.doesNotMatch(i18n, /dict\[norm\(/, 'a dictionary is read off its prototype');
    assert.doesNotMatch(read('public/index.html'), /sb-[a-z]+-auth-token/);
    assert.doesNotMatch(read('public/inbox.js'), /token/);
});
