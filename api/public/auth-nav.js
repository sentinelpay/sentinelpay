(function () {
    var box = document.getElementById('auth-nav-container');
    if (!box) return;
    var t = function (x) { return window.SentinelI18n ? window.SentinelI18n.t(x) : x; };
    var login = document.getElementById('nav-login-btn');
    var register = document.getElementById('nav-register-btn');
    var mLogin = document.getElementById('lp-mm-login');
    var mRegister = document.getElementById('lp-mm-register');

    // One button, and it is the one that does something. The initials beside it
    // went to the same address, so the front page was offering the same door
    // twice and spending the wider of the two slots on the half that only said
    // who you are. Who you are is on every page behind it.
    function signedIn(me) {
        var label = t('Dashboard');
        if (login && register) {
            var go = document.createElement('a');
            go.className = 'auth-nav-btn';
            go.classList.add('lp-btn-solid', 'lp-desktop-auth');
            go.id = 'nav-dashboard-btn';
            go.href = '/dashboard';
            go.textContent = label;
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