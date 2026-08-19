/* what the navigation says once somebody is signed in.

   the pair of buttons in the corner is an invitation, and an invitation to
   somebody who has already accepted it reads as the site not knowing who they
   are. so "Log in" and "Get started" become one button that goes to the
   dashboard, and a round mark with their initials next to it.

   why one button and not a menu: there is exactly one place to go. a menu that
   drops down to reveal a single item is a menu in the way. when there is an
   account page, a billing page and a team page, the mark becomes the menu and
   this file grows a list; today it would be a lid on an empty box.

   the swap happens after a request rather than being rendered into the page,
   which costs a moment on first paint. the alternative is rendering the nav per
   visitor, and that makes every page in the site uncacheable to save one
   request. the buttons are hidden until the answer arrives, so nobody sees "log
   in" turn into their own name.

   nothing here is a security boundary. it decides what a button says. the
   dashboard itself is refused by the server without a good cookie, so a person
   who edits this file in their own browser gets a nicer looking nav and no
   more access than they had. */
(function () {
    var box = document.getElementById('auth-nav-container');
    if (!box) return;

    var t = function (x) { return window.SentinelI18n ? window.SentinelI18n.t(x) : x; };
    var login = document.getElementById('nav-login-btn');
    var register = document.getElementById('nav-register-btn');
    var mLogin = document.getElementById('lp-mm-login');
    var mRegister = document.getElementById('lp-mm-register');

    // two letters at most: a first name and a surname give "vs", one name gives
    // "v". anything longer stops being a mark and becomes a word.
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
            // the full name is on the mark rather than beside it: the corner of a
            // navigation bar is not where somebody's address belongs, and a
            // screen reader still reads it
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

        // the mobile menu carries the same one button, in the same place its
        // pair used to be
        if (mLogin) mLogin.remove();
        if (mRegister) {
            mRegister.href = '/dashboard';
            mRegister.textContent = label;
        }
    }

    // hidden while we ask, so the first paint is not "Log in" flipping to a name
    box.classList.add('auth-nav-asking');
    function done() { box.classList.remove('auth-nav-asking'); }

    fetch('/v1/auth/me', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (me) { if (me && me.signedIn) signedIn(me); })
        .catch(function () { /* not signed in, as far as anyone can tell */ })
        .then(done);

    // a request that never comes back must not leave the corner empty
    setTimeout(done, 2500);
})();
