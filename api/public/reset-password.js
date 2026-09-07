/* setting a password from a link.
   ------------------------------------------------------------------------
   the token is checked twice: once by the server before this page is served
   at all, and once here, so the page can say whose reset it is and whether an
   account exists behind it. a dead token never reaches this file, but it can
   die while somebody is reading the page, and every answer from the server is
   treated as the last word rather than as something to argue with.

   what this file does not decide: whether the token is good, whether an
   account exists, or whether the password is strong enough. all three are the
   server's answers. this only draws them. */
(function () {
    var t = function (x) { return window.SentinelI18n ? window.SentinelI18n.t(x) : x; };
    function lang() {
        return (window.SentinelI18n && typeof window.SentinelI18n.lang === 'function'
            ? window.SentinelI18n.lang() : 'en') || 'en';
    }

    var form = document.getElementById('rp-form');
    if (!form) return;

    var card = document.getElementById('rp-card');
    var names = document.getElementById('rp-names');
    var consentWrap = document.getElementById('rp-consent-wrap');
    var consentBox = document.getElementById('rp-consent');
    var first = document.getElementById('rp-first');
    var last = document.getElementById('rp-last');
    var pass = document.getElementById('rp-pass');
    var pass2 = document.getElementById('rp-pass2');
    var submitBtn = document.getElementById('rp-submit');
    var forLine = document.getElementById('rp-for');
    var done = document.getElementById('rp-done');
    var head = document.getElementById('rp-h');
    var sub = document.getElementById('rp-p');

    // the token was taken out of the address bar by an inline script in the head,
    // before anything else on the page ran. that ordering is the point: this file
    // is deferred, and by the time a deferred script runs every third party
    // snippet has already had its look at location.href. a reset token is not a
    // thing to hand to somebody's analytics.
    //
    // the fallback is only for a page served without that script.
    var token = '';
    try {
        token = window.__SP_RESET_TOKEN || '';
        try { delete window.__SP_RESET_TOKEN; } catch (e2) { window.__SP_RESET_TOKEN = ''; }
        if (!token) {
            token = new URLSearchParams(location.search).get('token') || '';
            if (token && history.replaceState) history.replaceState(null, '', location.pathname);
        }
    } catch (e) { /* an old browser keeps the url; the token still works */ }

    function expired() { location.replace('/token-expired'); }

    function post(url, body) {
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (data) {
                if (r.ok) return data;
                var err = new Error('http_' + r.status);
                err.reason = data && data.error;
                err.status = r.status;
                throw err;
            });
        });
    }

    function replay(node, cls) {
        if (!node) return;
        node.classList.remove(cls);
        void node.offsetWidth;
        node.classList.add(cls);
    }

    var err = document.createElement('p');
    err.classList.add('sp-auth-verr');
    err.classList.add('sp-auth-ferr');
    err.hidden = true;
    err.setAttribute('role', 'alert');
    form.insertBefore(err, submitBtn);

    function say(msg) {
        err.textContent = msg || '';
        err.hidden = !msg;
        if (msg) replay(err, 'sp-auth-enter');
    }

    // ---- what the page is for -----------------------------------------------

    var makingAccount = false;

    if (!token) { expired(); return; }
    form.hidden = true;

    post('/v1/auth/reset-check', { token: token }).then(function (out) {
        makingAccount = !out.hasAccount;

        forLine.textContent = t('For') + ' ' + out.email;
        forLine.hidden = false;

        if (makingAccount) {
            // there is no account on this address yet, and finishing here makes
            // one. it must carry what the sign-up form asks for, or it is an
            // account with nobody's name on it and no record of the terms.
            names.hidden = false;
            consentWrap.hidden = false;
            head.textContent = t('Create your account');
            sub.textContent = t('This address has no account yet. Choose a password and it is yours; the link you clicked is the proof the address is.');
            submitBtn.textContent = t('Create account');
        }
        form.hidden = false;
        replay(form, 'sp-auth-enter');
        var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        if (!coarse) (makingAccount ? first : pass).focus({ preventScroll: true });
    }).catch(function (failed) {
        // 410 is the link being gone. anything else is us being unreachable,
        // and sending somebody to "expired" for a network blip would tell them
        // to ask for a link they do not need.
        if (failed && failed.status === 410) { expired(); return; }
        form.hidden = false;
        say(t('Could not reach us just now. Please try again in a moment.'));
    });

    // ---- saving it ----------------------------------------------------------

    function markConsent(ok) {
        consentWrap.classList.toggle('lp-demo-consent-err', !ok);
    }
    if (consentBox) {
        consentBox.addEventListener('change', function () {
            if (consentBox.checked) markConsent(true);
        });
    }

    var busy = false;
    form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (busy) return;

        var password = pass.value;
        var repeat = pass2.value;

        if (makingAccount && (!first.value.trim() || !last.value.trim())) {
            say(t('Please fill in every field.'));
            (first.value.trim() ? last : first).focus();
            return;
        }
        if (!password || !repeat) { say(t('Please fill in every field.')); return; }
        // checked here as well as by the server, because the server is told one
        // password and cannot see that the second box disagreed with the first
        if (password !== repeat) {
            say(t('The two passwords do not match.'));
            pass2.value = '';
            pass2.focus();
            return;
        }
        if (makingAccount && !consentBox.checked) {
            markConsent(false);
            say(t('Please accept the terms of service to continue.'));
            return;
        }

        say('');
        busy = true;
        submitBtn.disabled = true;
        var label = submitBtn.textContent;
        submitBtn.textContent = t('Saving…');

        post('/v1/auth/reset', {
            token: token,
            password: password,
            firstName: first.value.trim(),
            lastName: last.value.trim(),
            consent: makingAccount ? !!consentBox.checked : undefined,
            lang: lang()
        }).then(function () {
            form.hidden = true;
            done.hidden = false;
            replay(done, 'sp-auth-enter');
            if (card) card.style.height = '';
            // replace rather than assign: back must not return to a form whose
            // token has just been spent
            setTimeout(function () { location.replace('/dashboard'); }, 1100);
        }).catch(function (failed) {
            if (failed && failed.status === 410) { expired(); return; }
            say(failed && failed.reason && failed.status < 500
                ? t(failed.reason)
                : t('Could not reach us just now. Please try again in a moment.'));
            busy = false;
            submitBtn.disabled = false;
            submitBtn.textContent = label;
            pass.value = '';
            pass2.value = '';
            pass.focus();
        });
    });
})();
