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

    var wrap = document.createElement('div');
    wrap.className = 'sp-authm-backdrop';
    wrap.id = 'sp-authm-backdrop';
    wrap.hidden = true;
    wrap.innerHTML =
        '<div class="sp-authm" id="sp-authm" role="dialog" aria-modal="true" aria-labelledby="sp-authm-h-in">' +
            '<div class="lp-demo-card bad-form-card sp-authm-panel">' +
                '<span class="lp-demo-dots" aria-hidden="true"></span>' +
                '<span class="lp-demo-edge" aria-hidden="true"></span>' +
                '<button type="button" class="sp-authm-x" id="sp-authm-close" aria-label="close">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">' +
                    '<path d="M6 6l12 12M18 6L6 18"></path></svg>' +
                '</button>' +
                '<div class="sp-authm-head">' +
                    '<h2 class="sp-authm-h" id="sp-authm-h-in">welcome back</h2>' +
                    '<h2 class="sp-authm-h" id="sp-authm-h-up" hidden>create your account</h2>' +
                    '<p class="sp-authm-p" id="sp-authm-p-in">sign in to check a wallet and pick up where you left off.</p>' +
                    '<p class="sp-authm-p" id="sp-authm-p-up" hidden>one account for your whole team, with every wallet you check kept in one place.</p>' +
                '</div>' +
                '<div class="sp-auth-tabs" role="tablist">' +
                    '<button type="button" class="sp-auth-tab is-active" id="sp-authm-tab-in" role="tab" aria-selected="true" aria-controls="sp-authm-panel-in">log in</button>' +
                    '<button type="button" class="sp-auth-tab" id="sp-authm-tab-up" role="tab" aria-selected="false" aria-controls="sp-authm-panel-up">create account</button>' +
                '</div>' +

                '<form class="sp-auth-form" id="sp-authm-panel-in" role="tabpanel" data-auth="login" novalidate>' +
                    '<div class="lp-demo-field lp-demo-field-full">' +
                        '<label for="sp-authm-email">work email</label>' +
                        '<input id="sp-authm-email" name="email" type="email" autocomplete="email" placeholder="you@yourcompany.com">' +
                    '</div>' +
                    '<div class="lp-demo-field lp-demo-field-full">' +
                        '<label for="sp-authm-pass">password</label>' +
                        '<input id="sp-authm-pass" name="password" type="password" autocomplete="current-password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;">' +
                    '</div>' +
                    '<div class="sp-auth-row">' +
                        '<label class="sp-auth-remember"><input type="checkbox" name="remember"><span>keep me signed in</span></label>' +
                        '<a class="sp-auth-link" href="/start-free-trial">forgot your password?</a>' +
                    '</div>' +
                    '<button type="submit" class="lp-demo-submit sp-auth-submit">log in</button>' +
                '</form>' +

                '<form class="sp-auth-form" id="sp-authm-panel-up" role="tabpanel" data-auth="register" novalidate hidden>' +
                    '<div class="lp-demo-grid">' +
                        '<div class="lp-demo-field">' +
                            '<label for="sp-authm-first">first name</label>' +
                            '<input id="sp-authm-first" name="firstName" type="text" autocomplete="given-name">' +
                        '</div>' +
                        '<div class="lp-demo-field">' +
                            '<label for="sp-authm-last">last name</label>' +
                            '<input id="sp-authm-last" name="lastName" type="text" autocomplete="family-name">' +
                        '</div>' +
                    '</div>' +
                    '<div class="lp-demo-field lp-demo-field-full">' +
                        '<label for="sp-authm-email2">work email</label>' +
                        '<input id="sp-authm-email2" name="email" type="email" autocomplete="email" placeholder="you@yourcompany.com">' +
                    '</div>' +
                    '<div class="lp-demo-field lp-demo-field-full">' +
                        '<label for="sp-authm-pass2">password</label>' +
                        '<input id="sp-authm-pass2" name="password" type="password" autocomplete="new-password" placeholder="at least 12 characters">' +
                    '</div>' +
                    '<label class="lp-demo-consent"><input type="checkbox" name="consent"><span>i agree to <a href="/terms-of-service">the terms of service</a> and to be contacted about this account.</span></label>' +
                    '<button type="submit" class="lp-demo-submit sp-auth-submit">create account</button>' +
                '</form>' +
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

    var panelEl = box.querySelector('.sp-authm-panel');
    var swapTimer = null;

    function apply(login) {
        tabIn.classList.toggle('is-active', login);
        tabUp.classList.toggle('is-active', !login);
        tabIn.setAttribute('aria-selected', login ? 'true' : 'false');
        tabUp.setAttribute('aria-selected', login ? 'false' : 'true');
        // a sign-up mid flight owns the card: the code panel is up, and putting
        // the empty form back because the dialog was reopened would throw away
        // both what was typed and the code already sent
        if (panelEl && panelEl.dataset.authStep && panelEl.dataset.authStep !== 'register') return;
        panelIn.hidden = !login;
        panelUp.hidden = login;
        ['sp-authm-h-', 'sp-authm-p-'].forEach(function (k) {
            var a = document.getElementById(k + 'in'), b = document.getElementById(k + 'up');
            if (a) a.hidden = !login;
            if (b) b.hidden = login;
        });
        box.setAttribute('aria-labelledby', login ? 'sp-authm-h-in' : 'sp-authm-h-up');
    }

    // restart an animation: removing the class is not enough on its own, the
    // element has to be laid out again in between or the browser sees no change
    function replay(el, cls) {
        if (!el) return;
        el.classList.remove(cls);
        void el.offsetWidth;
        el.classList.add(cls);
    }

    function swap(login, animate) {
        var already = !panelIn.hidden === login;
        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!animate || already || reduced || !panelEl) { apply(login); return; }

        // measure, switch, measure again, then glide between the two
        var from = panelEl.getBoundingClientRect().height;
        panelEl.style.height = '';
        apply(login);
        var to = panelEl.getBoundingClientRect().height;

        clearTimeout(swapTimer);
        panelEl.classList.remove('sp-auth-swapping');
        panelEl.style.height = from + 'px';
        void panelEl.offsetHeight;
        panelEl.classList.add('sp-auth-swapping');
        panelEl.style.height = to + 'px';

        var incoming = login ? panelIn : panelUp;
        // it arrives from the side its tab is on
        incoming.style.setProperty('--sp-auth-dir', login ? '-12px' : '12px');
        replay(incoming, 'sp-auth-enter');
        var head = document.getElementById(login ? 'sp-authm-h-in' : 'sp-authm-h-up');
        var sub = document.getElementById(login ? 'sp-authm-p-in' : 'sp-authm-p-up');
        [head, sub].forEach(function (el) {
            if (!el) return;
            el.style.setProperty('--sp-auth-dir', login ? '-12px' : '12px');
            replay(el, 'sp-auth-enter-head');
        });

        // hand the height back to the content once it has arrived, so a field
        // growing later is not trapped inside a fixed box
        swapTimer = setTimeout(function () {
            panelEl.classList.remove('sp-auth-swapping');
            panelEl.style.height = '';
        }, 320);
    }

    function open(mode) {
        lastFocus = document.activeElement;
        swap(mode !== 'create');
        wrap.hidden = false;
        // force a layout between showing it and starting the transition, so the
        // browser has a state to move from. a frame usually does it; a reflow
        // always does.
        void wrap.offsetWidth;
        wrap.classList.add('is-open');
        // measure the scrollbar before it is taken away, so the page behind can be
        // handed its width back and does not slide sideways as the dialog appears
        var sbw = window.innerWidth - document.documentElement.clientWidth;
        document.documentElement.style.setProperty('--sp-sbw', (sbw > 0 ? sbw : 0) + 'px');
        document.documentElement.classList.add('sp-authm-open');
        var first = (mode === 'create' ? panelUp : panelIn).querySelector('input');
        if (first) setTimeout(function () { first.focus({ preventScroll: true }); }, 60);
    }

    function close() {
        if (wrap.hidden) return;
        var done = false;
        // the fade out has to finish before anything is taken away. hiding on a
        // timer cut it off a third of the way through, and unlocking the page
        // first made everything behind jump while the dialog was still visible.
        function finish() {
            if (done) return;
            done = true;
            box.removeEventListener('transitionend', onEnd);
            wrap.hidden = true;
            document.documentElement.classList.remove('sp-authm-open');
            document.documentElement.style.removeProperty('--sp-sbw');
            // back to the button that opened it, so the keyboard keeps its place
            if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
        }
        function onEnd(e) {
            if (e.target === box && e.propertyName === 'opacity') finish();
        }
        box.addEventListener('transitionend', onEnd);
        wrap.classList.remove('is-open');
        // a safety net: if the transition never runs, nothing should be stuck open
        setTimeout(finish, 450);
    }

    tabIn.addEventListener('click', function () { swap(true, true); });
    tabUp.addEventListener('click', function () { swap(false, true); });
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

    // creating an account is handled by auth-flow.js. signing in is not built yet,
    // so that form says so rather than pretending to try.
    panelIn.addEventListener('submit', function (e) {
        e.preventDefault();
        var msg = 'signing in is not open yet. create an account and we will email you the moment it is.';
        if (window.SentinelToast) window.SentinelToast.show(t(msg), 'info');
    });

    // this script may run before or after the flow: whichever is second picks the
    // other up, so the dialog is never left as a form that does nothing
    if (window.SentinelAuthFlow) window.SentinelAuthFlow.scan();

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
