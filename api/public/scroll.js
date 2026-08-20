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
    var reducedAll = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* the dark bands arriving.

       the second half of the reference's scroll behaviour, and the part that is
       easy to miss until you look for it: a full width dark band does not simply
       appear, it comes up slightly narrower with rounded corners and opens out to
       the edges of the window as it enters. the band reads as a panel being laid
       into the page rather than as a colour change.

       `clip-path: inset()` rather than a width or a transform, and that is the
       whole reason this is worth doing rather than avoiding: a width change is
       layout and reflows the text inside on every frame, and a scaleX squashes
       the words. clipping leaves the content exactly where it was laid out and
       only changes what is painted, so the numbers inside never move a pixel. */
    var bands = document.querySelectorAll('.lp-statsx, .lp-cta-band');
    var bandList = Array.prototype.slice.call(bands);

    function bandStep() {
        for (var i = 0; i < bandList.length; i++) {
            var el = bandList[i];
            var r = el.getBoundingClientRect();
            var vh = window.innerHeight || 1;
            // fully open by the time its top edge has reached a third of the way
            // up the window, so it is settled well before it is being read
            var p = (vh - r.top) / (vh * 0.66);
            p = Math.min(Math.max(p, 0), 1);
            var e = 1 - Math.pow(1 - p, 3);
            el.style.setProperty('--sp-in', e.toFixed(4));
        }
    }

    if (bandList.length && !reducedAll) {
        var bandTick = false;
        var onBandScroll = function () {
            if (bandTick) return;
            bandTick = true;
            window.requestAnimationFrame(function () { bandTick = false; bandStep(); });
        };
        window.addEventListener('scroll', onBandScroll, { passive: true });
        window.addEventListener('resize', onBandScroll, { passive: true });
        bandStep();
    }

    var hero = document.querySelector('.lp-hero');
    if (!hero) return;
    // the numbers go on the root rather than on the hero, because the navigation
    // is not inside the hero and has to follow the same progress
    var root = document.documentElement;

    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    // how far the panel travels: seven percent smaller. more than that and the
    // headline visibly shrinks, which reads as a zoom out rather than a step back.
    var MAX_SHRINK = 0.07;

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

        // only the shrink that belongs to the hero. the lift and the radius on
        // the bar come from navlift.js, which every page loads: keyed on
        // having scrolled rather
        // than on a hero, so the bar behaves the same on the blog and on the
        // privacy policy as it does here. two files writing one property would
        // be two answers to the same question.
        root.style.setProperty('--sp-fold-scale', (1 - e * MAX_SHRINK).toFixed(4));
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
