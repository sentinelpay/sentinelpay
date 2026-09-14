(function () {
    var t = function (x) { return window.SentinelI18n ? window.SentinelI18n.t(x) : x; };
    var lang = function () {
        try {
            if (window.SentinelI18n && typeof window.SentinelI18n.lang === 'function') {
                return window.SentinelI18n.lang() || 'en';
            }
        } catch (e) {  }
        return 'en';
    };
    var RESEND_WAIT = 60;
    var RESET_RESEND_WAIT = 60;

    function afterLoader(go) {
        var settled = false;
        var obs = null;
        var cap = null;
        var splash = document.getElementById('sp-loader');
        function gone() {
            var el = document.getElementById('sp-loader');
            if (!el) return true;

            if (!el.classList.contains('spl-done')) return false;
            return !(parseFloat(window.getComputedStyle(el).opacity) > 0.01);
        }
        function settle() {
            if (settled) return;
            settled = true;
            if (obs) obs.disconnect();
            if (cap) clearTimeout(cap);
            if (splash) splash.removeEventListener('transitionend', look);
            go();
        }

        function look() { if (!settled && gone()) settle(); }

        if (window.MutationObserver) {
            obs = new MutationObserver(look);
            obs.observe(document.documentElement, { childList: true, subtree: true });
            if (splash) obs.observe(splash, { attributes: true, attributeFilter: ['class'] });
        }
        if (splash) splash.addEventListener('transitionend', look);
        cap = setTimeout(settle, 8000);

        look();
    }

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

    var RESET_MAX_ASKS = 3;
    var resetAsks = Object.create(null);
    function askKey(email) { return String(email || '').trim().toLowerCase(); }
    function resetWait(email) {
        var e = resetAsks[askKey(email)];
        if (!e) return 0;
        var left = Math.ceil((e.until - Date.now()) / 1000);
        return left > 0 ? left : 0;
    }
    function resetSpent(email) {
        var e = resetAsks[askKey(email)];
        return Boolean(e && e.asks >= RESET_MAX_ASKS && Date.now() < e.hourEnds);
    }
    function rememberAsk(email, seconds) {
        var k = askKey(email);
        var e = resetAsks[k];
        if (!e || Date.now() >= e.hourEnds) e = resetAsks[k] = { asks: 0, until: 0, hourEnds: Date.now() + 3600 * 1000 };
        e.asks++;
        e.until = Date.now() + (Number(seconds) || 60) * 1000;
    }
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

                err.ours = Boolean(data && typeof data.error === 'string');
                if (!r.ok) {
                    try {
                        console.error('[auth] ' + url + ' -> ' + r.status +
                            (err.ours ? ' (our answer: ' + data.error + ')'
                                      : ' (not our answer: the body carries no error field)'));
                    } catch (e) {}
                }
                err.retryIn = data && data.retryIn;
                err.alreadySent = Boolean(data && data.alreadySent);
                err.status = r.status;
                throw err;
            });
        }, function (netErr) {

            try { console.error('[auth] ' + url + ' -> no response (' + (netErr && netErr.message) + ')'); } catch (e) {}
            throw netErr;
        });
    }

    function reason(err) {

        if (err && err.reason && err.status && (err.status < 500 || err.status === 503)) return t(err.reason);
        return t('Could not reach us just now. Please try again in a moment.');
    }
    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }
    function field(idBase, label, type, autocomplete, placeholder, full) {
        var wrap = el('div', 'lp-demo-field');
        if (full) wrap.classList.add('lp-demo-field-full');
        var id = idBase + '-' + Math.random().toString(36).slice(2, 8);
        var lab = el('label', null, label);
        lab.setAttribute('for', id);
        var input = document.createElement('input');
        input.id = id;
        input.type = type;
        input.autocomplete = autocomplete;
        input.placeholder = t(placeholder);
        wrap.appendChild(lab);
        wrap.appendChild(input);
        return { wrap: wrap, input: input, label: lab };
    }
    function replay(node, cls) {
        if (!node) return;
        node.classList.remove(cls);
        void node.offsetWidth;
        node.classList.add(cls);
    }

    function glideOn(card, change) {
        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduced) { change(); return; }
        var from = card.getBoundingClientRect().height;
        card.style.height = '';
        change();
        var to = card.getBoundingClientRect().height;
        clearTimeout(card.__spGlideTimer);
        card.classList.remove('sp-auth-swapping');
        card.style.height = from + 'px';
        void card.offsetHeight;
        card.classList.add('sp-auth-swapping');
        card.style.height = to + 'px';
        card.__spGlideTimer = setTimeout(function () {
            card.classList.remove('sp-auth-swapping');
            card.style.height = '';
        }, 320);
    }

    function makeTurnstile(form, beforeEl) {
        var turnstileToken = '';
        var turnstileAt = 0;
        var turnstileId = null;
        var turnstileOn = Boolean(window.__TURNSTILE_SITEKEY);
        var waitingFor = null;
        var holder = null;

        var TOKEN_GOOD_FOR = 4 * 60 * 1000;
        function tokenArrived(tok) {
            turnstileToken = tok || '';
            turnstileAt = tok ? Date.now() : 0;
            if (waitingFor) { var go = waitingFor; waitingFor = null; go(turnstileToken); }
        }
        var fault = '';
        function setFault(why) {
            fault = why;
            try { window.sp = window.sp || {}; window.sp.turnstileFault = why; } catch (e) {  }
            if (why) console.error('[turnstile] ' + why);
        }
        function renderTurnstile() {
            if (!window.turnstile || turnstileId !== null || !holder) return;
            try {
                turnstileId = window.turnstile.render(holder, {
                    sitekey: window.__TURNSTILE_SITEKEY,
                    theme: 'light',
                    callback: function (tok) { setFault(''); tokenArrived(tok); },
                    'expired-callback': function () { setFault('expired'); tokenArrived(''); },

                    'error-callback': function (code) { setFault('error-' + (code || 'unknown')); tokenArrived(''); }
                });
            } catch (err) {
                setFault('render-threw:' + err.message);
            }
        }
        function scriptFailed() {
            setFault('script-blocked');
            tokenArrived('');
        }
        function loadTurnstile() {
            if (!turnstileOn) return;
            if (window.turnstile) { renderTurnstile(); return; }
            var existing = document.getElementById('sp-turnstile-src');
            if (existing) {
                existing.addEventListener('load', renderTurnstile);
                existing.addEventListener('error', scriptFailed);
                return;
            }
            var s = document.createElement('script');
            s.id = 'sp-turnstile-src';
            s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
            s.async = true; s.defer = true;
            s.onload = renderTurnstile;

            s.onerror = scriptFailed;

            document.head.appendChild(s);
        }
        if (turnstileOn) {
            holder = el('div', 'sp-auth-turnstile');
            holder.hidden = true;
            form.insertBefore(holder, beforeEl);
        }
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
                } catch (err) {  }
                setTimeout(function () {
                    if (waitingFor !== resolve) return;
                    waitingFor = null;
                    if (!turnstileToken && !fault) setFault('timed-out');
                    resolve(turnstileToken);
                }, 20000);
            });
        }
            function spend() {
                tokenArrived('');
                if (turnstileOn && turnstileId !== null) {
                    try { window.turnstile.reset(turnstileId); } catch (err) {  }
                }
                if (holder) holder.hidden = true;
            }
            return { on: turnstileOn, freshToken: freshToken, spend: spend, fault: function () { return fault; } };
        }
    function attach(form) {
        var card = form.closest('.lp-demo-card');
        if (!card || form.__spAuthFlow) return;
        form.__spAuthFlow = true;
        var root = card.closest('.sp-auth-stage') || card.closest('.sp-authm') || card;
        var tabs = card.querySelector('.sp-auth-tabs');
        var loginForm = card.querySelector('form[data-auth="login"]');

        var heads = root.querySelectorAll('.sp-authm-head, .sp-auth-h, .sp-auth-p');
        var submitBtn = form.querySelector('button[type="submit"]');
        var emailInput = form.querySelector('input[type="email"]');

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
            consentNote.textContent = t('Please accept the terms of service to continue.');
            consentNote.hidden = false;
            replay(consentNote, 'is-shown');
        }
        var ts = makeTurnstile(form, submitBtn);
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

        var verify = el('form', 'sp-auth-form');
        verify.classList.add('sp-auth-verify');
        verify.setAttribute('novalidate', '');
        verify.hidden = true;
        var vhead = el('div', 'sp-auth-vhead');

        var vmark = el('div', 'sp-auth-vmark');
        vmark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"></rect>' +
            '<polyline points="3 6.5 12 13 21 6.5"></polyline></svg>';
        vhead.appendChild(vmark);
        vhead.appendChild(el('h3', null, 'Check your email'));
        var vsub = el('p');
        vsub.appendChild(document.createTextNode('We sent a 6 digit code to'));
        vsub.appendChild(document.createTextNode(' '));
        var vmail = el('b');
        vsub.appendChild(vmail);
        vhead.appendChild(vsub);
        verify.appendChild(vhead);
        var codeWrap = el('div', 'sp-auth-code');
        codeWrap.setAttribute('role', 'group');
        codeWrap.setAttribute('aria-label', t('Verification code'));
        var boxes = [];
        for (var i = 0; i < 6; i++) {
            var box = document.createElement('input');
            box.type = 'text';
            box.inputMode = 'numeric';
            box.maxLength = 1;
            box.autocomplete = i === 0 ? 'one-time-code' : 'off';
            box.setAttribute('aria-label', t('Digit') + ' ' + (i + 1));
            codeWrap.appendChild(box);
            boxes.push(box);
        }
        verify.appendChild(codeWrap);
        var vErr = el('p', 'sp-auth-verr');
        vErr.hidden = true;
        vErr.setAttribute('role', 'alert');
        verify.appendChild(vErr);
        var vBtn = el('button', 'lp-demo-submit', 'Verify and create account');
        vBtn.classList.add('sp-auth-submit');
        vBtn.type = 'submit';
        verify.appendChild(vBtn);
        var vfoot = el('div', 'sp-auth-vfoot');
        var resendBtn = el('button', 'sp-auth-linkbtn', 'Send a new code');
        resendBtn.classList.add('sp-auth-resend');
        resendBtn.type = 'button';
        var backBtn = el('button', 'sp-auth-linkbtn', 'Use a different email');
        backBtn.type = 'button';
        vfoot.appendChild(resendBtn);
        vfoot.appendChild(backBtn);
        verify.appendChild(vfoot);

        var stepBack = el('button', 'sp-auth-stepback');
        stepBack.type = 'button';
        stepBack.hidden = true;
        stepBack.setAttribute('aria-label', t('Use a different email'));
        stepBack.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M15 5l-7 7 7 7"></path></svg>';
        card.insertBefore(stepBack, card.firstChild);
        var done = el('div', 'sp-auth-done');
        done.hidden = true;
        var mark = el('div', 'sp-auth-done-mark');
        mark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        done.appendChild(mark);
        done.appendChild(el('h3', null, 'Your account is ready'));
        done.appendChild(el('p', null, 'You are signed in. Taking you to your account…'));
        form.parentNode.insertBefore(verify, form.nextSibling);
        form.parentNode.insertBefore(done, verify.nextSibling);

        function glide(change) { glideOn(card, change); }
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

                if (tabs) tabs.hidden = name !== 'register';
                for (var j = 0; j < heads.length; j++) {
                    heads[j].hidden = name === 'register' ? (headState ? headState[j] : heads[j].hidden) : true;
                }
                if (name === 'register') headState = null;
                stepBack.hidden = name !== 'verify';

                card.dataset.authStep = name;
            });
            var incoming = name === 'register' ? form : (name === 'verify' ? verify : done);
            incoming.style.setProperty('--sp-auth-dir', name === 'register' ? '-14px' : '14px');
            replay(incoming, 'sp-auth-enter');
        }

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
        var tick = null;
        function holdResend(seconds) {
            clearInterval(tick);
            var left = seconds;
            function paint() {
                if (left <= 0) {
                    clearInterval(tick);
                    resendBtn.disabled = false;
                    resendBtn.textContent = t('Send a new code');
                    return;
                }
                resendBtn.disabled = true;
                resendBtn.textContent = t('Send a new code in') + ' ' + left + 's';
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
                showError(t('A new code is on its way.'), 'good');
                remember(pendingEmail, data && data.expiresInMin, Date.now() + RESEND_WAIT * 1000);
                watchExpiry();
            }).catch(function (err) {
                if (err.retryIn) holdResend(err.retryIn);
                showError(reason(err));
            });
        });
        function leaveVerify() {
            clearInterval(tick);
            clearTimeout(expiryTimer);
            forgetPending();
            clearCode(false);
            showError('');
            step('register');
            if (emailInput) emailInput.focus();
        }
        backBtn.addEventListener('click', leaveVerify);
        stepBack.addEventListener('click', leaveVerify);
        function showError(msg, kind) {
            vErr.textContent = msg || '';
            vErr.hidden = !msg;

            vErr.classList.toggle('is-good', kind === 'good');
            if (msg) replay(vErr, 'sp-auth-enter');
        }

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
                formError(t('That code has expired. Sign up again and we will send a new one.'));
            }, Math.max(0, state.expires - Date.now()));
        }
        var pendingEmail = '';
        var busy = false;
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            if (busy) return;
            var data = {};
            new FormData(form).forEach(function (v, k) { data[k] = typeof v === 'string' ? v.trim() : v; });
            var pass = form.querySelector('input[type="password"]');
            if (pass) data.password = pass.value;
            form.querySelectorAll('input[type="checkbox"]').forEach(function (cb) { data[cb.name] = !!cb.checked; });
            data.lang = lang();
            if (!data.firstName || !data.lastName || !data.email) {
                formError(t('Please fill in every field.'));
                return;
            }
            if (!data.password || data.password.length < 12) {
                formError(t('Password must be at least 12 characters'));
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
            submitBtn.textContent = t('Creating your account…');

            ts.freshToken().then(function (tok) {
                if (ts.on && !tok) {
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
                    formError(t(ts.fault() === 'script-blocked'
                        ? 'The security check could not load. An ad blocker or network filter may be blocking it.'
                        : 'The check below did not finish. Please try again in a moment.'));
                    return;
                }

                formError(reason(err));
            }).then(function () {
                busy = false;
                submitBtn.disabled = false;
                submitBtn.textContent = label;
                ts.spend();
            });
        });
        function submitCode() {
            if (busy) return;
            var code = codeValue();
            if (code.length !== 6) return;
            busy = true;
            vBtn.disabled = true;
            var label = vBtn.textContent;
            vBtn.textContent = t('Checking…');
            showError('');
            post('/v1/auth/verify', { email: pendingEmail, code: code }).then(function (out) {
                clearInterval(tick);
                clearTimeout(expiryTimer);
                forgetPending();
                step('done');
                setTimeout(function () {
                    location.replace(out && out.signedIn === false ? '/?signin=1' : '/dashboard');
                }, 1400);
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
                showError(t('Enter all six digits.'));
                return;
            }
            submitCode();
        });
    }
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

        var box = el('div', 'sp-eye-box');
        input.parentNode.insertBefore(box, input);
        box.appendChild(input);
        input.setAttribute('spellcheck', 'false');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('autocapitalize', 'off');
        var btn = el('button', 'sp-eye');
        btn.type = 'button';
        var shown = false;
        function paint() {
            btn.textContent = '';
            btn.appendChild(svg([EYE, 'M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z'], shown));
            var label = t(shown ? 'Hide password' : 'Show password');
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
            var at = input.selectionStart;
            var to = input.selectionEnd;
            set(!shown);
            input.focus();
            try { input.setSelectionRange(at, to); } catch (err) {  }
        });
        input.addEventListener('blur', function () {
            setTimeout(function () {
                var here = document.activeElement;
                if (shown && here !== btn && here !== input) set(false);
            }, 120);
        });
        paint();
        box.appendChild(btn);
    }

    function attachLogin(form) {
        if (form.__spAuthLogin) return;
        form.__spAuthLogin = true;
        var submitBtn = form.querySelector('button[type="submit"]');
        if (!submitBtn) return;
        var err = el('p', 'sp-auth-verr');
        err.classList.add('sp-auth-ferr');
        err.hidden = true;
        err.setAttribute('role', 'alert');
        form.insertBefore(err, submitBtn);

        var loginCard = form.closest('.lp-demo-card');
        var forgotLink = form.querySelector('.sp-auth-link');
        if (loginCard && forgotLink) {
            var lRoot = loginCard.closest('.sp-auth-stage') || loginCard.closest('.sp-authm') || loginCard;
            var lTabs = loginCard.querySelector('.sp-auth-tabs');
            var lHeads = lRoot.querySelectorAll('.sp-authm-head, .sp-auth-h, .sp-auth-p');

            var reset = el('form', 'sp-auth-form');
            reset.classList.add('sp-auth-verify');
            reset.setAttribute('novalidate', '');
            reset.hidden = true;
            var rhead = el('div', 'sp-auth-vhead');
            var rmark = el('div', 'sp-auth-vmark');
            rmark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
                'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                '<rect x="4" y="10.5" width="16" height="10" rx="2.2"></rect>' +
                '<path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"></path></svg>';
            rhead.appendChild(rmark);
            rhead.appendChild(el('h3', null, 'Reset your password'));
            rhead.appendChild(el('p', null, 'Enter the address on the account and we will send you a link to set a new password.'));
            reset.appendChild(rhead);
            var rField = el('div', 'lp-demo-field');
            rField.classList.add('lp-demo-field-full');
            var rLabel = el('label', null, 'Work email');
            var rMailId = 'sp-reset-mail-' + Math.random().toString(36).slice(2, 8);
            rLabel.setAttribute('for', rMailId);
            var rMail = document.createElement('input');
            rMail.id = rMailId;
            rMail.type = 'email';
            rMail.name = 'email';
            rMail.autocomplete = 'email';
            rMail.placeholder = t('you@yourcompany.com');
            rField.appendChild(rLabel);
            rField.appendChild(rMail);
            reset.appendChild(rField);
            var rErr = el('p', 'sp-auth-verr');
            rErr.hidden = true;
            rErr.setAttribute('role', 'alert');
            reset.appendChild(rErr);
            var rBtn = el('button', 'lp-demo-submit', 'Send the reset link');
            rBtn.classList.add('sp-auth-submit');
            rBtn.type = 'submit';
            reset.appendChild(rBtn);
            var rts = makeTurnstile(reset, rBtn);
            var rFoot = el('div', 'sp-auth-vfoot');
            var rBack = el('button', 'sp-auth-linkbtn', 'Back to sign in');
            rBack.type = 'button';
            rFoot.appendChild(rBack);
            reset.appendChild(rFoot);

            var sent = el('div', 'sp-auth-done');
            sent.hidden = true;
            var sMark = el('div', 'sp-auth-done-mark');
            sMark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
                'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"></rect>' +
                '<polyline points="3 6.5 12 13 21 6.5"></polyline></svg>';
            sent.appendChild(sMark);
            sent.appendChild(el('h3', null, 'Check your email'));
            var sSub = el('p');
            sSub.appendChild(document.createTextNode(t('If that address has an account, a link to set a new password is on its way to')));
            sSub.appendChild(document.createTextNode(' '));
            var sMail = el('b');
            sSub.appendChild(sMail);
            sent.appendChild(sSub);

            var sErr = el('p', 'sp-auth-verr');
            sErr.hidden = true;
            sErr.setAttribute('role', 'alert');
            sent.appendChild(sErr);
            var sFoot = el('div', 'sp-auth-vfoot');
            var sResend = el('button', 'sp-auth-linkbtn', 'Send a new link');
            sResend.classList.add('sp-auth-resend');
            sResend.type = 'button';
            var sBack = el('button', 'sp-auth-linkbtn', 'Back to sign in');
            sBack.type = 'button';
            sFoot.appendChild(sResend);
            sFoot.appendChild(sBack);
            sent.appendChild(sFoot);
            form.parentNode.insertBefore(reset, form.nextSibling);
            form.parentNode.insertBefore(sent, reset.nextSibling);
            var backArrow = el('button', 'sp-auth-stepback');
            backArrow.type = 'button';
            backArrow.hidden = true;
            backArrow.setAttribute('aria-label', t('Back to sign in'));
            backArrow.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
                'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                '<path d="M15 5l-7 7 7 7"></path></svg>';
            loginCard.insertBefore(backArrow, loginCard.firstChild);
            backArrow.addEventListener('click', function () { lStep('login'); });

            var setpw = el('form', 'sp-auth-form');
            setpw.classList.add('sp-auth-verify');
            setpw.setAttribute('novalidate', '');
            setpw.hidden = true;
            var pwHead = el('div', 'sp-auth-vhead');
            var pwMark = el('div', 'sp-auth-vmark');
            pwMark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
                'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                '<rect x="4" y="10.5" width="16" height="10" rx="2.2"></rect>' +
                '<path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"></path></svg>';
            pwHead.appendChild(pwMark);
            var pwTitle = el('h3', null, 'Set a new password');
            var pwSub = el('p', null, 'Choose one you have not used anywhere else. You will be signed in as soon as it is saved.');
            pwHead.appendChild(pwTitle);
            pwHead.appendChild(pwSub);
            setpw.appendChild(pwHead);
            var pwNames = el('div', 'lp-demo-grid');
            pwNames.hidden = true;
            var pwFirst = field('sp-pw-first', 'First name', 'text', 'given-name', 'e.g. Alex');
            var pwLast = field('sp-pw-last', 'Last name', 'text', 'family-name', 'e.g. Morgan');
            pwNames.appendChild(pwFirst.wrap);
            pwNames.appendChild(pwLast.wrap);
            setpw.appendChild(pwNames);
            var pwOne = field('sp-pw-one', 'New password', 'password', 'new-password', 'At least 12 characters', true);
            var pwTwo = field('sp-pw-two', 'Repeat the password', 'password', 'new-password', 'At least 12 characters', true);
            setpw.appendChild(pwOne.wrap);
            setpw.appendChild(pwTwo.wrap);
            var pwConsent = el('label', 'lp-demo-consent');
            pwConsent.hidden = true;
            var pwTick = document.createElement('input');
            pwTick.type = 'checkbox';
            pwTick.name = 'consent';
            var pwTerms = el('span');
            pwTerms.innerHTML = 'I agree to <a href="/terms-of-service">the terms of service</a> and to be contacted about this account.';
            pwConsent.appendChild(pwTick);
            pwConsent.appendChild(pwTerms);
            setpw.appendChild(pwConsent);
            var pwErr = el('p', 'sp-auth-verr');
            pwErr.hidden = true;
            pwErr.setAttribute('role', 'alert');
            setpw.appendChild(pwErr);
            var pwBtn = el('button', 'lp-demo-submit', 'Save the password');
            pwBtn.classList.add('sp-auth-submit');
            pwBtn.type = 'submit';
            setpw.appendChild(pwBtn);
            var pwDone = el('div', 'sp-auth-done');
            pwDone.hidden = true;
            var pwDoneMark = el('div', 'sp-auth-done-mark');
            pwDoneMark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
                'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';
            pwDone.appendChild(pwDoneMark);
            var pwDoneTitle = el('h3', null, 'Your password is set');
            pwDone.appendChild(pwDoneTitle);
            pwDone.appendChild(el('p', null, 'You are signed in. Taking you to your account…'));
            form.parentNode.insertBefore(setpw, sent.nextSibling);
            form.parentNode.insertBefore(pwDone, setpw.nextSibling);
            var lHeadState = null;
            function lStep(name) {
                glideOn(loginCard, function () {
                    if (name !== 'login' && !lHeadState) {
                        lHeadState = Array.prototype.map.call(lHeads, function (h) { return h.hidden; });
                    }
                    form.hidden = name !== 'login';
                    reset.hidden = name !== 'reset';
                    sent.hidden = name !== 'sent';
                    setpw.hidden = name !== 'setpw';
                    pwDone.hidden = name !== 'setpwdone';
                    if (lTabs) lTabs.hidden = name !== 'login';
                    for (var k = 0; k < lHeads.length; k++) {
                        lHeads[k].hidden = name === 'login' ? (lHeadState ? lHeadState[k] : lHeads[k].hidden) : true;
                    }
                    if (name === 'login') lHeadState = null;
                    backArrow.hidden = name === 'login' || name === 'setpw' || name === 'setpwdone';
                    loginCard.dataset.authStep = name === 'login' ? '' : name;
                });
                var into = { login: form, reset: reset, sent: sent, setpw: setpw, setpwdone: pwDone }[name];
                into.style.setProperty('--sp-auth-dir', name === 'login' ? '-14px' : '14px');
                replay(into, 'sp-auth-enter');
            }

            window.SentinelAuthFlow = window.SentinelAuthFlow || {};
            window.SentinelAuthFlow.reset = function () {
                var typed = form.querySelector('input[type="email"]');
                if (typed && typed.value.trim()) rMail.value = typed.value.trim();
                lStep('reset');
                setTimeout(function () { rMail.focus(); }, 60);
            };
            forgotLink.addEventListener('click', function (e) {
                e.preventDefault();

                var typed = form.querySelector('input[type="email"]');
                if (typed && typed.value.trim()) rMail.value = typed.value.trim();
                lStep('reset');
                setTimeout(function () { rMail.focus(); }, 60);
            });
            rBack.addEventListener('click', function () { lStep('login'); });
            sBack.addEventListener('click', function () { lStep('login'); });

            var sTick = null;
            var sAddress = '';

            function sSay(msg, note) {
                sErr.textContent = msg || '';
                sErr.hidden = !msg;
                sErr.classList.toggle('is-note', Boolean(msg && note));
                if (msg) replay(sErr, 'sp-auth-enter');
            }
            function holdResendLink(seconds) {
                clearInterval(sTick);
                var left = seconds;
                function paint() {
                    if (left <= 0) {
                        clearInterval(sTick);
                        sResend.disabled = false;
                        sResend.textContent = t('Send a new link');
                        return;
                    }
                    sResend.disabled = true;
                    sResend.textContent = t('Send a new link in') + ' ' + left + 's';
                    left--;
                }
                sResend.disabled = true;
                paint();
                sTick = setInterval(paint, 1000);
            }

            function showResendState(address, seconds) {
                if (resetSpent(address)) {
                    clearInterval(sTick);
                    sResend.disabled = true;
                    sResend.textContent = t('Send a new link');
                    sSay(t('That is as many links as we will send for now. Check your spam folder; you can ask again in an hour.'), true);
                    return;
                }
                holdResendLink(seconds);
            }
            sResend.addEventListener('click', function () {
                if (sResend.disabled || !sAddress) return;
                if (resetWait(sAddress) || resetSpent(sAddress)) {
                    showResendState(sAddress, resetWait(sAddress) || RESET_RESEND_WAIT);
                    return;
                }
                holdResendLink(RESET_RESEND_WAIT);
                rSay('');
                rts.freshToken().then(function (tok) {

                    if (rts.on && !tok) {
                        var noTok = new Error('no_token');
                        noTok.noToken = true;
                        throw noTok;
                    }
                    var payload = { email: sAddress, lang: lang() };
                    if (tok) payload['cf-turnstile-response'] = tok;
                    return post('/v1/auth/forgot', payload);
                }).then(function (data) {
                    rememberAsk(sAddress, (data && data.resendIn) || RESET_RESEND_WAIT);
                    showResendState(sAddress, (data && data.resendIn) || RESET_RESEND_WAIT);
                }).catch(function (failed) {

                    if (failed && failed.alreadySent) {
                        rememberAsk(sAddress, failed.retryIn || RESET_RESEND_WAIT);
                        showResendState(sAddress, failed.retryIn || RESET_RESEND_WAIT);
                        return;
                    }
                    sSay(failed && failed.noToken
                        ? t(rts.fault() === 'script-blocked'
                            ? 'The security check could not load. An ad blocker or network filter may be blocking it.'
                            : 'The check below did not finish. Please try again in a moment.')
                        : reason(failed));
                }).then(function () { rts.spend(); });
            });
            function pwSay(msg) {
                pwErr.textContent = msg || '';
                pwErr.hidden = !msg;
                if (msg) replay(pwErr, 'sp-auth-enter');
            }
            function expired() { location.replace('/token-expired'); }
            var makingAccount = false;
            var pwBusy = false;

            function dressAsSignup() {
                makingAccount = true;
                pwNames.hidden = false;
                pwConsent.hidden = false;
                pwTitle.textContent = t('Create your account');
                pwSub.textContent = t('This address has no account yet. Choose a password and it is yours; the link you clicked is the proof the address is.');
                pwBtn.textContent = t('Create account');
            }
            function focusFirstField() {
                var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
                if (!coarse) (makingAccount ? pwFirst.input : pwOne.input).focus({ preventScroll: true });
            }
            function showFromLink(out) {
                if (out && !out.hasAccount) dressAsSignup();
                lStep('setpw');
                setpw.hidden = false;
                focusFirstField();
            }
            pwTick.addEventListener('change', function () {
                if (pwTick.checked) pwConsent.classList.remove('lp-demo-consent-err');
            });
            setpw.addEventListener('submit', function (e) {
                e.preventDefault();
                if (pwBusy) return;
                var token = window.__SP_RESET_TOKEN || '';
                if (!token) { expired(); return; }
                var one = pwOne.input.value;
                var two = pwTwo.input.value;
                if (makingAccount && (!pwFirst.input.value.trim() || !pwLast.input.value.trim())) {
                    pwSay(t('Please fill in every field.'));
                    (pwFirst.input.value.trim() ? pwLast.input : pwFirst.input).focus();
                    return;
                }
                if (!one || !two) { pwSay(t('Please fill in every field.')); return; }

                if (one !== two) {
                    pwSay(t('The two passwords do not match.'));
                    pwTwo.input.value = '';
                    pwTwo.input.focus();
                    return;
                }
                if (makingAccount && !pwTick.checked) {
                    pwConsent.classList.add('lp-demo-consent-err');
                    pwSay(t('Please accept the terms of service to continue.'));
                    return;
                }
                pwSay('');
                pwBusy = true;
                pwBtn.disabled = true;
                var pwLabel = pwBtn.textContent;
                pwBtn.textContent = t('Saving…');
                post('/v1/auth/reset', {
                    token: token,
                    password: one,
                    firstName: pwFirst.input.value.trim(),
                    lastName: pwLast.input.value.trim(),
                    consent: makingAccount ? Boolean(pwTick.checked) : undefined,
                    lang: lang()
                }).then(function () {
                    try { delete window.__SP_RESET_TOKEN; } catch (e) { window.__SP_RESET_TOKEN = ''; }
                    lStep('setpwdone');
                    setTimeout(function () { location.replace('/dashboard'); }, 1100);
                }).catch(function (failed) {
                    if (failed && failed.status === 410) { expired(); return; }
                    pwSay(reason(failed));
                    pwBusy = false;
                    pwBtn.disabled = false;
                    pwBtn.textContent = pwLabel;
                    pwOne.input.value = '';
                    pwTwo.input.value = '';
                    pwOne.input.focus();
                });
            });

            var backdrop = loginCard.closest('.sp-authm-backdrop');
            if (backdrop && window.MutationObserver) {
                var wasOpen = !backdrop.hidden;
                new MutationObserver(function () {
                    var open = !backdrop.hidden;
                    if (wasOpen && !open && loginCard.dataset.authStep) {
                        form.hidden = false;
                        reset.hidden = true;
                        sent.hidden = true;
                        setpw.hidden = true;
                        pwDone.hidden = true;
                        backArrow.hidden = true;
                        if (lTabs) lTabs.hidden = false;
                        for (var m = 0; m < lHeads.length; m++) {
                            lHeads[m].hidden = lHeadState ? lHeadState[m] : false;
                        }
                        lHeadState = null;
                        loginCard.dataset.authStep = '';
                        rSay('');
                        rMail.value = '';
                        clearInterval(sTick);
                        sAddress = '';
                        sSay('');
                    }
                    wasOpen = open;
                }).observe(backdrop, { attributes: true, attributeFilter: ['hidden'] });
            }

            if (backdrop && window.__SP_OPEN_SIGNIN && !window.__SP_RESET_TOKEN) {
                var want = window.__SP_OPEN_SIGNIN;
                try { delete window.__SP_OPEN_SIGNIN; } catch (e) { window.__SP_OPEN_SIGNIN = ''; }
                afterLoader(function () {
                    if (!window.SentinelAuthModal) return;
                    window.SentinelAuthModal.open(want === 'create' ? 'create' : 'login');
                    if (want === 'reset' && window.SentinelAuthFlow && window.SentinelAuthFlow.reset) {
                        window.SentinelAuthFlow.reset();
                    }
                });
            }

            if (backdrop && window.__SP_RESET_TOKEN) {
                var linkToken = window.__SP_RESET_TOKEN;
                var answer = null;
                var failure = null;
                var answered = false;
                var loaderDone = false;
                var shown = false;
                var late = null;
                function tell() {
                    if (shown || !answered || !loaderDone) return;
                    shown = true;
                    clearTimeout(late);
                    if (failure && failure.status === 410) { expired(); return; }
                    arrive();
                    if (window.SentinelAuthModal) window.SentinelAuthModal.open('login');
                    showFromLink(answer);
                    if (failure) pwSay(t('Could not reach us just now. Please try again in a moment.'));
                }
                post('/v1/auth/reset-check', { token: linkToken }).then(function (out) {
                    answer = out; answered = true; tell();
                }, function (err) {
                    failure = err || {}; answered = true; tell();
                });
                afterLoader(function () {
                    loaderDone = true;

                    if (!answered) {
                        late = setTimeout(function () {
                            if (shown) return;
                            answered = true;
                            tell();
                        }, 2000);
                    }
                    tell();
                });
                function arrive() {
                    if (backdrop.classList) {
                        backdrop.classList.add('sp-authm-arrive');
                        var card = backdrop.querySelector('.sp-authm');
                        if (card) {
                            card.addEventListener('transitionend', function drop(ev) {
                                if (ev.propertyName !== 'transform') return;
                                card.removeEventListener('transitionend', drop);
                                backdrop.classList.remove('sp-authm-arrive');
                            });
                        }
                    }
                }
            }
            function rSay(msg) {
                rErr.textContent = msg || '';
                rErr.hidden = !msg;
                if (msg) replay(rErr, 'sp-auth-enter');
            }
            var rBusy = false;
            reset.addEventListener('submit', function (e) {
                e.preventDefault();
                if (rBusy) return;
                var address = rMail.value.trim();
                if (!address) {
                    rSay(t('Please fill in every field.'));
                    rMail.focus();
                    return;
                }

                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
                    rSay(t('Please enter a valid email address.'));
                    rMail.focus();
                    return;
                }
                rSay('');
                var waiting = resetWait(address);
                if (waiting || resetSpent(address)) {
                    sMail.textContent = address;
                    sAddress = address;
                    sSay('');
                    showResendState(address, waiting || RESET_RESEND_WAIT);
                    lStep('sent');
                    return;
                }
                rBusy = true;
                rBtn.disabled = true;
                var rLabel = rBtn.textContent;
                rBtn.textContent = t('Sending…');
                rts.freshToken().then(function (tok) {
                    if (rts.on && !tok) {
                        var noTok = new Error('no_token');
                        noTok.noToken = true;
                        throw noTok;
                    }
                    var payload = { email: address, lang: lang() };
                    if (tok) payload['cf-turnstile-response'] = tok;
                    return post('/v1/auth/forgot', payload);
                }).then(function (data) {
                    sMail.textContent = address;
                    sAddress = address;
                    sSay('');
                    rememberAsk(address, (data && data.resendIn) || RESET_RESEND_WAIT);
                    showResendState(address, (data && data.resendIn) || RESET_RESEND_WAIT);
                    lStep('sent');
                }).catch(function (failed) {
                    if (failed && failed.noToken) {
                        rSay(t(rts.fault() === 'script-blocked'
                            ? 'The security check could not load. An ad blocker or network filter may be blocking it.'
                            : 'The check below did not finish. Please try again in a moment.'));
                        return;
                    }
                    if (failed && failed.alreadySent) {
                        sMail.textContent = address;
                        sAddress = address;
                        sSay('');
                        rememberAsk(address, failed.retryIn || RESET_RESEND_WAIT);
                        showResendState(address, failed.retryIn || RESET_RESEND_WAIT);
                        lStep('sent');
                        return;
                    }
                    try {
                        if (!(failed && failed.status)) {
                            console.error('[auth] forgot: no answer to show (' +
                                (failed && (failed.stack || failed.message)) + ')');
                        }
                    } catch (e) {}
                    rSay(reason(failed));
                }).then(function () {
                    rBusy = false;
                    rBtn.disabled = false;
                    rBtn.textContent = rLabel;
                    rts.spend();
                });
            });
        }

        var loginFields = [form.querySelector('input[type="email"]'), form.querySelector('input[type="password"]')]
            .filter(Boolean);
        function clearPrefill() {
            loginFields.forEach(function (field) { field.value = ''; });
        }
        clearPrefill();
        setTimeout(clearPrefill, 120);
        setTimeout(clearPrefill, 600);
        if (window.MutationObserver) {
            [form, form.closest('.sp-authm-backdrop')].filter(Boolean).forEach(function (node) {
                var wasHidden = node.hidden;
                new MutationObserver(function () {
                    if (wasHidden && !node.hidden) clearPrefill();
                    wasHidden = node.hidden;
                }).observe(node, { attributes: true, attributeFilter: ['hidden'] });
            });
        }
        function say(msg) {
            err.textContent = msg || '';
            err.hidden = !msg;
            if (msg) replay(err, 'sp-auth-enter');
        }
        var lts = makeTurnstile(form, submitBtn);
        var lCard = form.closest('.lp-demo-card');
        var lTabsEl = lCard ? lCard.querySelector('.sp-auth-tabs') : null;
        var pendingTotp = '';
        var totpPanel = el('form', 'sp-auth-form');
        totpPanel.classList.add('sp-auth-verify');
        totpPanel.setAttribute('novalidate', '');
        totpPanel.hidden = true;
        var tHead = el('div', 'sp-auth-vhead');
        var tMark = el('div', 'sp-auth-vmark');
        tMark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<rect x="4.5" y="2.5" width="15" height="19" rx="2.5"></rect>' +
            '<path d="M10 18.5h4"></path></svg>';
        tHead.appendChild(tMark);
        tHead.appendChild(el('h3', null, 'Enter your code'));
        tHead.appendChild(el('p', null, 'Open your authenticator app and type the six digit code it is showing.'));
        totpPanel.appendChild(tHead);
        var tField = el('div', 'lp-demo-field');
        tField.classList.add('lp-demo-field-full', 'sp-auth-codefield');
        var tInput = document.createElement('input');
        tInput.type = 'text';
        tInput.inputMode = 'numeric';
        tInput.autocomplete = 'one-time-code';
        tInput.maxLength = 11;
        tInput.placeholder = '000000';
        tInput.setAttribute('aria-label', t('Verification code'));
        tField.appendChild(tInput);
        totpPanel.appendChild(tField);
        var tErr = el('p', 'sp-auth-verr');
        tErr.hidden = true;
        tErr.setAttribute('role', 'alert');
        totpPanel.appendChild(tErr);
        var tBtn = el('button', 'lp-demo-submit', 'Sign in');
        tBtn.classList.add('sp-auth-submit');
        tBtn.type = 'submit';
        totpPanel.appendChild(tBtn);
        var tFoot = el('div', 'sp-auth-vfoot');
        var tNote = el('p', 'sp-auth-hint', 'Lost the phone? A recovery code works here too.');
        tFoot.appendChild(tNote);
        var tBack = el('button', 'sp-auth-linkbtn', 'Back to sign in');
        tBack.type = 'button';
        tFoot.appendChild(tBack);
        totpPanel.appendChild(tFoot);
        form.parentNode.insertBefore(totpPanel, form.nextSibling);
        function tSay(msg) {
            tErr.textContent = msg || '';
            tErr.hidden = !msg;
            if (msg) replay(tErr, 'sp-auth-enter');
        }
        function showTotp(on) {
            glideOn(lCard || form, function () {
                form.hidden = on;
                totpPanel.hidden = !on;
                if (lTabsEl) lTabsEl.hidden = on;
            });
            replay(on ? totpPanel : form, 'sp-auth-enter');
            if (on) setTimeout(function () { tInput.focus(); }, 320);
        }
        tBack.addEventListener('click', function () {
            pendingTotp = '';
            tInput.value = '';
            tSay('');
            showTotp(false);
        });
        var tBusy = false;
        totpPanel.addEventListener('submit', function (e) {
            e.preventDefault();
            if (tBusy) return;
            var code = tInput.value.trim();
            if (!code) { tSay(t('Please fill in every field.')); return; }
            tSay('');
            tBusy = true;
            tBtn.disabled = true;
            var tLabel = tBtn.textContent;
            tBtn.textContent = t('Signing you in…');
            post('/v1/auth/totp', { pending: pendingTotp, code: code }).then(function () {
                location.replace('/dashboard');
            }).catch(function (failed) {
                tSay(reason(failed));
                tBusy = false;
                tBtn.disabled = false;
                tBtn.textContent = tLabel;
                tInput.value = '';
                tInput.focus();
                if (failed && (failed.status === 429 || failed.status === 401 && !pendingTotp)) {
                    setTimeout(function () { pendingTotp = ''; showTotp(false); }, 1800);
                }
            });
        });
        var busy = false;
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            if (busy) return;
            var emailInput = form.querySelector('input[type="email"]');
            var passInput = form.querySelector('input[type="password"]');
            var email = emailInput ? emailInput.value.trim() : '';
            var password = passInput ? passInput.value : '';
            if (!email || !password) {
                say(t('Please fill in every field.'));
                return;
            }
            say('');
            busy = true;
            submitBtn.disabled = true;
            var label = submitBtn.textContent;
            submitBtn.textContent = t('Signing you in…');

            lts.freshToken().then(function (tok) {
                var body = { email: email, password: password };
                if (lts.on && !tok) {
                    var missing = new Error('no_token');
                    missing.noToken = true;
                    throw missing;
                }
                if (tok) body['cf-turnstile-response'] = tok;
                return post('/v1/auth/login', body);
            }).then(function (out) {
                lts.spend();
                if (out && out.totp) {
                    pendingTotp = out.pending || '';
                    busy = false;
                    submitBtn.disabled = false;
                    submitBtn.textContent = label;
                    if (passInput) passInput.value = '';
                    showTotp(true);
                    return;
                }
                location.replace('/dashboard');
            }).catch(function (failed) {
                lts.spend();
                if (failed && failed.noToken) {
                    say(t(lts.fault() === 'script-blocked'
                        ? 'The security check could not load. An ad blocker or network filter may be blocking it.'
                        : 'The security check did not finish. Please try again.'));
                } else {
                    say(reason(failed));
                }
                busy = false;
                submitBtn.disabled = false;
                submitBtn.textContent = label;
                if (passInput) { passInput.value = ''; passInput.focus(); }
            });
        });
    }
    function scan() {
        document.querySelectorAll('form[data-auth="register"]').forEach(attach);
        document.querySelectorAll('form[data-auth="login"]').forEach(attachLogin);
        document.querySelectorAll('.sp-auth-form input[type="password"]').forEach(addEye);
    }

    scan();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
    else setTimeout(scan, 0);
    window.SentinelAuthFlow = window.SentinelAuthFlow || {};
    window.SentinelAuthFlow.scan = scan;
})();