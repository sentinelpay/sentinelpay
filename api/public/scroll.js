/* the hero folding away as you scroll.

   this is the move the reference is built around, and it is worth naming: the
   hero starts edge to edge and dark, and as you scroll it shrinks a few percent
   and grows a corner radius, so the white page underneath appears as a margin
   around it. the panel does not slide away, it steps back. by the time the logos
   arrive the dark block reads as a card that has been set down rather than a
   section that has been scrolled past.

   why it is worth the code: it is the one moment on the page where scrolling
   does something other than move the paper, and it costs nothing, because the
   only two things changing are a transform and a radius. no layout, no paint of
   anything but the corners, and it is driven by one listener.

   three details that separate this from the version that stutters:

     the work happens in a `requestAnimationFrame`, once per frame at most,
     however many scroll events the browser fires. a scroll handler that touches
     the dom directly runs dozens of times a frame on a trackpad.

     the values go into custom properties rather than into inline styles for each
     property, so the css keeps the numbers and this file keeps the progress.

     `will-change` is set while it is moving and dropped at both ends. left on
     for ever it holds a compositor layer for a section nobody is looking at. */
(function () {
    var hero = document.querySelector('.lp-hero');
    if (!hero) return;
    // the numbers go on the root rather than on the hero, because the navigation
    // is not inside the hero and has to follow the same progress
    var root = document.documentElement;

    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    // how far the panel travels: seven percent smaller and a 26px corner. more
    // than that and the headline visibly shrinks, which reads as a zoom out
    // rather than as a step back.
    var MAX_SHRINK = 0.07;
    var MAX_RADIUS = 26;

    var ticking = false;
    var lastP = -1;

    function apply() {
        ticking = false;
        var h = hero.offsetHeight || window.innerHeight;
        // finished a little before the hero has fully left, so the panel has
        // settled by the time the next section is being read
        var p = Math.min(Math.max(window.scrollY / (h * 0.85), 0), 1);
        // eased, so the first pixels of scroll do most of the moving and the
        // last stretch is calm
        var e = 1 - Math.pow(1 - p, 2);
        if (Math.abs(e - lastP) < 0.002) return;
        lastP = e;

        root.style.setProperty('--sp-fold', e.toFixed(4));
        root.style.setProperty('--sp-fold-scale', (1 - e * MAX_SHRINK).toFixed(4));
        root.style.setProperty('--sp-fold-radius', (e * MAX_RADIUS).toFixed(1) + 'px');
        // a layer while it moves, and not a moment longer
        hero.style.willChange = (e > 0.001 && e < 0.999) ? 'transform' : 'auto';
    }

    function onScroll() {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(apply);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    // a reload halfway down the page must not start from the top of the animation
    apply();
})();
