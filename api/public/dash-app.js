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
        twofa: '<rect x="7.6" y="3.4" width="8.8" height="17.2" rx="2.2"/>' +
            '<circle cx="10.4" cy="9.6" r="0.9"/><circle cx="13.6" cy="9.6" r="0.9"/>' +
            '<circle cx="10.4" cy="12.8" r="0.9"/><circle cx="13.6" cy="12.8" r="0.9"/>' +
            '<path d="M10.4 17.4h3.2"/>',
        device: '<rect x="3.2" y="5" width="17.6" height="11" rx="2"/>' +
            '<path d="M9.4 19.6h5.2"/><path d="M12 16v3.6"/>',
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
        // a check that came back as something other than clear. a marker put in
        // by a person, not a warning sign: it says look here, not stop.
        flag: '<path d="M6 21V4.6a.6.6 0 0 1 .35-.55C7.6 3.5 9 3.2 10.4 3.2c2.9 0 4.3 1.6 7.2 1.6.9 0 1.7-.1 2.4-.3v8.6c-.7.2-1.5.3-2.4.3-2.9 0-4.3-1.6-7.2-1.6-1.4 0-2.8.3-4.4.9"/>',
        // a chain: the thing an address is on. two links of one, rather than a
        // coin, because what is counted is the network and not the money.
        coin: '<rect x="2.6" y="8.8" width="10.2" height="6.4" rx="3.2"/>' +
            '<rect x="11.2" y="8.8" width="10.2" height="6.4" rx="3.2"/>',
        // an invitation that has gone out and not been answered. deliberately
        // not the person mark: nobody is there yet, an envelope is.
        mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.2"/><path d="m3.8 7 7.1 5.3a1.8 1.8 0 0 0 2.2 0L20.2 7"/>',
        // a book held open: what is written down and can be looked up, rather
        // than a sheet of paper, which is what we call a report
        docs: '<path d="M12 6.7v13"/>' +
            '<path d="M12 6.7C10.4 5.4 8.4 4.8 6 4.8H3.4v13H6c2.4 0 4.4.6 6 1.9"/>' +
            '<path d="M12 6.7c1.6-1.3 3.6-1.9 6-1.9h2.6v13H18c-2.4 0-4.4.6-6 1.9"/>',

        // chrome: the shell itself, not a destination
        panel: '<rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.2"/><path d="M9.4 4.6v14.8"/>',
        back: '<path d="M14.6 6.4 9 12l5.6 5.6"/>',
        out: '<path d="M9.6 20H5.4V4h4.2"/><path d="M14 8.4l3.6 3.6-3.6 3.6"/><path d="M17.6 12H8.8"/>'
    };

    // Your own account sits beside the organisations, not inside one, so its
    // addresses say so: /account/preferences and the three beside it.
    var ACCOUNT_ROOT = '/account/';
    var ACCOUNT_PATH = ACCOUNT_ROOT + 'preferences';
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
            { key: 'preferences', label: 'Preferences', icon: 'prefs', href: ACCOUNT_ROOT + 'preferences' },
            { key: 'security', label: 'Security', icon: 'lock', href: ACCOUNT_ROOT + 'security' }
        ] },
        { group: 'Developers', items: [
            { key: 'tokens', label: 'Access tokens', icon: 'key', href: ACCOUNT_ROOT + 'tokens' },
            { key: 'account-logs', label: 'Audit logs', icon: 'audit', href: ACCOUNT_ROOT + 'logs' }
        ] }
    ];

    // The organisation's rail. Two sectors, because there are two kinds of
    // thing in here: the work, and the company that owns it.
    //
    // Access tokens and your own account are not on it. Tokens belong to the
    // organisation's settings, which is where the screen is reached from now,
    // and your account is behind your own avatar in the corner, where it was
    // always also reachable. A rail is for where the work is.
    // Before an organisation is chosen there is no organisation to show, so this
    // rail is the two things that exist either way: the list you are standing on
    // and your own account. It is short because there is genuinely little here,
    // not because it was trimmed.
    var PICKER_NAV = [
        { group: 'You', items: [
            { key: 'orgs', label: 'Organisations', icon: 'building', href: ORGS_PATH },
            { key: 'account', label: 'Account', icon: 'person', href: ACCOUNT_PATH }
        ] }
    ];

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
        return location.pathname.indexOf(ACCOUNT_ROOT) === 0;
    }

    // which of the four, or '' when we are not in there at all
    function accountPage() {
        if (!inAccount()) return '';
        return location.pathname.slice(ACCOUNT_ROOT.length).split('/')[0];
    }

    function navFor() {
        if (onOrgs()) return PICKER_NAV;
        return inAccount() ? ACCOUNT_NAV : NAV;
    }

    function navKey() {
        if (onOrgs()) return 'picker';
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
        // Choosing a zone used to be a write and nothing else, so every time
        // already on the screen kept the old one until something happened to
        // draw it again. On the usage screen it was worse than a stale
        // caption: the days on that chart are cut in this zone by the server,
        // so the picture stayed cut the old way while the label said
        // otherwise. The screens that care are told.
        zoneOn.slice().forEach(function (fn) {
            try { fn(v); } catch (err) {  }
        });
    }

    // Screens subscribe on the way in, the way they do for live events, and
    // paintCanvas drops the list when the screen goes.
    var zoneOn = [];
    function onZone(fn) {
        zoneOn.push(fn);
        return function () {
            var at = zoneOn.indexOf(fn);
            if (at !== -1) zoneOn.splice(at, 1);
        };
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
        forgetPrjCache();
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

    // The same comparison without the three numbers a single screening moves.
    // Those change constantly on a working account; everything else here is
    // who you are, which organisation you are in and what you may do in it.
    function sameShell(a, b) {
        if (!a || !b) return false;
        if (a.name !== b.name || a.email !== b.email) return false;
        var ta = a.trial || {}, tb = b.trial || {};
        var keys = ['state', 'daysLeft', 'liveIncluded', 'historyIncluded', 'historyOpen'];
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

    function paintMe(me, keepCanvas) {
        lastMe = me;
        paintAvatar(me);
        paintAccountMenu(me);
        if (!keepCanvas) paintCanvas();
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

        function optFor(v) {
            for (var i = 0; i < groups.length; i++) {
                var os = groups[i].options;
                for (var j = 0; j < os.length; j++) {
                    if (os[j].value === v) return os[j];
                }
            }
            return null;
        }
        function labelFor(v) {
            var op = optFor(v);
            return op ? op.label : '';
        }

        // whatever mark an option carries is carried by the closed control too,
        // so the chosen one is recognisable without opening the list.
        function paintVal() {
            val.textContent = '';
            var op = optFor(current);
            if (op && op.lead) {
                var ld = document.createElement('span');
                ld.className = 'pick-lead';
                ld.innerHTML = op.lead;
                val.appendChild(ld);
            }
            var tx = document.createElement('span');
            tx.textContent = op ? op.label : '';
            val.appendChild(tx);
        }

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
                    if (op.lead) {
                        var ld = document.createElement('span');
                        ld.className = 'pick-lead';
                        ld.innerHTML = op.lead;
                        b.appendChild(ld);
                    }
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

    // The whole row, not a hand written list of its fields. Listing them meant
    // that adding one to the screen and forgetting it here showed a row drawn
    // from a cache that was missing it, which is how organisations spent the
    // first half second of every visit claiming to have no plan. The server
    // already decides what a row is and it holds nothing secret, so the cache
    // keeps what it was given.
    function writeOrgCache(who, rows, roles) {
        orgCache.write(who, { roles: roles, rows: rows });
    }

    function forgetOrgCache() { orgCache.forget(); }

    // The projects of one organisation. Keyed by the organisation as well as by
    // the account, because two of them have different lists and a head start
    // showing the wrong one is worse than showing none: the key is checked on
    // the way out, not only on the way in.
    var prjCache = makeCache('sp-projects', function () { return localStorage; },
        7 * 24 * 60 * 60 * 1000);

    function readPrjCache(who, orgId) {
        var box = prjCache.read(who);
        if (!box || !box.rows || box.rows.length === undefined) return null;
        return String(box.orgId || '') === String(orgId || '') ? box : null;
    }

    // same as the organisations: whatever a project row is, that is what is
    // kept, so the next field added to it cannot go missing here.
    function writePrjCache(who, orgId, rows) {
        prjCache.write(who, { orgId: String(orgId || ''), rows: rows });
    }

    function forgetPrjCache() { prjCache.forget(); }

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

    // A cell in a row that has a column heading above it on a wide screen and
    // nothing above it on a narrow one, where the columns are stacked. The
    // heading comes along with the value so that "Off" on a phone is not a word
    // on its own: the reader is told what is off. Hidden again when the real
    // heading row is visible, so it is never said twice.
    // Holds the middle columns of a row. It is not a column itself: on a wide
    // screen it is told to disappear so its children sit in the row's own grid.
    function factsBox() {
        var box = document.createElement('div');
        box.className = 'tr-facts';
        return box;
    }

    function dimCell(labelKey) {
        var cell = document.createElement('div');
        cell.className = 'tr-dim';
        var key = document.createElement('span');
        key.className = 'tr-k';
        key.textContent = t(labelKey);
        cell.appendChild(key);
        return cell;
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
    // How the list is shown is a per-viewer preference, not data: it belongs in
    // this browser and nowhere else, and a page that cannot read it still has
    // to draw. Hence the try and the fallback on both sides.
    var PRJ_VIEW_KEY = 'sp-prj-view';
    function prjView() {
        try {
            var v = localStorage.getItem(PRJ_VIEW_KEY);
            return v === 'grid' ? 'grid' : 'list';
        } catch (err) { return 'list'; }
    }
    function keepPrjView(v) {
        try { localStorage.setItem(PRJ_VIEW_KEY, v); } catch (err) {  }
    }

    // a compact dropdown shows its value and not its field name, so the name
    // goes where it is still reachable: to the accessible label and to the
    // tooltip a pointer finds.
    function namePick(wrap, id, label) {
        var btn = wrap.querySelector('#' + id);
        if (!btn) return;
        btn.setAttribute('aria-label', t(label));
        btn.title = t(label);
    }

    function viewProjects(me) {
        var page = document.createElement('div');
        // the same column the organisation picker uses. both are a list of
        // things you pick one of, so they read at the same width.
        page.className = 'pg orgs-pg';
        var org = me.org || {};
        page.appendChild(pageHead('Projects'));

        var bar = document.createElement('div');
        bar.className = 'bar prj-bar';
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

        var status = 'active';
        var order = 'name';

        var statusBox = selectBox('prj-status', [{ options: [
            { value: 'active', label: t('Active') },
            { value: 'archived', label: t('Archived') },
            { value: 'all', label: t('All') }
        ] }], status, function (v) { status = v; draw(); });
        statusBox.classList.add('prj-pick');
        namePick(statusBox, 'prj-status', 'Filter by status');
        bar.appendChild(statusBox);

        var sortBox = selectBox('prj-sort', [{ options: [
            { value: 'name', label: t('Name') },
            { value: 'newest', label: t('Newest') },
            { value: 'oldest', label: t('Oldest') }
        ] }], order, function (v) { order = v; draw(); });
        sortBox.classList.add('prj-pick');
        namePick(sortBox, 'prj-sort', 'Sort by');
        bar.appendChild(sortBox);

        // two buttons rather than one that toggles, so the shape you are in is
        // readable without pressing anything to find out.
        var seg = document.createElement('div');
        seg.className = 'vseg';
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', t('How to show the list'));
        var asGrid = prjView() === 'grid';
        function segBtn(kind, label, svg) {
            var b2 = document.createElement('button');
            b2.type = 'button';
            b2.className = 'vseg-b';
            b2.setAttribute('aria-label', t(label));
            b2.setAttribute('aria-pressed', String(kind === 'grid' ? asGrid : !asGrid));
            b2.innerHTML = svg;
            b2.addEventListener('click', function () {
                asGrid = kind === 'grid';
                keepPrjView(asGrid ? 'grid' : 'list');
                seg.querySelectorAll('.vseg-b').forEach(function (x) {
                    x.setAttribute('aria-pressed', String(x === b2));
                });
                draw();
            });
            return b2;
        }
        seg.appendChild(segBtn('grid', 'Show as cards',
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<rect x="4" y="4" width="7" height="7" rx="1.4"/><rect x="13" y="4" width="7" height="7" rx="1.4"/>' +
            '<rect x="4" y="13" width="7" height="7" rx="1.4"/><rect x="13" y="13" width="7" height="7" rx="1.4"/></svg>'));
        seg.appendChild(segBtn('list', 'Show as rows',
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M4.6 7h14.8M4.6 12h14.8M4.6 17h14.8"/></svg>'));
        bar.appendChild(seg);

        var make = document.createElement('button');
        make.type = 'button';
        make.className = 'btn btn-primary';
        make.textContent = t('New project');
        bar.appendChild(make);
        page.appendChild(bar);

        var list = document.createElement('div');
        list.className = 'prjs';
        page.appendChild(list);

        var who = (me && me.email) || '';
        var warm = readPrjCache(who, org.id);
        var rows = warm ? warm.rows : [];
        var may = roleAtLeastLocal(org.role, 'admin');
        make.disabled = !may;

        function sorted(a) {
            var out = a.slice();
            if (order === 'name') {
                out.sort(function (x, y) { return x.name.localeCompare(y.name); });
            } else {
                out.sort(function (x, y) {
                    var dx = new Date(x.createdAt).getTime() || 0;
                    var dy = new Date(y.createdAt).getTime() || 0;
                    return order === 'newest' ? dy - dx : dx - dy;
                });
            }
            return out;
        }

        function draw() {
            list.textContent = '';
            list.classList.toggle('is-grid', asGrid);
            var q = findIn.value.trim().toLowerCase();
            var shown = sorted(rows.filter(function (r) {
                // a row that never said reads as active: an older response, or
                // one from a server that predates archiving, should still be
                // shown rather than filtered into nothing.
                if (status !== 'all' && (r.status || 'active') !== status) return false;
                return !q || r.name.toLowerCase().indexOf(q) !== -1;
            }));
            if (!shown.length) {
                if (!rows.length) {
                    list.appendChild(emptyState('No projects yet',
                        'Make one for the first thing you screen for.'));
                } else if (q) {
                    list.appendChild(emptyState('Nothing matches that', 'Try a different name.'));
                } else if (status === 'archived') {
                    list.appendChild(emptyState('Nothing archived', 'Archived projects will show up here.'));
                } else {
                    list.appendChild(emptyState('Nothing active',
                        'Every project here is archived. Change the status filter to see them.'));
                }
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
                    writePrjCache(who, org.id, rows);
                    draw();
                })
                .catch(function () {
                    // a list already on screen beats replacing it with an error,
                    // so only an empty page says the fetch failed
                    forgetPrjCache();
                    if (rows.length) return;
                    list.textContent = '';
                    list.appendChild(emptyState('That did not load.', 'Reload the page to try again.'));
                });
        }

        findIn.addEventListener('input', draw);
        make.addEventListener('click', function () { askProject(org, load); });
        onLive(function (e) { if (e.topic === 'org' && String(e.id) === String(org.id)) load(); });

        // what was here last time, straight away. an organisation whose list was
        // empty draws its empty state rather than a skeleton, because that is
        // what it will almost certainly say again.
        if (warm) draw();
        else list.appendChild(waiting());
        load();
        return page;
    }

    function projectCard(r, org, may, done) {
        var card = document.createElement('div');
        card.className = 'prj' + (r.status === 'archived' ? ' is-off' : '');

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

        // only the archived say so. a pill on every row reading "Active" is a
        // word repeated until it stops being read.
        if (r.status === 'archived') {
            var pill = document.createElement('span');
            pill.className = 'prj-pill';
            pill.textContent = t('Archived');
            card.appendChild(pill);
        }

        if (may) {
            var acts = document.createElement('span');
            acts.className = 'prj-acts';

            acts.appendChild(prjAct('Rename',
                '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17Z"/>',
                function () { askRenameProject(org, r, done); }));

            var off = r.status === 'archived';
            acts.appendChild(prjAct(off ? 'Restore' : 'Archive',
                off ? '<path d="M12 20V9"/><path d="m8 12.6 4-4 4 4"/><path d="M4.6 5h14.8"/>'
                    : '<path d="M3.6 5.2h16.8v3.4H3.6Z"/><path d="M5.4 8.6v10.2h13.2V8.6"/><path d="M9.8 12.4h4.4"/>',
                function () { flipArchive(org, r, done); }));

            acts.appendChild(prjAct('Remove',
                '<path d="M5 7h14M9 7V5.5h6V7M7 7l1 12.5h8L17 7"/>',
                function () { askRemoveProject(org, r, done); }, true));

            card.appendChild(acts);
        }
        return card;
    }

    function prjAct(label, path, onClick, bad) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'prj-act' + (bad ? ' is-bad' : '');
        b.setAttribute('aria-label', t(label));
        b.title = t(label);
        b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
        b.addEventListener('click', onClick);
        return b;
    }

    // archiving is reversible, so it asks nothing and says what it did.
    function flipArchive(org, project, done) {
        var on = project.status !== 'archived';
        fetch('/v1/orgs/' + encodeURIComponent(org.id) + '/projects/' +
            encodeURIComponent(project.id) + '/archive', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ archived: on })
        }).then(function (r) {
            if (!r.ok) throw new Error('bad');
            toast(t(on ? 'Project archived' : 'Project restored'), 'good');
            done();
        }).catch(function () {
            toast(t('That did not work.'), 'bad');
        });
    }

    // Where a project is set up. The same two step panel the token drawer uses,
    // because it is the same kind of job: a handful of choices, some of which
    // cannot be taken back, and a page at the end that reads them out before
    // anything is made.
    // Flags, drawn rather than typed: the emoji ones are not rendered on
    // windows, where a reader gets the two letters of the country code
    // instead of a flag. Simplified to what carries at sixteen pixels.
    var FLAGS = {
        de: '<rect width="24" height="5.34" y="0" fill="#000"/>' +
            '<rect width="24" height="5.33" y="5.34" fill="#dd0000"/>' +
            '<rect width="24" height="5.33" y="10.67" fill="#ffce00"/>',
        ie: '<rect width="8" height="16" x="0" fill="#169b62"/>' +
            '<rect width="8" height="16" x="8" fill="#fff"/>' +
            '<rect width="8" height="16" x="16" fill="#ff883e"/>',
        gb: '<rect width="24" height="16" fill="#012169"/>' +
            '<path d="M0 0l24 16M24 0L0 16" stroke="#fff" stroke-width="3.2"/>' +
            '<path d="M0 0l24 16M24 0L0 16" stroke="#c8102e" stroke-width="1.8"/>' +
            '<path d="M12 0v16M0 8h24" stroke="#fff" stroke-width="5"/>' +
            '<path d="M12 0v16M0 8h24" stroke="#c8102e" stroke-width="3"/>',
        us: '<rect width="24" height="16" fill="#fff"/>' +
            '<path d="M0 1.23h24M0 3.69h24M0 6.15h24M0 8.61h24M0 11.08h24M0 13.54h24" ' +
            'stroke="#b31942" stroke-width="1.23"/>' +
            '<rect width="10.5" height="8.61" fill="#0a3161"/>',
        sg: '<rect width="24" height="8" y="0" fill="#ed2939"/>' +
            '<rect width="24" height="8" y="8" fill="#fff"/>' +
            '<circle cx="5.4" cy="4" r="2.7" fill="#fff"/>' +
            '<circle cx="6.6" cy="4" r="2.7" fill="#ed2939"/>'
    };

    function flag(code) {
        return '<svg class="flg" viewBox="0 0 24 16" aria-hidden="true">' +
            (FLAGS[code] || '') + '</svg>';
    }

    var PRJ_REGIONS = [
        { value: 'eu-central-1', label: 'Frankfurt', where: 'Germany', flag: 'de' },
        { value: 'eu-west-1', label: 'Dublin', where: 'Ireland', flag: 'ie' },
        { value: 'eu-west-2', label: 'London', where: 'United Kingdom', flag: 'gb' },
        { value: 'us-east-1', label: 'Virginia', where: 'United States', flag: 'us' },
        { value: 'us-west-2', label: 'Oregon', where: 'United States', flag: 'us' },
        { value: 'ap-southeast-1', label: 'Singapore', where: 'Singapore', flag: 'sg' }
    ];

    // Which region to start on. The browser already knows roughly where it is
    // from its own time zone, so the nearest one is offered without asking and
    // without a word about it: it is a default, not a setting called automatic.
    // A zone we do not recognise falls to Frankfurt, which is where the EU data
    // residency the pricing page promises would be kept.
    function nearestRegion() {
        var zone = '';
        try {
            zone = (Intl.DateTimeFormat().resolvedOptions().timeZone || '');
        } catch (err) { zone = ''; }
        var area = zone.split('/')[0];
        var city = zone.split('/')[1] || '';

        if (area === 'Europe') {
            if (city === 'London' || city === 'Belfast') return 'eu-west-2';
            if (city === 'Dublin' || city === 'Lisbon' || city === 'Reykjavik') return 'eu-west-1';
            return 'eu-central-1';
        }
        if (area === 'Africa') return 'eu-central-1';
        if (area === 'Asia' || area === 'Australia' || area === 'Pacific' || area === 'Indian') {
            return 'ap-southeast-1';
        }
        if (area === 'America') {
            if (/Los_Angeles|Vancouver|Tijuana|Phoenix|Denver|Edmonton|Anchorage|Juneau/.test(city)) {
                return 'us-west-2';
            }
            return 'us-east-1';
        }
        return 'eu-central-1';
    }
    var PRJ_LISTS = [
        { key: 'ofac', label: 'OFAC SDN', hint: 'The United States list, published by the Treasury.' },
        { key: 'eu', label: 'EU consolidated', hint: 'Everyone under European Union financial sanctions.' },
        { key: 'uk', label: 'UK sanctions list', hint: 'Published by the FCDO.' },
        { key: 'un', label: 'UN consolidated', hint: 'The Security Council list.' }
    ];
    var PRJ_GUARDS = [
        { key: 'autoScreen', label: 'Screen every counterparty automatically',
          hint: 'Anything this project sees is checked without being asked.' },
        { key: 'fourEyes', label: 'Two people to clear a severe finding',
          hint: 'Whoever raised it cannot be the one who signs it off.' },
        { key: 'keepEvidence', label: 'Seal an evidence file for every result',
          hint: 'The record a regulator asks for, made at the time rather than after.' }
    ];

    function flagOf(region) {
        for (var i = 0; i < PRJ_REGIONS.length; i++) {
            if (PRJ_REGIONS[i].value === region) return flag(PRJ_REGIONS[i].flag);
        }
        return '';
    }

    // the only html built by hand here is our own flag markup, so anything that
    // came from a name or a translation is escaped before it joins it.
    function escapeText(v) {
        var d = document.createElement('div');
        d.textContent = String(v == null ? '' : v);
        return d.innerHTML;
    }

    function askProject(org, done) {
        var want = {
            name: '',
            region: nearestRegion(),
            threshold: 'balanced',
            lists: { ofac: true, eu: true, uk: true, un: true },
            guards: { autoScreen: true, fourEyes: false, keepEvidence: true },
            retention: '5y',
            refresh: '6h',
            engine: 'standard'
        };

        var d = drawer('New project');

        function regionLabel(v) {
            for (var i = 0; i < PRJ_REGIONS.length; i++) {
                if (PRJ_REGIONS[i].value === v) {
                    return t(PRJ_REGIONS[i].label) + '  ·  ' + t(PRJ_REGIONS[i].where);
                }
            }
            return v;
        }
        function listsChosen() {
            return PRJ_LISTS.filter(function (l) { return want.lists[l.key]; });
        }
        function guardsChosen() {
            return PRJ_GUARDS.filter(function (g) { return want.guards[g.key]; });
        }
        function labelOf(list, v, fallback) {
            for (var i = 0; i < list.length; i++) {
                if (list[i].value === v) return t(list[i].label);
            }
            return fallback || v;
        }

        var THRESHOLDS = [
            { value: 'strict', label: 'Strict' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'loose', label: 'Permissive' }
        ];
        var RETENTIONS = [
            { value: '1y', label: 'One year' },
            { value: '3y', label: 'Three years' },
            { value: '5y', label: 'Five years' },
            { value: '7y', label: 'Seven years' }
        ];
        var REFRESHES = [
            { value: '6h', label: 'Every six hours' },
            { value: '24h', label: 'Once a day' }
        ];
        var ENGINES = [
            { value: 'standard', label: 'Standard' },
            { value: 'deep', label: 'Deep graph' }
        ];

        function stepConfigure() {
            d.retitle('New project');
            d.steps(1, 2, 'Configure');

            // the organisation is not a choice here: you are standing in it.
            var who = document.createElement('div');
            who.className = 'drw-static';
            // grey, inert, and no mark on it. a padlock here would be the
            // second meaning for the glyph that means Security in the rail,
            // and the colour already says this is not yours to change.
            who.setAttribute('aria-disabled', 'true');
            who.textContent = org.name || t('This organisation');
            d.body.appendChild(drwSection('Organisation',
                'Everything in this project is billed and staffed here.', who));

            var nameIn = document.createElement('input');
            nameIn.type = 'text';
            nameIn.id = 'prj-name';
            nameIn.className = 'modal-in';
            nameIn.autocomplete = 'off';
            nameIn.maxLength = 60;
            nameIn.value = want.name;
            nameIn.placeholder = t('e.g. Card payments');
            d.body.appendChild(drwSection('Name',
                'What this project screens for, in a word or two.', nameIn));

            var regionBox = selectBox('prj-region', [{
                options: PRJ_REGIONS.map(function (r) {
                    return {
                        value: r.value,
                        label: t(r.label) + '  ·  ' + t(r.where),
                        lead: flag(r.flag)
                    };
                })
            }], want.region, function (v) { want.region = v; });
            d.body.appendChild(drwSection('Where it is kept',
                'Checks and evidence stay in this region. This cannot be changed later.',
                regionBox, true));

            var listHost = document.createElement('div');
            listHost.className = 'drw-ticks';
            PRJ_LISTS.forEach(function (l) {
                listHost.appendChild(tickRow(l.label, l.hint, want.lists[l.key], function (on) {
                    want.lists[l.key] = on;
                    sync();
                }));
            });
            d.body.appendChild(drwSection('What it screens against',
                'Add a list and every check in this project starts using it.',
                listHost, true));

            var thBox = selectBox('prj-threshold', [{
                options: THRESHOLDS.map(function (x) { return { value: x.value, label: t(x.label) }; })
            }], want.threshold, function (v) { want.threshold = v; });
            d.body.appendChild(drwSection('When to raise an alert',
                'Strict raises more and clears fewer. You can change this whenever.',
                thBox, true));

            var guardHost = document.createElement('div');
            guardHost.className = 'drw-ticks';
            PRJ_GUARDS.forEach(function (g) {
                guardHost.appendChild(tickRow(g.label, g.hint, want.guards[g.key], function (on) {
                    want.guards[g.key] = on;
                }));
            });
            d.body.appendChild(drwSection('How it works by default',
                'The habits this project keeps without anyone remembering to.',
                guardHost, true));

            // folded away, because most people should never need to open it
            var adv = document.createElement('div');
            adv.className = 'drw-adv';
            var advBtn = document.createElement('button');
            advBtn.type = 'button';
            advBtn.className = 'drw-adv-b';
            advBtn.setAttribute('aria-expanded', 'false');
            var advT = document.createElement('span');
            advT.textContent = t('Advanced configuration');
            advBtn.appendChild(advT);
            var advC = document.createElement('span');
            advC.className = 'drw-adv-c';
            advC.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                '<path d="m6 9 6 6 6-6"/></svg>';
            advBtn.appendChild(advC);
            adv.appendChild(advBtn);
            var advBody = document.createElement('div');
            advBody.className = 'drw-adv-body';
            var advInner = document.createElement('div');
            advBody.appendChild(advInner);

            var advNote = document.createElement('p');
            advNote.className = 'drw-adv-note';
            advNote.textContent = t('These cannot be changed after the project is made.');
            advInner.appendChild(advNote);

            var retBox = selectBox('prj-retention', [{
                options: RETENTIONS.map(function (x) { return { value: x.value, label: t(x.label) }; })
            }], want.retention, function (v) { want.retention = v; });
            advInner.appendChild(drwSection('How long results are kept',
                'Long enough for whoever audits you.', retBox, true));

            var refBox = selectBox('prj-refresh', [{
                options: REFRESHES.map(function (x) { return { value: x.value, label: t(x.label) }; })
            }], want.refresh, function (v) { want.refresh = v; });
            advInner.appendChild(drwSection('How often the lists are re-read',
                'A name added to a list is only a hit once we have read it.', refBox, true));

            var engBox = selectBox('prj-engine', [{
                options: ENGINES.map(function (x) { return { value: x.value, label: t(x.label) }; })
            }], want.engine, function (v) { want.engine = v; });
            advInner.appendChild(drwSection('How far a check looks',
                'Deep graph follows the money past the first hop. It costs more per check.',
                engBox, true));

            adv.appendChild(advBody);
            advBtn.addEventListener('click', function () {
                var open = adv.classList.toggle('is-open');
                advBtn.setAttribute('aria-expanded', String(open));
            });
            d.body.appendChild(adv);

            var no = document.createElement('button');
            no.type = 'button';
            no.className = 'btn btn-flat';
            no.textContent = t('Cancel');
            no.addEventListener('click', d.shut);
            d.acts.appendChild(no);

            var next = document.createElement('button');
            next.type = 'button';
            next.className = 'btn btn-primary';
            next.textContent = t('Review project');
            next.addEventListener('click', function () { d.show(stepReview); });
            d.acts.appendChild(next);

            function sync() {
                next.disabled = !nameIn.value.trim() || !listsChosen().length;
            }
            nameIn.addEventListener('input', function () {
                want.name = nameIn.value;
                sync();
            });
            sync();
            setTimeout(function () { nameIn.focus(); }, 80);
        }

        function stepReview() {
            d.retitle('Review project');
            d.steps(2, 2, 'Review');

            var sum = document.createElement('dl');
            sum.className = 'sum';
            function row(k, v) {
                var dt = document.createElement('dt');
                dt.textContent = t(k);
                var dd = document.createElement('dd');
                dd.textContent = v;
                sum.appendChild(dt);
                sum.appendChild(dd);
            }
            function rowHtml(k, html) {
                var dt = document.createElement('dt');
                dt.textContent = t(k);
                var dd = document.createElement('dd');
                dd.className = 'sum-flag';
                dd.innerHTML = html;
                sum.appendChild(dt);
                sum.appendChild(dd);
            }
            row('Organisation', org.name || '—');
            row('Name', want.name.trim());
            rowHtml('Where it is kept', flagOf(want.region) + escapeText(regionLabel(want.region)));
            row('Screens against', listsChosen().map(function (l) { return t(l.label); }).join(', '));
            row('Raises an alert', labelOf(THRESHOLDS, want.threshold));
            row('By default', guardsChosen().length
                ? guardsChosen().map(function (g) { return t(g.label).toLowerCase(); }).join(', ')
                : t('nothing automatic'));
            row('Results kept', labelOf(RETENTIONS, want.retention));
            row('Lists re-read', labelOf(REFRESHES, want.refresh));
            row('Checks look', labelOf(ENGINES, want.engine));
            // in a section, the way the token drawer's review page does it: bare
            // in the body the list sat flush against the header.
            var sumSec = drwSection('This project',
                'The region and the advanced settings are fixed once it is made.', sum);
            // nine rows of prose in the narrow right column wrapped every value
            // onto three lines. the list gets the full width of the panel.
            sumSec.classList.add('is-full');
            d.body.appendChild(sumSec);

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

            var go = document.createElement('button');
            go.type = 'button';
            go.className = 'btn btn-primary';
            go.textContent = t('Create project');
            go.addEventListener('click', function () {
                go.disabled = true;
                err.hidden = true;
                fetch('/v1/orgs/' + encodeURIComponent(org.id) + '/projects', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify(want)
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
                    d.shut();
                    toast(t('Project created'), 'good');
                    done();
                }).catch(function () {
                    err.textContent = t('That did not work.');
                    err.hidden = false;
                    go.disabled = false;
                });
            });
            d.acts.appendChild(go);
        }

        d.show(stepConfigure);
    }

    // the register modal's checkbox, the one the permission ticks use.
    function tickRow(label, hint, on, onChange) {
        var row = document.createElement('label');
        row.className = 'tick';
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = !!on;
        box.addEventListener('change', function () { onChange(box.checked); });
        row.appendChild(box);
        var txt = document.createElement('span');
        txt.className = 'tick-t';
        var n = document.createElement('span');
        n.className = 'tick-n';
        n.textContent = t(label);
        txt.appendChild(n);
        if (hint) {
            var h = document.createElement('span');
            h.className = 'tick-h';
            h.textContent = t(hint);
            txt.appendChild(h);
        }
        row.appendChild(txt);
        return row;
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

    // The people in one organisation, on the table the tokens screen uses, so
    // the two lists in this product are one list drawn twice rather than two
    // that happen to look alike.
    function viewTeam(me) {
        var page = document.createElement('div');
        page.className = 'pg';
        var org = me.org || {};
        var may = roleAtLeastLocal(org.role, 'admin');
        page.appendChild(pageHead('Team', 'Everyone here shares the same screenings, cases and tokens.'));

        var bar = document.createElement('div');
        bar.className = 'bar team-bar';
        var find = document.createElement('div');
        find.className = 'bar-find';
        find.innerHTML = '<svg class="bar-find-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
            '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>';
        var findIn = document.createElement('input');
        findIn.type = 'search';
        findIn.placeholder = t('Filter members');
        findIn.autocomplete = 'off';
        find.appendChild(findIn);
        bar.appendChild(find);

        // sits at the end of the row the way the other lists put their primary
        // action, with the quiet one beside it
        // It leaves the screen rather than doing something on it, so it is
        // built like the controls that sit in a toolbar and not like the
        // action beside it: the same outline, height and type as a picker,
        // which is what the rest of our bars are made of.
        var docs = document.createElement('a');
        docs.className = 'chip bar-end';
        docs.href = '/faq';
        docs.innerHTML = icon('docs');
        docs.appendChild(document.createTextNode(t('Docs')));
        bar.appendChild(docs);

        var ask = document.createElement('button');
        ask.type = 'button';
        ask.className = 'btn btn-primary';
        ask.textContent = t('Invite members');
        ask.disabled = !may;
        bar.appendChild(ask);
        page.appendChild(bar);

        var card = document.createElement('div');
        card.className = 'card';
        page.appendChild(card);
        card.appendChild(waiting());

        var rows = [];
        var asked = [];

        function draw() {
            card.textContent = '';
            var q = findIn.value.trim().toLowerCase();
            var shown = rows.filter(function (m) {
                return !q || (m.name + ' ' + m.email).toLowerCase().indexOf(q) !== -1;
            });
            var waiting_ = asked.filter(function (i) {
                return !q || i.email.toLowerCase().indexOf(q) !== -1;
            });
            if (!shown.length) {
                card.appendChild(rows.length
                    ? emptyState('Nobody matches that', 'Try a different name.')
                    : emptyState('Nobody here yet', 'That should not happen: you are in it.'));
                return;
            }

            // The table stays a table on a phone and slides sideways instead
            // of folding into a stack. Folding put each person's facts under
            // their name, which reads well for one member and stops reading at
            // all for twelve: the column somebody is scanning -- who has no
            // second step, who is an owner -- is no longer a column.
            var slide = document.createElement('div');
            slide.className = 'tbl-slide';
            slide.tabIndex = 0;
            card.appendChild(slide);

            var th = document.createElement('div');
            th.className = 'tr is-team th';
            ['Member', 'Two-factor', 'Role'].forEach(function (h) {
                var cl = document.createElement('div');
                cl.textContent = t(h);
                th.appendChild(cl);
            });
            th.appendChild(document.createElement('div'));
            slide.appendChild(th);

            shown.forEach(function (m) { slide.appendChild(memberRow(m, org, may, load)); });
            // the people who have been asked but have not arrived, under the
            // ones who have: they are not members yet and the list should not
            // read as though they are
            waiting_.forEach(function (i) { slide.appendChild(inviteRow(i, org, may, load)); });

            // how many of you there are, under the list rather than in the
            // heading, where it is a fact about what you just read
            var foot = document.createElement('div');
            foot.className = 'tr-foot';
            foot.textContent = rows.length + ' ' + t(rows.length === 1 ? 'member' : 'members') +
                (asked.length ? '  \u00b7  ' + asked.length + ' ' + t('invited') : '');
            card.appendChild(foot);
        }

        function load() {
            fetch('/v1/orgs/' + encodeURIComponent(org.id) + '/members', { credentials: 'same-origin' })
                .then(function (r) {
                    if (!r.ok) throw new Error('bad-status-' + r.status);
                    return r.json();
                })
                .then(function (jj) {
                    rows = (jj && jj.rows) || [];
                    if (jj && jj.roles && jj.roles.length) ORG_ROLES = jj.roles;
                    // the invitations are a second list on the same screen, so
                    // the screen waits for both rather than drawing twice
                    return fetch('/v1/orgs/' + encodeURIComponent(org.id) + '/invites',
                        { credentials: 'same-origin' })
                        .then(function (r) { return r.ok ? r.json() : null; })
                        .then(function (j2) {
                            asked = (j2 && j2.rows) || [];
                            draw();
                        });
                })
                .catch(function () {
                    card.textContent = '';
                    card.appendChild(emptyState('That did not load.', 'Reload the page to try again.'));
                });
        }

        findIn.addEventListener('input', function () { if (rows.length) draw(); });
        // a role changed or somebody was taken out while this was open
        onLive(function (e) { if (e.topic === 'org' && String(e.id) === String(org.id)) load(); });
        ask.addEventListener('click', function () { askInvite(org, load); });
        load();
        return page;
    }

    // Somebody who has been asked but has not arrived. The same row, set back,
    // because they are not a member yet.
    function inviteRow(i, org, may, done) {
        var row = document.createElement('div');
        row.className = 'tr is-team is-asked';

        var who = document.createElement('div');
        who.className = 'mem-who';
        var av = document.createElement('span');
        av.className = 'mem-av is-empty';
        av.innerHTML = icon('mail');
        who.appendChild(av);
        var txt = document.createElement('div');
        txt.className = 'tr-t';
        var nm = document.createElement('div');
        nm.className = 'tr-name';
        nm.textContent = i.email;
        nm.appendChild(tag(t(inviteWord(i.state)), i.state === 'sent' ? '' : 'mid'));
        txt.appendChild(nm);
        var sub = document.createElement('div');
        sub.className = 'tr-sub';
        sub.textContent = i.state === 'sent'
            ? t('Invited') + '  \u00b7  ' + t('until') + ' ' + whenText(i.expiresAt)
            : t('Invited') + '  \u00b7  ' + whenText(i.createdAt);
        txt.appendChild(sub);
        who.appendChild(txt);
        row.appendChild(who);

        var facts = factsBox();
        var conds = document.createElement('div');
        conds.className = 'tr-tags';
        if (i.needMfa || i.sameDomain) {
            var ck = document.createElement('span');
            ck.className = 'tr-k';
            ck.textContent = t('Conditions');
            conds.appendChild(ck);
        }
        if (i.needMfa) conds.appendChild(tag(t('Two-factor first')));
        if (i.sameDomain) conds.appendChild(tag(t('Same domain')));
        facts.appendChild(conds);

        var role = dimCell('Role');
        role.appendChild(document.createTextNode(orghRole(i.role)));
        facts.appendChild(role);
        row.appendChild(facts);

        var act = document.createElement('div');
        act.className = 'tr-act';
        if (may && i.state === 'sent') {
            var pull = rowBtn('Withdraw', function () {
                fetch('/v1/orgs/' + encodeURIComponent(org.id) + '/invites/' +
                    encodeURIComponent(i.id) + '/revoke', {
                    method: 'POST', credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' }, body: '{}'
                }).then(function (r) {
                    if (!r.ok) throw new Error('bad');
                    toast(t('Invitation withdrawn'), 'good');
                    done();
                }).catch(function () { toast(t('That did not work.'), 'bad'); });
            });
            pull.classList.add('is-bad');
            act.appendChild(pull);
        }
        row.appendChild(act);
        return row;
    }

    function inviteWord(state) {
        var said = { sent: 'Waiting', expired: 'Expired', withdrawn: 'Withdrawn' };
        return said[state] || state;
    }

    function memberRow(m, org, may, done) {
        var row = document.createElement('div');
        row.className = 'tr is-team';

        var who = document.createElement('div');
        who.className = 'mem-who';
        var av = document.createElement('span');
        av.className = 'mem-av';
        av.textContent = initialsOf(m.name || m.email);
        who.appendChild(av);
        var txt = document.createElement('div');
        txt.className = 'tr-t';
        var nm = document.createElement('div');
        nm.className = 'tr-name';
        // no mark on your own row: it carries your name and your address, and
        // the action on it already says Leave where everybody else's says
        // Manage access
        nm.textContent = m.name || m.email || '—';
        txt.appendChild(nm);
        // somebody who signed up without a name is shown by their address, so
        // the line under it would otherwise repeat the line above it
        if (m.name && m.email) {
            var sub = document.createElement('div');
            sub.className = 'tr-sub';
            sub.textContent = m.email;
            txt.appendChild(sub);
        }
        who.appendChild(txt);
        row.appendChild(who);

        // stated rather than coloured when it is on: an account without a second
        // step is the one worth noticing on a screen about who can do what.
        // the two facts about them travel together: side by side on a phone,
        // and on a wide screen this box disappears into the grid so each one
        // still lands under its own column heading
        var facts = factsBox();
        var mfa = dimCell('Two-factor');
        mfa.appendChild(m.mfa ? tag(t('On'), 'ok') : tag(t('Off'), 'mid'));
        facts.appendChild(mfa);

        var role = dimCell('Role');
        role.appendChild(document.createTextNode(orghRole(m.role)));
        facts.appendChild(role);
        row.appendChild(facts);

        var act = document.createElement('div');
        act.className = 'tr-act';
        if (m.you) {
            // the owner has nowhere to walk out to: the organisation is theirs
            // until it is closed
            if (m.role !== 'owner') {
                act.appendChild(rowBtn('Leave', function () { askLeave(org, m, done); }));
            }
        } else if (may && m.role !== 'owner') {
            act.appendChild(rowBtn('Manage access', function () { askAccess(org, m, done); }));
        }
        row.appendChild(act);
        return row;
    }

    // Asking people in. The two step panel the tokens and projects use, because
    // it is the same job: choices, some of which cannot be taken back once the
    // mail is out, and a page at the end saying what actually happened.
    //
    // What it asks is ours rather than copied. A single sign on upsell is not
    // something we sell. Two conditions are, and both exist because of what
    // this product is: nobody should hold a compliance tool behind a password
    // alone, and a colleague's personal address should not become a way in.
    function askInvite(org, done) {
        var want = {
            emails: '',
            role: 'analyst',
            days: 7,
            needMfa: true,
            sameDomain: false
        };

        var d = drawer('Invite members');

        function stepAsk() {
            d.retitle('Invite members');
            d.steps(1, 2, 'Choose');

            var who = document.createElement('div');
            who.className = 'drw-static';
            who.setAttribute('aria-disabled', 'true');
            who.textContent = org.name || t('This organisation');
            d.body.appendChild(drwSection('Organisation',
                'They join this one, and see everything in it.', who));

            // the roles as cards, the way the token drawer offers live against
            // sandbox: each one is a decision with a consequence worth reading
            var picks = document.createElement('div');
            picks.className = 'card-picks';
            (ORG_ROLES || []).filter(function (r) { return r.key !== 'owner'; })
                .forEach(function (r) {
                    var c = pickCard(r.label, r.hint || '', want.role === r.key);
                    c.addEventListener('click', function () {
                        want.role = r.key;
                        [].forEach.call(picks.children, function (x) {
                            x.classList.remove('is-on');
                            x.setAttribute('aria-checked', 'false');
                        });
                        c.classList.add('is-on');
                        c.setAttribute('aria-checked', 'true');
                    });
                    picks.appendChild(c);
                });
            var roleSec = drwSection('Role', 'What they may do here. It can be changed later.', picks, true);
            roleSec.classList.add('is-full');
            d.body.appendChild(roleSec);

            var box = document.createElement('textarea');
            box.className = 'modal-in drw-area';
            box.rows = 3;
            box.placeholder = 'name@company.com, second@company.com';
            box.value = want.emails;
            d.body.appendChild(drwSection('Email addresses',
                'One or several, separated by commas. Each gets its own link.', box, true));

            var daysBox = selectBox('inv-days', [{
                options: [1, 3, 7, 14, 30].map(function (n) {
                    return { value: String(n), label: n + ' ' + t(n === 1 ? 'day' : 'days') };
                })
            }], String(want.days), function (v) { want.days = Number(v); });
            d.body.appendChild(drwSection('The link stops working after',
                'An invitation nobody uses should not still be open months from now.',
                daysBox, true));

            var guards = document.createElement('div');
            guards.className = 'drw-ticks';
            guards.appendChild(tickRow('Only with two-factor on',
                'They cannot join until their own account has a second step.',
                want.needMfa, function (on) { want.needMfa = on; }));
            guards.appendChild(tickRow('Only from this company’s domain',
                'A personal address cannot accept, even if the mail is forwarded.',
                want.sameDomain, function (on) { want.sameDomain = on; }));
            d.body.appendChild(drwSection('Conditions',
                'Checked when they accept, not when you send.', guards, true));

            var no = document.createElement('button');
            no.type = 'button';
            no.className = 'btn btn-flat';
            no.textContent = t('Cancel');
            no.addEventListener('click', d.shut);
            d.acts.appendChild(no);

            var go = document.createElement('button');
            go.type = 'button';
            go.className = 'btn btn-primary';
            go.textContent = t('Send invitations');
            go.disabled = true;
            go.addEventListener('click', send);
            d.acts.appendChild(go);

            box.addEventListener('input', function () {
                want.emails = box.value;
                go.disabled = !box.value.trim();
            });
            setTimeout(function () { box.focus(); }, 80);

            function send() {
                go.disabled = true;
                go.textContent = t('Sending…');
                fetch('/v1/orgs/' + encodeURIComponent(org.id) + '/invites', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify(want)
                }).then(function (r) {
                    return r.json().catch(function () { return {}; }).then(function (b) {
                        return { ok: r.ok, body: b };
                    });
                }).then(function (r) {
                    if (!r.ok) {
                        toast((r.body && r.body.error) || t('That did not work.'), 'bad');
                        go.disabled = false;
                        go.textContent = t('Send invitations');
                        return;
                    }
                    d.show(function () { stepSent(r.body.results || []); });
                }).catch(function () {
                    toast(t('That did not work.'), 'bad');
                    go.disabled = false;
                    go.textContent = t('Send invitations');
                });
            }
        }

        // What happened, one line each. Addresses are answered for separately,
        // so a typo among five does not throw the other four away, and this is
        // where that is made visible rather than averaged into one message.
        function stepSent(results) {
            d.retitle('Invitations');
            d.steps(2, 2, 'Sent');

            var list = document.createElement('div');
            list.className = 'inv-out';
            results.forEach(function (r) {
                var line = document.createElement('div');
                line.className = 'inv-line' + (r.ok ? '' : ' is-bad');

                var who = document.createElement('div');
                who.className = 'inv-who';
                who.textContent = r.email;
                line.appendChild(who);

                var what = document.createElement('div');
                what.className = 'inv-what';
                what.textContent = r.ok
                    ? (r.mailed ? t('Sent') : t('Link ready, no mail went out'))
                    : r.error;
                line.appendChild(what);

                // the link is shown whether or not the mail went, because an
                // environment with no mail configured can still invite somebody
                // by passing it along, and because a mail that silently failed
                // should not leave you with nothing
                if (r.ok && r.link) line.appendChild(copyBtn(function () { return r.link; }));
                list.appendChild(line);
            });
            var sec = drwSection('What happened', '', list);
            sec.classList.add('is-full');
            d.body.appendChild(sec);

            var fin = document.createElement('button');
            fin.type = 'button';
            fin.className = 'btn btn-primary';
            fin.textContent = t('Done');
            fin.addEventListener('click', function () { d.shut(); done(); });
            d.acts.appendChild(fin);
        }

        d.show(stepAsk);
    }

    function rowBtn(label, onClick) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'rowbtn';
        b.textContent = t(label);
        b.addEventListener('click', onClick);
        return b;
    }

    // One panel for both things you can do to a colleague, because they are one
    // decision: what they may do here, or nothing at all.
    function askAccess(org, m, done) {
        var mdl = modalShell('Manage access', m.name || m.email);
        var form = document.createElement('form');
        form.className = 'vpanel';

        var chosen = m.role;
        var field = document.createElement('div');
        field.className = 'vfield';
        var lab = document.createElement('label');
        lab.textContent = t('Role');
        field.appendChild(lab);
        var pick = selectBox('mem-role', [{
            options: (ORG_ROLES || []).filter(function (r) { return r.key !== 'owner'; })
                .map(function (r) { return { value: r.key, label: t(r.label) }; })
        }], chosen, function (v) { chosen = v; save.disabled = v === m.role; });
        field.appendChild(pick);
        form.appendChild(field);

        var hint = document.createElement('p');
        hint.className = 'modal-p is-left';
        hint.textContent = roleHint(m.role);
        form.appendChild(hint);
        pick.addEventListener('click', function () {
            setTimeout(function () { hint.textContent = roleHint(chosen); }, 0);
        });

        var err = document.createElement('p');
        err.className = 'verr';
        err.hidden = true;
        form.appendChild(err);

        var save = wideBtn('Save role', 'cta', 'submit');
        save.disabled = true;
        form.appendChild(save);

        var quit = document.createElement('div');
        quit.className = 'modal-quit';
        var out = wideBtn('Take out of this organisation', 'quiet');
        out.classList.add('is-danger');
        out.addEventListener('click', function () {
            mdl.shut();
            askRemoveMember(org, m, done);
        });
        quit.appendChild(out);
        form.appendChild(quit);
        mdl.body.appendChild(form);

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            if (save.disabled) return;
            save.disabled = true;
            err.hidden = true;
            fetch('/v1/orgs/' + encodeURIComponent(org.id) + '/members/' +
                encodeURIComponent(m.id) + '/role', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ role: chosen })
            }).then(function (r) {
                return r.json().catch(function () { return {}; }).then(function (b) {
                    return { ok: r.ok, body: b };
                });
            }).then(function (r) {
                if (!r.ok) {
                    err.textContent = (r.body && r.body.error) || t('That did not work.');
                    err.hidden = false;
                    save.disabled = false;
                    return;
                }
                mdl.shut();
                toast(t('Role changed'), 'good');
                done();
            }).catch(function () {
                err.textContent = t('That did not work.');
                err.hidden = false;
                save.disabled = false;
            });
        });
    }

    function roleHint(key) {
        var list = ORG_ROLES || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].key === key) return t(list[i].hint || '');
        }
        return '';
    }

    function askRemoveMember(org, m, done) {
        confirmOut({
            title: 'Take them out',
            sub: 'They lose this organisation. Their own account stays.',
            go: 'Take them out',
            said: 'Taken out of this organisation',
            url: '/v1/orgs/' + encodeURIComponent(org.id) + '/members/' +
                encodeURIComponent(m.id) + '/remove',
            done: done
        });
    }

    function askLeave(org, m, done) {
        confirmOut({
            title: 'Leave this organisation',
            sub: 'You lose its screenings, cases and tokens. Somebody in it can let you back in.',
            go: 'Leave',
            said: 'You left',
            url: '/v1/orgs/' + encodeURIComponent(org.id) + '/members/' +
                encodeURIComponent(m.id) + '/remove',
            done: function () { location.assign(ORGS_PATH); }
        });
    }

    function confirmOut(o) {
        var mdl = modalShell(o.title, o.sub);
        var form = document.createElement('form');
        form.className = 'vpanel';

        var err = document.createElement('p');
        err.className = 'verr';
        err.hidden = true;
        form.appendChild(err);

        var go = wideBtn(o.go, 'cta', 'submit');
        form.appendChild(go);
        var quit = document.createElement('div');
        quit.className = 'modal-quit';
        var no = wideBtn('Cancel', 'quiet');
        no.addEventListener('click', mdl.shut);
        quit.appendChild(no);
        form.appendChild(quit);
        mdl.body.appendChild(form);

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            go.disabled = true;
            fetch(o.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: '{}'
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
                mdl.shut();
                toast(t(o.said), 'good');
                o.done();
            }).catch(function () {
                err.textContent = t('That did not work.');
                err.hidden = false;
                go.disabled = false;
            });
        });
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
    // ---------------------------------------------------------------- usage
    //
    // What this organisation has screened, and what its plan allows. Two
    // different kinds of number share the screen and are kept apart on purpose:
    // what was done between two dates, which is counted from the screenings
    // themselves, and what the plan has left, which is counted since the plan
    // started and does not reset when a period does.

    function useNum(n) {
        return Number(n || 0).toLocaleString(navLang());
    }

    // Whole sentences rather than a number glued to a fragment: croatian needs
    // three plural forms, and a joined fragment cannot be given any of them.
    function useWindowWord(days) {
        return days === 90 ? t('Last 90 days') : t('Last 30 days');
    }

    // cents, because a price is not a float. 'agreed' where there is no list
    // price to print: per-scan bills what was used, and enterprise is a number
    // somebody shook hands on.
    function useMoney(cents, currency) {
        if (cents === null || cents === undefined) return t('Agreed with you');
        try {
            return new Intl.NumberFormat(navLang(), {
                style: 'currency', currency: currency || 'EUR', maximumFractionDigits: 2
            }).format(cents / 100);
        } catch (err) {
            return (cents / 100).toFixed(2) + ' ' + (currency || 'EUR');
        }
    }

    // A range of two dates. One year, said once: a range inside a single year
    // that prints it at both ends is the same four characters twice, on a line
    // that has to fit beside two controls.
    function useRange(fromIso, toIso) {
        var from = new Date(fromIso);
        var to = new Date(toIso);
        var a = whenText(fromIso);
        var b = whenText(toIso);
        if (from.getUTCFullYear() === to.getUTCFullYear()) {
            var year = String(from.getUTCFullYear());
            var at = a.lastIndexOf(year);
            if (at !== -1) a = a.slice(0, at).replace(/[\s,.]+$/, '');
        }
        return a + ' \u2013 ' + b;
    }

    function useSpan(p) {
        if (!p) return '';
        // the end of a period is the moment the next one begins, so the day
        // shown as its last is the day before
        return useRange(p.from, new Date(new Date(p.to).getTime() - 1).toISOString());
    }

    // whole words, one key each: a term is not a number and never needs joining
    function useTermWord(term) {
        if (term === 'yearly') return 'Yearly';
        if (term === 'quarterly') return 'Quarterly';
        if (term === 'scan') return 'Per scan';
        return term;
    }

    // The month, called a month.
    //
    // It used to be called the current billing cycle, which it is not. What is
    // billed is the term: a quarter paid up front, or a year. The allowance is
    // monthly -- ten thousand screenings a month, as the pricing page says --
    // so the window this page counts over is a month, and naming it after the
    // invoice put two different spans of time under one name. One of them said
    // September to December in the band and the other said September to
    // October over the chart, and a reader was right to think one was wrong.
    //
    // When the plan ends is on the band, where it belongs. This is the window
    // being counted, and it is a month.
    function usePeriodLabel(p) {
        if (p.days) return useWindowWord(p.days);
        if (p.current) return t('This month');
        return useSpan(p);
    }

    // The work, day by day, as a line with the area under it filled.
    //
    // Drawn rather than pulled in: a chart library is a lot of somebody else's
    // code for thirty numbers, and it would still have to be taught this page's
    // colours in both themes, which is most of what it would be doing.
    //
    // Everything that must not be distorted lives outside the svg. The plot is
    // stretched to the width of its card, so a circle inside it comes out an
    // ellipse and text comes out unreadable; the stroke survives because it is
    // told not to scale, and the dots, the guide, the labels and the tooltip
    // are ordinary elements positioned over the top.
    // Day by day, each day carrying everything before it. Laying one period's
    // daily counts over another's compares the wrong thing: a quiet Tuesday
    // against a busy one says nothing about the month. Running totals grow
    // apart instead, and the gap between the two lines at the right-hand end is
    // the percentage written above the chart -- the number and the picture
    // saying the same thing rather than two different ones.
    function running(days) {
        var sum = 0;
        var bad = 0;
        return days.map(function (d) {
            sum += d.n;
            bad += d.flagged;
            return { day: d.day, n: sum, flagged: bad, today: d.n };
        });
    }

    function useChart(source, ghost) {
        var box = document.createElement('div');
        box.className = 'use-plot';

        var days = ghost ? running(source) : source;
        // the same stretch of the month before, and no more of it: a finished
        // period is longer than the one being lived through, and the tail would
        // draw days this period has not reached
        var past = ghost ? running(ghost).slice(0, Math.max(days.length, 1)) : null;
        // and where it is shorter -- thirty days of June against thirty-one of
        // July -- its last total is carried to the end. These are running
        // totals, so a period that is over does not grow: the flat tail is
        // what actually happened, and it beats a line that stops in the middle
        // of the card for a reason only a calendar can explain.
        if (past && past.length) {
            while (past.length < days.length) {
                var end = past[past.length - 1];
                past.push({ day: end.day, n: end.n, flagged: end.flagged, over: true });
            }
        }

        // as many columns as there are days behind us. the rest of a billing
        // period is not history, and a line drawn flat across it would say
        // there was no work on days nobody has lived through yet.
        var w = Math.max(days.length, 1);
        var high = 0;
        days.forEach(function (d) { if (d.n > high) high = d.n; });
        if (past) past.forEach(function (d) { if (d.n > high) high = d.n; });
        var top = niceTop(high);

        // Points sit edge to edge rather than in the middle of a column: the
        // first one is the left wall of the card and the last one is today,
        // which is where a line of history should begin and end.
        var span = w > 1 ? (w - 1) * 10 : 10;
        var at = function (i) { return w > 1 ? (i * span) / (w - 1) : 0; };
        var share = function (i) { return w > 1 ? (i / (w - 1)) * 100 : 0; };
        var up = function (n) { return 100 - (top > 0 ? (n / top) * 100 : 0); };


        var yAxis = document.createElement('div');
        yAxis.className = 'use-plot-y';
        [top, Math.round(top / 2), 0].forEach(function (v) {
            var l = document.createElement('span');
            l.textContent = useNum(v);
            yAxis.appendChild(l);
        });
        box.appendChild(yAxis);

        var area = document.createElement('div');
        area.className = 'use-plot-a';

        var plot = document.createElement('div');
        plot.className = 'use-plot-in';

        var svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 ' + span + ' 100');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('class', 'use-chart-svg');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', t('Screenings per day'));

        var grad = document.createElementNS(SVG_NS, 'linearGradient');
        var gradId = 'use-fade-' + (fadeSeq++);
        grad.setAttribute('id', gradId);
        grad.setAttribute('x1', '0');
        grad.setAttribute('y1', '0');
        grad.setAttribute('x2', '0');
        grad.setAttribute('y2', '1');
        [['0', '0.3'], ['1', '0']].forEach(function (pair) {
            var stop = document.createElementNS(SVG_NS, 'stop');
            stop.setAttribute('offset', pair[0]);
            stop.setAttribute('stop-color', 'currentColor');
            stop.setAttribute('stop-opacity', pair[1]);
            grad.appendChild(stop);
        });
        var defs = document.createElementNS(SVG_NS, 'defs');
        defs.appendChild(grad);
        svg.appendChild(defs);

        // The month before, behind the month being lived through. It is drawn
        // first so the line that matters is the one on top, and dashed because
        // it is not this period: a second solid line of the same weight reads
        // as a second thing being measured now.
        if (past && past.length) {
            var was = [];
            past.forEach(function (d, i) {
                var x = at(i);
                var y = up(d.n);
                if (!i) { was.push('M ' + x + ' ' + y); return; }
                var px = at(i - 1);
                var py = up(past[i - 1].n);
                var reach = (x - px) / 2.6;
                was.push('C ' + (px + reach) + ' ' + py + ' ' + (x - reach) + ' ' + y +
                    ' ' + x + ' ' + y);
            });
            if (past.length === 1) was.push('L ' + span + ' ' + up(past[0].n));
            var older = document.createElementNS(SVG_NS, 'path');
            older.setAttribute('d', was.join(' '));
            older.setAttribute('class', 'use-ghost');
            older.setAttribute('vector-effect', 'non-scaling-stroke');
            svg.appendChild(older);
        }

        if (days.length) {
            var line = [];
            var under = ['M ' + at(0) + ' 100'];
            days.forEach(function (d, i) {
                var x = at(i);
                var y = up(d.n);
                if (!i) {
                    line.push('M ' + x + ' ' + y);
                    under.push('L ' + x + ' ' + y);
                    return;
                }
                // A curve between the two points with its ends held level.
                // Straight segments turn every busy day into a needle; a curve
                // fitted through the points would overshoot and dip below zero
                // on the way back down, which is a day that did not happen.
                var px = at(i - 1);
                var py = up(days[i - 1].n);
                var reach = (x - px) / 2.6;
                var seg = 'C ' + (px + reach) + ' ' + py + ' ' + (x - reach) + ' ' + y +
                    ' ' + x + ' ' + y;
                line.push(seg);
                under.push(seg);
            });
            if (days.length === 1) {
                // one day is a point, and a point is not a line. it is drawn
                // flat across so the card holds a shape rather than a speck.
                line.push('L ' + span + ' ' + up(days[0].n));
                under.push('L ' + span + ' ' + up(days[0].n));
            }
            under.push('L ' + span + ' 100 Z');

            var shade = document.createElementNS(SVG_NS, 'path');
            shade.setAttribute('d', under.join(' '));
            shade.setAttribute('class', 'use-area');
            shade.setAttribute('fill', 'url(#' + gradId + ')');
            svg.appendChild(shade);

            var run = document.createElementNS(SVG_NS, 'path');
            run.setAttribute('d', line.join(' '));
            run.setAttribute('class', 'use-line');
            // the one thing inside a stretched plot that keeps its shape
            run.setAttribute('vector-effect', 'non-scaling-stroke');
            svg.appendChild(run);

            // what came back flagged, as a second line rather than a share of
            // the first: they are the same checks, and stacking them would make
            // a total that is not a total
            // not while comparing: three lines on one plot, two of them about
            // this period and one about another, is a chart that has to be
            // decoded before it can be read
            if (!past && days.some(function (d) { return d.flagged > 0; })) {
                var bad = [];
                days.forEach(function (d, i) {
                    var x = at(i);
                    var y = up(d.flagged);
                    if (!i) { bad.push('M ' + x + ' ' + y); return; }
                    var px = at(i - 1);
                    var py = up(days[i - 1].flagged);
                    var reach = (x - px) / 2.6;
                    bad.push('C ' + (px + reach) + ' ' + py + ' ' + (x - reach) + ' ' + y +
                        ' ' + x + ' ' + y);
                });
                if (days.length === 1) bad.push('L ' + span + ' ' + up(days[0].flagged));
                var flag = document.createElementNS(SVG_NS, 'path');
                flag.setAttribute('d', bad.join(' '));
                flag.setAttribute('class', 'use-line-flag');
                flag.setAttribute('vector-effect', 'non-scaling-stroke');
                svg.appendChild(flag);
            }
        }
        plot.appendChild(svg);

        // A short window has few points, and a line between two of them is
        // easier to read with the points themselves on it.
        if (days.length && days.length <= 12) {
            days.forEach(function (d, i) {
                var dot = document.createElement('span');
                dot.className = 'use-dot';
                dot.style.left = share(i) + '%';
                dot.style.top = up(d.n) + '%';
                plot.appendChild(dot);
            });
        }

        if (days.length) plot.appendChild(useHover(plot, days, share, up, past));
        area.appendChild(plot);
        box.appendChild(area);

        var xAxis = document.createElement('div');
        xAxis.className = 'use-plot-x';
        ticks(days).forEach(function (tick) {
            var l = document.createElement('span');
            l.style.left = share(tick.at) + '%';
            l.textContent = tick.label;
            xAxis.appendChild(l);
        });
        box.appendChild(xAxis);
        return box;
    }

    // Follow the pointer along the line: a guide on the day under it, the point
    // itself marked, and the numbers for that day beside it. The alternative is
    // a tooltip per bar, which cannot exist on a line, and a chart nobody can
    // read a single day off.
    function useHover(plot, days, share, up, past) {
        var guide = document.createElement('span');
        guide.className = 'use-guide';
        plot.appendChild(guide);

        var here = document.createElement('span');
        here.className = 'use-here';
        plot.appendChild(here);

        var tip = document.createElement('div');
        tip.className = 'use-tip';
        plot.appendChild(tip);

        var show = function (on) {
            plot.classList.toggle('is-reading', Boolean(on));
        };

        var read = function (e) {
            var box = plot.getBoundingClientRect();
            if (!box.width) return;
            var along = (e.clientX - box.left) / box.width;
            var i = Math.round(along * (days.length - 1));
            if (i < 0) i = 0;
            if (i > days.length - 1) i = days.length - 1;
            var d = days[i];
            var x = share(i);
            guide.style.left = x + '%';
            here.style.left = x + '%';
            here.style.top = up(d.n) + '%';

            fill(d, i, x);
            show(true);
        };

        var fill = function (d, i, x) {
            tip.textContent = '';
            var when = document.createElement('div');
            when.className = 'use-tip-d';
            when.textContent = whenText(d.day);
            tip.appendChild(when);
            if (past) {
                // running totals, so the label has to say so: "34" on the
                // eleventh means the month so far, not that Tuesday
                tip.appendChild(tipLine('use-key-run', 'This period so far', d.n));
                var then = past[i];
                if (then) tip.appendChild(tipLine('use-key-was', 'The period before', then.n));
            } else {
                tip.appendChild(tipLine('use-key-run', 'Screenings', d.n));
                if (d.flagged > 0) tip.appendChild(tipLine('use-key-flag', 'Flagged', d.flagged));
            }
            tip.style.left = x + '%';
            // near the right edge it would hang off the card, so it flips
            tip.classList.toggle('is-left', x > 65);
        };

        plot.addEventListener('pointermove', read);
        plot.addEventListener('pointerdown', read);
        plot.addEventListener('pointerleave', function () { show(false); });

        // The same reading, without a pointer.
        //
        // Every number on this chart was behind a mouse: a keyboard could tab
        // past the card and never learn a single day, and a screen reader was
        // told "screenings per day" and nothing else. The plot takes focus and
        // the arrow keys walk it, which is the same path a pointer takes and
        // the one a screen reader announces as it goes.
        var at = -1;
        var step = function (by) {
            at = at < 0 ? days.length - 1 : at + by;
            if (at < 0) at = 0;
            if (at > days.length - 1) at = days.length - 1;
            mark(at);
        };
        var mark = function (i) {
            var d = days[i];
            var x = share(i);
            guide.style.left = x + '%';
            here.style.left = x + '%';
            here.style.top = up(d.n) + '%';
            fill(d, i, x);
            show(true);
            // said out loud rather than only drawn, because the drawing is the
            // half a screen reader cannot use
            say.textContent = whenText(d.day) + ', ' + useNum(d.n) + ' ' +
                t(d.n === 1 ? 'screening' : 'screenings') +
                (d.flagged > 0 ? ', ' + useNum(d.flagged) + ' ' + t('flagged') : '');
        };

        var say = document.createElement('span');
        say.className = 'sr-only';
        say.setAttribute('aria-live', 'polite');
        plot.appendChild(say);

        plot.tabIndex = 0;
        plot.setAttribute('role', 'application');
        plot.setAttribute('aria-label', t('Screenings per day. Use the arrow keys to read a day.'));
        plot.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowRight') { step(1); e.preventDefault(); return; }
            if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); return; }
            if (e.key === 'Home') { at = 0; mark(0); e.preventDefault(); return; }
            if (e.key === 'End') { at = days.length - 1; mark(at); e.preventDefault(); return; }
            if (e.key === 'Escape') { show(false); say.textContent = ''; at = -1; }
        });
        plot.addEventListener('blur', function () { show(false); say.textContent = ''; at = -1; });
        return guide;
    }

    function tipLine(cls, label, value) {
        var row = document.createElement('div');
        row.className = 'use-tip-r';
        var dot = document.createElement('i');
        dot.className = cls;
        row.appendChild(dot);
        var k = document.createElement('span');
        k.textContent = t(label);
        row.appendChild(k);
        var v = document.createElement('strong');
        v.textContent = useNum(value);
        row.appendChild(v);
        return row;
    }

    var SVG_NS = 'http://www.w3.org/2000/svg';
    // every gradient needs an id of its own, or the second chart on a page
    // paints itself with the first one
    var fadeSeq = 0;

    // A top of the scale somebody can read: 10, 25, 50, 100 rather than 87.
    // An empty period keeps a scale anyway, so the chart shows a flat nothing
    // instead of disappearing and leaving a hole where the answer should be.
    function niceTop(high) {
        if (high <= 0) return 4;
        var steps = [1, 2, 5];
        var size = Math.pow(10, Math.floor(Math.log(high) / Math.LN10));
        for (var i = 0; i < steps.length; i++) {
            var candidate = steps[i] * size;
            if (high <= candidate) return candidate;
        }
        return 10 * size;
    }

    // At most five dates, and while there are five or fewer days, every one of
    // them. Past that the axis is cut into four equal steps from the first day
    // to the last, so the labels stay evenly spaced whatever the window is.
    var MOST_TICKS = 5;

    function ticks(days) {
        var n = days.length;
        if (!n) return [];
        if (n <= MOST_TICKS) {
            return days.map(function (d, i) {
                return { at: i, label: shortDay(d.day) };
            });
        }
        var out = [];
        var seen = {};
        for (var i = 0; i < MOST_TICKS; i++) {
            var at = Math.round((i * (n - 1)) / (MOST_TICKS - 1));
            if (seen[at]) continue;
            seen[at] = true;
            out.push({ at: at, label: shortDay(days[at].day) });
        }
        return out;
    }

    // The day as the reader's own calendar has it. The counting already put
    // each screening in that reader's day, so the label reads it back in the
    // same zone rather than translating a date that has no time of day.
    function shortDay(iso) {
        var d = new Date(String(iso).length === 10 ? iso + 'T12:00:00Z' : iso);
        if (isNaN(d.getTime())) return '';
        try {
            return new Intl.DateTimeFormat(navLang(), {
                day: 'numeric', month: 'short', timeZone: 'UTC'
            }).format(d);
        } catch (err) {
            return String(iso).slice(0, 10);
        }
    }

    // A list where the length of each line is its share. Used for what came
    // back and for which chains were asked about.
    function useShare(rows, total, kindOf) {
        var list = document.createElement('div');
        list.className = 'use-share';
        rows.forEach(function (r) {
            var line = document.createElement('div');
            line.className = 'use-share-l';
            var name = document.createElement('span');
            name.className = 'use-share-n';
            name.textContent = r.label;
            line.appendChild(name);
            var track = document.createElement('span');
            track.className = 'use-share-t';
            var fill = document.createElement('span');
            fill.className = 'use-share-f' + (kindOf && kindOf(r) ? ' is-' + kindOf(r) : '');
            fill.style.width = (total > 0 ? Math.max(2, Math.round((r.n / total) * 100)) : 0) + '%';
            track.appendChild(fill);
            line.appendChild(track);
            var fig = document.createElement('span');
            fig.className = 'use-share-v';
            fig.textContent = useNum(r.n);
            line.appendChild(fig);
            list.appendChild(line);
        });
        return list;
    }

    // One number with its name above it. `of` makes it a meter, `to` makes it
    // a link down to the section that explains it.
    function useTile(label, value, opts) {
        var o = opts || {};
        var tile = document.createElement(o.to ? 'a' : 'div');
        tile.className = 'use-tile';
        if (o.to) {
            // an anchor, so it can be tabbed to and its target is announced,
            // but the scrolling is ours: the page scrolls inside a box rather
            // than as a document, and a fragment jump does not move that box.
            tile.href = '#' + o.to;
            tile.addEventListener('click', function (e) {
                var target = document.getElementById(o.to);
                if (!target) return;
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        }
        var head = document.createElement('div');
        head.className = 'use-tile-h';
        head.textContent = t(label);
        if (o.to) {
            var chev = document.createElement('span');
            chev.className = 'use-tile-go';
            chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                '<path d="m9 6 6 6-6 6"/></svg>';
            head.appendChild(chev);
        }
        tile.appendChild(head);
        var v = document.createElement('div');
        v.className = 'use-tile-v';
        v.textContent = value;
        tile.appendChild(v);
        if (o.sub) {
            var s = document.createElement('div');
            s.className = 'use-tile-s';
            s.textContent = o.sub;
            tile.appendChild(s);
        }
        if (o.of) {
            var track = document.createElement('div');
            track.className = 'orgh-track';
            var fill = document.createElement('span');
            fill.className = 'orgh-fill';
            var pct = o.of > 0 ? Math.min(100, Math.round((o.used / o.of) * 100)) : 0;
            fill.style.width = pct + '%';
            if (pct >= 100) fill.classList.add('is-full');
            track.appendChild(fill);
            tile.appendChild(track);
        }
        return tile;
    }

    // The number this page is about, the shape it made, and whether that is
    // more or less than last time.
    //
    // A page of equal boxes has no first sentence: eight numbers in eight
    // identical cards leave the reader to decide which one matters, and the
    // answer is always the same one. So it is said once, large, with the chart
    // under it, and everything else is smaller than it.
    function useHeadline(s, prev, period, cmp, fresh) {
        var box = document.createElement('section');
        box.className = 'use-head';

        // The window being charted, at the top of the thing it is charting.
        // Next to the name of the plan it was read as that plan's dates; on the
        // card whose chart it labels there is nothing else it could mean.
        var top = document.createElement('div');
        top.className = 'use-head-t';
        var lab = document.createElement('span');
        lab.className = 'use-head-k';
        lab.textContent = t('Screenings');
        top.appendChild(lab);
        var when = document.createElement('span');
        when.className = 'use-head-w';
        when.textContent = useSpan(period);
        top.appendChild(when);
        box.appendChild(top);

        var row = document.createElement('div');
        row.className = 'use-head-r';
        var big = document.createElement('div');
        big.className = 'use-big';
        big.textContent = useNum(s.total);
        // What it is out of used to be said here as well as in the block
        // below, which put the same pair of numbers twice within two hundred
        // pixels. Below is the better of the two places: there it stands
        // beside the bar that draws it and the other allowances it belongs
        // with. Here it is the one number the page is about.
        row.appendChild(big);
        // Pointing at the sentence shows the line it is talking about, and
        // taking the pointer away puts it back. Clicking holds it there, for a
        // screen with no pointer at all and for a reader who wants to look at
        // it with both hands free.
        var held = Boolean(cmp && cmp.on);
        var show = function (on) { box.classList.toggle('is-against', Boolean(on)); };
        show(held);
        var d = delta(s.total, prev, cmp ? {
            on: held,
            peek: function (on) { if (!held) show(on); },
            hold: function () {
                held = cmp.toggle();
                show(held);
                return held;
            }
        } : null);
        if (d) row.appendChild(d);
        box.appendChild(row);

        // Always the chart, even when every day of it is zero. An empty period
        // is a fact with a shape -- a flat line under a real scale -- and
        // swapping it for a sentence takes the axis away exactly when somebody
        // is asking whether anything ran at all.
        // Where there is a month behind this one, both charts are built and one
        // of them is shown. Drawing on hover would mean building a chart while
        // the pointer is moving, and the swap somebody asked to be quick would
        // be the slowest thing on the screen. Two plots and a class costs a
        // few hundred nodes once and nothing afterwards.
        // An organisation that has never screened anything gets a sentence
        // rather than a chart. A full-height plot with one point at zero, an
        // axis counting to four and a legend for two lines that are not there
        // is a great deal of furniture built around nothing, and it is the
        // first thing every new customer sees.
        if (fresh) {
            var none = document.createElement('div');
            none.className = 'use-none';
            var said = document.createElement('p');
            said.textContent = t('Nothing has been screened here yet.');
            none.appendChild(said);
            var how = document.createElement('p');
            how.className = 'use-none-s';
            how.textContent = t('Checks appear here as they run, whether they come from this dashboard or from a token.');
            none.appendChild(how);
            box.appendChild(none);
            return box;
        }

        if (cmp) {
            box.appendChild(useLayer('use-alone', useChart(s.days || [], null),
                useLegend(false)));
            box.appendChild(useLayer('use-against', useChart(s.days || [], cmp.days),
                useLegend(true)));
        } else {
            box.appendChild(useChart(s.days || [], null));
            box.appendChild(useLegend(false));
        }
        return box;
    }

    function useLayer(cls, chart, legend) {
        var box = document.createElement('div');
        box.className = cls;
        box.appendChild(chart);
        box.appendChild(legend);
        return box;
    }

    // Which line is which, and nothing else. The dates each one covers were
    // spelled out here for a while: the window on the card above, the earlier
    // one beside it. Two ranges in a legend is more reading than a legend is
    // for, and the card already says which window is on screen.
    function useLegend(against) {
        var legend = document.createElement('div');
        legend.className = 'use-legend';
        legend.appendChild(key('use-key-run', against ? 'This period' : 'Screenings'));
        legend.appendChild(against
            ? key('use-key-was', 'The period before')
            : key('use-key-flag', 'Flagged'));
        return legend;
    }


    // The same question the headline asks, for a number small enough that a
    // sentence would be bigger than it: more or less than the window before.
    // Nothing at all where there is no earlier number, or where it was zero --
    // "up 100% from nothing" is arithmetic, not news.
    function moved(now, before) {
        if (before === null || before === undefined || !before) return null;
        var pct = Math.round(((now - before) / before) * 100);
        if (!pct) return null;
        return {
            up: pct > 0,
            down: pct < 0,
            text: (pct > 0 ? '+' : '') + pct + '%'
        };
    }

    function key(cls, label) {
        var el = document.createElement('span');
        el.className = 'use-key';
        var dot = document.createElement('i');
        dot.className = cls;
        el.appendChild(dot);
        el.appendChild(document.createTextNode(t(label)));
        return el;
    }

    // Up or down against the window before this one. Nothing at all when there
    // is nothing to compare with: a first period has no trend, and a made-up
    // "+100%" against zero is a number that means only that it started.
    // Up or down against the window before this one, measured over the same
    // stretch of it so a period two days old is not held against a whole month.
    //
    // Nothing at all where there is nothing to compare with. A plan taken on
    // the day the organisation was created has no period behind it, and a
    // percentage against zero says only that something started.
    function delta(now, prev, cmp) {
        if (!prev || !prev.total) return null;
        var before = prev.total;
        // Where the month before can be drawn, this sentence is the control
        // that draws it. It is already a sentence about the comparison, so a
        // separate button beside it would be the same thing said twice -- one
        // of them in words and one of them as a pill.
        var el = document.createElement(cmp ? 'button' : 'div');
        el.className = 'use-delta';
        if (cmp) {
            el.type = 'button';
            el.classList.add('is-live');
            if (cmp.on) el.classList.add('is-showing');
            el.setAttribute('aria-pressed', cmp.on ? 'true' : 'false');
            // no title: the browser answers one with a small grey box of its
            // own design, half a second after the pointer has already shown
            // the line the box would have described. the button reads as its
            // own words, and aria-pressed says whether the line is up.
            // Two states, not one. Showing is the line being on the chart,
            // which a pointer resting here is enough to do and which ends when
            // the pointer leaves. Held is the reader having asked for it to
            // stay, and that is a decision they made rather than a side effect
            // of where the mouse happens to be -- so it looks different, and
            // looks like something that can be undone.
            var mark = function (on, keep) {
                el.classList.toggle('is-showing', Boolean(on));
                el.classList.toggle('is-held', Boolean(keep));
                el.setAttribute('aria-pressed', keep ? 'true' : 'false');
            };
            var held = cmp.on;
            if (held) mark(true, true);
            el.addEventListener('pointerenter', function () { if (!held) { cmp.peek(true); mark(true); } });
            el.addEventListener('pointerleave', function () { if (!held) { cmp.peek(false); mark(false); } });
            // the keyboard has no pointer, so focus is what hovering is
            el.addEventListener('focus', function () { if (!held) { cmp.peek(true); mark(true); } });
            el.addEventListener('blur', function () { if (!held) { cmp.peek(false); mark(false); } });
            el.addEventListener('click', function () { held = cmp.hold(); mark(held, held); });
        }
        var pct = Math.round(((now - before) / before) * 100);
        var up = pct > 0;
        if (pct !== 0) el.classList.add(up ? 'is-up' : 'is-down');
        var arrow = document.createElement('span');
        arrow.className = 'use-arrow';
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = pct === 0 ? '→' : (up ? '↑' : '↓');
        el.appendChild(arrow);
        var fig = document.createElement('strong');
        fig.textContent = (up ? '+' : '') + pct + '%';
        el.appendChild(fig);
        var says = document.createElement('span');
        says.className = 'use-delta-w';
        says.textContent = t('vs the period before');
        el.appendChild(says);
        return el;
    }

    // The rest, in one line each rather than one card each. They are facts
    // about the period, not things that can run out, and a reader should be
    // able to take them all in without scrolling past six boxes to do it.
    function useStrip(rows) {
        var strip = document.createElement('section');
        strip.className = 'use-strip';
        rows.forEach(function (r) {
            var cell = r.to ? document.createElement('a') : document.createElement('div');
            cell.className = 'use-cell';
            if (r.to) {
                cell.href = '#' + r.to;
                cell.addEventListener('click', function (e) {
                    var target = document.getElementById(r.to);
                    if (!target) return;
                    e.preventDefault();
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
            }
            var k = document.createElement('span');
            k.className = 'use-cell-k';
            k.textContent = t(r.label);
            cell.appendChild(k);
            var v = document.createElement('span');
            v.className = 'use-cell-v';
            v.textContent = r.value;
            cell.appendChild(v);
            if (r.sub || r.move) {
                var sub = document.createElement('span');
                sub.className = 'use-cell-s';
                if (r.sub) sub.appendChild(document.createTextNode(r.sub));
                // up or down against the same window before this one, in the
                // same two colours the headline uses. only where the earlier
                // number means the same thing as this one: a count over a
                // window can be compared with the window before it, and how
                // many people are in the company today cannot.
                if (r.move) {
                    if (r.sub) sub.appendChild(document.createTextNode('  \u00b7  '));
                    var m = document.createElement('span');
                    m.className = 'use-cell-d' + (r.move.up ? ' is-up' : (r.move.down ? ' is-down' : ''));
                    m.textContent = r.move.text;
                    sub.appendChild(m);
                }
                cell.appendChild(sub);
            }
            strip.appendChild(cell);
        });
        return strip;
    }

    // What the plan allows, and how much of it is gone.
    //
    // Only things a plan actually limits belong here. The tiles below carry
    // what happened -- how many were flagged, which chains, who is in the
    // organisation -- and mixing the two means a reader cannot tell which of
    // these numbers can run out.
    function useAllowance(rows, head, agreed, warn) {
        var box = document.createElement('section');
        box.className = 'use-allow';
        var top = document.createElement('div');
        top.className = 'use-allow-h';
        var lab = document.createElement('span');
        // Not "each month" over the whole block. Screenings reset every month;
        // seats do not -- you are not given ten fresh colleagues in October.
        // Saying it once over both made a true sentence about one row into a
        // false one about the other, so it is said on the row it is true of.
        lab.textContent = t('What this plan includes');
        top.appendChild(lab);
        var right = document.createElement('span');
        right.className = 'use-allow-p';
        right.textContent = head;
        if (agreed) {
            // a number somebody shook hands on, not the one on the pricing page
            right.appendChild(tag(t('Agreed')));
        }
        top.appendChild(right);
        box.appendChild(top);

        if (warn) {
            var says = document.createElement('p');
            says.className = 'use-verdict' + (warn.over ? ' is-over' : ' is-near');
            says.textContent = t(warn.says);
            box.appendChild(says);
        }

        // One table, not a row of separate ones.
        //
        // Every row used to be its own grid, so each of them sized its own
        // columns to its own contents: "109 / 10,000" is wider than "1 / 10",
        // so the two bars began fifty pixels apart and ran to different
        // lengths. Two meters that cannot be compared at a glance are two
        // meters doing half their job. The rows are cells of one grid now,
        // which is what makes a column a column.
        var table = document.createElement('div');
        table.className = 'use-allow-b';

        rows.forEach(function (r) {
            var line = document.createElement('div');
            line.className = 'use-allow-r';

            var name = document.createElement('span');
            name.className = 'use-allow-n';
            name.textContent = t(r.label);
            // how often it comes back, for the rows where that is a question.
            // somebody who has just paid for a quarter up front has every
            // reason to read ten thousand as the quarter's allowance, and
            // nothing else on this page would correct them.
            if (r.per) {
                var per = document.createElement('span');
                per.className = 'use-allow-p2';
                per.textContent = t(r.per);
                name.appendChild(per);
            }
            line.appendChild(name);

            // used and included are two columns rather than one string, so the
            // figures stack under each other on the digit rather than on
            // whichever of them happened to be longer
            var used = document.createElement('span');
            used.className = 'use-allow-u';
            var of = document.createElement('span');
            of.className = 'use-allow-o';
            if (r.unmetered) {
                used.textContent = '';
                of.textContent = t('Unmetered');
                of.classList.add('is-word');
            } else {
                used.textContent = useNum(r.used);
                of.textContent = '/ ' + useNum(r.of);
            }
            line.appendChild(used);
            line.appendChild(of);

            var track = document.createElement('span');
            track.className = 'use-allow-t';
            var pct = 0;
            if (r.unmetered) {
                // no bar at all. an empty track beside "unmetered" reads as a
                // meter that failed to load, not as one with no end
                track.classList.add('is-none');
            } else {
                pct = r.of > 0 ? Math.min(100, Math.round((r.used / r.of) * 100)) : 0;
                // nothing used draws nothing. a hundred and nine against ten
                // thousand is one percent of six hundred pixels, which is a
                // six pixel circle floating at the left of an empty track: it
                // reads as a mark that should not be there rather than as a
                // bar with a little in it, so a bar that exists is at least
                // long enough to look like one.
                if (r.used > 0) {
                    var fill = document.createElement('span');
                    fill.className = 'use-allow-f';
                    fill.style.width = pct + '%';
                    if (pct >= 100) fill.classList.add('is-full');
                    else if (pct >= 80) fill.classList.add('is-near');
                    track.appendChild(fill);
                }
            }
            line.appendChild(track);

            // what is left, which is the question the bar is being looked at
            // to answer. a percentage would need working back into a number
            // before anybody could act on it.
            // How much is left, only once that is news. At thirty-six of ten
            // thousand the bar and the ratio have already said it, and a
            // third number saying the same thing in a different arrangement
            // is the kind of completeness that makes a panel look busy rather
            // than informative. Near the limit it is the most useful line on
            // the screen, so that is when it appears.
            if (!r.unmetered && r.of > 0 && pct >= 80) {
                var rest = document.createElement('span');
                var over = r.used >= r.of;
                rest.className = 'use-allow-l' + (over ? ' is-out' : ' is-low');
                rest.textContent = over
                    ? t('none left')
                    : useNum(r.of - r.used) + ' ' + t('left');
                line.appendChild(rest);
            }

            table.appendChild(line);
        });
        box.appendChild(table);

        return box;
    }

    function useSection(id, title, ico, hint) {
        var sec = document.createElement('section');
        sec.className = 'use-sec';
        sec.id = id;
        var head = document.createElement('div');
        head.className = 'use-sec-h';
        var mark = document.createElement('span');
        mark.className = 'orgh-ico';
        mark.innerHTML = icon(ico);
        head.appendChild(mark);
        var txt = document.createElement('div');
        var h = document.createElement('h2');
        h.className = 'use-sec-t';
        h.textContent = t(title);
        txt.appendChild(h);
        if (hint) {
            var p = document.createElement('p');
            p.className = 'use-sec-p';
            p.textContent = t(hint);
            txt.appendChild(p);
        }
        head.appendChild(txt);
        sec.appendChild(head);
        var body = document.createElement('div');
        body.className = 'use-sec-b';
        sec.appendChild(body);
        sec.body = body;
        return sec;
    }

    function useSide(paras) {
        var side = document.createElement('div');
        side.className = 'use-side';
        paras.forEach(function (text) {
            var p = document.createElement('p');
            p.textContent = t(text);
            side.appendChild(p);
        });
        return side;
    }

    function useMain() {
        var main = document.createElement('div');
        main.className = 'use-main';
        return main;
    }

    // Included / used / left, as three lines rather than a sentence: a number
    // with a name beside it can be read off, and a sentence has to be unpicked.
    function useFacts(rows) {
        var box = document.createElement('div');
        box.className = 'use-facts';
        rows.forEach(function (r) {
            var line = document.createElement('div');
            line.className = 'use-fact';
            var k = document.createElement('span');
            k.textContent = t(r[0]);
            line.appendChild(k);
            var v = document.createElement('span');
            v.className = 'use-fact-v';
            v.textContent = r[1];
            line.appendChild(v);
            box.appendChild(line);
        });
        return box;
    }

    function viewUsage(me) {
        // Two pieces rather than one: the band runs the full width of the
        // screen the way a header does, and the page keeps the same centred
        // column every other screen has. The band holds its own copy of that
        // column inside, so the title still lines up with what is under it.
        var out_ = document.createDocumentFragment();
        var page = document.createElement('div');
        page.className = 'pg';

        var org = me.org || {};
        var want = { period: '', scope: 'live' };
        // whether the month before is drawn behind this one, and the last thing
        // the server said, so the switch can redraw without asking again
        var alongside = false;
        var latest = null;

        // The title and the two controls are one band, and it stays at the top
        // while the sections go past underneath. Which period you are looking at
        // is the one fact every number below depends on, so it should not be
        // something you have to scroll back up to check.
        var top = document.createElement('div');
        top.className = 'use-top';
        var inner = document.createElement('div');
        inner.className = 'use-top-in';
        top.appendChild(inner);
        var h1 = document.createElement('h1');
        h1.className = 'pg-h1 use-h1';
        h1.textContent = t('Usage');
        inner.appendChild(h1);

        var bar = document.createElement('div');
        bar.className = 'use-bar';
        inner.appendChild(bar);
        out_.appendChild(top);
        out_.appendChild(page);

        var body = document.createElement('div');
        body.className = 'use-body';
        page.appendChild(body);
        body.appendChild(waiting());

        // Built once, then updated. A live notice reloads this screen, and
        // rebuilding the band would shut a dropdown somebody had just opened
        // and take the keyboard focus with it.
        var built = null;
        var periodPick = null;
        var planSlot = null;
        var whenSlot = null;
        var sep = null;

        function pickers(out) {
            var periods = (out && out.periods) || [];
            var shape = periods.map(function (p) { return p.key + ':' + usePeriodLabel(p); }).join('|');

            if (built !== shape) {
                built = shape;
                bar.textContent = '';
                var left = document.createElement('div');
                left.className = 'use-bar-l';
                bar.appendChild(left);

                periodPick = selectBox('use-period', [{
                    options: periods.map(function (p) {
                        return { value: p.key, label: usePeriodLabel(p) };
                    })
                }], (out.period && out.period.key) || 'c0', function (v) {
                    want.period = v;
                    load(true);
                });
                left.appendChild(periodPick);

                // the sandbox is a separate world on purpose: it screens against
                // the same lists but spends nothing, so mixing it into these
                // numbers would overstate the work and understate the quota
                left.appendChild(selectBox('use-scope', [{
                    options: [
                        { value: 'live', label: t('Production') },
                        { value: 'sandbox', label: t('Sandbox') }
                    ]
                }], want.scope, function (v) {
                    want.scope = v;
                    load(true);
                }));

                // Plan first, then the period it is being read in, divided by a
                // rule. The two belong to the same sentence -- which plan, over
                // which month -- and reading them as one line is what the mark
                // between them is for.
                var right = document.createElement('div');
                right.className = 'use-bar-r';
                planSlot = document.createElement('span');
                planSlot.className = 'use-plan';
                right.appendChild(planSlot);
                sep = document.createElement('span');
                sep.className = 'use-sep';
                sep.setAttribute('aria-hidden', 'true');
                sep.textContent = '/';
                right.appendChild(sep);
                whenSlot = document.createElement('span');
                whenSlot.className = 'use-when';
                right.appendChild(whenSlot);
                bar.appendChild(right);
            } else if (periodPick && out.period) {
                periodPick.spSet(out.period.key);
            }

            planSlot.textContent = t('This organisation is on') + ' ';
            planSlot.appendChild(planWord(out.subscription, out.plan));
            planSlot.appendChild(planMark(out.subscription, out.plan));
            // the plan's own dates: when this plan started and when it ends.
            // not the period being counted -- that one is what the control to
            // the left of it chooses, and it changes when you change it.
            // how long this plan runs. the window being read is on the card
            // below, above the chart it belongs to.
            var span = planSpan(out.subscription, out.plan);
            whenSlot.textContent = span;
            sep.hidden = !span;
        }

        // the plan is a link, because reading which one you are on is the
        // moment somebody wonders what the others are.
        //
        // A bought plan wins over the trial. They are two different things with
        // one word between them: a trial has a state, an organisation has a
        // subscription, and what is shown is whichever of the two exists.
        function planWord(sub, plan) {
            var el = document.createElement('a');
            el.className = 'use-plan-n';
            el.href = '/dashboard/org/' + encodeURIComponent(org.slug || '') + '/billing';
            el.textContent = sub ? sub.planName : orghPlan((plan && plan.state) || 'none');
            return el;
        }

        // How long this plan runs: from the day it started to the day it ends.
        //
        // Some plans have no end. A staging grant pushes its own expiry a year
        // forward on every page load, so the date it carries is one that never
        // arrives; per-scan has no term at all. Both are endless, and the only
        // honest way to draw an end that does not exist is to say so.
        // Not a range any more.
        //
        // The plan's term and the period being charted are two different true
        // facts, and both of them began on the twentieth. Set side by side as
        // two ranges with nothing naming either, they read as one fact
        // disagreeing with itself: 20 Sep - 20 Dec up here, 20 Sep - 20 Oct on
        // the card below, and a reader entitled to think one of them is wrong.
        //
        // The start is the period's start, which is already on screen. What
        // the period cannot say is when the plan runs out, so that is what is
        // said, as a sentence rather than a span.
        function planSpan(sub, plan) {
            var ends = null;
            var over = false;
            if (sub) {
                ends = sub.termEndsAt;
                over = Boolean(sub.cancelledAt);
            } else {
                if (!plan || plan.state === 'none' || plan.state === 'pending') return '';
                if (!plan.startedAt) return '';
                // a trial does not renew, it runs out
                over = true;
                ends = plan.devGrant ? null : plan.expiresAt;
            }
            if (!ends) return t('Runs until cancelled');
            return t(over ? 'Ends' : 'Renews') + ' ' + whenText(ends);
        }

        // What is worth saying beside the name, now that the dates say when it
        // ends: which term it is on, whether it will renew, and whether it has
        // been paid for. Nothing that the range already tells you.
        function planMark(sub, plan) {
            var box = document.createDocumentFragment();
            if (sub) {
                // Which term it is on is on the billing screen, next to the
                // price it belongs to. Here it sat between the plan's name and
                // the plan's dates and told a reader nothing those two did not.
                //
                // What the dates cannot say stays: that this one stops at the
                // end rather than carrying on.
                // where the line beside it already reads "Ends 20 Dec 2026",
                // a chip saying it does not renew is the same news twice
                if (sub.cancelledAt && !sub.termEndsAt) {
                    box.appendChild(tag(t('Does not renew'), 'mid'));
                }
                if (!sub.paid) {
                    // agreed but not paid for is a real state, and the people
                    // inside the company are the ones who can do something
                    // about it, so it is not hidden from them
                    box.appendChild(tag(t('Not paid yet'), 'mid'));
                }
                return box;
            }
            var left = (plan && plan.daysLeft) || 0;
            var trialish = plan && (plan.state === 'starter' || plan.state === 'verified');
            if (trialish && left > 0) {
                // the same two words the picker uses, rather than a third way
                // of saying it that croatian would have to count separately
                box.appendChild(tag(left + ' ' + t(left === 1 ? 'day left' : 'days left'),
                    left <= 3 ? 'mid' : ''));
            }
            return box;
        }

        function draw(out) {
            // A period is swapped, not navigated to: the same numbers about a
            // different window. So the page does not flash white and rebuild --
            // what is redrawn settles in, which also covers the moment where
            // the old content is gone and the new is not yet laid out.
            body.textContent = '';
            body.classList.remove('is-swap');
            // read a layout property, or the browser folds the class off and
            // back on into no change at all and the animation never runs
            void body.offsetWidth;
            body.classList.add('is-swap');
            var s = out.screenings || {};
            var plan = out.plan || {};
            var sub = out.subscription || null;
            var shape = out.org || {};
            var sandbox = out.scope === 'sandbox';

            // The verdict is read off the same rows the block below draws, or
            // it ends up saying nothing has gone past its limit while one of
            // them sits full and red two inches underneath.
            var allow = sandbox ? { rows: [] } : allowanceRows(sub, plan, s, shape);
            var full = allow.rows.filter(function (r) {
                return !r.unmetered && r.of > 0 && r.used >= r.of;
            });

            // What a plan allows belongs to the period that plan is charged
            // for. Over a rolling window, or a cycle that has already been
            // invoiced, the plan may have been a different one for part of it:
            // an organisation that moved from starter to growth in august did
            // not have ten thousand screenings all month. Used against included
            // over those windows is two numbers that never stood side by side.
            var onPlan = Boolean(out.period && out.period.current && !out.period.days);


            // Only where there is a window behind this one to lay underneath.
            // The server sends those days wherever it sends a comparison at
            // all, so wherever the percentage is printed the line that draws
            // it can be reached.
            var older = out.previous && out.previous.days;
            var cmp = older && older.length ? {
                on: alongside,
                days: older,
                // no redraw: both charts are already on the page, and this only
                // records which of them should still be showing after the next
                // period switch or live update
                toggle: function () {
                    alongside = !alongside;
                    return alongside;
                }
            } : null;
            if (!cmp) alongside = false;

            // Nothing has ever run here, as opposed to nothing ran this
            // month. The second is a fact worth six tiles of zero and four
            // sections counting them; the first is a page telling somebody
            // eleven times that they have not started yet.
            var fresh = !shape.everScreened;

            body.appendChild(useHeadline(s, out.previous, out.period, cmp, fresh));

            // Only when there is something to say.
            //
            // A line reading "nothing has gone past its limit" is true almost
            // every day, and a sentence that is almost always the same is one
            // nobody reads by the third visit -- while it sits in the first
            // place on the screen anybody looks. What is under it already shows
            // how full each allowance is.
            //
            // The other direction is the most important sentence on the page,
            // because reaching a limit stops screening rather than growing a
            // bill, so it says so before it happens as well as after.
            var near = onPlan ? allow.rows.filter(function (r) {
                return !r.unmetered && r.of > 0 && r.used < r.of && r.used / r.of >= 0.8;
            }) : [];
            // The warning belongs inside the block it is about, not above the
            // chart: a line that appears for one period and not another moves
            // everything under it, and what moved was the chart somebody was
            // in the middle of reading.
            var warn = null;
            if (onPlan && full.length) {
                warn = { over: true, says: full.length === 1
                    ? 'One thing has reached its limit.'
                    : 'Some things have reached their limit.' };
            } else if (onPlan && near.length) {
                warn = { over: false, says: near.length === 1
                    ? 'One thing is close to its limit.'
                    : 'Some things are close to their limit.' };
            }

            // shown only when something is actually limited. a block whose
            // every row reads "unmetered" is a heading, a plan name and no
            // information, which is worse than the space it takes.
            var limited = onPlan ? allow.rows.filter(function (r) { return !r.unmetered; }) : [];
            if (limited.length) {
                body.appendChild(useAllowance(allow.rows, allow.head, allow.agreed, warn));
            }

            var was = out.previous;
            var strip = [
                {
                    label: 'Flagged', value: useNum(s.flagged), to: 'use-flagged',
                    sub: s.total ? Math.round((s.flagged / s.total) * 100) + '%' : '',
                    move: moved(s.flagged, was && was.flagged)
                },
                {
                    label: 'Addresses', value: useNum(s.addresses), to: 'use-screening',
                    move: moved(s.addresses, was && was.addresses)
                },
                {
                    label: 'Chains', value: useNum(s.assetCount), to: 'use-assets',
                    move: moved(s.assetCount, was && was.assetCount)
                },
                { label: 'Tokens used', value: useNum(shape.tokensUsed), to: 'use-team' },
                {
                    // not a comparison: how many people are here is true now,
                    // not counted over a window. what the window does hold is
                    // who arrived during it, which is the useful half anyway.
                    label: 'Members', value: useNum(shape.members), to: 'use-team',
                    sub: shape.joined ? '+' + useNum(shape.joined) + ' ' + t('joined') : ''
                },
                { label: 'Projects', value: useNum(shape.projects), to: 'use-team' }
            ];
            if (!fresh) body.appendChild(useStrip(strip));

            // ---- screening
            var sec = useSection('use-screening', 'Screening', 'screening',
                'Every address this organisation checked in the period.');
            sec.body.appendChild(useSide([
                'One screening is one address checked against the lists at that moment.',
                sandbox
                    ? 'Sandbox checks read the same lists and spend nothing, so they are counted here but never billed.'
                    : 'A check is counted when it runs, whether it came from this dashboard or from a token.'
            ]));
            var main = useMain();
            main.appendChild(useFacts([
                ['Screenings', useNum(s.total)],
                ['Addresses', useNum(s.addresses)],
                ['Busiest day', busiest(s.days)]
            ]));
            sec.body.appendChild(main);
            if (!fresh) body.appendChild(sec);

            // ---- what came back
            var flag = useSection('use-flagged', 'What came back', 'flag',
                'How the checks answered.');
            flag.body.appendChild(useSide([
                'Anything other than clear is worth a person looking at it.',
                'A flag is not a verdict about the customer: it is the list saying it knows the address.'
            ]));
            var fmain = useMain();
            // no summary above the list: the list already says clear and what
            // was not, and a total repeated two inches above itself is one more
            // number to keep in agreement with the other one
            var vrows = Object.keys(s.verdicts || {}).map(function (k) {
                return { label: verdictWord(k), n: s.verdicts[k], key: k };
            }).sort(function (a, b) { return b.n - a.n; });
            if (vrows.length) {
                fmain.appendChild(useShare(vrows, s.total, function (r) {
                    return r.key === 'clear' ? 'ok' : (r.key === 'severe' ? 'bad' : 'mid');
                }));
            } else {
                fmain.appendChild(emptyState('Nothing to show yet', ''));
            }
            flag.body.appendChild(fmain);
            if (!fresh) body.appendChild(flag);

            // ---- who did the work
            //
            // Only where there is something to divide. One project, or none at
            // all, and this is a section telling you that all of your work was
            // done by you.
            var work = (s.projects || []).filter(function (r) { return r.n > 0; });
            if (!fresh && work.length > 1) {
                var who = useSection('use-projects', 'Projects', 'projects',
                    'Which part of the business did the checking.');
                who.body.appendChild(useSide([
                    'A check is filed under a project when the token that made it belongs to that project.',
                    'Checks made from this dashboard belong to the organisation rather than to one project.'
                ]));
                var wmain = useMain();
                wmain.appendChild(useShare(work.map(function (r) {
                    return { label: r.id ? (r.name || t('Unnamed project')) : t('No project'), n: r.n };
                }), s.total));
                who.body.appendChild(wmain);
                body.appendChild(who);
            }

            // ---- chains
            var ass = useSection('use-assets', 'Chains', 'coin',
                'Which chains the addresses were on.');
            ass.body.appendChild(useSide([
                'Addresses are recognised by their shape, so this is what was asked about rather than what was declared.'
            ]));
            var amain = useMain();
            if (s.assets && s.assets.length) {
                amain.appendChild(useShare(s.assets.map(function (a) {
                    return { label: a.asset === 'other' ? t('Not recognised') : a.asset, n: a.n };
                }), s.total));
            } else {
                amain.appendChild(emptyState('Nothing to show yet', ''));
            }
            ass.body.appendChild(amain);
            if (!fresh) body.appendChild(ass);

            // ---- plan
            if (!sandbox) {
                var pl = useSection('use-plan', 'Plan', 'plan',
                    'What this organisation is allowed, and how much of it is left.');
                pl.body.appendChild(useSide(sub ? [
                    'What is included is per period, so it starts again when the next one does.',
                    'Running out stops further checks rather than adding to a bill: nothing here can charge you by surprise.'
                ] : [
                    'These are counted from the day the plan started, not from the day this period did, so they do not reset when a period does.',
                    'Running out stops further checks rather than adding to a bill: nothing here can charge you by surprise.'
                ]));
                var pmain = useMain();
                if (sub) {
                    var rows = [
                        ['Plan', sub.planName],
                        ['Billing', t(useTermWord(sub.term))],
                        ['Price', useMoney(sub.priceCents, sub.currency)],
                        ['Started', whenText(sub.startedAt)]
                    ];
                    if (sub.termEndsAt) {
                        rows.push([sub.cancelledAt ? 'Ends' : 'Renews', whenText(sub.termEndsAt)]);
                    }
                    rows.push(['This period', useSpan(out.period)]);
                    if (sub.included) {
                        rows.push(['Screenings included', useNum(sub.included.screenings)]);
                        rows.push(['Seats included', useNum(sub.included.seats)]);
                    }
                    if (!sub.paid) rows.push(['Paid', t('Not paid yet')]);
                    pmain.appendChild(useFacts(rows));
                } else {
                    var trows = [['Plan', orghPlan(plan.state)]];
                    if (plan.devGrant) trows.push(['Ends', '\u221e  ' + t('Never')]);
                    else if (plan.expiresAt) trows.push(['Ends', whenText(plan.expiresAt)]);
                    pmain.appendChild(useFacts(trows.concat([
                        ['Live checks included', plan.state === 'enterprise' ? t('Unmetered') : useNum(plan.liveIncluded)],
                        // said in full, because the number above it counts a period
                        // and this one does not: two counts that disagree are worse
                        // than one that explains itself
                        ['Live checks used since the plan started', useNum(plan.liveUsed)],
                        ['History scans', plan.historyOpen ? t('Unmetered') : useNum(plan.historyUsed) + ' / ' + useNum(plan.historyIncluded)],
                        ['This period', useSpan(out.period)]
                    ])));
                }
                pl.body.appendChild(pmain);
                body.appendChild(pl);
            }

            // ---- coverage
            var c = out.coverage || {};
            var cov = useSection('use-coverage', 'Sanctions coverage', 'coverage',
                'What the checks were run against.');
            cov.body.appendChild(useSide([
                'Every check in this period was run against this list, at the version it was on that day.'
            ]));
            var cmain = useMain();
            cmain.appendChild(useFacts([
                ['List', c.source || 'OFAC SDN'],
                ['Addresses on it', c.addresses ? useNum(c.addresses) : '—'],
                // the list publishes its own date in american order, which is
                // not how it is read anywhere this is sold
                ['List dated', c.listDate ? (whenText(listDay(c.listDate)) || c.listDate) : '—'],
                ['Last refreshed', c.refreshedAt ? whenText(c.refreshedAt, true) : '—']
            ]));
            cov.body.appendChild(cmain);
            body.appendChild(cov);

            // ---- team
            var team = useSection('use-team', 'Team', 'team',
                'Who and what can reach this organisation.');
            team.body.appendChild(useSide([
                'A token that has not been used in a long time is worth withdrawing: it can still screen until it is.'
            ]));
            var tmain = useMain();
            tmain.appendChild(useFacts([
                ['Members', useNum(shape.members)],
                ['Joined in this period', useNum(shape.joined)],
                ['Projects', useNum(shape.projects)],
                ['Tokens that can be used', useNum(shape.tokens)],
                ['Tokens used in this period', useNum(shape.tokensUsed)]
            ]));
            team.body.appendChild(tmain);
            body.appendChild(team);

            // ---- take it with you
            var foot = document.createElement('div');
            foot.className = 'use-foot';
            var note = document.createElement('p');
            note.textContent = t('A file of this period, to keep or to hand over.');
            foot.appendChild(note);
            var get = document.createElement('a');
            get.className = 'btn btn-quiet';
            get.href = '/v1/orgs/' + encodeURIComponent(org.id) + '/usage.csv?period=' +
                encodeURIComponent(out.period.key) + '&scope=' + encodeURIComponent(out.scope);
            get.setAttribute('download', '');
            get.textContent = t('Download CSV');
            foot.appendChild(get);
            body.appendChild(foot);
        }

        // OFAC writes 09/18/2026. Turned into a date only when it is plainly
        // that shape, so anything else is passed through as written rather than
        // guessed at.
        function listDay(raw) {
            var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(raw || '').trim());
            return m ? m[3] + '-' + m[1] + '-' + m[2] + 'T00:00:00Z' : '';
        }

        // Which rows belong in the allowance block, and what the heading beside
        // it says. Two kinds of plan, counted differently on purpose:
        //
        //   a bought plan allows so much per period, and this screen already
        //   counts a period, so the two are the same number
        //
        //   a trial allows so much in total, counted since it started, which is
        //   why those rows do not reset when a period does
        //
        // Addresses monitored is left out of both. It is on the cards, but
        // nothing monitors an address yet, and a quota for something that does
        // not exist is not a promise, it is a decoration.
        function allowanceRows(sub, plan, s, shape) {
            if (sub && sub.included) {
                var rows = [];
                if (sub.included.screenings !== null) {
                    rows.push({ label: 'Screenings', per: 'a month', used: s.total, of: sub.included.screenings });
                }
                if (sub.included.seats !== null) {
                    rows.push({ label: 'Seats', used: shape.members, of: sub.included.seats });
                }
                return { rows: rows, head: sub.planName, agreed: Boolean(sub.agreed) };
            }
            if (!plan || plan.state === 'none' || plan.state === 'pending') {
                return { rows: [], head: '', agreed: false };
            }
            if (plan.state === 'enterprise') {
                return {
                    rows: [{ label: 'Screenings', used: plan.liveUsed, unmetered: true }],
                    head: orghPlan(plan.state),
                    agreed: false
                };
            }
            // what a trial includes covers the whole trial, not a month of it
            var trial = [{ label: 'Live checks', per: 'this trial', used: plan.liveUsed, of: plan.liveIncluded }];
            if (!plan.historyOpen) {
                trial.push({ label: 'History scans', per: 'this trial', used: plan.historyUsed, of: plan.historyIncluded });
            }
            return { rows: trial, head: orghPlan(plan.state), agreed: false };
        }

        function busiest(days) {
            var best = null;
            (days || []).forEach(function (d) {
                if (!best || d.n > best.n) best = d;
            });
            if (!best || !best.n) return '—';
            return whenText(best.day) + '  ·  ' + useNum(best.n);
        }

        function verdictWord(key) {
            if (key === 'clear') return t('Clear');
            if (key === 'severe') return t('Sanctioned');
            if (key === 'review') return t('Worth a look');
            return key;
        }

        // Which request is the current one. Switching period twice quickly
        // sends two, and the first can answer last: without this the screen
        // settles on the window nobody asked for any more, and the only clue
        // is that the dropdown disagrees with the chart.
        var asked = 0;

        function load(swapped) {
            if (!org.id) return;
            var mine = ++asked;
            // a control was moved, so say the screen is working on it. a live
            // update is not the reader waiting for anything and gets no mark.
            if (swapped) body.classList.add('is-waiting');
            var url = '/v1/orgs/' + encodeURIComponent(org.id) + '/usage?period=' +
                encodeURIComponent(want.period) + '&scope=' + encodeURIComponent(want.scope) +
                '&tz=' + encodeURIComponent(zoneNow());
            fetch(url, { credentials: 'same-origin' })
                .then(function (r) {
                    if (!r.ok) throw new Error('bad-status-' + r.status);
                    return r.json();
                })
                .then(function (out) {
                    if (mine !== asked) return;
                    if (!out || !out.ok) throw new Error('not-ok');
                    body.classList.remove('is-waiting');
                    want.period = out.period.key;
                    latest = out;
                    pickers(out);
                    draw(out);
                })
                .catch(function (err) {
                    // an answer nobody is waiting for any more takes nothing
                    // down with it, including a failure
                    if (mine !== asked) return;
                    body.classList.remove('is-waiting');
                    // the same catch covers the request and the drawing of
                    // what came back, so a mistake in this file arrives
                    // looking exactly like a network that dropped. it still
                    // says the same thing to the reader, who can do the same
                    // one thing about it either way, but it no longer goes
                    // unrecorded for whoever has to find it
                    console.error('[usage] ' + ((err && err.message) || 'failed'));
                    body.textContent = '';
                    body.appendChild(emptyState('That did not load.', 'Reload the page to try again.'));
                });
        }

        // a screening in this organisation is a number on this page. an event
        // about the account, or about some other organisation, is not: this
        // used to reload on every one of them, which on a busy account meant
        // the screen refetching itself while nothing on it had changed.
        // this screen refetches itself when something happens here, so the
        // shell does not need to rebuild it to keep it honest
        ownsLive = true;
        onLive(function (e) {
            if (e && e.topic === 'org' && String(e.id) === String(org.id)) load();
        });
        // the days on the chart are cut in the reader's zone on the server, so
        // a zone that changes is a different chart, not a different caption
        onZone(function () { load(true); });
        load();
        return out_;
    }

    // What the plan is and how it changes. There is no card on file to show,
    // because nothing here takes cards yet; saying where a change is agreed is
    // the honest version of this screen until there is.
    function viewBilling(me) {
        var page = document.createElement('div');
        page.className = 'pg';
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
        page.className = 'pg';
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
        tlink.href = ACCOUNT_ROOT + 'tokens';
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

    // Security. Both of these addresses used to be in the rail with nothing
    // behind them, which is the thing I keep taking out of other people's
    // navigation, so they have screens now rather than a rename.
    function viewSecurity(me) {
        var page = document.createElement('div');
        page.className = 'pg';
        page.appendChild(pageHead('Security',
            'How this account is protected and where it is signed in.'));

        var two = orghCard('Two-factor', 'twofa');
        two.appendChild(orghStat('Second step',
            me.totpOn ? t('On, with an authenticator app') : t('Off')));
        var twoBody = document.createElement('div');
        twoBody.className = 'orgh-body';
        var twoP = document.createElement('p');
        twoP.className = 'orgh-line is-quiet';
        twoP.textContent = me.totpOn
            ? t('A code from your app is asked for on every new sign in.')
            : t('Without it, a password is the only thing between an intruder and this account.');
        twoBody.appendChild(twoP);
        two.appendChild(twoBody);
        page.appendChild(two);

        // where this account is signed in. the one you are reading this on is
        // marked, because "sign out everywhere else" has to be unambiguous.
        var sess = orghCard('Signed in', 'device');
        var host = document.createElement('div');
        host.className = 'sess';
        sess.appendChild(host);
        host.appendChild(waiting());

        var out = document.createElement('div');
        out.className = 'orgh-body';
        var outBtn = document.createElement('button');
        outBtn.type = 'button';
        outBtn.className = 'btn btn-quiet orgh-act';
        outBtn.textContent = t('Sign out everywhere else');
        outBtn.disabled = true;
        out.appendChild(outBtn);
        sess.appendChild(out);
        page.appendChild(sess);

        function loadSessions() {
            fetch('/v1/account/sessions', { credentials: 'same-origin' })
                .then(function (r) {
                    if (!r.ok) throw new Error('bad-status-' + r.status);
                    return r.json();
                })
                .then(function (j) {
                    var rows = (j && j.sessions) || [];
                    host.textContent = '';
                    if (!rows.length) {
                        host.appendChild(emptyState('Nothing signed in',
                            'That should not happen: you are reading this.'));
                        return;
                    }
                    rows.forEach(function (x) { host.appendChild(sessionRow(x)); });
                    outBtn.disabled = rows.length < 2;
                })
                .catch(function () {
                    host.textContent = '';
                    host.appendChild(emptyState('That did not load.', 'Reload the page to try again.'));
                });
        }

        outBtn.addEventListener('click', function () {
            outBtn.disabled = true;
            fetch('/v1/account/sessions/revoke', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: '{}'
            }).then(function (r) {
                if (!r.ok) throw new Error('bad');
                toast(t('Signed out everywhere else'), 'good');
                loadSessions();
            }).catch(function () {
                toast(t('That did not work.'), 'bad');
                outBtn.disabled = false;
            });
        });

        // signing out everywhere else, from somewhere else
        onLive(function (e) { if (e.topic === 'me') loadSessions(); });
        loadSessions();
        return page;
    }

    function sessionRow(x) {
        var row = document.createElement('div');
        row.className = 'sess-row';
        var txt = document.createElement('span');
        txt.className = 'sess-t';
        var n = document.createElement('span');
        n.className = 'sess-n';
        n.textContent = x.lastSeenAt
            ? t('Last used') + '  ·  ' + new Date(x.lastSeenAt).toISOString().slice(0, 16).replace('T', ' ')
            : t('In use');
        if (x.current) {
            var here = document.createElement('span');
            here.className = 'mem-you';
            here.textContent = t('this one');
            n.appendChild(here);
        }
        txt.appendChild(n);
        var sub = document.createElement('span');
        sub.className = 'sess-sub';
        sub.textContent = (x.startedAt
            ? t('Started') + ' ' + new Date(x.startedAt).toISOString().slice(0, 10) : '') +
            (x.mfa ? '  ·  ' + t('passed two-factor') : '');
        txt.appendChild(sub);
        row.appendChild(txt);
        return row;
    }

    // What this account has done, newest first. It reads the same trail a
    // regulator would be shown, filtered to one actor by the server.
    var LOG_SAID = {
        'signed-in': 'Signed in',
        'signed-out': 'Signed out',
        'sign-in-refused': 'A sign in was refused',
        'password-changed': 'Password changed',
        'password-reset': 'Password reset',
        'totp-on': 'Two-factor turned on',
        'totp-off': 'Two-factor turned off',
        'profile-changed': 'Profile changed',
        'org-created': 'Organisation created',
        'org-renamed': 'Organisation renamed',
        'org-removed': 'Organisation closed',
        'project-created': 'Project created',
        'project-renamed': 'Project renamed',
        'project-archived': 'Project archived',
        'project-restored': 'Project restored',
        'project-removed': 'Project removed',
        'token-minted': 'Access token issued',
        'token-revoked': 'Access token revoked'
    };

    function viewLogs(me) {
        var page = document.createElement('div');
        page.className = 'pg';
        page.appendChild(pageHead('Audit logs',
            'What this account has done, newest first.'));

        var card = document.createElement('div');
        card.className = 'card';
        page.appendChild(card);
        card.appendChild(waiting());

        function load() {
            fetch('/v1/account/logs', { credentials: 'same-origin' })
                .then(function (r) {
                    if (!r.ok) throw new Error('bad-status-' + r.status);
                    return r.json();
                })
                .then(function (j) {
                    var rows = (j && j.rows) || [];
                    card.textContent = '';
                    if (!rows.length) {
                        card.appendChild(emptyState('Nothing yet',
                            'Anything this account does shows up here.'));
                        return;
                    }
                    rows.forEach(function (r) { card.appendChild(logRow(r)); });
                })
                .catch(function () {
                    card.textContent = '';
                    card.appendChild(emptyState('That did not load.', 'Reload the page to try again.'));
                });
        }

        // every notice means this account did something, which is a line here
        onLive(load);
        load();
        return page;
    }

    function logRow(r) {
        var row = document.createElement('div');
        row.className = 'lg';
        var when = document.createElement('span');
        when.className = 'lg-when';
        when.textContent = r.at
            ? new Date(r.at).toISOString().slice(0, 16).replace('T', ' ') : '';
        row.appendChild(when);
        var txt = document.createElement('span');
        txt.className = 'lg-t';
        var n = document.createElement('span');
        n.className = 'lg-n';
        // an event we have no words for is shown by its own key rather than
        // hidden: a trail with gaps in it is worth less than an ugly line.
        n.textContent = LOG_SAID[r.kind] ? t(LOG_SAID[r.kind]) : r.kind;
        txt.appendChild(n);
        if (r.detail) {
            var d = document.createElement('span');
            d.className = 'lg-d';
            d.textContent = r.detail;
            txt.appendChild(d);
        }
        row.appendChild(txt);
        if (r.ip) {
            var ip = document.createElement('code');
            ip.className = 'lg-ip';
            ip.textContent = r.ip;
            row.appendChild(ip);
        }
        return row;
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
                kill.className = 'rowbtn is-bad';
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
        onLive(function (e) { if (e.topic === 'org') load(); });

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

    // Taking a row apart. It is cloned into a grid of tiles, each clipped to its
    // own square of the original, and the tiles are thrown outward and faded.
    // Cloning rather than drawing means every tile is the real row - its text,
    // its pill, its border - so what comes apart is what was there, in both
    // themes, without rasterising anything or asking for a library.
    //
    // The row itself collapses underneath at the same time, so the list closes
    // the gap while the pieces are still in the air.
    // Fine enough to read as particles rather than torn paper, and no finer.
    // Every tile is a clone of the row, so the count is also the cost: seventy
    // two of them are built in about forty milliseconds, where a hundred and
    // thirty took a hundred and fifty and stalled the frame before the
    // animation had begun.
    var DUST_COLS = 18;
    var DUST_ROWS = 4;

    function dissolve(el, done) {
        var finish = function () { if (done) done(); };
        if (!el || !el.parentNode) return finish();

        var slow = false;
        try {
            slow = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch (err) { slow = false; }
        // asked for less motion: the row simply goes, which is the same outcome
        if (slow) { el.remove(); return finish(); }

        var box = el.getBoundingClientRect();
        if (!box.width || !box.height) { el.remove(); return finish(); }

        var layer = document.createElement('div');
        layer.className = 'dust';
        layer.setAttribute('aria-hidden', 'true');
        layer.style.left = box.left + 'px';
        layer.style.top = box.top + 'px';
        layer.style.width = box.width + 'px';
        layer.style.height = box.height + 'px';

        var tw = box.width / DUST_COLS;
        var th = box.height / DUST_ROWS;
        for (var y = 0; y < DUST_ROWS; y++) {
            for (var x = 0; x < DUST_COLS; x++) {
                var tile = el.cloneNode(true);
                tile.removeAttribute('id');
                tile.className = el.className + ' dust-bit';
                tile.style.width = box.width + 'px';
                tile.style.height = box.height + 'px';
                tile.style.clipPath = 'inset(' + (y * th) + 'px ' +
                    (box.width - (x + 1) * tw) + 'px ' +
                    (box.height - (y + 1) * th) + 'px ' + (x * tw) + 'px)';
                // Upward, with only a little lean. Throwing the pieces sideways
                // read as a row sliding off; rising and shrinking reads as one
                // coming apart, which is what happened.
                var lean = x / DUST_COLS;
                tile.style.setProperty('--dx', (lean * 10 + Math.random() * 7 - 2).toFixed(1) + 'px');
                // the higher the tile started, the further it gets
                var up = 14 + (DUST_ROWS - y) * 5 + Math.random() * 14;
                tile.style.setProperty('--dy', (-up).toFixed(1) + 'px');
                // barely any turn: on pieces this small a big one only smears
                tile.style.setProperty('--rot', ((Math.random() - 0.5) * 12).toFixed(1) + 'deg');
                // swept from the left, so it reads as one thing coming apart
                // rather than everything vanishing at once
                tile.style.animationDelay = (lean * 230 + Math.random() * 70).toFixed(0) + 'ms';
                layer.appendChild(tile);
            }
        }
        document.body.appendChild(layer);

        el.style.height = box.height + 'px';
        el.classList.add('is-dust');
        void el.offsetWidth;
        el.style.height = '0px';

        // the last tile starts at about 350ms and runs for 620, so anything
        // shorter than this cuts the rightmost pieces off mid flight
        setTimeout(function () {
            if (layer.parentNode) layer.remove();
            if (el.parentNode) el.remove();
            finish();
        }, 960);
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
            project: '',
            scopes: {}
        };
        // The projects this key could belong to. Fetched once when the drawer
        // opens rather than held anywhere: a project made in the other tab a
        // minute ago should be on this list.
        var mine = [];
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

            // Which part of the business this key works for. Every check it
            // makes is filed under that, which is what lets one bill be read
            // as two. Offered only where there is a choice: a company with no
            // projects is not helped by a field whose only answer is none.
            if (mine.length) {
                d.body.appendChild(drwSection('Project',
                    'Checks made with this token are counted under the project you pick.',
                    selectBox('tk-project', [{
                        options: [{ value: '', label: t('No project') }].concat(
                            mine.map(function (pr) {
                                return { value: String(pr.id), label: pr.name || t('Unnamed project') };
                            }))
                    }], want.project, function (v) { want.project = v; }), true));
            }

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
                        project: want.project,
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

        // and once the list arrives, draw the step again so the field is there.
        // the drawer opens immediately either way: waiting on a request before
        // showing anything is a panel that hangs for no reason a reader can see.
        var at = (lastMe && lastMe.org && lastMe.org.id) || '';
        if (at) {
            fetch('/v1/orgs/' + encodeURIComponent(at) + '/projects', { credentials: 'same-origin' })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (out) {
                    var rows = (out && out.rows) || [];
                    mine = rows.filter(function (pr) { return !pr.archivedAt; });
                    if (mine.length) d.show(stepConfigure, true);
                })
                .catch(function () {  });
        }
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
        // The page was served with this list, so prefer it over anything kept
        // from a previous visit: it was read from the database for this very
        // request. Only a stored copy is old enough to be worth second
        // guessing. An empty list served is still an answer, so the screen says
        // there are none rather than pretending to be loading.
        var served = Array.isArray(me && me.orgs) ? me.orgs : null;
        var warm = served ? null : readOrgCache(who);
        var rows = served || (warm ? warm.rows : []);
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

        // The plan running in one organisation. Two companies can be on two
        // different plans, so this is per row rather than a line about the
        // account. The ones worth noticing are the ones that stop you working:
        // no plan and a trial that has run out are marked.
        function planPill(plan) {
            // the countdown is worked out here rather than taken as given,
            // because this row may have come out of a cache written days ago:
            // the date it ends is still true, the number of days left is not.
            var state = (plan && plan.state) || 'none';
            var ends = plan && plan.endsAt ? new Date(plan.endsAt).getTime() : 0;
            var left = ends ? Math.ceil((ends - Date.now()) / 86400000) : 0;
            var trialing = state === 'starter' || state === 'verified';
            if (trialing && ends && left <= 0) { state = 'expired'; left = 0; }

            var pill = document.createElement('span');
            pill.className = 'org-plan';
            if (state === 'none' || state === 'expired') pill.classList.add('is-off');
            if (state === 'pending') pill.classList.add('is-wait');
            pill.textContent = orghPlan(state);
            if (trialing && left > 0) {
                var d = document.createElement('span');
                d.className = 'org-plan-d';
                d.textContent = left + ' ' + t(left === 1 ? 'day left' : 'days left');
                pill.appendChild(d);
            }
            return pill;
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
            b.appendChild(planPill(r.plan));
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
                    askCloseOrg(r, function () { dissolve(card, load); });
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
        // somebody on another screen made one, renamed one or closed one
        onLive(function (e) { if (e.topic === 'orgs') load(); });

        if (served || warm) draw();
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
                forgetPrjCache();
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

    // The other screens this account has open.
    //
    // One connection for the whole app, not one per view: a laptop and a phone
    // signed in as the same person each hold one, and what arrives is a notice
    // that something moved rather than the thing itself. Whatever is listening
    // then asks for it through the endpoint it always used, so a notice can
    // never show somebody data they could not already fetch.
    var liveOn = [];
    var liveWired = false;
    var ownsLive = false;

    function onLive(fn) {
        liveOn.push(fn);
        return function () {
            var at = liveOn.indexOf(fn);
            if (at !== -1) liveOn.splice(at, 1);
        };
    }

    function wireLive() {
        if (liveWired || typeof EventSource === 'undefined') return;
        liveWired = true;
        var src;
        try {
            src = new EventSource('/v1/live');
        } catch (err) {
            return;
        }
        src.addEventListener('message', function (e) {
            var got = null;
            try { got = JSON.parse(e.data); } catch (err) { return; }
            if (!got || !got.topic) return;
            // the shell reads the account and the organisation, so it is
            // refreshed whatever moved; the screens decide for themselves
            refreshMe();
            liveOn.slice().forEach(function (fn) {
                try { fn(got); } catch (err) {  }
            });
        });
        // EventSource reconnects on its own, so an error is not ours to handle:
        // stepping in would only race with it.
    }

    // The shell: the name in the corner, the plan badge, the organisation. Asked
    // for again rather than patched from the notice, so one path builds it.
    var refreshing = false;
    function refreshMe() {
        if (refreshing) return;
        refreshing = true;
        fetch('/v1/entitlement', { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (me) {
                if (!me) return;
                writeMe(me);
                // an organisation you were taken out of, or one that was closed
                // while you were standing in it
                if (atOrg && !me.org) { location.replace(ORGS_PATH); return; }
                if (!sameMe(lastMe, me)) {
                    // A screening changes three counters and nothing else. The
                    // screen in front of somebody may already be following
                    // those itself, and rebuilding it would throw away what
                    // they were doing -- a comparison they had pinned, where
                    // they had scrolled, a dropdown they had open -- to arrive
                    // at the same page with the same numbers on it.
                    paintMe(me, ownsLive && sameShell(lastMe, me));
                } else lastMe = me;
            })
            .catch(function () {  })
            .then(function () { refreshing = false; });
    }

    function paintCanvas() {
        var canvas = document.getElementById('canvas');
        if (!canvas) return;
        // whatever the last screen was listening for, it is gone now. only
        // screens subscribe, so clearing here is the whole lifecycle.
        liveOn.length = 0;
        zoneOn.length = 0;
        // until a screen says otherwise, it does not follow live changes on
        // its own and has to be drawn again to show them
        ownsLive = false;
        canvas.textContent = '';
        if (!lastMe) return;
        if (onOrgs()) {
            canvas.appendChild(viewOrgs(lastMe));
            return;
        }
        var page = accountPage();
        if (page) {
            if (page === 'preferences') canvas.appendChild(viewPreferences(lastMe));
            else if (page === 'security') canvas.appendChild(viewSecurity(lastMe));
            else if (page === 'tokens') canvas.appendChild(viewTokens(lastMe));
            else if (page === 'logs') canvas.appendChild(viewLogs(lastMe));
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

    // the mark in the sidebar goes to the organisation you are in. it used to go
    // to /dashboard, which is now a door onto the picker, so it would have thrown
    // you out of the place it was meant to take you home to.
    function paintSideBrand() {
        var brand = document.querySelector('.side-brand');
        if (!brand) return;
        // in an organisation it goes to that organisation. on the picker there
        // is nowhere further in to go, so it is the way out to the front page,
        // which is what the mark in the corner used to do.
        brand.setAttribute('href', atOrg ? orgHome(atOrg) : (onOrgs() ? '/' : ORGS_PATH));
    }

    function paintShell() {
        if (location.pathname === ORGS_PATH_ALT && canRoute) {
            history.replaceState({}, '', ORGS_PATH);
        }
        paintSideBrand();
        paintNav(currentNav());
        paintFoot();
        applySideMode(sideMode());
    }

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(paintShell);
    }
    paintShell();

    // What the page was served with. The server knew who was asking, so it
    // wrote the answer into the document: no request, nothing to wait for, and
    // the first frame is the finished screen. The stored copy is the fallback
    // for a page that somehow arrives without it.
    function served() {
        var tag = document.getElementById('sp-state');
        if (!tag) return null;
        try {
            var got = JSON.parse(tag.textContent || 'null');
            return got && got.email ? got : null;
        } catch (err) {
            return null;
        }
    }

    wireLive();

    var given = served();
    var cached = given || readMe();
    if (cached) paintMe(cached);
    else bindAccountMenu();
    if (given) writeMe(given);

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
    // the page already carries this when it was served to a signed-in reader.
    // the call still runs, because the screen may sit open while something
    // changes, but by now it only confirms rather than reveals.
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
            // The work belongs to an organisation, so without one there is
            // nothing to show but the choice of one. Your own account is the
            // exception and always was: preferences, security, tokens and the
            // trail are yours whether or not any organisation is open, and
            // before this they were thrown back to the picker the moment the
            // entitlement said no organisation was current.
            if (!onOrgs() && !inAccount() && !me.org && !atOrg) {
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
