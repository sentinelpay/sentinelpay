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

// The page as a PDF, at the paper size its own page rule sets.
async function render(html) {
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
        return Buffer.from(bytes);
    } finally {
        if (page) await page.close().catch(() => {});
        release();
    }
}

// How many pages a PDF made here has: one page object for each, and the one
// object listing them all is /Pages, which this leaves out.
function pages(bytes) {
    return (Buffer.from(bytes).toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;
}

// The PDF's bookmarks, each with the page it points at, in the order they
// come. Read straight from the file: every bookmark names its page by object
// number, and the page tree lists the pages' objects in order.
function outline(bytes) {
    const s = Buffer.from(bytes).toString('latin1');
    const objects = new Map();
    for (const m of s.matchAll(/(?:^|[\r\n])(\d+) 0 obj\s*<<([\s\S]*?)>>\s*endobj/g)) objects.set(m[1], m[2]);
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
            const hex = raw.slice(1, -1).replace(/\s+/g, '');
            const b = Buffer.from(hex, 'hex');
            if (b[0] === 0xfe && b[1] === 0xff) return b.slice(2).swap16().toString('utf16le');
            return b.toString('latin1');
        }
        return raw.slice(1, -1).replace(/\\([()\\])/g, '$1');
    };
    const out = [];
    for (const d of objects.values()) {
        const t = /\/Title\s*(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>)/.exec(d);
        const dest = /\/Dest\s*\[\s*(\d+) 0 R/.exec(d);
        if (!t || !dest) continue;
        out.push({ title: text(t[1]), page: order.indexOf(dest[1]) + 1 });
    }
    return out.sort((a, b) => a.page - b.page);
}

module.exports = { available, render, executable, pages, outline };
