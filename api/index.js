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
            // google's font hosts are gone from both of these: the site serves its
            // own faces now, so nothing here asks for them, and a policy that
            // still permits an origin nothing uses is a policy that has stopped
            // describing the site. intercom's stays, because the chat widget
            // does load a face from it.
            'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.intercomcdn.com'],
            'font-src': ["'self'", 'https://fonts.intercomcdn.com'],
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

// A request from one of our own hostnames is not a cross origin request in any
// sense this list is meant to police. The list exists to stop somebody else's
// site calling our endpoints from their visitors' browsers; it was never meant
// to stop our own pages loading our own files.
//
// It did, though, and the way it showed up is worth writing down. A @font-face
// fetch is made in cors mode by specification, even when the file sits on the
// same origin as the page asking for it, and `<link rel="preload" as="font">`
// requires the crossorigin attribute for the same reason. So the browser sends
// an Origin header for every font on every page. On sentinelpay.org that header
// matched ALLOWED_ORIGINS and the font loaded. On blog.sentinelpay.org it did
// not, this middleware answered 403, and the blog rendered in whatever serif the
// browser falls back to. Same server, same files, same html: one hostname short
// in an environment variable.
//
// Rather than asking somebody to keep every subdomain of every environment in
// sync in a variable, the check is now: is this request coming from the host it
// is addressed to, or from a sibling under the same registrable domain. Those
// are our own pages by definition.
function sameSite(origin, host) {
    if (!origin || !host) return false;
    let from;
    try {
        from = new URL(origin).hostname.toLowerCase();
    } catch (err) {
        return false;
    }
    const to = String(host).split(':')[0].toLowerCase();
    if (from === to) return true;
    // one label off the front of either: blog.sentinelpay.org against
    // sentinelpay.org, and the other way round. deliberately not a suffix match:
    // "notsentinelpay.org" must never look like a sibling of "sentinelpay.org".
    const apex = (h) => h.split('.').slice(-2).join('.');
    return apex(from) === apex(to) && apex(to).includes('.');
}

app.use(cors((req, callback) => {
    const origin = req.headers.origin;
    const options = { methods: ['POST', 'GET'] };

    if (allowedOrigins.includes('*')) {
        if (isProduction) return callback(new Error('Wildcard CORS disallowed in production.'));
        return callback(null, Object.assign({ origin: true }, options));
    }
    if (!origin) return callback(null, Object.assign({ origin: true }, options));
    if (sameSite(origin, req.headers.host)) return callback(null, Object.assign({ origin: true }, options));
    if (allowedOrigins.length === 0) {
        if (isProduction) return callback(new Error('ALLOWED_ORIGINS must be configured in production.'));
        return callback(null, Object.assign({ origin: true }, options));
    }
    if (allowedOrigins.indexOf(origin) !== -1) return callback(null, Object.assign({ origin: true }, options));
    callback(new Error('Not allowed by CORS'));
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

// ---------------------------------------------------------------------------
// the staging ribbon
// ---------------------------------------------------------------------------
//
// A copy of the site that looks exactly like the real one is a trap. Somebody
// tests a fix on staging and reports it live; somebody else edits data on
// production believing it is the copy. The whole value of staging is being
// identical, so the one thing that must not be identical is the label.
//
// It is fixed to the bottom rather than the top: the top already has the nav
// and the incident banner, and this must not push the layout it exists to let
// you check. It carries the commit it is running, which Railway hands us, so
// "is my change up yet" is answered by looking rather than by guessing.
//
// The styles ride with it in a <style> element rather than a style attribute:
// the site's policy allows inline stylesheets and forbids inline style
// attributes, and this is not a good enough reason to weaken that.
const IS_STAGING = String(process.env.APP_ENV || '').toLowerCase() === 'staging';

function stagingRibbon() {
    if (!IS_STAGING) return '';
    const sha = String(process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7);
    const branch = String(process.env.RAILWAY_GIT_BRANCH || '');
    const bits = ['staging', 'not production'];
    // the branch is usually called staging too, and saying it twice reads as a
    // bug in the ribbon rather than as information
    if (branch && branch.toLowerCase() !== 'staging') bits.push(branch);
    if (sha) bits.push(sha);
    return '<style>' +
        '.sp-staging{position:fixed;z-index:2147483000;left:0;right:0;bottom:0;' +
        'display:flex;align-items:center;justify-content:center;gap:.6rem;' +
        'padding:.42rem .8rem;background:#ffb300;color:#1a1200;' +
        'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;' +
        'font-size:11px;letter-spacing:.08em;text-transform:uppercase;' +
        'box-shadow:0 -6px 20px rgba(0,0,0,.35);pointer-events:none}' +
        '.sp-staging b{font-weight:700}' +
        '@media print{.sp-staging{display:none}}' +
        '</style>' +
        '<div class="sp-staging" role="status" data-i18n-skip>' +
        '<b>' + escapeHtml(bits[0]) + '</b><span>' + escapeHtml(bits.slice(1).join(' · ')) + '</span>' +
        '</div>';
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
        .replace('<body class="lp-body">', () => '<body class="lp-body">' + statusBanner() + stagingRibbon());
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

// Nothing on staging is for the public. The header goes on every response and
// robots.txt refuses the whole site, because the one thing worse than a staging
// copy is a staging copy in google competing with the real page for its own
// name. Belt and braces on purpose: a header covers the pages a crawler asks
// for without reading robots.txt first.
if (IS_STAGING) {
    app.use((req, res, next) => {
        res.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
        next();
    });
    app.get('/robots.txt', (req, res) => {
        res.type('text/plain').send('User-agent: *\nDisallow: /\n');
    });
}

// Subdomain routing, served by this same service via Host header (no extra service):
//  - blog.* -> the blog page (public/blog.html)
//  - help.* -> a blank page until real content exists
//
// Matched on the first label rather than on the full production hostname. The
// blog is not a separate deployment, it is these same files behind a different
// host, so pinning the check to blog.sentinelpay.org meant staging had no blog
// at all: every change to the blog could only be seen by shipping it to
// production first, which is the one thing staging exists to prevent.
const BLANK_PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>sentinelpay</title><style>html,body{margin:0;height:100%;background:#06070f}</style></head><body></body></html>';
app.use((req, res, next) => {
    const host = String(req.headers.host || '').split(':')[0].toLowerCase();
    const label = host.split('.')[0];
    if (label === 'blog') {
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
    if (label === 'help') {
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

// The dashboard is the one page that is not for everybody, so it is checked
// here rather than in the browser. A page that renders and then redirects has
// already been delivered: the markup is in the network tab, in the cache, and
// in the back button. This one never leaves the server unless the cookie is
// good, and somebody signed out is sent to sign in instead.
app.get('/dashboard', async (req, res, next) => {
    try {
        const me = await currentUser(req);
        if (!me) return res.redirect(302, '/auth');
    } catch (err) {
        console.error('[dashboard guard]', err.message);
        return res.redirect(302, '/auth');
    }
    // no store rather than no cache: a signed-in page must not sit in a shared
    // cache or come back from the back button after signing out
    res.set('Cache-Control', 'no-store, private');
    return next();
});

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
// When one of these fires, the answer carries how long the wait is. Without it
// the panel can only say "too many attempts" and leave somebody pressing a
// button that will not work for another forty minutes; with it, the same panel
// shows a countdown, which is a rule rather than a fault.
function limitHandler(req, res, next, options) {
    const until = req.rateLimit && req.rateLimit.resetTime;
    const retryIn = until ? Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000)) : undefined;
    if (retryIn) res.set('Retry-After', String(retryIn));
    res.status(options.statusCode).json(Object.assign({}, options.message, { retryIn }));
}

// ---------------------------------------------------------------------------
// the sign-in cookie
// ---------------------------------------------------------------------------
//
// httpOnly so no script can read it, Secure so it never travels in the clear,
// and SameSite=Lax so it is not sent on a cross site POST, which is csrf cover
// for every endpoint that reads it. Lax rather than Strict on purpose: Strict
// would drop the cookie when somebody arrives from a link in their own email,
// and the whole flow here starts with a link in an email.
//
// Secure is off when there is no https, which is only ever the case on a
// developer's own machine. Otherwise the browser would refuse to store it and
// signing in would appear to do nothing.
const SESSION_COOKIE = 'sp_session';
const COOKIE_SECURE = process.env.NODE_ENV === 'production';

function readCookie(req, name) {
    const raw = String(req.headers.cookie || '');
    const m = raw.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
}

function setSessionCookie(res, token, maxAgeSeconds) {
    res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: COOKIE_SECURE,
        sameSite: 'lax',
        path: '/',
        maxAge: maxAgeSeconds * 1000,
    });
}

function clearSessionCookie(res) {
    res.clearCookie(SESSION_COOKIE, {
        httpOnly: true, secure: COOKIE_SECURE, sameSite: 'lax', path: '/',
    });
}

// Whoever is signed in, or null. Attached by the routes that need it rather
// than by a global middleware: a database round trip on every request for a
// static page is a cost with nothing to show for it.
async function currentUser(req) {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) return null;
    return accounts.readSession(token);
}

const authRegisterLimiter = rateLimit({
    handler: limitHandler,
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
    handler: limitHandler,
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `auth_verify:${req.realIp}`,
    message: { error: 'too many attempts, please try again later' }
});
// Signing in is where a leaked password list gets tried. Ten an hour per ip is
// generous for a person who has forgotten which password they used and useless
// to anybody working through a list.
const authLoginLimiter = rateLimit({
    handler: limitHandler,
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `auth_login:${req.realIp}`,
    message: { error: 'too many attempts, please try again later' }
});
// A resend button is a button that sends mail to somebody else's inbox on demand.
const authResendLimiter = rateLimit({
    handler: limitHandler,
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

// ---------------------------------------------------------------------------
// staff
// ---------------------------------------------------------------------------
//
// Two ways into the admin pages, and they are not equal.
//
// The first is a signed-in account whose address is on the staff list. That is
// the ordinary way: you sign in as yourself, the pages know who you are, and
// every request writes a line saying so. No token in a url, nothing to paste
// into a chat window, nothing to leak in a screenshot, and access ends the
// moment the session does.
//
// The second is the admin token, kept as the way in when everything else is
// broken: no database, no sessions, nobody able to sign in. It has no name
// attached, so it can only ever say that somebody with the token was here.
//
// The list lives in the environment rather than in a column, so taking somebody
// off it takes effect on their next request rather than after a migration. It
// is checked against the address on the session, which the account proved by
// email before it existed.
function staffList() {
    return String(process.env.STAFF_EMAILS || '')
        .split(',')
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean);
}

async function staffOf(req) {
    const list = staffList();
    if (!list.length) return null;
    const me = await currentUser(req);
    if (!me || !me.email) return null;
    return list.includes(String(me.email).toLowerCase()) ? me : null;
}

// Answers with who it was, so the caller can both allow the request and say in
// the log whose it was. `null` means no.
async function whoIsAsking(req) {
    const me = await staffOf(req);
    if (me) return { kind: 'staff', who: me.email, name: me.name };
    if (adminOk(req)) return { kind: 'token', who: 'admin token' };
    return null;
}

// The gate every admin page goes through. A refusal is a 404 rather than a 403:
// a page that answers "forbidden" has told a stranger it exists.
function requireStaff(action) {
    return async (req, res, next) => {
        const asking = await whoIsAsking(req);
        if (!asking) return sendPage(res, req, '404.html', 404);
        req.staff = asking;
        // the point of the whole exercise: looking at somebody's details is an
        // event, and events have a name on them
        console.log('[staff] ' + asking.kind + ' ' + asking.who + ' -> ' + action +
            (req.query.ref ? ' ref=' + String(req.query.ref).slice(0, 32) : ''));
        return next();
    };
}

// Reads the submission log back. Same token gate as /v1/mail-status, same 404 when
// it is wrong. Every row here is personal data, so the answer is never cached and
// never stored by anything between us and the browser asking for it.
app.get('/v1/submissions', requireStaff('submissions json'), async (req, res) => {
    const kind = String(req.query.kind || '').slice(0, 32);
    // ?flagged=1 is the working question: what came in that a person should look at
    const flagged = String(req.query.flagged || '') === '1';
    try {
        const out = await submissions.recent(req.query.limit, kind, flagged, req.query.offset);
        res.set('Cache-Control', 'no-store, private');
        res.json({
            source: out.source,
            count: out.rows.length,
            total: out.total !== undefined ? out.total : out.rows.length,
            offset: Math.max(Number(req.query.offset) || 0, 0),
            submissions: out.rows,
        });
    } catch (err) {
        console.error('[submissions read]', err.message);
        res.status(500).json({ error: 'read failed' });
    }
});

// Erasure. Removes every row belonging to an address, found through the blind
// index, so honouring the request does not require the address to have been
// stored in the first place. POST only: a link that deletes data is a link
// somebody will follow by accident.
app.post('/v1/forget', requireStaff('erase'), async (req, res) => {
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

function escapeHtml(v) {
    return String(v).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

// Every email the site sends, rendered in the browser instead of sent. Same
// token gate, same 404 when it is wrong.
//
//     /v1/mail-preview                        the index, every template and language
//     /v1/mail-preview?t=signup-code&lang=hr  one message as the inbox will show it
//     /v1/mail-preview?t=signup-code&raw=text the plain text alternative
//
// The page carries its own content security policy. The site's policy forbids
// inline styles on style attributes, and an email is nothing but inline styles,
// so without this the preview would render as unstyled text and lie about how
// the message looks. The document it serves is our own html and loads nothing.
app.get('/v1/mail-preview', requireStaff('mail preview'), (req, res) => {
    const name = String(req.query.t || '');
    const lang = String(req.query.lang || 'en');
    const token = String(req.get('x-admin-token') || req.query.token || '');
    const link = (t, l) => '/v1/mail-preview?t=' + encodeURIComponent(t) + '&lang=' + l +
        (req.query.token ? '&token=' + encodeURIComponent(token) : '');

    res.set('Cache-Control', 'no-store, private');
    // script-src 'self' is here for one reason: cloudflare rewrites every email
    // address in an html response into [email protected] and ships a same-origin
    // script to decode it again. with no script-src the decoder was blocked and
    // the preview showed the placeholder, which is not what the message contains
    // and is not what the recipient sees. the email itself never passes through
    // cloudflare at all.
    res.set('Content-Security-Policy',
        "default-src 'none'; script-src 'self'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
        "style-src-attr 'unsafe-inline'; img-src 'self' https://sentinelpay.org data:; " +
        "font-src https://fonts.gstatic.com");

    if (!name) {
        const rows = mailer.previewNames().map((t) =>
            '<tr><td style="padding:10px 18px 10px 0;font-weight:600;">' + t + '</td>' +
            ['en', 'hr', 'de'].map((l) =>
                '<td style="padding:10px 12px 10px 0;"><a href="' + link(t, l) + '">' + l + '</a></td>').join('') +
            '<td style="padding:10px 0;"><a href="' + link(t, 'en') + '&raw=text">text</a></td></tr>'
        ).join('');
        return res.type('html').send(
            '<!doctype html><meta charset="utf-8"><title>mail previews</title>' +
            '<body style="margin:0;padding:40px;background:#f6f7f9;font-family:system-ui,sans-serif;color:#0e2358;">' +
            '<h1 style="font-size:20px;font-weight:800;margin:0 0 4px;">mail previews</h1>' +
            '<p style="margin:0 0 24px;color:rgba(14,35,88,0.6);font-size:14px;">exactly what the mailer builds. nothing is sent.</p>' +
            '<table style="border-collapse:collapse;font-size:14px;">' + rows + '</table></body>');
    }

    const out = mailer.render(name, lang);
    if (!out) return res.status(404).json({ error: 'unknown template', templates: mailer.previewNames() });

    if (String(req.query.raw || '') === 'text') {
        return res.type('text/plain; charset=utf-8').send('subject: ' + out.subject + '\n\n' + out.text);
    }
    // the subject and the sender ride above the message. they are part of the
    // design, they are the first thing anybody actually reads, and there is
    // nowhere else in a rendered email to see them.
    const bar =
        '<div style="max-width:560px;margin:0 auto 20px;padding:14px 16px;border-radius:12px;' +
        'background:#ffffff;border:1px solid #e6e9f0;' +
        'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif;">' +
        '<div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;color:#94a0bd;">subject</div>' +
        '<div style="margin-top:3px;font-size:15px;font-weight:700;color:#0e2358;">' + escapeHtml(out.subject) + '</div>' +
        '<div style="margin-top:10px;font-size:12px;color:#6b7899;">from ' + escapeHtml(mailer.MAIL_FROM) +
        ' &nbsp;·&nbsp; ' + escapeHtml(name) + ' &nbsp;·&nbsp; ' + escapeHtml(lang) + '</div></div>';
    const html = out.html
        .replace('</head>', '<title>' + escapeHtml(out.subject) + '</title></head>')
        .replace(/(<body[^>]*>)/, '$1<div style="padding:32px 16px 0;background:#f4f6fa;">' + bar + '</div>');
    return res.type('html').send(html);
});

// One row, deleted for real.
//
// The row goes from the database, which is where it lives; there is no archive
// and no bin to empty later. That is the point of the button: an inbox you can
// only add to is a pile, and a pile of other people's details is the thing we
// have been trying not to keep.
//
// POST rather than GET, and by id: a link that deletes is a link something will
// follow on its own, and an id cannot half match the wrong row.
app.post('/v1/submissions/delete', requireStaff('delete submission'), async (req, res) => {
    const id = String((req.body && req.body.id) || req.query.id || '');
    if (!/^[0-9]{1,19}$/.test(id)) return res.status(400).json({ error: 'id required' });
    if (!db.available()) {
        return res.status(503).json({ error: 'no database, so there is no row to delete' });
    }
    try {
        const removed = await db.remove(id);
        console.log('[staff] ' + req.staff.who + ' deleted submission id=' + id + ' rows=' + removed);
        res.set('Cache-Control', 'no-store, private');
        res.json({ removed });
    } catch (err) {
        console.error('[submission delete]', err.message);
        res.status(500).json({ error: 'delete failed' });
    }
});

// The inbox, live.
//
// Server-sent events rather than a websocket, and that is a choice rather than
// a shortcut. Everything here travels one way: the server says "something
// arrived", the page turns around and asks for it properly. A websocket is a
// two way pipe, which would need a second protocol, a library, its own
// authentication on the upgrade, and its own reconnect logic. This is one
// endpoint over ordinary http, behind the same staff gate as every other page,
// and the browser reconnects on its own when the connection drops.
//
// What crosses the wire is a nudge, never a person: the reference, the kind and
// the country. The details are fetched afterwards through the gate, so a stream
// left open in a forgotten tab is not a feed of other people's names.
app.get('/v1/inbox/stream', requireStaff('inbox stream'), (req, res) => {
    res.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        // no-transform matters as much as no-cache: a proxy that "helpfully"
        // compresses or buffers this holds every event until the buffer fills
        'Cache-Control': 'no-cache, no-transform, no-store',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');

    const onSubmission = (e) => {
        res.write('event: submission\n');
        res.write('data: ' + JSON.stringify(e) + '\n\n');
    };
    submissions.bus.on('submission', onSubmission);

    // a comment every twenty five seconds. it is not for the browser, which is
    // happy to wait: it is for whatever is between us and the browser, which
    // closes a connection that has said nothing for a minute.
    const beat = setInterval(() => { res.write(': beat\n\n'); }, 25000);

    const stop = () => {
        clearInterval(beat);
        submissions.bus.removeListener('submission', onSubmission);
    };
    req.on('close', stop);
    res.on('close', stop);
});

// The inbox: the submissions view a person opens, rather than the json a
// developer curls.
//
// This is the other half of taking the personal data out of the notification
// email. The notice is a doorbell now, and a doorbell is only an improvement if
// there is a door: without somewhere to click through to, "the details are in
// the submissions view" means whoever is on support cannot answer anybody.
//
// That is how it is done everywhere this is done properly. The message that
// lands in the shared mailbox carries a reference and a link; the details live
// in one system, behind a login, where looking is deliberate and can be logged.
// The mailbox stops being a filing cabinet nobody can empty.
//
// What it is not: a real admin. There is one token rather than accounts, so it
// cannot say who looked, only that somebody with the token did. That is the
// next thing to build, and it is written here so it is not mistaken for done.
app.get('/v1/inbox', requireStaff('inbox'), (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    // the page is a shell: the rows arrive over the same json api a developer
    // would curl, so there is one way to read a submission rather than two that
    // can disagree. `script-src 'self'` is what lets /inbox.js run and nothing
    // else; `connect-src 'self'` is what lets it fetch and hold the stream open.
    res.set('Content-Security-Policy',
        "default-src 'none'; script-src 'self'; connect-src 'self'; " +
        "style-src 'unsafe-inline'; style-src-attr 'unsafe-inline'; form-action 'none'");
    res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.set('Referrer-Policy', 'no-referrer');

    res.type('html').send(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<meta name="robots" content="noindex,nofollow"><title>inbox</title>' +
        '<body style="margin:0;padding:32px 18px 64px;background:#f4f6fa;' +
        'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif;">' +
        '<div style="max-width:720px;margin:0 auto;">' +
        '<h1 style="font-size:20px;font-weight:800;margin:0 0 4px;color:#0e2358;">inbox</h1>' +
        '<p style="margin:0 0 18px;color:rgba(14,35,88,0.6);font-size:13px;">' +
        'everything the forms have sent us. this is the only place the details are kept. ' +
        'signed in as <b>' + escapeHtml(req.staff.who) + '</b>, and every visit is in the log.</p>' +
        '<div id="tabs" style="display:flex;flex-wrap:wrap;gap:7px;margin:0 0 8px;"></div>' +
        '<div id="live" style="margin:0 0 16px;font-size:12px;color:#94a0bd;"></div>' +
        '<div id="rows"></div>' +
        '<div id="pager"></div>' +
        '</div><script src="/inbox.js?v=1"></script></body>');
});

// What the account store knows about one address. Same token gate, same 404 when
// it is wrong. It exists because the sign-up form cannot tell you why no code
// arrived without telling every stranger who has an account here, so the answer
// lives behind the admin token instead.
//     curl -H "x-admin-token: ..." "https://sentinelpay.org/v1/account-status?email=someone@example.com"
app.get('/v1/account-status', requireStaff('account status'), async (req, res) => {
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

app.all('/v1/mail-status', requireStaff('mail status'), async (req, res) => {

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

    // The one thing this could not previously answer. A key can be set, the
    // send can be accepted, and nothing arrives, because the sending domain is
    // not verified at the provider: no dkim signature, no spf pass, and every
    // inbox that matters drops the message without a bounce. That is a dns
    // fact, not a code fact, so it is read back from the provider rather than
    // guessed at from here.
    state.domains = await mailer.domainStatus();

    // sending is a side effect, so it needs POST: a token that leaks into a url
    // must not be firable by an <img src> or a link preview bot.
    if (req.method !== 'POST' || String(req.query.send || '') !== '1') {
        return res.json({ state, hint: 'POST with &send=1 to send a test message, &to= to choose the inbox' });
    }

    try {
        const result = await mailer.send({
            to: String(req.query.to || '').trim() || undefined,
            subject: 'sentinelpay mail test',
            eyebrow: 'diagnostics',
            title: 'mail is working',
            intro: 'this message was sent by /v1/mail-status, so delivery from the server is fine.',
            pairs: [['sent at', new Date().toISOString()], ['from', mailer.MAIL_FROM], ['to', String(req.query.to || '').trim() || mailer.MAIL_TO]],
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
            // This says so plainly, and that is a decision rather than an oversight.
            //
            // The careful version answers exactly as it does for a new address and
            // sends the owner a note instead, so that a stranger cannot learn who
            // banks here by typing addresses into the form. The cost is that the
            // person in front of it is shown a box for a code that will never
            // arrive, and is sent mail they did not ask for and cannot act on.
            //
            // The secret was never well kept anyway: sign-in and password reset
            // have to distinguish a known address from an unknown one, so anyone
            // who wants the answer can have it there. What actually limits the
            // guessing is the rate limit above, five attempts an hour from one
            // address, which is the same wall either way.
            //
            // So the honest answer wins: the tab says the address is taken, no
            // mail goes out, and nobody waits for a code that was never sent.
            console.log('[auth] register: address already has an account, said so');
            return res.status(409).json({ error: 'that email address already has an account. try logging in instead.' });
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
        res.json({ ok: true, next: 'verify', expiresInMin: started.expiresInMin });
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
        if (!again.ok) return res.json({ ok: true, expiresInMin: accounts.status().codeTtlMinutes });

        try {
            await mailer.sendSignupCode({ to: email, code: again.code, lang: again.lang, minutes: again.expiresInMin });
        } catch (mailErr) {
            console.error('[auth resend mail failed]', mailErr.code || '', mailErr.message);
            return res.status(500).json({ error: 'could not send the code. please try again shortly.' });
        }
        res.json({ ok: true, sendsLeft: again.sendsLeft, expiresInMin: again.expiresInMin });
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
        const ref = submissions.record('account', req, { email, name: out.name, lang: out.lang }, 'created');

        // best effort, and never allowed to fail the sign-up: the account exists
        try {
            await notifyInternally({
                kind: 'account',
                ref,
                country: req.headers['cf-ipcountry'],
                lang: out.lang,
                flags: [],
                subject: 'a new account',
                eyebrow: 'accounts',
                title: 'somebody created an account',
                intro: 'the address was verified by code before the account was written.',
            });
        } catch (notifyErr) {
            console.error('[auth verify notify failed]', notifyErr.message);
        }

        // signed in from here. the panel that follows is a real signed-in state
        // rather than a promise to email them when one exists.
        if (out.session) setSessionCookie(res, out.session.token, out.session.maxAgeSeconds);
        else console.error('[auth] the account was made but no session could be opened');

        res.json({ ok: true, signedIn: Boolean(out.session), name: out.name });
    } catch (err) {
        console.error('[auth verify error]', err.message);
        res.status(500).json({ error: 'could not create the account right now. please try again shortly.' });
    }
});

// Signing in with a password. The reply says nothing about which half was
// wrong, and accounts.signIn takes the same time either way.
// ---------------------------------------------------------------------------
// what we tell ourselves when something comes in
// ---------------------------------------------------------------------------
//
// Not who it was. The shared inbox is a second copy of everything the database
// holds, outside the encryption, outside the retention sweep, and outside the
// reach of `/v1/forget`: erasing somebody from the database left their name and
// address sitting in `support@` for ever, which made the deletion a half truth
// and the privacy policy a promise we were not keeping.
//
// So the notification carries the reference, the country, and whether anything
// needs a look. That is enough to decide whether to open it now or after lunch.
// Everything else is one click away, in the one place that is encrypted, swept
// and erasable.
//
// The reply-to went with it. Hitting reply used to answer the person directly,
// which was convenient and was also the address arriving in the mailbox by
// another door.
function notifyInternally({ kind, ref, country, lang, flags, subject, eyebrow, title, intro }) {
    const site = 'https://sentinelpay.org';
    return mailer.send({
        subject: (flags && flags.length ? 'review: ' : '') + subject + (ref ? ' (' + ref + ')' : ''),
        eyebrow,
        title,
        intro,
        review: reviewNotes(flags || []),
        pairs: [
            ['reference', ref || 'not recorded'],
            ['kind', kind],
            ['country', country || 'unknown'],
            ['language', lang || 'en'],
            ['domain check', flags && flags.length ? flags.join(', ') : 'passed'],
        ],
        bullets: [
            'the name, the address and everything else are in the inbox, not in this message.',
            'open ' + site + '/v1/inbox?ref=' + (ref || '') + ' and reply from there.',
        ],
    });
}

app.post('/v1/auth/login', requireCloudflareOrigin, authLoginLimiter, async (req, res) => {
    try {
        const b = req.body || {};
        const email = String(b.email || '').trim().toLowerCase().slice(0, 160);
        const password = typeof b.password === 'string' ? b.password : '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) {
            return res.status(400).json({ error: 'that email and password do not match an account.' });
        }
        if (!db.available()) {
            return res.status(503).json({ error: 'accounts are not available right now. please try again shortly.' });
        }

        const out = await accounts.signIn(email, password);
        if (out.reason === 'bad-credentials') {
            console.log('[auth] login: refused');
            return res.status(401).json({ error: 'that email and password do not match an account.' });
        }
        if (!out.ok) return res.status(503).json({ error: 'accounts are not available right now. please try again shortly.' });

        console.log('[auth] login: signed in');
        setSessionCookie(res, out.session.token, out.session.maxAgeSeconds);
        res.json({ ok: true, name: out.name });
    } catch (err) {
        console.error('[auth login error]', err.message);
        res.status(500).json({ error: 'could not sign you in right now. please try again shortly.' });
    }
});

// Signing out. The row goes, so the token is dead everywhere and not merely
// forgotten by this browser.
app.post('/v1/auth/logout', requireCloudflareOrigin, async (req, res) => {
    try {
        await accounts.endSession(readCookie(req, SESSION_COOKIE));
    } catch (err) {
        console.error('[auth logout error]', err.message);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
});

// Who is signed in. The navigation asks this on every page so it can show the
// right thing, so it answers 200 with `signedIn: false` rather than 401: not
// being signed in is an ordinary answer here, not a failure.
app.get('/v1/auth/me', async (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    try {
        const me = await currentUser(req);
        if (!me) return res.json({ signedIn: false });
        // the dashboard shows the staff panel from this, and nothing more than
        // the panel depends on it: every page behind it checks for itself.
        const staff = staffList().includes(String(me.email || '').toLowerCase());
        res.json({ signedIn: true, name: me.name, email: me.email, since: me.since, staff });
    } catch (err) {
        console.error('[auth me error]', err.message);
        res.json({ signedIn: false });
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
        const ref = submissions.record('trial', req, {
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
            await notifyInternally({
                kind: 'trial',
                ref,
                country,
                lang,
                flags,
                subject: 'a new trial sign-up',
                eyebrow: 'free trial',
                title: 'a company signed up for the trial',
                intro: flags.length
                    ? 'the welcome email has been sent to them, but something here is worth a second look.'
                    : 'the domain check passed and the welcome email has been sent to them.',
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

        const ref = submissions.record('demo', req, {
            name: `${firstName} ${lastName}`,
            email, company, website, jobTitle, industry, formCountry: country,
            size, volume, solutions, message,
            flags: flags,
        }, 'accepted');

        try {
            await notifyInternally({
                kind: 'demo',
                ref,
                country,
                lang: b.lang,
                flags,
                subject: 'a new demo request',
                eyebrow: 'demo request',
                title: 'someone asked for a demo',
                intro: 'sent from the demo form on sentinelpay.org.',
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
