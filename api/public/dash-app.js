(function () {
    'use strict';
    var D = window.SentinelDashData;
    var view = document.getElementById('dash-view');
    if (!D || !view) return;
    var t = function (x) { return window.SentinelI18n ? window.SentinelI18n.t(x) : x; };
    var me = { name: '' };
    function anotherApprover() {
        var hit = null;
        (D.team || []).forEach(function (m) { if (!hit && m.name !== me.name) hit = m; });
        return hit ? hit.name : '';
    }
    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = t(text);
        return n;
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[<>&"']/g, function (c) {
            return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }
    function lang() {
        return (window.SentinelI18n && window.SentinelI18n.lang && window.SentinelI18n.lang()) || 'en';
    }
    function locale() {
        var l = lang();
        return l === 'hr' ? 'hr-HR' : (l === 'de' ? 'de-DE' : 'en-GB');
    }

    function since(iso) {
        var then = new Date(iso).getTime();
        if (isNaN(then)) return '';
        var secs = Math.round((then - Date.now()) / 1000);
        var units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
        try {
            var rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
            for (var i = 0; i < units.length; i++) {
                if (Math.abs(secs) >= units[i][1]) return rtf.format(Math.round(secs / units[i][1]), units[i][0]);
            }
            return rtf.format(Math.round(secs), 'second');
        } catch (e) {
            return new Date(iso).toISOString().slice(0, 10);
        }
    }
    function when(iso, withTime) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        try {
            return d.toLocaleString(locale(), withTime
                ? { dateStyle: 'medium', timeStyle: 'short' }
                : { dateStyle: 'medium' });
        } catch (e) { return d.toISOString().slice(0, 10); }
    }
    function num(n) {
        try { return Number(n).toLocaleString(locale()); } catch (e) { return String(n); }
    }
    function short(addr) {
        var s = String(addr || '');
        return s.length > 18 ? s.slice(0, 8) + '…' + s.slice(-6) : s;
    }
    function bandName(key) {
        return { severe: t('Severe'), high: t('High'), medium: t('Medium'), low: t('Low') }[key] || key;
    }
    function bandTag(key) {
        var n = el('span', 'dash-band dash-band-' + key);
        n.textContent = bandName(key);
        return n;
    }
    function catLabel(key) {
        var hit = null;
        D.categories.forEach(function (c) { if (c.key === key) hit = c; });
        return hit ? t(hit.label) : key;
    }

    function catTone(key) {
        var hit = null;
        D.categories.forEach(function (c) { if (c.key === key) hit = c; });
        return hit ? hit.tone : 'medium';
    }
    function toneColour(tone) {
        return ({
            severe: 'var(--d-severe)', high: 'var(--d-high)',
            medium: 'var(--d-medium)', low: 'var(--d-low)',
        })[tone] || 'var(--d-ink-3)';
    }
    function decisionWord(d) {
        if (d === 'approved') return t('Approved');
        if (d === 'rejected') return t('Rejected');
        if (d === 'escalated') return t('Escalated');
        return t('Not decided');
    }
    var ICONS = {
        home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/>',
        search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
        bell: '<path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/>',
        eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/>',
        folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h9A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18Z"/>',
        book: '<path d="M5 4.5h9.5A2.5 2.5 0 0 1 17 7v12.5H7.5A2.5 2.5 0 0 1 5 17Z"/><path d="M17 7h2v12.5"/>',
        file: '<path d="M14 3v5h5"/><path d="M19 8v12.5H5V3.5h9Z"/>',
        list: '<path d="M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01"/>',
        key: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9l-1.5 2M17 12v3"/>',
        users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M16 6.2A3 3 0 0 1 16 13M20.5 19c0-2.3-1.4-3.8-3.2-4.5"/>',
        cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5"/>',
        menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
        download: '<path d="M12 4v11"/><path d="m7.5 11 4.5 4.5 4.5-4.5"/><path d="M5 19.5h14"/>',
        check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
        x: '<path d="M6 6l12 12M18 6 6 18"/>',
        up: '<path d="M12 19V6"/><path d="m6.5 11.5 5.5-5.5 5.5 5.5"/>',
        inbox: '<path d="M3.5 13H8l1.5 3h5L16 13h4.5"/><path d="M5 5.5h14l1.5 7.5v5.5H3.5V13Z"/>',
        shield: '<path d="M12 3.5 5 6.5v5c0 5 4.4 8.4 7 9.2 2.6-.8 7-4.2 7-9.2v-5Z"/>',
        clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    };
    function icon(name, cls) {
        return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            (ICONS[name] || '') + '</svg>';
    }
    var NAV = [
        { group: 'Work', items: [
            { route: '', label: 'Overview', icon: 'home' },
            { route: 'triage', label: 'Triage', icon: 'inbox', count: function () {
                var n = 0; D.alerts.forEach(function (a) { if (a.state === 'open') n++; }); return n;
            } },
            { route: 'screenings', label: 'Screenings', icon: 'search' },
            { route: 'alerts', label: 'Alerts', icon: 'bell', count: function () {
                var n = 0; D.alerts.forEach(function (a) { if (a.state === 'open') n++; }); return n;
            } },
            { route: 'monitoring', label: 'Monitoring', icon: 'eye' },
            { route: 'cases', label: 'Cases', icon: 'folder' },
        ] },
        { group: 'Evidence', items: [
            { route: 'policy', label: 'Policy', icon: 'book' },
            { route: 'reports', label: 'Reports', icon: 'file' },
            { route: 'activity', label: 'Activity', icon: 'list' },
        ] },
        { group: 'Account', items: [
            { route: 'api', label: 'API keys', icon: 'key' },
            { route: 'team', label: 'Team', icon: 'users' },
            { route: 'settings', label: 'Settings', icon: 'cog' },
        ] },
    ];
    var LIVE_NAV = [
        { group: 'Work', items: [
            { route: '', label: 'Start', icon: 'home' },
            { route: 'screenings-log', label: 'Checks you have run', icon: 'search' },
        ] },
        { group: 'Account', items: [
            { route: 'settings', label: 'Settings', icon: 'cog' },
        ] },
    ];

    function paintNav(current) {
        var nav = document.getElementById('dash-nav');
        if (!nav) return;
        nav.textContent = '';
        var groups = (typeof demoMode === 'function' && demoMode()) ? NAV : LIVE_NAV;
        groups.forEach(function (g) {
            nav.appendChild(el('div', 'dash-nav-group', g.group));
            g.items.forEach(function (it) {
                var a = document.createElement('a');
                a.href = '#/' + it.route;
                a.innerHTML = icon(it.icon) + '<span>' + esc(t(it.label)) + '</span>';
                if (it.count) {
                    var n = it.count();
                    if (n) {
                        var b = el('span', 'dash-count');
                        b.textContent = String(n);
                        a.appendChild(b);
                    }
                }
                if (it.route === current) a.classList.add('is-on');
                nav.appendChild(a);
            });
        });
    }
    function paintLive() {
        var box = document.getElementById('dash-live');
        if (!box) return;
        if (typeof demoMode === 'function' && !demoMode() && ENT) {
            box.hidden = true;
            return;
        }
        box.hidden = false;
        box.innerHTML = '<i></i><span>' + esc(t('Monitoring is running')) + '</span>';
    }
    function paintUsage() {
        var box = document.getElementById('dash-usage');
        if (!box) return;
        if (typeof demoMode === 'function' && !demoMode() && ENT) {
            var tr = ENT.trial || {};
            if (tr.state !== 'starter' && tr.state !== 'verified') {
                box.hidden = true;
                return;
            }
            box.hidden = false;
            var used = tr.liveUsed || 0;
            var inc = tr.liveIncluded || 0;
            var pc = inc ? Math.min(100, Math.round((used / inc) * 100)) : 0;
            box.innerHTML =
                '<div class="dash-usage-top"><span>' + esc(t('Checks')) + '</span>' +
                '<b>' + esc(String(used)) + ' / ' + esc(String(inc)) + '</b></div>' +
                '<div class="dash-usage-bar"><div class="dash-usage-fill" style="width:' + pc + '%"></div></div>' +
                '<div class="dash-usage-note">' + esc(t('Trial')) + ' · ' +
                esc(String(tr.daysLeft)) + ' ' + esc(t('days left')) + '</div>';
            return;
        }
        box.hidden = false;
        var a = D.account;
        var pct = Math.min(100, Math.round((a.checksUsed / a.checksIncluded) * 100));
        box.innerHTML =
            '<div class="dash-usage-top"><span>' + esc(t('Checks this month')) + '</span>' +
            '<b>' + esc(num(a.checksUsed)) + ' / ' + esc(num(a.checksIncluded)) + '</b></div>' +
            '<div class="dash-usage-bar"><div class="dash-usage-fill" style="width:' + pct + '%"></div></div>' +
            '<div class="dash-usage-note">' + esc(t('Plan')) + ': ' + esc(a.plan) + ' · ' +
            esc(t('renews')) + ' ' + esc(when(a.renews)) + '</div>';
    }
    function card(title, note) {
        var c = el('div', 'dash-card');
        if (title) {
            var h = el('div', 'dash-card-h');
            h.appendChild(el('span', null, title));
            if (note) h.appendChild(el('span', 'dash-card-note', note));
            c.appendChild(h);
        }
        return c;
    }
    function head(title, sub, actions) {
        var wrap = el('div', 'dash-head');
        var left = el('div');
        left.appendChild(el('h1', 'dash-h1', title));
        if (sub) left.appendChild(el('p', 'dash-sub', sub));
        wrap.appendChild(left);
        if (actions && actions.length) {
            var right = el('div', 'dash-head-actions');
            actions.forEach(function (a) { right.appendChild(a); });
            wrap.appendChild(right);
        }
        return wrap;
    }
    function button(label, kind, onClick, iconName) {
        var b = el('button', 'dash-btn' + (kind ? ' dash-btn-' + kind : ''));
        b.type = 'button';
        b.innerHTML = (iconName ? icon(iconName) : '') + '<span>' + esc(t(label)) + '</span>';
        if (onClick) b.addEventListener('click', onClick);
        return b;
    }
    function table(columns, rows, onOpen) {
        var wrap = el('div', 'dash-table-wrap');
        var tb = el('table', 'dash-table');
        var thead = el('thead');
        var tr = el('tr');
        columns.forEach(function (c) {
            var th = el('th', c.num ? 'num' : null);
            th.textContent = t(c.label);
            tr.appendChild(th);
        });
        thead.appendChild(tr);
        tb.appendChild(thead);
        var body = el('tbody');
        if (!rows.length) {
            var only = el('tr');
            var td = el('td');
            td.colSpan = columns.length;
            td.appendChild(el('div', 'dash-empty', 'Nothing here yet.'));
            only.appendChild(td);
            body.appendChild(only);
        }
        rows.forEach(function (row) {
            var r = el('tr');
            if (onOpen) {
                r.className = 'is-row';
                r.tabIndex = -1;
                r.addEventListener('click', function () { onOpen(row.data); });
            }
            row.cells.forEach(function (cell) {
                var td = el('td', cell.cls || null);
                if (cell.node) td.appendChild(cell.node);
                else td.textContent = cell.text == null ? '' : cell.text;
                r.appendChild(td);
            });
            body.appendChild(r);
        });
        tb.appendChild(body);
        wrap.appendChild(tb);
        return wrap;
    }
    function facts(pairs) {
        var dl = el('dl', 'dash-facts');
        pairs.forEach(function (p) {
            if (p[1] == null || p[1] === '') return;
            var row = el('div');
            row.appendChild(el('dt', null, p[0]));
            var dd = el('dd');
            if (p[2] === 'mono') dd.className = 'dash-mono';
            dd.textContent = p[1];
            row.appendChild(dd);
            dl.appendChild(row);
        });
        return dl;
    }

    function segmented(options, current, onPick) {
        var wrap = el('div', 'dash-seg');
        options.forEach(function (o) {
            var b = el('button');
            b.type = 'button';
            b.textContent = t(o.label);
            if (o.count != null) {
                var n = el('span', 'dash-seg-n');
                n.textContent = String(o.count);
                b.appendChild(n);
            }
            if (o.key === current) b.classList.add('is-on');
            b.addEventListener('click', function () { onPick(o.key); });
            wrap.appendChild(b);
        });
        return wrap;
    }
    function trend(now, before) {
        var d = before ? Math.round(((now - before) / before) * 100) : 0;
        var kind = d > 2 ? 'up' : (d < -2 ? 'down' : 'flat');
        var n = el('span', 'dash-trend dash-trend-' + kind);
        n.textContent = (d > 0 ? '+' : '') + d + '%';
        return n;
    }
    function sparkline(points, w, h) {
        var max = Math.max.apply(null, points) || 1;
        var step = w / Math.max(1, points.length - 1);
        var line = points.map(function (v, i) {
            return (i ? 'L' : 'M') + (i * step).toFixed(1) + ' ' + (h - (v / max) * (h - 6) - 3).toFixed(1);
        }).join(' ');
        var area = line + ' L' + w.toFixed(1) + ' ' + h + ' L0 ' + h + ' Z';
        var last = { x: w, y: h - (points[points.length - 1] / max) * (h - 6) - 3 };
        var svg = '<svg class="dash-spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">' +
            '<defs>' +
            '<linearGradient id="dashGrad" x1="0" y1="0" x2="1" y2="0">' +
            '<stop offset="0%" stop-color="#00d5ff"/><stop offset="55%" stop-color="#7b6cff"/><stop offset="100%" stop-color="#b14cff"/>' +
            '</linearGradient>' +
            '<linearGradient id="dashFade" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="rgba(123,108,255,0.18)"/><stop offset="100%" stop-color="rgba(123,108,255,0)"/>' +
            '</linearGradient>' +
            '</defs>' +
            '<path class="area" d="' + area + '"/><path class="line" d="' + line + '"/>' +
            '<circle cx="' + last.x.toFixed(1) + '" cy="' + last.y.toFixed(1) + '" r="2.6"/></svg>';
        var box = el('div');
        box.innerHTML = svg;
        return box;
    }
    function copyButton(text) {
        var b = el('button', 'dash-copy');
        b.type = 'button';
        b.setAttribute('aria-label', t('Copy'));
        b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
            'stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5"/>' +
            '<path d="M15 6.5V5.5A2.5 2.5 0 0 0 12.5 3H5.5A2.5 2.5 0 0 0 3 5.5v7A2.5 2.5 0 0 0 5.5 15h1"/></svg>';
        b.addEventListener('click', function (e) {
            e.stopPropagation();
            try {
                navigator.clipboard.writeText(text).then(function () { toast(t('Copied')); });
            } catch (err) {  }
        });
        return b;
    }
    var toastEl = null;
    var toastTimer = null;
    function toast(message) {
        if (!toastEl) {
            toastEl = el('div', 'dash-toast');
            toastEl.setAttribute('role', 'status');
            document.body.appendChild(toastEl);
        }
        toastEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
            'stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7"/></svg>';
        toastEl.appendChild(document.createTextNode(message));
        toastEl.classList.add('is-on');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, 2600);
    }
    function footRow(shown, total, label) {
        var f = el('div', 'dash-foot');
        f.textContent = t('Showing') + ' ' + shown + ' ' + t('of') + ' ' + total + ' ' + t(label);
        return f;
    }
    function crumbs(trail) {
        var c = el('div', 'dash-crumbs');
        trail.forEach(function (step, i) {
            if (i) c.appendChild(document.createTextNode('/'));
            if (step.route != null) {
                var a = el('a', null, step.label);
                a.href = '#/' + step.route;
                c.appendChild(a);
            } else {
                c.appendChild(el('span', null, step.label));
            }
        });
        return c;
    }
    function sampleChip() {
        var s = el('span', 'dash-sample');
        s.textContent = t('Sample data');
        return s;
    }
    var views = {};
    views[''] = function () {
        var page = el('div');
        var open = D.alerts.filter(function (a) { return a.state === 'open'; });
        var severe = open.filter(function (a) { return a.band === 'severe' || a.band === 'high'; });
        var series = D.series || [];
        var today = series.length ? series[series.length - 1].checks : 0;
        var yesterday = series.length > 1 ? series[series.length - 2].checks : 0;
        var week = series.slice(-7).reduce(function (n, x) { return n + x.checks; }, 0);
        var weekBefore = series.slice(-14, -7).reduce(function (n, x) { return n + x.checks; }, 0);
        page.appendChild(head('Overview',
            'Everything that needs a person, and nothing that does not.',
            [button('Run a check', 'primary', function () { focusSearch(); }, 'search')]));

        var stats = el('div', 'dash-grid dash-grid-3');
        [
            { n: num(open.length), label: t('Open alerts'),
              note: severe.length ? t('of those, high or worse') + ': ' + severe.length : t('nothing above medium'),
              tone: severe.length ? 'severe' : 'low' },
            { n: num(week), label: t('Checks this week'), note: t('yesterday') + ': ' + num(yesterday),
              trend: [week, weekBefore] },
            { n: num(D.watched.length), label: t('Addresses watched'), note: t('rechecked continuously') },
        ].forEach(function (x) {
            var c = card();
            var st = el('div', 'dash-stat');
            var top = el('div', 'dash-stat-top');
            top.appendChild(el('div', 'dash-stat-n', x.n));
            if (x.trend) top.appendChild(trend(x.trend[0], x.trend[1]));
            if (x.tone && x.tone !== 'low') top.appendChild(bandTag(x.tone));
            st.appendChild(top);
            st.appendChild(el('div', 'dash-stat-l', x.label));
            st.appendChild(el('div', 'dash-stat-d', x.note));
            c.appendChild(st);
            stats.appendChild(c);
        });
        page.appendChild(stats);
        var grid = el('div', 'dash-grid dash-grid-side dash-gap');
        var main = el('div');
        var attention = card('Needs your attention', open.length ? '' : t('All clear'));
        attention.appendChild(table(
            [{ label: 'Risk' }, { label: 'Subject' }, { label: 'Why' }, { label: 'When', num: true }],
            open.map(function (a) {
                return {
                    data: a,
                    cells: [
                        { node: bandTag(a.band) },
                        { text: short(a.subject), cls: 'mono' },
                        { text: a.summary },
                        { text: since(a.at), cls: 'num' },
                    ],
                };
            }),
            function (a) { go(a.screening ? 'screening/' + a.screening : 'alerts'); }
        ));
        main.appendChild(attention);
        var chart = card('Checks', t('last 30 days') + ' · ' + t('today') + ': ' + num(today));
        chart.appendChild(sparkline(series.map(function (x) { return x.checks; }), 600, 46));
        main.appendChild(chart);
        var mix = card('How this month came out', t('by risk band'));
        var total = (D.riskMix || []).reduce(function (n, x) { return n + x.count; }, 0) || 1;
        var bar = el('div', 'dash-mix');
        var key = el('div', 'dash-mix-key');
        (D.riskMix || []).forEach(function (m) {
            var seg = document.createElement('span');
            seg.style.width = ((m.count / total) * 100).toFixed(1) + '%';
            seg.style.background = toneColour(m.band);
            seg.title = bandName(m.band) + ' ' + m.count;
            bar.appendChild(seg);
            var k = el('div');
            var dot = document.createElement('i');
            dot.style.background = toneColour(m.band);
            k.appendChild(dot);
            k.appendChild(document.createTextNode(bandName(m.band) + ' '));
            var b = document.createElement('b');
            b.textContent = num(m.count);
            k.appendChild(b);
            key.appendChild(k);
        });
        mix.appendChild(bar);
        mix.appendChild(key);
        main.appendChild(mix);
        grid.appendChild(main);
        var side = el('div');
        var recent = card('Recent checks');
        recent.appendChild(table(
            [{ label: 'Subject' }, { label: 'Risk' }],
            D.screenings.slice(0, 5).map(function (sc) {
                return {
                    data: sc,
                    cells: [
                        { text: short(sc.subject), cls: 'mono' },
                        { node: bandTag(sc.band) },
                    ],
                };
            }),
            function (sc) { go('screening/' + sc.id); }
        ));
        side.appendChild(recent);
        var lists = card('Sanctions lists', t('checked before every screening'));
        var ul = el('dl', 'dash-facts');
        D.policy.lists.forEach(function (l) {
            var row = el('div');
            row.appendChild(el('dt', null, l.name));
            var dd = el('dd');
            dd.textContent = since(l.updated);
            row.appendChild(dd);
            ul.appendChild(row);
        });
        lists.appendChild(ul);
        side.appendChild(lists);
        grid.appendChild(side);
        page.appendChild(grid);
        return page;
    };
    views.screenings = function (filter) {
        var page = el('div');
        var all = D.screenings;
        var counts = {
            all: all.length,
            undecided: all.filter(function (x) { return !x.decision; }).length,
            flagged: all.filter(function (x) { return x.band === 'severe' || x.band === 'high'; }).length,
        };
        var which = ['undecided', 'flagged'].indexOf(filter) === -1 ? 'all' : filter;
        var rows = all.filter(function (x) {
            if (which === 'undecided') return !x.decision;
            if (which === 'flagged') return x.band === 'severe' || x.band === 'high';
            return true;
        });
        page.appendChild(head('Screenings', 'Every check this account has run, newest first.', [
            segmented([
                { key: 'all', label: 'All', count: counts.all },
                { key: 'undecided', label: 'Undecided', count: counts.undecided },
                { key: 'flagged', label: 'Flagged', count: counts.flagged },
            ], which, function (k) { go('screenings/' + k); }),
        ]));
        var c = card();
        c.appendChild(table(
            [{ label: 'Subject' }, { label: 'Chain' }, { label: 'Risk' }, { label: 'Decision' }, { label: 'By' }, { label: 'When', num: true }],
            rows.map(function (sc) {
                return {
                    data: sc,
                    cells: [
                        { text: short(sc.subject), cls: 'mono' },
                        { node: (function () { var n = el('span', 'dash-tag'); n.textContent = sc.chain; return n; })() },
                        { node: bandTag(sc.band) },
                        { text: decisionWord(sc.decision) },
                        { text: sc.by },
                        { text: since(sc.at), cls: 'num' },
                    ],
                };
            }),
            function (sc) { go('screening/' + sc.id); }
        ));
        c.appendChild(footRow(rows.length, all.length, 'checks'));
        page.appendChild(c);
        page.appendChild(keyboardHelp());
        return page;
    };
    views.screening = function (id) {
        var s = D.byId(id);
        var page = el('div');
        if (!s) {
            page.appendChild(head('Screening', 'That check is not in this account.'));
            return page;
        }
        page.appendChild(crumbs([
            { label: t('Screenings'), route: 'screenings' },
            { label: short(s.subject) },
        ]));
        page.appendChild(head('Screening',
            s.chain + ' · ' + t('run') + ' ' + since(s.at) + ' · ' + t('by') + ' ' + s.by, [
                button('Download report', null, function () { window.print(); }, 'download'),
            ]));
        var ph = el('div', 'dash-print-head');
        ph.innerHTML = '<h1>' + esc(t('Screening report')) + '</h1><p>Sentinelpay · ' +
            esc(when(s.at, true)) + ' · ' + esc(t('Reference')) + ' ' + esc(s.id) + '</p>';
        page.appendChild(ph);
        var verdict = card();
        verdict.classList.add('dash-verdict');
        var top = el('div', 'dash-verdict-top');
        top.appendChild(bandTag(s.band));
        var chainTag = el('span', 'dash-tag');
        chainTag.textContent = s.chain;
        top.appendChild(chainTag);
        top.appendChild(el('span', 'dash-verdict-subject', s.subject));
        top.appendChild(copyButton(s.subject));
        top.appendChild(sampleChip());
        verdict.appendChild(top);
        verdict.appendChild(el('p', 'dash-verdict-line', s.verdict));
        var acts = el('div', 'dash-verdict-acts');
        var decided = el('span', 'dash-tiny dash-muted');

        function setDecision(d) {
            if (!d) {
                s.decision = null;
                s.reason = '';
                s.secondApproval = null;
                paint();
                return;
            }
            askReason(d, function (reason) {
                s.decision = d;
                s.reason = reason;
                s.decidedBy = me.name;
                s.decidedAt = new Date().toISOString();

                s.secondApproval = null;
                paint();
                toast(needsTwo(s) ? t('Waiting for a second approval') : t('Decision recorded') + ': ' + decisionWord(d));
            });
        }
        function needsTwo(sc) {
            return sc.band === 'severe' && sc.decision === 'approved' && !sc.secondApproval;
        }
        function paint() {
            acts.textContent = '';
            if (s.decision) {
                var line = decisionWord(s.decision) + ' · ' + t('by') + ' ' +
                    (s.decidedBy || s.by) + ' · ' + since(s.decidedAt || s.at);
                decided.textContent = line;
                acts.appendChild(decided);
                if (needsTwo(s)) {
                    var wait = el('span', 'dash-pill-warn');
                    wait.textContent = t('Waiting for a second approval');
                    acts.appendChild(wait);
                    acts.appendChild(button('Approve as the second pair of eyes', null, function () {
                        s.secondApproval = { by: anotherApprover(), at: new Date().toISOString() };
                        paint();
                        toast(t('Released. Two people signed this.'));
                    }, 'shield'));
                }
                acts.appendChild(button('Change the decision', null, function () { setDecision(null); }));
            } else {
                var ok = button('Approve', 'good', function () { setDecision('approved'); }, 'check');
                var no = button('Reject', 'danger', function () { setDecision('rejected'); }, 'x');
                var up = button('Escalate', null, function () { setDecision('escalated'); }, 'up');
                ok.appendChild(document.createElement('kbd')).textContent = 'A';
                no.appendChild(document.createElement('kbd')).textContent = 'R';
                up.appendChild(document.createElement('kbd')).textContent = 'E';
                acts.appendChild(ok); acts.appendChild(no); acts.appendChild(up);
            }
            acts.appendChild(button('Download report', null, function () { window.print(); }, 'download'));
        }
        paint();
        verdict.appendChild(acts);
        page.appendChild(verdict);
        var grid = el('div', 'dash-grid dash-grid-side dash-gap');
        var main = el('div');
        var why = card('Why this rating');
        s.reasons.forEach(function (r) {
            var row = el('div', 'dash-reason');
            row.appendChild(el('div', 'dash-reason-dot ' + r.weight));
            var body = el('div');
            body.appendChild(el('p', 'dash-reason-t', r.title));
            body.appendChild(el('p', 'dash-reason-d', r.detail));
            var src = el('p', 'dash-reason-s');
            src.textContent = t('Source') + ': ' + r.source;
            if (r.evidence) {
                src.appendChild(document.createTextNode(' · '));
                var a = el('a', null, 'See the transaction');
                a.href = '#/screening/' + s.id;
                src.appendChild(a);
            }
            body.appendChild(src);
            row.appendChild(body);
            why.appendChild(row);
        });
        main.appendChild(why);
        var expo = card('Where the money came from', t('share of everything received'));
        var bar = el('div', 'dash-expo');
        var key = el('div', 'dash-expo-key');
        s.exposure.forEach(function (e) {
            var seg = document.createElement('span');
            seg.style.width = e.share + '%';
            seg.style.background = toneColour(catTone(e.key));
            seg.title = catLabel(e.key) + ' ' + e.share + '%';
            bar.appendChild(seg);
            var k = el('div');
            var dot = document.createElement('i');
            dot.style.background = toneColour(catTone(e.key));
            k.appendChild(dot);
            k.appendChild(document.createTextNode(catLabel(e.key) + ' '));
            var b = document.createElement('b');
            b.textContent = e.share + '%';
            k.appendChild(b);
            key.appendChild(k);
        });
        expo.appendChild(bar);
        expo.appendChild(key);
        main.appendChild(expo);
        if (s.path && s.path.length) {
            var pathCard = card('How it reached this address', t('shortest path we found'));
            s.path.forEach(function (h) {
                var row = el('div', 'dash-hop');
                var mark = el('div', 'dash-hop-mark ' + (h.tone || ''));
                mark.textContent = String(h.hop);
                row.appendChild(mark);
                var body = el('div');
                body.appendChild(el('div', 'dash-hop-t', h.label));
                body.appendChild(el('div', 'dash-hop-r', h.ref));
                body.appendChild(el('div', 'dash-hop-n', h.note));
                row.appendChild(body);
                var right = el('div', 'dash-hop-a');
                right.appendChild(el('div', null, h.amount));
                right.appendChild(el('div', 'dash-hop-n', since(h.at)));
                row.appendChild(right);
                pathCard.appendChild(row);
            });
            main.appendChild(pathCard);
        }
        var txCard = card('Transactions behind this', t('the ones the findings rest on'));
        txCard.appendChild(table(
            [{ label: 'Direction' }, { label: 'Amount', num: true }, { label: 'Counterparty' }, { label: 'Category' }, { label: 'When', num: true }],
            s.transactions.map(function (x) {
                return {
                    data: x,
                    cells: [
                        { text: x.dir === 'in' ? t('Received') : t('Sent') },
                        { text: x.amount, cls: 'num' },
                        { text: short(x.from), cls: 'mono' },
                        { text: catLabel(x.tag) },
                        { text: since(x.at), cls: 'num' },
                    ],
                };
            })
        ));
        main.appendChild(txCard);
        grid.appendChild(main);
        var side = el('div');
        var about = card('The address');
        about.appendChild(facts([
            [t('Chain'), s.chain],
            [t('Asset'), s.asset],
            [t('Balance'), s.balance],
            [t('Transactions'), num(s.txCount)],
            [t('Counterparties'), num(s.counterparties)],
            [t('First seen'), when(s.firstSeen)],
            [t('Last seen'), when(s.lastSeen)],
        ]));
        side.appendChild(about);
        var meta = card('This check');
        meta.appendChild(facts([
            [t('Reference'), s.id],
            [t('Run by'), s.by],
            [t('Run at'), when(s.at, true)],
            [t('Risk'), bandName(s.band)],
            [t('Decision'), decisionWord(s.decision)],
            [t('Decided by'), s.decision ? (s.decidedBy || s.by) : ''],
            [t('Second approval'), s.secondApproval ? s.secondApproval.by : ''],
        ]));
        if (s.reason) {
            var why2 = el('div', 'dash-note dash-gap');
            why2.appendChild(el('div', 'dash-note-t', 'Reason given'));
            why2.appendChild(el('div', 'dash-note-d', s.reason));
            meta.appendChild(why2);
        }
        side.appendChild(meta);
        if (s.evidence) {
            var ev = card('Evidence', t('sealed when this check ran'));
            ev.appendChild(facts(
                s.evidence.lists.map(function (l) {
                    return [l.name, when(l.version, true)];
                }).concat([
                    [t('Hops searched'), String(s.evidence.hops)],
                    [t('Block'), num(s.evidence.chainTip)],
                ])
            ));
            var digest = el('div', 'dash-seal');
            digest.appendChild(el('div', 'dash-seal-l', 'Verification code'));
            var code = el('div', 'dash-seal-c');
            code.textContent = s.evidence.hash.replace(/(.{4})/g, '$1 ').trim().toUpperCase();
            digest.appendChild(code);
            digest.appendChild(el('div', 'dash-seal-d',
                'Anybody holding the report can check this against our record. If one number in it changed, the code will not match.'));
            ev.appendChild(digest);
            side.appendChild(ev);
        }
        if (s.changedSince && s.changedSince.length) {
            var ch = card('Since this check ran', t('what we did not know at the time'));
            s.changedSince.forEach(function (c) {
                var row = el('div', 'dash-note');
                row.appendChild(el('div', 'dash-note-t', when(c.at)));
                row.appendChild(el('div', 'dash-note-d', c.what));
                ch.appendChild(row);
            });
            var again = el('div', 'dash-gap');
            again.appendChild(button('Run it again with today\'s data', null, function () {
                toast(t('Sample data: nothing is re-run yet.'));
            }, 'clock'));
            ch.appendChild(again);
            side.appendChild(ch);
        }
        grid.appendChild(side);
        page.appendChild(grid);
        page.__keys = function (e) {
            if (s.decision) return;
            var k = e.key.toLowerCase();
            if (k === 'a') { setDecision('approved'); return true; }
            if (k === 'r') { setDecision('rejected'); return true; }
            if (k === 'e') { setDecision('escalated'); return true; }
            return false;
        };
        return page;
    };
    views.alerts = function (filter) {
        var page = el('div');
        var all = D.alerts;
        var which = ['open', 'closed'].indexOf(filter) === -1 ? 'all' : filter;
        var rows = all.filter(function (a) {
            if (which === 'open') return a.state === 'open';
            if (which === 'closed') return a.state === 'closed';
            return true;
        });
        page.appendChild(head('Alerts',
            'What monitoring found while nobody was looking. Every alert says which rule produced it.', [
                segmented([
                    { key: 'all', label: 'All', count: all.length },
                    { key: 'open', label: 'Open', count: all.filter(function (a) { return a.state === 'open'; }).length },
                    { key: 'closed', label: 'Closed', count: all.filter(function (a) { return a.state === 'closed'; }).length },
                ], which, function (k) { go('alerts/' + k); }),
            ]));
        var c = card();
        c.appendChild(table(
            [{ label: 'Risk' }, { label: 'Subject' }, { label: 'Rule' }, { label: 'What happened' }, { label: 'State' }, { label: 'When', num: true }],
            rows.map(function (a) {
                return {
                    data: a,
                    cells: [
                        { node: bandTag(a.band) },
                        { text: short(a.subject), cls: 'mono' },
                        { text: a.rule },
                        { text: a.summary },
                        { text: a.state === 'open' ? t('Open') : (a.state === 'closed' ? t('Closed') : t('Acknowledged')) },
                        { text: since(a.at), cls: 'num' },
                    ],
                };
            }),
            function (a) { if (a.screening) go('screening/' + a.screening); }
        ));
        c.appendChild(footRow(rows.length, all.length, 'alerts'));
        page.appendChild(c);
        page.appendChild(keyboardHelp());
        return page;
    };
    views.monitoring = function (arg) {
        if (arg === 'connect') return views.connect();
        var page = el('div');
        page.appendChild(head('Monitoring',
            'What we watch, where it came from, and the rules that decide when you hear about it.',
            [button('Connect a wallet', 'primary', function () { go('monitoring/connect'); }, 'eye')]));
        var sources = card('Wallet sources', t('one paste, and it keeps deriving'));
        sources.appendChild(table(
            [{ label: 'Source' }, { label: 'Kind' }, { label: 'Chain' }, { label: 'Addresses', num: true },
             { label: 'Risk' }, { label: 'State' }, { label: 'Last scan', num: true }],
            D.sources.map(function (src) {
                var kind = el('span', 'dash-tag');
                kind.textContent = src.kind === 'xpub' ? t('Extended key')
                    : (src.kind === 'exchange' ? t('Exchange key') : t('Address list'));
                var state;
                if (src.state === 'backfilling') {
                    state = el('span', 'dash-row');
                    var dot = el('span', 'dash-dot-live');
                    state.appendChild(dot);
                    state.appendChild(document.createTextNode(t('Reading history') + ' ' + src.backfill));
                } else {
                    state = el('span', 'dash-band dash-band-low');
                    state.textContent = t('Live');
                }
                return {
                    data: src,
                    cells: [
                        { node: (function () {
                            var w = el('div');
                            w.appendChild(el('div', null, src.label));
                            if (src.fingerprint) {
                                var f = el('div', 'dash-tiny dash-muted dash-mono');
                                f.textContent = src.fingerprint + (src.path ? ' · ' + src.path : '');
                                w.appendChild(f);
                            }
                            return w;
                        })() },
                        { node: kind },
                        { text: src.chain },
                        { text: num(src.derived), cls: 'num' },
                        { node: src.band ? bandTag(src.band) : el('span', 'dash-muted', '—') },
                        { node: state },
                        { text: since(src.lastScan), cls: 'num' },
                    ],
                };
            })
        ));
        page.appendChild(sources);
        var watched = card('Addresses', t('derived from the sources above'));
        watched.appendChild(table(
            [{ label: 'Label' }, { label: 'Address' }, { label: 'Chain' }, { label: 'Risk' }, { label: 'Rules', num: true }, { label: 'Last check', num: true }],
            D.watched.map(function (w) {
                return {
                    data: w,
                    cells: [
                        { text: w.label },
                        { text: short(w.address), cls: 'mono' },
                        { text: w.chain },
                        { node: bandTag(w.band) },
                        { text: String(w.rules), cls: 'num' },
                        { text: since(w.lastCheck), cls: 'num' },
                    ],
                };
            })
        ));
        page.appendChild(watched);
        var rules = card('Rules', t('written the way they will be read back to an auditor'));
        D.rules.forEach(function (r) {
            var row = el('div', 'dash-rule');
            var sw = el('button', 'dash-switch' + (r.on ? ' is-on' : ''));
            sw.type = 'button';
            sw.setAttribute('aria-label', t('Turn this rule on or off'));
            sw.addEventListener('click', function () {
                r.on = !r.on;
                sw.classList.toggle('is-on', r.on);
                row.querySelector('.dash-rule-text').classList.toggle('dash-rule-off', !r.on);
                toast(r.on ? t('Rule is on') : t('Rule is off'));
            });
            row.appendChild(sw);
            var text = el('div', 'dash-rule-text' + (r.on ? '' : ' dash-rule-off'));
            text.appendChild(el('div', null, r.text));
            var meta = el('div', 'dash-tiny dash-muted');
            meta.textContent = t('Raises') + ': ' + bandName(r.band) + ' · ' + t('alerts this month') + ': ' + r.hits;
            text.appendChild(meta);
            row.appendChild(text);
            rules.appendChild(row);
        });
        page.appendChild(rules);
        return page;
    };
    views.connect = function () {
        var page = el('div');
        page.appendChild(crumbs([{ label: t('Monitoring'), route: 'monitoring' }, { label: t('Connect a wallet') }]));
        page.appendChild(head('Connect a wallet', 'Paste one thing. We derive the addresses and keep deriving as the wallet grows.'));
        var grid = el('div', 'dash-grid dash-grid-side');
        var main = el('div');
        [
            { kind: 'xpub', title: 'Extended public key', best: true,
              body: 'For Bitcoin and anything else with an address chain. Covers every address the wallet has used and every one it will use. It cannot move funds: it is a public key.',
              example: 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs' },
            { kind: 'addresses', title: 'A list of addresses',
              body: 'For account based chains where there is no address chain to derive, and for anything you keep by hand. One per line, any of the chains we cover.',
              example: '0x9A7c4F2b8E1d6c3A5b0F8e2D4c7A9b1E3f5C8d0A\n0x4D2f9b1A7c3E5d8F0b6A2c4E7d9B1f3A5c8E0d2B' },
            { kind: 'exchange', title: 'A read only key at your exchange or custodian',
              body: 'We read your deposit addresses and keep up as new ones are issued. Read only, no withdrawal permission, and we refuse a key that has one.',
              example: 'Kraken · Binance · Coinbase Prime · Fireblocks · BitGo' },
        ].forEach(function (opt) {
            var c = card();
            var h = el('div', 'dash-card-h');
            h.appendChild(el('span', null, opt.title));
            if (opt.best) {
                var b = el('span', 'dash-pill-good');
                b.textContent = t('Fastest');
                h.appendChild(b);
            }
            c.appendChild(h);
            c.appendChild(el('p', 'dash-muted', opt.body));
            var ex = el('pre', 'dash-pre');
            ex.textContent = opt.example;
            c.appendChild(ex);
            var act = el('div', 'dash-row dash-gap');
            act.appendChild(button('Use this', opt.best ? 'primary' : null, function () {
                toast(t('Sample data: nothing is connected yet.'));
            }));
            c.appendChild(act);
            main.appendChild(c);
        });
        grid.appendChild(main);
        var side = el('div');
        var safe = card('What happens to what you paste');
        [
            ['Encrypted before it is stored', 'AES-256-GCM, with the key held outside the database. A copy of the database is not a copy of your keys.'],
            ['Never written to a log', 'Not in an error, not in a trace, not in a support ticket.'],
            ['Watch only, always', 'An extended public key cannot sign. An exchange key with withdrawal permission is refused rather than used.'],
            ['Yours to remove', 'Delete a source and the key and every address derived from it go with it, the same hour.'],
        ].forEach(function (pair) {
            var row = el('div', 'dash-note');
            row.appendChild(el('div', 'dash-note-t', pair[0]));
            row.appendChild(el('div', 'dash-note-d', pair[1]));
            safe.appendChild(row);
        });
        side.appendChild(safe);
        var cov = card('What we can see', t('stated, not buried'));
        cov.appendChild(el('p', 'dash-tiny dash-muted', D.coverage.depthNote));
        var list = el('dl', 'dash-facts');
        D.coverage.chains.forEach(function (ch) {
            var row = el('div');
            row.appendChild(el('dt', null, ch.name));
            var dd = el('dd');
            dd.textContent = ch.depth === 'full' ? t('Full') : t('Partial');
            row.appendChild(dd);
            list.appendChild(row);
        });
        cov.appendChild(list);
        side.appendChild(cov);
        grid.appendChild(side);
        page.appendChild(grid);
        return page;
    };
    views.triage = function () {
        var page = el('div');
        var queue = D.alerts.filter(function (a) { return a.state === 'open'; });
        page.appendChild(head('Triage', 'One at a time, decided and gone. The queue is what monitoring found and nobody has answered yet.'));

        if (!queue.length) {
            var done = card();
            done.classList.add('dash-zero');
            done.innerHTML = '<div class="dash-zero-mark">' + icon('check') + '</div>';
            done.appendChild(el('h2', 'dash-zero-t', 'Nothing is waiting'));
            done.appendChild(el('p', 'dash-zero-d', 'Every alert has an answer on it. Monitoring is still running.'));
            page.appendChild(done);
            return page;
        }
        var at = 0;
        var body = el('div');
        page.appendChild(body);

        function draw() {
            body.textContent = '';
            var a = queue[at];
            if (!a) {
                body.appendChild(views.triage().firstChild);
                return;
            }
            var sc = a.screening ? D.byId(a.screening) : null;
            var bar = el('div', 'dash-queue-bar');
            bar.appendChild(el('span', null, t('In the queue') + ': ' + (at + 1) + ' / ' + queue.length));
            var prog = el('div', 'dash-queue-prog');
            var fill = el('div', 'dash-queue-fill');
            fill.style.width = ((at / queue.length) * 100) + '%';
            prog.appendChild(fill);
            bar.appendChild(prog);
            body.appendChild(bar);
            var c = card();
            c.classList.add('dash-verdict');
            var top = el('div', 'dash-verdict-top');
            top.appendChild(bandTag(a.band));
            var chain = el('span', 'dash-tag');
            chain.textContent = a.chain;
            top.appendChild(chain);
            top.appendChild(el('span', 'dash-verdict-subject', a.subject));
            top.appendChild(copyButton(a.subject));
            top.appendChild(sampleChip());
            c.appendChild(top);
            c.appendChild(el('p', 'dash-verdict-line', a.summary));
            var why = el('p', 'dash-tiny dash-muted');
            why.textContent = t('Raised by') + ': ' + a.rule + ' · ' + since(a.at);
            c.appendChild(why);

            if (sc) {
                var link = el('a', 'dash-link');
                link.href = '#/screening/' + sc.id;
                link.textContent = t('Open the full screening');
                var lw = el('p', 'dash-gap');
                lw.appendChild(link);
                c.appendChild(lw);
            }
            var acts = el('div', 'dash-verdict-acts dash-gap');
            [
                ['Approve', 'good', 'approved', 'check', 'A'],
                ['Reject', 'danger', 'rejected', 'x', 'R'],
                ['Escalate', null, 'escalated', 'up', 'E'],
            ].forEach(function (spec) {
                var b = button(spec[0], spec[1], function () { decide(a, spec[2]); }, spec[3]);
                var k = document.createElement('kbd');
                k.textContent = spec[4];
                b.appendChild(k);
                acts.appendChild(b);
            });
            acts.appendChild(button('Skip for now', null, function () { move(1); }));
            c.appendChild(acts);
            body.appendChild(c);
        }
        function move(by) {
            at = Math.max(0, Math.min(queue.length - 1, at + by));
            draw();
        }
        function decide(alert, value) {
            askReason(value, function (reason) {
                alert.state = 'closed';
                var sc = alert.screening ? D.byId(alert.screening) : null;
                if (sc) {
                    sc.decision = value;
                    sc.reason = reason;
                    sc.decidedBy = me.name;
                    sc.decidedAt = new Date().toISOString();
                }
                D.activity.unshift({ at: new Date().toISOString(), who: me.name,
                    what: decisionWord(value) + ' ' + short(alert.subject), kind: 'decision' });
                toast(t('Decision recorded') + ': ' + decisionWord(value));
                queue.splice(at, 1);
                if (at >= queue.length) at = Math.max(0, queue.length - 1);
                if (!queue.length) { render(); return; }
                draw();
                paintNav('triage');
            });
        }
        page.__keys = function (e) {
            var k = e.key.toLowerCase();
            if (k === 'a') { decide(queue[at], 'approved'); return true; }
            if (k === 'r') { decide(queue[at], 'rejected'); return true; }
            if (k === 'e') { decide(queue[at], 'escalated'); return true; }
            if (k === 'j' || e.key === 'ArrowDown') { move(1); return true; }
            if (k === 'k' || e.key === 'ArrowUp') { move(-1); return true; }
            return false;
        };
        draw();
        page.appendChild(keyboardHelp());
        return page;
    };

    function askReason(value, done) {
        var known = {
            approved: [
                'Counterparties are regulated venues.',
                'Source of funds confirmed with the customer.',
                'Exposure is below our policy threshold.',
            ],
            rejected: [
                'Exposure to a sanctioned address.',
                'Darknet exposure above the policy threshold.',
                'Customer could not explain the source of funds.',
            ],
            escalated: [
                'Needs a second opinion before we answer.',
                'Pattern repeats and is worth watching for a week.',
                'Legal should see this before the payment moves.',
            ],
        }[value] || [];
        var back = el('div', 'dash-modal-back');
        var box = el('div', 'dash-modal');
        box.appendChild(el('h2', 'dash-modal-t', decisionWord(value)));
        box.appendChild(el('p', 'dash-modal-d', 'One line on why. It goes in the record and it is what an auditor reads.'));
        var field = el('div', 'lp-demo-field lp-demo-field-full');
        var input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 160;
        input.placeholder = t('Why');
        field.appendChild(input);
        box.appendChild(field);
        var quick = el('div', 'dash-chips');
        known.forEach(function (text) {
            var b = el('button', 'dash-reason-chip');
            b.type = 'button';
            b.textContent = t(text);
            b.addEventListener('click', function () { input.value = t(text); input.focus(); });
            quick.appendChild(b);
        });
        box.appendChild(quick);
        var acts = el('div', 'dash-row dash-gap');
        var ok = button('Record it', 'primary', function () {
            var reason = input.value.trim();
            if (!reason) { input.focus(); return; }
            close();
            done(reason);
        });
        acts.appendChild(ok);
        acts.appendChild(button('Cancel', null, function () { close(); }));
        box.appendChild(acts);
        function close() {
            back.remove();
            document.removeEventListener('keydown', esc, true);
        }
        function esc(e) {
            if (e.key === 'Escape') { e.stopPropagation(); close(); }
            if (e.key === 'Enter' && document.activeElement === input) ok.click();
        }
        document.addEventListener('keydown', esc, true);
        back.addEventListener('click', function (e) { if (e.target === back) close(); });
        back.appendChild(box);
        document.body.appendChild(back);
        setTimeout(function () { input.focus(); }, 40);
    }

    views.cases = function () {
        var page = el('div');
        page.appendChild(head('Cases', 'An investigation is a case: what was found, who is on it, and what was decided.'));
        var c = card();
        c.appendChild(table(
            [{ label: 'Case' }, { label: 'Title' }, { label: 'Risk' }, { label: 'State' }, { label: 'Owner' }, { label: 'Items', num: true }, { label: 'Opened', num: true }],
            D.cases.map(function (k) {
                return {
                    data: k,
                    cells: [
                        { text: k.id, cls: 'mono' },
                        { text: k.title },
                        { node: bandTag(k.band) },
                        { text: k.state === 'open' ? t('Open') : (k.state === 'review' ? t('In review') : t('Closed')) },
                        { text: k.owner },
                        { text: String(k.items), cls: 'num' },
                        { text: since(k.opened), cls: 'num' },
                    ],
                };
            })
        ));
        page.appendChild(c);
        return page;
    };
    views.policy = function () {
        var page = el('div');
        page.appendChild(head('Policy',
            'What this company treats as acceptable. It is a document as much as a setting: export it and it is the annex your bank asks for.',
            [button('Export the policy', null, function () { window.print(); }, 'download')]));
        var meta = card();
        meta.appendChild(facts([
            [t('Version'), String(D.policy.version)],
            [t('Last changed'), when(D.policy.updated, true)],
            [t('Changed by'), D.policy.by],
            [t('Jurisdictions'), D.policy.jurisdictions.join(', ')],
        ]));
        page.appendChild(meta);
        var thresholds = card('Thresholds');
        thresholds.appendChild(table(
            [{ label: 'Finding' }, { label: 'Level' }, { label: 'What happens' }],
            D.policy.thresholds.map(function (x) {
                return {
                    data: x,
                    cells: [
                        { text: x.label },
                        { text: x.value },
                        { text: x.action === 'block' ? t('Block the payment') : (x.action === 'review' ? t('Hold for review') : t('Allow')) },
                    ],
                };
            })
        ));
        page.appendChild(thresholds);

        var sim = card('If you changed a threshold', t('measured against') + ' ' + t(D.simulation.window));
        sim.appendChild(el('p', 'dash-tiny dash-muted',
            t('Today') + ': ' + num(D.simulation.current.blocked) + ' ' + t('blocked') + ', ' +
            num(D.simulation.current.held) + ' ' + t('held for review') + ', ' +
            num(D.simulation.current.allowed) + ' ' + t('allowed')));
        D.simulation.proposals.forEach(function (pr) {
            var row = el('div', 'dash-sim');
            var headRow = el('div', 'dash-sim-h');
            headRow.appendChild(el('b', null, pr.label));
            var move = el('span', 'dash-sim-move');
            move.textContent = pr.from + '  →  ' + pr.to;
            headRow.appendChild(move);
            var delta = el('span', 'dash-trend ' + (pr.wouldCatch > 0 ? 'dash-trend-down' : 'dash-trend-up'));
            delta.textContent = (pr.wouldCatch > 0 ? '+' : '') + pr.wouldCatch + ' ' + t('held');
            headRow.appendChild(delta);
            row.appendChild(headRow);
            row.appendChild(el('div', 'dash-sim-note', pr.note));
            var act = el('div', 'dash-row');
            act.appendChild(button('Apply this', null, function () {
                toast(t('Sample data: the policy is not changed.'));
            }));
            act.appendChild(button('See the payments', null, function () { go('screenings'); }));
            row.appendChild(act);
            sim.appendChild(row);
        });
        page.appendChild(sim);
        var approvals = card('Who may approve what');
        approvals.appendChild(table(
            [{ label: 'Action' }, { label: 'Approval needed' }],
            D.policy.approvals.map(function (a) {
                return { data: a, cells: [{ text: a.what }, { text: a.who }] };
            })
        ));
        page.appendChild(approvals);
        var cov = card('What we can see', t('stated, not buried'));
        cov.appendChild(el('p', 'dash-tiny dash-muted', D.coverage.depthNote));
        cov.appendChild(table(
            [{ label: 'Chain' }, { label: 'Depth' }, { label: 'What that means' }],
            D.coverage.chains.map(function (ch) {
                var pill = el('span', 'dash-band dash-band-' + (ch.depth === 'full' ? 'low' : 'medium'));
                pill.textContent = ch.depth === 'full' ? t('Full') : t('Partial');
                return { data: ch, cells: [{ text: ch.name }, { node: pill }, { text: t(ch.note) }] };
            })
        ));
        page.appendChild(cov);
        var lists = card('Lists we check against');
        lists.appendChild(table(
            [{ label: 'List' }, { label: 'Last updated', num: true }],
            D.policy.lists.map(function (l) {
                return { data: l, cells: [{ text: l.name }, { text: since(l.updated), cls: 'num' }] };
            })
        ));
        page.appendChild(lists);
        return page;
    };
    views.reports = function () {
        var page = el('div');
        page.appendChild(head('Reports', 'One document per month: what was checked, what was flagged, what was stopped.'));
        var c = card();
        c.appendChild(table(
            [{ label: 'Report' }, { label: 'Checks', num: true }, { label: 'Flagged', num: true }, { label: 'Blocked', num: true }, { label: 'Made', num: true }, { label: '' }],
            D.reports.map(function (r) {
                var dl = button('Download', null, function () { window.print(); }, 'download');
                return {
                    data: r,
                    cells: [
                        { text: r.title },
                        { text: num(r.checks), cls: 'num' },
                        { text: num(r.flagged), cls: 'num' },
                        { text: num(r.blocked), cls: 'num' },
                        { text: since(r.made), cls: 'num' },
                        { node: dl, cls: 'dash-right' },
                    ],
                };
            })
        ));
        page.appendChild(c);
        return page;
    };
    views.activity = function () {
        var page = el('div');
        page.appendChild(head('Activity', 'Who did what, and when. This is the record an auditor asks for.'));
        var c = card();
        c.appendChild(table(
            [{ label: 'When', num: true }, { label: 'Who' }, { label: 'What' }],
            D.activity.map(function (a) {
                return {
                    data: a,
                    cells: [
                        { text: when(a.at, true), cls: 'num' },
                        { text: a.who },
                        { text: a.what },
                    ],
                };
            })
        ));
        page.appendChild(c);
        return page;
    };
    views.api = function () {
        var page = el('div');
        page.appendChild(head('API keys', 'Screen an address from your own code. The answer is the same one this dashboard shows.'));
        var keys = card('Keys');
        keys.appendChild(table(
            [{ label: 'Label' }, { label: 'Key' }, { label: 'Calls', num: true }, { label: 'Last used', num: true }],
            D.keys.map(function (k) {
                return {
                    data: k,
                    cells: [
                        { text: k.label },
                        { text: k.prefix + '…', cls: 'mono' },
                        { text: num(k.calls), cls: 'num' },
                        { text: since(k.lastUsed), cls: 'num' },
                    ],
                };
            })
        ));
        page.appendChild(keys);
        var ex = card('One call');
        var pre = document.createElement('pre');
        pre.className = 'dash-mono';
        pre.style.cssText = 'margin:0;padding:0.9rem 1rem;background:rgba(14,35,88,0.04);border-radius:10px;overflow-x:auto;line-height:1.7;';
        pre.textContent =
            'curl https://api.sentinelpay.org/v1/screen \\\n' +
            '  -H "Authorization: Bearer sp_live_…" \\\n' +
            '  -d \'{"chain":"ethereum","address":"0x9A7c…8d0A"}\'';
        ex.appendChild(pre);
        ex.appendChild(el('p', 'dash-tiny dash-muted dash-gap',
            'The answer carries the band, the reasons and the evidence, in the same shape as this screen.'));
        page.appendChild(ex);
        return page;
    };
    views.team = function () {
        var page = el('div');
        page.appendChild(head('Team', 'Who can see this account, and what they can do.'));
        var c = card();
        c.appendChild(table(
            [{ label: 'Name' }, { label: 'Role' }, { label: 'Email' }, { label: 'Two-factor' }, { label: 'Last seen', num: true }],
            D.team.map(function (m) {
                return {
                    data: m,
                    cells: [
                        { text: m.name },
                        { text: m.role },
                        { text: m.email },
                        { text: m.twofa ? t('On') : t('Off') },
                        { text: since(m.last), cls: 'num' },
                    ],
                };
            })
        ));
        page.appendChild(c);
        return page;
    };
    views.settings = function () {
        var page = el('div');
        page.appendChild(head('Settings', 'Your account, and the way you get into it.'));
        var real = document.getElementById('dash-settings');
        if (real) {
            real.hidden = false;
            page.appendChild(real);
        }
        return page;
    };
    function keyboardHelp() {
        var d = el('div', 'dash-kbd-help');
        d.innerHTML =
            '<span><kbd>/</kbd>' + esc(t('search')) + '</span>' +
            '<span><kbd>j</kbd><kbd>k</kbd>' + esc(t('move')) + '</span>' +
            '<span><kbd>↵</kbd>' + esc(t('open')) + '</span>' +
            '<span><kbd>a</kbd><kbd>r</kbd><kbd>e</kbd>' + esc(t('decide')) + '</span>';
        return d;
    }

    function palette() {
        var back = el('div', 'dash-modal-back dash-modal-top');
        var box = el('div', 'dash-palette');
        var field = el('div', 'dash-palette-field');
        field.innerHTML = icon('search');
        var input = document.createElement('input');
        input.type = 'text';
        input.placeholder = t('Go to a screen, or paste an address');
        input.setAttribute('aria-label', t('Go to a screen, or paste an address'));
        field.appendChild(input);
        box.appendChild(field);
        var list = el('div', 'dash-palette-list');
        box.appendChild(list);
        var items = [];
        NAV.forEach(function (g) {
            g.items.forEach(function (it) {
                items.push({ label: t(it.label), hint: t(g.group), icon: it.icon, go: it.route });
            });
        });
        items.push({ label: t('Connect a wallet'), hint: t('Monitoring'), icon: 'eye', go: 'monitoring/connect' });
        D.screenings.slice(0, 6).forEach(function (sc) {
            items.push({ label: short(sc.subject), hint: sc.chain + ' · ' + bandName(sc.band), icon: 'search', go: 'screening/' + sc.id });
        });
        var shown = items.slice();
        var at = 0;
        function draw() {
            list.textContent = '';
            shown.slice(0, 8).forEach(function (it, i) {
                var row = el('button', 'dash-palette-row' + (i === at ? ' is-on' : ''));
                row.type = 'button';
                row.innerHTML = icon(it.icon || 'search');
                var label = el('span', 'dash-palette-l');
                label.textContent = it.label;
                row.appendChild(label);
                var hint = el('span', 'dash-palette-h');
                hint.textContent = it.hint || '';
                row.appendChild(hint);
                row.addEventListener('click', function () { close(); go(it.go); });
                list.appendChild(row);
            });
            if (!shown.length) {
                var none = el('div', 'dash-palette-none');
                none.textContent = t('Nothing matches. Press enter to screen it as an address.');
                list.appendChild(none);
            }
        }
        function filter() {
            var q = input.value.trim().toLowerCase();
            shown = !q ? items.slice() : items.filter(function (it) {
                return (it.label + ' ' + (it.hint || '')).toLowerCase().indexOf(q) !== -1;
            });
            at = 0;
            draw();
        }
        input.addEventListener('input', filter);
        input.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowDown') { e.preventDefault(); at = Math.min(at + 1, Math.min(shown.length, 8) - 1); draw(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); at = Math.max(at - 1, 0); draw(); }
            else if (e.key === 'Enter') {
                e.preventDefault();
                if (shown[at]) { close(); go(shown[at].go); return; }
                var q = input.value.trim();
                if (!q) return;
                var hit = D.find(q);
                close();
                if (hit) go('screening/' + hit.id);
            } else if (e.key === 'Escape') { close(); }
        });
        function close() {
            back.remove();
            document.removeEventListener('keydown', esc, true);
        }
        function esc(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
        document.addEventListener('keydown', esc, true);
        back.addEventListener('click', function (e) { if (e.target === back) close(); });
        back.appendChild(box);
        document.body.appendChild(back);
        draw();
        setTimeout(function () { input.focus(); }, 30);
    }

    var ENT = null;

    function api(path, opts) {
        var o = opts || {};
        return fetch(path, {
            method: o.method || 'GET',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: o.body ? JSON.stringify(o.body) : undefined
        }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (j) {
                return { status: r.status, ok: r.ok, body: j };
            });
        });
    }

    function loadEntitlement() {
        return api('/v1/entitlement').then(function (r) {
            ENT = r.ok ? r.body : null;
            return ENT;
        }).catch(function () { ENT = null; return null; });
    }

    function listDateText(raw) {
        if (!raw) return '';
        var p = String(raw).split('/');
        if (p.length !== 3) return raw;
        var d = new Date(Number(p[2]), Number(p[0]) - 1, Number(p[1]));
        if (isNaN(d.getTime())) return raw;
        try {
            return d.toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' });
        } catch (err) {
            return raw;
        }
    }

    function coverageLine() {
        var c = (ENT && ENT.coverage) || {};
        var box = el('p', 'dash-start-cov');
        if (!c.addresses) {
            box.textContent = t('The sanctions list has not loaded yet.');
            return box;
        }
        box.textContent = t('Checked against') + ' ' + num(c.addresses) + ' ' +
            t('sanctioned addresses from the OFAC list published') + ' ' + listDateText(c.listDate) + '.';
        return box;
    }

    function stepRow(n, title, note, state) {
        var row = el('div', 'dash-step dash-step-' + state);
        var mark = el('div', 'dash-step-n');
        mark.textContent = state === 'done' ? '✓' : String(n);
        var body = el('div', 'dash-step-b');
        body.appendChild(el('div', 'dash-step-t', title));
        if (note) body.appendChild(el('div', 'dash-step-note', note));
        row.appendChild(mark);
        row.appendChild(body);
        return row;
    }

    function verdictCard(result) {
        var wrap = el('div', 'dash-result dash-result-' + (result.verdict || 'clear'));
        var top = el('div', 'dash-result-top');
        top.appendChild(el('span', 'dash-result-v',
            result.verdict === 'severe' ? 'Sanctioned' : 'No sanctions match'));
        if (result.chain) top.appendChild(el('span', 'dash-result-chain', result.chain));
        wrap.appendChild(top);

        var addr = el('div', 'dash-result-addr');
        addr.textContent = result.address;
        wrap.appendChild(addr);

        (result.reasons || []).forEach(function (r) {
            var line = el('div', 'dash-result-r');
            line.appendChild(el('div', 'dash-result-rl', r.label));
            if (r.entity) {
                var who = el('div', 'dash-result-re');
                who.textContent = r.entity + (r.programs && r.programs.length ? ' · ' + r.programs.join(', ') : '');
                line.appendChild(who);
            }
            if (r.remarks) line.appendChild(el('div', 'dash-result-rm', r.remarks));
            wrap.appendChild(line);
        });

        var foot = el('div', 'dash-result-foot');
        foot.textContent = t('Logged as check') + ' #' + (result.id || '?') + ' · ' + (result.digest || '');
        wrap.appendChild(foot);
        return wrap;
    }

    function scanBox(trial) {
        var box = card('Check an address', trial.liveLeft + ' ' + t('of') + ' ' + trial.liveIncluded + ' ' + t('left'));
        box.__count = box.querySelector('.dash-card-note');
        var form = el('form', 'dash-scan');
        var input = el('input', 'dash-scan-in');
        input.type = 'text';
        input.placeholder = t('Paste a wallet address');
        input.setAttribute('spellcheck', 'false');
        input.setAttribute('autocomplete', 'off');
        var go = el('button', 'dash-btn dash-btn-primary', 'Check it');
        go.type = 'submit';
        form.appendChild(input);
        form.appendChild(go);

        var out = el('div', 'dash-scan-out');
        var busy = false;

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            if (busy) return;
            var value = input.value.trim();
            if (!value) return;
            busy = true;
            go.disabled = true;
            go.textContent = t('Checking');
            out.innerHTML = '';

            api('/v1/screen', { method: 'POST', body: { address: value } }).then(function (r) {
                busy = false;
                go.disabled = false;
                go.textContent = t('Check it');
                if (r.body.trial && ENT) ENT.trial = r.body.trial;
                if (ENT && ENT.trial) {
                    box.__count.textContent =
                        ENT.trial.liveLeft + ' ' + t('of') + ' ' + ENT.trial.liveIncluded + ' ' + t('left');
                    if (ENT.trial.liveLeft < 1) {
                        input.disabled = true;
                        go.disabled = true;
                    }
                }
                if (!r.ok) {
                    out.appendChild(el('div', 'dash-scan-err', r.body.error || 'That did not work'));
                    return;
                }
                out.appendChild(verdictCard(r.body));
                input.value = '';
            });
        });

        box.appendChild(form);
        box.appendChild(out);
        box.appendChild(coverageLine());
        return box;
    }

    function activateBox() {
        var box = card('Start your trial', 'One trial per company');
        var form = el('form', 'dash-activate');

        var who = el('p', 'dash-activate-who');
        who.textContent = t('Signed in as') + ' ' + ((ENT && ENT.email) || '');
        form.appendChild(who);

        var lab = el('label', 'dash-field');
        lab.appendChild(el('span', 'dash-field-l', 'Company website'));
        var site = el('input', 'dash-field-in');
        site.type = 'text';
        site.placeholder = 'acme.com';
        site.setAttribute('autocomplete', 'off');
        var guess = String((ENT && ENT.email) || '').split('@').pop();
        if (guess && guess.indexOf('.') !== -1) site.value = guess;
        lab.appendChild(site);
        lab.appendChild(el('span', 'dash-field-note', 'This has to match the domain of your work email.'));
        form.appendChild(lab);

        var checks = [
            ['notGambling', 'This business is not an online casino, sportsbook or betting platform.'],
            ['consent', 'I agree to the terms of service and to be contacted about this account.']
        ];
        var state = {};
        checks.forEach(function (c) {
            var row = el('label', 'dash-check');
            var input = el('input');
            input.type = 'checkbox';
            input.addEventListener('change', function () { state[c[0]] = input.checked; });
            row.appendChild(input);
            row.appendChild(el('span', null, c[1]));
            form.appendChild(row);
        });

        var err = el('div', 'dash-scan-err');
        err.hidden = true;
        var go = el('button', 'dash-btn dash-btn-primary', 'Start free trial');
        go.type = 'submit';
        form.appendChild(go);
        form.appendChild(err);

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            err.hidden = true;
            go.disabled = true;
            api('/v1/trial/activate', {
                method: 'POST',
                body: {
                    website: site.value.trim(),
                    company: site.value.trim(),
                    consent: state.consent === true,
                    notGambling: state.notGambling === true
                }
            }).then(function (r) {
                go.disabled = false;
                if (!r.ok) {
                    err.textContent = r.body.error || t('Could not start the trial');
                    err.hidden = false;
                    return;
                }
                return loadEntitlement().then(function () { renderStartInto(view); });
            });
        });

        box.appendChild(form);
        box.appendChild(coverageLine());
        return box;
    }

    function startScreen() {
        var wrap = el('div');
        var trial = (ENT && ENT.trial) || { state: 'none' };
        var name = ((ENT && ENT.name) || '').split(' ')[0];

        wrap.appendChild(head(
            name ? t('Welcome') + ', ' + name : 'Find out what already touched your wallets',
            'Connect a key and we screen what has already happened, not just what comes next.'
        ));

        if (trial.state === 'none') {
            wrap.appendChild(activateBox());
            return wrap;
        }

        if (trial.state === 'pending') {
            var waiting = card('We are checking your company', 'Usually the same day');
            waiting.appendChild(el('p', 'dash-start-p',
                'Your work email did not match the website you gave, so somebody here looks at it. We will email you the moment it opens.'));
            wrap.appendChild(waiting);
            return wrap;
        }

        if (trial.state === 'expired') {
            var over = card('Your trial has ended', '');
            over.appendChild(el('p', 'dash-start-p',
                'Talk to us about the volume you actually need and we will shape a plan around it.'));
            wrap.appendChild(over);
            return wrap;
        }

        var steps = card('Getting set up', trial.daysLeft + ' ' + t('days left'));
        steps.appendChild(stepRow(1, 'Trial active', trial.companyHost, 'done'));
        steps.appendChild(stepRow(2, 'Run your first check',
            trial.liveUsed > 0 ? t('Done') : t('Paste any wallet address below'),
            trial.liveUsed > 0 ? 'done' : 'now'));
        steps.appendChild(stepRow(3, 'Verify your number',
            trial.phoneVerified
                ? t('Your history is open')
                : t('Opens your whole history, plus 10 live checks'),
            trial.phoneVerified ? 'done' : 'next'));
        steps.appendChild(stepRow(4, 'Connect a public key',
            t('We screen what already touched it, not just what comes next'), 'next'));
        wrap.appendChild(steps);

        wrap.appendChild(scanBox(trial));

        if (!trial.historyOpen) {
            var locked = card('Your history', 'Locked');
            locked.appendChild(el('p', 'dash-start-p',
                'The rest of your history is already there. Verify your number and it opens, along with 10 live checks.'));
            wrap.appendChild(locked);
        }

        return wrap;
    }

    function renderStartInto(host) {
        while (host.firstChild) host.removeChild(host.firstChild);
        host.appendChild(startScreen());
    }

    var currentKeys = null;
    function parse() {
        var raw = (location.hash || '').replace(/^#\/?/, '');
        var parts = raw.split('/').filter(Boolean);
        return { name: parts[0] || '', arg: parts[1] || '' };
    }

    function go(route) {
        location.hash = '#/' + route;
    }
    views.start = function () { return startScreen(); };

    function demoMode() {
        try {
            return localStorage.getItem('sp-dash-demo') === '1';
        } catch (err) {
            return false;
        }
    }
    function setDemo(on) {
        try {
            localStorage.setItem('sp-dash-demo', on ? '1' : '0');
        } catch (err) {  }
    }

    function liveAccount() {
        return ENT && ENT.trial && (ENT.trial.state === 'starter' || ENT.trial.state === 'verified');
    }

    function paintDemoChip() {
        var chip = document.getElementById('dash-env');
        if (!chip) return;
        chip.hidden = false;
        chip.textContent = demoMode() ? t('Demo workspace') : t('Your workspace');
        chip.className = demoMode() ? 'dash-chip dash-chip-demo' : 'dash-chip';
        chip.onclick = function () {
            setDemo(!demoMode());
            location.hash = '#/';
            render();
        };
        chip.title = demoMode()
            ? t('Sample data, not yours. Click to go back to your workspace.')
            : t('Click to look around a workspace filled with sample data.');
    }

    var LIVE_ROUTES = { 'settings': 1, 'screenings-log': 1 };

    views['screenings-log'] = function () {
        var wrap = el('div');
        wrap.appendChild(head('Checks you have run',
            'Every check is kept with the list it was run against, so you can show what you knew and when.'));
        var box = card('Your checks', '');
        var body = el('div', 'dash-log-body', 'Loading');
        box.appendChild(body);
        wrap.appendChild(box);

        api('/v1/screenings').then(function (r) {
            body.textContent = '';
            var rows = (r.body && r.body.rows) || [];
            if (!rows.length) {
                body.appendChild(el('p', 'dash-start-p', 'Nothing yet. Run your first check from the start screen.'));
                return;
            }
            var table = el('table', 'dash-table');
            var head2 = el('tr');
            ['When', 'Chain', 'Address', 'Result'].forEach(function (h) {
                head2.appendChild(el('th', null, h));
            });
            table.appendChild(head2);
            rows.forEach(function (row) {
                var tr = el('tr', 'is-row');
                tr.appendChild(el('td', null, when(row.at)));
                tr.appendChild(el('td', null, row.asset || '-'));
                var a = el('td', 'dash-mono');
                a.textContent = row.address;
                tr.appendChild(a);
                tr.appendChild(el('td', null, row.verdict === 'severe' ? 'Sanctioned' : 'No sanctions match'));
                table.appendChild(tr);
            });
            body.appendChild(table);
        });
        return wrap;
    };

    function render() {
        var r = parse();
        var ownWorkspace = ENT && !demoMode();
        if (ownWorkspace && !LIVE_ROUTES[r.name]) {
            while (view.firstChild) view.removeChild(view.firstChild);
            view.appendChild(startScreen());
            paintNav('');
            paintDemoChip();
            paintLive();
            paintUsage();
            closeRail();
            window.scrollTo(0, 0);
            document.title = 'Sentinelpay · ' + t('Start');
            return;
        }
        var make = views[r.name] || views[''];
        var node;
        try {
            node = make(r.arg);
        } catch (err) {
            node = el('div');
            node.appendChild(head('Something went wrong', 'This screen could not be drawn. The rest of the dashboard still works.'));
            if (window.console) console.error('[dashboard]', err);
        }

        var settings = document.getElementById('dash-settings');
        if (settings && settings.parentNode === view.firstChild) {  }
        while (view.firstChild) {
            if (settings && view.firstChild.contains && view.firstChild.contains(settings)) {
                settings.hidden = true;
                document.body.appendChild(settings);
            }
            view.removeChild(view.firstChild);
        }
        view.appendChild(node);
        currentKeys = node.__keys || null;
        paintNav(r.name === 'screening' ? 'screenings' : r.name);
        paintLive();
        paintUsage();
        paintDemoChip();
        closeRail();
        window.scrollTo(0, 0);
        var first = view.querySelector('h1');
        if (first) document.title = 'Sentinelpay · ' + first.textContent;
    }
    window.addEventListener('hashchange', render);
    var search = document.getElementById('dash-search-input');
    function focusSearch() {
        if (!search) return;
        search.focus();
        search.select();
    }
    if (search) {
        search.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter') return;
            var q = search.value.trim();
            if (!q) return;
            var hit = D.find(q);
            if (hit) {
                search.blur();
                go('screening/' + hit.id);
            }
        });
    }

    document.addEventListener('keydown', function (e) {
        var tag = (e.target.tagName || '').toLowerCase();
        var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); palette(); return; }
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === '/' && !typing) { e.preventDefault(); focusSearch(); return; }
        if (e.key === 'Escape') { if (typing) e.target.blur(); closeRail(); return; }
        if (typing) return;
        if (currentKeys && currentKeys(e)) { e.preventDefault(); return; }
        var rows = Array.prototype.slice.call(view.querySelectorAll('tr.is-row'));
        if (!rows.length) return;
        var at = rows.indexOf(view.querySelector('tr.is-cursor'));
        if (e.key === 'j' || e.key === 'ArrowDown') {
            e.preventDefault();
            move(rows, at, Math.min(at + 1, rows.length - 1) === -1 ? 0 : Math.min(at < 0 ? 0 : at + 1, rows.length - 1));
        } else if (e.key === 'k' || e.key === 'ArrowUp') {
            e.preventDefault();
            move(rows, at, Math.max(at - 1, 0));
        } else if (e.key === 'Enter' && at > -1) {
            e.preventDefault();
            rows[at].click();
        }
    });

    function move(rows, from, to) {
        if (from > -1 && rows[from]) rows[from].classList.remove('is-cursor');
        if (rows[to]) {
            rows[to].classList.add('is-cursor');
            var box = rows[to].getBoundingClientRect();
            if (box.top < 80 || box.bottom > window.innerHeight - 20) {
                rows[to].scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
        }
    }
    var rail = document.getElementById('dash-side');
    var scrim = document.getElementById('dash-scrim');
    var burger = document.getElementById('dash-burger');
    function closeRail() {
        if (rail) rail.classList.remove('is-open');
        if (scrim) scrim.classList.remove('is-on');
    }
    if (burger) {
        burger.addEventListener('click', function () {
            if (!rail) return;
            var on = rail.classList.toggle('is-open');
            if (scrim) scrim.classList.toggle('is-on', on);
        });
    }
    if (scrim) scrim.addEventListener('click', closeRail);
    fetch('/v1/auth/me', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (who) {
            if (!who || !who.signedIn) { location.replace('/?signin=1'); return; }
            me.name = who.name || '';
            var avatar = document.getElementById('dash-avatar');
            if (avatar) {
                var parts = String(who.name || '').trim().split(/\s+/).filter(Boolean);
                avatar.textContent = ((parts[0] || '?').charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
                avatar.title = who.name || '';
                avatar.setAttribute('aria-label', who.name || t('Your account'));
            }

            var chip = document.getElementById('dash-env');
            if (chip) chip.hidden = false;
        })
        .catch(function () {  });

    loadEntitlement().then(function () {
        render();
    });
})();