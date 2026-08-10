/* the sign-in dialog behind the nav's log in and get started buttons.
   it opens over whatever page you are on and leaves the address bar alone:
   signing in is not a change of place.

   the markup is built here rather than repeated in eleven html files, and it is
   built as soon as this script runs, which is before i18n walks the page. that
   is deliberate: a dialog created on first open would come back in english on a
   translated page.

   /auth is still a real page. the links keep pointing at it, this only
   intercepts the click, so a visitor with javascript off follows the same link
   and gets the same form on its own screen. */
(function () {
    if (document.getElementById('sp-authm')) return;

    var SHIELD =
        '<svg viewBox="0 0 120 120" fill="none" aria-hidden="true">' +
        '<defs><linearGradient id="spAuthmGrad" x1="0%" y1="0%" x2="100%" y2="100%">' +
        '<stop offset="0%" stop-color="#00c8ff"/><stop offset="100%" stop-color="#a020f0"/>' +
        '</linearGradient></defs>' +
        '<g fill="none" stroke="url(#spAuthmGrad)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M60 15 L25 30 V55 C25 80 50 100 60 105 C70 100 95 80 95 55 V30 Z"/>' +
        '<path d="M38 60 Q 60 40 82 60 Q 60 80 38 60 Z"/>' +
        '<circle cx="60" cy="60" r="6"/></g></svg>';

    var wrap = document.createElement('div');
    wrap.className = 'sp-authm-backdrop';
    wrap.id = 'sp-authm-backdrop';
    wrap.hidden = true;
    wrap.innerHTML =
        '<div class="sp-authm" id="sp-authm" role="dialog" aria-modal="true" aria-labelledby="sp-authm-h-in">' +
            '<div class="sp-auth-panel sp-authm-panel">' +
                '<button type="button" class="sp-authm-x" id="sp-authm-close" aria-label="close">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">' +
                    '<path d="M6 6l12 12M18 6L6 18"></path></svg>' +
                '</button>' +
                '<div class="sp-authm-head">' +
                    '<span class="sp-authm-brand">' + SHIELD + '<span>sentinelpay</span></span>' +
                    '<h2 class="sp-authm-h" id="sp-authm-h-in">welcome back</h2>' +
                    '<h2 class="sp-authm-h" id="sp-authm-h-up" hidden>create your account</h2>' +
                    '<p class="sp-authm-p" id="sp-authm-p-in">sign in to check a wallet and pick up where you left off.</p>' +
                    '<p class="sp-authm-p" id="sp-authm-p-up" hidden>one account for your whole team, with every wallet you check kept in one place.</p>' +
                '</div>' +
                '<div class="sp-auth-tabs" role="tablist">' +
                    '<button type="button" class="sp-auth-tab is-active" id="sp-authm-tab-in" role="tab" aria-selected="true" aria-controls="sp-authm-panel-in">log in</button>' +
                    '<button type="button" class="sp-auth-tab" id="sp-authm-tab-up" role="tab" aria-selected="false" aria-controls="sp-authm-panel-up">create account</button>' +
                '</div>' +

                '<form class="sp-auth-form" id="sp-authm-panel-in" role="tabpanel" novalidate>' +
                    '<div class="sp-auth-field">' +
                        '<label for="sp-authm-email">work email</label>' +
                        '<input id="sp-authm-email" name="email" type="email" autocomplete="email" placeholder="you@yourcompany.com">' +
                    '</div>' +
                    '<div class="sp-auth-field">' +
                        '<label for="sp-authm-pass">password</label>' +
                        '<input id="sp-authm-pass" name="password" type="password" autocomplete="current-password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;">' +
                    '</div>' +
                    '<div class="sp-auth-row">' +
                        '<label class="sp-auth-remember"><input type="checkbox" name="remember"><span>keep me signed in</span></label>' +
                        '<a class="sp-auth-link" href="/start-free-trial">forgot your password?</a>' +
                    '</div>' +
                    '<button type="submit" class="sp-auth-submit">log in</button>' +
                '</form>' +

                '<form class="sp-auth-form" id="sp-authm-panel-up" role="tabpanel" novalidate hidden>' +
                    '<div class="sp-auth-pair">' +
                        '<div class="sp-auth-field">' +
                            '<label for="sp-authm-first">first name</label>' +
                            '<input id="sp-authm-first" name="firstName" type="text" autocomplete="given-name">' +
                        '</div>' +
                        '<div class="sp-auth-field">' +
                            '<label for="sp-authm-last">last name</label>' +
                            '<input id="sp-authm-last" name="lastName" type="text" autocomplete="family-name">' +
                        '</div>' +
                    '</div>' +
                    '<div class="sp-auth-field">' +
                        '<label for="sp-authm-email2">work email</label>' +
                        '<input id="sp-authm-email2" name="email" type="email" autocomplete="email" placeholder="you@yourcompany.com">' +
                    '</div>' +
                    '<div class="sp-auth-field">' +
                        '<label for="sp-authm-pass2">password</label>' +
                        '<input id="sp-authm-pass2" name="password" type="password" autocomplete="new-password" placeholder="at least 12 characters">' +
                    '</div>' +
                    '<label class="sp-auth-consent"><input type="checkbox" name="consent"><span>i agree to <a href="/terms-of-service">the terms of service</a> and to be contacted about this account.</span></label>' +
                    '<button type="submit" class="sp-auth-submit">create account</button>' +
                '</form>' +

                '<p class="sp-auth-note">accounts open when the product launches. until then the trial link we email you is the way in.</p>' +
                '<p class="sp-authm-alt" id="sp-authm-alt-in">no account yet? <a class="sp-auth-link" href="/start-free-trial">start a free trial</a></p>' +
                '<p class="sp-authm-alt" id="sp-authm-alt-up" hidden>already have an account? <button type="button" class="sp-auth-link sp-auth-link-btn" id="sp-authm-to-in">log in</button></p>' +
            '</div>' +
        '</div>';

    (document.body || document.documentElement).appendChild(wrap);

    var box = document.getElementById('sp-authm');
    var tabIn = document.getElementById('sp-authm-tab-in');
    var tabUp = document.getElementById('sp-authm-tab-up');
    var panelIn = document.getElementById('sp-authm-panel-in');
    var panelUp = document.getElementById('sp-authm-panel-up');
    var closeBtn = document.getElementById('sp-authm-close');
    var lastFocus = null;
    var t = function (x) { return window.SentinelI18n ? window.SentinelI18n.t(x) : x; };

    function swap(login) {
        tabIn.classList.toggle('is-active', login);
        tabUp.classList.toggle('is-active', !login);
        tabIn.setAttribute('aria-selected', login ? 'true' : 'false');
        tabUp.setAttribute('aria-selected', login ? 'false' : 'true');
        panelIn.hidden = !login;
        panelUp.hidden = login;
        ['sp-authm-h-', 'sp-authm-p-', 'sp-authm-alt-'].forEach(function (k) {
            var a = document.getElementById(k + 'in'), b = document.getElementById(k + 'up');
            if (a) a.hidden = !login;
            if (b) b.hidden = login;
        });
        box.setAttribute('aria-labelledby', login ? 'sp-authm-h-in' : 'sp-authm-h-up');
    }

    function open(mode) {
        lastFocus = document.activeElement;
        swap(mode !== 'create');
        wrap.hidden = false;
        // one frame, so the transition has a state to move from
        requestAnimationFrame(function () { wrap.classList.add('is-open'); });
        document.documentElement.classList.add('sp-authm-open');
        var first = (mode === 'create' ? panelUp : panelIn).querySelector('input');
        if (first) setTimeout(function () { first.focus({ preventScroll: true }); }, 60);
    }

    function close() {
        wrap.classList.remove('is-open');
        document.documentElement.classList.remove('sp-authm-open');
        setTimeout(function () { wrap.hidden = true; }, 200);
        // back to the button that opened it, so the keyboard does not lose its place
        if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    }

    tabIn.addEventListener('click', function () { swap(true); });
    tabUp.addEventListener('click', function () { swap(false); });
    var toIn = document.getElementById('sp-authm-to-in');
    if (toIn) toIn.addEventListener('click', function () { swap(true); });
    closeBtn.addEventListener('click', close);
    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) close(); });
    document.addEventListener('keydown', function (e) {
        if (wrap.hidden) return;
        if (e.key === 'Escape') { close(); return; }
        if (e.key !== 'Tab') return;
        // keep tabbing inside the dialog while it is up
        var f = box.querySelectorAll('a[href], button:not([disabled]), input:not([disabled])');
        var vis = [];
        for (var i = 0; i < f.length; i++) if (f[i].offsetParent !== null) vis.push(f[i]);
        if (!vis.length) return;
        var first = vis[0], last = vis[vis.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    [panelIn, panelUp].forEach(function (f) {
        f.addEventListener('submit', function (e) {
            e.preventDefault();
            var msg = 'accounts are not open yet. start a free trial and we will email you the way in.';
            if (window.SentinelToast) window.SentinelToast.show(t(msg), 'info');
        });
    });

    // the nav keeps pointing at /auth, so this is an enhancement rather than the
    // only way in. anything linking there opens the dialog instead.
    document.addEventListener('click', function (e) {
        var a = e.target.closest && e.target.closest('a[href]');
        if (!a) return;
        var href = a.getAttribute('href') || '';
        var m = href.match(/(?:^|\/\/[^/]+)\/auth(#create)?$/);
        if (!m) return;
        // on /auth itself the page is already the form; leave those links alone
        if (location.pathname.replace(/\/+$/, '') === '/auth') return;
        e.preventDefault();
        open(m[1] ? 'create' : 'login');
    });
})();
