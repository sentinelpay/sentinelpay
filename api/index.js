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
        return data && data.success === true;
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
                    // legacy slug aliases (keep old links working)
                    'why-criminals-target-small-businesses': 'blog-article.html',
                    'real-time-aml-why-timing-matters': 'blog-article-2.html',
                    'compliance-without-becoming-a-bank': 'blog-article-3.html',
                    'we-dont-do-gambling': 'blog-article-4.html',
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
        console.log('[submissions] erasure request removed ' + removed + ' rows');
        res.set('Cache-Control', 'no-store, private');
        res.json({ removed: removed });
    } catch (err) {
        console.error('[forget]', err.message);
        res.status(500).json({ error: 'delete failed' });
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
// Two lists, because they are two different things.
//
// A free mailbox is where a real person at a real company sometimes writes from:
// a founder before the domain is set up, someone whose it department has not
// given them an alias yet, a consultant. Refusing those turned away business to
// catch abuse, so they come in and get flagged for a human to look at instead.
const FREE_MAIL_DOMAINS = new Set([
    'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
    'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com',
    'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.de', 'gmx.net', 'web.de',
    't-online.de', 'freenet.de', 'mail.com', 'zoho.com', 'yandex.com', 'yandex.ru',
    'mail.ru', 'inbox.lv', 'seznam.cz', 'net.hr', 'gmail.hr', 'vip.hr', 'hi.t-com.hr',
    'a1.hr', 'optinet.hr', 'inet.hr', 'email.t-com.hr',
]);

// A throwaway address is not a person who might buy something. The mailbox is
// designed to stop existing, so there is nobody to follow up with and nothing to
// review. These stay refused.
const DISPOSABLE_EMAIL_DOMAINS = new Set([
    'mailinator.com', 'guerrillamail.com', 'yopmail.com', '10minutemail.com',
    'tempmail.com', 'temp-mail.org', 'trashmail.com', 'sharklasers.com',
    'dispostable.com', 'getnada.com', 'maildrop.cc', 'fakeinbox.com', 'throwawaymail.com',
]);

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
    'free-email': 'signed up from a free mailbox, not a company domain. could be a founder before the domain is set up, or somebody farming trials. worth thirty seconds on the company name before you reply.',
    'website-is-a-mailbox': 'the website they gave is a mail provider, not a company site. either a slip in the form or not a real company.',
    'domain-mismatch': 'the website and the work email are on different domains.',
};
function reviewNotes(flags) {
    return (flags || []).map((f) => FLAG_NOTES[f]).filter(Boolean);
}

function reviewFlags(emailDomain, websiteHost) {
    const flags = [];
    if (isFreeMailDomain(emailDomain)) flags.push('free-email');
    if (websiteHost && isFreeMailDomain(websiteHost)) flags.push('website-is-a-mailbox');
    if (websiteHost && !isFreeMailDomain(emailDomain) && !(
        websiteHost === emailDomain ||
        websiteHost.endsWith('.' + emailDomain) ||
        emailDomain.endsWith('.' + websiteHost)
    )) flags.push('domain-mismatch');
    return flags;
}

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

        // a throwaway address has nobody behind it to follow up with
        if (isDisposableDomain(emailDomain) || isDisposableDomain(host)) {
            return res.status(400).json({ error: 'please use an address we can reply to' });
        }
        // A work email at the company's own domain is what stands in for a manual
        // check. When it is a free mailbox there is no domain to match against, so
        // the pair cannot be required: it goes through tagged for review instead.
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

        // same rule as the trial: throwaway addresses out, free mailboxes in and
        // tagged, and the pair only has to match when there is a domain to match
        const emailDomain = email.split('@').pop().toLowerCase();
        const host = website
            ? website.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./i, '').toLowerCase()
            : '';
        if (isDisposableDomain(emailDomain) || (host && isDisposableDomain(host))) {
            return res.status(400).json({ error: 'please use an address we can reply to' });
        }
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

    const dbState = db.status();
    if (!dbState.configured) {
        console.error('[db] DATABASE_URL is not set: submissions go to ' + submissions.LOG_DIR +
            ', which a redeploy wipes');
    } else {
        if (!dbState.encrypted) {
            console.error('[db] SUBMISSIONS_KEY is not set: personal data will be stored unencrypted');
        }
        db.startRetention();
    }
});
