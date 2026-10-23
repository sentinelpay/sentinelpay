// An invitation, in a modal over the front page.
//
// /invite is the front page with this on top of it: one card, drawn from
// /v1/invites/current, saying what the invitation is, who sent it, and the
// one next step that belongs to whoever is holding the link. The signing in
// and the signing up are the site's own modal, opened with the address
// filled in and fixed, so the code, the second step and a forgotten password
// all work the way they do everywhere else. When either finishes it goes to
// /dashboard, and the server sends anyone with an open invitation back here,
// so the card picks up where it was.
(function () {
    'use strict';

    if (location.pathname !== '/invite') return;

    var CLOSE_I = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">' +
        '<path d="M6 6l12 12M18 6L6 18"></path></svg>';
    var wrapEl = document.createElement('div');
    wrapEl.className = 'sp-authm-backdrop ivp-backdrop sp-authm-arrive';
    wrapEl.hidden = true;
    wrapEl.innerHTML =
        '<div class="sp-authm ivp-m" role="dialog" aria-modal="true" aria-labelledby="ivp-h">' +
            '<div class="lp-demo-card sp-authm-panel ivp-card">' +
                '<span class="lp-demo-dots" aria-hidden="true"></span>' +
                '<span class="lp-demo-edge" aria-hidden="true"></span>' +
                '<button type="button" class="sp-authm-x ivp-x" aria-label="Close">' + CLOSE_I + '</button>' +
                '<div class="ivp-body" id="ivp-body" aria-live="polite" aria-busy="true">' +
                    '<div class="ivp-wait" aria-hidden="true"><span class="w1"></span><span class="w2"></span><span class="w3"></span><span class="w4"></span></div>' +
                '</div>' +
            '</div>' +
        '</div>';
    (document.body || document.documentElement).appendChild(wrapEl);
    var body = document.getElementById('ivp-body');
    var box = wrapEl.querySelector('.sp-authm');

    // shown and put away the way the sign in is, and the front page behind it
    // does not scroll while it is up
    var shown = false;
    var lastFocus = null;
    function show() {
        if (shown) return;
        shown = true;
        lastFocus = document.activeElement;
        wrapEl.hidden = false;
        void wrapEl.offsetWidth;
        wrapEl.classList.add('is-open');
        document.documentElement.classList.add('sp-authm-open');
    }
    function hide(done) {
        if (!shown) { if (done) done(); return; }
        shown = false;
        wrapEl.classList.remove('is-open');
        setTimeout(function () {
            wrapEl.hidden = true;
            wrapEl.classList.remove('sp-authm-arrive');
            var auth = document.getElementById('sp-authm-backdrop');
            if (!auth || auth.hidden) document.documentElement.classList.remove('sp-authm-open');
            if (done) done();
        }, 240);
    }
    // closing leaves the front page as the front page: the address bar goes
    // to it, and the invitation waits in this browser for the next sign in
    function close() {
        hide(function () {
            try { history.replaceState(null, '', '/'); } catch (e) {  }
            if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
        });
    }
    wrapEl.querySelector('.ivp-x').addEventListener('click', close);
    wrapEl.addEventListener('mousedown', function (e) { if (e.target === wrapEl) close(); });
    document.addEventListener('keydown', function (e) {
        if (!shown || e.key !== 'Escape') return;
        var auth = document.getElementById('sp-authm-backdrop');
        if (auth && !auth.hidden) return;
        close();
    });

    function t(s) {
        var i = window.SentinelI18n;
        return i && i.t ? i.t(s) : s;
    }
    function fill(key, vals) {
        return t(key).replace(/\{(\w+)\}/g, function (m, k) {
            return Object.prototype.hasOwnProperty.call(vals, k) ? String(vals[k]) : m;
        });
    }
    function lang() {
        var i = window.SentinelI18n;
        var l = i && i.lang ? i.lang() : 'en';
        return /^(en|hr|de)$/.test(l) ? l : 'en';
    }
    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }
    function dateOf(iso) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        try {
            return new Intl.DateTimeFormat({ en: 'en-GB', hr: 'hr-HR', de: 'de-DE' }[lang()],
                { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
        } catch (err) {
            return d.toISOString().slice(0, 10);
        }
    }
    var ROLES = { owner: 'Owner', admin: 'Admin', analyst: 'Analyst', viewer: 'Viewer' };
    function roleName(key) { return t(ROLES[key] || key || ''); }

    var ICON = {
        info: '<path d="M12 10.5v6M12 7.4v.1"/><circle cx="12" cy="12" r="9"/>',
        shield: '<path d="M12 3.5 5 6.2v5.3c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6.2Z"/><path d="m9 12 2.1 2.1L15.2 10"/>',
        swap: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.7-3 2.9-4.6 5.5-4.6s4.8 1.6 5.5 4.6"/><path d="m16 8 2-2 2 2M18 6v7"/>',
        clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
        x: '<circle cx="12" cy="12" r="8.5"/><path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6"/>',
        check: '<circle cx="12" cy="12" r="8.5"/><path d="m8.6 12.2 2.4 2.4 4.4-4.6"/>',
        link: '<path d="M10 14a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1-1"/>',
        // the organisation's cube, as the dashboard draws it
        org: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>'
    };
    function svg(name, cls) {
        var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        s.setAttribute('viewBox', '0 0 24 24');
        s.setAttribute('fill', 'none');
        s.setAttribute('stroke', 'currentColor');
        s.setAttribute('stroke-width', '1.9');
        s.setAttribute('stroke-linecap', 'round');
        s.setAttribute('stroke-linejoin', 'round');
        s.setAttribute('aria-hidden', 'true');
        if (cls) s.setAttribute('class', cls);
        s.innerHTML = ICON[name] || '';
        return s;
    }

    function post(url, data) {
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(data || {})
        }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (j) {
                if (!r.ok) {
                    var e = new Error(j && j.error ? t(j.error) : t('That did not work. Please try again.'));
                    e.status = r.status;
                    throw e;
                }
                return j;
            });
        });
    }

    var now = null;

    function load() {
        body.setAttribute('aria-busy', 'true');
        return fetch('/v1/invites/current', { credentials: 'same-origin' })
            // a refusal from the server (too many requests, a restart) is
            // not the same as a link that does not work, and is not said as one
            .then(function (r) {
                if (!r.ok) throw new Error(String(r.status));
                return r.json();
            })
            .then(function (d) {
                now = d || { state: 'missing', me: null, broken: true };
                draw();
            })
            .catch(function () {
                now = { state: 'missing', me: null, broken: true };
                draw();
            });
    }

    // ---- the parts every state is built from

    function start(markText, markIcon, tone) {
        body.textContent = '';
        body.removeAttribute('aria-busy');
        var wrap = el('div', 'ivp-in');
        var mark = el('div', 'ivp-mark' + (tone ? ' is-' + tone : ''));
        mark.setAttribute('aria-hidden', 'true');
        if (markIcon) mark.appendChild(svg(markIcon));
        else mark.textContent = markText;
        wrap.appendChild(mark);
        body.appendChild(wrap);
        return wrap;
    }
    function head(wrap, title, line) {
        var h = el('h1', 'ivp-h', title);
        h.id = 'ivp-h';
        wrap.appendChild(h);
        if (line) wrap.appendChild(el('p', 'ivp-p', line));
    }
    function note(wrap, icon, title, text, tone) {
        var n = el('div', 'ivp-note' + (tone ? ' is-' + tone : ''));
        n.appendChild(svg(icon, 'ivp-note-i'));
        var tx = el('div', 'ivp-note-t');
        if (title) tx.appendChild(el('span', 'ivp-note-h', title));
        tx.appendChild(document.createTextNode(text));
        n.appendChild(tx);
        wrap.appendChild(n);
        return n;
    }
    function acts(wrap) {
        var a = el('div', 'ivp-acts');
        wrap.appendChild(a);
        return a;
    }
    function primary(box, label, run, bad) {
        var b = el('button', 'lp-demo-submit' + (bad ? ' is-bad' : ''), label);
        b.type = 'button';
        b.addEventListener('click', function () { run(b); });
        box.appendChild(b);
        return b;
    }
    function secondary(box, label, run, bad) {
        var b = el('button', 'ivp-btn2' + (bad ? ' is-bad' : ''), label);
        b.type = 'button';
        b.addEventListener('click', function () { run(b); });
        box.appendChild(b);
        return b;
    }
    function errLine(wrap) {
        var p = el('p', 'ivp-err');
        p.setAttribute('role', 'alert');
        p.hidden = true;
        wrap.appendChild(p);
        return {
            say: function (text) { p.textContent = text || ''; p.hidden = !text; }
        };
    }
    function busy(btn, on, label) {
        if (!btn) return;
        if (on) {
            btn.dataset.label = btn.textContent;
            btn.textContent = label || t('One moment…');
            btn.disabled = true;
        } else {
            btn.textContent = btn.dataset.label || btn.textContent;
            btn.disabled = false;
        }
    }
    // the way on: into the dashboard for somebody signed in, and for anyone
    // else the front page, which is already behind the card
    function home(box, me) {
        if (me) {
            var a = el('a', 'ivp-btn2', t('Go to your dashboard'));
            a.href = '/dashboard';
            box.appendChild(a);
            return;
        }
        secondary(box, t('Close'), close);
    }
    function inviterName(d) {
        var by = d.inviter || {};
        return String(by.name || '').trim() || String(by.email || '').trim();
    }

    function signOut() {
        return fetch('/v1/auth/logout', { method: 'POST', credentials: 'same-origin' })
            .catch(function () {  })
            .then(function () { return load(); });
    }

    // ---- the invitation itself, still open

    function drawOpen(d) {
        var org = (d.org && d.org.name) || t('this organisation');
        var who = inviterName(d);
        var wrap = start(null, 'org');
        // who asked and as what are in the list below; a sentence saying it
        // again made the card taller than a laptop screen
        head(wrap, fill('Join {org}', { org: org }));

        var facts = el('dl', 'ivp-facts');
        function fact(label, value, small) {
            var r = el('div', 'ivp-fact');
            r.appendChild(el('dt', null, label));
            var dd = el('dd', null, value);
            if (small) dd.appendChild(el('small', null, small));
            r.appendChild(dd);
            facts.appendChild(r);
        }
        if (d.inviter) {
            var byName = String(d.inviter.name || '').trim();
            fact(t('Invited by'), byName || d.inviter.email, byName && d.inviter.email ? d.inviter.email : '');
        }
        var me = d.me;
        var owes = Boolean(me && me.matches && d.needMfa && !(me.totpOn && me.mfa));
        fact(t('Role'), roleName(d.role));
        fact(t('For'), d.email);
        fact(t('Open until'), dateOf(d.expiresAt));
        // where the note below is about two-factor, the row would say it twice
        if (d.needMfa && !owes) fact(t('Two-factor'), t('Required to join'));
        wrap.appendChild(facts);

        if (!me) return drawSignedOut(wrap, d, org);
        if (!me.matches) return drawSomeoneElse(wrap, d);

        var err;
        var box;
        if (owes && !me.totpOn) {
            note(wrap, 'shield', fill('{org} asks every member to use two-factor', { org: org }),
                t('Add an authenticator app to your account first. It takes about a minute, and you come straight back here to accept.'));
            box = acts(wrap);
            primary(box, t('Set up two-factor'), function () {
                // the Security page reads this, says why it opened, and opens
                // the dialog for adding an app; the address stays clean
                try { sessionStorage.setItem('sp-invite-2fa', String(Date.now())); } catch (e) {  }
                location.assign('/account/security');
            });
            secondary(box, t('Decline'), function () { askDecline(d, org, who); });
            box.classList.add('is-row');
        } else if (owes) {
            note(wrap, 'shield', t('Sign in again with a code'),
                fill('This session was opened without a code from your app, and {org} asks for one. Sign in again and you come straight back here.', { org: org }));
            box = acts(wrap);
            primary(box, t('Sign in again'), function (b) { busy(b, true); signOut(); });
            secondary(box, t('Decline'), function () { askDecline(d, org, who); });
            box.classList.add('is-row');
        } else {
            box = acts(wrap);
            primary(box, t('Accept invitation'), function (b) { accept(b, err); });
            secondary(box, t('Decline'), function () { askDecline(d, org, who); });
            box.classList.add('is-row');
        }
        err = errLine(wrap);
        signedInAs(wrap, me);
    }

    function signedInAs(wrap, me) {
        var p = el('p', 'ivp-who');
        p.appendChild(document.createTextNode(t('Signed in as') + ' '));
        p.appendChild(el('b', null, me.email));
        p.appendChild(document.createTextNode('. '));
        var out = el('button', 'ivp-link', t('Not you?'));
        out.type = 'button';
        out.addEventListener('click', function () { signOut(); });
        p.appendChild(out);
        wrap.appendChild(p);
    }

    // Signed out: both ways in, always, with the address filled in and fixed.
    // Which one fits is not said here, because saying it would tell whoever
    // holds the link whether that address has an account.
    function drawSignedOut(wrap, d, org) {
        var box = acts(wrap);
        primary(box, t('Create account and join'), function () { openAuth('create', d, org); });
        secondary(box, t('I already have an account'), function () { openAuth('login', d, org); });
    }

    // The sign in takes the card's place, and closing it without signing in
    // brings the card back, so nobody is left on the front page wondering
    // where the invitation went.
    function openAuth(mode, d, org) {
        var M = window.SentinelAuthModal;
        if (!M) { location.assign('/?signin=' + (mode === 'create' ? 'create' : '1')); return; }
        hide();
        M.open(mode);
        var auth = document.getElementById('sp-authm-backdrop');
        if (auth && window.MutationObserver) {
            var watch = new MutationObserver(function () {
                if (!auth.hidden) return;
                watch.disconnect();
                show();
            });
            watch.observe(auth, { attributes: true, attributeFilter: ['hidden'] });
        }
        fillAuth(mode, d, org);
    }
    function fillAuth(mode, d, org) {
        ['sp-authm-email', 'sp-authm-email2'].forEach(function (id) {
            var i = document.getElementById(id);
            if (!i) return;
            i.value = d.email;
            i.readOnly = true;
            i.setAttribute('aria-readonly', 'true');
            i.classList.add('ivp-locked');
        });
        var pIn = document.getElementById('sp-authm-p-in');
        var pUp = document.getElementById('sp-authm-p-up');
        if (pIn) pIn.textContent = fill('Sign in to accept the invitation to {org}.', { org: org });
        if (pUp) pUp.textContent = fill('Create your account to join {org}.', { org: org });
        if (mode !== 'create') {
            setTimeout(function () {
                var pass = document.getElementById('sp-authm-pass');
                if (pass) pass.focus({ preventScroll: true });
            }, 80);
        }
    }

    function drawSomeoneElse(wrap, d) {
        note(wrap, 'swap', t('Signed in with a different address'),
            fill('This invitation is for {email}. You are signed in as {me}.', { email: d.email, me: d.me.email }),
            'warn');
        var box = acts(wrap);
        primary(box, t('Sign out and continue'), function (b) { busy(b, true); signOut(); });
        secondary(box, t('Not now'), function (b) {
            busy(b, true);
            post('/v1/invites/decline', {}).catch(function () {  }).then(function () {
                location.assign('/dashboard');
            });
        });
        box.classList.add('is-row');
    }

    function accept(btn, err) {
        busy(btn, true, t('Joining…'));
        if (err) err.say('');
        post('/v1/invites/accept', {}).then(function (out) {
            try {
                sessionStorage.setItem('sp-joined', JSON.stringify({ org: out.org || '', role: out.role || '' }));
            } catch (e) {  }
            location.assign('/dashboard/org/' + encodeURIComponent(out.slug));
        }).catch(function (e) {
            busy(btn, false);
            if (err) err.say(e.message);
            // whatever changed on the way (cancelled, run out) is drawn as it is now
            if (e.status === 409) setTimeout(load, 1800);
        });
    }

    // Declining closes the invitation and tells whoever sent it, so it is
    // asked once more, on the card, rather than done on the first click.
    function askDecline(d, org, who) {
        var wrap = start(null, 'x', 'off');
        head(wrap, fill('Decline the invitation to {org}?', { org: org }),
            who ? fill('{name} will be told, and the link stops working. They can send you a new one later.', { name: who })
                : t('Whoever sent it will be told, and the link stops working.'));
        var box = acts(wrap);
        var err;
        primary(box, t('Decline invitation'), function (b) {
            busy(b, true);
            err.say('');
            post('/v1/invites/decline', { answer: 'no' }).then(function (out) {
                if (!out.declined) { load(); return; }
                var done = start(null, 'check', 'off');
                head(done, t('Invitation declined'),
                    who ? fill('{name} has been told. Nothing else happens.', { name: who }) : t('Nothing else happens.'));
                home(acts(done), d.me);
            }).catch(function (e) {
                busy(b, false);
                err.say(e.message);
            });
        }, true);
        secondary(box, t('Back'), function () { draw(); });
        err = errLine(wrap);
    }

    // ---- an invitation that can no longer be used, and why

    function drawClosed(d) {
        var who = d.state === 'missing' ? '' : inviterName(d);
        var org = (d.org && d.org.name) || '';
        var me = d.me;
        var wrap;
        var box;
        if (d.state === 'accepted' && me && me.member && d.org && d.org.slug) {
            wrap = start(null, 'check');
            head(wrap, fill('You are already in {org}', { org: org }),
                t('This invitation has been used, and the organisation is open to you.'));
            box = acts(wrap);
            var open = el('a', 'lp-demo-submit', fill('Open {org}', { org: org }));
            open.href = '/dashboard/org/' + encodeURIComponent(d.org.slug);
            open.style.display = 'block';
            open.style.textAlign = 'center';
            open.style.textDecoration = 'none';
            box.appendChild(open);
            return;
        }
        if (d.state === 'expired') {
            wrap = start(null, 'clock', 'warn');
            head(wrap, t('This invitation has expired'),
                (who ? fill('It was open until {date}. Ask {name} to send you a new one.', { date: dateOf(d.expiresAt), name: who })
                     : fill('It was open until {date}. Ask whoever invited you to send a new one.', { date: dateOf(d.expiresAt) })));
        } else if (d.state === 'withdrawn') {
            wrap = start(null, 'x', 'off');
            head(wrap, t('This invitation was cancelled'),
                who ? fill('Somebody in {org} cancelled it. If you still need access, ask {name}.', { org: org, name: who })
                    : fill('Somebody in {org} cancelled it.', { org: org }));
        } else if (d.state === 'declined') {
            wrap = start(null, 'x', 'off');
            head(wrap, t('You declined this invitation'),
                who ? fill('If you change your mind, ask {name} to send it again.', { name: who })
                    : t('If you change your mind, ask for it to be sent again.'));
        } else if (d.state === 'accepted') {
            wrap = start(null, 'check', 'off');
            head(wrap, t('This invitation has been used'),
                who ? fill('Each invitation opens once. Ask {name} for a new one if you need access.', { name: who })
                    : t('Each invitation opens once. Ask for a new one if you need access.'));
        } else {
            wrap = start(null, 'link', 'off');
            head(wrap, t(d.broken ? 'The invitation could not be read' : 'This invitation link does not work'),
                t(d.broken ? 'Something went wrong on our side. Reload the page to try again.'
                           : 'Open the link from the email again, all of it. If it still does not work, ask whoever invited you to send a new one.'));
        }
        home(acts(wrap), me);
    }

    function draw() {
        if (!now) return;
        if (now.state === 'sent') drawOpen(now);
        else drawClosed(now);
    }

    // After every script on the page has run, so the words are in the
    // reader's language from the first frame. The card used to open at once,
    // over the front page's loader, and fill in while the loader was still
    // spinning behind it. Now the invitation is asked for straight away and
    // the card comes up once the loader has gone, the way the sign in from a
    // reset link does, with the answer already in it. If the answer is slow
    // the card opens with its placeholder rather than keep anyone waiting.
    function begin() {
        // back at the invitation, so the Security page is no longer on its way
        try { sessionStorage.removeItem('sp-invite-2fa'); } catch (e) {  }
        var answered = false;
        var clear = false;
        var slow = null;
        function up() {
            if (shown || !clear) return;
            clearTimeout(slow);
            show();
        }
        load().then(function () { answered = true; up(); });
        loaderGone(function () {
            clear = true;
            if (answered) up();
            else slow = setTimeout(up, 700);
        });
    }
    // The loader is gone once it is out of the page, or faded to nothing.
    // This script runs before the sign in's, which has the same wait, so it
    // keeps its own. Eight seconds is the most anyone is kept waiting.
    function loaderGone(go) {
        var done = false;
        var obs = null;
        function gone() {
            var l = document.getElementById('sp-loader');
            if (!l) return true;
            return l.classList.contains('spl-done') && !(parseFloat(getComputedStyle(l).opacity) > 0.01);
        }
        function settle() {
            if (done) return;
            done = true;
            if (obs) obs.disconnect();
            document.removeEventListener('transitionend', look, true);
            go();
        }
        function look() { if (!done && gone()) settle(); }
        if (window.MutationObserver) {
            obs = new MutationObserver(look);
            obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        }
        document.addEventListener('transitionend', look, true);
        setTimeout(settle, 8000);
        look();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin);
    else begin();
})();
