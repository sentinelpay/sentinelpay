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

    var ICONS = {
        home: '<path d="M4 10.5 12 4l8 6.5V20H4Z"/><path d="M9.5 20v-5.5h5V20"/>',
        inbox: '<path d="M3.5 13H8l1.5 3h5L16 13h4.5"/><path d="M5 5.5h14l1.5 7.5v5.5H3.5V13Z"/>',
        bell: '<path d="M18 16V11a6 6 0 1 0-12 0v5l-1.5 2.5h15Z"/><path d="M10 19.5a2 2 0 0 0 4 0"/>',
        folder: '<path d="M3.5 6.5h6l2 2.5h9v9.5h-17Z"/>',
        search: '<circle cx="11" cy="11" r="6.5"/><path d="m19.5 19.5-3.8-3.8"/>',
        wallet: '<path d="M4 7.5h13.5A2.5 2.5 0 0 1 20 10v7.5H4Z"/><path d="M4 7.5V6a1.5 1.5 0 0 1 1.5-1.5H16"/><circle cx="16.5" cy="13.5" r="1.1"/>',
        list: '<path d="M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01"/>',
        rings: '<circle cx="12" cy="12" r="3"/><path d="M12 4.5v4.4M12 15.1v4.4M4.5 12h4.4M15.1 12h4.4"/>',
        graph: '<circle cx="6" cy="17" r="2.2"/><circle cx="12" cy="7" r="2.2"/><circle cx="18" cy="15" r="2.2"/><path d="m7.6 15.3 3-6.2M13.8 8.4l2.9 4.9"/>',
        file: '<path d="M14 3.5v5h5"/><path d="M19 8.5V20H5V3.5h9Z"/>',
        trail: '<path d="M6 4.5v12"/><circle cx="6" cy="18.5" r="1.6"/><path d="M10.5 8h8M10.5 12.5h8M10.5 17h5"/>',
        shield: '<path d="M12 3.5 5 6.5v5c0 5 4.4 8.4 7 9.2 2.6-.8 7-4.2 7-9.2v-5Z"/>',
        book: '<path d="M5 4.5h9.5A2.5 2.5 0 0 1 17 7v12.5H7.5A2.5 2.5 0 0 1 5 17Z"/><path d="M17 7h2v12.5"/>',
        wave: '<path d="M3.5 12h3l2-5 3.5 11 3-9 2 3h3.5"/>',
        key: '<circle cx="8" cy="12" r="3.6"/><path d="M11.6 12H21l-1.4 2M17.4 12v2.6"/>',
        hook: '<path d="M8 5.5v6a4 4 0 0 0 8 0"/><circle cx="8" cy="4" r="1.6"/><circle cx="16" cy="4" r="1.6"/><circle cx="12" cy="19" r="1.6"/><path d="M12 15.5v1.9"/>',
        flask: '<path d="M10 3.5v6L5.5 18a1.5 1.5 0 0 0 1.3 2.2h10.4A1.5 1.5 0 0 0 18.5 18L14 9.5v-6"/><path d="M9 3.5h6M7.8 14.5h8.4"/>',
        users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M16 6.2A3 3 0 0 1 16 13M20.5 19c0-2.3-1.4-3.8-3.2-4.5"/>',
        card: '<path d="M3.5 6.5h17v11h-17Z"/><path d="M3.5 10.5h17"/><path d="M7 14.5h3"/>',
        panel: '<path d="M4.5 5.5h15v13h-15Z"/><path d="M10 5.5v13"/>',
        clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2V12l3.2 2"/>',
        back: '<path d="m14 6-6 6 6 6"/>',
        out: '<path d="M14.5 4.5H19v15h-4.5"/><path d="M10 15.5 13.5 12 10 8.5"/><path d="M13.5 12H4"/>',
        cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5"/>'
    };

    var NAV = [
        { group: 'Work', items: [
            { key: 'overview', label: 'Overview', icon: 'home' },
            { key: 'triage', label: 'Triage', icon: 'inbox' },
            { key: 'alerts', label: 'Alerts', icon: 'bell' },
            { key: 'cases', label: 'Cases', icon: 'folder' }
        ] },
        { group: 'Screening', items: [
            { key: 'screenings', label: 'Screenings', icon: 'search' },
            { key: 'wallets', label: 'Wallets', icon: 'wallet' },
            { key: 'watchlists', label: 'Watchlists', icon: 'list' }
        ] },
        { group: 'Investigate', items: [
            { key: 'exposure', label: 'Exposure', icon: 'rings' },
            { key: 'graph', label: 'Graph', icon: 'graph' }
        ] },
        { group: 'Evidence', items: [
            { key: 'reports', label: 'Reports', icon: 'file' },
            { key: 'audit', label: 'Audit trail', icon: 'trail' },
            { key: 'coverage', label: 'Coverage', icon: 'shield' }
        ] },
        { group: 'Configure', items: [
            { key: 'policy', label: 'Policy', icon: 'book' },
            { key: 'notifications', label: 'Notifications', icon: 'wave' }
        ] },
        { group: 'Developers', items: [
            { key: 'api', label: 'API keys', icon: 'key' },
            { key: 'webhooks', label: 'Webhooks', icon: 'hook' },
            { key: 'sandbox', label: 'Sandbox', icon: 'flask' }
        ] },
        { group: 'Organisation', items: [
            { key: 'team', label: 'Team', icon: 'users' },
            { key: 'billing', label: 'Billing', icon: 'card' },
            { key: 'account', label: 'Account', icon: 'cog' }
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

    function paintNav(active) {
        var host = document.getElementById('side-nav');
        if (!host) return;
        host.textContent = '';
        NAV.forEach(function (g) {
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
        var dark = mode === 'dark' ||
            (mode === 'system' && window.matchMedia &&
             window.matchMedia('(prefers-color-scheme: dark)').matches);
        var root = document.documentElement;
        root.setAttribute('data-theme', dark ? 'dark' : 'light');
        root.setAttribute('data-theme-mode', mode);
        [].forEach.call(document.querySelectorAll('[data-theme-pick]'), function (b) {
            var on = b.getAttribute('data-theme-pick') === mode;
            b.classList.toggle('is-on', on);
            b.setAttribute('aria-checked', on ? 'true' : 'false');
        });
    }

    function setTheme(mode) {
        try { localStorage.setItem(THEME_KEY, mode); } catch (err) {  }
        applyTheme(mode);
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

    function autoZone() {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        } catch (err) {
            return 'UTC';
        }
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

    function zoneList() {
        var common = [
            'Europe/Zagreb', 'Europe/London', 'Europe/Berlin', 'Europe/Warsaw',
            'Europe/Lisbon', 'America/New_York', 'America/Chicago', 'America/Los_Angeles',
            'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'UTC'
        ];
        var mine = autoZone();
        if (common.indexOf(mine) === -1) common.unshift(mine);
        return common;
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
        b.className = 'acct-opt acct-row' + (o.soon ? ' is-soon' : '');
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
        main.appendChild(acctRow('Account', { icon: 'cog', soon: true }));
        main.appendChild(acctRow('Feature previews', { icon: 'flask', soon: true }));
        main.appendChild(acctRow('Changelog', { icon: 'file', soon: true }));

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

        var zone = document.createElement('div');
        zone.className = 'acct-zone';
        var zoneVal = zonePref() === 'auto'
            ? t('Auto') + ' (' + zoneNow() + ')'
            : zoneNow();
        var zoneRow = acctRow('Timezone', { icon: 'clock', more: true });
        var zv = document.createElement('span');
        zv.className = 'acct-row-sub';
        zv.textContent = zoneVal;
        zoneRow.insertBefore(zv, zoneRow.querySelector('.acct-chev'));
        zone.appendChild(zoneRow);
        main.appendChild(sep());
        main.appendChild(zone);

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
        tz.appendChild(sep());
        var tzList = document.createElement('div');
        tzList.className = 'acct-scroll';
        var pref = zonePref();
        tzList.appendChild(acctPick(t('Auto') + ' (' + autoZone() + ')', pref === 'auto', null, null,
            function () { setZone('auto'); paintAccountMenu(me); }));
        zoneList().forEach(function (z) {
            var off = zoneOffset(z);
            tzList.appendChild(acctPick(z.replace(/_/g, ' ') + (off ? '  ' + off : ''), pref === z, null, null,
                function () { setZone(z); paintAccountMenu(me); }));
        });
        tz.appendChild(tzList);

        zoneRow.addEventListener('click', function () { pop.classList.add('is-sub'); });

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

    function writeMe(me) {
        try {
            localStorage.setItem(ME_KEY, JSON.stringify({
                name: me.name || '',
                email: me.email || '',
                trial: { state: (me.trial && me.trial.state) || 'none' }
            }));
        } catch (err) {  }
    }

    function forgetMe() {
        try { localStorage.removeItem(ME_KEY); } catch (err) {  }
    }

    function sameMe(a, b) {
        if (!a || !b) return false;
        return a.name === b.name && a.email === b.email &&
            ((a.trial && a.trial.state) || '') === ((b.trial && b.trial.state) || '');
    }

    function paintMe(me) {
        paintAvatar(me);
        paintAccountMenu(me);
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

    function paintShell() {
        paintNav('overview');
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

    fetch('/v1/entitlement', { credentials: 'same-origin' })
        .then(function (r) {
            if (r.status === 401) { forgetMe(); return null; }
            return r.ok ? r.json() : null;
        })
        .then(function (me) {
            if (!me) return;
            if (!sameMe(cached, me)) paintMe(me);
            writeMe(me);
        })
        .catch(function () {  });
})();
