/* creating an account, front half.
   ------------------------------------------------------------------------
   the same code runs in the sign-in dialog and on /auth, because the two are
   the same card in two places and a second copy of this would drift from the
   first within a week. it attaches to any form marked data-auth="register" and
   builds the rest of the flow around it.

   the flow is: details, then a six digit code from the inbox, then the account.
   nothing exists after the first step. that is the point of the second one, so
   the panel makes it plain rather than pretending the account is already there.

   what this file will not do: decide anything. it can be edited by whoever is
   looking at it, so every rule that matters (has the code expired, how many are
   left, does this address already have an account) is answered by the server and
   simply displayed here. */
(function () {
    var t = function (x) { return window.SentinelI18n ? window.SentinelI18n.t(x) : x; };
    function lang() {
        return (window.SentinelI18n && typeof window.SentinelI18n.lang === 'function'
            ? window.SentinelI18n.lang() : 'en') || 'en';
    }
    var RESEND_WAIT = 60; // matches the server; it is the server's answer that counts

    // ---- the sign-up that is already under way -------------------------------
    // a code lives for a quarter of an hour, and in that time somebody will close
    // the dialog, read the terms, go and find the mail, come back. coming back
    // must land on the box for the code, not on the empty form: the account is
    // half made, and starting again would send a second code for no reason.
    //
    // it is remembered for as long as the page is open and no longer. a reload
    // is a fresh start, and after one there is no trace of it anywhere: nothing
    // in storage, nothing in a cookie, nothing left on a shared machine for the
    // next person. the code itself keeps working, so anyone who does reload can
    // sign up again and the same mail is waiting for them.
    var live = null;

    function pending() {
        if (!live) return null;
        if (Date.now() >= live.expires) { live = null; return null; }
        return live;
    }

    function remember(email, minutes, resendUntil) {
        live = {
            email: email,
            expires: Date.now() + (Number(minutes) || 15) * 60 * 1000,
            resendUntil: resendUntil || (Date.now() + RESEND_WAIT * 1000)
        };
    }

    function forgetPending() { live = null; }

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
                err.retryIn = data && data.retryIn;
                err.expiresInMin = data && data.expiresInMin;
                err.status = r.status;
                throw err;
            });
        });
    }

    // the message a failure should show. anything the server explained is shown
    // as it explained it: "that code has expired" sends somebody to the resend
    // button, "could not send" sends them to support for no reason.
    function reason(err) {
        if (err && err.reason && err.status && err.status < 500) return t(err.reason);
        return t('could not reach us just now. please try again in a moment.');
    }

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }

    // restart an animation: removing the class alone is not a change the browser
    // can see, the element has to be laid out again in between
    function replay(node, cls) {
        if (!node) return;
        node.classList.remove(cls);
        void node.offsetWidth;
        node.classList.add(cls);
    }

    function attach(form) {
        var card = form.closest('.lp-demo-card');
        if (!card || form.__spAuthFlow) return;
        form.__spAuthFlow = true;

        var root = card.closest('.sp-auth-stage') || card.closest('.sp-authm') || card;
        var tabs = card.querySelector('.sp-auth-tabs');
        var loginForm = card.querySelector('form[data-auth="login"]');
        // the copy beside or above the card belongs to whichever panel is up, so
        // it steps out of the way while the code is being entered
        var heads = root.querySelectorAll('.sp-authm-head, .sp-auth-h, .sp-auth-p');
        var submitBtn = form.querySelector('button[type="submit"]');
        var emailInput = form.querySelector('input[type="email"]');

        // ---- the terms tick ---------------------------------------------------
        // an unticked box is not an error worth a popup in the corner: the thing
        // that needs attention is right there in the form, so the box says so
        // itself and the message sits under it.
        var consentWrap = form.querySelector('.lp-demo-consent');
        var consentNote = null;
        if (consentWrap) {
            consentNote = el('p', 'sp-auth-consent-note');
            consentNote.hidden = true;
            consentWrap.parentNode.insertBefore(consentNote, consentWrap.nextSibling);
            var consentBox = consentWrap.querySelector('input[type="checkbox"]');
            if (consentBox) {
                consentBox.addEventListener('change', function () {
                    if (consentBox.checked) markConsent(true);
                });
            }
        }

        function markConsent(ok) {
            if (!consentWrap) return;
            consentWrap.classList.toggle('lp-demo-consent-err', !ok);
            if (!consentNote) return;
            if (ok) { consentNote.hidden = true; return; }
            consentNote.textContent = t('please accept the terms of service to continue.');
            consentNote.hidden = false;
            replay(consentNote, 'is-shown');
        }

        // ---- the bot challenge ------------------------------------------------
        // the register form can make us send mail to an address a stranger chose,
        // which is exactly what turnstile is for. it is skipped when no site key
        // is set, so the form still works before the keys exist.
        //
        // two things this has to get right, and the first version got neither:
        //
        //   the widget is not rendered until the form is actually submitted. it
        //   is a check on the send, not a field to fill in, so it has no business
        //   sitting in the form while somebody types their name: it only appears
        //   once "create account" is pressed, and in the ordinary case it passes
        //   on its own and is gone again before it is read. rendering it earlier
        //   also risked running it inside a display:none dialog, where nobody can
        //   see or finish a challenge that asks for a click.
        //
        //   the token is not reused. cloudflare gives it a few minutes and then
        //   refuses it, so a page left open while somebody reads the pricing
        //   arrives at the form with a token the server will not accept: the
        //   answer is "verification failed" for a check the visitor passed. the
        //   token's age is checked at submit, and a stale one is replaced before
        //   anything is sent.
        var turnstileToken = '';
        var turnstileAt = 0;
        var turnstileId = null;
        var turnstileOn = Boolean(window.__TURNSTILE_SITEKEY);
        var waitingFor = null;
        var holder = null;
        // cloudflare's own window is five minutes. four leaves room for a slow
        // connection to still be inside it when the request lands.
        var TOKEN_GOOD_FOR = 4 * 60 * 1000;

        function tokenArrived(tok) {
            turnstileToken = tok || '';
            turnstileAt = tok ? Date.now() : 0;
            if (waitingFor) { var go = waitingFor; waitingFor = null; go(turnstileToken); }
        }

        function renderTurnstile() {
            if (!window.turnstile || turnstileId !== null || !holder) return;
            try {
                turnstileId = window.turnstile.render(holder, {
                    sitekey: window.__TURNSTILE_SITEKEY,
                    // the card is white now, and a dark widget on it read as a hole
                    theme: 'light',
                    callback: tokenArrived,
                    'expired-callback': function () { tokenArrived(''); },
                    'error-callback': function () { tokenArrived(''); }
                });
            } catch (err) {
                // a widget that will not render must not take the form down with it
                console.error('[turnstile] ' + err.message);
            }
        }

        function loadTurnstile() {
            if (!turnstileOn) return;
            if (window.turnstile) { renderTurnstile(); return; }
            var existing = document.getElementById('sp-turnstile-src');
            if (existing) { existing.addEventListener('load', renderTurnstile); return; }
            var s = document.createElement('script');
            s.id = 'sp-turnstile-src';
            s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
            s.async = true; s.defer = true;
            s.onload = renderTurnstile;
            document.head.appendChild(s);
        }

        if (turnstileOn) {
            holder = el('div', 'sp-auth-turnstile');
            // it keeps no room in the layout until it has something to show, so
            // the form does not carry a 65px hole through the whole visit
            holder.hidden = true;
            form.insertBefore(holder, submitBtn);
        }

        // hands back a token the server will still accept, replacing a stale one
        // first. resolves with an empty string if the widget cannot produce one,
        // and the caller says so plainly rather than sending a request that is
        // going to be refused.
        function freshToken() {
            if (!turnstileOn) return Promise.resolve('');
            if (turnstileToken && Date.now() - turnstileAt < TOKEN_GOOD_FOR) {
                return Promise.resolve(turnstileToken);
            }
            if (holder) holder.hidden = false;
            loadTurnstile();
            return new Promise(function (resolve) {
                waitingFor = resolve;
                try {
                    if (turnstileId !== null) window.turnstile.reset(turnstileId);
                } catch (err) { /* not rendered yet: the render itself will answer */ }
                // a challenge that needs a click, or a network that is not there,
                // must not leave the button spinning for ever
                setTimeout(function () {
                    if (waitingFor === resolve) { waitingFor = null; resolve(turnstileToken); }
                }, 9000);
            });
        }

        // ---- what goes wrong, said where it went wrong -----------------------
        // a message about this form belongs on this form. a toast in the corner
        // of the screen is for something that happened elsewhere, or after the
        // thing you were looking at has gone; here the form is right in front of
        // the person reading, and a message that appears in it cannot be missed,
        // cannot time out, and does not cover anything up.
        var fErr = el('p', 'sp-auth-verr');
        fErr.classList.add('sp-auth-ferr');
        fErr.hidden = true;
        fErr.setAttribute('role', 'alert');
        form.insertBefore(fErr, submitBtn);

        var formErrTimer = null;
        function formError(msg) {
            clearTimeout(formErrTimer);
            fErr.textContent = msg || '';
            fErr.hidden = !msg;
            if (msg) replay(fErr, 'sp-auth-enter');
        }

        // ---- the panels this file owns ---------------------------------------

        var verify = el('form', 'sp-auth-form');
        verify.classList.add('sp-auth-verify');
        verify.setAttribute('novalidate', '');
        verify.hidden = true;

        var vhead = el('div', 'sp-auth-vhead');
        // the same mark the finished panel uses, so the two steps read as one
        // piece of design rather than two screens that happen to follow
        var vmark = el('div', 'sp-auth-vmark');
        vmark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"></rect>' +
            '<polyline points="3 6.5 12 13 21 6.5"></polyline></svg>';
        vhead.appendChild(vmark);
        vhead.appendChild(el('h3', null, 'check your email'));
        var vsub = el('p');
        vsub.appendChild(document.createTextNode('we sent a 6 digit code to'));
        // its own node with its own space: a translation that begins with
        // punctuation renders with a gap in front of it, which is how the last
        // one of these ended up reading "voditelja compliancea ."
        vsub.appendChild(document.createTextNode(' '));
        var vmail = el('b');
        vsub.appendChild(vmail);
        vhead.appendChild(vsub);
        verify.appendChild(vhead);

        var codeWrap = el('div', 'sp-auth-code');
        codeWrap.setAttribute('role', 'group');
        codeWrap.setAttribute('aria-label', t('verification code'));
        var boxes = [];
        for (var i = 0; i < 6; i++) {
            var box = document.createElement('input');
            box.type = 'text';
            box.inputMode = 'numeric';
            box.maxLength = 1;
            box.autocomplete = i === 0 ? 'one-time-code' : 'off';
            box.setAttribute('aria-label', t('digit') + ' ' + (i + 1));
            codeWrap.appendChild(box);
            boxes.push(box);
        }
        verify.appendChild(codeWrap);

        var vErr = el('p', 'sp-auth-verr');
        vErr.hidden = true;
        vErr.setAttribute('role', 'alert');
        verify.appendChild(vErr);

        var vBtn = el('button', 'lp-demo-submit', 'verify and create account');
        vBtn.classList.add('sp-auth-submit');
        vBtn.type = 'submit';
        verify.appendChild(vBtn);

        var vfoot = el('div', 'sp-auth-vfoot');
        var resendBtn = el('button', 'sp-auth-linkbtn', 'send a new code');
        resendBtn.classList.add('sp-auth-resend');
        resendBtn.type = 'button';
        var backBtn = el('button', 'sp-auth-linkbtn', 'use a different email');
        backBtn.type = 'button';
        vfoot.appendChild(resendBtn);
        vfoot.appendChild(backBtn);
        verify.appendChild(vfoot);

        var done = el('div', 'sp-auth-done');
        done.hidden = true;
        var mark = el('div', 'sp-auth-done-mark');
        mark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        done.appendChild(mark);
        done.appendChild(el('h3', null, 'your account is ready'));
        done.appendChild(el('p', null, 'your email is verified and the account is yours. we are finishing sign-in and will email this address the moment it opens.'));

        form.parentNode.insertBefore(verify, form.nextSibling);
        form.parentNode.insertBefore(done, verify.nextSibling);

        // ---- moving between them ---------------------------------------------

        var glideTimer = null;
        // the panels are different heights, so the card is given the old height and
        // then the new one and glides between the two. without it the dialog jumps,
        // and on /auth the page under it reflows.
        function glide(change) {
            var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (reduced) { change(); return; }
            var from = card.getBoundingClientRect().height;
            card.style.height = '';
            change();
            var to = card.getBoundingClientRect().height;
            clearTimeout(glideTimer);
            card.classList.remove('sp-auth-swapping');
            card.style.height = from + 'px';
            void card.offsetHeight;
            card.classList.add('sp-auth-swapping');
            card.style.height = to + 'px';
            // the height goes back to the content once it has arrived: a message
            // appearing later must not be trapped inside a fixed box
            glideTimer = setTimeout(function () {
                card.classList.remove('sp-auth-swapping');
                card.style.height = '';
            }, 320);
        }

        // what the headings looked like on the way in, so coming back restores the
        // create-account copy rather than guessing which of the pair was showing
        var headState = null;

        function step(name) {
            glide(function () {
                if (name !== 'register' && !headState) {
                    headState = Array.prototype.map.call(heads, function (h) { return h.hidden; });
                }
                form.hidden = name !== 'register';
                verify.hidden = name !== 'verify';
                done.hidden = name !== 'done';
                if (loginForm) loginForm.hidden = true;
                // there is nothing to switch to in the middle of a sign-up, and an
                // account half made is not a place to leave by the side door
                if (tabs) tabs.hidden = name !== 'register';
                for (var j = 0; j < heads.length; j++) {
                    heads[j].hidden = name === 'register' ? (headState ? headState[j] : heads[j].hidden) : true;
                }
                if (name === 'register') headState = null;
                // the dialog reads this before it switches panels behind our back:
                // reopening it mid sign-up must not put the empty form back
                card.dataset.authStep = name;
            });
            var incoming = name === 'register' ? form : (name === 'verify' ? verify : done);
            incoming.style.setProperty('--sp-auth-dir', name === 'register' ? '-14px' : '14px');
            replay(incoming, 'sp-auth-enter');
        }

        // ---- the six boxes ----------------------------------------------------

        function codeValue() {
            return boxes.map(function (b) { return b.value; }).join('');
        }
        function clearCode(focusFirst) {
            boxes.forEach(function (b) { b.value = ''; b.classList.remove('is-filled'); });
            if (focusFirst) boxes[0].focus();
        }
        function markFilled() {
            boxes.forEach(function (b) { b.classList.toggle('is-filled', b.value !== ''); });
        }

        boxes.forEach(function (box, idx) {
            box.addEventListener('input', function () {
                // a phone keyboard can deliver the whole code into one box, and so
                // can a password manager: spread whatever arrived across the row
                var digits = box.value.replace(/\D/g, '');
                if (digits.length > 1) {
                    spread(digits, idx);
                    return;
                }
                box.value = digits;
                markFilled();
                codeWrap.classList.remove('is-wrong');
                if (digits && idx < 5) boxes[idx + 1].focus();
                if (codeValue().length === 6) submitCode();
            });
            box.addEventListener('keydown', function (e) {
                if (e.key === 'Backspace' && !box.value && idx > 0) {
                    e.preventDefault();
                    boxes[idx - 1].value = '';
                    markFilled();
                    boxes[idx - 1].focus();
                } else if (e.key === 'ArrowLeft' && idx > 0) { e.preventDefault(); boxes[idx - 1].focus(); }
                else if (e.key === 'ArrowRight' && idx < 5) { e.preventDefault(); boxes[idx + 1].focus(); }
            });
            box.addEventListener('paste', function (e) {
                var text = (e.clipboardData || window.clipboardData).getData('text') || '';
                var digits = text.replace(/\D/g, '');
                if (!digits) return;
                e.preventDefault();
                spread(digits, idx);
            });
            box.addEventListener('focus', function () { box.select(); });
        });

        function spread(digits, from) {
            for (var k = 0; k < 6 - from && k < digits.length; k++) boxes[from + k].value = digits[k];
            markFilled();
            codeWrap.classList.remove('is-wrong');
            var next = Math.min(from + digits.length, 5);
            boxes[next].focus();
            if (codeValue().length === 6) submitCode();
        }

        // ---- resend, and the wait between ------------------------------------

        var tick = null;
        function holdResend(seconds) {
            clearInterval(tick);
            var left = seconds;
            function paint() {
                if (left <= 0) {
                    clearInterval(tick);
                    resendBtn.disabled = false;
                    resendBtn.textContent = t('send a new code');
                    return;
                }
                resendBtn.disabled = true;
                // the wait is shown rather than the button simply not working: a
                // dead button reads as a bug, a countdown reads as a rule
                resendBtn.textContent = t('send a new code in') + ' ' + left + 's';
                left--;
            }
            resendBtn.disabled = true;
            paint();
            tick = setInterval(paint, 1000);
        }

        resendBtn.addEventListener('click', function () {
            if (resendBtn.disabled) return;
            holdResend(RESEND_WAIT);
            post('/v1/auth/resend', { email: pendingEmail }).then(function (data) {
                showError(t('a new code is on its way.'), 'good');
                remember(pendingEmail, data && data.expiresInMin, Date.now() + RESEND_WAIT * 1000);
                watchExpiry();
            }).catch(function (err) {
                // the server's own wait wins over ours, and it is shown as a
                // countdown on the button rather than as a sentence nobody can act on
                if (err.retryIn) holdResend(err.retryIn);
                showError(reason(err));
            });
        });

        backBtn.addEventListener('click', function () {
            clearInterval(tick);
            clearTimeout(expiryTimer);
            forgetPending();
            clearCode(false);
            showError('');
            step('register');
            if (emailInput) emailInput.focus();
        });

        function showError(msg, kind) {
            vErr.textContent = msg || '';
            vErr.hidden = !msg;
            // the same line carries good news and bad. it is the same place to
            // look either way, and the colour is what tells them apart.
            vErr.classList.toggle('is-good', kind === 'good');
            if (msg) replay(vErr, 'sp-auth-enter');
        }

        // ---- the life of the code --------------------------------------------
        // fifteen minutes after it was sent the code is worth nothing, and a panel
        // that still asks for it is asking for something that cannot work. when
        // the time is up the form comes back, with a line saying why, rather than
        // six boxes that will refuse whatever is typed into them.
        var expiryTimer = null;
        function watchExpiry() {
            clearTimeout(expiryTimer);
            var state = pending();
            if (!state) return;
            expiryTimer = setTimeout(function () {
                forgetPending();
                if (card.dataset.authStep !== 'verify') return;
                clearInterval(tick);
                clearCode(false);
                showError('');
                step('register');
                formError(t('that code has expired. sign up again and we will send a new one.'));
            }, Math.max(0, state.expires - Date.now()));
        }

        // ---- the two submits --------------------------------------------------

        var pendingEmail = '';
        var busy = false;

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            if (busy) return;

            var data = {};
            new FormData(form).forEach(function (v, k) { data[k] = typeof v === 'string' ? v.trim() : v; });
            // a password is the one field that must not be trimmed: a space is a
            // character, and taking it off here means the account cannot be opened
            var pass = form.querySelector('input[type="password"]');
            if (pass) data.password = pass.value;
            form.querySelectorAll('input[type="checkbox"]').forEach(function (cb) { data[cb.name] = !!cb.checked; });
            data.lang = lang();

            if (!data.firstName || !data.lastName || !data.email) {
                formError(t('please fill in every field.'));
                return;
            }
            if (!data.password || data.password.length < 12) {
                formError(t('password must be at least 12 characters'));
                return;
            }
            if (!data.consent) {
                markConsent(false);
                if (consentWrap) consentWrap.scrollIntoView({ block: 'nearest' });
                return;
            }
            markConsent(true);
            formError('');
            busy = true;
            submitBtn.disabled = true;
            var label = submitBtn.textContent;
            submitBtn.textContent = t('creating your account…');

            // the check comes first, and it may have to run again: a page that has
            // been open a while is holding a token the server will refuse
            freshToken().then(function (tok) {
                if (turnstileOn && !tok) {
                    var err = new Error('no_token');
                    err.noToken = true;
                    throw err;
                }
                if (tok) data['cf-turnstile-response'] = tok;
                return post('/v1/auth/register', data);
            }).then(function (out) {
                pendingEmail = data.email;
                vmail.textContent = data.email;
                clearCode(false);
                showError('');
                remember(data.email, out && out.expiresInMin);
                watchExpiry();
                step('verify');
                holdResend(RESEND_WAIT);
                setTimeout(function () { boxes[0].focus(); }, 340);
            }).catch(function (err) {
                if (err.noToken) {
                    formError(t('the check below did not finish. please try again in a moment.'));
                    return;
                }
                if (err.retryIn) {
                    // a code is already out there: send them to the box for it
                    // rather than making them fill the form in again
                    pendingEmail = data.email;
                    vmail.textContent = data.email;
                    remember(data.email, err.expiresInMin);
                    watchExpiry();
                    step('verify');
                    holdResend(err.retryIn);
                    showError(reason(err));
                    return;
                }
                formError(reason(err));
            }).then(function () {
                busy = false;
                submitBtn.disabled = false;
                submitBtn.textContent = label;
                // the token is spent whether or not it worked, so the next attempt
                // starts by asking for a new one
                tokenArrived('');
                if (turnstileOn && turnstileId !== null) {
                    try { window.turnstile.reset(turnstileId); } catch (resetErr) { /* widget already gone */ }
                }
                // back out of the way until the next press asks for it again
                if (holder) holder.hidden = true;
            });
        });

        function submitCode() {
            if (busy) return;
            var code = codeValue();
            if (code.length !== 6) return;
            busy = true;
            vBtn.disabled = true;
            var label = vBtn.textContent;
            vBtn.textContent = t('checking…');
            showError('');

            post('/v1/auth/verify', { email: pendingEmail, code: code }).then(function () {
                clearInterval(tick);
                clearTimeout(expiryTimer);
                forgetPending();
                step('done');
            }).catch(function (err) {
                codeWrap.classList.remove('is-wrong');
                void codeWrap.offsetWidth;
                codeWrap.classList.add('is-wrong');
                showError(reason(err));
                clearCode(true);
            }).then(function () {
                busy = false;
                vBtn.disabled = false;
                vBtn.textContent = label;
            });
        }

        verify.addEventListener('submit', function (e) {
            e.preventDefault();
            if (codeValue().length !== 6) {
                showError(t('enter all six digits.'));
                return;
            }
            submitCode();
        });
    }

    // ---- showing the password ------------------------------------------------
    // a password nobody can read is a password typed twice, and on a phone
    // keyboard it is typed twice wrong. the eye is off by default and goes back
    // to hidden the moment the field is left, so a screen shared or a shoulder
    // looked over does not keep it on show.
    var EYE = 'M1.6 12S5.3 5.5 12 5.5 22.4 12 22.4 12 18.7 18.5 12 18.5 1.6 12 1.6 12Z';

    function svg(paths, cut) {
        var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        s.setAttribute('viewBox', '0 0 24 24');
        s.setAttribute('aria-hidden', 'true');
        s.setAttribute('focusable', 'false');
        paths.forEach(function (d) {
            var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            p.setAttribute('d', d);
            s.appendChild(p);
        });
        if (cut) {
            var line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            line.setAttribute('d', 'M4 20 20 4');
            line.setAttribute('class', 'sp-eye-cut');
            s.appendChild(line);
        }
        return s;
    }

    function addEye(input) {
        if (input.__spEye) return;
        var field = input.closest('.lp-demo-field');
        if (!field) return;
        input.__spEye = true;
        field.classList.add('sp-has-eye');

        // a revealed password is a plain text field, and the browser will offer
        // to spellcheck and autocapitalise it: a red squiggle under somebody's
        // passphrase, and a capital letter they did not type
        input.setAttribute('spellcheck', 'false');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('autocapitalize', 'off');

        var btn = el('button', 'sp-eye');
        btn.type = 'button';
        var shown = false;

        function paint() {
            btn.textContent = '';
            btn.appendChild(svg([EYE, 'M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z'], shown));
            var label = t(shown ? 'hide password' : 'show password');
            btn.setAttribute('aria-label', label);
            btn.setAttribute('title', label);
            btn.setAttribute('aria-pressed', shown ? 'true' : 'false');
        }

        function set(next) {
            shown = next;
            input.type = shown ? 'text' : 'password';
            paint();
        }

        btn.addEventListener('click', function () {
            // the caret is put back where it was: switching the type moves it to
            // the end, which is not where somebody mid-word left it
            var at = input.selectionStart;
            var to = input.selectionEnd;
            set(!shown);
            input.focus();
            try { input.setSelectionRange(at, to); } catch (err) { /* not a text input yet */ }
        });
        input.addEventListener('blur', function () {
            // pressing the eye blurs the field before the click is handled, and
            // the handler puts the focus straight back, so the check waits and
            // then asks where the focus actually ended up
            setTimeout(function () {
                var here = document.activeElement;
                if (shown && here !== btn && here !== input) set(false);
            }, 120);
        });

        paint();
        field.appendChild(btn);
    }

    function scan() {
        document.querySelectorAll('form[data-auth="register"]').forEach(attach);
        document.querySelectorAll('.sp-auth-form input[type="password"]').forEach(addEye);
    }

    // the dialog builds its markup when its own script runs, which may be after
    // this one, so the page is scanned again once everything is parsed
    scan();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
    else setTimeout(scan, 0);
    window.SentinelAuthFlow = { scan: scan };
})();
