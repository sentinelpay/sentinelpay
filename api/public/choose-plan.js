(function () {
    'use strict';

    if (location.hash && window.history && history.replaceState) {
        history.replaceState(null, '', location.pathname + location.search);
    }

    var gate = document.getElementById('lp-plan-gate');
    var grid = document.getElementById('choose-a-plan');
    if (!gate || !grid) return;

    var who = document.getElementById('lp-plan-gate-who');
    var site = document.getElementById('lp-plan-site');
    var gambling = document.getElementById('lp-plan-gambling');
    var consent = document.getElementById('lp-plan-consent');
    var err = document.getElementById('lp-plan-err');
    var go = document.getElementById('lp-plan-go');
    var cancel = document.getElementById('lp-plan-cancel');

    var t = function (x) { return window.SentinelI18n ? window.SentinelI18n.t(x) : x; };

    function api(path, opts) {
        var o = opts || {};
        return fetch(path, {
            method: o.method || 'GET',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: o.body ? JSON.stringify(o.body) : undefined
        }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (j) {
                return { ok: r.ok, status: r.status, body: j };
            });
        });
    }

    api('/v1/entitlement').then(function (r) {
        if (!r.ok) return;
        var email = r.body.email || '';
        if (who) who.textContent = t('Signed in as') + ' ' + email;
        var domain = email.split('@').pop();
        if (site && domain && domain.indexOf('.') !== -1) site.value = domain;

        var state = (r.body.trial && r.body.trial.state) || 'none';
        if (state === 'starter' || state === 'verified') location.replace('/dashboard');
    });

    function show(on) {
        gate.hidden = !on;
        if (on && site) site.focus();
        if (on) gate.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    grid.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('[data-plan-start]') : null;
        if (!btn) return;
        e.preventDefault();
        show(true);
    });

    if (cancel) cancel.addEventListener('click', function () { show(false); });

    if (go) go.addEventListener('click', function () {
        err.hidden = true;
        go.disabled = true;
        api('/v1/trial/activate', {
            method: 'POST',
            body: {
                website: site ? site.value.trim() : '',
                company: site ? site.value.trim() : '',
                notGambling: Boolean(gambling && gambling.checked),
                consent: Boolean(consent && consent.checked)
            }
        }).then(function (r) {
            go.disabled = false;
            if (!r.ok) {
                err.textContent = (r.body && r.body.error) || t('Could not start the trial');
                err.hidden = false;
                return;
            }
            if (r.body.state === 'pending') {
                location.replace('/dashboard');
                return;
            }
            location.replace('/dashboard');
        }).catch(function () {
            go.disabled = false;
            err.textContent = t('Could not start the trial');
            err.hidden = false;
        });
    });
})();
