'use strict';

// What is served of our scripts and sheets is the file without its comments
// (slim.js). Every one of them has to come through it, smaller and, for a
// script, the same program token for token, which slimJs checks itself and
// throws on.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const slim = require('../slim');

const PUB = path.join(__dirname, '..', 'public');

test('every script and sheet of ours is served slimmed, and smaller', () => {
    const files = fs.readdirSync(PUB).filter((f) => /\.(js|css)$/.test(f));
    assert.ok(files.length > 10);
    for (const f of files) {
        const body = slim.slimmed(f);
        assert.ok(body !== null, f + ' could not be slimmed and would be sent whole');
        assert.ok(body.length <= fs.statSync(path.join(PUB, f)).size, f + ' grew');
    }
});

test('strings, templates and regular expressions come through untouched', () => {
    const src = [
        'var a = "  two  spaces // not a comment ";',
        "var b = '/* not a comment either */';",
        'var c = `line one',
        '   indented   line two ${a /* inside */ + b}`;',
        'var d = /\\/\\/ [a-z]+ \\/*/g; // a regular expression',
        '/* gone */ var e = 1',
        'var f = 2 // a line break that ends a statement stays one',
        'return a',
    ].join('\n');
    const out = slim.slimJs(src);
    assert.ok(out.includes('"  two  spaces // not a comment "'));
    assert.ok(out.includes("'/* not a comment either */'"));
    assert.ok(out.includes('`line one\n   indented   line two ${a + b}`'));
    assert.ok(out.includes('/\\/\\/ [a-z]+ \\/*/g'));
    assert.ok(!out.includes('gone') && !out.includes('stays one'));
    assert.match(out, /var e = 1\nvar f = 2\nreturn a/);
});

test('a sheet keeps its strings and loses its comments', () => {
    const out = slim.slimCss('a::before { content: "/* kept */  x"; }\n/* gone */\nb  >  c { color: red; }\n');
    assert.ok(out.includes('content: "/* kept */  x"'));
    assert.ok(!out.includes('gone'));
    assert.ok(out.includes('b > c { color: red; }'));
});
