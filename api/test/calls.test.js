'use strict';

// Every function a file calls has to exist in it.
//
// This is here because the same mistake has now been made three times, always
// the same way: a block of code is replaced by matching its first and last
// line, a small helper happens to live between those two lines, and it goes
// out with the block. Nothing complains. `node --check` sees valid syntax, the
// tests pass because they never call that path, and the failure arrives in a
// browser as a screen that says it could not load, or in a tool as one line of
// "x is not defined" after it has already printed what it was about to do.
//
// So: for each of our own files, find the names that are called, find the names
// that are declared, and insist the first is a subset of the second plus what a
// browser or node provides. It is a crude parser and deliberately so -- it is
// not trying to understand the language, only to notice that something a file
// talks to is not there.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const API = path.join(__dirname, '..');
const PUBLIC = path.join(API, 'public');

const FILES = [
    ...fs.readdirSync(API).filter((f) => f.endsWith('.js')).map((f) => path.join(API, f)),
    ...fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.js')).map((f) => path.join(PUBLIC, f)),
];

// What the platform hands us without anybody declaring it.
const GIVEN = new Set([
    'require', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
    'decodeURIComponent', 'encodeURI', 'decodeURI', 'fetch', 'alert', 'atob', 'btoa',
    'Number', 'String', 'Boolean', 'Array', 'Object', 'Date', 'Math', 'JSON',
    'RegExp', 'Error', 'TypeError', 'RangeError', 'Promise', 'Map', 'Set',
    'WeakMap', 'WeakSet', 'Symbol', 'Proxy', 'Reflect', 'BigInt', 'Intl',
    'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'AbortController',
    'Buffer', 'process', 'console', 'structuredClone', 'queueMicrotask',
    'Uint8Array', 'Int8Array', 'Uint16Array', 'Uint32Array', 'Float32Array',
    'Float64Array', 'ArrayBuffer', 'DataView', 'Blob', 'FormData', 'Headers',
    'Request', 'Response', 'Image', 'Event', 'CustomEvent', 'EventSource',
    'WebSocket', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
    'getComputedStyle', 'matchMedia', 'requestAnimationFrame',
    'cancelAnimationFrame', 'localStorage', 'sessionStorage', 'crypto',
    'document', 'window', 'navigator', 'location', 'history', 'screen',
    'performance', 'DOMParser', 'XMLHttpRequest', 'IntlSegmenter',
    // control flow, which looks like a call to a regex and is not one
    'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function',
    'do', 'else', 'try', 'finally', 'new', 'delete', 'void', 'in', 'of',
    'await', 'yield', 'case', 'throw', 'with', 'super', 'this', 'async',
]);

// A name is declared if the file names it anywhere a name can be introduced:
// a function, a binding, a parameter, a catch, an import.
function declaredIn(src) {
    const names = new Set();
    const add = (m) => { if (m) names.add(m); };

    for (const m of src.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
    for (const m of src.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
    for (const m of src.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
    // destructured bindings: const { a, b: c } = ...
    for (const m of src.matchAll(/\b(?:var|let|const)\s*\{([^}]*)\}/g)) {
        for (const piece of m[1].split(',')) {
            add((piece.split(':').pop() || '').trim().replace(/=.*$/, '').trim());
        }
    }
    // parameters, including arrow functions with a single bare parameter
    for (const m of src.matchAll(/\bfunction\s*\*?\s*[A-Za-z_$\w$]*\s*\(([^)]*)\)/g)) {
        for (const piece of m[1].split(',')) add(piece.trim().replace(/[={].*$/, '').trim());
    }
    for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g)) {
        for (const piece of m[1].split(',')) add(piece.trim().replace(/[={].*$/, '').trim());
    }
    for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) add(m[1]);
    for (const m of src.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
    // methods, written shorthand in a class or an object literal. they are
    // called through a receiver, but a file that defines one and calls it on
    // itself should not be reported for it.
    for (const m of src.matchAll(/(?:^|[,{;]|\*\/)\s*(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*\{/gm)) {
        add(m[1]);
        // and whatever that method calls its arguments
        for (const piece of m[2].split(',')) add(piece.trim().replace(/[={].*$/, '').trim());
    }
    return names;
}

// A call is a name followed by a bracket, where the name is not a property of
// something else and not the declaration of a function.
function calledIn(src) {
    const out = new Set();
    for (const m of src.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
        const before = src.slice(Math.max(0, m.index - 12), m.index + m[1].length);
        if (/\bfunction\s*$/.test(before)) continue;
        out.add(m[2]);
    }
    return out;
}

// Strings, comments and patterns are not code, and a word inside one of them
// is not a call. The pattern case matters more than it looks: /<script(...)/ in
// a regular expression reads exactly like a call to something named script.
function strip(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
        .replace(/([(=,:[!&|?{;]\s*|\breturn\s+)\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[gimsuy]*/g, '$1/re/')
        .replace(/`(?:\\.|[^`\\])*`/g, '``')
        .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
        .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

test('every function a file calls is a function that file has', () => {
    const wrong = [];
    for (const file of FILES) {
        const raw = fs.readFileSync(file, 'utf8');
        const src = strip(raw);
        const have = declaredIn(src);
        for (const name of calledIn(src)) {
            if (GIVEN.has(name) || have.has(name)) continue;
            wrong.push(path.basename(file) + ' calls ' + name + '(), which it does not have');
        }
    }
    assert.deepStrictEqual(wrong, [], wrong.join('\n'));
});
