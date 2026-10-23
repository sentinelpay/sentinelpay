'use strict';

// The dictionary is sent one language at a time (i18n-split.js). What is cut
// out has to be every word the whole file has, and a page has to ask for the
// language its reader is in and no other.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const split = require('../i18n-split');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n.js'), 'utf8');

function wholeT() {
    const at = SRC.indexOf('var T = {');
    let i = SRC.indexOf('{', at);
    const from = i;
    let depth = 0;
    let quote = null;
    for (; i < SRC.length; i++) {
        const c = SRC[i];
        if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'") { quote = c; continue; }
        if (c === '{') depth++;
        else if (c === '}' && --depth === 0) break;
    }
    return vm.runInNewContext('(' + SRC.slice(from, i + 1) + ')');
}

test('each language file holds every word the whole dictionary has', () => {
    const parts = split.cut(SRC);
    assert.ok(parts, 'the dictionary could not be cut');
    const whole = wholeT();
    for (const lang of split.LANGS) {
        const box = { window: {} };
        vm.runInNewContext(parts.dicts[lang], box);
        const got = box.window.__SP_I18N[lang];
        assert.strictEqual(Object.keys(got).length, Object.keys(whole[lang]).length, lang + ' lost words');
        assert.deepStrictEqual(JSON.parse(JSON.stringify(got)), JSON.parse(JSON.stringify(whole[lang])));
    }
    assert.ok(parts.core.length < SRC.length / 20, 'the runtime still carries a dictionary');
    assert.match(parts.core, /var T = window\.__SP_I18N = window\.__SP_I18N \|\| \{\};/);
});

test('a page asks for its reader\'s language and no other', () => {
    const tag = '<script src="/i18n.12.js" defer></script>';
    assert.strictEqual(split.scriptTags(tag, 'en'), '<script src="/i18n-core.12.js" defer></script>');
    assert.strictEqual(split.scriptTags(tag, 'hr'),
        '<script src="/i18n-hr.12.js" defer></script><script src="/i18n-core.12.js" defer></script>');
    assert.strictEqual(split.scriptTags(tag, 'de'),
        '<script src="/i18n-de.12.js" defer></script><script src="/i18n-core.12.js" defer></script>');
    assert.strictEqual(split.file('fr'), null);
    assert.ok(split.file('core') && split.file('hr') && split.file('de'));
});

test('a file that no longer has the expected shape is left whole', () => {
    assert.strictEqual(split.cut('(function () { var X = {}; })();'), null);
});
