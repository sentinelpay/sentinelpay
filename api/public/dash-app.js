(function () {
    'use strict';

    var app = document.getElementById('app');
    var side = document.getElementById('side');
    var menuBtn = document.getElementById('menu-btn');
    var scrim = document.getElementById('scrim');

    function setMenu(open) {
        if (!app) return;
        app.classList.toggle('is-open', open);
        if (scrim) scrim.hidden = !open;
        if (menuBtn) menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    if (menuBtn) {
        menuBtn.addEventListener('click', function () {
            setMenu(!app.classList.contains('is-open'));
        });
    }
    if (scrim) scrim.addEventListener('click', function () { setMenu(false); });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') setMenu(false);
    });
    window.addEventListener('resize', function () {
        if (window.innerWidth > 900) setMenu(false);
    });

    function initials(name, email) {
        var source = String(name || '').trim();
        if (source) {
            var parts = source.split(/\s+/).slice(0, 2);
            return parts.map(function (p) { return p.charAt(0); }).join('').toUpperCase();
        }
        return String(email || '?').charAt(0).toUpperCase();
    }

    function centreInk(host, inner) {
        if (!host || !inner || !window.HTMLCanvasElement) return;
        try {
            var cs = getComputedStyle(host);
            var g = document.createElement('canvas').getContext('2d');
            if (!g || !g.measureText) return;
            var scale = 20;
            var size = parseFloat(cs.fontSize) * scale;
            if (!size) return;
            g.font = cs.fontWeight + ' ' + size + 'px ' + cs.fontFamily;
            var m = g.measureText(inner.textContent);
            if (m.actualBoundingBoxLeft == null || m.actualBoundingBoxRight == null) return;
            var inkMid = (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
            var dx = (m.width / 2 - inkMid) / scale;
            inner.style.setProperty('--ink-x', dx.toFixed(3) + 'px');
        } catch (err) {  }
    }

    function paintAvatar(me) {
        var name = document.getElementById('who-name');
        var mail = document.getElementById('who-mail');
        var avatar = document.getElementById('avatar');
        var inner = document.getElementById('avatar-in');
        if (name) name.textContent = me.name || '';
        if (mail) mail.textContent = me.email || '';
        if (!avatar || !inner) return;
        inner.textContent = initials(me.name, me.email);
        avatar.setAttribute('aria-label', me.email || 'Account');
        var place = function () { centreInk(avatar, inner); };
        place();
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    }

    fetch('/v1/entitlement', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (me) { if (me) paintAvatar(me); })
        .catch(function () {  });
})();
