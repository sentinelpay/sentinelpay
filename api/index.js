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
const sanctions = require('./sanctions');
const trial = require('./trial');
const screening = require('./screening');
const tokens = require('./tokens');
const orgs = require('./orgs');
const projects = require('./projects');
const live = require('./live');
const invites = require('./invites');
const usage = require('./usage.js');
const billing = require('./billing.js');
const plans = require('./plans.js');

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

const enforceCloudflare = String(process.env.ENFORCE_CLOUDFLARE || '').trim().toLowerCase() === 'true';

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

const cfOriginStrict = String(process.env.CF_ORIGIN_STRICT || '').trim().toLowerCase() === 'true';
app.use((req, res, next) => {
    if (!cfOriginStrict || !cfOriginSecret) return next();
    if (fromOurCloudflare(req)) return next();
    return res.status(403).type('text/plain').send('forbidden');
});

app.use((req, res, next) => {
    const cfIp = req.headers['cf-connecting-ip'];
    const trusted = fromOurCloudflare(req) || enforceCloudflare;
    req.realIp = (trusted && typeof cfIp === 'string' && cfIp.length > 0) ? cfIp : req.ip;
    next();
});

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
        console.error('[turnstile refused]', (data && data['error-codes'] || ['no reason given']).join(', '));
        return false;
    } catch (err) {
        console.error('[turnstile verify error]', err.message);
        return false;
    }
}

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
    frameguard: { action: 'deny' },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true }
}));

app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'xr-spatial-tracking=(), camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=(), bluetooth=(), serial=(), hid=(), ambient-light-sensor=(), accelerometer=(), gyroscope=(), magnetometer=(), display-capture=()');
    next();
});

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

const pageCache = new Map();

function geoLang(req) {
    const cc = String(req.headers['cf-ipcountry'] || '').trim().toUpperCase();
    if (cc === 'HR') return 'hr';
    if (cc === 'DE') return 'de';
    return 'en';
}

const COUNTRY_ZONE = {
    HR: 'Europe/Zagreb', SI: 'Europe/Ljubljana', BA: 'Europe/Sarajevo', RS: 'Europe/Belgrade',
    ME: 'Europe/Podgorica', MK: 'Europe/Skopje', AL: 'Europe/Tirane', GR: 'Europe/Athens',
    IT: 'Europe/Rome', AT: 'Europe/Vienna', DE: 'Europe/Berlin', CH: 'Europe/Zurich',
    HU: 'Europe/Budapest', SK: 'Europe/Bratislava', CZ: 'Europe/Prague', PL: 'Europe/Warsaw',
    NL: 'Europe/Amsterdam', BE: 'Europe/Brussels', LU: 'Europe/Luxembourg', FR: 'Europe/Paris',
    ES: 'Europe/Madrid', PT: 'Europe/Lisbon', IE: 'Europe/Dublin', GB: 'Europe/London',
    DK: 'Europe/Copenhagen', NO: 'Europe/Oslo', SE: 'Europe/Stockholm', FI: 'Europe/Helsinki',
    EE: 'Europe/Tallinn', LV: 'Europe/Riga', LT: 'Europe/Vilnius', IS: 'Atlantic/Reykjavik',
    RO: 'Europe/Bucharest', BG: 'Europe/Sofia', MD: 'Europe/Chisinau', UA: 'Europe/Kyiv',
    TR: 'Europe/Istanbul', CY: 'Asia/Nicosia', MT: 'Europe/Malta',
    AE: 'Asia/Dubai', IL: 'Asia/Jerusalem', SA: 'Asia/Riyadh', QA: 'Asia/Qatar',
    SG: 'Asia/Singapore', HK: 'Asia/Hong_Kong', JP: 'Asia/Tokyo', KR: 'Asia/Seoul',
    IN: 'Asia/Kolkata', PH: 'Asia/Manila', TH: 'Asia/Bangkok', VN: 'Asia/Ho_Chi_Minh',
    MY: 'Asia/Kuala_Lumpur', TW: 'Asia/Taipei', PK: 'Asia/Karachi',
    ZA: 'Africa/Johannesburg', NG: 'Africa/Lagos', KE: 'Africa/Nairobi', EG: 'Africa/Cairo',
    MA: 'Africa/Casablanca',
    NZ: 'Pacific/Auckland', AR: 'America/Argentina/Buenos_Aires', CL: 'America/Santiago',
    CO: 'America/Bogota', PE: 'America/Lima', UY: 'America/Montevideo', PA: 'America/Panama'
};

function geoZone(req) {
    const exact = String(req.headers['cf-timezone'] || '').trim();
    if (/^[A-Za-z]+\/[A-Za-z0-9_+\-\/]+$/.test(exact) || exact === 'UTC') {
        return { zone: exact, src: 'ip' };
    }
    const cc = String(req.headers['cf-ipcountry'] || '').trim().toUpperCase();
    const zone = COUNTRY_ZONE[cc] || '';
    return zone ? { zone, src: 'country' } : { zone: '', src: '' };
}

function browserName(ua) {
    ua = String(ua || '');
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
    const build = HELP_QUERY[lang] || HELP_QUERY.en;
    return 'https://www.google.com/search?q=' + encodeURIComponent(build(browser)) +
        '&hl=' + (HELP_QUERY[lang] ? lang : 'en');
}

const SITE_URL = process.env.SITE_URL || 'https://sentinelpay.org';
const HOMEPAGE_LANGS = ['en', 'hr', 'de'];
function homepageLinkTags(forced) {
    const self = forced ? SITE_URL + '/' + forced : SITE_URL;
    const alts = HOMEPAGE_LANGS
        .map((l) => '<link rel="alternate" hreflang="' + l + '" href="' + SITE_URL + '/' + l + '">')
        .join('');
    return '<link rel="canonical" href="' + self + '">' + alts +
        '<link rel="alternate" hreflang="x-default" href="' + SITE_URL + '">';
}

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
    return ['hr', 'de'].map((l) => (texts[l] ? ' ' + prefix + '-' + l + '="' + escapeHtml(texts[l]) + '"' : '')).join('');
}

function statusBanner() {
    if (!STATUS_COPY) return '';
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
    const dismiss =
        '<button type="button" class="sp-status-x"' +
        langAttrs('data-sp-label', STATUS_DISMISS) +
        ' aria-label="' + escapeHtml(STATUS_DISMISS.en) + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
        'stroke-linecap="round" aria-hidden="true">' +
        '<path d="M6 6l12 12M18 6L6 18"></path></svg></button>';

    return '<div class="sp-status sp-status-armed" role="status" data-i18n-skip>' +
        '<div class="sp-status-inner">' + inner + '</div>' + dismiss + '</div>';
}

const IS_STAGING = String(process.env.APP_ENV || '').toLowerCase() === 'staging';
const DASHBOARD_NEXT = String(process.env.DASHBOARD_NEXT || (IS_STAGING ? 'true' : 'false'))
    .trim().toLowerCase() === 'true';
const DASHBOARD_PAGES = ['dashboard.html', 'dashboard-next.html'];

function stagingRibbon() {
    if (!IS_STAGING) return '';
    if (String(process.env.STAGING_RIBBON || '').toLowerCase() !== 'true') return '';
    const sha = String(process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7);
    const branch = String(process.env.RAILWAY_GIT_BRANCH || '');
    const bits = ['staging', 'not production'];
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

// State written into the page rather than fetched by it.
//
// It goes in a script of type application/json, which is a data block: the
// browser does not execute it, so the content policy has nothing to allow and
// no hash to know in advance, which a dynamic inline script would need.
//
// The escaping matters. A name or an organisation could contain the characters
// that end a script element or open a comment, and inside a script element
// there is no markup parsing to save us, so every < is written as its escape.
function stateBlock(state) {
    if (!state) return '';
    return '<script type="application/json" id="sp-state">' +
        JSON.stringify(state).replace(/</g, '\\u003c') +
        '</' + 'script>';
}

function renderPage(file, req, forcedLang, state) {
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
    const geo = geoZone(req);
    // Chrome offers to translate a page whose language is not the reader's, and
    // ours is english in the markup until our own script swaps the words for
    // croatian or german a moment later. By then the offer is already on
    // screen, over the top right of the page, proposing to translate a site
    // that translates itself. translate="no" is the html standard way to
    // decline; the google meta beside it is the one chrome documents. Neither
    // touches our own translation, which replaces text nodes rather than asking
    // the browser for anything.
    const attrs = ' translate="no"' +
        ' data-geo-lang="' + lang + '"' +
        (geo.zone ? ' data-geo-tz="' + geo.zone + '"' : '') +
        (geo.src ? ' data-geo-src="' + geo.src + '"' : '') +
        (forcedLang ? ' data-force-lang="' + forcedLang + '"' : '') +
        (STATUS_MESSAGE ? ' data-status' : '') +
        (STATUS_BLOCKS_MAIL ? ' data-mail-down' : '');
    return html
        .replace('<!--SP_STATE-->', () => stateBlock(state))
        .replace('<!--SP_NOSCRIPT-->', notice)
        .replace('<!--SP_HREFLANG-->', () => homepageLinkTags(forcedLang))
        .replace(/<html lang="en">/, '<html lang="en"' + attrs + '>')
        .replace('<body class="lp-body">', () => '<body class="lp-body">' + statusBanner() + stagingRibbon());
}

function sendPage(res, req, file, status, forcedLang, cache, state) {
    res.status(status || 200)
        .set('Cache-Control', cache || 'no-cache')
        .set('Vary', 'CF-IPCountry, CF-Timezone, User-Agent')
        .type('html')
        .send(renderPage(file, req, forcedLang, state));
}

app.use(rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `all:${ipKey(req.realIp)}`,
    message: { error: 'Too many requests, please slow down' }
}));

if (IS_STAGING) {
    app.use((req, res, next) => {
        res.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
        next();
    });
    app.get('/robots.txt', (req, res) => {
        res.type('text/plain').send('User-agent: *\nDisallow: /\n');
    });
}

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

const BLANK_PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>sentinelpay</title><style>html,body{margin:0;height:100%;background:#06070f}</style></head><body></body></html>';
app.use((req, res, next) => {
    const host = String(req.headers.host || '').split(':')[0].toLowerCase();
    const label = host.split('.')[0];
    if (label === 'blog') {
        if (req.method === 'GET' && !path.extname(req.path)) {
            res.set('X-Robots-Tag', 'noindex, nofollow');
            let page = 'blog.html';
            if (req.path.startsWith('/article/')) {
                const slug = req.path.replace(/^\/article\//, '').replace(/\/+$/, '');
                const articles = Object.assign(Object.create(null), {
                    '01': 'blog-article.html',
                    '02': 'blog-article-2.html',
                    '03': 'blog-article-3.html',
                    '04': 'blog-article-4.html',
                    '05': 'blog-article-5.html',
                    '06': 'blog-article-6.html',
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

app.get('/', (req, res, next) => {
    const host = String(req.headers.host || '').split(':')[0].toLowerCase();
    if (host.startsWith('blog.') || host.startsWith('help.')) return next();

    const cookie = String(req.headers.cookie || '').match(/(?:^|;\s*)sp-lang=([^;]*)/);
    const saved = cookie ? decodeURIComponent(cookie[1]) : '';
    const lang = HOMEPAGE_LANGS.includes(saved) ? saved : geoLang(req);

    res.set('Cache-Control', 'no-store');
    res.set('Vary', 'Cookie, CF-IPCountry');
    const rest = req.originalUrl.indexOf('?');
    return res.redirect(302, '/' + lang + (rest === -1 ? '' : req.originalUrl.slice(rest)));
});

app.get(HOMEPAGE_LANGS.flatMap((l) => ['/' + l, '/' + l + '/']), (req, res, next) => {
    const host = String(req.headers.host || '').split(':')[0].toLowerCase();
    if (host.startsWith('blog.') || host.startsWith('help.')) return next();
    const lang = req.path.replace(/\//g, '');
    return sendPage(res, req, 'index.html', 200, lang);
});

app.get('/auth', (req, res) => {
    const which = String(req.query.signin || '').toLowerCase();
    const want = ['create', 'reset'].includes(which) ? which : '1';
    return res.redirect(301, '/?signin=' + want);
});

app.get('/privacy', (req, res) => res.redirect(301, '/privacy-policy'));
app.get('/tos', (req, res) => res.redirect(301, '/terms-of-service'));

// Your own account is not inside an organisation, so its address is not inside
// one either: /account/preferences, and the same for security, tokens and logs.
// The four pages it has are named here rather than taking a splat, so a typo
// lands on the 404 instead of an empty shell.
const ACCOUNT_PAGES = ['preferences', 'security', 'tokens', 'logs'];

// where an organisation's own pages live, and the only shape of address the
// plan gate will send anybody back to. a next parameter that is not one of
// these is not followed: it is a redirect somebody else could have written.
const ORG_ROOT = '/dashboard/org/';
const ORGS_LIST = '/dashboard/organisations';
function safeNext(raw) {
    const want = String(raw || '');
    if (want.indexOf(ORG_ROOT) !== 0) return '';
    const rest = want.slice(ORG_ROOT.length);
    if (!/^[a-z0-9]{20}(\/[a-z-]{1,24})?$/.test(rest)) return '';
    return want;
}

app.get('/account', (req, res) => res.redirect(301, '/account/preferences'));

// what these addresses used to be. redirected rather than dropped, because a
// link somebody kept should not stop working over a rename.
app.get(['/dashboard/account', '/dashboard/account/*splat'], (req, res) => {
    const tail = req.path.replace(/^\/dashboard\/account\/?/, '').replace(/\/+$/, '');
    const page = ACCOUNT_PAGES.indexOf(tail) === -1 ? 'preferences' : tail;
    return res.redirect(301, '/account/' + page);
});

app.get('/account/:page', async (req, res, next) => {
    if (ACCOUNT_PAGES.indexOf(req.params.page) === -1) return next();
    let me;
    try {
        me = await currentUser(req);
        if (!me) return res.redirect(302, '/?signin=1');
    } catch (err) {
        console.error('[account guard]', err.message);
        return res.redirect(302, '/?signin=1');
    }
    res.set('Cache-Control', 'no-store, private');
    if (!DASHBOARD_NEXT) return next();
    let state = null;
    try {
        state = await entitlementFor(req, me);
    } catch (err) {
        console.error('[account state]', err.message);
    }
    return sendPage(res, req, 'dashboard-next.html', 200, undefined, 'no-store, private', state);
});

app.get(['/dashboard', '/dashboard/*splat'], async (req, res, next) => {
    let me;
    try {
        me = await currentUser(req);
        if (!me) return res.redirect(302, '/?signin=1');
    } catch (err) {
        console.error('[dashboard guard]', err.message);
        return res.redirect(302, '/?signin=1');
    }
    res.set('Cache-Control', 'no-store, private');

    // somebody who followed an invitation, signed in, and landed here. the
    // journey is finished where it was going rather than left half done with a
    // cookie nobody looks at again.
    const pending = readCookie(req, INVITE_COOKIE);
    if (pending) return res.redirect(302, '/invite/' + encodeURIComponent(pending));

    if (DASHBOARD_NEXT) {
        // A plan is not what lets you in, it is what lets you work. Choosing
        // one stands between the list of organisations and the inside of one,
        // rather than in front of the whole dashboard: without a plan you can
        // still see which organisations you are in, make another, and reach
        // your own account. What you cannot do is open one and screen.
        //
        // The plan still hangs off the account today, so this asks about the
        // person. When it moves to the organisation only this lookup changes,
        // because the gate is already standing in the right doorway.
        let here = null;
        if (req.path.indexOf(ORG_ROOT) === 0) {
            try {
                // the plan of the organisation in the address, not of whoever
                // is signed in: two companies, two plans, and being paid up in
                // one says nothing about the other.
                const slug = req.path.slice(ORG_ROOT.length).split('/')[0];
                here = await orgs.bySlug(me.userId, slug);
                if (here) {
                    // the address wins over the cookie, and says so for the
                    // requests that follow
                    setOrgCookie(res, here.id);
                    const state = await trial.ensure(here.id, me.userId, me.email);
                    if (state.state === 'none') {
                        return res.redirect(302, '/choose-a-plan?next=' + encodeURIComponent(req.path));
                    }
                }
            } catch (err) {
                console.error('[dashboard trial]', err.message);
            }
        }
        // the page arrives knowing who is reading it, so the first frame is the
        // finished screen instead of an empty one waiting on a request
        let state = null;
        try {
            state = await entitlementFor(req, me, here);
        } catch (err) {
            console.error('[dashboard state]', err.message);
        }
        return sendPage(res, req, 'dashboard-next.html', 200, undefined, 'no-store, private', state);
    }
    return next();
});

app.get('/choose-a-plan', async (req, res) => {
    res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    let me;
    try {
        me = await currentUser(req);
        if (!me) return res.redirect(302, '/?signin=1');
    } catch (err) {
        console.error('[plans guard]', err.message);
        return res.redirect(302, '/?signin=1');
    }
    // A plan is chosen for an organisation, so this needs to know which. The
    // address that sent us here names it; failing that, the one last used. With
    // neither there is nothing to choose a plan for, so it asks for one first.
    try {
        const want = safeNext(req.query.next);
        const slug = want ? want.slice(ORG_ROOT.length).split('/')[0] : '';
        const mine = slug ? await orgs.bySlug(me.userId, slug) : await orgFor(req, me);
        if (!mine) return res.redirect(302, ORGS_LIST);
        // the page posts to activate, which reads the organisation from the
        // cookie, so the one named in the address becomes the current one.
        // without this a plan chosen here would land on whichever organisation
        // happened to be open last.
        setOrgCookie(res, mine.id);
        const state = await trial.ensure(mine.id, me.userId, me.email);
        if (state.state !== 'none') return res.redirect(302, want || ORGS_LIST);
    } catch (err) {
        console.error('[plans trial]', err.message);
    }
    return sendPage(res, req, 'choose-a-plan.html', 200, undefined, 'no-store, private');
});

// Where an invitation link lands.
//
// The secret is in the path, so it must not survive the visit: whatever happens
// the browser is sent somewhere without it, and the page that renders never
// carries it. Signed out, the sign in modal opens first and the link is kept in
// a short lived cookie so coming back completes the journey.
const INVITE_COOKIE = 'sp_invite';

app.get('/invite/:secret', async (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');

    const secret = String(req.params.secret || '');
    let me = null;
    try {
        me = await currentUser(req);
    } catch (err) {
        me = null;
    }

    if (!me) {
        res.cookie(INVITE_COOKIE, secret, {
            httpOnly: true, sameSite: 'lax', secure: COOKIE_SECURE,
            maxAge: 30 * 60 * 1000, path: '/',
        });
        return res.redirect(302, '/?signin=1&invited=1');
    }

    const out = await invites.accept(secret, me);
    res.clearCookie(INVITE_COOKIE, { path: '/' });
    if (!out.ok) {
        const where = {
            missing: 'gone', expired: 'expired', withdrawn: 'gone', accepted: 'used',
            'not-yours': 'address', 'need-mfa': 'two-factor',
        };
        return res.redirect(302, '/dashboard/organisations?invite=' + (where[out.reason] || 'failed'));
    }

    setOrgCookie(res, out.invite.orgId);
    await accounts.audit('invite-accepted', {
        actor: String(me.userId), subject: out.invite.id, ip: req.realIp, detail: out.invite.role,
    });
    await tellOrg(out.invite.orgId, { topic: 'org', id: String(out.invite.orgId) });
    tellMe(me.userId, { topic: 'orgs' });
    return res.redirect(302, '/dashboard/org/' + out.invite.orgSlug);
});

app.get('/reset-password', async (req, res) => {
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    try {
        const token = String(req.query.token || '');
        if (!token) return res.redirect(302, '/token-expired');
        const found = await accounts.readReset(token);
        if (!found) return res.redirect(302, '/token-expired');
        return sendPage(res, req, 'index.html', 200, undefined, 'no-store, private');
    } catch (err) {
        console.error('[reset page error]', err.message);
        return res.redirect(302, '/token-expired');
    }
});

app.get(['/dashboard.html', '/dashboard-next.html'], (req, res) => {
    return sendPage(res, req, '404.html', 404);
});

app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (path.extname(req.path) && !/\.html$/i.test(req.path)) return next();
    let file = req.path === '/' ? 'index.html'
        : req.path.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!/\.html$/i.test(file)) file += '.html';
    if (file.includes('/') || file.includes('\\') || file.includes('..')) return next();
    if (DASHBOARD_PAGES.indexOf(file.toLowerCase()) !== -1) return next();
    const full = path.join(__dirname, 'public', file);
    if (!fsSync.existsSync(full)) return next();
    return sendPage(res, req, file);
});

app.use((req, res, next) => {
    const m = req.path.match(/^\/((?:[a-z0-9-]+\/)*[a-z0-9-]+)\.(\d+)\.(css|js|png|jpe?g|webp|gif|svg|avif)$/i);
    if (m) req.url = '/' + m[1] + '.' + m[3];
    next();
});

// What is actually running here.
//
// "Is staging on the latest code" was being answered by looking at a deploy
// dashboard in another tab, which says which commit was last *seen*, not which
// one is being *served*: a build that failed leaves the previous one running
// and the newest commit on screen. This says what this process was built from,
// when it started, and which version of the dashboard script the html it serves
// points at -- which is the number a browser would have to be asking for.
const BOOTED_AT = new Date().toISOString();
const DASH_STAMP = (() => {
    try {
        const html = fsSync.readFileSync(path.join(__dirname, 'public', 'dashboard-next.html'), 'utf8');
        const m = html.match(/dash-app\.(\d+)\.js/);
        return m ? m[1] : '';
    } catch (err) {
        return '';
    }
})();

app.get('/v1/version', (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    res.json({
        sha: String(process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7),
        branch: String(process.env.RAILWAY_GIT_BRANCH || ''),
        env: String(process.env.APP_ENV || ''),
        bootedAt: BOOTED_AT,
        dashApp: DASH_STAMP,
    });
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

const demoRequestLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `demo_request:${ipKey(req.realIp)}`,
    store: new PostgresStore(),
    message: { error: 'Too many requests, please try again later' }
});

const screenLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `screen:${ipKey(req.realIp)}`,
    store: new PostgresStore(),
    message: { error: 'Too many requests, please try again later' }
});

const trialActivateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 6,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `trial_activate:${ipKey(req.realIp)}`,
    store: new PostgresStore(),
    message: { error: 'Too many requests, please try again later' }
});

const trialRequestLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `trial_request:${ipKey(req.realIp)}`,
    store: new PostgresStore(),
    message: { error: 'Too many requests, please try again later' }
});

function limitHandler(req, res, next, options) {
    const until = req.rateLimit && req.rateLimit.resetTime;
    const retryIn = until ? Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000)) : undefined;
    if (retryIn) res.set('Retry-After', String(retryIn));
    res.status(options.statusCode).json(Object.assign({}, options.message, { retryIn }));
}

const COOKIE_SECURE = process.env.NODE_ENV === 'production';
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
        maxAge: maxAgeSeconds * 1000,
    });
}

function clearSessionCookie(res) {
    const opts = { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'lax', path: '/' };
    res.clearCookie(SESSION_COOKIE, opts);
    if (SESSION_COOKIE !== SESSION_COOKIE_OLD) res.clearCookie(SESSION_COOKIE_OLD, opts);
}

// Which organisation the person is working in. The cookie is only ever a hint:
// every request looks the membership up before trusting it, so a forged or
// stale value resolves to nothing rather than to somebody else's company.
const ORG_COOKIE = COOKIE_SECURE ? '__Host-sp_org' : 'sp_org';

function setOrgCookie(res, orgId) {
    res.cookie(ORG_COOKIE, String(orgId), {
        httpOnly: true,
        secure: COOKIE_SECURE,
        sameSite: 'lax',
        path: '/',
        maxAge: 400 * 24 * 60 * 60 * 1000,
    });
}

function clearOrgCookie(res) {
    res.clearCookie(ORG_COOKIE, { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'lax', path: '/' });
}

// the organisation this request is acting in, or null when the person has to
// choose one first. belonging to exactly one is the ordinary case, and it does
// not ask.
async function orgFor(req, me) {
    const asked = readCookie(req, ORG_COOKIE);
    if (asked) {
        const mine = await orgs.membership(me.userId, asked);
        if (mine) return mine;
    }
    const all = await orgs.listFor(me.userId);
    if (all.length === 1) return all[0];
    return null;
}

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

// a /v1 data endpoint can be reached two ways: from the dashboard with a session
// cookie, or from a customer's own code with a bearer token. the token path is
// the only one that checks scopes, because a session is the whole account.
async function caller(req, res, scope) {
    const raw = String(req.headers.authorization || '');
    if (/^Bearer\s+/i.test(raw)) {
        const out = await tokens.read(raw.replace(/^Bearer\s+/i, ''));
        if (!out.ok) {
            const said = {
                revoked: 'That token has been revoked',
                expired: 'That token has expired',
                unavailable: 'Accounts are not available right now. Please try again shortly.',
            };
            res.status(out.reason === 'unavailable' ? 503 : 401)
               .json({ error: said[out.reason] || 'That token is not valid' });
            return null;
        }
        if (scope && out.scopes.indexOf(scope) === -1) {
            res.status(403).json({ error: 'That token does not carry the ' + scope + ' scope' });
            return null;
        }
        const who = await accounts.readUser(out.userId);
        if (!who) { res.status(401).json({ error: 'That token is not valid' }); return null; }
        // a token carries its organisation with it, so no cookie is involved and
        // nothing has to be chosen
        if (!out.orgId) {
            res.status(409).json({ error: 'That token predates organisations. Issue a new one.' });
            return null;
        }
        return {
            ...who,
            org: { id: String(out.orgId) },
            viaToken: out.tokenId,
            // the project the key belongs to, so every check it makes is filed
            // under the part of the business that made it
            project: out.projectId || '',
            sandbox: out.sandbox,
        };
    }
    const me = await currentUser(req);
    if (!me) { res.status(401).json({ error: 'Sign in first' }); return null; }
    const org = await orgFor(req, me);
    if (!org) { res.status(409).json({ error: 'Choose an organisation first' }); return null; }
    // the dashboard is always looking at the real thing
    return { ...me, org: org, sandbox: false };
}

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

function adminOk(req) {
    const adminToken = process.env.ADMIN_TOKEN || '';
    if (!adminToken) return false;
    const provided = String(req.get('x-admin-token') || '');
    return crypto.timingSafeEqual(sha256(provided), sha256(adminToken));
}

const STAFF_REQUIRE_2FA = String(process.env.STAFF_REQUIRE_2FA || 'true').trim().toLowerCase() !== 'false';

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
    if (!list.includes(String(me.email).toLowerCase())) return null;
    if (STAFF_REQUIRE_2FA && !me.totpOn) return { ...me, blocked: 'no-2fa' };
    if (STAFF_REQUIRE_2FA && !me.mfa) return { ...me, blocked: 'session-without-2fa' };
    return me;
}

async function whoIsAsking(req) {
    const me = await staffOf(req);
    if (me && !me.blocked) return { kind: 'staff', who: me.email, name: me.name };
    if (adminOk(req)) return { kind: 'token', who: 'admin token' };
    if (me && me.blocked) return { kind: 'blocked', who: me.email, why: me.blocked };
    return null;
}

function requireStaff(action) {
    return async (req, res, next) => {
        const asking = await whoIsAsking(req);
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

app.get('/v1/submissions', requireStaff('submissions json'), async (req, res) => {
    const kind = String(req.query.kind || '').slice(0, 32);
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

app.post('/v1/forget', requireStaff('erase'), async (req, res) => {
    const email = String((req.body && req.body.email) || req.query.email || '').trim();
    if (!email || email.length > 254) return res.status(400).json({ error: 'Please enter your email address.' });
    try {
        const removed = await db.forget(email);
        let account = 0;
        try { account = await accounts.forget(email); }
        catch (accErr) { console.error('[forget accounts]', accErr.message); }
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

app.get('/v1/mail-preview', requireStaff('mail preview'), (req, res) => {
    const name = String(req.query.t || '');
    const lang = String(req.query.lang || 'en');
    const link = (t, l) => '/v1/mail-preview?t=' + encodeURIComponent(t) + '&lang=' + l;

    res.set('Cache-Control', 'no-store, private');
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

app.get('/v1/inbox/stream', requireStaff('inbox stream'), (req, res) => {
    res.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
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

    const beat = setInterval(() => { res.write(': beat\n\n'); }, 25000);

    const stop = () => {
        clearInterval(beat);
        submissions.bus.removeListener('submission', onSubmission);
    };
    req.on('close', stop);
    res.on('close', stop);
});

app.get('/v1/inbox', requireStaff('inbox'), (req, res) => {
    res.set('Cache-Control', 'no-store, private');
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

app.get('/v1/security-status', requireStaff('security status'), (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    const checks = securityPosture().map((c) => ({ check: c.key, ok: c.ok, serious: c.grave, detail: c.says }));
    // how many screens are holding a live connection. a number that climbs and
    // never falls is the shape a leak makes, and this is where somebody would
    // look for it.
    const streams = live.status();
    if (String(req.query.format || '') === 'json') {
        return res.json({ ok: checks.every((c) => c.ok), checks, live: streams });
    }
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
        '<p style="margin:0 0 18px;color:rgba(14,35,88,0.6);font-size:13px;">live connections: ' +
        streams.connections + ' held by ' + streams.people + ' account(s).</p>' +
        checks.map((c) =>
            '<div style="padding:10px 0;border-bottom:1px solid rgba(14,35,88,0.08);">' +
            '<span style="font-weight:700;color:' + (c.ok ? '#0f7b4f' : (c.serious ? '#b3261e' : '#8a6d00')) + ';">' +
            (c.ok ? 'ok' : (c.serious ? 'SERIOUS' : 'note')) + '</span> ' +
            '<b>' + escapeHtml(c.check) + '</b><br>' +
            '<span style="font-size:13px;color:rgba(14,35,88,0.65);">' + escapeHtml(c.detail) + '</span></div>').join('') +
        '</div></body>');
});

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
        cloudflareOriginCheck: process.env.CF_ORIGIN_SECRET
            ? (process.env.CF_ORIGIN_STRICT === 'true' ? 'enforced site-wide' : 'enforced on form endpoints only')
            : 'off',
        turnstile: process.env.TURNSTILE_SECRET_KEY ? 'enforced' : 'OFF (forms accept unverified submissions)',
        submissionLog: submissions.LOG_DIR,
        database: db.status(),
        accounts: accounts.status(),
    };

    state.domains = await mailer.domainStatus();

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
    if (isDisposableDomain(emailDomain)) flags.push('disposable-email');
    else if (isFreeMailDomain(emailDomain)) flags.push('free-email');

    if (websiteHost && (isFreeMailDomain(websiteHost) || isDisposableDomain(websiteHost))) {
        flags.push('website-is-a-mailbox');
    }
    if (websiteHost && !(
        websiteHost === emailDomain ||
        websiteHost.endsWith('.' + emailDomain) ||
        emailDomain.endsWith('.' + websiteHost)
    )) flags.push('domain-mismatch');
    return flags;
}

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
        if (await breached.isBreached(password)) {
            return res.status(400).json({ error: 'That password has appeared in a data breach. Please choose a different one.' });
        }

        if (!db.available()) {
            return res.status(503).json({ error: 'Accounts are not available right now. Please try again shortly.' });
        }

        const emailDomain = email.split('@').pop();
        const flags = reviewFlags(emailDomain, '');

        const started = await accounts.startSignup({
            email,
            name: `${firstName} ${lastName}`,
            password,
            lang,
            flags,
        });

        if (started.reason === 'exists') {
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

        console.log('[auth] register: code sent, flags: ' + (flags.join(',') || 'none'));
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

        const ref = submissions.record('account', req, { email, name: out.name, lang: out.lang }, 'created');

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

        clearSignupCookie(res);
        if (out.session) setSessionCookie(res, out.session.token, out.session.maxAgeSeconds);
        else console.error('[auth] the account was made but no session could be opened');


        res.json({ ok: true, signedIn: Boolean(out.session), name: out.name });
    } catch (err) {
        console.error('[auth verify error]', err.message);
        res.status(500).json({ error: 'Could not create the account right now. Please try again shortly.' });
    }
});

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
            console.log('[auth] login: throttled');
            return res.status(429).json({
                error: 'Too many sign-in attempts. Please wait a moment and try again.',
                retryIn: out.retryIn,
            });
        }
        if (out.reason === 'totp-required') {
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

        tellAboutNewDevice(req, out).catch((err) =>
            console.error('[auth] new-device notice failed: ' + err.message));
    } catch (err) {
        console.error('[auth login error]', err.message);
        res.status(500).json({ error: 'Could not sign you in right now. Please try again shortly.' });
    }
});

app.post('/v1/auth/forgot', requireCloudflareOrigin, authForgotLimiter, async (req, res) => {
    const sent = () => res.json({ ok: true, resendIn: accounts.RESET_RESEND_WAIT_S });
    try {
        const b = req.body || {};
        if (typeof b.company_url === 'string' && b.company_url.trim() !== '') return sent();
        if (!(await verifyTurnstile(b['cf-turnstile-response'] || b.turnstileToken, req.realIp))) {
            return res.status(400).json({ error: 'Verification failed, please try again' });
        }

        const email = String(b.email || '').trim().toLowerCase().slice(0, 160);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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

        const found = await accounts.readReset(token);
        if (!found) return res.status(410).json({ error: 'expired' });

        const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
        const firstName = clean(b.firstName, 80);
        const lastName = clean(b.lastName, 80);
        const nameRe = /^[a-zA-ZÀ-ɏ'’.\- ]{2,}$/;

        if (!found.hasAccount) {
            if (!nameRe.test(firstName) || !nameRe.test(lastName) || b.consent !== true) {
                return res.status(400).json({ error: 'Invalid submission' });
            }
        }

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
        if (out.reason === 'bad-token') return res.status(410).json({ error: 'expired' });
        if (!out.ok) return res.status(503).json({ error: 'Accounts are not available right now. Please try again shortly.' });

        console.log('[auth] reset: ' + (out.created ? 'account created' : 'password changed') + ', other sessions ended');
        if (out.session) setSessionCookie(res, out.session.token, out.session.maxAgeSeconds);
        clearSignupCookie(res);
        res.json({ ok: true, created: out.created });

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

const authTotpLimiter = rateLimit({
    handler: limitHandler,
    windowMs: 15 * 60 * 1000,
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
    res.set('Cache-Control', 'no-store, private');
    res.json({
        ok: true,
        secret,
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
    tellMe(me.userId, { topic: 'me' });
    res.json({ ok: true, codes: out.codes });
});

app.post('/v1/account/totp/off', requireCloudflareOrigin, authTotpLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const out = await accounts.disableTotp(me.userId, String((req.body || {}).password || ''));
    if (out.reason === 'bad-password') return res.status(401).json({ error: 'That password is not right.' });
    if (!out.ok) return res.status(503).json({ error: 'Accounts are not available right now. Please try again shortly.' });
    tellMe(me.userId, { topic: 'me' });
    res.json({ ok: true });
});

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

    const ended = await accounts.revokeOtherSessions(me.userId, readSessionCookie(req));
    tellMe(me.userId, { topic: 'me' });
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

app.post('/v1/account/profile', requireCloudflareOrigin, accountLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const b = req.body || {};
    const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    const first = clean(b.firstName);
    const last = clean(b.lastName);

    if (!first) return res.status(400).json({ error: 'Please enter your first name.' });
    if (first.length > 60 || last.length > 60) {
        return res.status(400).json({ error: 'That name is too long.' });
    }
    if (/[<>\\/"]/.test(first + last)) {
        return res.status(400).json({ error: 'Please use letters only in your name.' });
    }

    const name = (first + ' ' + last).trim();
    const out = await accounts.setName(me.userId, name);
    if (!out.ok) {
        return res.status(503).json({ error: 'Accounts are not available right now. Please try again shortly.' });
    }
    res.set('Cache-Control', 'no-store, private');
    tellMe(me.userId, { topic: 'me' });
    res.json({ ok: true, name });
});

// the signed in version of /v1/auth/forgot. that one is open to the world, so it
// has to stand behind turnstile; this one needs a live session and can only ever
// send to the address on that session, so the check would protect nothing.
app.post('/v1/account/reset-password', requireCloudflareOrigin, accountLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    if (!db.available()) {
        return res.status(503).json({ error: 'Accounts are not available right now. Please try again shortly.' });
    }
    const lang = ['hr', 'de', 'en'].includes((req.body || {}).lang) ? req.body.lang : 'en';
    const started = await accounts.startReset(me.email, lang);
    if (!started.ok && started.reason === 'rate') {
        res.set('Retry-After', String(started.retryIn));
        return res.status(429).json({ error: 'Too many requests, please try again later' });
    }
    res.set('Cache-Control', 'no-store, private');
    res.json({ ok: true, resendIn: accounts.RESET_RESEND_WAIT_S });
});

// managing tokens is session only on purpose: a token must never be able to mint
// another token, or quietly widen its own reach by revoking and replacing itself.
// Resolving the organisation named in the address bar. The url is the authority
// here: a link to an organisation opens that organisation, and this is where the
// cookie is brought into line with it rather than the other way round.
app.get('/v1/orgs/slug/:slug', async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const mine = await orgs.bySlug(me.userId, req.params.slug);
    if (!mine) return res.status(404).json({ error: 'You are not in that organisation.' });
    setOrgCookie(res, mine.id);
    res.set('Cache-Control', 'no-store, private');
    res.json({ ok: true, org: mine });
});

app.get('/v1/orgs', async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    res.set('Cache-Control', 'no-store, private');
    const [mine, active] = await Promise.all([orgs.listFor(me.userId), orgFor(req, me)]);
    res.json({ ok: true, rows: mine, active: active, roles: orgs.ROLES });
});

app.post('/v1/orgs', requireCloudflareOrigin, accountLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const b = req.body || {};
    // only a host the caller actually gave. falling back to the signup address
    // wrote a personal email domain into a column that means the company's own,
    // which is where the organisation called "Aol" came from.
    const out = await orgs.create(me.userId, b.name, b.host, 'owner');
    if (!out.ok) {
        const said = {
            'no-name': 'Give the organisation a name.',
            'too-many': 'That is as many organisations as one person may belong to.',
        };
        return res.status(out.reason === 'unavailable' ? 503 : 400).json({
            error: said[out.reason] || 'Accounts are not available right now. Please try again shortly.',
        });
    }
    setOrgCookie(res, out.org.id);
    await accounts.audit('org-created', {
        actor: String(me.userId), subject: out.org.id, ip: req.realIp, detail: out.org.name,
    });
    tellMe(me.userId, { topic: 'orgs' });
    res.set('Cache-Control', 'no-store, private');
    res.json({ ok: true, org: out.org });
});

// switching is a membership check and nothing more: the cookie is set only after
// the lookup says this person is in that organisation.
app.post('/v1/orgs/:id/use', requireCloudflareOrigin, accountLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const mine = await orgs.membership(me.userId, req.params.id);
    if (!mine) return res.status(404).json({ error: 'You are not in that organisation.' });
    setOrgCookie(res, mine.id);
    res.set('Cache-Control', 'no-store, private');
    res.json({ ok: true, org: mine });
});

// what closing this organisation would take with it
app.get('/v1/orgs/:id/weight', async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const mine = await orgs.membership(me.userId, req.params.id);
    if (!mine) return res.status(404).json({ error: 'You are not in that organisation.' });
    res.set('Cache-Control', 'no-store, private');
    res.json({ ok: true, org: mine, weight: await orgs.weightOf(mine.id) });
});

// Projects, inside an organisation. Every one of these resolves the membership
// first and passes the organisation's id into the lookup, so a project id from
// another company does not answer here however it was come by.
app.get('/v1/orgs/:id/projects', async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const mine = await orgs.membership(me.userId, req.params.id);
    if (!mine) return res.status(404).json({ error: 'You are not in that organisation.' });
    res.set('Cache-Control', 'no-store, private');
    res.json({ ok: true, rows: await projects.listFor(mine.id), role: mine.role });
});

// What this organisation has done in a period. Every member may read it: it is
// their own company's work, and a viewer who cannot see how much was screened
// cannot check the number they are being asked about.
async function usageFor(req, mine) {
    // What a period is depends on what was bought. A subscription's periods run
    // from the day it started and are as long as its term, and that row is the
    // truth: the trial is only the anchor for an organisation that has not
    // bought anything yet.
    const [sub, plan] = await Promise.all([billing.get(mine.id), trial.get(mine.id)]);
    return usage.forOrg(mine.id, {
        anchor: (sub && sub.startedAt) || plan.startedAt || mine.createdAt,
        // a quarterly plan is invoiced for three months and allowed a quarter
        // of screening, so the window counted here is the window billed. with
        // no plan there is no term, and a month is the honest default.
        span: (sub && sub.termMonths) || 1,
        // a rolling window cannot begin before the organisation did
        birth: mine.createdAt,
        period: String(req.query.period || ''),
        scope: String(req.query.scope || ''),
        // whose day a day is. the screen knows which zone the reader chose, so
        // it says, and the counting follows rather than assuming utc.
        zone: String(req.query.tz || ''),
    });
}

app.get('/v1/orgs/:id/usage', async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const mine = await orgs.membership(me.userId, req.params.id);
    if (!mine) return res.status(404).json({ error: 'You are not in that organisation.' });
    res.set('Cache-Control', 'no-store, private');
    const [out, plan, listed, sub] = await Promise.all([
        usageFor(req, mine),
        trial.get(mine.id),
        sanctions.status(),
        billing.get(mine.id),
    ]);
    res.json({
        ...out,
        plan: { ...plan, historyLeft: plan.historyLeft === Infinity ? null : plan.historyLeft },
        subscription: sub,
        coverage: {
            source: 'OFAC SDN',
            listDate: listed.listDate || '',
            addresses: listed.addressCount || 0,
            refreshedAt: listed.refreshedAt || null,
        },
    });
});

// The same period as a file, because this page is also evidence: somebody is
// The log itself: every check this organisation has made, filtered the way
// somebody actually asks. Until now the product wrote a row with a digest and
// an encrypted record of what the lists said, and gave nobody a screen to look
// at one. Every member may read it: it is their own company's work, and being
// asked to stand behind a number you cannot open is not a position to put
// somebody in.
app.get('/v1/orgs/:id/checks', async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const mine = await orgs.membership(me.userId, req.params.id);
    if (!mine) return res.status(404).json({ error: 'You are not in that organisation.' });
    res.set('Cache-Control', 'no-store, private');
    try {
        const q = req.query || {};
        const out = await screening.log(mine.id, {
            sandbox: String(q.scope || '') === 'sandbox',
            from: q.from || '',
            to: q.to || '',
            verdict: String(q.verdict || ''),
            project: String(q.project || ''),
            address: String(q.address || '').slice(0, 128),
            cursor: q.cursor || '',
            limit: q.limit,
        });
        res.json({ ok: true, ...out });
    } catch (err) {
        console.error('[checks]', err.message);
        res.status(500).json({ error: 'Could not read the log' });
    }
});

// One check, with what the lists said at the moment it ran. This is the
// evidence: the digest is over the record as it was sealed, so a copy handed
// to somebody else can be checked against it.
app.get('/v1/orgs/:id/checks/:check', async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const mine = await orgs.membership(me.userId, req.params.id);
    if (!mine) return res.status(404).json({ error: 'You are not in that organisation.' });
    res.set('Cache-Control', 'no-store, private');
    try {
        const sandbox = String(req.query.scope || '') === 'sandbox';
        const doc = await screening.byId(mine.id, req.params.check, sandbox);
        if (!doc) return res.status(404).json({ error: 'No such check.' });
        res.json({ ok: true, check: doc });
    } catch (err) {
        console.error('[check]', err.message);
        res.status(500).json({ error: 'Could not read that check' });
    }
});

// asked what was screened in March and has to hand over something that can be
// kept and read without an account.
app.get('/v1/orgs/:id/usage.csv', async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const mine = await orgs.membership(me.userId, req.params.id);
    if (!mine) return res.status(404).send('You are not in that organisation.');
    const out = await usageFor(req, mine);
    if (!out.ok) return res.status(503).send('Not available right now.');
    const name = 'sentinelpay-usage-' + out.period.from.slice(0, 10) + '.csv';
    res.set('Cache-Control', 'no-store, private');
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="' + name + '"');
    // a browser that decides for itself what a downloaded file is can decide it
    // is html, and a csv full of somebody's addresses is not a page to render
    res.set('X-Content-Type-Options', 'nosniff');
    await accounts.audit('usage-export', {
        actor: String(me.userId), subject: String(me.userId), ip: req.realIp,
        detail: mine.slug + ' ' + out.period.from.slice(0, 10),
    });
    res.send(usage.csv(out, mine));
});

// What this organisation is on, what it costs, when it renews, and what it has
// been on before. Any member may read it: the plan decides what everybody here
// can do, so it is not an owner's private business.
app.get('/v1/orgs/:id/subscription', async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const mine = await orgs.membership(me.userId, req.params.id);
    if (!mine) return res.status(404).json({ error: 'You are not in that organisation.' });
    res.set('Cache-Control', 'no-store, private');
    const [sub, past] = await Promise.all([billing.get(mine.id), billing.history(mine.id, 50)]);
    res.json({ ok: true, subscription: sub, history: past, catalogue: plans.catalogue() });
});

// Taking a plan is spending the company's money, so it is the owner's or an
// admin's to do, the same as closing the organisation is.
app.post('/v1/orgs/:id/subscription', requireCloudflareOrigin, accountLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const mine = await orgs.membership(me.userId, req.params.id);
    if (!mine) return res.status(404).json({ error: 'You are not in that organisation.' });
    if (!orgs.roleAtLeast(mine.role, 'admin')) {
        return res.status(403).json({ error: 'Only an admin or the owner can change the plan.' });
    }
    const body = req.body || {};
    const out = await billing.start(mine.id, me.userId, { plan: body.plan, term: body.term });
    if (!out.ok) {
        const said = {
            'bad-plan': 'That is not one of the plans.',
            'bad-term': 'That is not one of the billing terms.',
            'unavailable': 'Not available right now.',
        };
        return res.status(400).json({ error: said[out.reason] || 'Could not change the plan.' });
    }
    await tellOrg(mine.id, { topic: 'org', id: String(mine.id) });
    await tellOrg(mine.id, { topic: 'orgs' });
    await accounts.audit('plan-started', {
        actor: String(me.userId), subject: String(me.userId), ip: req.realIp,
        detail: mine.slug + ' ' + out.subscription.plan + '/' + out.subscription.term,
    });
    res.json(out);
});

app.post('/v1/orgs/:id/subscription/cancel', requireCloudflareOrigin, accountLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const mine = await orgs.membership(me.userId, req.params.id);
    if (!mine) return res.status(404).json({ error: 'You are not in that organisation.' });
    if (!orgs.roleAtLeast(mine.role, 'admin')) {
        return res.status(403).json({ error: 'Only an admin or the owner can change the plan.' });
    }
    const back = String((req.body || {}).resume || '') === 'yes';
    const out = back ? await billing.resume(mine.id, me.userId) : await billing.cancel(mine.id, me.userId);
    if (!out.ok) return res.status(400).json({ error: 'There is nothing to change.' });
    await tellOrg(mine.id, { topic: 'org', id: String(mine.id) });
    await accounts.audit(back ? 'plan-resumed' : 'plan-cancelled', {
        actor: String(me.userId), subject: String(me.userId), ip: req.realIp,
        detail: mine.slug,
    });
    res.json(out);
});

app.post('/v1/orgs/:id/projects', requireCloudflareOrigin, accountLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const mine = await orgs.membership(me.userId, req.params.id);
    if (!mine) return res.status(404).json({ error: 'You are not in that organisation.' });
    if (!orgs.roleAtLeast(mine.role, 'admin')) {
        return res.status(403).json({ error: 'Only an admin or the owner can add a project.' });
    }
    const out = await projects.create(mine.id, (req.body || {}).name);
    if (!out.ok) {
        const said = {
            'no-name': 'Give the project a name.',
            'too-many': 'That is as many projects as one organisation may have.',
        };
        return res.status(out.reason === 'unavailable' ? 503 : 400).json({
            error: said[out.reason] || 'Accounts are not available right now. Please try again shortly.',
        });
    }
    await accounts.audit('project-created', {
        actor: String(me.userId), subject: out.project.id, ip: req.realIp, detail: out.project.name,
    });
    await tellOrg(mine.id, { topic: 'org', id: String(mine.id) });
    res.set('Cache-Control', 'no-store, private');
    res.json({ ok: true, project: out.project });
});

app.post('/v1/orgs/:id/projects/:pid/rename', requireCloudflareOrigin, accountLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const mine = await orgs.membership(me.userId, req.params.id);
    if (!mine) return res.status(404).json({ error: 'You are not in that organisation.' });
    if (!orgs.roleAtLeast(mine.role, 'admin')) {
        return res.status(403).json({ error: 'Only an admin or the owner can rename a project.' });
    }
    const out = await projects.rename(mine.id, req.params.pid, (req.body || {}).name);
    if (!out.ok) {
        const said = { 'no-name': 'Give the project a name.', missing: 'No such project.' };
        return res.status(out.reason === 'unavailable' ? 503 : (out.reason === 'missing' ? 404 : 400))
            .json({ error: said[out.reason] || 'Accounts are not available right now. Please try again shortly.' });
    }
    await accounts.audit('project-renamed', {
        actor: String(me.userId), subject: out.project.id, ip: req.realIp, detail: out.project.name,
    });
    await tellOrg(mine.id, { topic: 'org', id: String(mine.id) });
    res.json({ ok: true, project: out.project });
});

app.post('/v1/orgs/:id/projects/:pid/archive', requireCloudflareOrigin, accountLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const mine = await orgs.membership(me.userId, req.params.id);
    if (!mine) return res.status(404).json({ error: 'You are not in that organisation.' });
    if (!orgs.roleAtLeast(mine.role, 'admin')) {
        return res.status(403).json({ error: 'Only an admin or the owner can archive a project.' });
    }
    const on = Boolean((req.body || {}).archived);
    const out = await projects.archive(mine.id, req.params.pid, on);
    if (!out.ok) {
        return res.status(out.reason === 'missing' ? 404 : 503).json({
            error: out.reason === 'missing' ? 'No such project.'
                : 'Accounts are not available right now. Please try again shortly.',
        });
    }
    await accounts.audit(on ? 'project-archived' : 'project-restored', {
        actor: String(me.userId), subject: out.project.id, ip: req.realIp, detail: out.project.name,
    });
    await tellOrg(mine.id, { topic: 'org', id: String(mine.id) });
    res.json({ ok: true, project: out.project });
});

app.post('/v1/orgs/:id/projects/:pid/delete', requireCloudflareOrigin, accountLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const mine = await orgs.membership(me.userId, req.params.id);
    if (!mine) return res.status(404).json({ error: 'You are not in that organisation.' });
    if (!orgs.roleAtLeast(mine.role, 'admin')) {
        return res.status(403).json({ error: 'Only an admin or the owner can remove a project.' });
    }
    const out = await projects.remove(mine.id, req.params.pid);
    if (!out.ok) {
        return res.status(out.reason === 'missing' ? 404 : 503)
            .json({ error: out.reason === 'missing' ? 'No such project.' : 'Accounts are not available right now. Please try again shortly.' });
    }
    await accounts.audit('project-removed', {
        actor: String(me.userId), subject: out.project.id, ip: req.realIp, detail: out.project.name,
    });
    await tellOrg(mine.id, { topic: 'org', id: String(mine.id) });
    res.json({ ok: true });
});

app.get('/v1/orgs/:id/members', async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const rows = await orgs.members(me.userId, req.params.id);
    if (!rows) return res.status(404).json({ error: 'You are not in that organisation.' });
    res.set('Cache-Control', 'no-store, private');
    res.json({ ok: true, rows, roles: orgs.ROLES });
});

// the word for a role, for a mail that has to read as a sentence
function roleLabel(key) {
    const found = orgs.ROLES.filter((r) => r.key === key)[0];
    return found ? found.label : String(key || '');
}

app.get('/v1/orgs/:id/invites', async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const mine = await orgs.membership(me.userId, req.params.id);
    if (!mine) return res.status(404).json({ error: 'You are not in that organisation.' });
    res.set('Cache-Control', 'no-store, private');
    res.json({ ok: true, rows: await invites.listFor(mine.id), days: invites.DAY_OPTIONS });
});

// Sending them. One request carries however many addresses were typed, and each
// is answered for separately: one bad address does not throw the rest away, and
// the caller is told which is which.
app.post('/v1/orgs/:id/invites', requireCloudflareOrigin, accountLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const mine = await orgs.membership(me.userId, req.params.id);
    if (!mine) return res.status(404).json({ error: 'You are not in that organisation.' });
    if (!orgs.roleAtLeast(mine.role, 'admin')) {
        return res.status(403).json({ error: 'Only an admin or the owner can invite people.' });
    }

    const b = req.body || {};
    const wanted = String(b.emails || '')
        .split(/[\s,;]+/)
        .map((x) => invites.cleanEmail(x))
        .filter(Boolean);
    if (!wanted.length) return res.status(400).json({ error: 'Give at least one address.' });
    if (wanted.length > 20) return res.status(400).json({ error: 'Twenty addresses at a time.' });

    const said = {
        'bad-email': 'That is not an address.',
        'bad-role': 'That is not a role.',
        'already-in': 'They are already in this organisation.',
        'wrong-domain': 'That address is not on this organisation\'s domain.',
        'too-many': 'There are as many open invitations as this organisation may have.',
    };
    const out = [];
    for (const email of wanted) {
        const made = await invites.create(mine.id, me.userId, {
            email,
            role: b.role,
            days: b.days,
            needMfa: b.needMfa === true,
            sameDomain: b.sameDomain === true,
            domain: invites.domainOf(me.email),
        });
        if (!made.ok) {
            out.push({ email, ok: false, error: said[made.reason] || 'Could not send that one.' });
            continue;
        }
        const link = SITE_URL + '/invite/' + made.secret;
        // the mail is the usual way in, but the link is returned either way:
        // an environment with no mail configured can still invite somebody by
        // passing it along, and saying so beats a screen that looks like it
        // worked when nothing left the building.
        let mailed = false;
        try {
            if (mailer.isConfigured()) {
                await mailer.sendInvite({
                    to: email, link, lang: geoLang(req), org: mine.name,
                    role: roleLabel(b.role), days: Number(b.days) || invites.DEFAULT_DAYS,
                });
                mailed = true;
            }
        } catch (err) {
            console.error('[invites] mail failed: ' + err.message);
        }
        await accounts.audit('invite-sent', {
            actor: String(me.userId), subject: made.invite.id, ip: req.realIp,
            detail: made.invite.role + (mailed ? ' mailed' : ' link only'),
        });
        out.push({ email, ok: true, mailed, link, invite: made.invite });
    }

    await tellOrg(mine.id, { topic: 'org', id: String(mine.id) });
    res.set('Cache-Control', 'no-store, private');
    res.json({ ok: out.some((r) => r.ok), results: out });
});

app.post('/v1/orgs/:id/invites/:inviteId/revoke', requireCloudflareOrigin, accountLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const mine = await orgs.membership(me.userId, req.params.id);
    if (!mine) return res.status(404).json({ error: 'You are not in that organisation.' });
    if (!orgs.roleAtLeast(mine.role, 'admin')) {
        return res.status(403).json({ error: 'Only an admin or the owner can withdraw an invitation.' });
    }
    const out = await invites.revoke(mine.id, req.params.inviteId);
    if (!out.ok) {
        return res.status(out.reason === 'missing' ? 404 : 503)
            .json({ error: out.reason === 'missing' ? 'That invitation is already gone.'
                : 'Accounts are not available right now. Please try again shortly.' });
    }
    await accounts.audit('invite-withdrawn', {
        actor: String(me.userId), subject: String(req.params.inviteId), ip: req.realIp, detail: '',
    });
    await tellOrg(mine.id, { topic: 'org', id: String(mine.id) });
    res.json({ ok: true });
});

app.post('/v1/orgs/:id/members/:uid/role', requireCloudflareOrigin, accountLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const out = await orgs.setRole(me.userId, req.params.id, req.params.uid, (req.body || {}).role);
    if (!out.ok) {
        const said = {
            'bad-role': 'That is not a role.',
            missing: 'You are not in that organisation.',
            'not-allowed': 'Only an admin or the owner can change what someone may do.',
            'not-yourself': 'You cannot change your own role.',
            'not-a-member': 'They are not in this organisation.',
            'not-the-owner': "The owner's role cannot be changed here.",
            'one-owner': 'An organisation has one owner.',
        };
        const code = out.reason === 'missing' || out.reason === 'not-a-member' ? 404
            : (out.reason === 'not-allowed' ? 403 : 400);
        return res.status(out.reason === 'unavailable' ? 503 : code)
            .json({ error: said[out.reason] || 'Accounts are not available right now. Please try again shortly.' });
    }
    await accounts.audit('member-role-changed', {
        actor: String(me.userId), subject: String(req.params.uid), ip: req.realIp, detail: out.role,
    });
    // the one whose role changed hears it on every screen they have open, and
    // so does everyone looking at the team list
    await tellOrg(req.params.id, { topic: 'org', id: String(req.params.id) });
    tellMe(req.params.uid, { topic: 'orgs' });
    res.json({ ok: true, role: out.role });
});

app.post('/v1/orgs/:id/members/:uid/remove', requireCloudflareOrigin, accountLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const out = await orgs.removeMember(me.userId, req.params.id, req.params.uid);
    if (!out.ok) {
        const said = {
            missing: 'You are not in that organisation.',
            'not-allowed': 'Only an admin or the owner can take someone out.',
            'not-a-member': 'They are not in this organisation.',
            'not-the-owner': 'The owner stays until the organisation is closed.',
        };
        const code = out.reason === 'missing' || out.reason === 'not-a-member' ? 404
            : (out.reason === 'not-allowed' ? 403 : 400);
        return res.status(out.reason === 'unavailable' ? 503 : code)
            .json({ error: said[out.reason] || 'Accounts are not available right now. Please try again shortly.' });
    }
    // walking out of the last organisation you were in leaves the cookie
    // pointing at somewhere you can no longer go
    if (out.left) clearOrgCookie(res);
    // told before they are gone from the list would be too early, and after
    // they are gone the org address no longer includes them, so the person who
    // left is named on their own
    await tellOrg(req.params.id, { topic: 'org', id: String(req.params.id) });
    tellMe(req.params.uid, { topic: 'orgs' });
    await accounts.audit(out.left ? 'member-left' : 'member-removed', {
        actor: String(me.userId), subject: String(req.params.uid), ip: req.realIp, detail: '',
    });
    res.json({ ok: true, left: Boolean(out.left) });
});

app.post('/v1/orgs/:id/rename', requireCloudflareOrigin, accountLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const out = await orgs.rename(me.userId, req.params.id, (req.body || {}).name);
    if (!out.ok) {
        const said = {
            'no-name': 'Give the organisation a name.',
            missing: 'You are not in that organisation.',
            'not-allowed': 'Only an admin or the owner can rename an organisation.',
        };
        const code = out.reason === 'missing' ? 404 : (out.reason === 'not-allowed' ? 403 : 400);
        return res.status(out.reason === 'unavailable' ? 503 : code).json({
            error: said[out.reason] || 'Accounts are not available right now. Please try again shortly.',
        });
    }
    await accounts.audit('org-renamed', {
        actor: String(me.userId), subject: out.org.id, ip: req.realIp, detail: out.org.name,
    });
    await tellOrg(out.org.id, { topic: 'orgs' });
    await tellOrg(out.org.id, { topic: 'org', id: String(out.org.id) });
    res.set('Cache-Control', 'no-store, private');
    res.json({ ok: true, org: out.org });
});

app.post('/v1/orgs/:id/delete', requireCloudflareOrigin, accountLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const mine = await orgs.membership(me.userId, req.params.id);
    if (!mine) return res.status(404).json({ error: 'You are not in that organisation.' });

    // typing the name back is the whole guard here, because what follows cannot
    // be undone and takes the work with it
    const said = String((req.body || {}).name || '').trim();
    if (said.toLowerCase() !== String(mine.name || '').trim().toLowerCase()) {
        return res.status(400).json({ error: 'That is not the name of this organisation.' });
    }

    // gathered first: once it is closed there is no membership left to ask
    const wasIn = await orgs.memberIds(mine.id);
    const out = await orgs.remove(me.userId, mine.id);
    if (!out.ok) {
        if (out.reason === 'not-owner') {
            return res.status(403).json({ error: 'Only the owner can close an organisation.' });
        }
        if (out.reason === 'missing') {
            return res.status(404).json({ error: 'You are not in that organisation.' });
        }
        return res.status(503).json({ error: 'Accounts are not available right now. Please try again shortly.' });
    }
    if (readCookie(req, ORG_COOKIE) === String(mine.id)) clearOrgCookie(res);
    live.publish(wasIn, { topic: 'orgs' });
    await accounts.audit('org-closed', {
        actor: String(me.userId), subject: mine.id, ip: req.realIp, detail: mine.name,
    });
    res.json({ ok: true });
});

app.get('/v1/account/tokens', async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    res.set('Cache-Control', 'no-store, private');
    const org = await orgFor(req, me);
    if (!org) return res.status(409).json({ error: 'Choose an organisation first' });
    res.json({
        ok: true,
        org: org,
        scopes: tokens.SCOPES,
        scopeGroups: tokens.SCOPE_GROUPS,
        kinds: tokens.KINDS,
        rows: await tokens.list(org.id),
    });
});

app.post('/v1/account/tokens', requireCloudflareOrigin, accountLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const b = req.body || {};
    const org = await orgFor(req, me);
    if (!org) return res.status(409).json({ error: 'Choose an organisation first' });
    // issuing a key into the company is an administrator's job
    if (!orgs.roleAtLeast(org.role, 'admin')) {
        return res.status(403).json({ error: 'Only an admin can issue a token.' });
    }
    const out = await tokens.mint(me.userId, org.id, b.name, b.scopes, b.days, b.kind, b.project);
    if (!out.ok) {
        const said = {
            'no-name': 'Give the token a name you will recognise later.',
            'no-scopes': 'Pick at least one thing this token may do.',
            'no-project': 'That project does not belong to this organisation.',
            'too-many': 'That is as many live tokens as one account may hold.',
        };
        return res.status(out.reason === 'unavailable' ? 503 : 400).json({
            error: said[out.reason] || 'Accounts are not available right now. Please try again shortly.',
        });
    }
    await tellOrg(org.id, { topic: 'org', id: String(org.id) });
    await accounts.audit('token-created', {
        actor: String(me.userId), subject: out.row.id, ip: req.realIp,
        detail: out.row.kind + ' ' + out.row.scopes.join(' '),
    });
    res.set('Cache-Control', 'no-store, private');
    res.json({ ok: true, token: out.token, row: out.row });
});

app.post('/v1/account/tokens/:id/revoke', requireCloudflareOrigin, accountLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const org = await orgFor(req, me);
    if (!org) return res.status(409).json({ error: 'Choose an organisation first' });
    if (!orgs.roleAtLeast(org.role, 'admin')) {
        return res.status(403).json({ error: 'Only an admin can revoke a token.' });
    }
    const out = await tokens.revoke(org.id, req.params.id);
    if (!out.ok) {
        if (out.reason === 'missing') return res.status(404).json({ error: 'That token is already gone.' });
        return res.status(503).json({ error: 'Accounts are not available right now. Please try again shortly.' });
    }
    await tellOrg(org.id, { topic: 'org', id: String(org.id) });
    await accounts.audit('token-revoked', {
        actor: String(me.userId), subject: String(req.params.id), ip: req.realIp,
    });
    res.json({ ok: true });
});

app.get('/v1/account/sessions', async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    res.set('Cache-Control', 'no-store, private');
    res.json({ ok: true, sessions: await accounts.listSessions(me.userId, readSessionCookie(req)) });
});

// Your own trail, and only yours: the actor filter is the whole guard here, so
// the id comes from the session rather than from anything the caller sent.
// Two ways to address a notice. An organisation's members all see the same
// change, so they are told together; anything about one account goes to that
// account's own screens.
async function tellOrg(orgId, event) {
    try {
        live.publish(await orgs.memberIds(orgId), event);
    } catch (err) {
        console.error('[live] could not tell an organisation: ' + err.message);
    }
}
function tellMe(userId, event) {
    live.publish([userId], event);
}

// The connection that carries notices. Held open, so it is deliberately not
// behind the rate limiter that counts requests: one screen opens one of these
// and keeps it.
app.get('/v1/live', async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const close = live.open(res, me.userId);
    req.on('close', close);
    req.on('error', close);
});

app.get('/v1/account/logs', async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const rows = await accounts.recentAudit({ actor: String(me.userId), limit: 100 });
    res.set('Cache-Control', 'no-store, private');
    res.json({
        ok: true,
        rows: rows.map((r) => ({
            at: r.at,
            kind: r.kind,
            detail: r.detail || '',
            ip: r.ip || '',
        })),
    });
});

app.post('/v1/account/sessions/revoke', requireCloudflareOrigin, accountLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const ended = await accounts.revokeOtherSessions(me.userId, readSessionCookie(req));
    tellMe(me.userId, { topic: 'me' });
    res.json({ ok: true, ended });
});

app.post('/v1/account/delete', requireCloudflareOrigin, accountLimiter, async (req, res) => {
    const me = await requireSession(req, res);
    if (!me) return;
    const out = await accounts.deleteAccount(me.userId, String((req.body || {}).password || ''));
    if (out.reason === 'bad-password') return res.status(401).json({ error: 'That password is not right.' });
    if (!out.ok) return res.status(503).json({ error: 'Accounts are not available right now. Please try again shortly.' });
    clearSessionCookie(res);
    clearOrgCookie(res);
    console.log('[account] deleted at the owner\'s request');
    res.json({ ok: true });
});

app.post('/v1/auth/logout', requireCloudflareOrigin, async (req, res) => {
    try {
        await accounts.endSession(readSessionCookie(req));
    } catch (err) {
        console.error('[auth logout error]', err.message);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
});

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
        const staff = staffList().includes(String(me.email || '').toLowerCase());
        res.json({
            signedIn: true, name: me.name, email: me.email, since: me.since, staff,
            totp: Boolean(me.totpOn),
            mfa: Boolean(me.mfa),
            recoveryLeft: me.totpOn ? await accounts.recoveryLeft(me.userId) : 0,
            staffNeeds2fa: staff && STAFF_REQUIRE_2FA && !me.totpOn,
        });
    } catch (err) {
        console.error('[auth me error]', err.message);
        res.json({ signedIn: false });
    }
});

// Everything a signed-in dashboard needs to draw itself. One function, because
// it is answered twice: over the wire to /v1/entitlement, and written into the
// page itself so the first frame is the finished screen rather than an empty
// one waiting on a request.
async function entitlementFor(req, me, known) {
    // the organisation can be named by the address, which is better than the
    // cookie: a page opened by its own link should not have to wait for a
    // round trip to learn which organisation it is showing.
    const org = known || await orgFor(req, me);
    const [state, listed, runs, mine, sub] = await Promise.all([
        // the plan of the organisation in front of you. without one there is
        // nothing for a plan to belong to, so it comes back as none.
        org ? trial.ensure(org.id, me.userId, me.email) : trial.get(0),
        sanctions.status(),
        org ? screening.countFor(org.id) : 0,
        orgs.listFor(me.userId),
        org ? billing.get(org.id) : null,
    ]);
    return {
        name: me.name,
        email: me.email,
        since: me.since,
        // the security screen says whether a second step is on, so it has to be
        // told rather than left to guess and say no
        totpOn: Boolean(me.totpOn),
        org: org,
        orgs: mine,
        trial: {
            ...state,
            historyLeft: state.historyLeft === Infinity ? null : state.historyLeft,
        },
        screeningsRun: runs,
        subscription: sub,
        coverage: {
            source: 'OFAC SDN',
            listDate: listed.listDate || '',
            addresses: listed.addressCount || 0,
            refreshedAt: listed.refreshedAt || null,
        },
    };
}

app.get('/v1/entitlement', async (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    try {
        const me = await currentUser(req);
        if (!me) return res.status(401).json({ error: 'Sign in first' });
        res.json(await entitlementFor(req, me));
    } catch (err) {
        console.error('[entitlement]', err.message);
        res.status(500).json({ error: 'Could not read the account' });
    }
});

app.post('/v1/trial/activate', trialActivateLimiter, async (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    try {
        const me = await currentUser(req);
        if (!me) return res.status(401).json({ error: 'Sign in first' });
        const b = req.body || {};
        const org = await orgFor(req, me);
        if (!org) return res.status(400).json({ error: 'Choose an organisation first.' });
        if (!orgs.roleAtLeast(org.role, 'admin')) {
            return res.status(403).json({ error: 'Only an admin or the owner can start a plan.' });
        }
        const out = await trial.activate(org.id, me.userId, {
            email: me.email,
            website: b.website,
            company: b.company,
            consent: b.consent === true,
            notGambling: b.notGambling === true,
        });
        if (!out.ok) {
            const said = {
                'both-confirmations-required': 'Both confirmations are required',
                'bad-website': 'That does not look like a company website',
                'bad-email': 'Your account address is not usable for this',
                'company-already-has-a-trial': 'This company already has a trial. Ask a colleague for access.',
                'unavailable': 'Not available right now',
            };
            return res.status(400).json({ error: said[out.reason] || 'Could not start the trial' });
        }
        await tellOrg(org.id, { topic: 'org', id: String(org.id) });
        await tellOrg(org.id, { topic: 'orgs' });
        await accounts.audit('trial-activated', {
            actor: String(me.userId), subject: String(me.userId), ip: req.realIp,
            detail: out.state + ' ' + out.companyHost,
        });
        res.json(out);
    } catch (err) {
        console.error('[trial activate]', err.message);
        res.status(500).json({ error: 'Could not start the trial' });
    }
});

app.post('/v1/screen', screenLimiter, async (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    try {
        const me = await caller(req, res, 'screenings:write');
        if (!me) return;

        const address = String((req.body && req.body.address) || '').trim();
        if (!address) return res.status(400).json({ error: 'Paste an address first' });
        if (address.length > 128) return res.status(400).json({ error: 'That is too long to be an address' });

        const kind = (req.body && req.body.kind) === 'history' ? 'history' : 'live';

        // a sandbox call is for writing an integration against, so it screens
        // against the same sanctions data but spends nothing and lands in its own
        // history. nothing it does can touch what the customer reports on.
        if (me.sandbox) {
            const out = await screening.screen(me.userId, me.org.id, address, kind, true, me.project);
            if (!out.ok) return res.status(400).json({ error: 'That does not look like an address' });
            // A sandbox check spends nothing and is billed for nothing, but it
            // is still a row the usage screen counts when the scope is set to
            // Sandbox. This path returned without telling anybody, so that
            // screen was the one place in the product that did not move while
            // somebody was working in front of it.
            await tellOrg(me.org.id, { topic: 'org', id: String(me.org.id) });
            return res.json({ ...out, sandbox: true, trial: null });
        }

        const spent = await trial.spend(me.org.id, kind);
        if (!spent.ok) {
            const said = {
                'no-trial': 'Start your trial first',
                'awaiting-approval': 'Your trial is waiting on us, we will email you',
                'trial-expired': 'Your trial has ended',
                'out-of-checks': 'No checks left on this trial',
                'history-locked': 'Verify your number to open your history',
            };
            return res.status(402).json({
                error: said[spent.reason] || 'Not available on this trial',
                reason: spent.reason,
                trial: { ...spent, historyLeft: spent.historyLeft === Infinity ? null : spent.historyLeft },
            });
        }

        const out = await screening.screen(me.userId, me.org.id, address, kind, false, me.project);
        if (!out.ok) return res.status(400).json({ error: 'That does not look like an address' });

        await tellOrg(me.org.id, { topic: 'org', id: String(me.org.id) });
        await accounts.audit('screening', {
            actor: String(me.userId), subject: String(me.userId), ip: req.realIp,
            detail: out.verdict + ' ' + (out.asset || '?'),
        });

        const left = await trial.get(me.org.id);
        res.json({
            ...out,
            trial: { ...left, historyLeft: left.historyLeft === Infinity ? null : left.historyLeft },
        });
    } catch (err) {
        console.error('[screen]', err.message);
        res.status(500).json({ error: 'The check could not be completed' });
    }
});

app.get('/v1/screenings', async (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    try {
        const me = await caller(req, res, 'screenings:read');
        if (!me) return;
        res.json({ sandbox: me.sandbox, rows: await screening.recent(me.org.id, req.query.limit, me.sandbox) });
    } catch (err) {
        console.error('[screenings]', err.message);
        res.status(500).json({ error: 'Could not read the log' });
    }
});

app.get('/v1/screenings/stats', async (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    try {
        const me = await caller(req, res, 'screenings:read');
        if (!me) return;
        const [numbers, listed] = await Promise.all([
            screening.stats(me.org.id, req.query.days, me.sandbox),
            sanctions.status(),
        ]);
        res.json({
            ...numbers,
            coverage: {
                sources: [{
                    name: 'OFAC SDN',
                    authority: 'United States, Office of Foreign Assets Control',
                    listDate: listed.listDate || '',
                    addresses: listed.addressCount || 0,
                    refreshedAt: listed.refreshedAt || null,
                    live: true,
                }],
                pending: [
                    { name: 'EU consolidated list', authority: 'European Union' },
                    { name: 'UK sanctions list', authority: 'FCDO, United Kingdom' },
                    { name: 'UN consolidated list', authority: 'United Nations' },
                ],
            },
        });
    } catch (err) {
        console.error('[screening stats]', err.message);
        res.status(500).json({ error: 'Could not read the numbers' });
    }
});

app.get('/v1/screenings/:id/evidence', async (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    try {
        const me = await caller(req, res, 'evidence:read');
        if (!me) return;
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Not a screening' });
        const row = await screening.byId(me.org.id, id, me.sandbox);
        if (!row) return res.status(404).json({ error: 'Not found' });
        const doc = {
            document: 'Sentinelpay screening evidence',
            screeningId: id,
            issuedAt: new Date().toISOString(),
            issuedTo: me.email,
            subject: { address: row.address, asset: row.asset || '', chain: row.chain || '' },
            verdict: row.verdict,
            checkedAt: row.checkedAt,
            reasons: row.reasons,
            sources: row.sources,
            digest: row.digest,
            note: 'The digest is taken over the sealed record as it was written. Recomputing it over this document will not match; it identifies the stored record.',
        };
        res.set('Content-Type', 'application/json; charset=utf-8');
        res.set('Content-Disposition', 'attachment; filename="sentinelpay-screening-' + id + '.json"');
        res.set('X-Content-Type-Options', 'nosniff');
        res.send(JSON.stringify(doc, null, 2));
    } catch (err) {
        console.error('[screening evidence]', err.message);
        res.status(500).json({ error: 'Could not build the file' });
    }
});

app.get('/v1/screenings/:id', async (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    try {
        const me = await caller(req, res, 'screenings:read');
        if (!me) return;
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Not a screening' });
        const row = await screening.byId(me.org.id, id, me.sandbox);
        if (!row) return res.status(404).json({ error: 'Not found' });
        res.json(row);
    } catch (err) {
        console.error('[screening read]', err.message);
        res.status(500).json({ error: 'Could not read it' });
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

        if (!nameRe.test(firstName) || !nameRe.test(lastName) ||
            !emailRe.test(email) || !website ||
            b.consent !== true || b.notGambling !== true) {
            return res.status(400).json({ error: 'Invalid submission' });
        }

        const host = website.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./i, '').toLowerCase();
        const emailDomain = email.split('@').pop().toLowerCase();

        const flags = reviewFlags(emailDomain, host);
        if (flags.indexOf('domain-mismatch') !== -1) {
            return res.status(400).json({ error: 'Website domain must match your work email domain' });
        }

        if (industry && /gambling|igaming|casino|betting|sportsbook|wager/i.test(industry)) {
            return res.status(400).json({ error: 'We do not onboard gambling operators' });
        }

        const lang = ['hr', 'de', 'en'].includes(b.lang) ? b.lang : 'en';

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

        if (/gambling|igaming|casino|betting|sportsbook|wager/i.test(industry)) {
            return res.status(400).json({ error: 'We do not onboard gambling operators' });
        }

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

    submissions.startRetention();

    // Work that predates organisations joins whichever one its owner belongs to,
    // once they have made it. Nothing here invents an organisation: an account
    // with none stays with none, and is asked to make one.
    orgs.reslug()
        .then(() => Promise.all([projects.init(), invites.init(), billing.init(), tokens.adopt(), screening.adopt(), trial.adopt()]))
        .catch((err) => console.error('[orgs] migration at boot failed: ' + err.message));

    const dbState = db.status();
    if (!dbState.configured) {
        console.error('[db] DATABASE_URL is not set: submissions go to ' + submissions.LOG_DIR +
            ', which a redeploy wipes');
    } else {
        if (!dbState.encrypted) {
            console.error('[db] SUBMISSIONS_KEY is not set: personal data will be stored unencrypted');
        }
        db.startRetention();
        startRateSweep();
        sanctions.startRefresh();
        setTimeout(() => { accounts.purge(); }, 45000).unref();
        setInterval(() => { accounts.purge(); }, 6 * 60 * 60 * 1000).unref();
    }
});
