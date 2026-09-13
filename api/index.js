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
const breached = require('./breached');
const totp = require('./totp');
const { PostgresStore, ipKey, startSweep: startRateSweep } = require('./rate-store');

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
const LOGIN_TURNSTILE = String(process.env.LOGIN_TURNSTILE || 'true').trim().toLowerCase() !== 'false';
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
    // the csp says frame-ancestors 'none'; this is the same answer for anything
    // that reads the older header, and the two disagreeing is how somebody ends
    // up trusting the weaker one
    frameguard: { action: 'deny' },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // a window this page opened, and a window that opened this page, cannot
    // reach into it. allow-popups rather than plain same-origin because the chat
    // widget opens its own windows and they have to keep working.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
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

// ---------------------------------------------------------------------------
// where the request says it came from
// ---------------------------------------------------------------------------
//
// The session cookie is SameSite=Lax and the body parser only reads
// application/json, which together already mean a form on somebody else's site
// cannot make a request here that this server will both read and authenticate.
// This is the second lock on the same door, and it is here because the first one
// is a browser default: a browser that gets SameSite wrong, an old one, or a
// future change in how Lax is interpreted should not be the only thing standing
// between a stranger's page and an endpoint that changes an account.
//
// Sec-Fetch-Site is sent by every current browser and cannot be set by script.
// When it says the request came from another site, it is refused. When it is
// absent, the Origin header is checked instead, and when that is absent too the
// request is allowed: curl and a mobile app send neither, and neither carries a
// cookie a browser attached on their behalf, so there is no cross-site request
// to forge.
app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

    const fetchSite = String(req.get('sec-fetch-site') || '').toLowerCase();
    if (fetchSite) {
        if (fetchSite === 'same-origin' || fetchSite === 'same-site' || fetchSite === 'none') return next();
        console.warn('[origin] refused a ' + req.method + ' from ' + fetchSite + ' to ' + req.path);
        return res.status(403).json({ error: 'That request did not come from our site. Please reload the page and try again.' });
    }

    const origin = req.get('origin');
    if (!origin) return next();
    if (sameSite(origin, req.headers.host)) return next();
    if (allowedOrigins.includes(origin)) return next();
    console.warn('[origin] refused a ' + req.method + ' from ' + origin + ' to ' + req.path);
    return res.status(403).json({ error: 'That request did not come from our site. Please reload the page and try again.' });
});

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
// the application dashboard: on wherever it is asked for, and on staging by
// default, because that is where it is being built
const DASHBOARD_NEXT = String(process.env.DASHBOARD_NEXT || (IS_STAGING ? 'true' : 'false'))
    .trim().toLowerCase() === 'true';
// reachable through /dashboard and nowhere else
const DASHBOARD_PAGES = ['dashboard.html', 'dashboard-next.html'];

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

// `cache` is for the one page whose url carries a secret. it is a parameter
// rather than a header the route sets beforehand, because this function used to
// overwrite whatever was already there, and reading the existing value instead
// would have quietly changed the homepage too: it sets no-store on the geo path
// and has been served no-cache ever since.
function sendPage(res, req, file, status, forcedLang, cache) {
    res.status(status || 200)
        .set('Cache-Control', cache || 'no-cache')
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
    keyGenerator: (req) => `all:${ipKey(req.realIp)}`,
    message: { error: 'Too many requests, please slow down' }
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

// ---------------------------------------------------------------------------
// where to send a security report
// ---------------------------------------------------------------------------
//
// RFC 9116. It exists so that somebody who finds a hole in this site has an
// obvious place to send it instead of guessing at an address, giving up, or
// putting it on twitter. For a company that sells security, not having one is a
// statement in itself.
//
// The expiry is a year out, computed rather than written down, because a stale
// security.txt is worse than none: it says the contact was true once.
app.get(['/.well-known/security.txt', '/security.txt'], (req, res) => {
    const year = new Date();
    year.setUTCFullYear(year.getUTCFullYear() + 1);
    res.type('text/plain; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send([
        '# Found something wrong with this site? Please tell us.',
        '# We will answer, we will not send lawyers, and we will credit you if you want it.',
        '',
        'Contact: mailto:security@sentinelpay.org',
        'Contact: https://sentinelpay.org/book-a-demo',
        'Expires: ' + year.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        'Preferred-Languages: en, hr, de',
        'Canonical: https://sentinelpay.org/.well-known/security.txt',
        '',
        '# In scope: sentinelpay.org and its subdomains, and the accounts api under /v1.',
        '# Out of scope: reports from automated scanners with no working proof,',
        '# rate limits, missing headers with no exploit, and anything requiring',
        '# physical access or a compromised device.',
        '# Please do not run load tests, and please do not touch other people\'s accounts:',
        '# ask us for a test account instead.',
        '',
    ].join('\n'));
});

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
                    '06': 'blog-article-6.html',
                    // legacy slug aliases (keep old links working)
                    'why-criminals-target-small-businesses': 'blog-article.html',
                    'real-time-aml-why-timing-matters': 'blog-article-2.html',
                    'compliance-without-becoming-a-bank': 'blog-article-3.html',
                    'we-dont-do-gambling': 'blog-article-4.html',
                    'wallet-screening-vs-kyc': 'blog-article-5.html',
                    'explain-the-score': 'blog-article-6.html',
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
    // the query comes along. it used to be dropped here, which was harmless
    // while nothing carried one; ?signin= is read by the page this redirects to,
    // and losing it would send somebody who asked for the sign-in dialog to a
    // homepage with no dialog on it.
    const rest = req.originalUrl.indexOf('?');
    return res.redirect(302, '/' + lang + (rest === -1 ? '' : req.originalUrl.slice(rest)));
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
// /auth was a whole page carrying a second copy of the sign-in card: the same
// two forms, the same panels, the same copy, kept in step by hand. Everything it
// did is the dialog now, which is where every other thing about an account
// already happens, so the page is deleted rather than maintained twice.
//
// The url keeps working. It is in bookmarks, in browser history, in the address
// bar of anybody who typed it once, and answering 404 to all of them to make a
// point about tidiness would be a worse site. It carries the same signin value
// the links do, so /auth#create still arrives on the create-account tab.
app.get('/auth', (req, res) => {
    const which = String(req.query.signin || '').toLowerCase();
    const want = ['create', 'reset'].includes(which) ? which : '1';
    return res.redirect(301, '/?signin=' + want);
});

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
        if (!me) return res.redirect(302, '/?signin=1');
    } catch (err) {
        console.error('[dashboard guard]', err.message);
        return res.redirect(302, '/?signin=1');
    }
    // no store rather than no cache: a signed-in page must not sit in a shared
    // cache or come back from the back button after signing out
    res.set('Cache-Control', 'no-store, private');

    // Two dashboards, one flag.
    //
    // The new one is a working application: a rail, ten screens, a screening
    // result with a verdict and a decision on it. Everything in it is sample
    // data until the engine exists, so it is not what a customer should be
    // shown on the live site yet. The old page is the account: the password,
    // the sessions, the second factor, the erasure. Those are real and they
    // stay real on both.
    //
    // So production serves the account page and staging serves the application,
    // out of the same branch. The alternative was a branch that only exists on
    // staging, which diverges within a week and then every push to production
    // is a decision somebody has to remember to get right.
    //
    // DASHBOARD_NEXT=true turns the new one on anywhere, which is how it goes
    // live the day the engine is behind it.
    if (DASHBOARD_NEXT) return sendPage(res, req, 'dashboard-next.html', 200, undefined, 'no-store, private');
    return next();
});

// The reset page is checked before it is drawn. A dead link then lands on the
// page that explains it rather than on a form that looks fine and refuses on
// submit, and there is no moment where a working form is on screen for a token
// that was already spent.
//
// The token is in the query string, which means it is in this server's access
// log and in the browser's history. That is true of every reset link anywhere
// and is why the token is worth so little on its own: it lives an hour, it
// works once, and using it ends every session the account had. The page also
// takes it out of the address bar once it has read it.
app.get('/reset-password', async (req, res) => {
    // belt and braces on the query string. helmet already sends no-referrer for
    // the site, and this page is the one where it actually matters, so it says
    // so itself rather than depending on a default staying the default.
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    try {
        const token = String(req.query.token || '');
        if (!token) return res.redirect(302, '/token-expired');
        const found = await accounts.readReset(token);
        if (!found) return res.redirect(302, '/token-expired');
        // the homepage, with the dialog opening over it. the link used to land on
        // a page of its own, which meant a second screen carrying the same card,
        // the same panels and the same copy, kept in step by hand. the dialog is
        // where everything else about an account already happens, so the mail
        // sends people there and an inline script in index.html turns the token
        // into an open panel and a clean address bar.
        //
        // no-store rather than no-cache: the url holds the token, and no-cache
        // still allows the browser to write it to disk.
        return sendPage(res, req, 'index.html', 200, undefined, 'no-store, private');
    } catch (err) {
        console.error('[reset page error]', err.message);
        return res.redirect(302, '/token-expired');
    }
});

// The signed-in pages by their file name: not found.
//
// This has to be a route rather than a check inside the renderer, because when
// the renderer declines, express.static is next in line and it will happily
// serve any file in public/. /dashboard is the door and it checks the cookie.
app.get(['/dashboard.html', '/dashboard-next.html'], (req, res) => {
    return sendPage(res, req, '404.html', 404);
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
    // the signed-in pages have one door, and it is /dashboard, which checks the
    // cookie first. asking for the file by name walked straight past that: the
    // page itself is only markup and the api behind it refuses anyway, but a
    // half-built product sitting on a public url is a thing people find, link
    // to and screenshot.
    if (DASHBOARD_PAGES.indexOf(file.toLowerCase()) !== -1) return next();
    const full = path.join(__dirname, 'public', file);
    if (!fsSync.existsSync(full)) return next();
    return sendPage(res, req, file);
});

// Serve the static marketing site (/, /privacy-policy, /tos, assets).
// Long-lived, immutable caching for media/fonts so Cloudflare's edge and the
// browser both keep them (images update via a new filename or ?v= query).
// html is never cached hard, so page edits always go live immediately.
// Versioned asset filenames: /corp.238.css is served from public/corp.css.
//
// Cache busting with a query string, /corp.css?v=238, is the usual way and it
// has one weakness that is not theoretical: a cache in front of us is free to
// key on the path alone. Cloudflare has a setting for exactly that, some
// corporate proxies do it unconditionally, and when one does, a new ?v= is a
// new url to us and the same old bytes to it. What comes back then is not an
// error anybody notices: it is last week's stylesheet, or last week's
// dictionary, rendering a page that is otherwise current. That is a bad failure
// because it looks like a bug in the page rather than a stale file.
//
// A version in the filename cannot be ignored by anything, because there is no
// part of it to strip. This maps the versioned name back to the real file and
// leaves everything else alone.
//
// Images are in here too now, and they were left out for a reason that turned
// out to be wrong. The thinking was that a cover never changes, so it never
// needs a new url. What actually happens is that a cover arrives late: the
// article ships, the page asks for a cover that is not there yet, and the miss
// is what gets cached. Cloudflare answers a 404 for a static extension with its
// own four hour browser ttl, whatever this origin says, so for four hours after
// the file lands the people who visited early are still being told it does not
// exist, and the fallback script dutifully removes the image. A version in the
// name makes the url new, and nothing has a cached answer for a url it has
// never been asked about.
//
// The path may have directories in it (/covers/name.1.webp). Each segment is
// still letters, digits and hyphens only, so there is no dot to build a `..`
// out of and this cannot address anything above public/.
app.use((req, res, next) => {
    const m = req.path.match(/^\/((?:[a-z0-9-]+\/)*[a-z0-9-]+)\.(\d+)\.(css|js|png|jpe?g|webp|gif|svg|avif)$/i);
    if (m) req.url = '/' + m[1] + '.' + m[3];
    next();
});

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
    keyGenerator: (req) => `demo_request:${ipKey(req.realIp)}`,
    store: new PostgresStore(),
    message: { error: 'Too many requests, please try again later' }
});

// Rate-limit trial sign-ups harder than demo requests: a trial grants access,
// so a burst from one IP is worth more to an abuser. 3 / hour / IP.
const trialRequestLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `trial_request:${ipKey(req.realIp)}`,
    store: new PostgresStore(),
    message: { error: 'Too many requests, please try again later' }
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
const COOKIE_SECURE = process.env.NODE_ENV === 'production';
// The __Host- prefix is a promise the browser enforces rather than a name: it
// refuses to store the cookie unless it is Secure, has no Domain, and is pathed
// at the root. That closes cookie fixing from a subdomain, which nothing else
// here can: a script on any sibling of sentinelpay.org could otherwise set a
// session cookie for the whole site.
//
// It needs Secure, and Secure needs https, which a developer's own machine does
// not have, so the plain name is used there. The old name is still read for as
// long as sessions opened under it can live, so nobody is signed out by a
// rename: written under the new name, accepted under either.
const SESSION_COOKIE = COOKIE_SECURE ? '__Host-sp_session' : 'sp_session';
const SESSION_COOKIE_OLD = 'sp_session';

function readCookie(req, name) {
    const raw = String(req.headers.cookie || '');
    const m = raw.match(new RegExp('(?:^|;\\s*)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
}

function readSessionCookie(req) {
    return readCookie(req, SESSION_COOKIE) || readCookie(req, SESSION_COOKIE_OLD);
}

function setSessionCookie(res, token, maxAgeSeconds) {
    res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: COOKIE_SECURE,
        sameSite: 'lax',
        path: '/',
        // the hard stop, not the idle window. the session also dies after a week
        // of not being used, and the cookie cannot know that: it is not renewed
        // per request, so pinning it to the idle window would sign out somebody
        // who has been here every day. a cookie that outlives its session costs
        // one refused request; the other way round costs a sign-in a week.
        maxAge: maxAgeSeconds * 1000,
    });
}

function clearSessionCookie(res) {
    const opts = { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'lax', path: '/' };
    res.clearCookie(SESSION_COOKIE, opts);
    if (SESSION_COOKIE !== SESSION_COOKIE_OLD) res.clearCookie(SESSION_COOKIE_OLD, opts);
}

// The browser that started a sign-up.
//
// Short lived, httpOnly, and it holds a random value whose hash is on the
// pending row. Verify will not finish a sign-up without it, which is what stops
// somebody starting a sign-up on an address that is not theirs and letting the
// owner's code finish it into an account with the starter's password.
const SIGNUP_COOKIE = COOKIE_SECURE ? '__Host-sp_signup' : 'sp_signup';

function setSignupCookie(res, value, seconds) {
    res.cookie(SIGNUP_COOKIE, value, {
        httpOnly: true,
        secure: COOKIE_SECURE,
        sameSite: 'lax',
        path: '/',
        maxAge: seconds * 1000,
    });
}

function clearSignupCookie(res) {
    res.clearCookie(SIGNUP_COOKIE, {
        httpOnly: true, secure: COOKIE_SECURE, sameSite: 'lax', path: '/',
    });
}

// Whoever is signed in, or null. Attached by the routes that need it rather
// than by a global middleware: a database round trip on every request for a
// static page is a cost with nothing to show for it.
async function currentUser(req) {
    const token = readSessionCookie(req);
    if (!token) return null;
    return accounts.readSession(token);
}

const authRegisterLimiter = rateLimit({
    handler: limitHandler,
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `auth_register:${ipKey(req.realIp)}`,
    store: new PostgresStore(),
    message: { error: 'Too many attempts, please try again later' }
});
// Guessing is the attack here, and a six digit code has a million answers. Twenty
// tries an hour per ip on top of five per sign-up leaves nothing worth trying.
const authVerifyLimiter = rateLimit({
    handler: limitHandler,
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `auth_verify:${ipKey(req.realIp)}`,
    store: new PostgresStore(),
    message: { error: 'Too many attempts, please try again later' }
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
    keyGenerator: (req) => `auth_login:${ipKey(req.realIp)}`,
    store: new PostgresStore(),
    message: { error: 'Too many attempts, please try again later' }
});
// A resend button is a button that sends mail to somebody else's inbox on demand.
const authResendLimiter = rateLimit({
    handler: limitHandler,
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `auth_resend:${ipKey(req.realIp)}`,
    store: new PostgresStore(),
    message: { error: 'Too many attempts, please try again later' }
});
// Asking for a reset link posts mail to an address the sender chooses, which is
// the whole shape of a mail bomb. There is a second ceiling on the address
// itself inside accounts, because an attacker with a list of proxies gets a
// fresh ip whenever they like and the person being mailed only has one inbox.
const authForgotLimiter = rateLimit({
    handler: limitHandler,
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `auth_forgot:${ipKey(req.realIp)}`,
    store: new PostgresStore(),
    message: { error: 'Too many attempts, please try again later' }
});
// Setting the password from a link. The token is 32 random bytes, so guessing
// is not the risk; this is here so a script cannot sit on the endpoint.
const authResetLimiter = rateLimit({
    handler: limitHandler,
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `auth_reset:${ipKey(req.realIp)}`,
    store: new PostgresStore(),
    message: { error: 'Too many attempts, please try again later' }
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
    // header only. ?token= used to work as well, and a query string is written
    // to every access log, proxy log and browser history it passes through: the
    // one credential that bypasses accounts entirely should not be the one
    // thing sitting in a log line.
    const provided = String(req.get('x-admin-token') || '');
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
// 2fa on the staff pages can be turned off, and the switch exists for exactly
// one reason: the first person to set it up needs to be able to reach the pages
// while doing so, and a mistake here otherwise means nobody can read the inbox
// until a deploy. It defaults to on.
const STAFF_REQUIRE_2FA = String(process.env.STAFF_REQUIRE_2FA || 'true').trim().toLowerCase() !== 'false';

function staffList() {
    return String(process.env.STAFF_EMAILS || '')
        .split(',')
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean);
}

// Staff means three things, not one: the address is on the list, the account has
// a second factor, and this session was opened with it.
//
// The last one matters more than it looks. Without it, somebody who was already
// signed in when 2fa was switched on keeps the old privileges for as long as
// their session lasts, which is a month, and the person who switched it on
// believes it took effect immediately.
//
// A staff address without 2fa is not refused silently: `reason` says which of
// the three failed, so the page can say "set it up" instead of pretending the
// admin pages do not exist.
async function staffOf(req) {
    const list = staffList();
    if (!list.length) return null;
    const me = await currentUser(req);
    if (!me || !me.email) return null;
    if (!list.includes(String(me.email).toLowerCase())) return null;
    if (STAFF_REQUIRE_2FA && !me.totpOn) return { ...me, blocked: 'no-2fa' };
    if (STAFF_REQUIRE_2FA && !me.mfa) return { ...me, blocked: 'session-without-2fa' };
    return me;
}

// Answers with who it was, so the caller can both allow the request and say in
// the log whose it was. `null` means no.
async function whoIsAsking(req) {
    const me = await staffOf(req);
    if (me && !me.blocked) return { kind: 'staff', who: me.email, name: me.name };
    if (adminOk(req)) return { kind: 'token', who: 'admin token' };
    if (me && me.blocked) return { kind: 'blocked', who: me.email, why: me.blocked };
    return null;
}

// The gate every admin page goes through. A refusal is a 404 rather than a 403:
// a page that answers "forbidden" has told a stranger it exists.
function requireStaff(action) {
    return async (req, res, next) => {
        const asking = await whoIsAsking(req);
        // a staff address that has not set up a second factor yet, or is on a
        // session that was opened before it did. this is the one case that is
        // answered rather than hidden: the person is who they say they are, and
        // telling them nothing is here would send them looking for a bug.
        if (asking && asking.kind === 'blocked') {
            accounts.audit('staff-access-refused', {
                actor: 'staff:' + asking.who, ip: ipKey(req.realIp), detail: asking.why + ' -> ' + action,
            });
            res.set('Cache-Control', 'no-store, private');
            return res.status(403).type('html').send(
                '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
                '<title>two-factor required</title>' +
                '<body style="margin:0;padding:48px 20px;background:#f4f6fa;color:#0e2358;' +
                'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif;">' +
                '<div style="max-width:520px;margin:0 auto;">' +
                '<h1 style="font-size:20px;font-weight:800;margin:0 0 10px;">Two-factor is required here</h1>' +
                '<p style="margin:0 0 14px;line-height:1.6;color:rgba(14,35,88,0.7);font-size:14px;">' +
                (asking.why === 'no-2fa'
                    ? 'This address is on the staff list, but the account has no second factor yet. The staff pages read other people\'s personal data, so a password on its own is not enough to open them.'
                    : 'This session was opened before the second factor was switched on. Sign out and back in, and you will be asked for a code.') +
                '</p>' +
                '<p style="margin:0;font-size:14px;"><a href="/dashboard" style="color:#1c4ed8;">Go to the dashboard</a></p>' +
                '</div></body>');
        }
        if (!asking) return sendPage(res, req, '404.html', 404);
        req.staff = asking;
        // the point of the whole exercise: looking at somebody's details is an
        // event, and events have a name on them.
        //
        // the line to stdout stays, because it is what you watch while something
        // is going wrong. the row is what answers the question three months
        // later, which is when it is actually asked.
        console.log('[staff] ' + asking.kind + ' ' + asking.who + ' -> ' + action +
            (req.query.ref ? ' ref=' + String(req.query.ref).slice(0, 32) : ''));
        accounts.audit('staff-access', {
            actor: asking.kind + ':' + asking.who,
            subject: req.query.ref ? String(req.query.ref).slice(0, 120) : null,
            ip: ipKey(req.realIp),
            detail: action,
        });
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
    if (!email || email.length > 254) return res.status(400).json({ error: 'Please enter your email address.' });
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
    // the links carry no credential. the admin token is a header now, and a
    // signed-in staff member does not need one at all: the session is what
    // opened this page and it is what follows the link.
    const link = (t, l) => '/v1/mail-preview?t=' + encodeURIComponent(t) + '&lang=' + l;

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
        '</div><script src="/inbox.js?v=2"></script></body>');
});

// The same list, for whoever is signed in as staff. No values, only whether a
// thing is on: the point is to be able to answer "is production actually
// configured the way we think" without reading somebody's dashboard over their
// shoulder.
app.get('/v1/security-status', requireStaff('security status'), (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    const checks = securityPosture().map((c) => ({ check: c.key, ok: c.ok, serious: c.grave, detail: c.says }));
    if (String(req.query.format || '') === 'json') return res.json({ ok: checks.every((c) => c.ok), checks });
    res.set('Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; style-src-attr 'unsafe-inline'; form-action 'none'");
    res.type('html').send(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<meta name="robots" content="noindex,nofollow"><title>security status</title>' +
        '<body style="margin:0;padding:32px 18px 64px;background:#f4f6fa;' +
        'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif;color:#0e2358;">' +
        '<div style="max-width:760px;margin:0 auto;">' +
        '<h1 style="font-size:20px;font-weight:800;margin:0 0 4px;">security status</h1>' +
        '<p style="margin:0 0 18px;color:rgba(14,35,88,0.6);font-size:13px;">' +
        'what this deploy is actually running with. no values, only whether something is on.</p>' +
        checks.map((c) =>
            '<div style="padding:10px 0;border-bottom:1px solid rgba(14,35,88,0.08);">' +
            '<span style="font-weight:700;color:' + (c.ok ? '#0f7b4f' : (c.serious ? '#b3261e' : '#8a6d00')) + ';">' +
            (c.ok ? 'ok' : (c.serious ? 'SERIOUS' : 'note')) + '</span> ' +
            '<b>' + escapeHtml(c.check) + '</b><br>' +
            '<span style="font-size:13px;color:rgba(14,35,88,0.65);">' + escapeHtml(c.detail) + '</span></div>').join('') +
        '</div></body>');
});

// The audit trail, read back.
//
// Everything security-shaped writes a row: sign-ins, refusals, resets, sign-ups,
// and every time somebody with a staff account opened a lead. This is where that
// is read, because a trail nobody can read is a trail nobody checks.
//
// No names and no addresses on this page. The subject column is a blind index,
// which is the same thing every other table here is keyed by: enough to follow
// one account through a week, and nothing at all on its own.
app.get('/v1/audit', requireStaff('audit trail'), async (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.set('Referrer-Policy', 'no-referrer');
    const rows = await accounts.recentAudit({
        limit: Number(req.query.limit) || 200,
        kind: String(req.query.kind || ''),
        subject: String(req.query.subject || ''),
    });
    if (String(req.query.format || '') === 'json') return res.json({ rows });

    res.set('Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; style-src-attr 'unsafe-inline'; form-action 'none'");
    const cell = (v) => '<td style="padding:6px 12px 6px 0;white-space:nowrap;">' + escapeHtml(v == null ? '' : String(v)) + '</td>';
    const body = rows.map((r) =>
        '<tr>' +
        cell(new Date(r.at).toISOString().replace('T', ' ').slice(0, 19)) +
        cell(r.kind) +
        cell(r.actor) +
        cell(r.subject ? String(r.subject).slice(0, 12) : '') +
        cell(r.ip) +
        cell(r.detail) +
        '</tr>').join('');
    res.type('html').send(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<meta name="robots" content="noindex,nofollow"><title>audit</title>' +
        '<body style="margin:0;padding:32px 18px 64px;background:#f4f6fa;' +
        'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif;color:#0e2358;">' +
        '<div style="max-width:1100px;margin:0 auto;">' +
        '<h1 style="font-size:20px;font-weight:800;margin:0 0 4px;">audit</h1>' +
        '<p style="margin:0 0 18px;color:rgba(14,35,88,0.6);font-size:13px;">' +
        'sign-ins, refusals, resets and every staff look at a lead. ' + rows.length + ' event(s), newest first. ' +
        'the subject column is a blind index, not an address. add ?format=json for the raw rows.</p>' +
        '<table style="border-collapse:collapse;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">' +
        '<tr style="text-align:left;color:#94a0bd;">' +
        ['when (utc)', 'kind', 'actor', 'subject', 'network', 'detail']
            .map((h) => '<th style="padding:0 12px 8px 0;font-weight:600;">' + h + '</th>').join('') +
        '</tr>' + body + '</table>' +
        '</div></body>');
});

// What the account store knows about one address. Same token gate, same 404 when
// it is wrong. It exists because the sign-up form cannot tell you why no code
// arrived without telling every stranger who has an account here, so the answer
// lives behind the admin token instead.
//     curl -H "x-admin-token: ..." "https://sentinelpay.org/v1/account-status?email=someone@example.com"
app.get('/v1/account-status', requireStaff('account status'), async (req, res) => {
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!email || email.length > 254) return res.status(400).json({ error: 'Please enter your email address.' });
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
    if (typeof password !== 'string' || password.length < 12) return 'Your password needs at least 12 characters.';
    if (password.length > 200) return 'Your password needs at least 12 characters.';
    const low = password.toLowerCase();
    const local = String(email || '').split('@')[0].toLowerCase();
    const parts = [local, String(email || '').toLowerCase(), String(firstName || '').toLowerCase(), String(lastName || '').toLowerCase(), 'sentinelpay']
        .filter((p) => p && p.length >= 4);
    if (parts.some((p) => low.includes(p))) return 'Please choose a password that is not your name or email';
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
            return res.status(400).json({ error: 'Verification failed, please try again' });
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
            return res.status(400).json({ error: 'Invalid submission' });
        }
        const pwProblem = passwordProblem(password, email, firstName, lastName);
        if (pwProblem) return res.status(400).json({ error: pwProblem });
        // and then the one rule that is not about shape: has this password
        // already been in a breach. it is checked without the password leaving
        // this process, and a check that cannot run lets the sign-up through.
        if (await breached.isBreached(password)) {
            return res.status(400).json({ error: 'That password has appeared in a data breach. Please choose a different one.' });
        }

        if (!db.available()) {
            return res.status(503).json({ error: 'Accounts are not available right now. Please try again shortly.' });
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
            return res.status(409).json({ error: 'That email address already has an account. Try logging in instead.' });
        }
        if (started.reason === 'slow-down') {
            console.log('[auth] register: a code went out less than a minute ago, asked them to wait');
            return res.status(429).json({ error: 'A code was just sent. Check your inbox, or ask for another in a minute.', retryIn: started.retryIn });
        }
        if (started.reason === 'too-many-sends') {
            console.log('[auth] register: this address is at its hourly send ceiling');
            return res.status(429).json({ error: 'Too many codes sent to this address. Please try again later.' });
        }
        if (!started.ok) {
            console.error('[auth] register: the account store is unavailable (' + (started.reason || 'no reason') + ')');
            return res.status(503).json({ error: 'Accounts are not available right now. Please try again shortly.' });
        }

        try {
            await mailer.sendSignupCode({ to: email, code: started.code, lang, minutes: started.expiresInMin });
        } catch (mailErr) {
            console.error('[auth register mail failed]', mailErr.code || '', mailErr.message);
            return res.status(500).json({ error: 'Could not send the code. Please try again shortly.' });
        }

        // the code itself is never written anywhere we can read: not here, not in
        // the row, not in the log line. the provider's message id is logged by the
        // mailer on the line above this one, which is the thread to pull on when
        // somebody says the code never arrived.
        console.log('[auth] register: code sent, flags: ' + (flags.join(',') || 'none'));
        // the proof that this browser is the one that started it. it outlives
        // the code by a minute so that a code entered on the last second still
        // has something to be checked against.
        if (started.origin) setSignupCookie(res, started.origin, (started.expiresInMin + 1) * 60);
        res.json({ ok: true, next: 'verify', expiresInMin: started.expiresInMin });
    } catch (err) {
        console.error('[auth register error]', err.message);
        res.status(500).json({ error: 'Could not create the account right now. Please try again shortly.' });
    }
});

app.post('/v1/auth/resend', requireCloudflareOrigin, authResendLimiter, async (req, res) => {
    try {
        const email = String((req.body && req.body.email) || '').trim().toLowerCase().slice(0, 160);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid submission' });
        if (!db.available()) return res.status(503).json({ error: 'Accounts are not available right now. Please try again shortly.' });

        const again = await accounts.resendSignup(email);
        if (again.reason === 'slow-down') {
            return res.status(429).json({ error: 'A code was just sent. Check your inbox, or ask for another in a minute.', retryIn: again.retryIn });
        }
        if (again.reason === 'too-many-sends') {
            return res.status(429).json({ error: 'Too many codes sent to this address. Please try again later.' });
        }
        // no pending sign-up and an expired one are both answered as if a code went
        // out: otherwise this endpoint tells anyone which addresses are mid sign-up
        if (!again.ok) return res.json({ ok: true, expiresInMin: accounts.status().codeTtlMinutes });

        try {
            await mailer.sendSignupCode({ to: email, code: again.code, lang: again.lang, minutes: again.expiresInMin });
        } catch (mailErr) {
            console.error('[auth resend mail failed]', mailErr.code || '', mailErr.message);
            return res.status(500).json({ error: 'Could not send the code. Please try again shortly.' });
        }
        res.json({ ok: true, sendsLeft: again.sendsLeft, expiresInMin: again.expiresInMin });
    } catch (err) {
        console.error('[auth resend error]', err.message);
        res.status(500).json({ error: 'Could not send the code. Please try again shortly.' });
    }
});

app.post('/v1/auth/verify', requireCloudflareOrigin, authVerifyLimiter, async (req, res) => {
    try {
        const b = req.body || {};
        const email = String(b.email || '').trim().toLowerCase().slice(0, 160);
        const code = String(b.code || '').replace(/\s+/g, '').slice(0, 6);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid submission' });
        if (!db.available()) return res.status(503).json({ error: 'Accounts are not available right now. Please try again shortly.' });

        const out = await accounts.verifySignup(email, code, readCookie(req, SIGNUP_COOKIE));
        if (out.reason === 'bad-origin') {
            // not a wrong code: a right code in the wrong browser. that is either
            // somebody who started the sign-up somewhere else, or somebody
            // finishing a sign-up they did not start, and the answer is the same
            // either way: start again here.
            console.log('[auth] verify: refused, the code was entered in a browser that did not start this sign-up');
            return res.status(400).json({ error: 'Please start the sign-up again in this browser, and we will send a new code.' });
        }
        if (out.reason === 'expired') {
            return res.status(400).json({ error: 'That code has expired. Ask for a new one.' });
        }
        if (out.reason === 'too-many-attempts') {
            return res.status(429).json({ error: 'Too many wrong codes. Ask for a new one.' });
        }
        if (out.reason === 'bad-code') {
            return res.status(400).json({ error: 'That code is not right. Check your email and try again.', attemptsLeft: out.attemptsLeft });
        }
        if (!out.ok) return res.status(503).json({ error: 'Accounts are not available right now. Please try again shortly.' });

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
        clearSignupCookie(res);
        if (out.session) setSessionCookie(res, out.session.token, out.session.maxAgeSeconds);
        else console.error('[auth] the account was made but no session could be opened');

        res.json({ ok: true, signedIn: Boolean(out.session), name: out.name });
    } catch (err) {
        console.error('[auth verify error]', err.message);
        res.status(500).json({ error: 'Could not create the account right now. Please try again shortly.' });
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

// ---------------------------------------------------------------------------
// "somebody signed in"
// ---------------------------------------------------------------------------
//
// Sent the first time an account is used from a given browser, and not again.
// A notice on every sign-in is a notice nobody reads, and the one that matters
// is the one that arrives on a morning you were not signing in anywhere.
//
// What identifies the browser is a keyed hash of what it says about itself plus
// the network it came from, computed in accounts.js. The strings themselves are
// not kept.
function whenFor(lang) {
    try {
        return new Intl.DateTimeFormat(lang === 'hr' ? 'hr-HR' : (lang === 'de' ? 'de-DE' : 'en-GB'), {
            dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
        }).format(new Date()) + ' (UTC)';
    } catch (err) {
        return new Date().toISOString().replace('T', ' ').slice(0, 16) + ' (UTC)';
    }
}

async function tellAboutNewDevice(req, out) {
    if (!out || !out.userId || !out.email) return;
    const fresh = await accounts.noteDevice(out.userId, [
        String(req.get('user-agent') || ''),
        String(req.get('accept-language') || ''),
        ipKey(req.realIp),
    ]);
    accounts.audit('login', {
        actor: out.userId,
        ip: ipKey(req.realIp),
        detail: fresh ? 'new device' : 'known device',
    });
    if (!fresh) return;
    await mailer.sendNewSignIn({
        to: out.email,
        lang: out.lang || 'en',
        when: whenFor(out.lang),
        ip: ipKey(req.realIp),
        country: req.headers['cf-ipcountry'] || '',
    });
}

app.post('/v1/auth/login', requireCloudflareOrigin, authLoginLimiter, async (req, res) => {
    try {
        const b = req.body || {};
        // the sign-in form was the last door without this. every other one has
        // had it for months, and this is the door a password list is tried on.
        //
        // it has its own switch, and only this one does. the widget renders
        // inside the sign-in panel, which is the one place a failure locks
        // somebody out of their own account rather than merely out of a form
        // they can come back to. LOGIN_TURNSTILE=false turns it off with a
        // restart and no deploy; everything else in front of this endpoint, the
        // per-address wait included, keeps working without it.
        if (LOGIN_TURNSTILE &&
            !(await verifyTurnstile(b['cf-turnstile-response'] || b.turnstileToken, req.realIp))) {
            return res.status(400).json({ error: 'Verification failed, please try again' });
        }
        const email = String(b.email || '').trim().toLowerCase().slice(0, 160);
        const password = typeof b.password === 'string' ? b.password : '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) {
            return res.status(400).json({ error: 'That email and password do not match an account.' });
        }
        if (!db.available()) {
            return res.status(503).json({ error: 'Accounts are not available right now. Please try again shortly.' });
        }

        const out = await accounts.signIn(email, password);
        if (out.reason === 'too-many-attempts') {
            // the address has earned a wait. the same answer, and the same wait,
            // whether or not there is an account behind it: a throttle that only
            // slowed down real accounts would answer the question the rest of
            // this endpoint refuses to.
            console.log('[auth] login: throttled');
            return res.status(429).json({
                error: 'Too many sign-in attempts. Please wait a moment and try again.',
                retryIn: out.retryIn,
            });
        }
        if (out.reason === 'totp-required') {
            // the password was right and that is now half of it. the pending
            // value is a five minute row, not a session: it can be exchanged for
            // one and can do nothing else.
            console.log('[auth] login: password ok, asking for the code');
            return res.json({ ok: true, totp: true, pending: out.pending });
        }
        if (out.reason === 'bad-credentials') {
            console.log('[auth] login: refused');
            return res.status(401).json({ error: 'That email and password do not match an account.' });
        }
        if (!out.ok) return res.status(503).json({ error: 'Accounts are not available right now. Please try again shortly.' });

        console.log('[auth] login: signed in');
        setSessionCookie(res, out.session.token, out.session.maxAgeSeconds);
        res.json({ ok: true, name: out.name });

        // and then, after the answer has gone: was this a browser this account
        // has used before, and if not, tell the owner. none of it is allowed to
        // hold up the sign-in or to fail it.
        tellAboutNewDevice(req, out).catch((err) =>
            console.error('[auth] new-device notice failed: ' + err.message));
    } catch (err) {
        console.error('[auth login error]', err.message);
        res.status(500).json({ error: 'Could not sign you in right now. Please try again shortly.' });
    }
});

// ---------------------------------------------------------------------------
// forgotten passwords
// ---------------------------------------------------------------------------
//
// Three endpoints and two pages. The rule that shapes all of them: this must
// not become a way of asking who has an account here. So the answer is `ok`
// whether the address is known, unknown, rate limited, or the database is down,
// and the timing does not give it away either, because the same work happens
// either way: a row is written and a mail is sent in both cases.
app.post('/v1/auth/forgot', requireCloudflareOrigin, authForgotLimiter, async (req, res) => {
    // The one thing that has to stay uniform is whether the address has an
    // account. That is the question this endpoint must never answer, and it
    // never does: nothing on this path reads the users table, so a known and an
    // unknown address take the same branches, do the same work and get the same
    // reply.
    //
    // Everything else is answered honestly, and that is a correction. Five
    // branches used to reply "on its way" for a message that was never sent: a
    // malformed address, a database that was down, a rate limit, a thrown error,
    // and a send that failed after the reply had already gone. None of those
    // depend on whether an account exists, so hiding them bought nothing and
    // cost somebody sitting in front of an inbox waiting for a mail that was
    // never coming.
    const sent = () => res.json({ ok: true, resendIn: accounts.RESET_RESEND_WAIT_S });
    try {
        const b = req.body || {};
        // a bot is the one caller that is answered with a fiction, and it is
        // told exactly what a person is told, which is the point of the trap
        if (typeof b.company_url === 'string' && b.company_url.trim() !== '') return sent();
        if (!(await verifyTurnstile(b['cf-turnstile-response'] || b.turnstileToken, req.realIp))) {
            return res.status(400).json({ error: 'Verification failed, please try again' });
        }

        const email = String(b.email || '').trim().toLowerCase().slice(0, 160);
        // the shape of what was typed, not whether we know it
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            // the shape of the refusal, never the address. an address that looks
            // perfectly ordinary to the person who typed it and is refused here
            // is either not arriving as typed or is carrying something invisible,
            // and those two need different fixes. this says which without writing
            // anybody's address into a log.
            console.warn('[auth] forgot: address refused (length ' + email.length +
                ', ' + (email.split('@').length - 1) + ' at-signs' +
                ', dot after at: ' + /@[^@]*\./.test(email) +
                ', codepoints outside ascii: ' + (email.match(/[^\x20-\x7e]/g) || []).length + ')');
            return res.status(400).json({ error: 'Please enter a valid email address.' });
        }
        if (!db.available()) {
            return res.status(503).json({ error: 'Accounts are not available right now. Please try again shortly.' });
        }

        const lang = ['hr', 'de', 'en'].includes(b.lang) ? b.lang : 'en';
        const started = await accounts.startReset(email, lang);

        if (!started.ok && started.reason === 'rate') {
            // a link for this address already went out, which is why this one
            // did not. `alreadySent` lets the panel say the true thing: the mail
            // is in the inbox, and here is when another can be asked for.
            console.log('[auth] forgot: not sent (cooling, ' + started.retryIn + 's)');
            res.set('Retry-After', String(started.retryIn));
            return res.status(429).json({
                error: 'A link is already on its way. Please check your inbox.',
                retryIn: started.retryIn,
                alreadySent: true,
            });
        }
        if (!started.ok) {
            console.error('[auth] forgot: could not start (' + started.reason + ')');
            return res.status(503).json({ error: 'Accounts are not available right now. Please try again shortly.' });
        }

        const link = SITE_URL + '/reset-password?token=' + encodeURIComponent(started.token);
        // awaited, not fired and forgotten. the reply used to go out before the
        // provider had been asked, so a refused send was reported as a delivery.
        try {
            await mailer.sendResetLink({ to: email, link, lang, minutes: started.expiresInMin });
        } catch (mailErr) {
            console.error('[auth] forgot: could not send: ' + mailErr.message);
            return res.status(503).json({ error: 'Could not send the email just now. Please try again shortly.' });
        }
        console.log('[auth] forgot: link sent');
        return sent();
    } catch (err) {
        console.error('[auth forgot error]', err.message);
        return res.status(500).json({ error: 'Could not reach us just now. Please try again in a moment.' });
    }
});

// What the page needs to draw itself: is the token live, and is there already
// an account behind it. The address comes back so the page can show whose reset
// this is; the token is in the url of the person holding it, so this tells them
// only what they could already see in their own inbox.
app.post('/v1/auth/reset-check', requireCloudflareOrigin, authResetLimiter, async (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    try {
        const found = await accounts.readReset(String((req.body || {}).token || ''));
        if (!found) return res.status(410).json({ error: 'expired' });
        res.json({ ok: true, email: found.email, hasAccount: found.hasAccount });
    } catch (err) {
        console.error('[auth reset-check error]', err.message);
        res.status(500).json({ error: 'Could not reach us just now. Please try again in a moment.' });
    }
});

app.post('/v1/auth/reset', requireCloudflareOrigin, authResetLimiter, async (req, res) => {
    try {
        const b = req.body || {};
        const token = String(b.token || '');
        const password = typeof b.password === 'string' ? b.password : '';

        // read before spending it: the name and terms are only asked for when
        // there is no account, and refusing after the token is gone would burn
        // somebody's only link over a missing tick
        const found = await accounts.readReset(token);
        if (!found) return res.status(410).json({ error: 'expired' });

        const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
        const firstName = clean(b.firstName, 80);
        const lastName = clean(b.lastName, 80);
        const nameRe = /^[a-zA-ZÀ-ɏ'’.\- ]{2,}$/;

        // an account made through this door carries the same row as one made
        // through the form: a name on it, and a person who accepted the terms
        if (!found.hasAccount) {
            if (!nameRe.test(firstName) || !nameRe.test(lastName) || b.consent !== true) {
                return res.status(400).json({ error: 'Invalid submission' });
            }
        }

        // an existing account is checked against the name already on it, not
        // against the empty strings this request carries: otherwise the one
        // door that hands out passwords is the one that does not mind you
        // choosing your own name as yours.
        const known = String(found.name || '').split(' ');
        const pwProblem = found.hasAccount
            ? passwordProblem(password, found.email, known[0] || '', known.slice(1).join(' '))
            : passwordProblem(password, found.email, firstName, lastName);
        if (pwProblem) return res.status(400).json({ error: pwProblem });
        if (await breached.isBreached(password)) {
            return res.status(400).json({ error: 'That password has appeared in a data breach. Please choose a different one.' });
        }

        const out = await accounts.finishReset(token, password, {
            name: found.hasAccount ? '' : `${firstName} ${lastName}`,
            flags: found.hasAccount ? [] : reviewFlags(found.email.split('@').pop(), ''),
        });
        // the token went between the check above and here, which means somebody
        // else spent it: the same answer as an expired one, and nothing changed
        if (out.reason === 'bad-token') return res.status(410).json({ error: 'expired' });
        if (!out.ok) return res.status(503).json({ error: 'Accounts are not available right now. Please try again shortly.' });

        console.log('[auth] reset: ' + (out.created ? 'account created' : 'password changed') + ', other sessions ended');
        if (out.session) setSessionCookie(res, out.session.token, out.session.maxAgeSeconds);
        // a half-finished sign-up on the same address is over: the account
        // exists now, and its cookie would only be a stale proof of nothing
        clearSignupCookie(res);
        res.json({ ok: true, created: out.created });

        // and the owner is told, after the answer has gone. not for the person
        // who just did it, who knows: for the one who did not, because this mail
        // is the only thing that reaches them while it still matters.
        if (!out.created && out.email) {
            mailer.sendPasswordChanged({
                to: out.email,
                lang: out.lang || 'en',
                when: whenFor(out.lang),
                ip: ipKey(req.realIp),
                country: req.headers['cf-ipcountry'] || '',
            }).catch((err) => console.error('[auth] password-changed notice failed: ' + err.message));
        }
    } catch (err) {
        console.error('[auth reset error]', err.message);
        res.status(500).json({ error: 'Could not reach us just now. Please try again in a moment.' });
    }
});

// ---------------------------------------------------------------------------
// the second factor
// ---------------------------------------------------------------------------
//
// Four endpoints: finish a sign-in with a code, start setting one up, confirm
// it, and switch it off. The first is public, because the person using it is
// half signed in by definition. The other three need a session, because they
// change an account that somebody is already inside.
const authTotpLimiter = rateLimit({
    handler: limitHandler,
    windowMs: 15 * 60 * 1000,
    // enough for a person setting it up (a start and a few confirms) plus a
    // couple of sign-ins, and for a small office behind one address doing the
    // same on the same afternoon. the real wall against guessing is the six
    // tries on the pending row itself, which follows the sign-in rather than
    // the network it came from.
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `auth_totp:${ipKey(req.realIp)}`,
    store: new PostgresStore(),
    message: { error: 'Too many attempts, please try again later' }
});

app.post('/v1/auth/totp', requireCloudflareOrigin, authTotpLimiter, async (req, res) => {
    try {
        const b = req.body || {};
        const out = await accounts.finishTotp(String(b.pending || ''), String(b.code || ''));
        if (out.reason === 'expired') {
            return res.status(401).json({ error: 'That took too long. Please sign in again.' });
        }
        if (out.reason === 'too-many-attempts') {
            return res.status(429).json({ error: 'Too many wrong codes. Please sign in again.' });
        }
        if (out.reason === 'code-used') {
            return res.status(401).json({ error: 'That code has already been used. Wait for the next one in your app.' });
        }
        if (out.reason === 'bad-code') {
            return res.status(401).json({ error: 'That code is not right. Check your app and try again.' });
        }
        if (!out.ok) return res.status(503).json({ error: 'Accounts are not available right now. Please try again shortly.' });

        setSessionCookie(res, out.session.token, out.session.maxAgeSeconds);
        res.json({ ok: true, name: out.name, usedRecovery: out.usedRecovery, recoveryLeft: out.recoveryLeft });

        tellAboutNewDevice(req, out).catch((err) =>
            console.error('[auth] new-device notice failed: ' + err.message));
    } catch (err) {
        console.error('[auth totp error]', err.message);
        res.status(500).json({ error: 'Could not sign you in right now. Please try again shortly.' });
    }
});

// Everything below changes the account of whoever is signed in.
async function requireSession(req, res) {
    const me = await currentUser(req);
    if (!me) { res.status(401).json({ error: 'Please sign in first.' }); return null; }
    return me;
}

app.post('/v1/account/totp/start', requireCloudflareOrigin, authTotpLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    if (me.totpOn) return res.status(409).json({ error: 'Two-factor is already on for this account.' });
    const secret = await accounts.startTotp(me.userId);
    if (!secret) return res.status(503).json({ error: 'Accounts are not available right now. Please try again shortly.' });
    // the secret is shown once, here, and never again. it is in the reply rather
    // than on a page because the page is the same document the rest of the
    // dashboard is, and this is the one value on it that must not be cached.
    res.set('Cache-Control', 'no-store, private');
    res.json({
        ok: true,
        secret,
        // grouped, because this gets typed into a phone by a person
        grouped: secret.replace(/(.{4})/g, '$1 ').trim(),
        url: totp.otpauthUrl(secret, me.email || 'sentinelpay', 'Sentinelpay'),
    });
});

app.post('/v1/account/totp/confirm', requireCloudflareOrigin, authTotpLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const out = await accounts.confirmTotp(me.userId, String((req.body || {}).code || ''));
    if (out.reason === 'not-started') return res.status(400).json({ error: 'Start the setup again, then enter a code from the app.' });
    if (out.reason === 'already-on') return res.status(409).json({ error: 'Two-factor is already on for this account.' });
    if (out.reason === 'bad-code') return res.status(400).json({ error: 'That code is not right. Check your app and try again.' });
    if (!out.ok) return res.status(503).json({ error: 'Accounts are not available right now. Please try again shortly.' });
    res.set('Cache-Control', 'no-store, private');
    res.json({ ok: true, codes: out.codes });
});

app.post('/v1/account/totp/off', requireCloudflareOrigin, authTotpLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const out = await accounts.disableTotp(me.userId, String((req.body || {}).password || ''));
    if (out.reason === 'bad-password') return res.status(401).json({ error: 'That password is not right.' });
    if (!out.ok) return res.status(503).json({ error: 'Accounts are not available right now. Please try again shortly.' });
    res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// what somebody can do to their own account
// ---------------------------------------------------------------------------
const accountLimiter = rateLimit({
    handler: limitHandler,
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `account:${ipKey(req.realIp)}`,
    store: new PostgresStore(),
    message: { error: 'Too many attempts, please try again later' }
});

app.post('/v1/account/password', requireCloudflareOrigin, accountLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const b = req.body || {};
    const next = typeof b.next === 'string' ? b.next : '';
    const known = String(me.name || '').split(' ');
    const problem = passwordProblem(next, me.email, known[0] || '', known.slice(1).join(' '));
    if (problem) return res.status(400).json({ error: problem });
    if (await breached.isBreached(next)) {
        return res.status(400).json({ error: 'That password has appeared in a data breach. Please choose a different one.' });
    }

    const out = await accounts.changePassword(me.userId, String(b.current || ''), next);
    if (out.reason === 'bad-password') return res.status(401).json({ error: 'That password is not right.' });
    if (!out.ok) return res.status(503).json({ error: 'Accounts are not available right now. Please try again shortly.' });

    // every other browser goes. changing a password because somebody else may
    // have it and leaving their session open is the whole thing half done.
    const ended = await accounts.revokeOtherSessions(me.userId, readSessionCookie(req));
    res.json({ ok: true, otherSessionsEnded: ended });

    if (out.email) {
        mailer.sendPasswordChanged({
            to: out.email,
            lang: out.lang || 'en',
            when: whenFor(out.lang),
            ip: ipKey(req.realIp),
            country: req.headers['cf-ipcountry'] || '',
        }).catch((err) => console.error('[account] password-changed notice failed: ' + err.message));
    }
});

app.get('/v1/account/sessions', async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    res.set('Cache-Control', 'no-store, private');
    res.json({ ok: true, sessions: await accounts.listSessions(me.userId, readSessionCookie(req)) });
});

app.post('/v1/account/sessions/revoke', requireCloudflareOrigin, accountLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const ended = await accounts.revokeOtherSessions(me.userId, readSessionCookie(req));
    res.json({ ok: true, ended });
});

app.post('/v1/account/delete', requireCloudflareOrigin, accountLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const out = await accounts.deleteAccount(me.userId, String((req.body || {}).password || ''));
    if (out.reason === 'bad-password') return res.status(401).json({ error: 'That password is not right.' });
    if (!out.ok) return res.status(503).json({ error: 'Accounts are not available right now. Please try again shortly.' });
    clearSessionCookie(res);
    console.log('[account] deleted at the owner\'s request');
    res.json({ ok: true });
});

// Signing out. The row goes, so the token is dead everywhere and not merely
// forgotten by this browser.
app.post('/v1/auth/logout', requireCloudflareOrigin, async (req, res) => {
    try {
        await accounts.endSession(readSessionCookie(req));
    } catch (err) {
        console.error('[auth logout error]', err.message);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
});

// Who is signed in. The navigation asks this on every page so it can show the
// right thing, so it answers 200 with `signedIn: false` rather than 401: not
// being signed in is an ordinary answer here, not a failure.
// Every page asks this, so it is generous. It is here at all because it is the
// one unauthenticated endpoint that reaches the database on every call, and a
// script asking it in a loop is free traffic that costs us a query each time.
const authMeLimiter = rateLimit({
    handler: limitHandler,
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `auth_me:${ipKey(req.realIp)}`,
    message: { error: 'Too many requests, please slow down' }
});

app.get('/v1/auth/me', authMeLimiter, async (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    try {
        const me = await currentUser(req);
        if (!me) return res.json({ signedIn: false });
        // the dashboard shows the staff panel from this, and nothing more than
        // the panel depends on it: every page behind it checks for itself.
        const staff = staffList().includes(String(me.email || '').toLowerCase());
        res.json({
            signedIn: true, name: me.name, email: me.email, since: me.since, staff,
            // the dashboard draws the two-factor card from these: whether the
            // account has one, and whether this session was opened with it.
            totp: Boolean(me.totpOn),
            mfa: Boolean(me.mfa),
            // and how many recovery codes are left, so "two left" can be said
            // out loud rather than discovered on the day they run out
            recoveryLeft: me.totpOn ? await accounts.recoveryLeft(me.userId) : 0,
            staffNeeds2fa: staff && STAFF_REQUIRE_2FA && !me.totpOn,
        });
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
            return res.status(400).json({ error: 'Verification failed, please try again' });
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
            return res.status(400).json({ error: 'Invalid submission' });
        }

        const host = website.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./i, '').toLowerCase();
        const emailDomain = email.split('@').pop().toLowerCase();

        // One rule stands between a stranger and a trial: the address has to be on
        // the same domain as the site. Every address is welcome to try, from any
        // provider, and none of them get an exemption. What the provider is only
        // decides what the submission is tagged with afterwards.
        const flags = reviewFlags(emailDomain, host);
        if (flags.indexOf('domain-mismatch') !== -1) {
            return res.status(400).json({ error: 'Website domain must match your work email domain' });
        }

        // we publicly refuse gambling operators, so the declared industry is checked
        // here too and not only in the tickbox above.
        if (industry && /gambling|igaming|casino|betting|sportsbook|wager/i.test(industry)) {
            return res.status(400).json({ error: 'We do not onboard gambling operators' });
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
            return res.status(400).json({ error: 'Verification failed, please try again' });
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
            return res.status(400).json({ error: 'Invalid submission' });
        }

        // the same refusal as the trial endpoint: we do not onboard gambling, so a
        // demo request from one should not reach the inbox either.
        if (/gambling|igaming|casino|betting|sportsbook|wager/i.test(industry)) {
            return res.status(400).json({ error: 'We do not onboard gambling operators' });
        }

        // same rule as the trial: any provider, as long as the site agrees with it
        const emailDomain = email.split('@').pop().toLowerCase();
        const host = website
            ? website.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./i, '').toLowerCase()
            : '';
        const flags = reviewFlags(emailDomain, host);
        if (flags.indexOf('domain-mismatch') !== -1) {
            return res.status(400).json({ error: 'Website domain must match your work email domain' });
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
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That is more than we can accept in one request.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'That request did not arrive in one piece. Please try again.' });
    if (err.message === 'Not allowed by CORS') return res.status(403).json({ error: 'That request did not come from our site. Please reload the page and try again.' });
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

// ---------------------------------------------------------------------------
// what this deploy is actually running with
// ---------------------------------------------------------------------------
//
// Every protection in this file is one environment variable away from not
// existing, and the failure is silent in the worst possible way: without
// SUBMISSIONS_KEY the personal data is written in the clear and everything else
// behaves exactly as it does when it is not. A line in a boot log nobody reads
// is not a control.
//
// So the posture is computed in one place, printed loudly at boot, and readable
// at /v1/security-status by whoever is signed in as staff. STRICT_BOOT=true
// turns the serious ones into a refusal to start, which is what you want once
// you have confirmed the environment is right: a site that is down is a bad
// afternoon, a site quietly storing names and addresses unencrypted is a
// breach with a date on it.
function securityPosture() {
    const on = (v) => Boolean(v && String(v).trim());
    const adminToken = process.env.ADMIN_TOKEN || '';
    const checks = [
        {
            key: 'personal data encrypted at rest',
            ok: db.status().encrypted,
            grave: true,
            says: db.status().encrypted ? 'SUBMISSIONS_KEY is set' : 'SUBMISSIONS_KEY is NOT set: names and addresses are being stored in the clear',
        },
        {
            key: 'key rotation',
            ok: true,
            grave: false,
            says: db.rotating()
                ? 'SUBMISSIONS_KEY_PREVIOUS is set: rows written under the old key can still be read. run tools/rotate-key.js --write, then remove it'
                : 'one key in use, nothing half rotated',
        },
        {
            key: 'accounts store',
            ok: db.status().configured,
            grave: true,
            says: db.status().configured ? 'DATABASE_URL is set' : 'DATABASE_URL is NOT set: there are no accounts, and leads go to a file a redeploy wipes',
        },
        {
            key: 'bot check on the public forms',
            ok: on(process.env.TURNSTILE_SECRET_KEY),
            grave: true,
            says: on(process.env.TURNSTILE_SECRET_KEY)
                ? 'TURNSTILE_SECRET_KEY is set' + (LOGIN_TURNSTILE ? ', sign-in included' : ', but LOGIN_TURNSTILE=false so sign-in is exempt')
                : 'TURNSTILE_SECRET_KEY is NOT set: every form is open to a script',
        },
        {
            key: 'origin lockdown',
            ok: on(process.env.CF_ORIGIN_SECRET),
            grave: false,
            says: !on(process.env.CF_ORIGIN_SECRET)
                ? 'CF_ORIGIN_SECRET is not set: the railway origin can be reached directly, around cloudflare'
                : (String(process.env.CF_ORIGIN_STRICT || '').toLowerCase() === 'true'
                    ? 'set, and strict: the whole site requires the cloudflare header'
                    : 'set for the form endpoints; CF_ORIGIN_STRICT=true closes the rest'),
        },
        {
            key: 'cross origin list',
            ok: on(process.env.ALLOWED_ORIGINS),
            grave: false,
            says: on(process.env.ALLOWED_ORIGINS) ? 'ALLOWED_ORIGINS is set' : 'ALLOWED_ORIGINS is not set (same-site requests still pass)',
        },
        {
            key: 'outbound mail',
            ok: mailer.isConfigured(),
            grave: false,
            says: mailer.isConfigured() ? 'configured' : 'RESEND_API_KEY is not set: codes, links and security notices cannot be sent',
        },
        {
            key: 'breach check on passwords',
            ok: breached.enabled(),
            grave: false,
            says: breached.enabled() ? 'on' : 'off (BREACH_CHECK=false)',
        },
        {
            key: 'staff by account',
            ok: on(process.env.STAFF_EMAILS),
            grave: false,
            says: on(process.env.STAFF_EMAILS)
                ? String(process.env.STAFF_EMAILS).split(',').filter(Boolean).length + ' address(es) on the staff list'
                : 'STAFF_EMAILS is empty: the admin token is the only way in',
        },
        {
            key: 'admin token',
            ok: !adminToken || adminToken.length >= 24,
            grave: false,
            says: !adminToken ? 'not set (staff accounts only)'
                : (adminToken.length >= 24 ? 'set, long enough' : 'set but only ' + adminToken.length + ' characters: make it 32 or more'),
        },
        {
            key: 'content security policy',
            ok: cspStrict,
            grave: false,
            says: cspStrict ? 'strict, inline scripts by hash' : "relaxed: CSP_STRICT=false allows 'unsafe-inline'",
        },
        {
            key: 'secure cookies',
            ok: COOKIE_SECURE,
            grave: true,
            says: COOKIE_SECURE ? 'production: __Host- prefix and Secure' : 'NODE_ENV is not production, so the session cookie is not Secure',
        },
    ];
    return checks;
}

function reportPosture() {
    const checks = securityPosture();
    const bad = checks.filter((c) => !c.ok);
    const graveBad = bad.filter((c) => c.grave);
    if (!bad.length) {
        console.log('[security] every check passed');
    } else {
        for (const c of bad) {
            console[c.grave ? 'error' : 'warn']('[security] ' + (c.grave ? 'SERIOUS: ' : 'note: ') + c.key + ' - ' + c.says);
        }
    }
    const strict = String(process.env.STRICT_BOOT || '').trim().toLowerCase() === 'true';
    if (strict && graveBad.length && isProduction) {
        console.error('[security] STRICT_BOOT is on and ' + graveBad.length +
            ' serious check(s) failed. Refusing to start rather than running like this.');
        process.exit(1);
    }
}

app.listen(PORT, () => {
    console.log(`[sentinelpay-web] server active on port ${PORT}`);
    reportPosture();
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
        // spent rate-limit windows go with everything else that expires
        startRateSweep();
        // unfinished sign-ups expire with everything else
        setTimeout(() => { accounts.purge(); }, 45000).unref();
        setInterval(() => { accounts.purge(); }, 6 * 60 * 60 * 1000).unref();
    }
});
