'use strict';

// The report as a PDF, made on the server.
//
// Printing from the browser hands the last step to whoever is at the
// keyboard: which printer, which paper, whether the browser adds its own date
// and address to every corner. The same report then comes out differently on
// every machine, which is the one thing a document handed to an examiner may
// not do. So the PDF is made here, by Chromium rendering the very page the
// dialog previews, and what is downloaded is the same file whoever asks for it.
//
// One browser, started the first time it is needed and closed again once it
// has had nothing to do for a minute, so an idle server is not holding a few
// hundred megabytes for a report nobody is printing. At most two pages render
// at once; the rest wait their turn rather than each starting a browser.

const fs = require('fs');

const IDLE_MS = 60 * 1000;
const AT_ONCE = 2;
const RENDER_MS = 30 * 1000;

// where the browser is: set by the image, or found in the usual places
function executable() {
    const listed = [
        process.env.CHROMIUM_PATH,
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/opt/pw-browsers/chromium',
    ].filter(Boolean);
    for (const p of listed) {
        try { if (fs.statSync(p).isFile()) return p; } catch (err) { /* not here */ }
    }
    return '';
}

function available() {
    return Boolean(executable());
}

let launching = null;
let idleTimer = null;
let busy = 0;
const waiting = [];

function browser() {
    if (launching) return launching;
    // required here rather than at the top, so a server without the
    // dependency still starts and simply says it cannot make PDFs
    const puppeteer = require('puppeteer-core');
    launching = puppeteer.launch({
        executablePath: executable(),
        headless: true,
        args: [
            // the container has no user namespaces for Chromium's sandbox;
            // what it renders is our own page with every request refused
            '--no-sandbox',
            '--disable-setuid-sandbox',
            // /dev/shm in a container is small and Chromium fills it
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-extensions',
            '--no-first-run',
            '--mute-audio',
            '--font-render-hinting=none',
        ],
    }).then((b) => {
        b.on('disconnected', () => { launching = null; });
        return b;
    }, (err) => {
        launching = null;
        throw err;
    });
    return launching;
}

function rest() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        if (busy || !launching) return;
        const was = launching;
        launching = null;
        was.then((b) => b.close()).catch(() => {});
    }, IDLE_MS);
    if (idleTimer.unref) idleTimer.unref();
}

function slot() {
    if (busy < AT_ONCE) { busy++; return Promise.resolve(); }
    return new Promise((resolve) => waiting.push(resolve)).then(() => { busy++; });
}
function release() {
    busy--;
    const next = waiting.shift();
    if (next) next();
    else if (!busy) rest();
}

// The covers, stretched to the page they are printed on.
//
// Chromium lays a page out in whole pixels and writes the PDF's page in
// three-hundredths of an inch, and the two disagree by a fraction of a point:
// A5 is laid out 559px (419.25pt) wide on a page 420pt wide, A3 1587px tall
// on a page 1191.12pt tall. Most pages never show it, but a cover is dark to
// its edges, and the difference was a hairline of white down the right of an
// A5 cover and along the foot of an A3 one. No rule in the page can reach it,
// so the PDF is mended: the first page's drawing and the last's are scaled
// by the difference, 1.0018 on A5, anchored at the top left, so they meet
// every edge.
//
// Written as an incremental update, the standard way to change a PDF without
// rewriting it: two short streams around each page's own, the page pointing
// at all three, and a new cross-reference section after the old one.
function fillCover(bytes, paper) {
    const buf = Buffer.from(bytes);
    if (!paper) return buf;
    const s = buf.toString('latin1');
    const end = /trailer\s*<<([\s\S]*?)>>\s*startxref\s*(\d+)\s*%%EOF\s*$/.exec(s);
    if (!end) return buf;
    const objects = new Map();
    // a dictionary ends at endobj, or at stream where binary data follows
    // that must not be read as the next object
    for (const m of s.matchAll(/(?:^|[\r\n])(\d+) 0 obj\s*<<([\s\S]*?)>>\s*(endobj|stream)/g)) {
        if (m[3] === 'endobj') objects.set(m[1], m[2]);
    }
    const ref = (d, key) => (new RegExp('\\/' + key + '\\s+(\\d+) 0 R').exec(d || '') || [])[1];
    const root = ref(end[1], 'Root');
    // the pages in order, through however many levels of the page tree
    const pages = [];
    const walk = (num, depth) => {
        const d = objects.get(num) || '';
        if (depth > 20) return;
        if (/\/Type\s*\/Pages\b/.test(d)) {
            const kids = (/\/Kids\s*\[([^\]]*)\]/.exec(d) || [])[1] || '';
            for (const k of kids.matchAll(/(\d+) 0 R/g)) walk(k[1], depth + 1);
        } else if (d) pages.push(num);
    };
    walk(ref(objects.get(root), 'Pages'), 0);
    if (!pages.length) return buf;
    const size = Number((/\/Size\s+(\d+)/.exec(end[1]) || [])[1]);
    const info = ref(end[1], 'Info');
    if (!size || !root) return buf;
    // the size the page was laid out at: the paper in whole pixels, in points
    const cw = Math.round(paper.w / 25.4 * 96) * 0.75;
    const ch = Math.round(paper.h / 25.4 * 96) * 0.75;
    const f = (v) => v.toFixed(6);
    const stream = (n, body) => n + ' 0 obj\n<</Length ' + body.length + '>>\nstream\n' + body + '\nendstream\nendobj\n';
    const parts = [];
    let next = size;
    for (const num of [...new Set([pages[0], pages[pages.length - 1]])]) {
        const page = objects.get(num);
        const box = (/\/MediaBox\s*\[([^\]]+)\]/.exec(page) || [])[1];
        const contents = /\/Contents\s*(\d+ 0 R|\[[^\]]*\])/.exec(page);
        if (!box || !contents) continue;
        const [, , mw, mh] = box.trim().split(/\s+/).map(Number);
        const sx = Math.max(1, mw / cw);
        const sy = Math.max(1, mh / ch);
        if (sx === 1 && sy === 1) continue;
        const before = next++;
        const after = next++;
        const inner = contents[1][0] === '[' ? contents[1].slice(1, -1).trim() : contents[1];
        parts.push([before, stream(before, 'q ' + f(sx) + ' 0 0 ' + f(sy) + ' 0 ' + f(mh * (1 - sy)) + ' cm')]);
        parts.push([after, stream(after, 'Q')]);
        parts.push([Number(num), num + ' 0 obj\n<<' + page.replace(contents[0], '/Contents [' + before + ' 0 R ' + inner + ' ' + after + ' 0 R]') + '>>\nendobj\n']);
    }
    if (!parts.length) return buf;
    let at = buf.length + (s.endsWith('\n') ? 0 : 1);
    let add = s.endsWith('\n') ? '' : '\n';
    const offsets = new Map();
    for (const [n, text] of parts) {
        offsets.set(n, at);
        add += text;
        at += Buffer.byteLength(text, 'latin1');
    }
    // one subsection for each object written, in the order of their numbers
    const entry = (n) => String(offsets.get(n)).padStart(10, '0') + ' 00000 n\r\n';
    add += 'xref\n' + [...offsets.keys()].sort((x, y) => x - y).map((n) => n + ' 1\n' + entry(n)).join('') +
        'trailer\n<</Size ' + next + '\n/Root ' + root + ' 0 R' + (info ? '\n/Info ' + info + ' 0 R' : '') +
        '\n/Prev ' + end[2] + '>>\nstartxref\n' + at + '\n%%EOF\n';
    return Buffer.concat([buf, Buffer.from(add, 'latin1')]);
}

// The page as a PDF, at the paper size its own page rule sets, its cover
// stretched to the page when a paper is named.
async function render(html, paper) {
    if (!available()) {
        const err = new Error('no browser to render with');
        err.code = 'NO_BROWSER';
        throw err;
    }
    await slot();
    clearTimeout(idleTimer);
    let page = null;
    try {
        const b = await browser();
        page = await b.newPage();
        // Nothing leaves this page. The report carries its fonts and its art
        // inline, so there is nothing to fetch, and a request that tried would
        // be a mistake in the page rather than something to allow.
        await page.setRequestInterception(true);
        page.on('request', (r) => {
            const url = r.url();
            if (url.startsWith('data:') || url === 'about:blank') r.continue();
            else r.abort();
        });
        page.setDefaultTimeout(RENDER_MS);
        await page.setContent(html, { waitUntil: 'load', timeout: RENDER_MS });
        await page.evaluate(() => document.fonts.ready.then(() => true));
        const bytes = await page.pdf({
            preferCSSPageSize: true,
            printBackground: true,
            displayHeaderFooter: false,
            // the headings become the PDF's bookmarks, the contents a reader
            // opens in the side panel, and its structure tags let a screen
            // reader follow the document
            outline: true,
            tagged: true,
            timeout: RENDER_MS,
        });
        return fillCover(bytes, paper);
    } finally {
        if (page) await page.close().catch(() => {});
        release();
    }
}

module.exports = { available, render, executable, fillCover };
