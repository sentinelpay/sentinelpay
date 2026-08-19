/* the navigation's behaviour: the dropdowns and the mobile menu.

   why this file exists at all: the blog is served from its own host and it had a
   stub for a header, a logo and one button back to the site. it looked like a
   different company's website. giving it the real navigation means giving it the
   navigation's javascript, and that javascript lives inlined in a six kilobyte
   script inside index.html, tangled up with the scroll restoration and the eye
   that follows the cursor.

   so the two parts the navigation actually needs are here instead, and the blog
   loads this. the seven pages that already carry their own inline copy are left
   alone: their copies work, they are not byte-identical to each other, and
   rewriting seven working files to save a duplicate is the kind of tidying that
   breaks something on a friday. it is worth doing, and it is worth doing on its
   own rather than inside a change about the blog.

   everything here is defensive. no dropdown on the page, no listeners; no
   hamburger, no listeners. a page that does not have a navigation pays nothing
   for loading this. */
(function () {
    /* ---- the desktop dropdowns ------------------------------------------ */
    /* opening is css on :hover. this is the click path, which is what a
       keyboard and a touch screen get, and what closes one when you open
       another or press escape. */
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

    // following a link out of a panel should not leave the panel hanging open
    // behind the page you land on
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

    /* ---- the mobile menu ------------------------------------------------ */
    var hamburger = document.getElementById('lp-hamburger');
    var menu = document.getElementById('lp-mobile-menu');
    if (!hamburger || !menu) return;

    function open() {
        hamburger.classList.add('lp-hb-open');
        menu.classList.add('lp-mm-open');
        // the page behind a full screen menu must not scroll under it
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

    // any link inside closes it, or the menu stays over the page you asked for
    var links = menu.querySelectorAll('a');
    Array.prototype.forEach.call(links, function (a) { a.addEventListener('click', close); });

    // the accordions inside the mobile menu
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
