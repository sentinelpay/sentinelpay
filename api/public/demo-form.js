        (function() {
            var form = document.getElementById('lp-demo-form');
            if (!form) return;
            var steps = form.querySelectorAll('.lp-demo-step');
            var total = steps.length;
            var cur = 0;
            var fill = document.getElementById('lp-demo-fill');
            var pct = document.getElementById('lp-demo-pct');
            var backBtn = document.getElementById('lp-demo-back');
            var nextBtn = document.getElementById('lp-demo-next');
            var submitBtn = document.getElementById('lp-demo-submit');
            var successBox = document.getElementById('lp-demo-success');
            var emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

            var nameRe = /^[a-zA-ZÀ-ɏ'’.\- ]+$/;
            var letterRe = /[a-zA-ZÀ-ɏ]/;
            var alnumRe = /[a-zA-Z0-9À-ɏ]/;
            // two pages share this form engine. the markup, validation and custom
            // selects are identical; only the step contents and destination differ.
            var CONFIG = {
                demo: {
                    endpoint: '/v1/demo-request',
                    submitLabel: 'Request a demo',
                    heads: { 1: 'Tell us about yourself', 2: 'Help us understand your business', 3: 'Your crypto exposure & needs', 4: 'One last thing' },
                    required: { 1: ['firstName','lastName','jobTitle','email'], 2: ['company','website','industry','country'], 3: ['size','volume'], 4: [] }
                },
                trial: {
                    endpoint: '/v1/trial-request',
                    submitLabel: 'Start free trial',
                    heads: { 1: 'Who is signing up', 2: 'Confirm and start' },
                    required: { 1: ['firstName','lastName','email','website'], 2: [] }
                }
            };
            var cfg = CONFIG[form.getAttribute('data-form')] || CONFIG.demo;
            var heads = cfg.heads;
            // i18n translates the page once on load, so anything this script writes
            // afterwards (validation messages, button labels, toasts) has to look the
            // string up itself or it comes back in english on a translated page.
            var t = function (x) { return window.SentinelI18n ? window.SentinelI18n.t(x) : x; };
            // we publicly refuse gambling operators, so the form says so the moment it
            // is picked rather than letting someone fill four steps and be rejected by
            // the server. the server checks it too; this is the courteous half.
            var gamblingRe = /gambling|igaming|casino|betting|sportsbook|wager/i;
            // The browser needs no list of providers. The rule is the same for every
            // address, whoever it is with: the site has to be on the same domain.
            // The lists live on the server and only decide how a submission is
            // tagged once it is in, which is not a question the form has to answer.
            var domainRe = /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
            var headEl = document.getElementById('lp-demo-formhead');
            function setError(input, msg) {
                var field = input.closest('.lp-demo-field');
                if (!field) return;
                field.classList.toggle('lp-demo-invalid', !!msg);
                var err = field.querySelector('.lp-demo-error');
                if (msg) {
                    if (!err) { err = document.createElement('span'); err.className = 'lp-demo-error'; field.appendChild(err); }
                    err.textContent = msg;
                } else if (err) { err.remove(); }
            }
            function fieldError(inp) {
                var v = inp.value.trim();
                switch (inp.name) {
                    case 'firstName':
                    case 'lastName':
                        if (!v) return t('This field is required');
                        if (v.length < 2) return t('That looks too short');
                        if (!nameRe.test(v)) return t('Letters only, no numbers or symbols');
                        return '';
                    case 'jobTitle':
                        if (!v) return t('This field is required');
                        if (v.length < 2) return t('That looks too short');
                        if (!letterRe.test(v)) return t('Enter a real job title');
                        return '';
                    case 'company':
                        if (!v) return t('This field is required');
                        if (v.length < 2) return t('That looks too short');
                        if (!alnumRe.test(v)) return t('Enter a real company name');
                        return '';
                    case 'website':
                        if (!v) return t('This field is required');
                        var host = v.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./i, '').trim().toLowerCase();
                        if (!domainRe.test(host)) return t('Enter a valid domain, e.g. company.com');
                        var emailInp = form.querySelector('input[name="email"]');
                        var emailDomain = emailInp && emailInp.value.indexOf('@') !== -1 ? emailInp.value.trim().split('@').pop().toLowerCase() : '';
                        if (emailDomain && host !== emailDomain && host.slice(-(emailDomain.length + 1)) !== '.' + emailDomain && emailDomain.slice(-(host.length + 1)) !== '.' + host) {
                            return t('Must match your work email domain') + ' (@' + emailDomain + ')';
                        }
                        return '';
                    case 'size':
                        if (!v) return t('Please select company size');
                        return '';
                    case 'industry':
                        if (!v) return t('Please pick an industry');
                        if (gamblingRe.test(v)) return t('We do not work with gambling operators. This is a policy, not a limit we can lift.');
                        return '';
                    case 'country':
                        if (!v) return t('Please pick your country');
                        return '';
                    case 'volume':
                        if (!v) return t('Please pick an expected volume');
                        return '';
                    case 'message':
                        // optional: skip it entirely, or write as little as you like
                        if (!v) return '';
                        if (v.length > 250) return t('Keep it under 250 characters');
                        return '';
                    case 'email':
                        if (!v) return t('This field is required');
                        if (/\s/.test(v)) return t('Email cannot contain spaces');
                        if (!emailRe.test(v)) return t('Enter a valid email address');
                        if (/\.\./.test(v) || /@\./.test(v) || /\.$/.test(v)) return t('Enter a valid email address');
                        return '';
                }
                return '';
            }
            function validateStep(i) {
                var ok = true;
                var required = cfg.required;
                var stepEl = steps[i];
                var stepNo = parseInt(stepEl.getAttribute('data-step'), 10);
                var names = required[stepNo] || [];
                names.forEach(function(nm) {
                    var inp = stepEl.querySelector('[name="' + nm + '"]');
                    if (!inp) return;
                    var msg = fieldError(inp);
                    setError(inp, msg);
                    if (msg) ok = false;
                });
                var checks = stepEl.querySelectorAll('input[name="solutions"]');
                if (checks.length) {
                    var anyChecked = Array.prototype.some.call(checks, function(c) { return c.checked; });
                    var checkField = checks[0].closest('.lp-demo-field');
                    if (checkField) {
                        checkField.classList.toggle('lp-demo-invalid', !anyChecked);
                        var cerr = checkField.querySelector('.lp-demo-error');
                        if (!anyChecked) {
                            if (!cerr) { cerr = document.createElement('span'); cerr.className = 'lp-demo-error'; checkField.appendChild(cerr); }
                            cerr.textContent = t('Pick at least one');
                            ok = false;
                        } else if (cerr) { cerr.remove(); }
                    }
                }
                if (i === total - 1) {
                    // every tickbox in the final step is a declaration we rely on, so
                    // all of them must be ticked, not just the contact consent
                    stepEl.querySelectorAll('.lp-demo-consent input[type="checkbox"]').forEach(function(cb) {
                        var wrap = cb.closest('.lp-demo-consent');
                        if (!cb.checked) { ok = false; wrap.classList.add('lp-demo-consent-err'); }
                        else { wrap.classList.remove('lp-demo-consent-err'); }
                    });
                }
                return ok;
            }
            function render() {
                // any open dropdown belongs to the outgoing step, so close them all
                form.querySelectorAll('.lp-demo-select-menu:not([hidden])').forEach(function(m) {
                    m.hidden = true;
                    var w = m.closest('.lp-demo-select');
                    if (w) { w.classList.remove('is-open'); w.querySelector('.lp-demo-select-btn').setAttribute('aria-expanded', 'false'); }
                });
                steps.forEach(function(s, i) { s.hidden = i !== cur; });
                var active = steps[cur];
                active.style.animation = 'none'; void active.offsetWidth; active.style.animation = '';
                var p = Math.round(((cur + 1) / total) * 100);
                if (fill) fill.style.width = p + '%';
                if (pct) pct.textContent = p + '%';
                backBtn.hidden = cur === 0;
                nextBtn.hidden = cur === total - 1;
                submitBtn.hidden = cur !== total - 1;
                if (headEl) { var no = parseInt(active.getAttribute('data-step'), 10); if (heads[no]) headEl.textContent = t(heads[no]); }
            }
            render();

            var COUNTRIES = ["Afghanistan","Albania","Algeria","Andorra","Angola","Antigua & Barbuda","Argentina","Armenia","Australia","Austria","Azerbaijan","Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bhutan","Bolivia","Bosnia & Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso","Burundi","Cambodia","Cameroon","Canada","Cape Verde","Central African Republic","Chad","Chile","China","Colombia","Comoros","Congo (Brazzaville)","Congo (Kinshasa)","Costa Rica","Côte d’Ivoire","Croatia","Cuba","Cyprus","Czechia","Denmark","Djibouti","Dominica","Dominican Republic","Ecuador","Egypt","El Salvador","Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia","Fiji","Finland","France","Gabon","Gambia","Georgia","Germany","Ghana","Greece","Grenada","Guatemala","Guinea","Guinea-Bissau","Guyana","Haiti","Honduras","Hong Kong","Hungary","Iceland","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy","Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kiribati","Kosovo","Kuwait","Kyrgyzstan","Laos","Latvia","Lebanon","Lesotho","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg","Macau","Madagascar","Malawi","Malaysia","Maldives","Mali","Malta","Marshall Islands","Mauritania","Mauritius","Mexico","Micronesia","Moldova","Monaco","Mongolia","Montenegro","Morocco","Mozambique","Myanmar","Namibia","Nauru","Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria","North Korea","North Macedonia","Norway","Oman","Pakistan","Palau","Palestine","Panama","Papua New Guinea","Paraguay","Peru","Philippines","Poland","Portugal","Qatar","Romania","Russia","Rwanda","Saint Kitts & Nevis","Saint Lucia","Saint Vincent & the Grenadines","Samoa","San Marino","São Tomé & Príncipe","Saudi Arabia","Senegal","Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands","Somalia","South Africa","South Korea","South Sudan","Spain","Sri Lanka","Sudan","Suriname","Sweden","Switzerland","Syria","Taiwan","Tajikistan","Tanzania","Thailand","Timor-Leste","Togo","Tonga","Trinidad & Tobago","Tunisia","Turkey","Turkmenistan","Tuvalu","Uganda","Ukraine","United Arab Emirates","United Kingdom","United States","Uruguay","Uzbekistan","Vanuatu","Vatican City","Venezuela","Vietnam","Yemen","Zambia","Zimbabwe"];
            (function() {
                var cList = form.querySelector('.lp-demo-select[data-select="country"] .lp-demo-select-list');
                if (cList) {
                    var frag = document.createDocumentFragment();
                    COUNTRIES.forEach(function(c) {
                        var li = document.createElement('li');
                        li.className = 'lp-demo-select-opt';
                        li.setAttribute('role', 'option');
                        li.setAttribute('data-value', c);
                        li.textContent = c;
                        frag.appendChild(li);
                    });
                    cList.appendChild(frag);
                }
            })();

            var allSelects = form.querySelectorAll('.lp-demo-select');
            var closeAllSelects = function(except) {
                allSelects.forEach(function(w) {
                    if (w === except) return;
                    var m = w.querySelector('.lp-demo-select-menu');
                    if (m && !m.hidden) { m.hidden = true; w.classList.remove('is-open'); w.querySelector('.lp-demo-select-btn').setAttribute('aria-expanded', 'false'); }
                });
            };
            allSelects.forEach(function(wrap) {
                var input = wrap.querySelector('input[type="hidden"]');
                var btn = wrap.querySelector('.lp-demo-select-btn');
                var menu = wrap.querySelector('.lp-demo-select-menu');
                var val = wrap.querySelector('.lp-demo-select-val');
                var place = function() {
                    // clear last time's inline height before measuring, otherwise each
                    // open reads back the cap it set and the menu ratchets shut
                    menu.style.maxHeight = '';
                    var r = btn.getBoundingClientRect();
                    var pad = 8;
                    // the visual viewport, not window.innerHeight. on ios innerHeight
                    // counts the strip behind the collapsing toolbar and does not shrink
                    // when the keyboard is up, so a menu measured against it opens into
                    // space the visitor cannot see. vv.offsetTop is how far the page is
                    // pushed up when the keyboard pans it.
                    var vv = window.visualViewport;
                    var vw = vv ? vv.width : document.documentElement.clientWidth;
                    var vh = vv ? vv.height : window.innerHeight;
                    var vTop = vv ? vv.offsetTop : 0;

                    // the menu tracks its button, but never wider than the screen and
                    // never past either edge
                    var w = Math.min(r.width, vw - pad * 2);
                    menu.style.width = w + 'px';
                    menu.style.left = Math.max(pad, Math.min(r.left, vw - w - pad)) + 'px';

                    // the CSS cap is the most it may ever be; a vh value on mobile
                    var capPx = parseFloat(getComputedStyle(menu).maxHeight) || 200;
                    var want = Math.min(menu.scrollHeight, capPx);
                    // the visible band, in the same coordinates the button rect uses
                    var top = vTop, bottom = vTop + vh;
                    var below = bottom - r.bottom - pad;
                    var above = r.top - top - pad;

                    // open on whichever side has the room. if neither has enough, take
                    // the bigger side and shorten the menu to fit: it scrolls, which is
                    // recoverable, where running off the bottom of the screen is not.
                    var up = below < want && above > below;
                    var room = Math.max(up ? above : below, 120);
                    var h = Math.min(want, room);
                    menu.style.maxHeight = h + 'px';
                    menu.style.top = (up
                        ? Math.max(top + pad, r.top - pad - h)
                        : Math.min(r.bottom + pad, bottom - h - pad)) + 'px';
                };
                var search = wrap.querySelector('.lp-demo-select-search');
                var emptyMsg = wrap.querySelector('.lp-demo-select-empty');
                var runFilter = function() {
                    if (!search) return;
                    var q = search.value.trim().toLowerCase();
                    var shown = 0;
                    wrap.querySelectorAll('.lp-demo-select-opt').forEach(function(o) {
                        var match = o.textContent.toLowerCase().indexOf(q) !== -1;
                        o.hidden = !match;
                        if (match) shown++;
                    });
                    if (emptyMsg) emptyMsg.hidden = shown !== 0;
                };
                var open = function(o) {
                    menu.hidden = !o;
                    wrap.classList.toggle('is-open', o);
                    btn.setAttribute('aria-expanded', o ? 'true' : 'false');
                    if (o) {
                        place();
                        if (search) { search.value = ''; runFilter(); setTimeout(function() { search.focus({ preventScroll: true }); }, 0); }
                    }
                };
                if (search) {
                    search.addEventListener('input', runFilter);
                    search.addEventListener('click', function(e) { e.stopPropagation(); });
                }
                window.addEventListener('resize', function() { if (!menu.hidden) place(); });
                // the keyboard opening and the toolbar collapsing both change the
                // visible band without firing a window resize on ios
                if (window.visualViewport) {
                    window.visualViewport.addEventListener('resize', function() { if (!menu.hidden) place(); });
                    window.visualViewport.addEventListener('scroll', function() { if (!menu.hidden) place(); });
                }
                window.addEventListener('scroll', function(e) {
                    // page scrolls: keep the fixed-position menu glued to its button
                    if (!menu.hidden && !(e.target instanceof Node && menu.contains(e.target))) place();
                }, true);
                btn.addEventListener('click', function(e) { e.stopPropagation(); var willOpen = menu.hidden; closeAllSelects(wrap); open(willOpen); });
                btn.addEventListener('keydown', function(e) { if (e.key === 'Escape') open(false); });
                menu.addEventListener('keydown', function(e) { if (e.key === 'Escape') { open(false); btn.focus(); } });
                wrap.querySelectorAll('.lp-demo-select-opt').forEach(function(opt) {
                    opt.addEventListener('click', function() {
                        wrap.querySelectorAll('.lp-demo-select-opt').forEach(function(o) { o.classList.remove('is-active'); });
                        opt.classList.add('is-active');
                        input.value = opt.getAttribute('data-value');
                        val.textContent = opt.textContent;
                        val.classList.remove('is-placeholder');
                        setError(input, fieldError(input));
                        open(false);
                    });
                });
                document.addEventListener('click', function(e) { if (!wrap.contains(e.target)) open(false); });
            });

            /* "not sure yet" and the rest cannot both be true.
               ------------------------------------------------------------
               ticking it clears everything else, and ticking anything else
               clears it. someone who has picked four products is not unsure,
               and a submission that says both tells us nothing.

               which box is the exclusive one comes from `data-exclusive` in
               the markup rather than from matching its value against a string.
               it used to compare against 'Not sure yet' while the markup said
               value="not sure yet", so the two never matched and none of this
               ran: the case had drifted apart in a pass over the site's
               capitalisation, and a comparison against display text is a thing
               that will drift again. an attribute is not copy and nothing
               rewrites it.

               the values themselves now read the way the labels do, because
               they are not internal codes: they are what lands in the
               notification email, and "transaction screening, api & data
               feeds" was arriving in lower case in a mail whose every other
               line had been fixed. */
            form.querySelectorAll('input[name="solutions"]').forEach(function(cb) {
                cb.addEventListener('change', function() {
                    if (cb.checked) {
                        var isExclusive = cb.hasAttribute('data-exclusive');
                        form.querySelectorAll('input[name="solutions"]').forEach(function(other) {
                            if (other === cb) return;
                            var otherIsExclusive = other.hasAttribute('data-exclusive');
                            if (isExclusive || otherIsExclusive) other.checked = false;
                        });
                    }
                    var field = cb.closest('.lp-demo-field');
                    if (field && field.classList.contains('lp-demo-invalid') && form.querySelector('input[name="solutions"]:checked')) {
                        field.classList.remove('lp-demo-invalid');
                        var e = field.querySelector('.lp-demo-error');
                        if (e) e.remove();
                    }
                });
            });

            var msgArea = form.querySelector('textarea[name="message"]');
            var msgCount = document.getElementById('lp-demo-msg-count');
            if (msgArea) {
                var autoGrow = function() {
                    msgArea.style.height = 'auto';
                    msgArea.style.height = Math.min(msgArea.scrollHeight, 116) + 'px';
                };
                msgArea.addEventListener('input', function() {
                    autoGrow();
                    if (msgCount) msgCount.textContent = msgArea.value.length;
                });
                autoGrow();
            }

            var validatedNames = ['firstName','lastName','jobTitle','company','website','email','message'];
            form.querySelectorAll('input[name], select[name], textarea[name]').forEach(function(inp) {
                if (validatedNames.indexOf(inp.name) === -1) return;
                inp.addEventListener('blur', function() { setError(inp, fieldError(inp)); });
                inp.addEventListener('input', function() {
                    var field = inp.closest('.lp-demo-field');
                    if (field && field.classList.contains('lp-demo-invalid')) setError(inp, fieldError(inp));
                });
            });
            // The website rule is the only one that reads a second field: it has to
            // agree with the work email. That makes it go stale in one direction.
            // Editing the email after the website has already passed leaves the
            // website green on an answer that is no longer true, and the mismatch is
            // then caught by the server, which reaches the visitor as a toast after
            // they have pressed send. Re-judge the website whenever the email moves.
            var emailField = form.querySelector('input[name="email"]');
            var siteField = form.querySelector('input[name="website"]');
            if (emailField && siteField) {
                var recheckSite = function() {
                    if (!siteField.value.trim()) return;
                    setError(siteField, fieldError(siteField));
                };
                // on blur, because marking the website wrong while someone is still
                // halfway through typing their address would be noise
                emailField.addEventListener('blur', recheckSite);
                // while typing, only to take the red away again the moment the email
                // is corrected. the same rule the other fields already follow.
                emailField.addEventListener('input', function() {
                    var f = siteField.closest('.lp-demo-field');
                    if (f && f.classList.contains('lp-demo-invalid')) recheckSite();
                });
            }

            var consentInp = form.querySelector('input[name="consent"]');
            if (consentInp) consentInp.addEventListener('change', function() {
                if (consentInp.checked) consentInp.closest('.lp-demo-consent').classList.remove('lp-demo-consent-err');
            });

            nextBtn.addEventListener('click', function() {
                if (!validateStep(cur)) return;
                if (cur < total - 1) { cur++; render(); }
            });
            backBtn.addEventListener('click', function() {
                if (cur > 0) { cur--; render(); }
            });

            // A single-input form submits on enter, and this form has one <form> across
            // four steps, so enter on step 1 fired the real submit: it validated only the
            // step you were on and posted a half-empty request, once per press. Enter now
            // means "next" until the last step, where it means submit.
            form.addEventListener('keydown', function(e) {
                if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
                var el = e.target;
                var tag = el && el.tagName;
                if (tag === 'TEXTAREA') return;                 // enter is a newline there
                if (tag === 'BUTTON' || tag === 'A') return;     // let the control do its job
                if (cur < total - 1) {
                    e.preventDefault();
                    if (validateStep(cur)) { cur++; render(); }
                    return;
                }
                // last step: only let it through once the declarations are ticked, and
                // never while a send is already in flight
                if (submitBtn.disabled) { e.preventDefault(); }
            });

            // Cloudflare Turnstile — activates only when window.__TURNSTILE_SITEKEY is set.
            var turnstileToken = '';
            var turnstileEnabled = false;
            (function initTurnstile() {
                var siteKey = window.__TURNSTILE_SITEKEY;
                var holder = document.getElementById('lp-demo-turnstile');
                if (!siteKey || !holder) return;
                turnstileEnabled = true;
                function renderWidget() {
                    if (!window.turnstile) return;
                    window.turnstile.render(holder, {
                        sitekey: siteKey,
                        // the cards are white now: a dark widget on one read as a hole
                        theme: 'light',
                        callback: function(t) { turnstileToken = t; },
                        'expired-callback': function() { turnstileToken = ''; },
                        'error-callback': function() { turnstileToken = ''; }
                    });
                }
                if (window.turnstile) { renderWidget(); }
                else {
                    var s = document.createElement('script');
                    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
                    s.async = true; s.defer = true;
                    s.onload = renderWidget;
                    document.head.appendChild(s);
                }
            })();

            // --- outage guard ---------------------------------------------
            // when the server says it cannot receive submissions, the form says so
            // and stops, rather than taking someone through four steps and failing
            // at the end. the attribute is set server-side from STATUS_BLOCKS_MAIL.
            var mailDown = document.documentElement.hasAttribute('data-mail-down');
            if (mailDown) {
                submitBtn.disabled = true;
                submitBtn.setAttribute('aria-disabled', 'true');
                // the fold pages own exactly one viewport and are tuned to the pixel,
                // so an extra paragraph inside the card pushes the logo strip out of
                // frame. there the banner at the top of the same viewport is the
                // explanation, and the dead button is the signal.
                if (!form.closest('.bad-form-card')) {
                    var warn = document.createElement('p');
                    warn.className = 'lp-demo-mail-down';
                    warn.textContent = t('We cannot receive form submissions right now. We are working on it, please try again shortly.');
                    var actions = form.querySelector('.lp-demo-actions');
                    if (actions && actions.parentNode) actions.parentNode.insertBefore(warn, actions);
                }
            }

            form.addEventListener('submit', function(e) {
                e.preventDefault();
                if (mailDown) return;
                if (!validateStep(cur)) return;
                if (turnstileEnabled && !turnstileToken) {
                    if (window.SentinelToast) window.SentinelToast.show(t('Please complete the verification below.'), 'warning');
                    return;
                }
                var data = {};
                new FormData(form).forEach(function(v, k) { if (k !== 'solutions') data[k] = typeof v === 'string' ? v.trim() : v; });
                data.solutions = Array.prototype.map.call(form.querySelectorAll('input[name="solutions"]:checked'), function(c) { return c.value; });
                form.querySelectorAll('.lp-demo-consent input[type="checkbox"]').forEach(function(cb) { data[cb.name] = !!cb.checked; });
                if (turnstileToken) data['cf-turnstile-response'] = turnstileToken;
                // the confirmation email is written in whatever language the visitor is reading
                data.lang = (window.SentinelI18n && typeof window.SentinelI18n.lang === 'function' ? window.SentinelI18n.lang() : 'en') || 'en';
                submitBtn.disabled = true;
                submitBtn.textContent = t('Sending…');
                fetch(cfg.endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                }).then(function(r) {
                    if (r.ok) return r.json().catch(function(){ return {}; });
                    // the server says exactly what is wrong: a domain that does not
                    // match, a free mailbox, too many attempts. showing "sending is
                    // not working" instead sends people to support over something
                    // they could fix in the field in front of them.
                    return r.json().catch(function(){ return {}; }).then(function(body) {
                        // not user-facing copy: a status code, so the translation audit does not flag it
                        var err = new Error('http_' + r.status);
                        err.reason = body && body.error;
                        err.status = r.status;
                        throw err;
                    });
                }).then(function() {
                    // clear the way for the success panel. on the fold pages the card
                    // must not change size, so the form keeps its space and the panel
                    // is laid over it. elsewhere the card is free to collapse.
                    var fold = form.closest('.bad-form-card');
                    if (fold) {
                        // the pane stays in the layout, only invisible, so the card
                        // keeps its height and nothing below it shifts
                        form.classList.add('is-sent');
                    } else {
                        form.style.display = 'none';
                        var card = form.closest('.lp-demo-card');
                        if (card) {
                            var left = card.querySelector('.lp-demo-left');
                            var right = card.querySelector('.lp-demo-right');
                            if (left) left.style.display = 'none';
                            if (right) right.style.display = 'none';
                        }
                    }
                    var host = form.parentElement;
                    if (host) host.querySelectorAll('[data-on-success="hide"]').forEach(function(el) { el.style.display = 'none'; });
                    if (successBox) successBox.hidden = false;
                }).catch(function(err) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = t(cfg.submitLabel);
                    turnstileToken = '';
                    if (turnstileEnabled && window.turnstile) { try { window.turnstile.reset(); } catch (e) {} }
                    // only a 500 or a dead connection is actually "sending is broken".
                    // everything else is something the visitor can act on.
                    var msg = (err && err.reason && err.status && err.status < 500)
                        ? t(err.reason)
                        : t('Could not send right now. Please email support@sentinelpay.org');
                    if (window.SentinelToast) window.SentinelToast.show(msg, 'error');
                    else alert(msg);
                });
            });
        })();
