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
    function toast(msg, kind) {
        if (window.SentinelToast) window.SentinelToast.show(msg, kind || 'error');
    }

    var RESEND_WAIT = 60; // matches the server; it is the server's answer that counts

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

        // ---- the bot challenge ------------------------------------------------
        // the register form can make us send mail to an address a stranger chose,
        // which is exactly what turnstile is for. it is skipped when no site key
        // is set, so the form still works before the keys exist.
        var turnstileToken = '';
        var turnstileOn = false;
        var holder = null;
        (function initTurnstile() {
            var siteKey = window.__TURNSTILE_SITEKEY;
            if (!siteKey) return;
            turnstileOn = true;
            holder = el('div', 'sp-auth-turnstile');
            form.insertBefore(holder, submitBtn);
            function render() {
                if (!window.turnstile) return;
                window.turnstile.render(holder, {
                    sitekey: siteKey,
                    // the card is white now, and a dark widget on it read as a hole
                    theme: 'light',
                    callback: function (tok) { turnstileToken = tok; },
                    'expired-callback': function () { turnstileToken = ''; },
                    'error-callback': function () { turnstileToken = ''; }
                });
            }
            if (window.turnstile) { render(); return; }
            var s = document.createElement('script');
            s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
            s.async = true; s.defer = true;
            s.onload = render;
            document.head.appendChild(s);
        })();

        // ---- the panels this file owns ---------------------------------------

        var verify = el('form', 'sp-auth-form');
        verify.classList.add('sp-auth-verify');
        verify.setAttribute('novalidate', '');
        verify.hidden = true;

        var vhead = el('div', 'sp-auth-vhead');
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
        vhead.appendChild(el('p', 'sp-auth-vnote', 'it expires shortly, so it is worth doing now.'));
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
        vfoot.appendChild(el('span', null, '·'));
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
            post('/v1/auth/resend', { email: pendingEmail }).then(function () {
                showError('');
                toast(t('a new code is on its way.'), 'info');
            }).catch(function (err) {
                // the server's own wait wins over ours
                if (err.retryIn) holdResend(err.retryIn);
                toast(reason(err), 'error');
            });
        });

        backBtn.addEventListener('click', function () {
            clearInterval(tick);
            clearCode(false);
            showError('');
            step('register');
            if (emailInput) emailInput.focus();
        });

        function showError(msg) {
            vErr.textContent = msg || '';
            vErr.hidden = !msg;
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
                toast(t('please fill in every field.'), 'warning');
                return;
            }
            if (!data.password || data.password.length < 12) {
                toast(t('password must be at least 12 characters'), 'warning');
                return;
            }
            if (!data.consent) {
                toast(t('please accept the terms of service to continue.'), 'warning');
                return;
            }
            if (turnstileOn && !turnstileToken) {
                toast(t('please complete the verification below.'), 'warning');
                return;
            }
            if (turnstileToken) data['cf-turnstile-response'] = turnstileToken;

            busy = true;
            submitBtn.disabled = true;
            var label = submitBtn.textContent;
            submitBtn.textContent = t('sending…');

            post('/v1/auth/register', data).then(function () {
                pendingEmail = data.email;
                vmail.textContent = data.email;
                clearCode(false);
                showError('');
                step('verify');
                holdResend(RESEND_WAIT);
                setTimeout(function () { boxes[0].focus(); }, 340);
            }).catch(function (err) {
                if (err.retryIn) {
                    // a code is already out there: send them to the box for it
                    // rather than making them fill the form in again
                    pendingEmail = data.email;
                    vmail.textContent = data.email;
                    step('verify');
                    holdResend(err.retryIn);
                }
                toast(reason(err), 'error');
            }).then(function () {
                busy = false;
                submitBtn.disabled = false;
                submitBtn.textContent = label;
                turnstileToken = '';
                if (turnstileOn && window.turnstile) { try { window.turnstile.reset(); } catch (resetErr) { /* widget already gone */ } }
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

    function scan() {
        document.querySelectorAll('form[data-auth="register"]').forEach(attach);
    }

    // the dialog builds its markup when its own script runs, which may be after
    // this one, so the page is scanned again once everything is parsed
    scan();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
    else setTimeout(scan, 0);
    window.SentinelAuthFlow = { scan: scan };
})();
