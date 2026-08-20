/* the navigation lifting off the top of the page as you scroll.

   the bar starts edge to edge and flush. a little way down it pulls in from
   both sides, drops a few pixels from the top and grows a corner radius, so it
   reads as a floating pill over the page rather than as a strip stuck to the
   window. the mega menu follows it, because it takes the same numbers.

   this used to happen only on the homepage, because the progress came out of
   scroll.js and scroll.js measures the hero: no hero, no numbers, and the bar
   on every other page stayed square forever. that is the wrong thing to key on
   anyway. the hero is why the effect looks good on the homepage, but the reason
   for the effect is that you have started scrolling, and every page can tell
   you that.

   it is a separate file from nav.js on purpose. seven pages carry their own
   inline copy of the dropdown and hamburger wiring, and loading nav.js
   alongside would bind a second click handler to every one of them: menus that
   open and shut in the same tap. this file touches nothing but two custom
   properties, so it is safe to load everywhere, and it stays that way.

   the whole thing is two numbers written to the root element. the css owns what
   they mean, and this owns how far through the movement we are. */
(function () {
    var root = document.documentElement;
    // no navigation, nothing to lift
    if (!document.querySelector('.lp-nav')) return;

    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    // how far you scroll before the bar has fully lifted. short on purpose: this
    // is a response to "you are reading, not landing", and by the time the first
    // section is under the bar it should already have happened.
    var TRAVEL = 220;
    // the same numbers the homepage used, so the two do not disagree where both
    // are running
    var MAX_RADIUS = 26;

    var raf = 0;
    var last = -1;

    function apply() {
        raf = 0;
        var y = window.scrollY || root.scrollTop || 0;
        var p = Math.min(Math.max(y / TRAVEL, 0), 1);
        // eased, so the first pixels of scroll do most of the movement and the
        // end of it is calm rather than arriving with a stop
        var e = 1 - Math.pow(1 - p, 3);
        // a repaint per frame for a number nobody can see change is a repaint
        // wasted
        if (Math.abs(e - last) < 0.002) return;
        last = e;
        root.style.setProperty('--sp-fold', e.toFixed(4));
        root.style.setProperty('--sp-fold-radius', (e * MAX_RADIUS).toFixed(1) + 'px');
    }

    function onScroll() {
        if (raf) return;
        raf = window.requestAnimationFrame(apply);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    // a reload halfway down a page must not start the bar flush and animate it
    apply();
})();
