/* the staff inbox.

   the page it runs on is a shell: a heading, four empty boxes and this file.
   every row on screen came from `/v1/submissions`, the same json anybody would
   curl, so there is one way to read a submission rather than two that can drift
   apart. the page is behind the staff gate, and so is every request this makes.

   three things it does that the server-rendered version could not:

   new submissions arrive on their own. the server holds a stream open and says
   "one came in"; this asks for the page again. what crosses the wire is a
   reference and a country, never a person, so a tab left open overnight is not
   a feed of other people's names.

   a row can be deleted, and it is deleted from the database rather than hidden
   here. an inbox you can only add to is a pile.

   ten to a page. the pager is the one from the blog, down to the wording.

   nothing here is a security boundary: the gate is on the server, on every
   endpoint. this decides what is drawn. */
(function () {
    var PER_PAGE = 10;
    var state = { kind: '', flagged: false, offset: 0, total: 0, ref: '' };
    // the ordinary way in is a staff session, and then there is no token in the
    // url at all. it survives here for the case the token exists for: no
    // database, nobody able to sign in, and somebody who still has to look.
    var token = new URLSearchParams(location.search).get('token') || '';

    var rowsEl = document.getElementById('rows');
    var pagerEl = document.getElementById('pager');
    var tabsEl = document.getElementById('tabs');
    var liveEl = document.getElementById('live');

    // ---- the small amount of html this file writes -------------------------
    // built with the dom rather than with strings. every value on this page was
    // typed by a stranger into a form, and `textContent` cannot be talked into
    // being markup no matter what they typed.
    function el(tag, style, text) {
        var n = document.createElement(tag);
        if (style) n.setAttribute('style', style);
        if (text != null) n.textContent = text;
        return n;
    }

    var CARD = 'margin:0 0 14px;padding:18px 20px;border-radius:14px;background:#fff;border:1px solid #e6e9f0;';
    var BTN = 'font:inherit;font-size:13px;font-weight:700;padding:8px 14px;border-radius:9px;cursor:pointer;';
    var HIDE = { ref: 1, id: 1, ts: 1, kind: 1, outcome: 1, flags: 1, ip: 1, ua: 1, country: 1 };

    function readParams() {
        var q = new URLSearchParams(location.search);
        state.kind = q.get('kind') || '';
        state.flagged = q.get('flagged') === '1';
        state.ref = q.get('ref') || '';
        state.offset = Math.max(parseInt(q.get('offset') || '0', 10) || 0, 0);
        token = q.get('token') || token;
    }

    // the address bar follows what is on screen, so a page can be linked to and
    // the back button does what it looks like it does
    function writeParams(push) {
        var q = new URLSearchParams();
        if (token) q.set('token', token);
        if (state.kind) q.set('kind', state.kind);
        if (state.flagged) q.set('flagged', '1');
        if (state.ref) q.set('ref', state.ref);
        if (state.offset) q.set('offset', String(state.offset));
        var url = '/v1/inbox' + (q.toString() ? '?' + q.toString() : '');
        if (push) history.pushState(null, '', url); else history.replaceState(null, '', url);
    }

    function when(ts) {
        var d = new Date(ts);
        return isNaN(d.getTime()) ? '' : d.toISOString().replace('T', ' ').slice(0, 16);
    }

    function card(row) {
        var box = el('div', CARD);

        var head = el('div', 'display:flex;justify-content:space-between;gap:12px;font-size:12px;color:#94a0bd;');
        head.appendChild(el('span', null, row.kind + ' · ' + row.outcome + ' · ' + (row.country || '?')));
        head.appendChild(el('span', null, when(row.ts) + ' · ' + (row.ref || '')));
        box.appendChild(head);

        if (row.flags && row.flags.length) {
            box.appendChild(el('div',
                'margin:10px 0 0;padding:8px 12px;border-radius:9px;background:#fff8ee;border:1px solid #f6dfbc;' +
                'font-size:12px;color:#7a5417;', 'worth a look: ' + row.flags.join(', ')));
        }

        var table = el('table', 'border-collapse:collapse;font-size:14px;margin-top:10px;');
        Object.keys(row).forEach(function (k) {
            if (HIDE[k]) return;
            var v = row[k];
            if (v === '' || v === null || v === undefined) return;
            var tr = el('tr');
            tr.appendChild(el('td', 'padding:6px 16px 6px 0;color:#6b7899;white-space:nowrap;vertical-align:top;', k));
            tr.appendChild(el('td', 'padding:6px 0;color:#0e2358;font-weight:600;',
                Array.isArray(v) ? v.join(', ') : String(v)));
            table.appendChild(tr);
        });
        box.appendChild(table);

        var actions = el('div', 'display:flex;gap:8px;align-items:center;margin-top:12px;');
        if (row.email) {
            var reply = el('a', BTN + 'background:#0e2358;color:#fff;text-decoration:none;display:inline-block;',
                'reply to ' + row.email);
            reply.href = 'mailto:' + encodeURIComponent(row.email) +
                '?subject=' + encodeURIComponent('re: your message to sentinelpay');
            actions.appendChild(reply);
        }

        var del = el('button', BTN + 'background:#fff;color:#c0304a;border:1px solid rgba(192,48,74,0.3);', 'delete');
        del.type = 'button';
        del.addEventListener('click', function () {
            // two presses, not a dialog. `confirm()` is a system box people
            // dismiss without reading; a button that changes into "sure?" is
            // read, because it is the thing under the finger.
            if (del.dataset.armed !== '1') {
                del.dataset.armed = '1';
                del.textContent = 'sure? this is permanent';
                del.setAttribute('style', BTN + 'background:#c0304a;color:#fff;border:1px solid #c0304a;');
                setTimeout(function () {
                    if (del.dataset.armed !== '1') return;
                    del.dataset.armed = '';
                    del.textContent = 'delete';
                    del.setAttribute('style', BTN + 'background:#fff;color:#c0304a;border:1px solid rgba(192,48,74,0.3);');
                }, 4000);
                return;
            }
            del.disabled = true;
            del.textContent = 'deleting…';
            fetch('/v1/submissions/delete' + (token ? '?token=' + encodeURIComponent(token) : ''), {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: row.id })
            }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
              .then(function (out) {
                  if (!out.ok || !out.d.removed) {
                      del.disabled = false;
                      del.textContent = (out.d && out.d.error) || 'could not delete';
                      return;
                  }
                  // the row goes, and the page is asked for again: deleting the
                  // last row of page three should not leave page three empty
                  load();
              }).catch(function () {
                  del.disabled = false;
                  del.textContent = 'could not delete';
              });
        });
        actions.appendChild(del);
        box.appendChild(actions);
        return box;
    }

    // ---- the tabs and the pager --------------------------------------------

    function tabs() {
        tabsEl.textContent = '';
        [['everything', {}], ['demo', { kind: 'demo' }], ['trial', { kind: 'trial' }],
         ['accounts', { kind: 'account' }], ['worth a look', { flagged: true }]].forEach(function (pair) {
            var label = pair[0], want = pair[1];
            var on = (want.kind || '') === state.kind && Boolean(want.flagged) === state.flagged && !state.ref;
            var b = el('button', BTN + (on
                ? 'background:#0e2358;color:#fff;border:1px solid #0e2358;'
                : 'background:#fff;color:#6b7899;border:1px solid #e6e9f0;'), label);
            b.type = 'button';
            b.addEventListener('click', function () {
                state.kind = want.kind || '';
                state.flagged = Boolean(want.flagged);
                state.ref = '';
                state.offset = 0;
                writeParams(true);
                load();
            });
            tabsEl.appendChild(b);
        });
    }

    function pager(shown) {
        pagerEl.textContent = '';
        if (state.ref) {
            var back = el('button', BTN + 'background:#fff;color:#0e2358;border:1px solid rgba(14,35,88,0.14);', 'back to everything');
            back.type = 'button';
            back.addEventListener('click', function () {
                state.ref = ''; state.offset = 0; writeParams(true); load();
            });
            pagerEl.appendChild(back);
            return;
        }
        if (state.total <= PER_PAGE) return;

        var wrap = el('div', 'display:flex;align-items:center;justify-content:center;gap:1.4rem;padding:2rem 0 1rem;');
        var mk = function (label, disabled, step) {
            var b = el('button', BTN + 'padding:10px 24px;border-radius:10px;background:#fff;color:#0e2358;' +
                'border:1px solid rgba(14,35,88,0.14);' + (disabled ? 'opacity:0.4;cursor:default;' : ''), label);
            b.type = 'button';
            b.disabled = disabled;
            if (!disabled) b.addEventListener('click', function () {
                state.offset = Math.max(state.offset + step, 0);
                writeParams(true);
                load();
                window.scrollTo(0, 0);
            });
            return b;
        };
        var first = state.total ? state.offset + 1 : 0;
        var last = state.offset + shown;
        wrap.appendChild(mk('prev', state.offset === 0, -PER_PAGE));
        wrap.appendChild(el('span', 'font-size:0.85rem;font-weight:600;color:rgba(14,35,88,0.6);',
            'viewing ' + first + '–' + last + ' of ' + state.total));
        wrap.appendChild(mk('next', last >= state.total, PER_PAGE));
        pagerEl.appendChild(wrap);
    }

    // ---- fetching ------------------------------------------------------------

    var pending = 0;
    function load() {
        var mine = ++pending;
        var q = new URLSearchParams({ limit: String(PER_PAGE), offset: String(state.offset) });
        if (state.kind) q.set('kind', state.kind);
        if (state.flagged) q.set('flagged', '1');
        // one reference is a filter the api does not have, so it is asked for a
        // wide page and narrowed here. it is a link from an email, one row, and
        // not worth a second query shape.
        if (state.ref) { q.set('limit', '200'); q.set('offset', '0'); }
        if (token) q.set('token', token);

        return fetch('/v1/submissions?' + q.toString(), { credentials: 'same-origin' })
            .then(function (r) {
                if (r.status === 404) { location.replace('/auth'); return null; }
                return r.json();
            })
            .then(function (data) {
                if (!data || mine !== pending) return;
                var rows = data.submissions || [];
                if (state.ref) rows = rows.filter(function (x) { return x.ref === state.ref; });
                state.total = state.ref ? rows.length : (data.total || rows.length);

                rowsEl.textContent = '';
                if (!rows.length) {
                    rowsEl.appendChild(el('p', 'color:rgba(14,35,88,0.5);font-size:14px;', 'nothing here.'));
                } else {
                    rows.forEach(function (row) { rowsEl.appendChild(card(row)); });
                }
                tabs();
                pager(rows.length);
            })
            .catch(function () {
                rowsEl.textContent = '';
                rowsEl.appendChild(el('p', 'color:#c0304a;font-size:14px;', 'could not read the submissions.'));
            });
    }

    // ---- the stream ----------------------------------------------------------

    function live() {
        if (!window.EventSource) return;
        var src = new EventSource('/v1/inbox/stream' + (token ? '?token=' + encodeURIComponent(token) : ''),
            { withCredentials: true });
        var waiting = 0;

        src.addEventListener('open', function () {
            liveEl.textContent = 'live · new submissions appear on their own';
            liveEl.setAttribute('style', 'margin:0 0 16px;font-size:12px;color:#0a7b52;');
        });

        src.addEventListener('submission', function (e) {
            var got;
            try { got = JSON.parse(e.data); } catch (err) { got = {}; }
            // on the first page it simply appears. deeper in, the offsets would
            // shift under somebody's feet, so it says so instead and waits.
            if (state.offset === 0 && !state.ref) {
                load();
                liveEl.textContent = 'just in: ' + (got.kind || 'a submission') +
                    (got.country ? ' from ' + got.country : '') + ' · ' + (got.ref || '');
            } else {
                waiting++;
                liveEl.textContent = waiting + ' new since you opened this page · go back to the first page to see';
            }
            liveEl.setAttribute('style', 'margin:0 0 16px;font-size:12px;color:#0a7b52;font-weight:600;');
        });

        src.addEventListener('error', function () {
            // the browser reconnects on its own; this only stops the line
            // claiming to be live while it is not
            liveEl.textContent = 'reconnecting…';
            liveEl.setAttribute('style', 'margin:0 0 16px;font-size:12px;color:#94a0bd;');
        });
    }

    window.addEventListener('popstate', function () { readParams(); load(); });

    readParams();
    writeParams(false);
    load().then(live);
})();
