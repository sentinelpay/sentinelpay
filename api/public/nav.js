(function () {
    function closeAll() {
        var open = document.querySelectorAll('.lp-nav-dd-wrap.lp-dd-open');
        Array.prototype.forEach.call(open, function (w) { w.classList.remove('lp-dd-open'); });
    }

    var buttons = document.querySelectorAll('.lp-nav-dd-btn');
    Array.prototype.forEach.call(buttons, function (btn) {
        btn.addEventListener('click', function () {
            var wrap = this.closest('.lp-nav-dd-wrap');
            if (!wrap) return;
            var wasOpen = wrap.classList.contains('lp-dd-open');
            closeAll();
            if (!wasOpen) wrap.classList.add('lp-dd-open');
        });
    });
    var inside = document.querySelectorAll('.lp-nav-dd a');
    Array.prototype.forEach.call(inside, function (a) {
        a.addEventListener('click', closeAll);
    });
    document.addEventListener('click', function (e) {
        if (!e.target.closest || !e.target.closest('.lp-nav-dd-wrap')) closeAll();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeAll();
    });
    var hamburger = document.getElementById('lp-hamburger');
    var menu = document.getElementById('lp-mobile-menu');
    if (!hamburger || !menu) return;
    function open() {
        hamburger.classList.add('lp-hb-open');
        menu.classList.add('lp-mm-open');
        document.documentElement.classList.add('lp-scroll-lock');
        hamburger.setAttribute('aria-expanded', 'true');
    }
    function close() {
        hamburger.classList.remove('lp-hb-open');
        menu.classList.remove('lp-mm-open');
        document.documentElement.classList.remove('lp-scroll-lock');
        hamburger.setAttribute('aria-expanded', 'false');
    }
    hamburger.addEventListener('click', function () {
        if (menu.classList.contains('lp-mm-open')) close(); else open();
    });
    var links = menu.querySelectorAll('a');
    Array.prototype.forEach.call(links, function (a) { a.addEventListener('click', close); });
    var accs = menu.querySelectorAll('.lp-mm-acc-btn');
    Array.prototype.forEach.call(accs, function (btn) {
        btn.addEventListener('click', function () {
            var acc = this.closest('.lp-mm-acc');
            if (acc) acc.classList.toggle('lp-mm-acc-open');
        });
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && menu.classList.contains('lp-mm-open')) close();
    });
})();