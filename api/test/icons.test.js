'use strict';

// An icon is a word. Somebody learns what a mark means from what it opened the
// last time they pressed it, so drawing the same one for two different things
// teaches them something untrue, and it goes wrong quietly: nothing throws, the
// page looks finished, and the reader is the only one who notices.
//
// This reads the dashboard source and holds two rules to it: every icon a
// screen asks for has to exist, and no icon may carry two meanings. It is a
// test rather than a convention because a convention is only as good as whoever
// is in a hurry.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'dash-app.js'), 'utf8');

function iconNames() {
    const block = SRC.match(/var ICONS = \{([\s\S]*?)\n    \};/);
    assert.ok(block, 'could not find the ICONS map');
    return new Set([...block[1].matchAll(/^\s{8}([a-z]+):/gm)].map((m) => m[1]));
}

// every place a glyph is chosen, with the thing it is chosen for
function uses() {
    const out = [];
    // a bare icon('name') call, named by the function it sits in. this was
    // added after a padlock was put on a read-only field while already meaning
    // Security in the rail: the rules only looked at nav items and cards, so
    // the one kind of use that is easiest to add by hand went unchecked.
    for (const m of SRC.matchAll(/icon\('([a-z]+)'\)/g)) {
        const before = SRC.slice(0, m.index);
        const fn = [...before.matchAll(/function ([A-Za-z0-9_]+)\s*\(/g)].pop();
        out.push({ meaning: 'in ' + (fn ? fn[1] : 'top level'), icon: m[1] });
    }
    // nav items: { key: 'x', label: 'Label', icon: 'name' }
    for (const m of SRC.matchAll(/label: '([^']+)', icon: '([a-z]+)'/g)) {
        out.push({ meaning: m[1], icon: m[2] });
    }
    // cards: orghCard('Title', 'name')
    for (const m of SRC.matchAll(/orghCard\('([^']+)', '([a-z]+)'\)/g)) {
        out.push({ meaning: m[1], icon: m[2] });
    }
    // account menu rows: acctRow('Title', { icon: 'name'
    for (const m of SRC.matchAll(/acctRow\('([^']+)',\s*\{\s*\n?\s*icon: '([a-z]+)'/g)) {
        out.push({ meaning: m[1], icon: m[2] });
    }
    return out;
}

test('every icon a screen asks for is drawn', () => {
    const have = iconNames();
    const asked = new Set();
    for (const u of uses()) asked.add(u.icon);

    const missing = [...asked].filter((name) => !have.has(name));
    assert.deepStrictEqual(missing, [], 'icons used but never drawn: ' + missing.join(', '));
});

// A glyph may appear in more than one place when the places mean the same
// thing. Every entry has to say why, which is the point: adding one is a
// sentence somebody has to be willing to write.
const SAME = new Map([
    ['projects', 'the rail item and the mark on a project row name the same thing'],
    ['back', 'one back arrow, wherever there is something to go back from'],
]);

test('no icon carries two meanings', () => {
    const byIcon = new Map();
    for (const u of uses()) {
        if (!byIcon.has(u.icon)) byIcon.set(u.icon, new Set());
        byIcon.get(u.icon).add(u.meaning);
    }
    const shared = [...byIcon.entries()]
        .filter(([name]) => !SAME.has(name))
        .filter(([, meanings]) => meanings.size > 1)
        .map(([name, meanings]) => name + ' -> ' + [...meanings].join(' / '));
    assert.deepStrictEqual(shared, [], 'one glyph, several meanings: ' + shared.join('; '));
});

test('every allowed repeat is still a repeat', () => {
    // an entry left behind after the second use is gone reads as a licence
    // nobody needs and quietly weakens the rule above.
    const byIcon = new Map();
    for (const u of uses()) {
        if (!byIcon.has(u.icon)) byIcon.set(u.icon, new Set());
        byIcon.get(u.icon).add(u.meaning);
    }
    const stale = [...SAME.keys()].filter((name) => (byIcon.get(name) || new Set()).size < 2);
    assert.deepStrictEqual(stale, [], 'allowed to repeat but no longer does: ' + stale.join(', '));
});

test('nothing in the map is drawn but never used', () => {
    // A glyph nobody asks for is either a leftover or the next person's
    // temptation to reuse one that already means something else. Chrome is
    // exempt: it is the shell, not a destination.
    const CHROME = new Set(['panel', 'back', 'out']);
    const have = iconNames();
    const asked = new Set();
    for (const u of uses()) asked.add(u.icon);

    const spare = [...have].filter((name) => !asked.has(name) && !CHROME.has(name));
    assert.deepStrictEqual(spare, [], 'drawn but unused: ' + spare.join(', '));
});

test('every glyph is a single 24 by 24 drawing', () => {
    const block = SRC.match(/var ICONS = \{([\s\S]*?)\n    \};/)[1];
    // the wrapper sets viewBox, stroke and width, so a glyph carrying its own
    // would fight it. all a glyph may be is the shapes inside.
    const wrong = [...block.matchAll(/^\s{8}([a-z]+):([\s\S]*?)(?=\n\s{8}[a-z]+:|$)/gm)]
        .filter((m) => /viewBox|<svg|stroke-width|fill="[^n]/.test(m[2]))
        .map((m) => m[1]);
    assert.deepStrictEqual(wrong, [], 'glyphs setting their own frame: ' + wrong.join(', '));
});
