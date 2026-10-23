'use strict';

// The dictionary, one language at a time.
//
// public/i18n.js holds the Croatian and the German for every page and every
// screen of the dashboard: 690 kilobytes, about 150 over the wire, read and
// parsed on every page by everybody. Somebody reading in English needs none
// of it and somebody reading in Croatian needs half. The file stays one file,
// because that is where translations are written and what the tools and tests
// read; the server cuts it into the part that does the translating and one
// file per language, and each page is sent with the part and the one language
// its reader is in.
//
//   /i18n-core.<n>.js   the runtime, with an empty dictionary to fill
//   /i18n-hr.<n>.js     window.__SP_I18N.hr
//   /i18n-de.<n>.js     window.__SP_I18N.de
//
// If the file ever stops having the shape this expects, nothing is cut and
// pages keep loading the whole file as before.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = path.join(__dirname, 'public', 'i18n.js');
const LANGS = ['hr', 'de'];

let cache = null;

function cut(src) {
    const open = src.indexOf('\n    var T = {\n');
    const at = {};
    let from = open;
    for (const lang of LANGS) {
        at[lang] = src.indexOf('\n        ' + lang + ': {\n', from);
        if (at[lang] === -1) return null;
        from = at[lang] + 1;
    }
    const close = src.indexOf('\n    };\n', from);
    if (open === -1 || close === -1) return null;
    const parts = { dicts: {} };
    LANGS.forEach((lang, i) => {
        const start = at[lang] + ('\n        ' + lang + ': ').length;
        const end = i + 1 < LANGS.length ? at[LANGS[i + 1]] : close;
        const body = src.slice(start, end).trim().replace(/,$/, '');
        parts.dicts[lang] = '(window.__SP_I18N = window.__SP_I18N || {}).' + lang + ' = ' + body + ';\n';
    });
    // the same object the language files fill, whichever runs first
    parts.core = src.slice(0, open) + '\n    var T = window.__SP_I18N = window.__SP_I18N || {};' +
        src.slice(close + '\n    };'.length);
    // compiled, not run: a cut in the wrong place fails here rather than in
    // somebody's browser
    try {
        new vm.Script(parts.core);
        LANGS.forEach((lang) => { new vm.Script(parts.dicts[lang]); });
    } catch (err) {
        console.error('[i18n] could not cut the dictionary, pages load it whole: ' + err.message);
        return null;
    }
    return parts;
}

function parts() {
    let stamp = 0;
    try { stamp = fs.statSync(FILE).mtimeMs; } catch (err) { return null; }
    if (cache && cache.stamp === stamp) return cache.parts;
    let src = '';
    try { src = fs.readFileSync(FILE, 'utf8'); } catch (err) { return null; }
    cache = { stamp, parts: cut(src) };
    return cache.parts;
}

// what a page's script tag becomes for a reader in this language
function scriptTags(html, lang) {
    if (!parts()) return html;
    return html.replace(/<script src="\/i18n\.(\d+)\.js" defer><\/script>/, (whole, n) =>
        (LANGS.indexOf(lang) !== -1 ? '<script src="/i18n-' + lang + '.' + n + '.js" defer></script>' : '') +
        '<script src="/i18n-core.' + n + '.js" defer></script>');
}

// the body for /i18n-core.<n>.js and /i18n-<lang>.<n>.js, or null
function file(name) {
    const p = parts();
    if (!p) return null;
    if (name === 'core') return p.core;
    return Object.prototype.hasOwnProperty.call(p.dicts, name) ? p.dicts[name] : null;
}

module.exports = { scriptTags, file, cut, LANGS };
