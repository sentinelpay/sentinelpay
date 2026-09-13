/* The dashboard.
 *
 * One page, ten views, rendered here rather than as ten html files. The site
 * already has eighteen pages that are half the same bytes, and a tool with a
 * rail down the side is the worst possible thing to copy that way: every screen
 * would carry its own copy of the navigation and they would drift apart by the
 * second week.
 *
 * Routing is the hash. No history api, no server routes to keep in step, and a
 * link somebody pastes into a message opens the same screen they were looking
 * at. The server serves this page for anything under /dashboard and the view is
 * decided here.
 *
 * Everything it shows comes from dash-data.js, which is invented. The shapes are
 * the shapes the engine will answer with; when it does, the fetch replaces the
 * lookup and the views do not change.
 */
(function () {
    'use strict';

    var D = window.SentinelDashData;
    var view = document.getElementById('dash-view');
    if (!D || !view) return;

    var t = function (x) { return window.SentinelI18n ? window.SentinelI18n.t(x) : x; };

    // ---- small helpers ------------------------------------------------------

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

    // "4 minutes ago", in the page's language. Intl does the grammar, which is
    // the half of this that is easy to get wrong in croatian.
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
    };

    function icon(name, cls) {
        return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            (ICONS[name] || '') + '</svg>';
    }

    // ---- the rail -----------------------------------------------------------

    var NAV = [
        { group: 'Work', items: [
            { route: '', label: 'Overview', icon: 'home' },
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

    function paintNav(current) {
        var nav = document.getElementById('dash-nav');
        if (!nav) return;
        nav.textContent = '';
        NAV.forEach(function (g) {
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

    function paintUsage() {
        var box = document.getElementById('dash-usage');
        if (!box) return;
        var a = D.account;
        var pct = Math.min(100, Math.round((a.checksUsed / a.checksIncluded) * 100));
        box.innerHTML =
            '<div class="dash-usage-top"><span>' + esc(t('Checks this month')) + '</span>' +
            '<b>' + esc(num(a.checksUsed)) + ' / ' + esc(num(a.checksIncluded)) + '</b></div>' +
            '<div class="dash-usage-bar"><div class="dash-usage-fill" style="width:' + pct + '%"></div></div>' +
            '<div class="dash-usage-note">' + esc(t('Plan')) + ': ' + esc(a.plan) + ' · ' +
            esc(t('renews')) + ' ' + esc(when(a.renews)) + '</div>';
    }

    // ---- building blocks ----------------------------------------------------

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

    // A table that can be walked with the keyboard. Rows carry their own action,
    // so j/k/Enter work the same on every screen without each view wiring it.
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

    function sampleChip() {
        var s = el('span', 'dash-sample');
        s.textContent = t('Sample data');
        return s;
    }

    // ---- views --------------------------------------------------------------

    var views = {};

    views[''] = function () {
        var page = el('div');
        var open = D.alerts.filter(function (a) { return a.state === 'open'; });
        var severe = open.filter(function (a) { return a.band === 'severe' || a.band === 'high'; });

        page.appendChild(head('Overview',
            'Everything that needs a person, and nothing that does not.',
            [button('Run a check', 'primary', function () { focusSearch(); }, 'search')]));

        // the three numbers worth having on a wall
        var stats = el('div', 'dash-grid dash-grid-3');
        [
            [num(open.length), t('Open alerts'), severe.length ? t('of those, high or worse') + ': ' + severe.length : t('nothing above medium')],
            [num(D.account.checksUsed), t('Checks this month'), t('of') + ' ' + num(D.account.checksIncluded) + ' ' + t('included')],
            [num(D.watched.length), t('Addresses watched'), t('rechecked continuously')],
        ].forEach(function (s) {
            var c = card();
            var st = el('div', 'dash-stat');
            st.appendChild(el('div', 'dash-stat-n', s[0]));
            st.appendChild(el('div', 'dash-stat-l', s[1]));
            st.appendChild(el('div', 'dash-stat-d', s[2]));
            c.appendChild(st);
            stats.appendChild(c);
        });
        page.appendChild(stats);

        var grid = el('div', 'dash-grid dash-grid-side dash-gap');

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
        grid.appendChild(attention);

        var side = el('div');
        var recent = card('Recent checks');
        recent.appendChild(table(
            [{ label: 'Subject' }, { label: 'Risk' }],
            D.screenings.slice(0, 5).map(function (s) {
                return {
                    data: s,
                    cells: [
                        { text: short(s.subject), cls: 'mono' },
                        { node: bandTag(s.band) },
                    ],
                };
            }),
            function (s) { go('screening/' + s.id); }
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

    views.screenings = function () {
        var page = el('div');
        page.appendChild(head('Screenings', 'Every check this account has run, newest first.'));
        var c = card();
        c.appendChild(table(
            [{ label: 'Subject' }, { label: 'Chain' }, { label: 'Risk' }, { label: 'Decision' }, { label: 'By' }, { label: 'When', num: true }],
            D.screenings.map(function (s) {
                return {
                    data: s,
                    cells: [
                        { text: short(s.subject), cls: 'mono' },
                        { text: s.chain },
                        { node: bandTag(s.band) },
                        { text: decisionWord(s.decision) },
                        { text: s.by },
                        { text: since(s.at), cls: 'num' },
                    ],
                };
            }),
            function (s) { go('screening/' + s.id); }
        ));
        page.appendChild(c);
        page.appendChild(keyboardHelp());
        return page;
    };

    // The screen the product is. Everything else on this rail exists to get
    // somebody here, or to prove afterwards that they were.
    views.screening = function (id) {
        var s = D.byId(id);
        var page = el('div');
        if (!s) {
            page.appendChild(head('Screening', 'That check is not in this account.'));
            return page;
        }

        var back = el('a', 'dash-link');
        back.href = '#/screenings';
        back.textContent = '← ' + t('All screenings');
        back.style.display = 'inline-block';
        back.style.marginBottom = '0.9rem';
        page.appendChild(back);

        // what a printed report needs and the screen does not
        var ph = el('div', 'dash-print-head');
        ph.innerHTML = '<h1>' + esc(t('Screening report')) + '</h1><p>Sentinelpay · ' +
            esc(when(s.at, true)) + ' · ' + esc(t('Reference')) + ' ' + esc(s.id) + '</p>';
        page.appendChild(ph);

        var verdict = card();
        verdict.classList.add('dash-verdict');
        var top = el('div', 'dash-verdict-top');
        top.appendChild(bandTag(s.band));
        top.appendChild(el('span', 'dash-verdict-subject', s.subject));
        top.appendChild(sampleChip());
        verdict.appendChild(top);
        verdict.appendChild(el('p', 'dash-verdict-line', s.verdict));

        var acts = el('div', 'dash-verdict-acts');
        var decided = el('span', 'dash-tiny dash-muted');

        function setDecision(d) {
            s.decision = d;
            paint();
        }
        function paint() {
            acts.textContent = '';
            if (s.decision) {
                decided.textContent = t('Decision') + ': ' + decisionWord(s.decision) + ' · ' + t('by') + ' ' + s.by + ' · ' + since(s.at);
                acts.appendChild(decided);
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

        // why
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

        // exposure
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

        // the path
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

        // transactions
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

        // the facts column
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
        ]));
        side.appendChild(meta);
        grid.appendChild(side);

        page.appendChild(grid);

        // the decision keys, on this screen only
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

    views.alerts = function () {
        var page = el('div');
        page.appendChild(head('Alerts', 'What monitoring found while nobody was looking. Every alert says which rule produced it.'));
        var c = card();
        c.appendChild(table(
            [{ label: 'Risk' }, { label: 'Subject' }, { label: 'Rule' }, { label: 'What happened' }, { label: 'State' }, { label: 'When', num: true }],
            D.alerts.map(function (a) {
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
        page.appendChild(c);
        page.appendChild(keyboardHelp());
        return page;
    };

    views.monitoring = function () {
        var page = el('div');
        page.appendChild(head('Monitoring',
            'Addresses we recheck for you, and the rules that decide when you hear about it.',
            [button('Watch an address', 'primary', function () { focusSearch(); }, 'eye')]));

        var watched = card('Watched addresses');
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

        var approvals = card('Who may approve what');
        approvals.appendChild(table(
            [{ label: 'Action' }, { label: 'Approval needed' }],
            D.policy.approvals.map(function (a) {
                return { data: a, cells: [{ text: a.what }, { text: a.who }] };
            })
        ));
        page.appendChild(approvals);

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

    // Settings is the only view whose markup is in the html, because it is the
    // one part of this page that is real: the password, the sessions, the second
    // factor and the erasure all talk to endpoints that exist. Rebuilding it
    // here would mean two copies of a thing that already works.
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

    // ---- routing ------------------------------------------------------------

    var currentKeys = null;

    function parse() {
        var raw = (location.hash || '').replace(/^#\/?/, '');
        var parts = raw.split('/').filter(Boolean);
        return { name: parts[0] || '', arg: parts[1] || '' };
    }

    function go(route) {
        location.hash = '#/' + route;
    }

    function render() {
        var r = parse();
        var make = views[r.name] || views[''];
        var node;
        try {
            node = make(r.arg);
        } catch (err) {
            node = el('div');
            node.appendChild(head('Something went wrong', 'This screen could not be drawn. The rest of the dashboard still works.'));
            if (window.console) console.error('[dashboard]', err);
        }
        // settings lives in the document, so it must be put back rather than
        // thrown away with the rest of the view
        var settings = document.getElementById('dash-settings');
        if (settings && settings.parentNode === view.firstChild) { /* handled below */ }
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
        paintUsage();
        closeRail();
        window.scrollTo(0, 0);
        var first = view.querySelector('h1');
        if (first) document.title = 'Sentinelpay · ' + first.textContent;
    }

    window.addEventListener('hashchange', render);

    // ---- search -------------------------------------------------------------

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

    // ---- keyboard -----------------------------------------------------------
    // A tool people keep open earns keys. The rule is that nothing here fires
    // while something is being typed into.
    document.addEventListener('keydown', function (e) {
        var tag = (e.target.tagName || '').toLowerCase();
        var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
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

    // ---- the rail on a phone ------------------------------------------------

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

    // ---- who is signed in ---------------------------------------------------

    fetch('/v1/auth/me', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (me) {
            if (!me || !me.signedIn) { location.replace('/?signin=1'); return; }
            var avatar = document.getElementById('dash-avatar');
            if (avatar) {
                var parts = String(me.name || '').trim().split(/\s+/).filter(Boolean);
                avatar.textContent = ((parts[0] || '?').charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
                avatar.title = me.name || '';
                avatar.setAttribute('aria-label', me.name || t('Your account'));
            }
            // the sample-data chip is not decoration: everything on these screens
            // is invented until the engine is wired in, and nobody should be able
            // to mistake one for the other
            var chip = document.getElementById('dash-env');
            if (chip) chip.hidden = false;
        })
        .catch(function () { /* the page is already drawn; a failed call is not a reason to empty it */ });

    render();
})();
