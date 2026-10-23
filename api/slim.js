'use strict';

// What a browser is sent of our own scripts and style sheets: the file without
// its comments and indentation.
//
// The source is written to be read, and a third of the dashboard script and
// half of its style sheet are the reasons behind the code. Compression takes
// some of that off the wire and none of it off the parse. The files on disk
// stay as they are, since they are what people read and the tests match
// against; this is what is served.
//
// A script is parsed, and what is between its tokens is replaced by nothing,
// a space or a line break, whichever the original had, so a line break that
// ends a statement still ends it. Strings, templates and regular expressions
// are tokens and are never touched. The result is parsed again and has to
// give the same tokens in the same order, or the original is sent instead.

const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const ROOT = path.join(__dirname, 'public');
const cache = new Map();

function tokensOf(src) {
    const tokens = [];
    acorn.parse(src, {
        ecmaVersion: 'latest',
        sourceType: 'script',
        allowHashBang: true,
        allowReturnOutsideFunction: true,
        onToken: tokens,
    });
    return tokens;
}

function slimJs(src) {
    const tokens = tokensOf(src);
    let out = '';
    let at = 0;
    for (const tok of tokens) {
        if (tok.type === acorn.tokTypes.eof) break;
        const gap = src.slice(at, tok.start);
        if (gap) out += /[\n\r\u2028\u2029]/.test(gap) ? '\n' : ' ';
        out += src.slice(tok.start, tok.end);
        at = tok.end;
    }
    out += '\n';
    // the same program, token for token, or nothing
    const again = tokensOf(out);
    if (again.length !== tokens.length) throw new Error('token count changed');
    for (let i = 0; i < tokens.length; i++) {
        const a = tokens[i];
        const b = again[i];
        if (a.type !== b.type || src.slice(a.start, a.end) !== out.slice(b.start, b.end)) {
            throw new Error('token ' + i + ' changed');
        }
    }
    return out;
}

// Comments out, and every run of white space down to one character, outside
// strings. A run that held a line break keeps one, so the sheet stays legible
// in a browser's inspector.
function slimCss(src) {
    const out = [];
    let last = '';
    let pending = '';
    const push = (text) => {
        if (pending && last) out.push(pending);
        pending = '';
        out.push(text);
        last = text[text.length - 1];
    };
    let i = 0;
    const n = src.length;
    const space = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
    while (i < n) {
        const c = src[i];
        if (c === '"' || c === "'") {
            let j = i + 1;
            while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
            push(src.slice(i, j + 1));
            i = j + 1;
            continue;
        }
        if (c === '/' && src[i + 1] === '*') {
            const end = src.indexOf('*/', i + 2);
            i = end === -1 ? n : end + 2;
            if (!pending) pending = ' ';
            continue;
        }
        if (space(c)) {
            let j = i;
            let nl = false;
            while (j < n && space(src[j])) { if (src[j] === '\n') nl = true; j++; }
            pending = nl || pending === '\n' ? '\n' : ' ';
            i = j;
            continue;
        }
        let j = i + 1;
        while (j < n && !space(src[j]) && src[j] !== '"' && src[j] !== "'" && !(src[j] === '/' && src[j + 1] === '*')) j++;
        push(src.slice(i, j));
        i = j;
    }
    return out.join('').trim() + '\n';
}

// The slimmed text of public/<rel>, or null to send the file as it is.
function slimmed(rel) {
    if (!/^[a-z0-9-]+\.(js|css)$/i.test(rel) || /\.min\./i.test(rel)) return null;
    const full = path.join(ROOT, rel);
    let stamp = 0;
    try { stamp = fs.statSync(full).mtimeMs; } catch (err) { return null; }
    const hit = cache.get(rel);
    if (hit && hit.stamp === stamp) return hit.body;
    let body = null;
    try {
        const src = fs.readFileSync(full, 'utf8');
        body = rel.endsWith('.css') ? slimCss(src) : slimJs(src);
    } catch (err) {
        console.error('[slim] ' + rel + ' sent as it is: ' + err.message);
        body = null;
    }
    cache.set(rel, { stamp, body });
    return body;
}

// done once at start, so the first visitor after a deploy does not wait for it
function warm() {
    let files = [];
    try { files = fs.readdirSync(ROOT).filter((f) => /\.(js|css)$/i.test(f)); } catch (err) { return; }
    // one at a time, so a request arriving meanwhile waits for one file at most
    const next = () => {
        const f = files.shift();
        if (!f) return;
        slimmed(f);
        setTimeout(next, 0);
    };
    next();
}

module.exports = { slimmed, slimJs, slimCss, warm };
