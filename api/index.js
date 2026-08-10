const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const hpp = require('hpp');
require('dotenv').config();
const mailer = require('./mailer');
const submissions = require('./submissions-log');
const db = require('./db');
const accounts = require('./accounts');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

function resolveTrustProxySetting(value) {
    if (value === undefined || value === null || value === '') return undefined;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    if (/^\d+$/.test(normalized)) return Number(normalized);
    return value;
}

const trustProxySetting = resolveTrustProxySetting(process.env.TRUST_PROXY);
app.set('trust proxy', trustProxySetting === undefined ? 1 : trustProxySetting);

// Only trust the client-supplied cf-connecting-ip header when we know every request
// arrives through Cloudflare (ENFORCE_CLOUDFLARE=true). Otherwise it is spoofable.
// An attacker could rotate it per request to get a fresh rate-limit bucket and bypass
// the demo-form limit. Default: Express's trust-proxy-derived req.ip (not spoofable
// past the immediate proxy).
const enforceCloudflare = String(process.env.ENFORCE_CLOUDFLARE || '').trim().toLowerCase() === 'true';

// --- Origin lockdown ---------------------------------------------------------
// When CF_ORIGIN_SECRET is set, require a matching secret header (injected by a
// Cloudflare Transform Rule) so the sensitive endpoint can't be reached by hitting
// the Railway origin directly and bypassing Cloudflare's WAF/rate-limit/bot rules.
// Not set → skipped, so the site keeps working until the CF rule is configured.
const cfOriginSecret = process.env.CF_ORIGIN_SECRET;
const cfOriginHeader = (process.env.CF_ORIGIN_HEADER || 'x-sentinel-origin').trim().toLowerCase();
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();
function fromOurCloudflare(req) {
    if (!cfOriginSecret) return false;
    const provided = req.headers[cfOriginHeader];
    return Boolean(provided) && crypto.timingSafeEqual(sha256(String(provided)), sha256(cfOriginSecret));
}
function requireCloudflareOrigin(req, res, next) {
    if (!cfOriginSecret) return next();
    if (fromOurCloudflare(req)) return next();
    return res.status(403).json({ error: 'forbidden' });
}

// Site-wide origin lockdown. The per-endpoint guard above protects the two form
// endpoints; this closes the rest, so hitting the railway url directly gets nothing
// at all and every request has to come through cloudflare's waf and rate limits.
// Deliberately opt-in and separate from CF_ORIGIN_SECRET: turning it on before the
// cloudflare transform rule exists would 403 the whole site, so it is a second,
// explicit switch you flip once you have verified the header arrives.
const cfOriginStrict = String(process.env.CF_ORIGIN_STRICT || '').trim().toLowerCase() === 'true';
app.use((req, res, next) => {
    if (!cfOriginStrict || !cfOriginSecret) return next();
    if (fromOurCloudflare(req)) return next();
    // no hint about why: a direct hit on the origin should look like nothing is here
    return res.status(403).type('text/plain').send('forbidden');
});

// --- Client ip ---------------------------------------------------------------
// Every rate limit is keyed on this, so getting it wrong means the limits do not
// exist. `req.ip` is derived from x-forwarded-for, which anything reaching the
// origin directly can set to whatever it likes: rotating the header gives a fresh
// bucket per request. So cf-connecting-ip is trusted only when the request proves
// it came through our own Cloudflare, and ENFORCE_CLOUDFLARE stays as the manual
// override for setups without the origin secret.
app.use((req, res, next) => {
    const cfIp = req.headers['cf-connecting-ip'];
    const trusted = fromOurCloudflare(req) || enforceCloudflare;
    req.realIp = (trusted && typeof cfIp === 'string' && cfIp.length > 0) ? cfIp : req.ip;
    next();
});

// --- Cloudflare Turnstile ----------------------------------------------------
// When TURNSTILE_SECRET_KEY is set, the demo form must include a valid Turnstile
// token. Not set → skipped (staged rollout; the form still works before keys exist).
const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
async function verifyTurnstile(token, ip) {
    if (!turnstileSecret) return true;
    if (!token || typeof token !== 'string') return false;
    try {
        const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ secret: turnstileSecret, response: token, remoteip: ip || '' })
        });
        const data = await resp.json();
        if (data && data.success === true) return true;
        // cloudflare says why, and the difference matters: timeout-or-duplicate is
        // a token that sat on an open page too long, invalid-input-secret is a
        // misconfigured deploy. without this line both look like "the form is
        // broken" and there is nothing to tell them apart by.
        console.error('[turnstile refused]', (data && data['error-codes'] || ['no reason given']).join(', '));
        return false;
    } catch (err) {
        console.error('[turnstile verify error]', err.message);
        return false;
    }
}

// --- CSP script hashes ------------------------------------------------------
// Our pages are static files, so there is no request to hang a nonce off. Instead
// we hash every inline <script> we actually ship and list those hashes, which lets
// us drop 'unsafe-inline' without templating 9 pages. Hashes are derived from the
// files on disk at boot, so editing a page just works after the next restart.
// If a third party ever needs inline script we cannot hash, set CSP_STRICT=false
// to fall back to 'unsafe-inline' without a code change.
const fsSync = require('fs');
const cspStrict = String(process.env.CSP_STRICT || 'true').trim().toLowerCase() !== 'false';
function inlineScriptHashes(dir) {
    const hashes = new Set();
    const walk = (d) => {
        for (const entry of fsSync.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!entry.name.endsWith('.html')) continue;
            const html = fsSync.readFileSync(full, 'utf8');
            const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;
            let m;
            while ((m = re.exec(html)) !== null) {
                hashes.add("'sha256-" + crypto.createHash('sha256').update(m[1], 'utf8').digest('base64') + "'");
            }
        }
    };
    try { walk(dir); } catch (err) { console.error('[csp hash scan failed]', err.message); }
    return [...hashes];
}
const scriptHashes = cspStrict ? inlineScriptHashes(path.join(__dirname, 'public')) : [];
console.log(`[csp] ${cspStrict ? `strict, ${scriptHashes.length} inline script hashes` : "relaxed ('unsafe-inline')"}`);

app.use(hpp());
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            'default-src': ["'self'"],
            'script-src': [
                "'self'",
                ...(cspStrict ? scriptHashes : ["'unsafe-inline'"]),
                'https://challenges.cloudflare.com',
                'https://widget.intercom.io',
                'https://js.intercomcdn.com',
                'https://*.intercomcdn.com',
                'https://*.intercom.io',
                'blob:'
            ],
            'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://fonts.intercomcdn.com'],
            'font-src': ["'self'", 'https://fonts.gstatic.com', 'https://fonts.intercomcdn.com'],
            'img-src': [
                "'self'",
                'data:',
                'https://*.intercomcdn.com',
                'https://*.intercom.io',
                'https://*.intercomassets.com'
            ],
            'connect-src': [
                "'self'",
                'https://challenges.cloudflare.com',
                'https://api-iam.intercom.io',
                'https://*.intercom.io',
                'https://uploads.intercomcdn.com',
                'https://uploads.intercomusercontent.com',
                'https://*.intercomcdn.com',
                'wss://nexus-websocket-a.intercom.io',
                'wss://nexus-websocket-b.intercom.io',
                'wss://*.intercom.io',
                'wss://*.intercom-messenger.com'
            ],
            'frame-src': ["'self'", 'https://challenges.cloudflare.com', 'https://intercom-sheets.com', 'https://*.intercom.io', 'blob:'],
            'base-uri': ["'self'"],
            'form-action': ["'self'"],
            'frame-ancestors': ["'none'"],
            'object-src': ["'none'"],
            'upgrade-insecure-requests': [],
            'worker-src': ["'self'", 'blob:']
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: false,
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true }
}));

app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'xr-spatial-tracking=(), camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=(), bluetooth=(), serial=(), hid=(), ambient-light-sensor=(), accelerometer=(), gyroscope=(), magnetometer=(), display-capture=()');
    next();
});

app.use(cors({
    origin: (origin, callback) => {
        if (allowedOrigins.includes('*')) {
            if (isProduction) return callback(new Error('Wildcard CORS disallowed in production.'));
            return callback(null, true);
        }
        if (!origin) return callback(null, true);
        if (allowedOrigins.length === 0) {
            return callback(isProduction ? new Error('ALLOWED_ORIGINS must be configured in production.') : null, !isProduction);
        }
        if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
        callback(new Error('Not allowed by CORS'));
    },
    methods: ['POST', 'GET']
}));

app.use(express.json({ limit: '10kb' }));

// ---------------------------------------------------------------------------
// Per-request page rendering.
//
// Two things can only be decided on the server, per visitor:
//   1. their country, so a first visit lands in their language before any js runs
//   2. their browser, so the "how do I switch javascript on" link is actually useful
//
// Both are injected as plain html: an attribute on <html> and an ordinary <a>.
// Never as an inline <script>. The CSP hashes are computed at boot from the
// files on disk, so anything injected per request would be blocked outright.
// The javascript-disabled notice has to be plain markup for the same reason:
// it is the one screen that must work with scripting off.
const pageCache = new Map();

function geoLang(req) {
    // Cloudflare resolves the ip to a country for us; without it (local dev,
    // direct origin hit) everyone gets english.
    const cc = String(req.headers['cf-ipcountry'] || '').trim().toUpperCase();
    if (cc === 'HR') return 'hr';
    if (cc === 'DE') return 'de';
    return 'en';
}

function browserName(ua) {
    ua = String(ua || '');
    // order matters: edge and opera both also claim to be chrome
    if (/\bEdgA?\//.test(ua)) return 'microsoft edge';
    if (/\bOPR\/|\bOpera\//.test(ua)) return 'opera';
    if (/SamsungBrowser\//.test(ua)) return 'samsung internet';
    if (/\bFxiOS\/|\bFirefox\//.test(ua)) return 'firefox';
    if (/\bCriOS\//.test(ua)) return 'chrome';
    if (/\bChrome\/|HeadlessChrome\//.test(ua)) return 'chrome';
    if (/\bChromium\//.test(ua)) return 'chromium';
    if (/\bVersion\/[\d.]+.*\bSafari\//.test(ua)) return 'safari';
    return '';
}

const NOSCRIPT_COPY = {
    en: {
        title: 'javascript is switched off',
        body: 'sentinelpay needs javascript to run. switch it on, then reload this page.',
        link: 'not sure how? here are instructions for your browser',
    },
    hr: {
        title: 'javascript je isključen',
        body: 'sentinelpayu treba javascript. uključite ga pa osvježite stranicu.',
        link: 'ne znate kako? evo uputa za vaš preglednik',
    },
    de: {
        title: 'javascript ist deaktiviert',
        body: 'sentinelpay braucht javascript. schalten sie es ein und laden sie die seite neu.',
        link: 'unsicher wie? hier ist eine anleitung für ihren browser',
    },
};

function escapeHtml(s) {
    return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

const HELP_QUERY = {
    hr: (b) => 'kako uključiti javascript' + (b ? ' u ' + b : ''),
    de: (b) => 'javascript aktivieren' + (b ? ' in ' + b : ''),
    en: (b) => 'how to enable javascript' + (b ? ' on ' + b : ''),
};

function helpSearchUrl(lang, browser) {
    // the search is in the same language the notice is in, and google is asked to
    // return results in it too. browser name is appended only when we recognised
    // one, so we never send someone searching for a browser they do not use.
    const build = HELP_QUERY[lang] || HELP_QUERY.en;
    return 'https://www.google.com/search?q=' + encodeURIComponent(build(browser)) +
        '&hl=' + (HELP_QUERY[lang] ? lang : 'en');
}

// The homepage is reachable at /, /en, /hr and /de. Search engines need to be told
// those are the same page in different languages, and each one needs to point at
// itself as canonical, so the tags are built per request rather than sitting in the
// file. Only the homepage has them: no other page has language urls.
const SITE_URL = process.env.SITE_URL || 'https://sentinelpay.org';
const HOMEPAGE_LANGS = ['en', 'hr', 'de'];
function homepageLinkTags(forced) {
    const self = forced ? SITE_URL + '/' + forced : SITE_URL;
    const alts = HOMEPAGE_LANGS
        .map((l) => '<link rel="alternate" hreflang="' + l + '" href="' + SITE_URL + '/' + l + '">')
        .join('');
    // x-default is the language-neutral entry point, which is the bare domain: it
    // still picks a language from the visitor's country.
    return '<link rel="canonical" href="' + self + '">' + alts +
        '<link rel="alternate" hreflang="x-default" href="' + SITE_URL + '">';
}

// --- Status banner -----------------------------------------------------------
// A running incident is announced on every page, the way a status page does it.
// It is env-driven so it can be switched on and off without a deploy, and it is
// plain markup like the noscript notice: the csp hashes are computed at boot, so
// nothing injected per request may be a script.
//
//   STATUS_MESSAGE      a preset key (below) or free text. empty or unset hides it
//   STATUS_LINK         optional url the banner links to
//   STATUS_LINK_TEXT    optional button label. a preset supplies its own
//   STATUS_BLOCKS_MAIL  "true" while the outage stops us receiving submissions
//
// Translation: machine translating whatever someone types would produce exactly
// the stiff wording we spent this project avoiding. So the common incidents ship
// as presets, written properly in all three languages, and anything custom can be
// given per-language text with STATUS_MESSAGE_HR / STATUS_MESSAGE_DE. All three
// variants ride on the element as attributes and the client picks one, which keeps
// the banner correct even when the visitor's language differs from what the
// server guessed.
const STATUS_DISMISS = {
    en: 'dismiss this message',
    hr: 'zatvori ovu poruku',
    de: 'diese meldung schliessen',
};

const STATUS_PRESETS = {
    'email-outage': {
        message: {
            en: 'we are having trouble receiving email. sign-ups and demo requests are paused while we fix it.',
            hr: 'imamo problem s primanjem mailova. prijave i zahtjevi za demo pauzirani su dok to ne riješimo.',
            de: 'wir haben probleme beim empfang von e-mails. anmeldungen und demo-anfragen pausieren, bis das behoben ist.',
        },
        button: { en: 'what is happening', hr: 'što se događa', de: 'was ist los' },
    },
    'degraded': {
        message: {
            en: 'some parts of sentinelpay are slower than usual. we are on it.',
            hr: 'dijelovi sentinelpaya trenutno rade sporije nego inače. radimo na tome.',
            de: 'teile von sentinelpay sind gerade langsamer als sonst. wir kümmern uns darum.',
        },
        button: { en: 'what is happening', hr: 'što se događa', de: 'was ist los' },
    },
    'maintenance': {
        message: {
            en: 'we are doing planned maintenance. some things may not work for a short while.',
            hr: 'radimo planirano održavanje. neke stvari možda nakratko neće raditi.',
            de: 'wir führen geplante wartungsarbeiten durch. einiges funktioniert kurzzeitig eventuell nicht.',
        },
        button: { en: 'what is happening', hr: 'što se događa', de: 'was ist los' },
    },
};

const STATUS_MESSAGE = String(process.env.STATUS_MESSAGE || '').trim();
const STATUS_LINK = String(process.env.STATUS_LINK || '').trim();
const STATUS_LINK_TEXT = String(process.env.STATUS_LINK_TEXT || '').trim();
const STATUS_BLOCKS_MAIL = String(process.env.STATUS_BLOCKS_MAIL || '').trim().toLowerCase() === 'true';

// Resolves the message and the button label into one text per language.
function statusCopy() {
    if (!STATUS_MESSAGE) return null;
    const preset = STATUS_PRESETS[STATUS_MESSAGE.toLowerCase()];
    const env = (name) => String(process.env[name] || '').trim();

    const message = {
        en: preset ? preset.message.en : STATUS_MESSAGE,
        hr: env('STATUS_MESSAGE_HR') || (preset ? preset.message.hr : ''),
        de: env('STATUS_MESSAGE_DE') || (preset ? preset.message.de : ''),
    };
    const button = {
        en: STATUS_LINK_TEXT || (preset ? preset.button.en : ''),
        hr: env('STATUS_LINK_TEXT_HR') || (STATUS_LINK_TEXT ? '' : (preset ? preset.button.hr : '')),
        de: env('STATUS_LINK_TEXT_DE') || (STATUS_LINK_TEXT ? '' : (preset ? preset.button.de : '')),
    };
    return { message, button };
}
const STATUS_COPY = statusCopy();

function langAttrs(prefix, texts) {
    // only the languages we actually have text for; the client falls back to en
    return ['hr', 'de'].map((l) => (texts[l] ? ' ' + prefix + '-' + l + '="' + escapeHtml(texts[l]) + '"' : '')).join('');
}

function statusBanner() {
    if (!STATUS_COPY) return '';
    // a warning triangle rather than a dot: this is a fault, not an announcement,
    // and the shape reads as one before a word is parsed
    const icon =
        '<svg class="sp-status-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>' +
        '<path d="M12 9v4"></path><path d="M12 17h.01"></path>' +
        '</svg>';

    let inner = icon +
        '<span class="sp-status-text"' + langAttrs('data-sp', STATUS_COPY.message) + '>' +
        escapeHtml(STATUS_COPY.message.en) + '</span>';

    if (STATUS_LINK && STATUS_COPY.button.en) {
        inner += '<a class="sp-status-btn" href="' + escapeHtml(STATUS_LINK) + '">' +
            '<span' + langAttrs('data-sp', STATUS_COPY.button) + '>' + escapeHtml(STATUS_COPY.button.en) + '</span></a>';
    }
    // dismiss control. desktop only, hidden by css below 860px, because on a phone
    // the bar is already two lines and a target that small next to the edge is a
    // mis-tap waiting to happen.
    const dismiss =
        '<button type="button" class="sp-status-x"' +
        langAttrs('data-sp-label', STATUS_DISMISS) +
        ' aria-label="' + escapeHtml(STATUS_DISMISS.en) + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
        'stroke-linecap="round" aria-hidden="true">' +
        '<path d="M6 6l12 12M18 6L6 18"></path></svg></button>';

    // armed in the markup, not from javascript: the class has to be on the
    // element before first paint or the banner flashes in at full opacity
    return '<div class="sp-status sp-status-armed" role="status" data-i18n-skip>' +
        '<div class="sp-status-inner">' + inner + '</div>' + dismiss + '</div>';
}

function renderPage(file, req, forcedLang) {
    // keyed on mtime, so an edited page is picked up without a restart. in
    // production files only change on deploy, which restarts anyway.
    const full = path.join(__dirname, 'public', file);
    const stamp = fsSync.statSync(full).mtimeMs;
    let entry = pageCache.get(file);
    if (!entry || entry.stamp !== stamp) {
        entry = { stamp, html: fsSync.readFileSync(full, 'utf8') };
        pageCache.set(file, entry);
    }
    const html = entry.html;
    const lang = forcedLang || geoLang(req);
    const copy = NOSCRIPT_COPY[lang] || NOSCRIPT_COPY.en;
    const url = helpSearchUrl(lang, browserName(req.headers['user-agent']));
    const notice =
        '<div class="sp-ns">' +
        '<p class="sp-ns-title">' + escapeHtml(copy.title) + '</p>' +
        '<p class="sp-ns-text">' + escapeHtml(copy.body) + '</p>' +
        '<a class="sp-ns-link" href="' + escapeHtml(url) + '" rel="noopener nofollow" target="_blank">' + escapeHtml(copy.link) + '</a>' +
        '</div>';
    // a forced language is an instruction, not a guess: the client treats it as
    // stronger than a stored preference, so it is carried on its own attribute.
    const attrs = ' data-geo-lang="' + lang + '"' +
        (forcedLang ? ' data-force-lang="' + forcedLang + '"' : '') +
        (STATUS_MESSAGE ? ' data-status' : '') +
        (STATUS_BLOCKS_MAIL ? ' data-mail-down' : '');
    return html
        .replace('<!--SP_NOSCRIPT-->', notice)
        .replace('<!--SP_HREFLANG-->', () => homepageLinkTags(forcedLang))
        .replace(/<html lang="en">/, '<html lang="en"' + attrs + '>')
        .replace('<body class="lp-body">', () => '<body class="lp-body">' + statusBanner());
}

function sendPage(res, req, file, status, forcedLang) {
    res.status(status || 200)
        .set('Cache-Control', 'no-cache')
        .set('Vary', 'CF-IPCountry, User-Agent')
        .type('html')
        .send(renderPage(file, req, forcedLang));
}

// Coarse per-IP ceiling on everything, pages and assets included, so a single
// client cannot hammer the origin. It has to sit ahead of the page renderer and
// express.static: mounted after them it never ran for anything but /v1/*.
// cannot hammer the origin. Deliberately generous: normal browsing loads dozens of
// assets per page. Cloudflare's own rate limiting is the real edge defence; this is
// in-process depth behind it, and it resets on deploy (single-instance store).
app.use(rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `all:${req.realIp}`,
    message: { error: 'too many requests, please slow down' }
}));

// Subdomain routing, served by this same service via Host header (no extra service):
//  - blog.sentinelpay.org -> the blog page (public/blog.html)
//  - help.sentinelpay.org -> a blank page until real content exists
const BLANK_PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>sentinelpay</title><style>html,body{margin:0;height:100%;background:#06070f}</style></head><body></body></html>';
app.use((req, res, next) => {
    const host = String(req.headers.host || '').split(':')[0].toLowerCase();
    if (host === 'blog.sentinelpay.org') {
        // serve blog pages for navigation requests; let assets (.css/.svg/.png)
        // fall through to express.static so the shared homepage styles load.
        if (req.method === 'GET' && !path.extname(req.path)) {
            res.set('X-Robots-Tag', 'noindex, nofollow');
            let page = 'blog.html';
            if (req.path.startsWith('/article/')) {
                const slug = req.path.replace(/^\/article\//, '').replace(/\/+$/, '');
                // null-prototype map: a slug like "constructor" or "__proto__" must not
                // resolve to an inherited Object member (that used to throw a 500).
                const articles = Object.assign(Object.create(null), {
                    '01': 'blog-article.html',
                    '02': 'blog-article-2.html',
                    '03': 'blog-article-3.html',
                    '04': 'blog-article-4.html',
                    '05': 'blog-article-5.html',
                    // legacy slug aliases (keep old links working)
                    'why-criminals-target-small-businesses': 'blog-article.html',
                    'real-time-aml-why-timing-matters': 'blog-article-2.html',
                    'compliance-without-becoming-a-bank': 'blog-article-3.html',
                    'we-dont-do-gambling': 'blog-article-4.html',
                    'wallet-screening-vs-kyc': 'blog-article-5.html',
                });
                page = typeof articles[slug] === 'string' ? articles[slug] : 'blog-article.html';
            }
            return sendPage(res, req, page);
        }
        return next();
    }
    if (host === 'help.sentinelpay.org') {
        res.set('X-Robots-Tag', 'noindex, nofollow');
        return res.status(200).type('html').send(BLANK_PAGE);
    }
    next();
});

// Language urls, homepage only. /hr, /de and /en serve the same homepage with the
// language pinned, which gives each language a real address to link and to index.
// The rest of the site has no language urls: it follows the cookie these routes set.
// The bare domain picks a language and then says so in the address bar. Landing on
// "/" and staying there hides which language you are reading, and gives the three
// translations nothing to be linked or shared as. So "/" resolves the language the
// same way the client would, and redirects to it.
//
// 302, never 301: the target depends on the visitor's cookie and country, and a
// permanent redirect would be cached by their browser and pin them to whichever
// language they happened to get first. no-store and Vary keep any shared cache out
// of it for the same reason.
app.get('/', (req, res, next) => {
    const host = String(req.headers.host || '').split(':')[0].toLowerCase();
    if (host.startsWith('blog.') || host.startsWith('help.')) return next();

    const cookie = String(req.headers.cookie || '').match(/(?:^|;\s*)sp-lang=([^;]*)/);
    const saved = cookie ? decodeURIComponent(cookie[1]) : '';
    const lang = HOMEPAGE_LANGS.includes(saved) ? saved : geoLang(req);

    res.set('Cache-Control', 'no-store');
    res.set('Vary', 'Cookie, CF-IPCountry');
    return res.redirect(302, '/' + lang);
});

// express 5 dropped inline path regexes, so the paths are listed instead
app.get(HOMEPAGE_LANGS.flatMap((l) => ['/' + l, '/' + l + '/']), (req, res, next) => {
    const host = String(req.headers.host || '').split(':')[0].toLowerCase();
    // the blog and help subdomains have their own routing above
    if (host.startsWith('blog.') || host.startsWith('help.')) return next();
    const lang = req.path.replace(/\//g, '');
    return sendPage(res, req, 'index.html', 200, lang);
});

// Legal pages moved to clean urls; keep the old paths working with 301s.
app.get('/privacy', (req, res) => res.redirect(301, '/privacy-policy'));
app.get('/tos', (req, res) => res.redirect(301, '/terms-of-service'));

// Page requests go through the renderer above so the javascript-disabled notice
// and the geo language land in the html. Assets fall straight through to
// express.static below.
app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (path.extname(req.path) && !/\.html$/i.test(req.path)) return next();
    let file = req.path === '/' ? 'index.html'
        : req.path.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!/\.html$/i.test(file)) file += '.html';
    // stay inside public/: no traversal, no nested paths
    if (file.includes('/') || file.includes('\\') || file.includes('..')) return next();
    const full = path.join(__dirname, 'public', file);
    if (!fsSync.existsSync(full)) return next();
    return sendPage(res, req, file);
});

// Serve the static marketing site (/, /privacy-policy, /tos, assets).
// Long-lived, immutable caching for media/fonts so Cloudflare's edge and the
// browser both keep them (images update via a new filename or ?v= query).
// html is never cached hard, so page edits always go live immediately.
app.use(express.static(path.join(__dirname, 'public'), {
    extensions: ['html'],
    setHeaders: (res, filePath) => {
        if (/\.(png|jpe?g|webp|gif|svg|ico|avif|woff2?)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (/\.(css|js)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=86400');
        } else if (/\.html$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

// Rate-limit the demo form: 5 submissions / hour / IP (in-memory store).
const demoRequestLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `demo_request:${req.realIp}`,
    message: { error: 'too many requests, please try again later' }
});

// Rate-limit trial sign-ups harder than demo requests: a trial grants access,
// so a burst from one IP is worth more to an abuser. 3 / hour / IP.
const trialRequestLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `trial_request:${req.realIp}`,
    message: { error: 'too many requests, please try again later' }
});

// Creating an account is the most attackable thing on the site: it sends mail to
// an address a stranger chose, and it writes a row that is meant to last. So the
// limits here are tighter than the forms', and there are three of them because
// the three steps are abused differently.
//
// These bound what one ip can do. The limits that follow the address itself
// (five codes an hour, a minute between them, five wrong guesses) live in
// accounts.js, because an attacker with a thousand ips still only gets five
// emails sent to any one victim.
const authRegisterLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `auth_register:${req.realIp}`,
    message: { error: 'too many attempts, please try again later' }
});
// Guessing is the attack here, and a six digit code has a million answers. Twenty
// tries an hour per ip on top of five per sign-up leaves nothing worth trying.
const authVerifyLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `auth_verify:${req.realIp}`,
    message: { error: 'too many attempts, please try again later' }
});
// A resend button is a button that sends mail to somebody else's inbox on demand.
const authResendLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `auth_resend:${req.realIp}`,
    message: { error: 'too many attempts, please try again later' }
});

// Diagnostics for outbound mail. Off unless ADMIN_TOKEN is set, and it answers 404
// rather than 403 when the token is wrong so its existence is not discoverable.
// GET  /v1/mail-status?token=...            what the server thinks it is configured with
// POST /v1/mail-status?token=...&send=1     actually send a test message and report the
//                                           provider's raw answer
// The header is the one to use: a query string is written to every access log,
// proxy log and browser history it passes through, and this token is the whole
// gate. ?token= still works so nothing that already relies on it breaks.
//     curl -H "x-admin-token: ..." https://sentinelpay.org/v1/submissions
function adminOk(req) {
    const adminToken = process.env.ADMIN_TOKEN || '';
    if (!adminToken) return false;
    const provided = String(req.get('x-admin-token') || req.query.token || '');
    return crypto.timingSafeEqual(sha256(provided), sha256(adminToken));
}

// Reads the submission log back. Same token gate as /v1/mail-status, same 404 when
// it is wrong. Every row here is personal data, so the answer is never cached and
// never stored by anything between us and the browser asking for it.
app.get('/v1/submissions', async (req, res) => {
    if (!adminOk(req)) {
        return sendPage(res, req, '404.html', 404);
    }
    const kind = String(req.query.kind || '').slice(0, 32);
    // ?flagged=1 is the working question: what came in that a person should look at
    const flagged = String(req.query.flagged || '') === '1';
    try {
        const out = await submissions.recent(req.query.limit, kind, flagged);
        res.set('Cache-Control', 'no-store, private');
        res.json({ source: out.source, count: out.rows.length, submissions: out.rows });
    } catch (err) {
        console.error('[submissions read]', err.message);
        res.status(500).json({ error: 'read failed' });
    }
});

// Erasure. Removes every row belonging to an address, found through the blind
// index, so honouring the request does not require the address to have been
// stored in the first place. POST only: a link that deletes data is a link
// somebody will follow by accident.
app.post('/v1/forget', async (req, res) => {
    if (!adminOk(req)) {
        return sendPage(res, req, '404.html', 404);
    }
    const email = String((req.body && req.body.email) || req.query.email || '').trim();
    if (!email || email.length > 254) return res.status(400).json({ error: 'email required' });
    try {
        const removed = await db.forget(email);
        // an erasure request covers the account too, and anything half-made under
        // the same address: leaving those behind would make the deletion a lie
        let account = 0;
        try { account = await accounts.forget(email); }
        catch (accErr) { console.error('[forget accounts]', accErr.message); }
        // and the fallback file, which holds the same fields the database does.
        // deleting the row and leaving the file would make the answer below a
        // number that is true about one copy and silent about the other.
        let files = 0;
        try { files = submissions.forgetInFiles(email); }
        catch (fileErr) { console.error('[forget files]', fileErr.message); }
        const removedTotal = removed + account + files;
        console.log('[submissions] erasure request removed ' + removedTotal + ' rows');
        res.set('Cache-Control', 'no-store, private');
        res.json({ removed: removedTotal });
    } catch (err) {
        console.error('[forget]', err.message);
        res.status(500).json({ error: 'delete failed' });
    }
});

// What the account store knows about one address. Same token gate, same 404 when
// it is wrong. It exists because the sign-up form cannot tell you why no code
// arrived without telling every stranger who has an account here, so the answer
// lives behind the admin token instead.
//     curl -H "x-admin-token: ..." "https://sentinelpay.org/v1/account-status?email=someone@example.com"
app.get('/v1/account-status', async (req, res) => {
    if (!adminOk(req)) {
        return sendPage(res, req, '404.html', 404);
    }
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!email || email.length > 254) return res.status(400).json({ error: 'email required' });
    try {
        res.set('Cache-Control', 'no-store, private');
        res.json(await accounts.inspect(email));
    } catch (err) {
        console.error('[account-status]', err.message);
        res.status(500).json({ error: 'lookup failed' });
    }
});

app.all('/v1/mail-status', async (req, res) => {
    if (!adminOk(req)) {
        return sendPage(res, req, '404.html', 404);
    }

    const state = {
        nodeEnv: process.env.NODE_ENV || '(unset)',
        resendKey: process.env.RESEND_API_KEY
            ? 'set, ' + process.env.RESEND_API_KEY.length + ' chars, starts ' + process.env.RESEND_API_KEY.slice(0, 3)
            : 'NOT SET',
        from: mailer.MAIL_FROM,
        to: mailer.MAIL_TO,
        // a form POST is rejected outright when cloudflare is not adding this header,
        // which looks exactly like "the email never arrived"
        cloudflareOriginCheck: process.env.CF_ORIGIN_SECRET
            ? (process.env.CF_ORIGIN_STRICT === 'true' ? 'enforced site-wide' : 'enforced on form endpoints only')
            : 'off',
        // without this the forms accept submissions with no bot challenge at all
        turnstile: process.env.TURNSTILE_SECRET_KEY ? 'enforced' : 'OFF (forms accept unverified submissions)',
        submissionLog: submissions.LOG_DIR,
        database: db.status(),
        accounts: accounts.status(),
    };

    // sending is a side effect, so it needs POST: a token that leaks into a url
    // must not be firable by an <img src> or a link preview bot.
    if (req.method !== 'POST' || String(req.query.send || '') !== '1') {
        return res.json({ state, hint: 'POST with &send=1 to send a test message' });
    }

    try {
        const result = await mailer.send({
            subject: 'sentinelpay mail test',
            eyebrow: 'diagnostics',
            title: 'mail is working',
            intro: 'this message was sent by /v1/mail-status, so delivery from the server is fine.',
            pairs: [['sent at', new Date().toISOString()], ['from', mailer.MAIL_FROM], ['to', mailer.MAIL_TO]],
        });
        if (result && result.preview) return res.json({ state, sent: false, mode: 'preview only, no api key', file: result.preview });
        return res.json({ state, sent: true, result });
    } catch (err) {
        return res.status(500).json({ state, sent: false, code: err.code || null, error: err.message });
    }
});

// Free and disposable mail providers. The trial's whole verification is "your work
// email is at your company's own domain", which a visitor can otherwise satisfy by
// entering the provider's domain as their website: x@gmail.com + gmail.com matched
// and let anyone in. Checked on both sides of the pair.
// Two lists of mailbox providers, refreshed by tools/refresh-mail-domains.js and
// read once at boot. Around thirteen thousand domains between them, which is why
// they are files rather than something anyone maintains by hand.
//
// Neither list decides whether a submission is accepted. That is the domain
// match, and it applies to everybody equally. These only decide what the
// submission is tagged with, so a stale or wrong entry costs a misleading tag,
// never a lost lead.
function loadDomainFile(name) {
    try {
        const raw = fsSync.readFileSync(path.join(__dirname, 'data', name), 'utf8');
        const set = new Set();
        for (const line of raw.split('\n')) {
            const d = line.trim().toLowerCase();
            if (d && d[0] !== '#') set.add(d);
        }
        return set;
    } catch (err) {
        // the lists are a nicety, not a gate: without them submissions still come
        // in and are still judged by the domain match, they just arrive untagged
        console.error('[mail-domains] cannot read ' + name + ': ' + err.message);
        return new Set();
    }
}

const FREE_MAIL_DOMAINS = loadDomainFile('free-email-domains.txt');
const DISPOSABLE_EMAIL_DOMAINS = loadDomainFile('disposable-email-domains.txt');

function isFreeMailDomain(domain) {
    return FREE_MAIL_DOMAINS.has(String(domain || '').toLowerCase());
}
function isDisposableDomain(domain) {
    return DISPOSABLE_EMAIL_DOMAINS.has(String(domain || '').toLowerCase());
}

// What a submission gets tagged with instead of being turned away. The tags are
// stored next to the row and printed at the top of the notification, so a human
// decides whether it is a big company with a tidy inbox or somebody farming
// trials, which is a judgement no rule here was ever going to make correctly.
// The same tags, written out for whoever opens the notification. A code in an
// inbox gets ignored; a sentence gets read.
const FLAG_NOTES = {
    'free-email': 'the address is on a free consumer mailbox, and the website they gave is on that same domain. worth thirty seconds on the company name before you reply.',
    'disposable-email': 'the address is on a throwaway service, the kind built to stop existing. treat anything here as unverified.',
    'website-is-a-mailbox': 'the website they gave is a mail provider, not a company site.',
    'domain-mismatch': 'the website and the work email are on different domains.',
};
function reviewNotes(flags) {
    return (flags || []).map((f) => FLAG_NOTES[f]).filter(Boolean);
}

function reviewFlags(emailDomain, websiteHost) {
    const flags = [];
    // one or the other, never both: the generated lists do not overlap
    if (isDisposableDomain(emailDomain)) flags.push('disposable-email');
    else if (isFreeMailDomain(emailDomain)) flags.push('free-email');

    if (websiteHost && (isFreeMailDomain(websiteHost) || isDisposableDomain(websiteHost))) {
        flags.push('website-is-a-mailbox');
    }
    // the one rule that decides anything, and it decides it for everybody. no
    // exemption by provider: whoever you write from, the site has to agree.
    if (websiteHost && !(
        websiteHost === emailDomain ||
        websiteHost.endsWith('.' + emailDomain) ||
        emailDomain.endsWith('.' + websiteHost)
    )) flags.push('domain-mismatch');
    return flags;
}

// --- accounts ---------------------------------------------------------------
//
// Two steps, and the second one is the account. /register writes nothing that can
// be logged into: it takes the details, hashes the password, and mails a six digit
// code to the address given. /verify is where the account appears, and only if the
// code comes back. An address whose mail the person cannot read therefore never
// becomes an account.
//
// Every answer here is deliberately incurious. Registering an address that already
// has an account gets the same reply as one that does not, and the person at the
// address is told what happened instead. A wrong code and an address with no
// sign-up in progress are the same error. Neither the form nor its timing should
// be usable to find out who has an account on this site.

// The password rules are the ones that matter and no more. Length is what a hash
// cannot buy you, so twelve is the floor; the rest of the usual advice (a symbol,
// a capital) makes passwords harder to remember without making them harder to
// guess. Anything the person has already typed into the form is refused, because
// "my email again" is the first thing anyone tries.
function passwordProblem(password, email, firstName, lastName) {
    if (typeof password !== 'string' || password.length < 12) return 'password must be at least 12 characters';
    if (password.length > 200) return 'password must be at least 12 characters';
    const low = password.toLowerCase();
    const local = String(email || '').split('@')[0].toLowerCase();
    const parts = [local, String(email || '').toLowerCase(), String(firstName || '').toLowerCase(), String(lastName || '').toLowerCase(), 'sentinelpay']
        .filter((p) => p && p.length >= 4);
    if (parts.some((p) => low.includes(p))) return 'please choose a password that is not your name or email';
    return '';
}

app.post('/v1/auth/register', requireCloudflareOrigin, authRegisterLimiter, async (req, res) => {
    try {
        const b = req.body || {};
        // the same hidden field the forms use: filled in means a bot, and a bot is
        // told the same thing a person is, so the trap stays a trap
        if (typeof b.company_url === 'string' && b.company_url.trim() !== '') {
            return res.json({ ok: true, next: 'verify' });
        }
        if (!(await verifyTurnstile(b['cf-turnstile-response'] || b.turnstileToken, req.realIp))) {
            return res.status(400).json({ error: 'verification failed, please try again' });
        }

        const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
        const firstName = clean(b.firstName, 80);
        const lastName = clean(b.lastName, 80);
        const email = clean(b.email, 160).toLowerCase();
        const password = typeof b.password === 'string' ? b.password : '';
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const nameRe = /^[a-zA-ZÀ-ɏ'’.\- ]{2,}$/;
        const lang = ['hr', 'de', 'en'].includes(b.lang) ? b.lang : 'en';

        if (!nameRe.test(firstName) || !nameRe.test(lastName) || !emailRe.test(email) || b.consent !== true) {
            return res.status(400).json({ error: 'invalid submission' });
        }
        const pwProblem = passwordProblem(password, email, firstName, lastName);
        if (pwProblem) return res.status(400).json({ error: pwProblem });

        if (!db.available()) {
            return res.status(503).json({ error: 'accounts are not available right now. please try again shortly.' });
        }

        const emailDomain = email.split('@').pop();
        // there is no website to compare against here, so the mailbox lists only
        // tag the account for a person to look at later. they turn nobody away.
        const flags = reviewFlags(emailDomain, '');

        const started = await accounts.startSignup({
            email,
            name: `${firstName} ${lastName}`,
            password,
            lang,
            flags,
        });

        if (started.reason === 'exists') {
            // the reply below is identical to the success one. the difference goes
            // to the inbox, where only the owner of the address can read it.
            //
            // this branch is why "i got no code" is not the same as "the mail is
            // broken": the address already has an account, so a different message
            // went out. the form cannot say so without telling every stranger who
            // has an account here, but the log can.
            console.log('[auth] register: address already has an account, sent the notice instead');
            try { await mailer.sendSignupExists({ to: email, lang }); }
            catch (err) { console.error('[auth] the notice failed to send: ' + err.message); }
            return res.json({ ok: true, next: 'verify' });
        }
        if (started.reason === 'slow-down') {
            console.log('[auth] register: a code went out less than a minute ago, asked them to wait');
            return res.status(429).json({ error: 'a code was just sent. check your inbox, or ask for another in a minute.', retryIn: started.retryIn });
        }
        if (started.reason === 'too-many-sends') {
            console.log('[auth] register: this address is at its hourly send ceiling');
            return res.status(429).json({ error: 'too many codes sent to this address. please try again later.' });
        }
        if (!started.ok) {
            console.error('[auth] register: the account store is unavailable (' + (started.reason || 'no reason') + ')');
            return res.status(503).json({ error: 'accounts are not available right now. please try again shortly.' });
        }

        try {
            await mailer.sendSignupCode({ to: email, code: started.code, lang, minutes: started.expiresInMin });
        } catch (mailErr) {
            console.error('[auth register mail failed]', mailErr.code || '', mailErr.message);
            return res.status(500).json({ error: 'could not send the code. please try again shortly.' });
        }

        // the code itself is never written anywhere we can read: not here, not in
        // the row, not in the log line. the provider's message id is logged by the
        // mailer on the line above this one, which is the thread to pull on when
        // somebody says the code never arrived.
        console.log('[auth] register: code sent, flags: ' + (flags.join(',') || 'none'));
        res.json({ ok: true, next: 'verify' });
    } catch (err) {
        console.error('[auth register error]', err.message);
        res.status(500).json({ error: 'could not create the account right now. please try again shortly.' });
    }
});

app.post('/v1/auth/resend', requireCloudflareOrigin, authResendLimiter, async (req, res) => {
    try {
        const email = String((req.body && req.body.email) || '').trim().toLowerCase().slice(0, 160);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'invalid submission' });
        if (!db.available()) return res.status(503).json({ error: 'accounts are not available right now. please try again shortly.' });

        const again = await accounts.resendSignup(email);
        if (again.reason === 'slow-down') {
            return res.status(429).json({ error: 'a code was just sent. check your inbox, or ask for another in a minute.', retryIn: again.retryIn });
        }
        if (again.reason === 'too-many-sends') {
            return res.status(429).json({ error: 'too many codes sent to this address. please try again later.' });
        }
        // no pending sign-up and an expired one are both answered as if a code went
        // out: otherwise this endpoint tells anyone which addresses are mid sign-up
        if (!again.ok) return res.json({ ok: true });

        try {
            await mailer.sendSignupCode({ to: email, code: again.code, lang: again.lang, minutes: again.expiresInMin });
        } catch (mailErr) {
            console.error('[auth resend mail failed]', mailErr.code || '', mailErr.message);
            return res.status(500).json({ error: 'could not send the code. please try again shortly.' });
        }
        res.json({ ok: true, sendsLeft: again.sendsLeft });
    } catch (err) {
        console.error('[auth resend error]', err.message);
        res.status(500).json({ error: 'could not send the code. please try again shortly.' });
    }
});

app.post('/v1/auth/verify', requireCloudflareOrigin, authVerifyLimiter, async (req, res) => {
    try {
        const b = req.body || {};
        const email = String(b.email || '').trim().toLowerCase().slice(0, 160);
        const code = String(b.code || '').replace(/\s+/g, '').slice(0, 6);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'invalid submission' });
        if (!db.available()) return res.status(503).json({ error: 'accounts are not available right now. please try again shortly.' });

        const out = await accounts.verifySignup(email, code);
        if (out.reason === 'expired') {
            return res.status(400).json({ error: 'that code has expired. ask for a new one.' });
        }
        if (out.reason === 'too-many-attempts') {
            return res.status(429).json({ error: 'too many wrong codes. ask for a new one.' });
        }
        if (out.reason === 'bad-code') {
            return res.status(400).json({ error: 'that code is not right. check your email and try again.', attemptsLeft: out.attemptsLeft });
        }
        if (!out.ok) return res.status(503).json({ error: 'accounts are not available right now. please try again shortly.' });

        // a record of the account, kept next to the form submissions so there is one
        // place a person looks to see who arrived and how
        submissions.record('account', req, { email, name: out.name, lang: out.lang }, 'created');

        // best effort, and never allowed to fail the sign-up: the account exists
        try {
            await mailer.send({
                subject: 'new account: ' + (out.name || email),
                replyTo: email,
                eyebrow: 'accounts',
                title: 'somebody created an account',
                intro: 'the address was verified by code before the account was written.',
                pairs: [['name', out.name], ['email', email], ['language', out.lang]],
            });
        } catch (notifyErr) {
            console.error('[auth verify notify failed]', notifyErr.message);
        }

        res.json({ ok: true });
    } catch (err) {
        console.error('[auth verify error]', err.message);
        res.status(500).json({ error: 'could not create the account right now. please try again shortly.' });
    }
});

app.post('/v1/trial-request', requireCloudflareOrigin, trialRequestLimiter, async (req, res) => {
    try {
        const b = req.body || {};

        if (typeof b.company_url === 'string' && b.company_url.trim() !== '') {
            return res.json({ ok: true });
        }
        const turnstileToken = b['cf-turnstile-response'] || b.turnstileToken;
        if (!(await verifyTurnstile(turnstileToken, req.realIp))) {
            return res.status(400).json({ error: 'verification failed, please try again' });
        }

        const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
        const firstName = clean(b.firstName, 80);
        const lastName = clean(b.lastName, 80);
        const jobTitle = clean(b.jobTitle, 120);
        const email = clean(b.email, 160);
        const company = clean(b.company, 120);
        const website = clean(b.website, 160);
        const industry = clean(b.industry, 80);
        const country = clean(b.country, 80);
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const nameRe = /^[a-zA-ZÀ-ɏ'’.\- ]{2,}$/;

        // the trial asks for what the product needs and nothing else: who to reach,
        // and the domain that verifies them. job title, industry and country are
        // sales fields and are not collected here, so they are not required either.
        // both declarations are the basis for granting access, so both stay required.
        if (!nameRe.test(firstName) || !nameRe.test(lastName) ||
            !emailRe.test(email) || !website ||
            b.consent !== true || b.notGambling !== true) {
            return res.status(400).json({ error: 'invalid submission' });
        }

        const host = website.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./i, '').toLowerCase();
        const emailDomain = email.split('@').pop().toLowerCase();

        // One rule stands between a stranger and a trial: the address has to be on
        // the same domain as the site. Every address is welcome to try, from any
        // provider, and none of them get an exemption. What the provider is only
        // decides what the submission is tagged with afterwards.
        const flags = reviewFlags(emailDomain, host);
        if (flags.indexOf('domain-mismatch') !== -1) {
            return res.status(400).json({ error: 'website domain must match your work email domain' });
        }

        // we publicly refuse gambling operators, so the declared industry is checked
        // here too and not only in the tickbox above.
        if (industry && /gambling|igaming|casino|betting|sportsbook|wager/i.test(industry)) {
            return res.status(400).json({ error: 'we do not onboard gambling operators' });
        }

        // the mail that matters is the one to the person who signed up: it is their
        // access to the trial. if that fails the sign-up has not happened, so it is
        // the only send whose failure is reported back to the form.
        const lang = ['hr', 'de', 'en'].includes(b.lang) ? b.lang : 'en';

        // written first: if the mail then fails, we still know who signed up
        submissions.record('trial', req, {
            name: `${firstName} ${lastName}`,
            email, company, website, jobTitle, industry, formCountry: country, lang,
            domainCheck: flags.length ? 'flagged' : 'passed',
            flags: flags,
        }, 'accepted');

        try {
            await mailer.sendTrialWelcome({ to: email, lang });
        } catch (mailErr) {
            console.error('[trial-request welcome failed]', mailErr.code || '', mailErr.message);
            submissions.record('trial', req, { email }, 'welcome-mail-failed');
            return res.status(500).json({ error: 'failed to submit' });
        }

        // our own copy is best effort. it goes to a shared inbox that may not be
        // configured, and a bounce there must never cost the visitor their trial.
        try {
            await mailer.send({
                subject: (flags.length ? 'review: ' : '') +
                    `new trial sign-up: ${firstName} ${lastName}${company ? ' @ ' + company : ''}`,
                replyTo: email,
                eyebrow: 'free trial',
                title: 'a company signed up for the trial',
                intro: flags.length
                    ? 'the welcome email has been sent to them, but something here is worth a second look.'
                    : 'the domain check passed and the welcome email has been sent to them.',
                review: reviewNotes(flags),
                pairs: [
                    ['name', `${firstName} ${lastName}`],
                    ['job title', jobTitle],
                    ['work email', email],
                    ['company', company],
                    ['website', website],
                    ['industry', industry],
                    ['country', country],
                    ['language', lang],
                    ['domain check', flags.length ? flags.join(', ') : 'passed'],
                ],
            });
        } catch (notifyErr) {
            console.error('[trial-request notify failed]', notifyErr.code || '', notifyErr.message);
        }

        res.json({ ok: true });
    } catch (err) {
        console.error('[trial-request error]', err.message);
        res.status(500).json({ error: 'failed to submit' });
    }
});

app.post('/v1/demo-request', requireCloudflareOrigin, demoRequestLimiter, async (req, res) => {
    try {
        const b = req.body || {};

        // Honeypot: a hidden field real users never fill. If it's populated, it's a bot.
        // Pretend success and silently drop (no email, don't reveal the trap).
        if (typeof b.company_url === 'string' && b.company_url.trim() !== '') {
            return res.json({ ok: true });
        }

        // Bot challenge: verify the Cloudflare Turnstile token (no-op until keys are set).
        const turnstileToken = b['cf-turnstile-response'] || b.turnstileToken;
        if (!(await verifyTurnstile(turnstileToken, req.realIp))) {
            return res.status(400).json({ error: 'verification failed, please try again' });
        }

        const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
        const firstName = clean(b.firstName, 80);
        const lastName = clean(b.lastName, 80);
        const jobTitle = clean(b.jobTitle, 120);
        const email = clean(b.email, 160);
        const company = clean(b.company, 120);
        const website = clean(b.website, 160);
        const industry = clean(b.industry, 80);
        const country = clean(b.country || b.region, 80);
        const size = clean(b.size, 40);
        const volume = clean(b.volume, 40);
        const solutions = Array.isArray(b.solutions) ? b.solutions.map((s) => clean(s, 60)).filter(Boolean).slice(0, 12).join(', ') : '';
        const message = clean(b.message, 2000);
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const nameRe = /^[a-zA-ZÀ-ɏ'’.\- ]{2,}$/;

        if (!nameRe.test(firstName) || !nameRe.test(lastName) || jobTitle.length < 2 ||
            !emailRe.test(email) || !company || b.consent !== true) {
            return res.status(400).json({ error: 'invalid submission' });
        }

        // the same refusal as the trial endpoint: we do not onboard gambling, so a
        // demo request from one should not reach the inbox either.
        if (/gambling|igaming|casino|betting|sportsbook|wager/i.test(industry)) {
            return res.status(400).json({ error: 'we do not onboard gambling operators' });
        }

        // same rule as the trial: any provider, as long as the site agrees with it
        const emailDomain = email.split('@').pop().toLowerCase();
        const host = website
            ? website.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./i, '').toLowerCase()
            : '';
        const flags = reviewFlags(emailDomain, host);
        if (flags.indexOf('domain-mismatch') !== -1) {
            return res.status(400).json({ error: 'website domain must match your work email domain' });
        }

        submissions.record('demo', req, {
            name: `${firstName} ${lastName}`,
            email, company, website, jobTitle, industry, formCountry: country,
            size, volume, solutions, message,
            flags: flags,
        }, 'accepted');

        try {
            await mailer.send({
                subject: (flags.length ? 'review: ' : '') +
                    `new demo request: ${firstName} ${lastName}${company ? ' @ ' + company : ''}`,
                replyTo: email,
                eyebrow: 'demo request',
                title: 'someone asked for a demo',
                intro: 'sent from the demo form on sentinelpay.org.',
                review: reviewNotes(flags),
                pairs: [
                    ['name', `${firstName} ${lastName}`],
                    ['job title', jobTitle],
                    ['email', email],
                    ['company', company],
                    ['website', website],
                    ['industry', industry],
                    ['country', country],
                    ['company size', size],
                    ['wallets/txns per year', volume],
                    ['solutions', solutions],
                    ['message', message],
                    ['domain check', flags.length ? flags.join(', ') : 'passed'],
                ],
            });
        } catch (mailErr) {
            console.error('[demo-request mail failed]', mailErr.code || '', mailErr.message);
            submissions.record('demo', req, { email }, 'notify-mail-failed');
            return res.status(500).json({ error: 'failed to submit' });
        }

        res.json({ ok: true });
    } catch (err) {
        console.error('[demo-request error]', err.message);
        res.status(500).json({ error: 'failed to submit' });
    }
});

app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'request body too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid request body' });
    if (err.message === 'Not allowed by CORS') return res.status(403).json({ error: 'cors policy violation' });
    console.error('[unhandled error]', err.message || err);
    if (!res.headersSent) return res.status(500).json({ error: 'internal server error' });
    next(err);
});

app.use((req, res) => {
    sendPage(res, req, '404.html', 404);
});

process.on('unhandledRejection', (reason) => {
    console.error('[unhandled rejection]', reason instanceof Error ? reason.message : reason);
});
process.on('uncaughtException', (err) => {
    console.error('[uncaught exception]', err.message);
    process.exit(1);
});

app.listen(PORT, () => {
    console.log(`[sentinelpay-web] server active on port ${PORT}`);
    if (mailer.isConfigured()) {
        console.log(`[mail] ready, ${mailer.MAIL_FROM} -> ${mailer.MAIL_TO}`);
    } else {
        console.error('[mail] RESEND_API_KEY is not set: form submissions will fail with a 500 instead of sending');
    }

    // the fallback file is swept whether or not there is a database: it is the
    // copy that exists precisely when the database is not there
    submissions.startRetention();

    const dbState = db.status();
    if (!dbState.configured) {
        console.error('[db] DATABASE_URL is not set: submissions go to ' + submissions.LOG_DIR +
            ', which a redeploy wipes');
    } else {
        if (!dbState.encrypted) {
            console.error('[db] SUBMISSIONS_KEY is not set: personal data will be stored unencrypted');
        }
        db.startRetention();
        // unfinished sign-ups expire with everything else
        setTimeout(() => { accounts.purge(); }, 45000).unref();
        setInterval(() => { accounts.purge(); }, 6 * 60 * 60 * 1000).unref();
    }
});
