/* the signed-in page.

   the server has already refused to send this page to anybody without a good
   cookie, so this file is not a guard. it fills in the four facts about the
   account and signs the person out again, and that is all it does.

   the details are fetched rather than rendered into the html on purpose. the
   page itself is the same bytes for everybody, so it can be cached, diffed and
   reasoned about; the name and the address arrive over a request that answers
   no-store. it also means one place decides who somebody is, `/v1/auth/me`, and
   the navigation on every other page asks the same question the same way. */
(function () {
    var t = function (x) { return window.SentinelI18n ? window.SentinelI18n.t(x) : x; };

    function set(id, value) {
        var el = document.getElementById(id);
        if (el && value) el.textContent = value;
    }

    // "member since 14 august 2026", in the language the page is in. the date
    // arrives as an iso string from the server, which is the only format that
    // means the same thing in every timezone.
    function niceDate(iso) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        var lang = (window.SentinelI18n && window.SentinelI18n.lang && window.SentinelI18n.lang()) || 'en';
        var locale = lang === 'hr' ? 'hr-HR' : (lang === 'de' ? 'de-DE' : 'en-GB');
        try {
            return d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
        } catch (err) {
            return d.toISOString().slice(0, 10);
        }
    }

    fetch('/v1/auth/me', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (me) {
            // the cookie can go stale between the server's check and this call:
            // a sign-out in another tab, or a session we ended from our side
            if (!me || !me.signedIn) { location.replace('/auth'); return; }
            set('dash-name', me.name);
            set('dash-email', me.email);
            set('dash-since', niceDate(me.since));
            var first = String(me.name || '').trim().split(/\s+/)[0];
            if (first) set('dash-greet', t('Welcome back') + ', ' + first);
            // the panel appears for staff. it is a set of links and nothing
            // else: every page behind it checks the session for itself, so
            // unhiding this by hand in a browser opens nothing.
            var staff = document.getElementById('dash-staff');
            if (staff && me.staff) staff.hidden = false;
            twoFactor(me);
            accountTools(me);
        })
        .catch(function () {
            // the page is already on screen and says nothing untrue: the rows
            // simply stay as dashes rather than the page throwing somebody out
            // over one failed request
        });

    // ---- two-factor ---------------------------------------------------------
    // three states in one card: off, being set up, and on. the card is drawn
    // from what /v1/auth/me says rather than from what the last button press
    // did, so a second tab that switched it on is not contradicted by this one.
    function twoFactor(me) {
        var card = document.getElementById('dash-2fa');
        if (!card) return;
        var stateEl = document.getElementById('dash-2fa-state');
        var startBtn = document.getElementById('dash-2fa-start');
        var offBtn = document.getElementById('dash-2fa-off');
        var setup = document.getElementById('dash-2fa-setup');
        var codesBox = document.getElementById('dash-2fa-codes');
        var offBox = document.getElementById('dash-2fa-offbox');
        var errEl = document.getElementById('dash-2fa-err');

        function say(msg, good) {
            if (!errEl) return;
            errEl.textContent = msg || '';
            errEl.hidden = !msg;
            errEl.classList.toggle('sp-dash-good', Boolean(good));
            errEl.classList.toggle('sp-dash-err', !good);
        }

        function post(url, body) {
            return fetch(url, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body || {}),
            }).then(function (r) {
                return r.json().catch(function () { return {}; }).then(function (d) {
                    if (!r.ok) {
                        var e = new Error(d.error || 'failed');
                        e.status = r.status;
                        throw e;
                    }
                    return d;
                });
            });
        }

        function paint(on, left, needed) {
            if (startBtn) startBtn.hidden = on;
            if (offBtn) offBtn.hidden = !on;
            if (!stateEl) return;
            if (on) {
                stateEl.textContent = t('Two-factor is on for this account.') +
                    (left || left === 0 ? ' ' + t('Recovery codes left') + ': ' + left + '.' : '');
            } else if (needed) {
                stateEl.textContent = t('This address is on the staff list, so two-factor is required before the staff pages will open.');
            }
        }

        paint(Boolean(me.totp), me.recoveryLeft, me.staffNeeds2fa);

        if (startBtn) {
            startBtn.addEventListener('click', function () {
                say('');
                startBtn.disabled = true;
                post('/v1/account/totp/start').then(function (out) {
                    startBtn.disabled = false;
                    if (setup) setup.hidden = false;
                    var secretEl = document.getElementById('dash-2fa-secret');
                    if (secretEl) secretEl.textContent = out.grouped || out.secret;
                    var linkEl = document.getElementById('dash-2fa-link');
                    if (linkEl) linkEl.href = out.url;
                    var codeEl = document.getElementById('dash-2fa-code');
                    if (codeEl) codeEl.focus();
                }).catch(function (err) {
                    startBtn.disabled = false;
                    say(err.message);
                });
            });
        }

        var confirmBtn = document.getElementById('dash-2fa-confirm');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', function () {
                var codeEl = document.getElementById('dash-2fa-code');
                var code = codeEl ? codeEl.value.trim() : '';
                if (!code) return;
                say('');
                confirmBtn.disabled = true;
                post('/v1/account/totp/confirm', { code: code }).then(function (out) {
                    confirmBtn.disabled = false;
                    if (setup) setup.hidden = true;
                    if (codesBox) codesBox.hidden = false;
                    var list = document.getElementById('dash-2fa-codelist');
                    if (list) list.textContent = (out.codes || []).join('   ');
                    paint(true, (out.codes || []).length);
                    say(t('Two-factor is on.'), true);
                }).catch(function (err) {
                    confirmBtn.disabled = false;
                    say(err.message);
                    if (codeEl) { codeEl.value = ''; codeEl.focus(); }
                });
            });
        }

        if (offBtn) {
            offBtn.addEventListener('click', function () {
                say('');
                if (offBox) offBox.hidden = false;
                var pw = document.getElementById('dash-2fa-pw');
                if (pw) pw.focus();
            });
        }

        var offGo = document.getElementById('dash-2fa-offgo');
        if (offGo) {
            offGo.addEventListener('click', function () {
                var pw = document.getElementById('dash-2fa-pw');
                var value = pw ? pw.value : '';
                if (!value) return;
                say('');
                offGo.disabled = true;
                post('/v1/account/totp/off', { password: value }).then(function () {
                    offGo.disabled = false;
                    if (pw) pw.value = '';
                    if (offBox) offBox.hidden = true;
                    if (codesBox) codesBox.hidden = true;
                    paint(false);
                    say(t('Two-factor is off.'), true);
                }).catch(function (err) {
                    offGo.disabled = false;
                    say(err.message);
                    if (pw) { pw.value = ''; pw.focus(); }
                });
            });
        }
    }

    // ---- password, sessions, erasure ----------------------------------------
    // the three things somebody should be able to do about their own account
    // without writing to us. all three go through the same small helper, and all
    // three say what happened in the card rather than in a toast that has gone by
    // the time you look up.
    function accountTools(me) {
        function post(url, body) {
            return fetch(url, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body || {}),
            }).then(function (r) {
                return r.json().catch(function () { return {}; }).then(function (d) {
                    if (!r.ok) { var e = new Error(d.error || 'failed'); e.status = r.status; throw e; }
                    return d;
                });
            });
        }
        function note(id, msg, good) {
            var el = document.getElementById(id);
            if (!el) return;
            el.textContent = msg || '';
            el.hidden = !msg;
            el.classList.toggle('sp-dash-good', Boolean(good));
            el.classList.toggle('sp-dash-err', !good);
        }

        var pwGo = document.getElementById('dash-pw-go');
        if (pwGo) {
            pwGo.addEventListener('click', function () {
                var cur = document.getElementById('dash-pw-current');
                var nxt = document.getElementById('dash-pw-next');
                if (!cur.value || !nxt.value) { note('dash-pw-err', t('Please fill in every field.')); return; }
                note('dash-pw-err', '');
                pwGo.disabled = true;
                post('/v1/account/password', { current: cur.value, next: nxt.value }).then(function (out) {
                    pwGo.disabled = false;
                    cur.value = ''; nxt.value = '';
                    note('dash-pw-err', t('Your password is changed.') +
                        (out.otherSessionsEnded ? ' ' + t('Other sessions ended') + ': ' + out.otherSessionsEnded + '.' : ''), true);
                    loadSessions();
                }).catch(function (err) {
                    pwGo.disabled = false;
                    note('dash-pw-err', err.message);
                });
            });
        }

        function when(iso) {
            var d = new Date(iso);
            if (isNaN(d.getTime())) return '';
            var lang = (window.SentinelI18n && window.SentinelI18n.lang && window.SentinelI18n.lang()) || 'en';
            var locale = lang === 'hr' ? 'hr-HR' : (lang === 'de' ? 'de-DE' : 'en-GB');
            try { return d.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }); }
            catch (err) { return d.toISOString().slice(0, 16).replace('T', ' '); }
        }

        function loadSessions() {
            var box = document.getElementById('dash-sessions-list');
            if (!box) return;
            fetch('/v1/account/sessions', { credentials: 'same-origin' })
                .then(function (r) { return r.json(); })
                .then(function (out) {
                    var rows = (out && out.sessions) || [];
                    if (!rows.length) { box.textContent = ''; return; }
                    box.textContent = rows.map(function (x) {
                        return (x.current ? t('This browser') : t('Another browser')) +
                            ' · ' + t('last used') + ' ' + when(x.lastSeenAt) +
                            (x.mfa ? ' · ' + t('with a code') : '');
                    }).join('\n');
                    box.style.whiteSpace = 'pre-line';
                })
                .catch(function () { box.textContent = ''; });
        }
        loadSessions();

        var revoke = document.getElementById('dash-sessions-revoke');
        if (revoke) {
            revoke.addEventListener('click', function () {
                revoke.disabled = true;
                post('/v1/account/sessions/revoke').then(function (out) {
                    revoke.disabled = false;
                    note('dash-sessions-err', t('Other sessions ended') + ': ' + (out.ended || 0) + '.', true);
                    loadSessions();
                }).catch(function (err) {
                    revoke.disabled = false;
                    note('dash-sessions-err', err.message);
                });
            });
        }

        var delGo = document.getElementById('dash-del-go');
        if (delGo) {
            var armed = false;
            delGo.addEventListener('click', function () {
                var pw = document.getElementById('dash-del-pw');
                if (!pw.value) { note('dash-del-err', t('Please fill in every field.')); return; }
                // asked twice, because the second press is the one that means it
                if (!armed) {
                    armed = true;
                    delGo.textContent = t('Press again to delete');
                    note('dash-del-err', t('This cannot be undone.'));
                    setTimeout(function () {
                        armed = false;
                        delGo.textContent = t('Delete it');
                    }, 6000);
                    return;
                }
                delGo.disabled = true;
                post('/v1/account/delete', { password: pw.value }).then(function () {
                    location.replace('/');
                }).catch(function (err) {
                    delGo.disabled = false;
                    armed = false;
                    delGo.textContent = t('Delete it');
                    note('dash-del-err', err.message);
                    pw.value = '';
                });
            });
        }
    }

    var out = document.getElementById('dash-logout');
    if (out) {
        out.addEventListener('click', function () {
            out.disabled = true;
            out.textContent = t('Signing out…');
            fetch('/v1/auth/logout', { method: 'POST', credentials: 'same-origin' })
                .catch(function () { /* the cookie is cleared by the server; try anyway */ })
                .then(function () { location.replace('/'); });
        });
    }
})();
