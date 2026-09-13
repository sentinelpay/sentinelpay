(function () {
    var box = document.getElementById('auth-nav-container');
    if (!box) return;
    var t = function (x) { return window.SentinelI18n ? window.SentinelI18n.t(x) : x; };
    var login = document.getElementById('nav-login-btn');
    var register = document.getElementById('nav-register-btn');
    var mLogin = document.getElementById('lp-mm-login');
    var mRegister = document.getElementById('lp-mm-register');

    function initials(name) {
        var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        var first = parts[0].charAt(0);
        var last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
        return (first + last).toUpperCase();
    }
    function signedIn(me) {
        var label = t('Dashboard');
        if (login && register) {
            var mark = document.createElement('a');
            mark.className = 'auth-nav-mark';
            mark.classList.add('lp-desktop-auth');
            mark.href = '/dashboard';
            mark.textContent = initials(me.name);

            mark.setAttribute('aria-label', me.name || t('Your account'));
            mark.title = me.name || '';
            var go = document.createElement('a');
            go.className = 'auth-nav-btn';
            go.classList.add('lp-btn-solid', 'lp-desktop-auth');
            go.id = 'nav-dashboard-btn';
            go.href = '/dashboard';
            go.textContent = label;
            box.insertBefore(mark, login);
            box.insertBefore(go, login);
            login.remove();
            register.remove();
        }
        if (mLogin) mLogin.remove();
        if (mRegister) {
            mRegister.href = '/dashboard';
            mRegister.textContent = label;
        }
    }
    box.classList.add('auth-nav-asking');
    function done() { box.classList.remove('auth-nav-asking'); }
    fetch('/v1/auth/me', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (me) { if (me && me.signedIn) signedIn(me); })
        .catch(function () {  })
        .then(done);
    setTimeout(done, 2500);
})();