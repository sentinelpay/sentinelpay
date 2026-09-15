(function () {
    'use strict';

    var app = document.getElementById('app');
    var side = document.getElementById('side');
    var menuBtn = document.getElementById('menu-btn');
    var scrim = document.getElementById('scrim');

    function setMenu(open) {
        if (!app) return;
        app.classList.toggle('is-open', open);
        if (scrim) scrim.hidden = !open;
        if (menuBtn) menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
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
        var foot = document.getElementById('side-foot');
        if (!host) return;
        host.textContent = '';
        if (foot) foot.textContent = '';
        NAV.forEach(function (g, gi) {
            var target = (foot && gi === NAV.length - 1) ? foot : host;
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
            var inkMid = (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
            var dx = (m.width / 2 - inkMid) / scale;
            inner.style.setProperty('--ink-x', dx.toFixed(3) + 'px');
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

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { paintNav('overview'); });
    }
    paintNav('overview');

    fetch('/v1/entitlement', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (me) { if (me) paintAvatar(me); })
        .catch(function () {  });
})();
