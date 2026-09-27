'use strict';

// The dictionary, checked for the mistakes it cannot report itself.
//
// A translation table is a javascript object literal, and an object literal
// with the same key twice is not an error: the last one wins and the earlier
// one is dead text that looks alive. Nothing complains, the page keeps working,
// and somebody edits the copy that is never read -- which is exactly what
// happened when a set of plan sentences was added a second time in different
// words, and the version nobody wrote last was the one on screen.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'i18n.js'), 'utf8');

// The keys as they are written, not as they survive being parsed: the whole
// point is to see the ones an object literal quietly discards.
function written() {
    const out = {};
    const head = /^ {8}([a-z]{2}): \{/;
    const entry = /^ {12}"((?:\\.|[^"])*)":/;
    let lang = null;
    for (const line of SRC.split('\n')) {
        const h = head.exec(line);
        if (h) { lang = h[1]; out[lang] = out[lang] || []; continue; }
        const e = lang && entry.exec(line);
        if (e) out[lang].push(e[1]);
    }
    return out;
}

// And as the browser actually sees them.
function parsed() {
    const at = SRC.indexOf('var T = {');
    assert.notStrictEqual(at, -1, 'i18n.js no longer has a T');
    let i = SRC.indexOf('{', at);
    let depth = 0;
    const from = i;
    do {
        if (SRC[i] === '{') depth++;
        else if (SRC[i] === '}') depth--;
        i++;
    } while (depth > 0 && i < SRC.length);
    // eslint-disable-next-line no-eval
    return eval('(' + SRC.slice(from, i) + ')');
}

const WRITTEN = written();
const T = parsed();

test('the dictionary has the languages it claims', () => {
    assert.deepStrictEqual(Object.keys(T).sort(), ['de', 'hr']);
    for (const lang of Object.keys(T)) {
        assert.ok(Object.keys(T[lang]).length > 1000,
            lang + ' has only ' + Object.keys(T[lang]).length + ' entries');
    }
});

test('no phrase is translated twice', () => {
    for (const lang of Object.keys(WRITTEN)) {
        const seen = new Set();
        const twice = [];
        for (const key of WRITTEN[lang]) {
            if (seen.has(key)) twice.push(key);
            seen.add(key);
        }
        assert.deepStrictEqual(twice, [],
            lang + ' translates these more than once, and only the last one is ever read: ' +
            twice.map((k) => JSON.stringify(k)).join(', '));
    }
});

test('what is written is what the browser reads', () => {
    for (const lang of Object.keys(WRITTEN)) {
        assert.strictEqual(WRITTEN[lang].length, Object.keys(T[lang]).length,
            lang + ' has ' + WRITTEN[lang].length + ' lines producing ' +
            Object.keys(T[lang]).length + ' entries, so some of them are dead');
    }
});

test('nothing is translated to nothing', () => {
    for (const lang of Object.keys(T)) {
        for (const key of Object.keys(T[lang])) {
            assert.notStrictEqual(String(T[lang][key]).trim(), '',
                lang + ' has an empty translation for ' + JSON.stringify(key));
        }
    }
});

// A placeholder that survives in english and disappears in croatian is a
// sentence that prints "provjera" where a number should be.
test('a phrase keeps its placeholders in every language', () => {
    const holes = (s) => (String(s).match(/\{[a-z]+\}/g) || []).slice().sort();
    for (const lang of Object.keys(T)) {
        for (const key of Object.keys(T[lang])) {
            const want = holes(key);
            if (!want.length) continue;
            assert.deepStrictEqual(holes(T[lang][key]), want,
                lang + ': ' + JSON.stringify(key) + ' loses or invents a placeholder in ' +
                JSON.stringify(T[lang][key]));
        }
    }
});
