(function () {
    'use strict';

    var app = document.getElementById('app');
    var side = document.getElementById('side');
    var menuBtn = document.getElementById('menu-btn');
    var scrim = document.getElementById('scrim');

    function setMenu(open) {
        if (!app) return;
        app.classList.toggle('is-open', open);
        if (menuBtn) menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (side) side.setAttribute('aria-hidden', open || window.innerWidth > 900 ? 'false' : 'true');
    }

    if (menuBtn) {
        menuBtn.addEventListener('click', function () {
            setMenu(!app.classList.contains('is-open'));
        });
    }
    if (scrim) scrim.addEventListener('click', function () { setMenu(false); });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') setMenu(false);
    });
    window.addEventListener('resize', function () {
        if (window.innerWidth > 900) setMenu(false);
    });

    // One glyph, one meaning. Nothing in here is drawn twice for two different
    // things: a reader learns an icon by what it opened last time, so the same
    // mark on two screens teaches them something untrue. test/icons.test.js
    // fails the build if an icon is ever given a second meaning.
    var ICONS = {
        // the organisation's rail
        projects: '<path d="M4 8.4 12 4.2l8 4.2-8 4.2Z"/><path d="m4 13.2 8 4.2 8-4.2"/>' +
            '<path d="m4 17.2 8 4.2 8-4.2" opacity="0.55"/>',
        team: '<circle cx="9.2" cy="8.4" r="3"/><path d="M3.6 19.2c0-2.9 2.5-4.8 5.6-4.8s5.6 1.9 5.6 4.8"/>' +
            '<path d="M16.4 6.6a2.9 2.9 0 0 1 0 5.7"/><path d="M20.4 19.2c0-2.1-1.2-3.5-3-4.2"/>',
        usage: '<path d="M4 20V4"/><path d="M4 20h16"/><rect x="7.4" y="12.6" width="2.9" height="4.6" rx="0.6"/>' +
            '<rect x="12" y="9" width="2.9" height="8.2" rx="0.6"/><rect x="16.6" y="5.6" width="2.9" height="11.6" rx="0.6"/>',
        billing: '<rect x="2.8" y="6" width="18.4" height="12" rx="2.2"/><path d="M2.8 10.4h18.4"/>' +
            '<path d="M6.4 14.4h3.4"/>',
        orgcog: '<path d="M4.4 7.2h6.4M14.6 7.2h5"/><circle cx="12.8" cy="7.2" r="1.9"/>' +
            '<path d="M4.4 16.8h4.2M12.4 16.8h7.2"/><circle cx="10.4" cy="16.8" r="1.9"/>',

        // your own account
        prefs: '<circle cx="12" cy="12" r="2.9"/><path d="M12 3.2v2.3M12 18.5v2.3M20.8 12h-2.3M5.5 12H3.2' +
            'M18.2 5.8l-1.7 1.7M7.5 16.5l-1.7 1.7M18.2 18.2l-1.7-1.7M7.5 7.5 5.8 5.8"/>',
        lock: '<rect x="4.8" y="10.6" width="14.4" height="9.4" rx="2.1"/>' +
            '<path d="M8.4 10.6V7.8a3.6 3.6 0 0 1 7.2 0v2.8"/><path d="M12 14.4v2.2"/>',
        key: '<circle cx="7.4" cy="12" r="3.6"/><path d="M11 12h9.4"/>' +
            '<path d="M17 12v3.4"/><path d="M20.4 12v2.4"/>',
        audit: '<path d="M7 5.4v13.2"/><circle cx="7" cy="7.6" r="1.9"/><circle cx="7" cy="16.4" r="1.9"/>' +
            '<path d="M11.6 7.6h8.4M11.6 16.4h6"/>',
        person: '<circle cx="12" cy="8.2" r="3.3"/><path d="M5.6 20c0-3.4 2.9-5.6 6.4-5.6s6.4 2.2 6.4 5.6"/>',
        building: '<path d="M4.4 20V5.2A1.2 1.2 0 0 1 5.6 4h7.6a1.2 1.2 0 0 1 1.2 1.2V20"/>' +
            '<path d="M14.4 9.6h4A1.2 1.2 0 0 1 19.6 10.8V20"/><path d="M3.2 20h17.6"/>' +
            '<path d="M7.6 7.6h3.6M7.6 11.2h3.6M7.6 14.8h3.6"/>',
        flask: '<path d="M9.4 3.6h5.2v4.8l4.4 9.2a1.8 1.8 0 0 1-1.6 2.6H6.6A1.8 1.8 0 0 1 5 17.6l4.4-9.2Z"/>' +
            '<path d="M6.8 14.4h10.4"/>',
        changelog: '<path d="M5.6 4.4h12.8v15.2H5.6Z"/><path d="M8.6 8.4h6.8M8.6 12h6.8M8.6 15.6h4"/>',
        globe: '<circle cx="12" cy="12" r="8.2"/><path d="M3.8 12h16.4"/>' +
            '<path d="M12 3.8c2.2 2.3 3.4 5.1 3.4 8.2s-1.2 5.9-3.4 8.2c-2.2-2.3-3.4-5.1-3.4-8.2S9.8 6.1 12 3.8Z"/>',

        // things a screen talks about
        plan: '<path d="m12.4 3.6 7.2 7.2a2 2 0 0 1 0 2.8l-5.6 5.6a2 2 0 0 1-2.8 0L4 12V5.6a2 2 0 0 1 2-2Z"/>' +
            '<circle cx="8.6" cy="8.6" r="1.3"/>',
        screening: '<circle cx="10.8" cy="10.8" r="6.2"/><path d="m15.4 15.4 4.2 4.2"/>' +
            '<path d="m8.2 10.9 1.9 1.9 3.4-3.6"/>',
        coverage: '<path d="M12 3.4 5 6v5.4c0 4.6 3.1 7.6 7 9.2 3.9-1.6 7-4.6 7-9.2V6Z"/>' +
            '<path d="m8.8 11.6 2.4 2.4 4-4.4"/>',
        swap: '<path d="M4.4 9.2h13.2"/><path d="m14.6 6.2 3 3-3 3"/>' +
            '<path d="M19.6 15.2H6.4"/><path d="m9.4 12.2-3 3 3 3"/>',
        label: '<rect x="3.4" y="7.4" width="17.2" height="9.2" rx="2.1"/>' +
            '<path d="M8.8 10.2v5.6"/><path d="M7.4 10.2h2.8M7.4 15.8h2.8"/>',
        link: '<path d="M10.2 13.8a3.6 3.6 0 0 1 0-5.1l2.6-2.6a3.6 3.6 0 0 1 5.1 5.1l-1.3 1.3"/>' +
            '<path d="M13.8 10.2a3.6 3.6 0 0 1 0 5.1l-2.6 2.6a3.6 3.6 0 0 1-5.1-5.1l1.3-1.3"/>',
        warn: '<path d="M12 8.5v5M12 16.9v.1"/><path d="M10.3 4.3 2.8 18a1.8 1.8 0 0 0 1.6 2.7h15.2A1.8 1.8 0 0 0 21.2 18L13.7 4.3a1.9 1.9 0 0 0-3.4 0Z"/>',

        // chrome: the shell itself, not a destination
        panel: '<rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.2"/><path d="M9.4 4.6v14.8"/>',
        back: '<path d="M14.6 6.4 9 12l5.6 5.6"/>',
        out: '<path d="M9.6 20H5.4V4h4.2"/><path d="M14 8.4l3.6 3.6-3.6 3.6"/><path d="M17.6 12H8.8"/>'
    };

    var ACCOUNT_PATH = '/dashboard/account/preferences';
    var ORGS_PATH = '/dashboard/organisations';

    // The organisation is in the address, not hidden in a cookie: a link opens
    // the organisation it names, and switching is a navigation rather than a
    // change of invisible state. The cookie is brought into line with the url on
    // arrival, and is only ever a hint even then.
    var ORG_ROOT = '/dashboard/org/';

    function slugInPath() {
        if (location.pathname.indexOf(ORG_ROOT) !== 0) return '';
        var rest = location.pathname.slice(ORG_ROOT.length).split('/')[0];
        return /^[a-z0-9]{20}$/.test(rest) ? rest : '';
    }

    function orgHome(slug) {
        return ORG_ROOT + slug;
    }

    // where a nav item lives for the organisation we are in
    function orgPath(slug, tail) {
        return ORG_ROOT + slug + (tail ? '/' + tail : '');
    }

    // read straight from the address, so the first paint already knows where it
    // is. the lookup that follows decides whether you are allowed to be here.
    var atOrg = slugInPath();
    // the american spelling reaches the same screen, and the address bar is
    // rewritten to the one we use everywhere else rather than leaving two urls
    // for one page.
    var ORGS_PATH_ALT = '/dashboard/organizations';

    function onOrgs() {
        return location.pathname === ORGS_PATH || location.pathname === ORGS_PATH_ALT;
    }

    // Arriving at the dashboard means choosing which company you are working in.
    // Having chosen, you stay chosen: the marker lives in sessionStorage, so it
    // survives a refresh in this tab and is gone from a fresh one, which is the
    // difference between coming back to your work and arriving at the door.
    var PICKED_KEY = 'sp-org-picked';

    function markPicked() {
        try { sessionStorage.setItem(PICKED_KEY, '1'); } catch (err) {  }
    }

    function hasPicked() {
        try { return sessionStorage.getItem(PICKED_KEY) === '1'; } catch (err) { return false; }
    }

    function forgetPicked() {
        try { sessionStorage.removeItem(PICKED_KEY); } catch (err) {  }
    }

    // What belongs to you and what belongs to the company are different things,
    // and the address says which: your preferences follow you between
    // organisations, the tokens and the log do not.
    var ACCOUNT_NAV = [
        { group: 'Account settings', items: [
            { key: 'preferences', label: 'Preferences', icon: 'prefs', href: '/dashboard/account/preferences' },
            { key: 'security', label: 'Security', icon: 'lock', href: '/dashboard/account/security' }
        ] },
        { group: 'Organisation', items: [
            { key: 'tokens', label: 'Access tokens', icon: 'key', org: 'tokens' },
            { key: 'account-logs', label: 'Audit logs', icon: 'audit', org: 'logs' }
        ] }
    ];

    // The organisation's rail. Two sectors, because there are two kinds of
    // thing in here: the work, and the company that owns it.
    //
    // Access tokens and your own account are not on it. Tokens belong to the
    // organisation's settings, which is where the screen is reached from now,
    // and your account is behind your own avatar in the corner, where it was
    // always also reachable. A rail is for where the work is.
    var NAV = [
        { group: 'Work', items: [
            { key: 'projects', label: 'Projects', icon: 'projects', org: '' }
        ] },
        { group: 'Organisation', items: [
            { key: 'team', label: 'Team', icon: 'team', org: 'team' },
            { key: 'usage', label: 'Usage', icon: 'usage', org: 'usage' },
            { key: 'billing', label: 'Billing', icon: 'billing', org: 'billing' },
            { key: 'settings', label: 'Organization settings', icon: 'orgcog', org: 'settings' }
        ] }
    ];

    function t(s) {
        return window.SentinelI18n ? window.SentinelI18n.t(s) : s;
    }

    function icon(name) {
        return '<svg class="nav-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            (ICONS[name] || '') + '</svg>';
    }

    function inAccount() {
        if (location.pathname.indexOf('/dashboard/account') === 0) return true;
        // the organisation's own settings live in the same sidebar as yours
        var slug = slugInPath();
        if (!slug) return false;
        var tail = location.pathname.slice(orgHome(slug).length).replace(/^\//, '');
        return tail === 'tokens' || tail === 'logs';
    }

    function navFor() {
        return inAccount() ? ACCOUNT_NAV : NAV;
    }

    function navKey() {
        return inAccount() ? 'account' : 'main';
    }

    function markNav(host, active) {
        [].forEach.call(host.querySelectorAll('[data-nav]'), function (b) {
            var on = b.getAttribute('data-nav') === active;
            b.classList.toggle('is-on', on);
            if (on) b.setAttribute('aria-current', 'page');
            else b.removeAttribute('aria-current');
        });
    }

    // returns true when the list itself was rebuilt. moving between two items of
    // the same list is not a new sidebar, so it only moves the highlight: tearing
    // the list down and replaying its entrance for that read as a reload.
    // an item declared with an org tail lives inside the organisation, so its
    // address is only known once we know which one we are in
    // an empty tail is the organisation's own home, so this asks whether the
    // item declared one at all rather than whether it is truthy.
    function hrefOf(item) {
        if (item.org !== undefined) return atOrg ? orgPath(atOrg, item.org) : '';
        return item.href || '';
    }

    function paintNav(active) {
        var host = document.getElementById('side-nav');
        if (!host) return false;

        var key = navKey();
        if (host.getAttribute('data-navset') === key) {
            markNav(host, active);
            return false;
        }
        host.setAttribute('data-navset', key);
        host.textContent = '';

        if (inAccount()) {
            var back = document.createElement('button');
            back.type = 'button';
            back.className = 'nav-btn nav-back';
            back.innerHTML = icon('back');
            var bt = document.createElement('span');
            bt.className = 'nav-t';
            bt.textContent = t('Back to dashboard');
            back.appendChild(bt);
            back.addEventListener('click', function () {
                go(atOrg ? orgHome(atOrg) : ORGS_PATH);
            });
            host.appendChild(back);
        }

        navFor().forEach(function (g) {
            var target = host;
            var label = document.createElement('div');
            label.className = 'nav-group';
            label.textContent = t(g.group);
            target.appendChild(label);

            var ul = document.createElement('ul');
            ul.className = 'nav-list';
            g.items.forEach(function (item) {
                var li = document.createElement('li');
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'nav-btn' + (item.key === active ? ' is-on' : '');
                b.setAttribute('data-nav', item.key);
                if (item.key === active) b.setAttribute('aria-current', 'page');
                var to = hrefOf(item);
                if (to) {
                    b.addEventListener('click', function () { go(to); });
                }
                b.innerHTML = icon(item.icon);
                var span = document.createElement('span');
                span.className = 'nav-t';
                span.textContent = t(item.label);
                b.appendChild(span);
                li.appendChild(b);
                ul.appendChild(li);
            });
            target.appendChild(ul);
        });
        return true;
    }

    var SIDE_MODES = [
        { key: 'expanded', label: 'Expanded' },
        { key: 'collapsed', label: 'Collapsed' },
        { key: 'hover', label: 'Expand on hover' }
    ];
    var SIDE_KEY = 'sp-side-mode';

    function sideMode() {
        try {
            var v = localStorage.getItem(SIDE_KEY);
            if (v === SIDE_MODES[1].key || v === SIDE_MODES[2].key) return v;
        } catch (err) {  }
        return SIDE_MODES[0].key;
    }

    function applySideMode(mode) {
        if (!app) return;
        app.setAttribute('data-side', mode);
        var narrow = mode !== SIDE_MODES[0].key;
        [].forEach.call(document.querySelectorAll('.nav-btn'), function (b) {
            var span = b.querySelector('.nav-t');
            if (!span) return;
            if (narrow) b.setAttribute('title', span.textContent);
            else b.removeAttribute('title');
        });
        [].forEach.call(document.querySelectorAll('[data-side-mode]'), function (b) {
            var on = b.getAttribute('data-side-mode') === mode;
            b.setAttribute('aria-checked', on ? 'true' : 'false');
            b.classList.toggle('is-on', on);
        });
        // the settings page shows the same choice, so keep its picker honest when
        // the mode is changed from the sidebar or from the keyboard.
        var pf = document.getElementById('pf-side');
        if (pf && pf.parentNode && pf.parentNode.spSet) pf.parentNode.spSet(mode);
    }

    function setSideMode(mode) {
        try { localStorage.setItem(SIDE_KEY, mode); } catch (err) {  }
        applySideMode(mode);
    }

    function paintFoot() {
        var foot = document.getElementById('side-foot');
        if (!foot) return;
        foot.textContent = '';

        var wrap = document.createElement('div');
        wrap.className = 'sidectl';

        var pop = document.createElement('div');
        pop.className = 'sidectl-pop';
        pop.id = 'sidectl-pop';
        pop.setAttribute('role', 'menu');

        SIDE_MODES.forEach(function (m) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'sidectl-opt';
            b.setAttribute('role', 'menuitemradio');
            b.setAttribute('data-side-mode', m.key);
            b.textContent = t(m.label);
            b.addEventListener('click', function () {
                setSideMode(m.key);
                openPop(false);
            });
            pop.appendChild(b);
        });

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nav-btn sidectl-btn';
        btn.id = 'sidectl-btn';
        btn.setAttribute('aria-haspopup', 'menu');
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-controls', 'sidectl-pop');
        btn.innerHTML = icon('panel');
        var btnText = document.createElement('span');
        btnText.className = 'nav-t';
        btnText.textContent = t('Sidebar control');
        btn.appendChild(btnText);

        function isOpen() {
            return wrap.classList.contains('is-open');
        }

        function openPop(on) {
            wrap.classList.toggle('is-open', on);
            btn.setAttribute('aria-expanded', on ? 'true' : 'false');
            pop.setAttribute('aria-hidden', on ? 'false' : 'true');
        }

        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            openPop(!isOpen());
        });
        pop.addEventListener('click', function (e) { e.stopPropagation(); });
        document.addEventListener('click', function () { openPop(false); });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && isOpen()) {
                openPop(false);
                btn.focus();
            }
        });

        openPop(false);
        wrap.appendChild(pop);
        wrap.appendChild(btn);
        foot.appendChild(wrap);
    }

    var THEME_KEY = 'sp-theme';
    var THEMES = [
        { key: 'system', label: 'System' },
        { key: 'light', label: 'Light' },
        { key: 'dark', label: 'Dark' }
    ];

    function themeMode() {
        try {
            var v = localStorage.getItem(THEME_KEY);
            if (v === 'light' || v === 'dark' || v === 'system') return v;
        } catch (err) {  }
        return 'system';
    }

    function applyTheme(mode) {
        var root = document.documentElement;
        root.setAttribute('data-theme', isDark(mode) ? 'dark' : 'light');
        root.setAttribute('data-theme-mode', mode);
        [].forEach.call(document.querySelectorAll('[data-theme-pick]'), function (b) {
            var on = b.getAttribute('data-theme-pick') === mode;
            b.classList.toggle('is-on', on);
            b.setAttribute('aria-checked', on ? 'true' : 'false');
        });
    }

    function prefersStill() {
        try {
            return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch (err) {
            return false;
        }
    }

    function isDark(mode) {
        return mode === 'dark' ||
            (mode === 'system' && window.matchMedia &&
             window.matchMedia('(prefers-color-scheme: dark)').matches);
    }

    function fadeTheme(mode) {
        var root = document.documentElement;
        root.classList.add('is-theming');
        applyTheme(mode);
        clearTimeout(fadeTheme.timer);
        fadeTheme.timer = setTimeout(function () {
            root.classList.remove('is-theming');
        }, 460);
    }

    // the whole page dissolves from the old theme into the new one. the old
    // frame is a snapshot held on top at full opacity and faded out, so text,
    // borders and shadows all cross over together instead of each element
    // running its own transition and finishing at its own time.
    function setTheme(mode) {
        var was = themeMode();
        try { localStorage.setItem(THEME_KEY, mode); } catch (err) {  }

        if (prefersStill() || isDark(mode) === isDark(was)) {
            applyTheme(mode);
            return;
        }
        if (!document.startViewTransition) {
            fadeTheme(mode);
            return;
        }

        var root = document.documentElement;
        root.classList.add('is-wiping');
        var run = document.startViewTransition(function () { applyTheme(mode); });
        var clear = function () { root.classList.remove('is-wiping'); };
        run.finished.then(clear).catch(clear);
    }

    if (window.matchMedia) {
        var mq = window.matchMedia('(prefers-color-scheme: dark)');
        var onScheme = function () {
            if (themeMode() === 'system') applyTheme('system');
        };
        if (mq.addEventListener) mq.addEventListener('change', onScheme);
        else if (mq.addListener) mq.addListener(onScheme);
    }

    var TZ_KEY = 'sp-tz';

    function deviceZone() {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        } catch (err) {
            return '';
        }
    }

    function geoZone() {
        return document.documentElement.getAttribute('data-geo-tz') || '';
    }

    function geoSrc() {
        return document.documentElement.getAttribute('data-geo-src') || '';
    }

    function vagueZone(z) {
        return !z || z === 'UTC' || z === 'Etc/UTC' || z === 'Etc/GMT';
    }

    function autoZone() {
        var geo = geoZone();
        var dev = deviceZone();
        if (!vagueZone(geo)) return geo;
        if (!vagueZone(dev)) return dev;
        return geo || dev || 'UTC';
    }

    function autoSource() {
        var geo = geoZone();
        var dev = deviceZone();
        if (!vagueZone(geo)) {
            return geoSrc() === 'ip' ? 'From your location' : 'From your country';
        }
        if (!vagueZone(dev)) return 'From this device';
        return '';
    }


    function zonePref() {
        try {
            var v = localStorage.getItem(TZ_KEY);
            if (v) return v;
        } catch (err) {  }
        return 'auto';
    }

    function zoneNow() {
        var v = zonePref();
        return v === 'auto' ? autoZone() : v;
    }

    var FALLBACK_ZONES = [
        'Europe/Zagreb', 'Europe/Ljubljana', 'Europe/Belgrade', 'Europe/Sarajevo',
        'Europe/Vienna', 'Europe/Berlin', 'Europe/Zurich', 'Europe/Rome', 'Europe/Madrid',
        'Europe/Paris', 'Europe/Amsterdam', 'Europe/Brussels', 'Europe/Prague',
        'Europe/Budapest', 'Europe/Warsaw', 'Europe/Bucharest', 'Europe/Sofia',
        'Europe/Athens', 'Europe/Istanbul', 'Europe/Kyiv', 'Europe/Stockholm',
        'Europe/Oslo', 'Europe/Copenhagen', 'Europe/Helsinki', 'Europe/Dublin',
        'Europe/Lisbon', 'Europe/London', 'Atlantic/Reykjavik',
        'America/New_York', 'America/Toronto', 'America/Chicago', 'America/Denver',
        'America/Los_Angeles', 'America/Vancouver', 'America/Mexico_City',
        'America/Bogota', 'America/Lima', 'America/Santiago', 'America/Sao_Paulo',
        'America/Argentina/Buenos_Aires',
        'Africa/Casablanca', 'Africa/Lagos', 'Africa/Cairo', 'Africa/Nairobi',
        'Africa/Johannesburg',
        'Asia/Jerusalem', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Karachi', 'Asia/Kolkata',
        'Asia/Bangkok', 'Asia/Ho_Chi_Minh', 'Asia/Singapore', 'Asia/Kuala_Lumpur',
        'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Taipei', 'Asia/Seoul', 'Asia/Tokyo',
        'Australia/Perth', 'Australia/Brisbane', 'Australia/Sydney', 'Pacific/Auckland',
        'UTC'
    ];

    function zoneList() {
        var all;
        try {
            all = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : null;
        } catch (err) {
            all = null;
        }
        if (!all || !all.length) all = FALLBACK_ZONES.slice();
        else {
            all = all.slice();
            if (all.indexOf('UTC') === -1) all.push('UTC');
        }
        return all;
    }

    function zoneLabel(z) {
        return z.split('/').pop().replace(/_/g, ' ');
    }

    function zoneRegion(z) {
        var parts = z.split('/');
        return parts.length > 1 ? parts[0].replace(/_/g, ' ') : '';
    }

    function zoneOffset(zone) {
        try {
            var parts = new Intl.DateTimeFormat('en-GB', {
                timeZone: zone, timeZoneName: 'shortOffset'
            }).formatToParts(new Date());
            for (var i = 0; i < parts.length; i++) {
                if (parts[i].type === 'timeZoneName') return parts[i].value;
            }
        } catch (err) {  }
        return '';
    }

    function setZone(v) {
        try { localStorage.setItem(TZ_KEY, v); } catch (err) {  }
    }

    var PLAN_LABEL = {
        starter: 'Free trial',
        verified: 'Free trial',
        enterprise: 'Enterprise',
        pending: 'Awaiting approval',
        expired: 'Trial ended'
    };

    function acctRow(label, opts) {
        var o = opts || {};
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'acct-opt acct-row' + (o.soon ? ' is-soon' : '') + (o.stack ? ' is-stack' : '');
        b.setAttribute('role', 'menuitem');
        if (o.icon) b.innerHTML = icon(o.icon);
        var span = document.createElement('span');
        span.className = 'acct-row-t';
        span.textContent = t(label);
        b.appendChild(span);
        if (o.soon) {
            b.disabled = true;
            var tag = document.createElement('span');
            tag.className = 'acct-soon';
            tag.textContent = t('Soon');
            b.appendChild(tag);
        }
        if (o.value) {
            var v = document.createElement('span');
            v.className = 'acct-row-v';
            v.textContent = o.value;
            b.appendChild(v);
        }
        if (o.more) {
            var chev = document.createElement('span');
            chev.className = 'acct-chev';
            chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
            b.appendChild(chev);
        }
        if (o.onClick) b.addEventListener('click', o.onClick);
        return b;
    }

    function acctLabel(text) {
        var d = document.createElement('div');
        d.className = 'acct-label';
        d.textContent = t(text);
        return d;
    }

    function acctPick(label, on, attr, value, onClick) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'acct-opt acct-pick' + (on ? ' is-on' : '');
        b.setAttribute('role', 'menuitemradio');
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        if (attr) b.setAttribute(attr, value);
        var dot = document.createElement('span');
        dot.className = 'acct-dot';
        b.appendChild(dot);
        var span = document.createElement('span');
        span.textContent = label;
        b.appendChild(span);
        if (onClick) b.addEventListener('click', onClick);
        return b;
    }

    function paintAccountMenu(me) {
        var wrap = document.getElementById('acct');
        var pop = document.getElementById('acct-pop');
        if (!wrap || !pop) return;
        pop.textContent = '';

        var main = document.createElement('div');
        main.className = 'acct-page';

        var head = document.createElement('div');
        head.className = 'acct-head';
        var hName = document.createElement('div');
        hName.className = 'acct-name';
        hName.textContent = me.name || '';
        var hMail = document.createElement('div');
        hMail.className = 'acct-mail';
        hMail.textContent = me.email || '';
        head.appendChild(hName);
        head.appendChild(hMail);
        var state = (me.trial && me.trial.state) || 'none';
        if (PLAN_LABEL[state]) {
            var tag = document.createElement('span');
            tag.className = 'acct-plan';
            tag.textContent = t(PLAN_LABEL[state]);
            head.appendChild(tag);
        }
        main.appendChild(head);

        main.appendChild(sep());
        main.appendChild(acctRow('Account', {
            icon: 'person',
            onClick: function () {
                document.getElementById('acct').classList.remove('is-open');
                go(ACCOUNT_PATH);
            }
        }));
        main.appendChild(acctRow('Organisations', {
            icon: 'building',
            onClick: function () {
                document.getElementById('acct').classList.remove('is-open');
                go(ORGS_PATH);
            }
        }));
        main.appendChild(acctRow('Feature previews', { icon: 'flask', soon: true }));
        main.appendChild(acctRow('Changelog', { icon: 'changelog', soon: true }));

        main.appendChild(sep());
        main.appendChild(acctLabel('Theme'));
        var mode = themeMode();
        THEMES.forEach(function (th) {
            main.appendChild(acctPick(t(th.label), th.key === mode, 'data-theme-pick', th.key,
                function () { setTheme(th.key); }));
        });

        var i18n = window.SentinelI18n;
        if (i18n && i18n.langs && i18n.setLang) {
            main.appendChild(sep());
            main.appendChild(acctLabel('Language'));
            var now = i18n.lang();
            i18n.langs().forEach(function (l) {
                main.appendChild(acctPick(l.name, l.code === now, null, null,
                    function () { i18n.setLang(l.code); }));
            });
        }

        var zoneRow = acctRow('Timezone', { icon: 'globe', more: true, stack: true });
        var zv = document.createElement('span');
        zv.className = 'acct-row-sub';
        zv.textContent = zonePref() === 'auto'
            ? t('Auto') + ' (' + zoneLabel(zoneNow()) + ')'
            : zoneLabel(zoneNow());
        zoneRow.querySelector('.acct-row-t').appendChild(zv);
        main.appendChild(sep());
        main.appendChild(zoneRow);

        main.appendChild(sep());
        var out = document.createElement('button');
        out.type = 'button';
        out.className = 'acct-opt acct-row acct-out';
        out.setAttribute('role', 'menuitem');
        out.innerHTML = icon('out');
        var outT = document.createElement('span');
        outT.className = 'acct-row-t';
        outT.textContent = t('Sign out');
        out.appendChild(outT);
        out.addEventListener('click', function () {
            out.disabled = true;
            forgetMe();
            fetch('/v1/auth/logout', { method: 'POST', credentials: 'same-origin' })
                .then(function () { location.assign('/'); })
                .catch(function () { location.assign('/'); });
        });
        main.appendChild(out);

        var tz = document.createElement('div');
        tz.className = 'acct-page acct-sub';
        var back = acctRow('Timezone', { icon: 'back' });
        back.className = 'acct-opt acct-row acct-back';
        back.addEventListener('click', function () { pop.classList.remove('is-sub'); });
        tz.appendChild(back);

        var find = document.createElement('label');
        find.className = 'acct-find';
        var findIn = document.createElement('input');
        findIn.type = 'search';
        findIn.autocomplete = 'off';
        findIn.spellcheck = false;
        findIn.placeholder = t('Search a city or zone');
        find.appendChild(findIn);
        tz.appendChild(find);

        var tzList = document.createElement('div');
        tzList.className = 'acct-scroll';
        tz.appendChild(tzList);

        var pref = zonePref();
        var zones = zoneList();

        function drawZones(q) {
            tzList.textContent = '';
            q = (q || '').trim().toLowerCase();
            if (!q) {
                var auto = acctPick(t('Auto') + ' (' + zoneLabel(autoZone()) + ')',
                    pref === 'auto', null, null,
                    function () { setZone('auto'); paintAccountMenu(me); openZones(); });
                var src = autoSource();
                if (src) {
                    var note = document.createElement('span');
                    note.className = 'acct-pick-note';
                    note.textContent = t(src);
                    auto.appendChild(note);
                }
                tzList.appendChild(auto);
            }
            var shown = 0;
            for (var i = 0; i < zones.length && shown < 300; i++) {
                var z = zones[i];
                if (q && z.toLowerCase().replace(/_/g, ' ').indexOf(q) === -1) continue;
                shown++;
                (function (zone) {
                    var off = zoneOffset(zone);
                    var b = acctPick(zoneLabel(zone), pref === zone, null, null,
                        function () { setZone(zone); paintAccountMenu(me); openZones(); });
                    var meta = document.createElement('span');
                    meta.className = 'acct-pick-meta';
                    meta.textContent = (zoneRegion(zone) ? zoneRegion(zone) + '  ' : '') + off;
                    b.appendChild(meta);
                    tzList.appendChild(b);
                })(z);
            }
            if (!shown && q) {
                var none = document.createElement('div');
                none.className = 'acct-none';
                none.textContent = t('Nothing matches that.');
                tzList.appendChild(none);
            }
        }
        drawZones('');
        findIn.addEventListener('input', function () { drawZones(findIn.value); });

        function openZones() {
            pop.classList.add('is-sub');
            setTimeout(function () { findIn.focus(); }, 180);
        }

        zoneRow.addEventListener('click', openZones);

        pop.appendChild(main);
        pop.appendChild(tz);
        applyTheme(themeMode());
        bindAccountMenu();
    }

    var acctBound = false;
    function bindAccountMenu() {
        if (acctBound) return;
        var wrap = document.getElementById('acct');
        var btn = document.getElementById('acct-btn');
        var pop = document.getElementById('acct-pop');
        if (!wrap || !btn || !pop) return;
        acctBound = true;

        var open = function (on) {
            wrap.classList.toggle('is-open', on);
            btn.setAttribute('aria-expanded', on ? 'true' : 'false');
            pop.setAttribute('aria-hidden', on ? 'false' : 'true');
        };
        open(false);

        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            open(!wrap.classList.contains('is-open'));
        });
        pop.addEventListener('click', function (e) { e.stopPropagation(); });
        document.addEventListener('click', function () { open(false); });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && wrap.classList.contains('is-open')) {
                open(false);
                btn.focus();
            }
        });
    }

    var ME_KEY = 'sp-me';

    function readMe() {
        try {
            var raw = localStorage.getItem(ME_KEY);
            if (!raw) return null;
            var me = JSON.parse(raw);
            return me && me.email ? me : null;
        } catch (err) {
            return null;
        }
    }

    // What the shell paints before the fetch answers. It used to be the name,
    // the address and the plan state, which was everything the top bar needed.
    // The organisation's own screens read the organisation off here too, so a
    // warm load without it drew a page with no name and empty cards, and then
    // kept it: sameMe saw no difference and skipped the repaint entirely.
    function writeMe(me) {
        try {
            var org = me.org || null;
            localStorage.setItem(ME_KEY, JSON.stringify({
                name: me.name || '',
                email: me.email || '',
                trial: {
                    state: (me.trial && me.trial.state) || 'none',
                    daysLeft: (me.trial && me.trial.daysLeft) || 0,
                    liveUsed: (me.trial && me.trial.liveUsed) || 0,
                    liveIncluded: (me.trial && me.trial.liveIncluded) || 0,
                    historyUsed: (me.trial && me.trial.historyUsed) || 0,
                    historyIncluded: (me.trial && me.trial.historyIncluded) || 0,
                    historyOpen: Boolean(me.trial && me.trial.historyOpen)
                },
                org: org ? {
                    id: org.id, name: org.name, slug: org.slug,
                    role: org.role, members: org.members
                } : null,
                screeningsRun: me.screeningsRun || 0,
                coverage: me.coverage || null
            }));
        } catch (err) {  }
    }

    function forgetMe() {
        try { localStorage.removeItem(ME_KEY); } catch (err) {  }
        forgetTokenCache();
        forgetOrgCache();
        forgetPicked();
    }

    // this decides whether the screen is already right, so it has to compare
    // everything the screen is drawn from. comparing less than that is how a
    // stale page survives a fetch that disagreed with it.
    function sameMe(a, b) {
        if (!a || !b) return false;
        if (a.name !== b.name || a.email !== b.email) return false;
        if (String(a.screeningsRun || 0) !== String(b.screeningsRun || 0)) return false;
        var ta = a.trial || {}, tb = b.trial || {};
        var keys = ['state', 'daysLeft', 'liveUsed', 'liveIncluded',
            'historyUsed', 'historyIncluded', 'historyOpen'];
        for (var i = 0; i < keys.length; i++) {
            if (String(ta[keys[i]] || '') !== String(tb[keys[i]] || '')) return false;
        }
        var oa = a.org || {}, ob = b.org || {};
        var ok = ['id', 'name', 'slug', 'role', 'members'];
        for (var k = 0; k < ok.length; k++) {
            if (String(oa[ok[k]] || '') !== String(ob[ok[k]] || '')) return false;
        }
        var ca = a.coverage || {}, cb = b.coverage || {};
        return String(ca.source || '') === String(cb.source || '') &&
            String(ca.listDate || '') === String(cb.listDate || '') &&
            String(ca.addresses || '') === String(cb.addresses || '');
    }

    function paintMe(me) {
        lastMe = me;
        paintAvatar(me);
        paintAccountMenu(me);
        paintCanvas();
    }

    function sep() {
        var d = document.createElement('div');
        d.className = 'acct-sep';
        return d;
    }

    function initials(name, email) {
        var source = String(name || '').trim();
        if (source) {
            var parts = source.split(/\s+/).slice(0, 2);
            return parts.map(function (p) { return p.charAt(0); }).join('').toUpperCase();
        }
        return String(email || '?').charAt(0).toUpperCase();
    }

    function centreInk(host, inner) {
        if (!host || !inner || !window.HTMLCanvasElement) return;
        try {
            var cs = getComputedStyle(host);
            var g = document.createElement('canvas').getContext('2d');
            if (!g || !g.measureText) return;
            var scale = 20;
            var size = parseFloat(cs.fontSize) * scale;
            if (!size) return;
            g.font = cs.fontWeight + ' ' + size + 'px ' + cs.fontFamily;
            var m = g.measureText(inner.textContent);
            if (m.actualBoundingBoxLeft == null || m.actualBoundingBoxRight == null) return;

            inner.style.setProperty('--ink-x', '0px');
            inner.style.setProperty('--ink-y', '0px');

            var inkMid = (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
            var dx = (m.width / 2 - inkMid) / scale;

            var probe = document.createElement('i');
            probe.setAttribute('style', 'display:inline-block;width:0;height:0;');
            inner.appendChild(probe);
            var baseline = probe.getBoundingClientRect().bottom;
            inner.removeChild(probe);

            var box = host.getBoundingClientRect();
            var inkCentre = baseline +
                ((m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2) / scale;
            var dy = (box.top + box.height / 2) - inkCentre;

            inner.style.setProperty('--ink-x', dx.toFixed(3) + 'px');
            inner.style.setProperty('--ink-y', dy.toFixed(3) + 'px');
        } catch (err) {  }
    }

    function paintAvatar(me) {
        var name = document.getElementById('who-name');
        var mail = document.getElementById('who-mail');
        var avatar = document.getElementById('avatar');
        var inner = document.getElementById('avatar-in');
        if (name) name.textContent = me.name || '';
        if (mail) mail.textContent = me.email || '';
        if (!avatar || !inner) return;
        inner.textContent = initials(me.name, me.email);
        avatar.setAttribute('aria-label', me.email || 'Account');
        var place = function () { centreInk(avatar, inner); };
        place();
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    }

    function currentNav() {
        var path = location.pathname;
        var hit = '';
        var best = 0;
        navFor().forEach(function (g) {
            g.items.forEach(function (item) {
                var href = hrefOf(item);
                if (!href) return;
                var exact = path === href || path.indexOf(href + '/') === 0;
                if (exact && href.length > best) {
                    best = href.length;
                    hit = item.key;
                }
            });
        });
        return hit || navFor()[0].items[0].key;
    }

    var TOAST_ICON = {
        good: '<path d="m5 12.5 4.5 4.5L19 7"/>',
        bad: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.6v5M12 16.2h.01"/>'
    };

    function toastHost() {
        var host = document.getElementById('toasts');
        if (host) return host;
        host = document.createElement('div');
        host.id = 'toasts';
        host.className = 'toasts';
        host.setAttribute('role', 'status');
        host.setAttribute('aria-live', 'polite');
        document.body.appendChild(host);
        return host;
    }

    function toastBody(el, k, text) {
        el.className = 'toast toast-' + k + ' is-in';
        el.innerHTML = '<svg class="toast-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            TOAST_ICON[k] + '</svg>';
        var span = document.createElement('span');
        span.textContent = text;
        el.appendChild(span);
    }

    // one panel at a time. stacking them buried the newest message under older
    // ones that were already read, so a second message rewrites the panel that
    // is already up instead of queueing behind it.
    function toast(text, kind) {
        var host = toastHost();
        var k = kind === 'bad' ? 'bad' : 'good';

        var live = host.querySelector('.toast.is-in');
        if (live && live.spRetext) {
            live.spRetext(k, text);
            return live;
        }

        var el = document.createElement('div');
        el.className = 'toast toast-' + k;
        el.innerHTML = '<svg class="toast-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            TOAST_ICON[k] + '</svg>';
        var span = document.createElement('span');
        span.textContent = text;
        el.appendChild(span);
        host.appendChild(el);

        void el.offsetWidth;
        el.classList.add('is-in');

        var gone = false;
        var drop = function () {
            if (gone) return;
            gone = true;
            el.classList.remove('is-in');
            el.classList.add('is-out');
            setTimeout(function () {
                if (el.parentNode) el.parentNode.removeChild(el);
            }, 260);
        };
        var timer = setTimeout(drop, 4000);
        el.spRetext = function (nk, ntext) {
            clearTimeout(timer);
            el.classList.add('is-beat');
            setTimeout(function () {
                toastBody(el, nk, ntext);
                el.classList.remove('is-beat');
            }, 110);
            timer = setTimeout(drop, 4110);
        };
        el.addEventListener('click', function () { clearTimeout(timer); drop(); });
        return el;
    }

    function pageHead(title, sub) {
        var h = document.createElement('div');
        h.className = 'pg-head';
        var t1 = document.createElement('h1');
        t1.className = 'pg-h1';
        t1.textContent = t(title);
        h.appendChild(t1);
        if (sub) {
            var p = document.createElement('p');
            p.className = 'pg-sub';
            p.textContent = t(sub);
            h.appendChild(p);
        }
        return h;
    }

    function sectionTitle(text) {
        var h = document.createElement('h2');
        h.className = 'pg-h2';
        h.textContent = t(text);
        return h;
    }

    function fieldRow(opts) {
        var row = document.createElement('div');
        row.className = 'fld';
        var left = document.createElement('div');
        left.className = 'fld-l';
        var lab = document.createElement('label');
        lab.className = 'fld-label';
        lab.textContent = t(opts.label);
        if (opts.id) lab.setAttribute('for', opts.id);
        left.appendChild(lab);
        if (opts.hint) {
            var hint = document.createElement('div');
            hint.className = 'fld-hint';
            hint.textContent = t(opts.hint);
            left.appendChild(hint);
        }
        row.appendChild(left);
        var right = document.createElement('div');
        right.className = 'fld-r';
        right.appendChild(opts.control);
        row.appendChild(right);
        return row;
    }

    function textInput(id, value, placeholder, readOnly) {
        var i = document.createElement('input');
        i.type = 'text';
        i.id = id;
        i.className = 'fld-in' + (readOnly ? ' is-locked' : '');
        i.value = value || '';
        i.autocomplete = 'off';
        if (placeholder) i.placeholder = t(placeholder);
        if (readOnly) { i.readOnly = true; i.tabIndex = -1; }
        return i;
    }

    function splitName(full) {
        var parts = String(full || '').trim().split(/\s+/);
        if (!parts[0]) return { first: '', last: '' };
        return { first: parts[0], last: parts.slice(1).join(' ') };
    }

    function sectionNote(text) {
        var p = document.createElement('p');
        p.className = 'pg-note';
        p.textContent = t(text);
        return p;
    }

    // a mini drawing of the dashboard, so the tile shows the theme rather than
    // naming it. painted in fixed colours, never tokens: the light preview has
    // to stay light while you are looking at it in the dark.
    function themeFace(tone) {
        var face = document.createElement('span');
        face.className = 'thm-face is-' + tone;
        var rail = document.createElement('span');
        rail.className = 'thm-rail';
        for (var i = 0; i < 4; i++) rail.appendChild(document.createElement('span'));
        face.appendChild(rail);
        var body = document.createElement('span');
        body.className = 'thm-body';
        var bar = document.createElement('span');
        bar.className = 'thm-bar';
        for (var j = 0; j < 3; j++) bar.appendChild(document.createElement('span'));
        body.appendChild(bar);
        for (var k = 0; k < 2; k++) {
            var box = document.createElement('span');
            box.className = 'thm-box';
            box.appendChild(document.createElement('i'));
            box.appendChild(document.createElement('i'));
            body.appendChild(box);
        }
        face.appendChild(body);
        return face;
    }

    function themeTile(th) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'thm';
        b.setAttribute('role', 'radio');
        b.setAttribute('data-theme-pick', th.key);
        var on = themeMode() === th.key;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');

        var art = document.createElement('span');
        art.className = 'thm-art';
        if (th.key === 'system') {
            art.classList.add('is-split');
            art.appendChild(themeFace('dark'));
            art.appendChild(themeFace('light'));
        } else {
            art.appendChild(themeFace(th.key));
        }
        b.appendChild(art);

        var lab = document.createElement('span');
        lab.className = 'thm-lab';
        var dot = document.createElement('span');
        dot.className = 'thm-dot';
        lab.appendChild(dot);
        var txt = document.createElement('span');
        txt.textContent = t(th.label);
        lab.appendChild(txt);
        b.appendChild(lab);

        b.addEventListener('click', function () {
            if (themeMode() === th.key) return;
            setTheme(th.key);
            toast(t('Appearance saved'), 'good');
        });
        return b;
    }

    function themePicker() {
        var wrap = document.createElement('div');
        wrap.className = 'thms';
        wrap.setAttribute('role', 'radiogroup');
        THEMES.forEach(function (th) { wrap.appendChild(themeTile(th)); });
        return wrap;
    }

    // our own dropdown. a native select is painted by the operating system, so
    // it ignores every token on this page and looked borrowed sitting in the card.
    // the panel is fixed rather than absolute: the card clips its overflow, and an
    // absolute panel would be cut off at the card edge.
    function selectBox(id, groups, value, onPick, opts) {
        var o = opts || {};
        var wrap = document.createElement('div');
        wrap.className = 'pick';

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.id = id;
        btn.className = 'pick-btn';
        btn.setAttribute('aria-haspopup', 'listbox');
        btn.setAttribute('aria-expanded', 'false');
        var val = document.createElement('span');
        val.className = 'pick-val';
        btn.appendChild(val);
        var chev = document.createElement('span');
        chev.className = 'pick-chev';
        chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="m6 9 6 6 6-6"/></svg>';
        btn.appendChild(chev);
        wrap.appendChild(btn);

        var pop = document.createElement('div');
        pop.className = 'pick-pop';
        pop.setAttribute('role', 'listbox');
        var find = null;
        if (o.search) {
            var lab = document.createElement('label');
            lab.className = 'pick-find';
            find = document.createElement('input');
            find.type = 'search';
            find.autocomplete = 'off';
            find.spellcheck = false;
            find.placeholder = t(o.search);
            lab.appendChild(find);
            pop.appendChild(lab);
        }
        var list = document.createElement('div');
        list.className = 'pick-scroll';
        pop.appendChild(list);
        wrap.appendChild(pop);

        var current = value;

        function labelFor(v) {
            for (var i = 0; i < groups.length; i++) {
                var os = groups[i].options;
                for (var j = 0; j < os.length; j++) {
                    if (os[j].value === v) return os[j].label;
                }
            }
            return '';
        }

        function paintVal() { val.textContent = labelFor(current); }

        function draw(q) {
            list.textContent = '';
            q = (q || '').trim().toLowerCase();
            var shown = 0;
            groups.forEach(function (g) {
                var hits = g.options.filter(function (op) {
                    return !q || op.label.toLowerCase().indexOf(q) !== -1;
                });
                if (!hits.length || shown >= 300) return;
                if (g.group) {
                    var h = document.createElement('div');
                    h.className = 'pick-group';
                    h.textContent = g.group;
                    list.appendChild(h);
                }
                hits.forEach(function (op) {
                    if (shown >= 300) return;
                    shown++;
                    var b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'pick-opt' + (op.value === current ? ' is-on' : '');
                    b.setAttribute('role', 'option');
                    b.setAttribute('aria-selected', op.value === current ? 'true' : 'false');
                    var dot = document.createElement('span');
                    dot.className = 'acct-dot';
                    b.appendChild(dot);
                    var tx = document.createElement('span');
                    tx.className = 'pick-t';
                    tx.textContent = op.label;
                    b.appendChild(tx);
                    if (op.meta) {
                        var m = document.createElement('span');
                        m.className = 'pick-meta';
                        m.textContent = op.meta;
                        b.appendChild(m);
                    }
                    b.addEventListener('click', function () {
                        current = op.value;
                        paintVal();
                        open(false);
                        btn.focus();
                        onPick(op.value);
                    });
                    list.appendChild(b);
                });
            });
            if (!shown) {
                var none = document.createElement('div');
                none.className = 'pick-none';
                none.textContent = t('Nothing matches that.');
                list.appendChild(none);
            }
        }

        function place() {
            var r = btn.getBoundingClientRect();
            var below = window.innerHeight - r.bottom;
            // a menu, not a takeover: never taller than this however much room there is.
            var CAP = 340;
            var want = Math.min(pop.scrollHeight || 280, CAP);
            var up = below < want + 16 && r.top > below;
            pop.classList.toggle('is-up', up);
            pop.style.left = Math.round(r.left) + 'px';
            pop.style.width = Math.round(r.width) + 'px';
            if (up) {
                pop.style.top = 'auto';
                pop.style.bottom = Math.round(window.innerHeight - r.top + 6) + 'px';
                pop.style.maxHeight = Math.round(Math.min(r.top - 16, CAP)) + 'px';
            } else {
                pop.style.bottom = 'auto';
                pop.style.top = Math.round(r.bottom + 6) + 'px';
                pop.style.maxHeight = Math.round(Math.min(below - 16, CAP)) + 'px';
            }
        }

        function isOpen() { return wrap.classList.contains('is-open'); }

        function open(on) {
            if (on) {
                draw('');
                if (find) find.value = '';
                document.body.appendChild(pop);
                place();
            }
            wrap.classList.toggle('is-open', on);
            pop.classList.toggle('is-open', on);
            btn.setAttribute('aria-expanded', on ? 'true' : 'false');
            if (on) {
                var sel = list.querySelector('.pick-opt.is-on');
                if (sel) sel.scrollIntoView({ block: 'center' });
                if (find) find.focus();
            } else if (pop.parentNode) {
                setTimeout(function () {
                    if (!isOpen() && pop.parentNode) pop.parentNode.removeChild(pop);
                }, 200);
            }
        }

        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            open(!isOpen());
        });
        pop.addEventListener('click', function (e) { e.stopPropagation(); });
        if (find) {
            find.addEventListener('input', function () { draw(find.value); place(); });
        }
        document.addEventListener('click', function () { if (isOpen()) open(false); });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && isOpen()) { open(false); btn.focus(); }
        });
        pop.addEventListener('keydown', function (e) {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            var all = [].slice.call(list.querySelectorAll('.pick-opt'));
            if (!all.length) return;
            var at = all.indexOf(document.activeElement);
            var next = e.key === 'ArrowDown' ? at + 1 : at - 1;
            if (next < 0) next = all.length - 1;
            if (next >= all.length) next = 0;
            all[next].focus();
        });
        var shut = function () { if (isOpen()) open(false); };
        window.addEventListener('resize', shut);
        var canvas = document.getElementById('canvas');
        if (canvas) canvas.addEventListener('scroll', shut);

        paintVal();
        wrap.spSet = function (v) { current = v; paintVal(); };
        return wrap;
    }

    function zoneGroups() {
        var groups = [];
        var auto = { options: [{
            value: 'auto',
            label: t('Auto detect') + ' (' + zoneLabel(autoZone()) + ')'
        }] };
        groups.push(auto);
        var byRegion = {};
        var order = [];
        zoneList().forEach(function (z) {
            var r = zoneRegion(z) || t('Other');
            if (!byRegion[r]) { byRegion[r] = []; order.push(r); }
            byRegion[r].push(z);
        });
        order.forEach(function (r) {
            groups.push({
                group: r,
                options: byRegion[r].map(function (z) {
                    return { value: z, label: zoneLabel(z), meta: zoneOffset(z) };
                })
            });
        });
        return groups;
    }

    function viewAppearance() {
        var frag = document.createDocumentFragment();
        frag.appendChild(sectionTitle('Appearance'));
        frag.appendChild(sectionNote('Choose how Sentinelpay looks and behaves in the dashboard.'));

        var card = document.createElement('div');
        card.className = 'card';
        var row = fieldRow({
            label: 'Theme mode',
            hint: 'Pick a single theme, or follow whatever your system is set to.',
            control: themePicker()
        });
        row.classList.add('is-wide');
        card.appendChild(row);

        card.appendChild(fieldRow({
            label: 'Sidebar behavior',
            hint: 'How the sidebar sits when you are not using it.',
            id: 'pf-side',
            control: selectBox('pf-side', [{
                options: SIDE_MODES.map(function (m) {
                    return { value: m.key, label: t(m.label) };
                })
            }], sideMode(), function (v) {
                setSideMode(v);
                toast(t('Appearance saved'), 'good');
            })
        }));
        frag.appendChild(card);
        return frag;
    }

    function viewTimezone(me) {
        var frag = document.createDocumentFragment();
        frag.appendChild(sectionTitle('Timezone'));
        frag.appendChild(sectionNote('Choose how dates and times are shown across the dashboard.'));

        var card = document.createElement('div');
        card.className = 'card';
        var hint = zonePref() === 'auto'
            ? (autoSource() || 'Detected for you.')
            : 'Every timestamp in the dashboard follows this zone.';
        var row = fieldRow({
            label: 'Display timezone',
            hint: hint,
            id: 'pf-tz',
            control: selectBox('pf-tz', zoneGroups(), zonePref(), function (v) {
                setZone(v);
                paintAccountMenu(me);
                toast(t('Timezone saved'), 'good');
                var h = row.querySelector('.fld-hint');
                if (h) {
                    h.textContent = v === 'auto'
                        ? t(autoSource() || 'Detected for you.')
                        : t('Every timestamp in the dashboard follows this zone.');
                }
            }, { search: 'Search a city or zone' })
        });
        card.appendChild(row);
        frag.appendChild(card);
        return frag;
    }

    // the shortcuts the finished product needs. most of the screens they point
    // at do not exist yet, so only the ones marked live are bound; the rest are
    // listed and switchable now so the setting outlives the gap.
    var SHORTCUTS = [
        { key: 'palette', label: 'Open the command menu', keys: ['mod', 'K'] },
        { key: 'find', label: 'Search addresses, wallets and cases', keys: ['mod', 'shift', 'F'] },
        { key: 'screen', label: 'Screen an address', keys: ['mod', 'shift', 'S'] },
        { key: 'case', label: 'Open a new case', keys: ['shift', 'N'] },
        { key: 'next', label: 'Next alert in the queue', keys: ['J'] },
        { key: 'prev', label: 'Previous alert in the queue', keys: ['K'] },
        { key: 'assign', label: 'Assign the open alert to me', keys: ['shift', 'A'] },
        { key: 'escalate', label: 'Escalate the open alert', keys: ['shift', 'E'] },
        { key: 'clear', label: 'Clear the open alert as a false positive', keys: ['shift', 'C'] },
        { key: 'copy-addr', label: 'Copy the address in view', keys: ['mod', 'shift', 'A'] },
        { key: 'copy-json', label: 'Copy the screening result as JSON', keys: ['mod', 'shift', 'J'] },
        { key: 'csv', label: 'Download results as CSV', keys: ['mod', 'shift', 'D'] },
        { key: 'report', label: 'Export the case report as PDF', keys: ['mod', 'shift', 'P'] },
        { key: 'graph', label: 'Open the exposure graph', keys: ['mod', 'G'] },
        { key: 'sidebar', label: 'Collapse or expand the sidebar', keys: ['mod', 'B'], live: true },
        { key: 'audit', label: 'Refresh the audit log', keys: ['shift', 'R'] },
        { key: 'help', label: 'Show this shortcut list', keys: ['?'] }
    ];
    var KEYS_KEY = 'sp-keys-off';

    function onApple() {
        var p = (navigator.userAgentData && navigator.userAgentData.platform) ||
            navigator.platform || '';
        return /mac|iphone|ipad|ipod/i.test(p);
    }

    function keyCap(k) {
        if (k === 'mod') return onApple() ? '\u2318' : t('Ctrl');
        if (k === 'shift') return '\u21e7';
        return k;
    }

    function keysOff() {
        try {
            var raw = JSON.parse(localStorage.getItem(KEYS_KEY) || '[]');
            if (raw && raw.length !== undefined) return raw;
        } catch (err) {  }
        return [];
    }

    function keyOn(key) {
        return keysOff().indexOf(key) === -1;
    }

    function setKey(key, on) {
        var off = keysOff().filter(function (k) { return k !== key; });
        if (!on) off.push(key);
        try { localStorage.setItem(KEYS_KEY, JSON.stringify(off)); } catch (err) {  }
    }

    function toggle(id, on, onFlip) {
        var b = document.createElement('button');
        b.type = 'button';
        b.id = id;
        b.className = 'sw' + (on ? ' is-on' : '');
        b.setAttribute('role', 'switch');
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.appendChild(document.createElement('span')).className = 'sw-k';
        b.addEventListener('click', function () {
            var next = !b.classList.contains('is-on');
            b.classList.toggle('is-on', next);
            b.setAttribute('aria-checked', next ? 'true' : 'false');
            onFlip(next);
        });
        return b;
    }

    function viewShortcuts() {
        var frag = document.createDocumentFragment();
        frag.appendChild(sectionTitle('Keyboard shortcuts'));
        frag.appendChild(sectionNote('Choose which shortcuts stay active while you work in the dashboard.'));

        var card = document.createElement('div');
        card.className = 'card';

        SHORTCUTS.forEach(function (sc) {
            var row = document.createElement('div');
            row.className = 'fld';
            row.classList.add('krow');

            var left = document.createElement('div');
            left.className = 'fld-l';
            var lab = document.createElement('label');
            lab.className = 'fld-label';
            lab.textContent = t(sc.label);
            lab.setAttribute('for', 'ks-' + sc.key);
            left.appendChild(lab);
            row.appendChild(left);

            var right = document.createElement('div');
            right.className = 'krow-r';
            var caps = document.createElement('span');
            caps.className = 'keys';
            sc.keys.forEach(function (k) {
                var kb = document.createElement('kbd');
                kb.textContent = keyCap(k);
                caps.appendChild(kb);
            });
            right.appendChild(caps);
            right.appendChild(toggle('ks-' + sc.key, keyOn(sc.key), function (on) {
                setKey(sc.key, on);
                toast(t(on ? 'Shortcut turned on' : 'Shortcut turned off'), 'good');
            }));
            row.appendChild(right);
            card.appendChild(row);
        });

        frag.appendChild(card);
        return frag;
    }

    // the only shortcut with somewhere to go today. it reads the same switch the
    // rest of the list writes, so the setting is real even while the others wait.
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'b' && e.key !== 'B') return;
        if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
        if (!keyOn('sidebar')) return;
        var tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
        e.preventDefault();
        if (window.innerWidth <= 900) { setMenu(!app.classList.contains('is-open')); return; }
        setSideMode(sideMode() === SIDE_MODES[0].key ? SIDE_MODES[1].key : SIDE_MODES[0].key);
    });

    // dashboard behaviour, kept per browser rather than on the account: these are
    // about how this screen in front of you behaves, not about who you are.
    var DASH_PREFS = [
        { key: 'confirm-clear', on: true,
          label: 'Confirm before clearing an alert',
          hint: 'Ask a second time before an alert is closed as a false positive.' },
        { key: 'graph-beside', on: true,
          label: 'Open the exposure graph beside a result',
          hint: 'Show where the funds came from without leaving the screening.' },
        { key: 'keep-filters', on: true,
          label: 'Remember my filters on the alert queue',
          hint: 'Come back to the queue the way you left it.' },
        { key: 'full-address', on: false,
          label: 'Write addresses out in full',
          hint: 'Show the whole address instead of shortening the middle.' }
    ];
    var PREF_KEY = 'sp-prefs';

    function prefs() {
        try {
            var v = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
            if (v && typeof v === 'object') return v;
        } catch (err) {  }
        return {};
    }

    function prefOn(key, fallback) {
        var v = prefs()[key];
        return v === undefined ? fallback : !!v;
    }

    function setPref(key, on) {
        var all = prefs();
        all[key] = !!on;
        try { localStorage.setItem(PREF_KEY, JSON.stringify(all)); } catch (err) {  }
    }

    function switchRow(id, label, hint, on, onFlip) {
        var row = fieldRow({
            label: label,
            hint: hint,
            id: id,
            control: toggle(id, on, onFlip)
        });
        row.classList.add('is-sw');
        return row;
    }

    function viewDashPrefs() {
        var frag = document.createDocumentFragment();
        frag.appendChild(sectionTitle('Dashboard'));
        frag.appendChild(sectionNote('Change how the dashboard behaves on this browser and device.'));

        var card = document.createElement('div');
        card.className = 'card';
        DASH_PREFS.forEach(function (d) {
            card.appendChild(switchRow('dp-' + d.key, d.label, d.hint,
                prefOn(d.key, d.on), function (on) {
                    setPref(d.key, on);
                    toast(t('Preference saved'), 'good');
                }));
        });
        frag.appendChild(card);
        return frag;
    }

    function viewTelemetry() {
        var frag = document.createDocumentFragment();
        frag.appendChild(sectionTitle('Analytics and marketing'));
        frag.appendChild(sectionNote('Decide what leaves your browser beyond the work itself.'));

        var card = document.createElement('div');
        card.className = 'card';
        card.appendChild(switchRow('dp-usage',
            'Share anonymous usage data',
            'Which screens get opened and how long a screening takes, so we know what to improve. Never addresses, customer names or anything inside a case.',
            prefOn('usage', false), function (on) {
                setPref('usage', on);
                toast(t('Preference saved'), 'good');
            }));
        card.appendChild(switchRow('dp-product-mail',
            'Product email',
            'A note when we ship something worth knowing about. Never more than once a month.',
            prefOn('product-mail', false), function (on) {
                setPref('product-mail', on);
                toast(t('Preference saved'), 'good');
            }));
        frag.appendChild(card);
        return frag;
    }

    function viewDanger(me) {
        var frag = document.createDocumentFragment();
        frag.appendChild(sectionTitle('Danger zone'));
        frag.appendChild(sectionNote('Close this account for good.'));

        var card = document.createElement('div');
        card.className = 'card is-danger';
        var body = document.createElement('div');
        body.className = 'dz';

        var mark = document.createElement('span');
        mark.className = 'dz-mark';
        mark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M12 8.5v5M12 16.9v.1"/><path d="M10.3 4.3 2.8 18a1.8 1.8 0 0 0 1.6 2.7h15.2A1.8 1.8 0 0 0 21.2 18L13.7 4.3a1.9 1.9 0 0 0-3.4 0Z"/></svg>';
        body.appendChild(mark);

        var txt = document.createElement('div');
        txt.className = 'dz-t';
        var h = document.createElement('div');
        h.className = 'dz-h';
        h.textContent = t('Delete this account');
        txt.appendChild(h);
        var p = document.createElement('p');
        p.className = 'dz-p';
        p.textContent = t('This cannot be undone. Your account, your screenings and your cases go with it. We keep the audit record of the deletion itself, because the law requires it of us.');
        txt.appendChild(p);

        var go2 = document.createElement('button');
        go2.type = 'button';
        go2.className = 'btn btn-danger';
        go2.textContent = t('Delete account');
        go2.addEventListener('click', function () { askDelete(me); });
        txt.appendChild(go2);

        body.appendChild(txt);
        card.appendChild(body);
        frag.appendChild(card);
        return frag;
    }

    function modalShell(title, sub) {
        var back = document.createElement('div');
        back.className = 'modal-back';
        var box = document.createElement('div');
        box.className = 'modal';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.tabIndex = -1;

        var dots = document.createElement('span');
        dots.className = 'modal-dots';
        dots.setAttribute('aria-hidden', 'true');
        box.appendChild(dots);
        var edge = document.createElement('span');
        edge.className = 'modal-edge';
        edge.setAttribute('aria-hidden', 'true');
        box.appendChild(edge);

        var x = document.createElement('button');
        x.type = 'button';
        x.className = 'modal-x';
        x.setAttribute('aria-label', t('Close'));
        x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
            '<path d="M6 6 18 18M18 6 6 18"/></svg>';
        box.appendChild(x);

        var stepBack = document.createElement('button');
        stepBack.type = 'button';
        stepBack.className = 'modal-back-btn';
        stepBack.hidden = true;
        stepBack.setAttribute('aria-label', t('Back to account deletion'));
        stepBack.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="m14 6-6 6 6 6"/></svg>';
        box.appendChild(stepBack);

        var head = document.createElement('div');
        head.className = 'modal-head';
        var h = document.createElement('h2');
        h.className = 'modal-h';
        h.textContent = t(title);
        head.appendChild(h);
        var p = document.createElement('p');
        p.className = 'modal-p';
        p.textContent = t(sub);
        head.appendChild(p);
        box.appendChild(head);

        var body = document.createElement('div');
        body.className = 'modal-body';
        box.appendChild(body);

        back.appendChild(box);
        document.body.appendChild(back);
        void back.offsetWidth;
        back.classList.add('is-in');
        document.documentElement.classList.add('is-modal');
        // not focusing a field: a focused password input makes the browser offer
        // its saved logins, and that panel lands over the dialog.
        box.focus();

        function shut() {
            back.classList.remove('is-in');
            document.documentElement.classList.remove('is-modal');
            document.removeEventListener('keydown', onKey);
            setTimeout(function () {
                if (back.parentNode) back.parentNode.removeChild(back);
            }, 260);
        }
        function onKey(e) { if (e.key === 'Escape') shut(); }
        document.addEventListener('keydown', onKey);
        x.addEventListener('click', shut);
        back.addEventListener('click', function (e) { if (e.target === back) shut(); });

        return {
            box: box, body: body, shut: shut, stepBack: stepBack,
            // the reset panels carry their own badge and heading, as the sign in
            // modal does, so the shell head steps aside for them.
            bare: function (on) { head.hidden = !!on; },
            retitle: function (title2, sub2) {
                h.textContent = t(title2);
                p.textContent = t(sub2);
            }
        };
    }

    // the sign in modal's action button, down to the lift on hover.
    function wideBtn(label, kind, type) {
        var b = document.createElement('button');
        b.type = type || 'button';
        b.className = 'btn btn-wide' + (kind ? ' btn-' + kind : '');
        b.textContent = t(label);
        return b;
    }

    function askDelete(me) {
        var m = modalShell('Delete this account',
            'Enter your password to confirm. Once this goes through there is nothing left to restore.');

        // exactly how the sign in modal changes step: the panel is swapped in the
        // same frame, the dialog is pinned to the height it had and let glide to
        // the height it needs, and the arriving panel slides in from the side it
        // came from. nothing fades out first, so there is no pause in the middle.
        function glide(change) {
            var box = m.box;
            if (prefersStill()) { change(); return; }
            var from = box.getBoundingClientRect().height;
            box.style.height = '';
            change();
            var to = box.getBoundingClientRect().height;
            clearTimeout(box.spGlide);
            box.classList.remove('is-gliding');
            box.style.height = from + 'px';
            void box.offsetHeight;
            box.classList.add('is-gliding');
            box.style.height = to + 'px';
            box.spGlide = setTimeout(function () {
                box.classList.remove('is-gliding');
                box.style.height = '';
            }, 320);
        }

        function swap(build, backwards) {
            glide(function () {
                m.body.textContent = '';
                build();
            });
            m.body.style.setProperty('--step-dir', backwards ? '-14px' : '14px');
            m.body.classList.remove('is-stepping');
            void m.body.offsetWidth;
            m.body.classList.add('is-stepping');
        }

        function stepConfirm() {
            clearInterval(tick);
            m.stepBack.hidden = true;
            m.bare(false);
            m.retitle('Delete this account',
                'Enter your password to confirm. Once this goes through there is nothing left to restore.');

            var form = document.createElement('form');
            var pw = document.createElement('input');
            pw.type = 'password';
            pw.className = 'modal-in';
            pw.autocomplete = 'current-password';
            pw.placeholder = t('Your password');
            form.appendChild(pw);

            var msg = document.createElement('div');
            msg.className = 'modal-msg';
            form.appendChild(msg);

            var row = document.createElement('div');
            row.className = 'modal-row';
            var lost = document.createElement('button');
            lost.type = 'button';
            lost.className = 'modal-link';
            lost.textContent = t('Forgot your password?');
            lost.addEventListener('click', function () { swap(stepReset); });
            row.appendChild(lost);
            form.appendChild(row);

            var yes = wideBtn('Delete account', 'cta', 'submit');
            form.appendChild(yes);
            var quit = document.createElement('div');
            quit.className = 'modal-quit';
            var no = wideBtn('Keep my account', 'quiet');
            no.addEventListener('click', m.shut);
            quit.appendChild(no);
            form.appendChild(quit);
            m.body.appendChild(form);

            function say(text) {
                msg.textContent = text;
                msg.className = 'modal-msg is-bad';
            }

            form.addEventListener('submit', function (e) {
                e.preventDefault();
                if (!pw.value) { pw.focus(); return; }
                yes.disabled = true;
                msg.textContent = '';
                msg.className = 'modal-msg';
                fetch('/v1/account/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ password: pw.value })
                }).then(function (r) {
                    return r.json().catch(function () { return {}; }).then(function (j) {
                        return { ok: r.ok, body: j };
                    });
                }).then(function (r) {
                    if (!r.ok) {
                        say((r.body && r.body.error) || t('That did not work.'));
                        yes.disabled = false;
                        return;
                    }
                    forgetMe();
                    location.assign('/');
                }).catch(function () {
                    say(t('That did not work.'));
                    yes.disabled = false;
                });
            });
        }

        // both of these are the sign in modal's reset panels, ported piece for
        // piece: the badge, the heading pair, the field row, the footer of link
        // buttons, and the sixty second hold on the resend.
        function markBadge(kind, path) {
            var d = document.createElement('div');
            d.className = kind;
            d.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                path + '</svg>';
            return d;
        }

        function vHead(kind, title, sub) {
            var head = document.createElement('div');
            head.className = 'vhead';
            head.appendChild(markBadge('vmark', kind === 'lock'
                ? '<rect x="4" y="10.5" width="16" height="10" rx="2.2"></rect>' +
                  '<path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"></path>'
                : '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"></rect>' +
                  '<polyline points="3 6.5 12 13 21 6.5"></polyline>'));
            var h3 = document.createElement('h3');
            h3.textContent = t(title);
            head.appendChild(h3);
            var p2 = document.createElement('p');
            p2.textContent = t(sub);
            head.appendChild(p2);
            return head;
        }

        function linkBtn(label) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'linkbtn';
            b.textContent = t(label);
            return b;
        }

        var RESEND_WAIT = 60;
        var tick = null;

        function stepReset() {
            clearInterval(tick);
            m.stepBack.hidden = false;
            m.bare(true);

            var form = document.createElement('form');
            form.className = 'vpanel';
            form.appendChild(vHead('lock', 'Reset your password',
                'This is the address on your account. We will send you a link to set a new password.'));

            var field = document.createElement('div');
            field.className = 'vfield';
            var lab = document.createElement('label');
            lab.textContent = t('Work email');
            lab.setAttribute('for', 'dz-mail');
            field.appendChild(lab);
            var mail = document.createElement('input');
            mail.id = 'dz-mail';
            mail.type = 'email';
            mail.value = me.email || '';
            mail.readOnly = true;
            field.appendChild(mail);
            setTimeout(function () { mail.focus(); }, 60);
            form.appendChild(field);

            var err = document.createElement('p');
            err.className = 'verr';
            err.hidden = true;
            err.setAttribute('role', 'alert');
            form.appendChild(err);

            var send = wideBtn('Send the reset link', 'cta', 'submit');
            form.appendChild(send);

            var foot = document.createElement('div');
            foot.className = 'vfoot';
            var back2 = linkBtn('Back to account deletion');
            back2.addEventListener('click', function () { swap(stepConfirm, true); });
            foot.appendChild(back2);
            form.appendChild(foot);
            m.body.appendChild(form);

            form.addEventListener('submit', function (e) {
                e.preventDefault();
                send.disabled = true;
                err.hidden = true;
                askLink().then(function (r) {
                    if (!r.ok) {
                        err.textContent = (r.body && r.body.error) || t('That did not work.');
                        err.hidden = false;
                        send.disabled = false;
                        return;
                    }
                    swap(function () { stepSent((r.body && r.body.resendIn) || RESEND_WAIT); });
                });
            });
        }

        function askLink() {
            return fetch('/v1/account/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ lang: (window.SentinelI18n && window.SentinelI18n.lang()) || 'en' })
            }).then(function (r) {
                return r.json().catch(function () { return {}; }).then(function (j) {
                    return { ok: r.ok, body: j };
                });
            }).catch(function () { return { ok: false, body: {} }; });
        }

        function stepSent(waitFor) {
            m.stepBack.hidden = false;
            m.bare(true);

            var done = document.createElement('div');
            done.className = 'vdone';
            done.appendChild(markBadge('vdone-mark', ''));
            done.querySelector('.vdone-mark').innerHTML =
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
                'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"></rect>' +
                '<polyline points="3 6.5 12 13 21 6.5"></polyline></svg>';
            var h3 = document.createElement('h3');
            h3.textContent = t('Check your email');
            done.appendChild(h3);
            var sub = document.createElement('p');
            sub.appendChild(document.createTextNode(
                t('A link to set a new password is on its way to')));
            sub.appendChild(document.createTextNode(' '));
            var b = document.createElement('b');
            b.textContent = me.email || '';
            sub.appendChild(b);
            done.appendChild(sub);

            var err = document.createElement('p');
            err.className = 'verr';
            err.hidden = true;
            err.setAttribute('role', 'alert');
            done.appendChild(err);

            var foot = document.createElement('div');
            foot.className = 'vfoot';
            var again = linkBtn('Send a new link');
            foot.appendChild(again);
            var back2 = linkBtn('Back to account deletion');
            back2.addEventListener('click', function () {
                clearInterval(tick);
                swap(stepConfirm, true);
            });
            foot.appendChild(back2);
            done.appendChild(foot);
            m.body.appendChild(done);

            function hold(seconds) {
                clearInterval(tick);
                var left = seconds;
                function paint() {
                    if (left <= 0) {
                        clearInterval(tick);
                        again.disabled = false;
                        again.textContent = t('Send a new link');
                        return;
                    }
                    again.disabled = true;
                    again.textContent = t('Send a new link in') + ' ' + left + 's';
                    left--;
                }
                again.disabled = true;
                paint();
                tick = setInterval(paint, 1000);
            }

            again.addEventListener('click', function () {
                if (again.disabled) return;
                hold(RESEND_WAIT);
                err.hidden = true;
                askLink().then(function (r) {
                    if (!r.ok) {
                        clearInterval(tick);
                        again.disabled = false;
                        again.textContent = t('Send a new link');
                        err.textContent = (r.body && r.body.error) || t('That did not work.');
                        err.hidden = false;
                    }
                });
            });

            hold(waitFor);
        }

        m.stepBack.addEventListener('click', function () { swap(stepConfirm, true); });
        stepConfirm();
    }


    // A list is cached only to spare you the empty half second on the way in.
    // Every rule here exists to keep it from becoming anything more than that:
    //
    //   sessionStorage, not localStorage, so it dies with the tab and is never
    //     carried across browser sessions or left behind on a shared machine;
    //   stamped with the address it was read for, so another account signing in
    //     on the same tab can never be shown the previous one's anything;
    //   sixty seconds, after which it is ignored rather than shown;
    //   never the deciding answer: the list is always refetched and replaced, so
    //     something revoked or closed elsewhere cannot keep looking alive for
    //     longer than that fetch;
    //   cleared on sign out along with the cached identity;
    //   and it holds no secret, because the server returns those once, at
    //     creation, and none of these are on that path.
    var CACHE_GOOD_FOR = 60 * 1000;

    // Which list goes in which store is a question about what it is, not about
    // how convenient it would be.
    //
    //   The token list is metadata about credentials into a company: what exists,
    //   what it may do, when it was last used. It dies with the tab.
    //
    //   The organisation list is which companies you belong to, which is the same
    //   class of thing as your own name and address, and those already persist so
    //   the avatar is there before the first frame. Keeping it in the same place
    //   is what makes the picker instant on a real page load rather than only on
    //   a second visit in the same tab.
    //
    // Both are cleared on sign out, both are stamped with the address they were
    // read for, and neither is ever the deciding answer: the list is refetched
    // and replaced every time regardless of what was painted from the cache.
    function makeCache(key, store, goodFor) {
        function box() {
            try { return store(); } catch (err) { return null; }
        }
        return {
            read: function (who) {
                var s2 = box();
                if (!s2) return null;
                try {
                    var raw = s2.getItem(key);
                    if (!raw) return null;
                    var got = JSON.parse(raw);
                    if (!got || got.who !== who) return null;
                    if (!got.at || Date.now() - got.at > goodFor) return null;
                    return got;
                } catch (err) {
                    return null;
                }
            },
            write: function (who, payload) {
                var s2 = box();
                if (!s2) return;
                try {
                    var out = { who: who, at: Date.now() };
                    Object.keys(payload).forEach(function (k) { out[k] = payload[k]; });
                    s2.setItem(key, JSON.stringify(out));
                } catch (err) {  }
            },
            forget: function () {
                var s2 = box();
                if (!s2) return;
                try { s2.removeItem(key); } catch (err) {  }
            }
        };
    }

    var tokenCache = makeCache('sp-tokens', function () { return sessionStorage; }, CACHE_GOOD_FOR);
    // a week: it is only ever a head start, and the list behind it is refetched
    // on every visit anyway
    var orgCache = makeCache('sp-orgs', function () { return localStorage; }, 7 * 24 * 60 * 60 * 1000);

    function readTokenCache(who) {
        var box = tokenCache.read(who);
        return box && box.rows && box.rows.length !== undefined ? box : null;
    }

    function writeTokenCache(who, rows, scopes, groups) {
        tokenCache.write(who, {
            scopes: scopes,
            groups: groups,
            rows: rows.map(function (r) {
                return {
                    id: r.id, name: r.name, kind: r.kind, tail: r.tail, scopes: r.scopes,
                    lastUsedAt: r.lastUsedAt, expiresAt: r.expiresAt, revokedAt: r.revokedAt
                };
            })
        });
    }

    function forgetTokenCache() { tokenCache.forget(); }

    function readOrgCache(who) {
        var box = orgCache.read(who);
        return box && box.rows && box.rows.length !== undefined ? box : null;
    }

    function writeOrgCache(who, rows, roles) {
        orgCache.write(who, {
            roles: roles,
            rows: rows.map(function (r) {
                return { id: r.id, name: r.name, host: r.host, slug: r.slug,
                         role: r.role, members: r.members };
            })
        });
    }

    function forgetOrgCache() { orgCache.forget(); }

    function whenText(iso, withTime) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        var opts = { year: 'numeric', month: 'short', day: 'numeric' };
        if (withTime) { opts.hour = '2-digit'; opts.minute = '2-digit'; }
        try {
            opts.timeZone = zoneNow();
            return new Intl.DateTimeFormat(navLang(), opts).format(d);
        } catch (err) {
            return d.toISOString().slice(0, 10);
        }
    }

    function navLang() {
        return (window.SentinelI18n && window.SentinelI18n.lang()) || 'en';
    }

    function daysUntil(iso) {
        if (!iso) return null;
        var d = new Date(iso).getTime();
        if (isNaN(d)) return null;
        return Math.ceil((d - Date.now()) / 86400000);
    }

    function tag(text, kind) {
        var el = document.createElement('span');
        el.className = 'tag' + (kind ? ' tag-' + kind : '');
        el.textContent = text;
        return el;
    }

    function copyBtn(getText) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'copy';
        var label = document.createElement('span');
        label.textContent = t('Copy');
        b.appendChild(label);
        b.addEventListener('click', function () {
            var text = getText();
            var done = function () {
                b.classList.add('is-done');
                label.textContent = t('Copied');
                clearTimeout(b.spTimer);
                b.spTimer = setTimeout(function () {
                    b.classList.remove('is-done');
                    label.textContent = t('Copy');
                }, 1600);
            };
            // the clipboard api needs permission and refuses in some contexts, so a
            // rejection has to fall through to the old way rather than leaving the
            // button silent and the token uncopied.
            var theOldWay = function () {
                var probe = document.createElement('textarea');
                probe.value = text;
                probe.setAttribute('readonly', '');
                probe.style.position = 'fixed';
                probe.style.opacity = '0';
                document.body.appendChild(probe);
                probe.select();
                var won = false;
                try { won = document.execCommand('copy'); } catch (err) { won = false; }
                document.body.removeChild(probe);
                if (won) done();
                else {
                    label.textContent = t('Press ctrl C');
                    var code = b.parentNode && b.parentNode.querySelector('code');
                    if (code && window.getSelection) {
                        var range = document.createRange();
                        range.selectNodeContents(code);
                        var sel = window.getSelection();
                        sel.removeAllRanges();
                        sel.addRange(range);
                    }
                }
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done).catch(theOldWay);
                return;
            }
            theOldWay();
        });
        return b;
    }

    function orghCard(title, ico) {
        var card = document.createElement('section');
        card.className = 'orgh-card';
        var h = document.createElement('div');
        h.className = 'orgh-card-h';
        var mark = document.createElement('span');
        mark.className = 'orgh-ico';
        mark.innerHTML = icon(ico);
        h.appendChild(mark);
        var lab = document.createElement('h2');
        lab.className = 'orgh-card-t';
        lab.textContent = t(title);
        h.appendChild(lab);
        card.appendChild(h);
        return card;
    }

    function orghRole(key) {
        var list = ORG_ROLES || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].key === key) return t(list[i].label);
        }
        return key || '\u2014';
    }

    function orghPlan(state) {
        var said = {
            none: 'No plan yet',
            pending: 'Waiting to be approved',
            starter: 'Free trial',
            verified: 'Free trial',
            expired: 'Trial ended',
            enterprise: 'Enterprise'
        };
        return t(said[state] || 'No plan yet');
    }

    // used against included, as a bar. an unmetered plan says so instead of
    // drawing a bar that would never move.
    function orghMeter(label, used, included, unmetered) {
        var row = document.createElement('div');
        row.className = 'orgh-meter';
        var top = document.createElement('div');
        top.className = 'orgh-meter-h';
        var lab = document.createElement('span');
        lab.textContent = t(label);
        top.appendChild(lab);
        var fig = document.createElement('span');
        fig.className = 'orgh-fig';
        var u = Number(used || 0);
        var inc = Number(included || 0);
        fig.textContent = unmetered
            ? t('Unmetered')
            : (u.toLocaleString() + ' / ' + inc.toLocaleString());
        top.appendChild(fig);
        row.appendChild(top);
        if (!unmetered) {
            var track = document.createElement('div');
            track.className = 'orgh-track';
            var fill = document.createElement('span');
            fill.className = 'orgh-fill';
            var pct = inc > 0 ? Math.min(100, Math.round((u / inc) * 100)) : 0;
            fill.style.width = pct + '%';
            if (pct >= 100) fill.classList.add('is-full');
            track.appendChild(fill);
            row.appendChild(track);
        }
        return row;
    }

    function orghStat(label, value) {
        var row = document.createElement('div');
        row.className = 'orgh-meter';
        var top = document.createElement('div');
        top.className = 'orgh-meter-h';
        var lab = document.createElement('span');
        lab.textContent = t(label);
        top.appendChild(lab);
        var fig = document.createElement('span');
        fig.className = 'orgh-fig';
        fig.textContent = value;
        top.appendChild(fig);
        row.appendChild(top);
        return row;
    }

    // Everyone in the organisation. Read only for now: inviting needs mail going
    // out and a token coming back, which is its own piece of work. What it shows
    // is real, which a screen offering an invite that does nothing would not be.
    // The organisation's landing screen: what it screens for. A project is a
    // boundary inside the company, so a firm running an exchange and a card
    // product can keep their rules, keys and trail apart while sharing one
    // team and one bill.
    function viewProjects(me) {
        var page = document.createElement('div');
        // the same column the organisation picker uses. both are a list of
        // things you pick one of, so they read at the same width.
        page.className = 'pg orgs-pg';
        var org = me.org || {};
        page.appendChild(pageHead('Projects'));

        var bar = document.createElement('div');
        bar.className = 'bar';
        var find = document.createElement('div');
        find.className = 'bar-find';
        find.innerHTML = '<svg class="bar-find-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
            '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>';
        var findIn = document.createElement('input');
        findIn.type = 'search';
        findIn.placeholder = t('Search for a project');
        findIn.autocomplete = 'off';
        find.appendChild(findIn);
        bar.appendChild(find);
        var make = document.createElement('button');
        make.type = 'button';
        make.className = 'btn btn-primary';
        make.textContent = t('New project');
        bar.appendChild(make);
        page.appendChild(bar);

        var list = document.createElement('div');
        list.className = 'prjs';
        page.appendChild(list);

        var rows = [];
        var may = roleAtLeastLocal(org.role, 'admin');
        make.disabled = !may;

        function draw() {
            list.textContent = '';
            var q = findIn.value.trim().toLowerCase();
            var shown = rows.filter(function (r) {
                return !q || r.name.toLowerCase().indexOf(q) !== -1;
            });
            if (!shown.length) {
                list.appendChild(rows.length
                    ? emptyState('Nothing matches that', 'Try a different name.')
                    : emptyState('No projects yet', 'Make one for the first thing you screen for.'));
                return;
            }
            shown.forEach(function (r) { list.appendChild(projectCard(r, org, may, load)); });
        }

        function load() {
            fetch('/v1/orgs/' + encodeURIComponent(org.id) + '/projects', { credentials: 'same-origin' })
                .then(function (r) {
                    if (!r.ok) throw new Error('bad-status-' + r.status);
                    return r.json();
                })
                .then(function (j) {
                    rows = (j && j.rows) || [];
                    draw();
                })
                .catch(function () {
                    list.textContent = '';
                    list.appendChild(emptyState('That did not load.', 'Reload the page to try again.'));
                });
        }

        findIn.addEventListener('input', draw);
        make.addEventListener('click', function () { askProject(org, load); });

        list.appendChild(waiting());
        load();
        return page;
    }

    function projectCard(r, org, may, done) {
        var card = document.createElement('div');
        card.className = 'prj';

        var mark = document.createElement('span');
        mark.className = 'prj-mark';
        mark.innerHTML = icon('projects');
        card.appendChild(mark);

        var txt = document.createElement('span');
        txt.className = 'prj-t';
        var n = document.createElement('span');
        n.className = 'prj-n';
        n.textContent = r.name;
        txt.appendChild(n);
        var sub = document.createElement('span');
        sub.className = 'prj-sub';
        sub.textContent = r.createdAt
            ? t('Added') + '  ·  ' + new Date(r.createdAt).toISOString().slice(0, 10)
            : '';
        txt.appendChild(sub);
        card.appendChild(txt);

        if (may) {
            var edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'prj-act';
            edit.setAttribute('aria-label', t('Rename'));
            edit.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
                'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17Z"/></svg>';
            edit.addEventListener('click', function () { askRenameProject(org, r, done); });
            card.appendChild(edit);

            var kill = document.createElement('button');
            kill.type = 'button';
            kill.className = 'prj-act is-bad';
            kill.setAttribute('aria-label', t('Remove'));
            kill.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
                'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                '<path d="M5 7h14M9 7V5.5h6V7M7 7l1 12.5h8L17 7"/></svg>';
            kill.addEventListener('click', function () { askRemoveProject(org, r, done); });
            card.appendChild(kill);
        }
        return card;
    }

    function askProject(org, done) {
        projectDialog({
            title: 'New project',
            sub: 'Name it after the thing it screens for.',
            label: 'Name',
            placeholder: 'e.g. Card payments',
            value: '',
            go: 'Create project',
            quit: 'Cancel',
            url: '/v1/orgs/' + encodeURIComponent(org.id) + '/projects',
            said: 'Project created',
            done: done
        });
    }

    function askRenameProject(org, project, done) {
        projectDialog({
            title: 'Rename project',
            sub: 'Only the name changes. Nothing in it moves.',
            label: 'Name',
            placeholder: project.name,
            value: project.name,
            go: 'Save',
            quit: 'Cancel',
            url: '/v1/orgs/' + encodeURIComponent(org.id) + '/projects/' +
                encodeURIComponent(project.id) + '/rename',
            said: 'Name saved',
            done: done
        });
    }

    function projectDialog(o) {
        var m = modalShell(o.title, o.sub);
        var form = document.createElement('form');
        form.className = 'vpanel';

        var field = document.createElement('div');
        field.className = 'vfield';
        var lab = document.createElement('label');
        lab.textContent = t(o.label);
        lab.setAttribute('for', 'prj-name');
        field.appendChild(lab);
        var name = document.createElement('input');
        name.id = 'prj-name';
        name.type = 'text';
        name.autocomplete = 'off';
        name.maxLength = 60;
        name.placeholder = t(o.placeholder);
        name.value = o.value || '';
        field.appendChild(name);
        form.appendChild(field);

        var err = document.createElement('p');
        err.className = 'verr';
        err.hidden = true;
        form.appendChild(err);

        var go = wideBtn(o.go, 'cta', 'submit');
        go.disabled = !name.value.trim();
        form.appendChild(go);
        var quit = document.createElement('div');
        quit.className = 'modal-quit';
        var no = wideBtn(o.quit, 'quiet');
        no.addEventListener('click', m.shut);
        quit.appendChild(no);
        form.appendChild(quit);
        m.body.appendChild(form);

        name.addEventListener('input', function () {
            go.disabled = !name.value.trim();
            if (!err.hidden) err.hidden = true;
        });
        setTimeout(function () { name.focus(); }, 60);

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            if (go.disabled) return;
            go.disabled = true;
            err.hidden = true;
            fetch(o.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ name: name.value })
            }).then(function (r) {
                return r.json().catch(function () { return {}; }).then(function (b) {
                    return { ok: r.ok, body: b };
                });
            }).then(function (r) {
                if (!r.ok) {
                    err.textContent = (r.body && r.body.error) || t('That did not work.');
                    err.hidden = false;
                    go.disabled = false;
                    return;
                }
                m.shut();
                toast(t(o.said), 'good');
                o.done();
            }).catch(function () {
                err.textContent = t('That did not work.');
                err.hidden = false;
                go.disabled = false;
            });
        });
    }

    function askRemoveProject(org, project, done) {
        var m = modalShell('Remove this project', 'The project goes. What it screened stays on the organisation.');
        var form = document.createElement('form');
        form.className = 'vpanel';

        var err = document.createElement('p');
        err.className = 'verr';
        err.hidden = true;
        form.appendChild(err);

        var go = wideBtn('Remove it', 'cta', 'submit');
        form.appendChild(go);
        var quit = document.createElement('div');
        quit.className = 'modal-quit';
        var no = wideBtn('Keep it', 'quiet');
        no.addEventListener('click', m.shut);
        quit.appendChild(no);
        form.appendChild(quit);
        m.body.appendChild(form);

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            go.disabled = true;
            fetch('/v1/orgs/' + encodeURIComponent(org.id) + '/projects/' +
                encodeURIComponent(project.id) + '/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: '{}'
            }).then(function (r) {
                if (!r.ok) throw new Error('bad');
                m.shut();
                toast(t('Project removed'), 'good');
                done();
            }).catch(function () {
                err.textContent = t('That did not work.');
                err.hidden = false;
                go.disabled = false;
            });
        });
    }

    function viewTeam(me) {
        var page = document.createElement('div');
        var org = me.org || {};
        page.appendChild(pageHead('Team', 'Everyone here shares the same screenings, cases and tokens.'));

        var card = document.createElement('div');
        card.className = 'card';
        page.appendChild(card);
        card.appendChild(waiting());

        fetch('/v1/orgs/' + encodeURIComponent(org.id) + '/members', { credentials: 'same-origin' })
            .then(function (r) {
                if (!r.ok) throw new Error('bad-status-' + r.status);
                return r.json();
            })
            .then(function (jj) {
                var rows = (jj && jj.rows) || [];
                if (jj && jj.roles && jj.roles.length) ORG_ROLES = jj.roles;
                card.textContent = '';
                if (!rows.length) {
                    card.appendChild(emptyState('Nobody here yet',
                        'That should not happen: you are in it.'));
                    return;
                }
                rows.forEach(function (m) { card.appendChild(memberRow(m)); });
            })
            .catch(function () {
                card.textContent = '';
                card.appendChild(emptyState('That did not load.', 'Reload the page to try again.'));
            });
        return page;
    }

    function memberRow(m) {
        var row = document.createElement('div');
        row.className = 'mem';
        var av = document.createElement('span');
        av.className = 'mem-av';
        av.textContent = initialsOf(m.name || m.email);
        row.appendChild(av);
        var txt = document.createElement('span');
        txt.className = 'mem-t';
        var n = document.createElement('span');
        n.className = 'mem-n';
        n.textContent = m.name || m.email || '—';
        if (m.you) {
            var you = document.createElement('span');
            you.className = 'mem-you';
            you.textContent = t('you');
            n.appendChild(you);
        }
        txt.appendChild(n);
        // somebody who signed up without a name is shown by their address, so
        // the line under it would otherwise repeat the line above it.
        if (m.name && m.email) {
            var sub = document.createElement('span');
            sub.className = 'mem-sub';
            sub.textContent = m.email;
            txt.appendChild(sub);
        }
        row.appendChild(txt);
        var role = document.createElement('span');
        role.className = 'mem-role';
        role.textContent = orghRole(m.role);
        row.appendChild(role);
        return row;
    }

    function initialsOf(who) {
        var bits = String(who || '').trim().split(/[\s@._-]+/).filter(Boolean);
        if (!bits.length) return '?';
        var out = bits[0].charAt(0);
        if (bits.length > 1) out += bits[1].charAt(0);
        return out.toUpperCase();
    }

    // The rail from the overview, with room to breathe and the figures it could
    // not fit.
    function viewUsage(me) {
        var page = document.createElement('div');
        var tr = me.trial || {};
        page.appendChild(pageHead('Usage', 'What this organisation has used in the current period.'));

        var plan = orghCard('Plan', 'plan');
        plan.appendChild(orghStat('Plan', orghPlan(tr.state)));
        if (tr.daysLeft) {
            plan.appendChild(orghStat('Days left', String(tr.daysLeft)));
        }
        page.appendChild(plan);

        var checks = orghCard('Screening', 'screening');
        checks.appendChild(orghMeter('Live checks', tr.liveUsed, tr.liveIncluded, tr.state === 'enterprise'));
        if (!tr.historyOpen) {
            checks.appendChild(orghMeter('History scans', tr.historyUsed, tr.historyIncluded, false));
        }
        checks.appendChild(orghStat('Screenings run', Number(me.screeningsRun || 0).toLocaleString()));
        page.appendChild(checks);

        var c = me.coverage || {};
        var cov = orghCard('Sanctions coverage', 'coverage');
        cov.appendChild(orghStat('List', c.source || 'OFAC SDN'));
        cov.appendChild(orghStat('Addresses', c.addresses ? Number(c.addresses).toLocaleString() : '—'));
        cov.appendChild(orghStat('Dated', c.listDate || '—'));
        page.appendChild(cov);
        return page;
    }

    // What the plan is and how it changes. There is no card on file to show,
    // because nothing here takes cards yet; saying where a change is agreed is
    // the honest version of this screen until there is.
    function viewBilling(me) {
        var page = document.createElement('div');
        var tr = me.trial || {};
        page.appendChild(pageHead('Billing', 'The plan this organisation is on.'));

        var card = orghCard('Plan', 'plan');
        card.appendChild(orghStat('Plan', orghPlan(tr.state)));
        if (tr.daysLeft) card.appendChild(orghStat('Days left', String(tr.daysLeft)));
        card.appendChild(orghStat('Live checks', tr.state === 'enterprise'
            ? t('Unmetered')
            : (Number(tr.liveUsed || 0) + ' / ' + Number(tr.liveIncluded || 0))));
        page.appendChild(card);

        var change = orghCard('Changing plan', 'swap');
        var body = document.createElement('div');
        body.className = 'orgh-body';
        var p2 = document.createElement('p');
        p2.className = 'orgh-line';
        p2.textContent = t('Plans are agreed with us directly, so the price matches what you screen.');
        body.appendChild(p2);
        var link = document.createElement('a');
        link.className = 'btn btn-quiet orgh-act';
        link.href = '/pricing';
        link.textContent = t('See the plans');
        body.appendChild(link);
        change.appendChild(body);
        page.appendChild(change);
        return page;
    }

    // The organisation's own settings: what it is called, what its address is,
    // and the way out.
    function viewOrgSettings(me) {
        var page = document.createElement('div');
        var org = me.org || {};
        page.appendChild(pageHead('Organization settings', 'What this organisation is called, and how to close it.'));

        var may = roleAtLeastLocal(org.role, 'admin');

        var nameCard = orghCard('Name', 'label');
        var body = document.createElement('div');
        body.className = 'orgh-body orgh-form';
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'orgh-in';
        input.value = org.name || '';
        input.maxLength = 80;
        input.disabled = !may;
        body.appendChild(input);
        var save = document.createElement('button');
        save.type = 'button';
        save.className = 'btn btn-primary';
        save.textContent = t('Save');
        save.disabled = true;
        body.appendChild(save);
        nameCard.appendChild(body);
        if (!may) {
            var note = document.createElement('p');
            note.className = 'orgh-line is-quiet';
            note.textContent = t('Only an admin or the owner can change this.');
            nameCard.appendChild(note);
        }
        page.appendChild(nameCard);

        input.addEventListener('input', function () {
            var v = input.value.trim();
            save.disabled = !v || v === (org.name || '');
        });
        save.addEventListener('click', function () {
            save.disabled = true;
            fetch('/v1/orgs/' + encodeURIComponent(org.id) + '/rename', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ name: input.value })
            }).then(function (r) {
                return r.json().catch(function () { return {}; }).then(function (b) {
                    return { ok: r.ok, body: b };
                });
            }).then(function (r) {
                if (!r.ok) {
                    toast((r.body && r.body.error) || t('That did not work.'), 'bad');
                    save.disabled = false;
                    return;
                }
                // the name is on the overview heading and in the picker, so the
                // saved one is put back where the page reads it from and the
                // screen is drawn again rather than left showing the old one.
                org.name = r.body.org.name;
                if (lastMe && lastMe.org) lastMe.org.name = r.body.org.name;
                forgetOrgCache();
                toast(t('Name saved'), 'good');
                render();
            }).catch(function () {
                toast(t('That did not work.'), 'bad');
                save.disabled = false;
            });
        });

        var idCard = orghCard('Address', 'link');
        idCard.appendChild(orghStat('In the url', org.slug || '—'));
        page.appendChild(idCard);

        // the rail no longer carries this, so it is reached from here. a screen
        // that exists and cannot be got to is worse than one that does not.
        var tokCard = orghCard('Access tokens', 'key');
        var tb = document.createElement('div');
        tb.className = 'orgh-body';
        var tp = document.createElement('p');
        tp.className = 'orgh-line';
        tp.textContent = t('Keys that let your own software screen through the API.');
        tb.appendChild(tp);
        var tlink = document.createElement('a');
        tlink.className = 'btn btn-quiet orgh-act';
        tlink.href = orgPath(org.slug, 'tokens');
        tlink.textContent = t('Manage access tokens');
        tb.appendChild(tlink);
        tokCard.appendChild(tb);
        page.appendChild(tokCard);

        if (org.role === 'owner') {
            var dangerCard = orghCard('Close this organisation', 'warn');
            var db2 = document.createElement('div');
            db2.className = 'orgh-body';
            var warn = document.createElement('p');
            warn.className = 'orgh-line';
            warn.textContent = t('Everything in it goes with it, and none of it comes back.');
            db2.appendChild(warn);
            var kill = document.createElement('button');
            kill.type = 'button';
            kill.className = 'btn btn-danger orgh-act';
            kill.textContent = t('Close this organisation');
            kill.addEventListener('click', function () {
                askCloseOrg(org, function () { location.assign(ORGS_PATH); });
            });
            db2.appendChild(kill);
            dangerCard.appendChild(db2);
            page.appendChild(dangerCard);
        }
        return page;
    }

    // the server decides this for real; here it only shapes the screen.
    function roleAtLeastLocal(role, needed) {
        var rank = { viewer: 1, analyst: 2, admin: 3, owner: 4 };
        return (rank[role] || 0) >= (rank[needed] || 0);
    }

    function viewTokens(me) {
        var page = document.createElement('div');
        page.className = 'pg';
        page.appendChild(pageHead('Access tokens',
            'Let your own systems call our API without a person signing in.'));

        var note = document.createElement('div');
        note.className = 'notice';
        note.innerHTML = '<svg class="notice-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<circle cx="12" cy="12" r="9"></circle><path d="M12 11v5M12 8v.01"></path></svg>';
        var noteT = document.createElement('div');
        noteT.className = 'notice-t';
        var noteH = document.createElement('div');
        noteH.className = 'notice-h';
        noteH.textContent = t('Every token is scoped, and shown once');
        noteT.appendChild(noteH);
        var noteP = document.createElement('p');
        noteP.textContent = t('Give each token only what its job needs, and a date to expire on. We store a hash, never the token, so it is shown to you once when you create it and cannot be shown again. A sandbox token is for building against: it reads the same lists but spends nothing and stays out of your real history.');
        noteT.appendChild(noteP);
        note.appendChild(noteT);
        page.appendChild(note);

        var bar = document.createElement('div');
        bar.className = 'bar';
        var find = document.createElement('label');
        find.className = 'bar-find';
        find.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
            'stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle>' +
            '<path d="m19.5 19.5-3.8-3.8"></path></svg>';
        var findIn = document.createElement('input');
        findIn.type = 'search';
        findIn.autocomplete = 'off';
        findIn.placeholder = t('Filter tokens');
        find.appendChild(findIn);
        bar.appendChild(find);

        var split = document.createElement('div');
        split.className = 'split';
        var make = document.createElement('button');
        make.type = 'button';
        make.className = 'btn btn-primary split-main';
        make.textContent = t('Generate new token');
        split.appendChild(make);
        var more = document.createElement('button');
        more.type = 'button';
        more.className = 'btn btn-primary split-more';
        more.setAttribute('aria-haspopup', 'menu');
        more.setAttribute('aria-expanded', 'false');
        more.setAttribute('aria-label', t('More token kinds'));
        more.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
        split.appendChild(more);
        var pop = document.createElement('div');
        pop.className = 'split-pop';
        pop.setAttribute('role', 'menu');
        var sandboxItem = document.createElement('button');
        sandboxItem.type = 'button';
        sandboxItem.className = 'split-opt';
        sandboxItem.setAttribute('role', 'menuitem');
        var siT = document.createElement('span');
        siT.textContent = t('Generate a sandbox token');
        sandboxItem.appendChild(siT);
        var siS = document.createElement('span');
        siS.className = 'split-opt-sub';
        siS.textContent = t('Runs against the same lists, spends nothing, kept apart from your real history.');
        sandboxItem.appendChild(siS);
        pop.appendChild(sandboxItem);
        split.appendChild(pop);
        bar.appendChild(split);
        page.appendChild(bar);

        function openSplit(on) {
            split.classList.toggle('is-open', on);
            more.setAttribute('aria-expanded', on ? 'true' : 'false');
        }
        more.addEventListener('click', function (e) {
            e.stopPropagation();
            openSplit(!split.classList.contains('is-open'));
        });
        pop.addEventListener('click', function (e) { e.stopPropagation(); });
        document.addEventListener('click', function () { openSplit(false); });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') openSplit(false);
        });
        sandboxItem.addEventListener('click', function () {
            openSplit(false);
            askToken(scopes, groups, load, 'test');
        });

        var card = document.createElement('div');
        card.className = 'card';
        page.appendChild(card);

        var who = (me && me.email) || '';
        var warm = readTokenCache(who);
        var rows = warm ? warm.rows : [];
        var scopes = warm ? (warm.scopes || []) : [];
        var groups = warm ? (warm.groups || []) : [];

        function scopeLabel(key) {
            for (var i = 0; i < scopes.length; i++) {
                if (scopes[i].key === key) return t(scopes[i].label);
            }
            return key;
        }

        function draw() {
            card.textContent = '';
            var q = findIn.value.trim().toLowerCase();
            var shown = rows.filter(function (r) {
                return !q || (r.name + ' ' + r.scopes.join(' ')).toLowerCase().indexOf(q) !== -1;
            });

            if (!rows.length) {
                card.appendChild(emptyState('No tokens yet',
                    'When you create one it will appear here, with what it may do and when it expires.'));
                return;
            }
            if (!shown.length) {
                card.appendChild(emptyState('Nothing matches that', 'Try a different name.'));
                return;
            }

            var head = document.createElement('div');
            head.className = 'tr';
            head.classList.add('th');
            ['Token', 'Scopes', 'Last used', 'Expires'].forEach(function (h) {
                var c = document.createElement('div');
                c.textContent = t(h);
                head.appendChild(c);
            });
            head.appendChild(document.createElement('div'));
            card.appendChild(head);

            shown.forEach(function (r) { card.appendChild(tokenRow(r)); });
        }

        function tokenRow(r) {
            var row = document.createElement('div');
            row.className = 'tr' + (r.revokedAt ? ' is-off' : '');

            var who = document.createElement('div');
            var nm = document.createElement('div');
            nm.className = 'tr-name';
            nm.textContent = r.name;
            who.appendChild(nm);
            var sub = document.createElement('div');
            sub.className = 'tr-sub mono';
            sub.textContent = (r.kind === 'test' ? 'sp_test_' : 'sp_live_') + '\u2026' + r.tail;
            who.appendChild(sub);
            row.appendChild(who);

            var sc = document.createElement('div');
            sc.className = 'tr-tags';
            if (r.kind === 'test') sc.appendChild(tag(t('Sandbox'), 'sbx'));
            if (r.revokedAt) sc.appendChild(tag(t('Revoked'), 'off'));
            else r.scopes.forEach(function (k) { sc.appendChild(tag(scopeLabel(k))); });
            row.appendChild(sc);

            var used = document.createElement('div');
            used.className = 'tr-dim';
            // the date keeps the row to one line; the hour is worth having when you
            // are working out whether a token leaked, so it waits on hover.
            used.textContent = r.lastUsedAt ? whenText(r.lastUsedAt) : t('Never');
            if (r.lastUsedAt) used.title = whenText(r.lastUsedAt, true);
            row.appendChild(used);

            var exp = document.createElement('div');
            exp.className = 'tr-dim';
            if (!r.expiresAt) {
                exp.textContent = t('Does not expire');
            } else {
                var left = daysUntil(r.expiresAt);
                exp.textContent = whenText(r.expiresAt);
                if (left !== null && left <= 0) exp.appendChild(tag(t('Expired'), 'off'));
                else if (left !== null && left <= 14) exp.appendChild(tag(t('Soon'), 'warn'));
            }
            row.appendChild(exp);

            var act = document.createElement('div');
            act.className = 'tr-act';
            if (!r.revokedAt) {
                var kill = document.createElement('button');
                kill.type = 'button';
                kill.className = 'rowbtn';
                kill.textContent = t('Revoke');
                kill.addEventListener('click', function () { askRevoke(r, load); });
                act.appendChild(kill);
            }
            row.appendChild(act);
            return row;
        }

        function load() {
            fetch('/v1/account/tokens', { credentials: 'same-origin' })
                .then(function (r) {
                    // a 500 still parses as json, so the status has to be the thing
                    // that decides. without this an error read as an empty account.
                    if (!r.ok) throw new Error('bad-status-' + r.status);
                    return r.json();
                })
                .then(function (j) {
                    rows = (j && j.rows) || [];
                    scopes = (j && j.scopes) || [];
                    groups = (j && j.scopeGroups) || [];
                    writeTokenCache(who, rows, scopes, groups);
                    draw();
                })
                .catch(function () {
                    // a cached list on screen is better than replacing it with an
                    // error, so only an empty page says the fetch failed.
                    forgetTokenCache();
                    if (rows.length) return;
                    card.textContent = '';
                    card.appendChild(emptyState('That did not load.', 'Reload the page to try again.'));
                });
        }

        findIn.addEventListener('input', draw);
        make.addEventListener('click', function () { askToken(scopes, groups, load, 'live'); });

        if (warm) draw();
        else card.appendChild(waiting());
        load();
        return page;
    }

    // on a cold visit there is nothing to show yet. the shape of the table reads
    // as the page arriving, where the word Loading reads as the page being late.
    function waiting() {
        var box = document.createElement('div');
        box.className = 'waiting';
        box.setAttribute('aria-hidden', 'true');
        for (var i = 0; i < 3; i++) {
            var row = document.createElement('div');
            row.className = 'tr';
            for (var j = 0; j < 4; j++) {
                var cell = document.createElement('div');
                var bar = document.createElement('span');
                bar.className = 'shim';
                cell.appendChild(bar);
                row.appendChild(cell);
            }
            row.appendChild(document.createElement('div'));
            box.appendChild(row);
        }
        return box;
    }

    function emptyState(title, sub) {
        var box = document.createElement('div');
        box.className = 'empty';
        var h = document.createElement('div');
        h.className = 'empty-h';
        h.textContent = t(title);
        box.appendChild(h);
        if (sub) {
            var p = document.createElement('p');
            p.textContent = t(sub);
            box.appendChild(p);
        }
        return box;
    }

    function askRevoke(row, done) {
        var m = modalShell('Revoke this token',
            'Anything still using it stops working the moment this goes through.');
        var body = document.createElement('div');
        body.className = 'vpanel';

        var who = document.createElement('div');
        who.className = 'modal-who mono';
        who.textContent = row.name + '  ' + 'sp_live_' + '\u2026' + row.tail;
        body.appendChild(who);

        var msg = document.createElement('p');
        msg.className = 'verr';
        msg.hidden = true;
        body.appendChild(msg);

        var yes = wideBtn('Revoke token', 'cta');
        body.appendChild(yes);
        var quit = document.createElement('div');
        quit.className = 'modal-quit';
        var no = wideBtn('Keep it', 'quiet');
        no.addEventListener('click', m.shut);
        quit.appendChild(no);
        body.appendChild(quit);
        m.body.appendChild(body);

        yes.addEventListener('click', function () {
            yes.disabled = true;
            msg.hidden = true;
            fetch('/v1/account/tokens/' + encodeURIComponent(row.id) + '/revoke', {
                method: 'POST', credentials: 'same-origin'
            }).then(function (r) {
                return r.json().catch(function () { return {}; }).then(function (j) {
                    return { ok: r.ok, body: j };
                });
            }).then(function (r) {
                if (!r.ok) {
                    msg.textContent = (r.body && r.body.error) || t('That did not work.');
                    msg.hidden = false;
                    yes.disabled = false;
                    return;
                }
                m.shut();
                toast(t('Token revoked'), 'good');
                done();
            }).catch(function () {
                msg.textContent = t('That did not work.');
                msg.hidden = false;
                yes.disabled = false;
            });
        });
    }

    var RISK_ORDER = ['low', 'medium', 'high'];
    var RISK_LABEL = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' };

    function riskPill(level) {
        var el = document.createElement('span');
        el.className = 'risk risk-' + level;
        el.textContent = t(RISK_LABEL[level] || level);
        return el;
    }

    var PRESETS = [
        { key: 'none', label: 'No access' },
        { key: 'read', label: 'Read only' },
        { key: 'all', label: 'Full access' }
    ];

    var TTL_CHOICES = [
        { value: '30', label: '30 days' },
        { value: '90', label: '90 days' },
        { value: '180', label: '180 days' },
        { value: '365', label: 'A year' },
        { value: '0', label: 'Does not expire' }
    ];

    // creating a token asks for four things and then has something to say about
    // what it granted, which is more than a dialog in the middle of the screen
    // wants to hold. a panel from the side gives it room and keeps the list you
    // came from visible behind it.
    function drawer(title) {
        var back = document.createElement('div');
        back.className = 'drw-back';
        var box = document.createElement('aside');
        box.className = 'drw';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.tabIndex = -1;

        var head = document.createElement('header');
        head.className = 'drw-head';
        var h = document.createElement('h2');
        h.className = 'drw-h';
        h.textContent = t(title);
        head.appendChild(h);
        var x = document.createElement('button');
        x.type = 'button';
        x.className = 'modal-x drw-x';
        x.setAttribute('aria-label', t('Close'));
        x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
            '<path d="M6 6 18 18M18 6 6 18"/></svg>';
        head.appendChild(x);
        box.appendChild(head);

        var body = document.createElement('div');
        body.className = 'drw-body';
        box.appendChild(body);

        var foot = document.createElement('footer');
        foot.className = 'drw-foot';
        var where = document.createElement('div');
        where.className = 'drw-where';
        foot.appendChild(where);
        var acts = document.createElement('div');
        acts.className = 'drw-acts';
        foot.appendChild(acts);
        box.appendChild(foot);

        back.appendChild(box);
        document.body.appendChild(back);
        void back.offsetWidth;
        back.classList.add('is-in');
        document.documentElement.classList.add('is-modal');
        box.focus();

        // leaving is marked with its own class rather than just dropping is-in, so
        // the way out can be timed differently from the way in. on a phone the
        // panel is the whole screen and has to travel the whole way off it.
        function shut() {
            if (back.classList.contains('is-out')) return;
            back.classList.add('is-out');
            back.classList.remove('is-in');
            document.documentElement.classList.remove('is-modal');
            document.removeEventListener('keydown', onKey);
            setTimeout(function () {
                if (back.parentNode) back.parentNode.removeChild(back);
            }, 420);
        }
        function onKey(e) { if (e.key === 'Escape') shut(); }
        document.addEventListener('keydown', onKey);
        x.addEventListener('click', shut);
        back.addEventListener('click', function (e) { if (e.target === back) shut(); });

        return {
            box: box, body: body, acts: acts, shut: shut,
            retitle: function (v) { h.textContent = t(v); },
            steps: function (at, of, label) {
                where.textContent = '';
                if (!of) return;
                var dots = document.createElement('span');
                dots.className = 'drw-dots';
                for (var i = 1; i <= of; i++) {
                    var d = document.createElement('i');
                    if (i <= at) d.className = 'is-on';
                    dots.appendChild(d);
                }
                where.appendChild(dots);
                var txt = document.createElement('span');
                txt.textContent = t('Step') + ' ' + at + ' ' + t('of') + ' ' + of +
                    '  \u00b7  ' + t(label);
                where.appendChild(txt);
            },
            show: function (build, backwards) {
                body.textContent = '';
                acts.textContent = '';
                build();
                body.style.setProperty('--step-dir', backwards ? '-14px' : '14px');
                body.classList.remove('is-stepping');
                void body.offsetWidth;
                body.classList.add('is-stepping');
                body.scrollTop = 0;
            }
        };
    }

    function drwSection(label, hint, control, mid) {
        var sec = document.createElement('div');
        sec.className = 'drw-sec';
        if (mid) sec.classList.add('is-mid');
        var left = document.createElement('div');
        left.className = 'drw-sec-l';
        var lab = document.createElement('div');
        lab.className = 'drw-sec-h';
        lab.textContent = t(label);
        left.appendChild(lab);
        if (hint) {
            var p = document.createElement('p');
            p.textContent = t(hint);
            left.appendChild(p);
        }
        sec.appendChild(left);
        var right = document.createElement('div');
        right.className = 'drw-sec-r';
        if (control) right.appendChild(control);
        sec.appendChild(right);
        return sec;
    }

    function pickCard(title, sub, on, badge) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'card-pick' + (on ? ' is-on' : '');
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        var dot = document.createElement('span');
        dot.className = 'card-pick-dot';
        b.appendChild(dot);
        var txt = document.createElement('span');
        txt.className = 'card-pick-t';
        var line = document.createElement('span');
        line.className = 'card-pick-h';
        line.textContent = t(title);
        if (badge) {
            // the same bare monospace the scope keys use a few rows below. a
            // coloured pill here and plain code there was two ways of saying
            // the same kind of thing in one panel.
            var tg = document.createElement('code');
            tg.textContent = badge;
            line.appendChild(tg);
        }
        txt.appendChild(line);
        var p = document.createElement('span');
        p.className = 'card-pick-p';
        p.textContent = t(sub);
        txt.appendChild(p);
        b.appendChild(txt);
        return b;
    }

    function askToken(scopes, groups, done, kind) {
        // read only and full access are worked out from the scope list itself, so
        // a scope added on the server joins the right preset without being named
        // here as well.
        function presetFor(name) {
            if (name === 'all') return scopes.map(function (s2) { return s2.key; });
            if (name === 'read') {
                return scopes.filter(function (s2) { return !s2.writes; })
                    .map(function (s2) { return s2.key; });
            }
            return [];
        }
        var want = {
            name: '',
            kind: kind === 'test' ? 'test' : 'live',
            days: '90',
            scopes: {}
        };
        var d = drawer('Generate token');

        function scopeLabel(key) {
            for (var i = 0; i < scopes.length; i++) {
                if (scopes[i].key === key) return t(scopes[i].label);
            }
            return key;
        }
        function chosen() {
            return Object.keys(want.scopes).filter(function (k) { return want.scopes[k]; });
        }
        function ttlLabel() {
            for (var i = 0; i < TTL_CHOICES.length; i++) {
                if (TTL_CHOICES[i].value === want.days) return t(TTL_CHOICES[i].label);
            }
            return want.days;
        }

        function stepConfigure() {
            d.retitle('Generate token');
            d.steps(1, 2, 'Configure');

            var nameIn = document.createElement('input');
            nameIn.type = 'text';
            nameIn.id = 'tk-name';
            nameIn.className = 'modal-in';
            nameIn.autocomplete = 'off';
            nameIn.maxLength = 60;
            nameIn.value = want.name;
            nameIn.placeholder = t('e.g. Billing service');
            d.body.appendChild(drwSection('Name',
                'Something you will recognise in this list a year from now.', nameIn, true));

            d.body.appendChild(drwSection('Expires after',
                'A token that never expires is one you can forget you issued.',
                selectBox('tk-ttl', [{
                    options: TTL_CHOICES.map(function (c) {
                        return { value: c.value, label: t(c.label) };
                    })
                }], want.days, function (v) { want.days = v; }), true));

            var kinds = document.createElement('div');
            kinds.className = 'card-picks';
            kinds.setAttribute('role', 'radiogroup');
            var liveCard = pickCard('Live',
                'Screens for real. Spends your checks and writes to the history you report on.',
                want.kind === 'live');
            var testCard = pickCard('Sandbox',
                'Same lists, spends nothing, kept in a history of its own. For building against.',
                want.kind === 'test', 'sp_test_');
            function markKinds() {
                [[liveCard, 'live'], [testCard, 'test']].forEach(function (pair) {
                    var on = want.kind === pair[1];
                    pair[0].classList.toggle('is-on', on);
                    pair[0].setAttribute('aria-checked', on ? 'true' : 'false');
                });
            }
            liveCard.addEventListener('click', function () { want.kind = 'live'; markKinds(); });
            testCard.addEventListener('click', function () { want.kind = 'test'; markKinds(); });
            kinds.appendChild(liveCard);
            kinds.appendChild(testCard);
            d.body.appendChild(drwSection('What it screens against',
                'This cannot be changed later. Issue another token instead.', kinds));

            // the permission list has outgrown the two column row: groups carry a
            // line of explanation and a scope key, and squeezed into the right
            // half they wrapped a word per line. the preset stays beside the
            // heading; the groups run the full width beneath both.
            var permSec = document.createElement('div');
            permSec.className = 'drw-sec';
            permSec.classList.add('is-full');
            var permL = document.createElement('div');
            permL.className = 'drw-sec-l';
            var permH = document.createElement('div');
            permH.className = 'drw-sec-h';
            permH.textContent = t('Permissions');
            permL.appendChild(permH);
            var permP = document.createElement('p');
            permP.textContent = t('Everything is off until you turn it on. Give a token the least that does its job.');
            permL.appendChild(permP);
            permSec.appendChild(permL);

            var presetWrap = document.createElement('div');
            presetWrap.className = 'drw-sec-r';
            permSec.appendChild(presetWrap);

            var warnHost = document.createElement('div');
            warnHost.className = 'warn-host';
            permSec.appendChild(warnHost);

            var groupsHost = document.createElement('div');
            groupsHost.className = 'grp-list';
            permSec.appendChild(groupsHost);

            var openGroups = {};
            var presetBox = null;

            function scopesIn(gk) {
                return scopes.filter(function (sc) { return (sc.group || 'other') === gk; });
            }
            function onIn(gk) {
                return scopesIn(gk).filter(function (sc) { return want.scopes[sc.key]; }).length;
            }
            // which preset the current selection amounts to. derived, so it stays
            // honest when boxes are ticked by hand.
            function presetNow() {
                var on = chosen().sort().join(' ');
                if (!on) return 'none';
                if (on === scopes.map(function (s) { return s.key; }).sort().join(' ')) return 'all';
                var reads = scopes.filter(function (s) { return !s.writes; })
                    .map(function (s) { return s.key; }).sort().join(' ');
                if (on === reads) return 'read';
                return 'custom';
            }

            // shown while the token is being handed everything. it counts the high
            // risk scopes rather than saying "including high risk things", because
            // the number is the part that makes someone stop.
            function paintWarn() {
                warnHost.textContent = '';
                if (presetNow() !== 'all') return;
                var high = scopes.filter(function (sc) { return sc.risk === 'high'; }).length;

                var box = document.createElement('div');
                box.className = 'warn';
                var mark = document.createElement('span');
                mark.className = 'warn-i';
                mark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                    '<path d="M12 8.5v5M12 16.9v.1"/>' +
                    '<path d="M10.3 4.3 2.8 18a1.8 1.8 0 0 0 1.6 2.7h15.2A1.8 1.8 0 0 0 21.2 18L13.7 4.3a1.9 1.9 0 0 0-3.4 0Z"/></svg>';
                box.appendChild(mark);
                var txt = document.createElement('div');
                txt.className = 'warn-t';
                var h = document.createElement('div');
                h.className = 'warn-h';
                h.textContent = t('Full access');
                txt.appendChild(h);
                var p2 = document.createElement('p');
                p2.textContent = t('This token will be able to do everything the account can, including the') +
                    ' ' + high + ' ' + t('marked high risk below. Issue it only if something genuinely needs all of it.');
                txt.appendChild(p2);
                box.appendChild(txt);
                warnHost.appendChild(box);
            }

            function paintPreset() {
                presetWrap.textContent = '';
                var now = presetNow();
                var opts = PRESETS.map(function (pr) {
                    return { value: pr.key, label: t('Preset') + '  \u00b7  ' + t(pr.label) };
                });
                if (now === 'custom') {
                    opts.push({ value: 'custom', label: t('Preset') + '  \u00b7  ' + t('Custom') });
                }
                presetBox = selectBox('tk-preset', [{ options: opts }], now, function (v) {
                    if (v === 'custom') return;
                    want.scopes = {};
                    presetFor(v).forEach(function (k) { want.scopes[k] = true; });
                    paintGroups();
                    paintPreset();
                    paintWarn();
                    sync();
                });
                presetWrap.appendChild(presetBox);
            }

            function paintGroups() {
                groupsHost.textContent = '';
                groups.forEach(function (g) {
                    var mine = scopesIn(g.key);
                    if (!mine.length) return;
                    var box = document.createElement('div');
                    box.className = 'grp' + (openGroups[g.key] ? ' is-open' : '');

                    var head = document.createElement('button');
                    head.type = 'button';
                    head.className = 'grp-head';
                    head.setAttribute('aria-expanded', openGroups[g.key] ? 'true' : 'false');
                    var ht = document.createElement('span');
                    ht.className = 'grp-t';
                    var hn = document.createElement('span');
                    hn.className = 'grp-n';
                    hn.textContent = t(g.label);
                    ht.appendChild(hn);
                    var hh = document.createElement('span');
                    hh.className = 'grp-h';
                    hh.textContent = t(g.hint);
                    ht.appendChild(hh);
                    head.appendChild(ht);

                    var count = document.createElement('span');
                    var n = onIn(g.key);
                    count.className = 'grp-c' + (n ? ' is-on' : '');
                    count.textContent = n
                        ? n + ' ' + t('of') + ' ' + mine.length + ' ' + t('allowed')
                        : t('None');
                    head.appendChild(count);

                    var chev = document.createElement('span');
                    chev.className = 'grp-chev';
                    chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                        'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                        '<path d="m6 9 6 6 6-6"/></svg>';
                    head.appendChild(chev);
                    head.addEventListener('click', function () {
                        openGroups[g.key] = !openGroups[g.key];
                        paintGroups();
                    });
                    box.appendChild(head);

                    var body = document.createElement('div');
                    body.className = 'grp-body';
                    // the rows go inside one wrapper: the collapse animates the
                    // body from no rows to one row, and with the ticks as direct
                    // children only the first of them was being folded away.
                    var inner = document.createElement('div');
                    body.appendChild(inner);
                    mine.forEach(function (sc) {
                        var row = document.createElement('label');
                        row.className = 'tick';
                        var tickBox = document.createElement('input');
                        tickBox.type = 'checkbox';
                        tickBox.checked = !!want.scopes[sc.key];
                        tickBox.addEventListener('change', function () {
                            want.scopes[sc.key] = tickBox.checked;
                            paintGroups();
                            paintPreset();
                            paintWarn();
                            sync();
                        });
                        row.appendChild(tickBox);
                        var txt = document.createElement('span');
                        txt.className = 'tick-t';
                        var tn = document.createElement('span');
                        tn.className = 'tick-n';
                        tn.textContent = t(sc.label);
                        txt.appendChild(tn);
                        if (sc.hint) {
                            var th = document.createElement('span');
                            th.className = 'tick-h';
                            th.textContent = t(sc.hint);
                            txt.appendChild(th);
                        }
                        // a scope whose endpoints are not wired yet still grants
                        // nothing, so the row says so rather than letting the
                        // tick imply otherwise.
                        if (sc.risk) tn.appendChild(riskPill(sc.risk));
                        if (!sc.live) {
                            var soon = document.createElement('span');
                            soon.className = 'tick-soon';
                            soon.textContent = t('Not live yet');
                            tn.appendChild(soon);
                        }
                        row.appendChild(txt);
                        var code = document.createElement('code');
                        code.textContent = sc.key;
                        row.appendChild(code);
                        inner.appendChild(row);
                    });
                    box.appendChild(body);
                    groupsHost.appendChild(box);
                });
            }

            paintPreset();
            paintWarn();
            paintGroups();
            d.body.appendChild(permSec);

            var no = document.createElement('button');
            no.type = 'button';
            no.className = 'btn btn-flat';
            no.textContent = t('Cancel');
            no.addEventListener('click', d.shut);
            d.acts.appendChild(no);

            var next = document.createElement('button');
            next.type = 'button';
            next.className = 'btn btn-primary';
            next.textContent = t('Review access');
            next.addEventListener('click', function () {
                d.show(stepReview);
            });
            d.acts.appendChild(next);

            function sync() {
                next.disabled = !nameIn.value.trim() || !chosen().length;
            }
            nameIn.addEventListener('input', function () {
                want.name = nameIn.value;
                sync();
            });
            sync();
            setTimeout(function () { nameIn.focus(); }, 60);
        }

        function stepReview() {
            d.retitle('Review access');
            d.steps(2, 2, 'Review');

            var sum = document.createElement('dl');
            sum.className = 'sum';
            function line(k, v, mono) {
                var dt = document.createElement('dt');
                dt.textContent = t(k);
                sum.appendChild(dt);
                var dd = document.createElement('dd');
                if (mono) dd.className = 'mono';
                dd.textContent = v;
                sum.appendChild(dd);
            }
            line('Name', want.name.trim());
            line('Prefix', want.kind === 'test' ? 'sp_test_' : 'sp_live_', true);
            line('Screens against', t(want.kind === 'test' ? 'Sandbox' : 'Live'));
            line('Expires after', ttlLabel());
            d.body.appendChild(drwSection('This token', '', sum));

            var may = document.createElement('div');
            may.className = 'grants-wrap';
            groups.forEach(function (g) {
                var mine = scopes.filter(function (sc) { return (sc.group || 'other') === g.key; });
                if (!mine.length) return;
                var h = document.createElement('div');
                h.className = 'grants-g';
                h.textContent = t(g.label);
                may.appendChild(h);
                var ul = document.createElement('ul');
                ul.className = 'grants';
                mine.forEach(function (sc) {
                    var li = document.createElement('li');
                    li.className = want.scopes[sc.key] ? 'is-yes' : 'is-no';
                    li.textContent = t(sc.label);
                    ul.appendChild(li);
                });
                may.appendChild(ul);
            });
            d.body.appendChild(drwSection('What it will be able to do',
                'Anything not ticked is refused, not merely hidden.', may));

            var err = document.createElement('p');
            err.className = 'verr drw-err';
            err.hidden = true;
            d.body.appendChild(err);

            var back = document.createElement('button');
            back.type = 'button';
            back.className = 'btn btn-flat';
            back.textContent = t('Back');
            back.addEventListener('click', function () { d.show(stepConfigure, true); });
            d.acts.appendChild(back);

            var go2 = document.createElement('button');
            go2.type = 'button';
            go2.className = 'btn btn-primary';
            go2.textContent = t('Generate token');
            go2.addEventListener('click', function () {
                go2.disabled = true;
                err.hidden = true;
                fetch('/v1/account/tokens', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({
                        name: want.name,
                        kind: want.kind,
                        days: Number(want.days),
                        scopes: chosen()
                    })
                }).then(function (r) {
                    return r.json().catch(function () { return {}; }).then(function (j) {
                        return { ok: r.ok, body: j };
                    });
                }).then(function (r) {
                    if (!r.ok) {
                        err.textContent = (r.body && r.body.error) || t('That did not work.');
                        err.hidden = false;
                        go2.disabled = false;
                        return;
                    }
                    done();
                    d.show(function () { stepShow(r.body.token); });
                }).catch(function () {
                    err.textContent = t('That did not work.');
                    err.hidden = false;
                    go2.disabled = false;
                });
            });
            d.acts.appendChild(go2);
        }

        function stepShow(secret) {
            d.retitle('Copy it now');
            d.steps(0, 0, '');

            var head = document.createElement('div');
            head.className = 'vhead drw-done';
            var mark = document.createElement('div');
            mark.className = 'vmark';
            mark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
                'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                '<polyline points="20 6 9 17 4 12"></polyline></svg>';
            head.appendChild(mark);
            var h3 = document.createElement('h3');
            h3.textContent = t('Copy it now');
            head.appendChild(h3);
            var p = document.createElement('p');
            p.textContent = t('This is the only time we can show you this token. We keep a hash of it, not the token itself.');
            head.appendChild(p);
            d.body.appendChild(head);

            var secretBox = document.createElement('div');
            secretBox.className = 'secret drw-secret';
            var code = document.createElement('code');
            code.textContent = secret;
            secretBox.appendChild(code);
            secretBox.appendChild(copyBtn(function () { return secret; }));
            d.body.appendChild(secretBox);

            var fin = document.createElement('button');
            fin.type = 'button';
            fin.className = 'btn btn-primary';
            fin.textContent = t('I have copied it');
            fin.addEventListener('click', d.shut);
            d.acts.appendChild(fin);
        }

        d.show(stepConfigure);
    }

    // Choosing which company you are working in. It has no sidebar because there
    // is nothing to navigate to until the choice is made, and because everything
    // in that sidebar belongs to an organisation.
    function viewOrgs(me) {
        var page = document.createElement('div');
        page.className = 'pg orgs-pg';
        page.appendChild(pageHead('Your organisations',
            'An organisation is your company. Its screenings, cases and tokens are shared by everyone in it.'));

        var bar = document.createElement('div');
        bar.className = 'bar';
        var find = document.createElement('label');
        find.className = 'bar-find';
        find.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
            'stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle>' +
            '<path d="m19.5 19.5-3.8-3.8"></path></svg>';
        var findIn = document.createElement('input');
        findIn.type = 'search';
        findIn.autocomplete = 'off';
        findIn.placeholder = t('Search for an organisation');
        find.appendChild(findIn);
        bar.appendChild(find);

        var make = document.createElement('button');
        make.type = 'button';
        make.className = 'btn btn-primary';
        make.textContent = t('New organisation');
        bar.appendChild(make);
        page.appendChild(bar);

        var list = document.createElement('div');
        list.className = 'orgs';
        page.appendChild(list);

        var who = (me && me.email) || '';
        var warm = readOrgCache(who);
        var rows = warm ? warm.rows : [];
        if (warm && warm.roles && warm.roles.length) ORG_ROLES = warm.roles;

        function roleLabel(key) {
            for (var i = 0; i < ORG_ROLES.length; i++) {
                if (ORG_ROLES[i].key === key) return t(ORG_ROLES[i].label);
            }
            return key;
        }

        function draw() {
            list.textContent = '';
            var q = findIn.value.trim().toLowerCase();
            var shown = rows.filter(function (r) {
                return !q || (r.name + ' ' + r.host).toLowerCase().indexOf(q) !== -1;
            });
            if (!rows.length) {
                list.appendChild(emptyState('No organisations yet',
                    'Make one for your company, and everything you check will live in it.'));
                return;
            }
            if (!shown.length) {
                list.appendChild(emptyState('Nothing matches that', 'Try a different name.'));
                return;
            }
            shown.forEach(function (r) { list.appendChild(orgCard(r)); });
        }

        function orgCard(r) {
            var card = document.createElement('div');
            card.className = 'org';
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'org-go';
            // an organisation is a group of people, not an initial. the letter
            // said nothing the name beside it was not already saying.
            var mark = document.createElement('span');
            mark.className = 'org-mark';
            mark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                '<circle cx="12" cy="7" r="2.6"/>' +
                '<circle cx="6.5" cy="16.5" r="2.6"/>' +
                '<circle cx="17.5" cy="16.5" r="2.6"/>' +
                '<path d="M10.1 8.7 8.4 14M13.9 8.7l1.7 5.3M9.1 16.5h5.8"/></svg>';
            b.appendChild(mark);
            var txt = document.createElement('span');
            txt.className = 'org-t';
            var n = document.createElement('span');
            n.className = 'org-n';
            n.textContent = r.name;
            txt.appendChild(n);
            var sub = document.createElement('span');
            sub.className = 'org-sub';
            // your part in it and how many of you there are. the host used to be
            // here too, but nothing ever set it: it was the domain of whoever
            // signed up, so every row read back the same personal address.
            var bits = [roleLabel(r.role)];
            if (r.members) {
                bits.push(r.members + ' ' + t(r.members === 1 ? 'member' : 'members'));
            }
            sub.textContent = bits.join('  \u00b7  ');
            txt.appendChild(sub);
            b.appendChild(txt);
            var chev = document.createElement('span');
            chev.className = 'org-chev';
            chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
                'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
            b.appendChild(chev);
            card.appendChild(b);

            // only an owner sees this, because only an owner may
            if (r.role === 'owner') {
                var kill = document.createElement('button');
                kill.type = 'button';
                kill.className = 'org-del';
                kill.setAttribute('aria-label', t('Close this organisation'));
                kill.title = t('Close this organisation');
                kill.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                    '<path d="M4 7h16M10 11v6M14 11v6"/>' +
                    '<path d="M6 7l1 12.5h10L18 7M9.5 7V4.5h5V7"/></svg>';
                kill.addEventListener('click', function (e) {
                    e.stopPropagation();
                    askCloseOrg(r, load);
                });
                card.appendChild(kill);
            }
            b.addEventListener('click', function () {
                b.disabled = true;
                forgetTokenCache();
                markPicked();
                // the address does the choosing; the page resolves the slug on
                // arrival and the cookie follows it
                location.assign(orgHome(r.slug));
            });
            return card;
        }

        function load() {
            fetch('/v1/orgs', { credentials: 'same-origin' })
                .then(function (r) {
                    if (!r.ok) throw new Error('bad-status-' + r.status);
                    return r.json();
                })
                .then(function (j) {
                    rows = (j && j.rows) || [];
                    if (j && j.roles && j.roles.length) ORG_ROLES = j.roles;
                    writeOrgCache(who, rows, ORG_ROLES);
                    draw();
                })
                .catch(function () {
                    // a cached list on screen beats replacing it with an error,
                    // so only an empty page says the fetch failed
                    forgetOrgCache();
                    if (rows.length) return;
                    list.textContent = '';
                    list.appendChild(emptyState('That did not load.', 'Reload the page to try again.'));
                });
        }

        findIn.addEventListener('input', draw);
        make.addEventListener('click', function () { askOrg(load); });

        if (warm) draw();
        else list.appendChild(waiting());
        load();
        return page;
    }

    var ORG_ROLES = [
        { key: 'owner', label: 'Owner' },
        { key: 'admin', label: 'Admin' },
        { key: 'analyst', label: 'Analyst' },
        { key: 'viewer', label: 'Viewer' }
    ];

    function askCloseOrg(org, done) {
        var m = modalShell('Close this organisation',
            'Everything in it goes with it, and none of it comes back.');
        var form = document.createElement('form');
        form.className = 'vpanel';

        var field = document.createElement('div');
        field.className = 'vfield';
        var lab = document.createElement('label');
        lab.textContent = t('Type the name to confirm');
        lab.setAttribute('for', 'org-kill');
        field.appendChild(lab);
        var typed = document.createElement('input');
        typed.id = 'org-kill';
        typed.type = 'text';
        typed.autocomplete = 'off';
        typed.placeholder = org.name;
        field.appendChild(typed);
        form.appendChild(field);

        var err = document.createElement('p');
        err.className = 'verr';
        err.hidden = true;
        form.appendChild(err);

        var go2 = wideBtn('Close it for good', 'cta', 'submit');
        go2.disabled = true;
        form.appendChild(go2);
        var quit = document.createElement('div');
        quit.className = 'modal-quit';
        var no = wideBtn('Keep it', 'quiet');
        no.addEventListener('click', m.shut);
        quit.appendChild(no);
        form.appendChild(quit);
        m.body.appendChild(form);

        typed.addEventListener('input', function () {
            go2.disabled = typed.value.trim().toLowerCase() !== String(org.name).trim().toLowerCase();
            if (!err.hidden) err.hidden = true;
        });
        setTimeout(function () { typed.focus(); }, 60);

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            if (go2.disabled) return;
            go2.disabled = true;
            err.hidden = true;
            fetch('/v1/orgs/' + encodeURIComponent(org.id) + '/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ name: typed.value })
            }).then(function (r) {
                return r.json().catch(function () { return {}; }).then(function (j) {
                    return { ok: r.ok, body: j };
                });
            }).then(function (r) {
                if (!r.ok) {
                    err.textContent = (r.body && r.body.error) || t('That did not work.');
                    err.hidden = false;
                    go2.disabled = false;
                    return;
                }
                m.shut();
                forgetTokenCache();
                forgetOrgCache();
                forgetPicked();
                toast(t('Organisation closed'), 'good');
                done();
            }).catch(function () {
                err.textContent = t('That did not work.');
                err.hidden = false;
                go2.disabled = false;
            });
        });
    }

    function askOrg(done) {
        var m = modalShell('New organisation',
            'Name it after the company. Everyone you invite into it shares the same work.');
        var form = document.createElement('form');
        form.className = 'vpanel';

        var field = document.createElement('div');
        field.className = 'vfield';
        var lab = document.createElement('label');
        lab.textContent = t('Name');
        lab.setAttribute('for', 'org-name');
        field.appendChild(lab);
        var name = document.createElement('input');
        name.id = 'org-name';
        name.type = 'text';
        name.autocomplete = 'organization';
        name.maxLength = 80;
        name.placeholder = t('e.g. Acme Exchange');
        field.appendChild(name);
        form.appendChild(field);

        var err = document.createElement('p');
        err.className = 'verr';
        err.hidden = true;
        form.appendChild(err);

        var go2 = wideBtn('Create organisation', 'cta', 'submit');
        go2.disabled = true;
        form.appendChild(go2);
        var quit = document.createElement('div');
        quit.className = 'modal-quit';
        var no = wideBtn('Cancel', 'quiet');
        no.addEventListener('click', m.shut);
        quit.appendChild(no);
        form.appendChild(quit);
        m.body.appendChild(form);

        name.addEventListener('input', function () {
            go2.disabled = !name.value.trim();
            if (!err.hidden) err.hidden = true;
        });
        setTimeout(function () { name.focus(); }, 60);

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            if (go2.disabled) return;
            go2.disabled = true;
            err.hidden = true;
            fetch('/v1/orgs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ name: name.value })
            }).then(function (r) {
                return r.json().catch(function () { return {}; }).then(function (j) {
                    return { ok: r.ok, body: j };
                });
            }).then(function (r) {
                if (!r.ok) {
                    err.textContent = (r.body && r.body.error) || t('That did not work.');
                    err.hidden = false;
                    go2.disabled = false;
                    return;
                }
                m.shut();
                forgetTokenCache();
                forgetOrgCache();
                markPicked();
                location.assign(orgHome(r.body.org.slug));
            }).catch(function () {
                err.textContent = t('That did not work.');
                err.hidden = false;
                go2.disabled = false;
            });
        });
    }

    function viewPreferences(me) {
        var page = document.createElement('div');
        page.className = 'pg';
        page.appendChild(pageHead('Preferences',
            'Manage your account profile, connections, and dashboard experience.'));

        page.appendChild(sectionTitle('Profile information'));

        var card = document.createElement('form');
        card.className = 'card';
        var n = splitName(me.name);

        var first = textInput('pf-first', n.first, 'First name');
        var last = textInput('pf-last', n.last, 'Last name');
        var mail = textInput('pf-mail', me.email, null, true);

        card.appendChild(fieldRow({ label: 'First name', id: 'pf-first', control: first }));
        card.appendChild(fieldRow({ label: 'Last name', id: 'pf-last', control: last }));
        card.appendChild(fieldRow({
            label: 'Primary email',
            hint: 'Used for account notifications. Contact us to change it.',
            id: 'pf-mail',
            control: mail
        }));

        var foot = document.createElement('div');
        foot.className = 'card-foot';
        var msg = document.createElement('span');
        msg.className = 'card-msg';
        foot.appendChild(msg);
        var save = document.createElement('button');
        save.type = 'submit';
        save.className = 'btn btn-primary';
        save.textContent = t('Save');
        save.disabled = true;
        foot.appendChild(save);
        card.appendChild(foot);
        page.appendChild(card);
        page.appendChild(viewAppearance());
        page.appendChild(viewTimezone(me));
        page.appendChild(viewShortcuts());
        page.appendChild(viewDashPrefs());
        page.appendChild(viewTelemetry());
        page.appendChild(viewDanger(me));

        function dirty() {
            return first.value.trim() !== n.first || last.value.trim() !== n.last;
        }
        function sync() {
            save.disabled = !dirty() || !first.value.trim();
        }
        function onType() {
            if (msg.textContent) { msg.textContent = ''; msg.className = 'card-msg'; }
            sync();
        }
        first.addEventListener('input', onType);
        last.addEventListener('input', onType);

        card.addEventListener('submit', function (e) {
            e.preventDefault();
            if (save.disabled) return;
            save.disabled = true;
            msg.textContent = '';
            fetch('/v1/account/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ firstName: first.value, lastName: last.value })
            }).then(function (r) {
                return r.json().catch(function () { return {}; }).then(function (j) {
                    return { ok: r.ok, body: j };
                });
            }).then(function (r) {
                if (!r.ok) {
                    msg.textContent = (r.body && r.body.error) || t('That did not save.');
                    msg.className = 'card-msg is-bad';
                    save.disabled = false;
                    return;
                }
                n = splitName(r.body.name);
                first.value = n.first;
                last.value = n.last;
                msg.textContent = '';
                msg.className = 'card-msg';
                toast(t('Profile saved'), 'good');
                var fresh = { name: r.body.name, email: me.email, trial: me.trial };
                writeMe(fresh);
                paintAvatar(fresh);
                paintAccountMenu(fresh);
                sync();
            }).catch(function () {
                msg.textContent = t('That did not save.');
                msg.className = 'card-msg is-bad';
                save.disabled = false;
            });
        });

        return page;
    }

    var canRoute = !!(window.history && history.pushState);

    function go(path) {
        if (!canRoute) { location.assign(path); return; }
        if (path === location.pathname) { setMenu(false); return; }
        history.pushState({}, '', path);
        render();
    }

    var lastMe = null;

    function paintCanvas() {
        var canvas = document.getElementById('canvas');
        if (!canvas) return;
        canvas.textContent = '';
        if (!lastMe) return;
        if (onOrgs()) {
            canvas.appendChild(viewOrgs(lastMe));
            return;
        }
        if (location.pathname === ACCOUNT_PATH) {
            canvas.appendChild(viewPreferences(lastMe));
            return;
        }
        var slug = slugInPath();
        if (slug) {
            var tail = location.pathname.slice(orgHome(slug).length).replace(/^\//, '');
            if (tail === 'tokens') canvas.appendChild(viewTokens(lastMe));
            else if (tail === 'team') canvas.appendChild(viewTeam(lastMe));
            else if (tail === 'usage') canvas.appendChild(viewUsage(lastMe));
            else if (tail === 'billing') canvas.appendChild(viewBilling(lastMe));
            else if (tail === 'settings') canvas.appendChild(viewOrgSettings(lastMe));
            else if (!tail) canvas.appendChild(viewProjects(lastMe));
        }
    }

    function render() {
        // on the picker there is nothing to navigate to yet, so the shell drops
        // to the top bar alone
        setBare(onOrgs());
        paintTopBrand(onOrgs());
        paintSideBrand();
        var rebuilt = paintNav(currentNav());
        applySideMode(sideMode());
        setMenu(false);
        paintCanvas();
        var canvas = document.getElementById('canvas');
        if (canvas) {
            canvas.style.animation = 'none';
            void canvas.offsetWidth;
            canvas.style.animation = '';
        }
        if (!rebuilt) return;
        var side = document.getElementById('side-nav');
        if (side) {
            side.classList.remove('is-in');
            void side.offsetWidth;
            side.classList.add('is-in');
        }
    }

    window.addEventListener('popstate', render);

    // On the picker the sidebar is gone, so the mark in the corner is the only
    // way back out. It goes to the front page rather than to /dashboard, which
    // would only send you back to the picker you are standing on.
    function paintTopBrand(bare) {
        var slot = document.getElementById('top-slot');
        if (!slot) return;
        var have = slot.querySelector('.top-brand');
        if (!bare) {
            if (have) have.remove();
            return;
        }
        if (have) return;
        var a2 = document.createElement('a');
        a2.className = 'top-brand';
        a2.href = '/';
        a2.setAttribute('aria-label', 'Sentinelpay');
        var img = document.createElement('img');
        img.src = '/logo.svg';
        img.alt = 'Sentinelpay';
        img.width = 24;
        img.height = 24;
        a2.appendChild(img);
        slot.appendChild(a2);
    }

    // the head already wrote this for the first frame; from here the class and
    // the attribute are kept together so a navigation cannot leave one behind.
    function setBare(on) {
        if (app) app.classList.toggle('is-bare', on);
        if (on) document.documentElement.setAttribute('data-bare', '1');
        else document.documentElement.removeAttribute('data-bare');
    }

    // the mark in the sidebar goes to the organisation you are in. it used to go
    // to /dashboard, which is now a door onto the picker, so it would have thrown
    // you out of the place it was meant to take you home to.
    function paintSideBrand() {
        var brand = document.querySelector('.side-brand');
        if (!brand) return;
        brand.setAttribute('href', atOrg ? orgHome(atOrg) : ORGS_PATH);
    }

    function paintShell() {
        if (location.pathname === ORGS_PATH_ALT && canRoute) {
            history.replaceState({}, '', ORGS_PATH);
        }
        setBare(onOrgs());
        paintTopBrand(onOrgs());
        paintSideBrand();
        paintNav(currentNav());
        paintFoot();
        applySideMode(sideMode());
    }

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(paintShell);
    }
    paintShell();

    var cached = readMe();
    if (cached) paintMe(cached);
    else bindAccountMenu();

    // The address names the organisation; this is where it is checked. Membership
    // decides, the cookie is brought into line with the url rather than the other
    // way round, and anything that does not check out lands on the picker rather
    // than on somebody else's work.
    function settleOrg() {
        if (!atOrg) return Promise.resolve(true);
        return fetch('/v1/orgs/slug/' + encodeURIComponent(atOrg), { credentials: 'same-origin' })
            .then(function (r) {
                if (r.status === 401) return true;
                if (!r.ok) { location.replace(ORGS_PATH); return false; }
                markPicked();
                return true;
            })
            .catch(function () { return true; });
    }

    settleOrg().then(function (allowed) {
        if (allowed) boot();
    });

    function boot() {
    fetch('/v1/entitlement', { credentials: 'same-origin' })
        .then(function (r) {
            if (r.status === 401) { forgetMe(); return null; }
            return r.ok ? r.json() : null;
        })
        .then(function (me) {
            if (!me) return;
            // /dashboard is not a place. The work lives inside an organisation
            // and its address says which, so the bare path is a door rather than
            // a room and it opens onto the choice. An address that claims an
            // organisation but does not name one properly is the same thing.
            var bare = location.pathname === '/dashboard' || location.pathname === '/dashboard/';
            var claimsOrg = location.pathname.indexOf(ORG_ROOT) === 0;
            if (bare || (claimsOrg && !atOrg)) {
                location.replace(ORGS_PATH);
                return;
            }
            // nothing in here belongs to a person on their own, so without an
            // organisation there is nothing to show but the choice of one. an
            // address that named one and passed the membership check counts,
            // whatever the entitlement call happened to see.
            if (!onOrgs() && !me.org && !atOrg) {
                location.replace(ORGS_PATH);
                return;
            }
            if (me.org && !onOrgs()) markPicked();
            if (!sameMe(cached, me)) paintMe(me);
            writeMe(me);
        })
        .catch(function () {  });
    }
})();
