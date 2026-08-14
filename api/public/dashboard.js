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
            if (first) set('dash-greet', t('welcome back') + ', ' + first);
            // the panel appears for staff. it is a set of links and nothing
            // else: every page behind it checks the session for itself, so
            // unhiding this by hand in a browser opens nothing.
            var staff = document.getElementById('dash-staff');
            if (staff && me.staff) staff.hidden = false;
        })
        .catch(function () {
            // the page is already on screen and says nothing untrue: the rows
            // simply stay as dashes rather than the page throwing somebody out
            // over one failed request
        });

    var out = document.getElementById('dash-logout');
    if (out) {
        out.addEventListener('click', function () {
            out.disabled = true;
            out.textContent = t('signing out…');
            fetch('/v1/auth/logout', { method: 'POST', credentials: 'same-origin' })
                .catch(function () { /* the cookie is cleared by the server; try anyway */ })
                .then(function () { location.replace('/'); });
        });
    }
})();
