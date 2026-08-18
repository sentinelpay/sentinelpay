/* one trick per section.

   the page already arrives well: blocks rise into place as you scroll and the
   dark bands open out to the edges. what it did not have was a reason to stop
   at any particular section. this file gives each one a single thing it does
   that none of the others do, which is what makes a page feel built rather than
   assembled from a kit.

   what each one gets, and why that one:

     built for you   the role card leans toward the pointer, with the light on
                     it moving as it leans. it is the only card on the page you
                     choose the contents of, so it is the one that should feel
                     like an object in your hands.

     nine tools      the cards do not tilt, they light along the edge nearest
                     the cursor. nine tilting cards would be a fairground; one
                     line of light says which one you are on and nothing else.

     stats           one pass of light across the band as it arrives, once. the
                     numbers are already counting up, and a second entrance for
                     the same block would fight the first.

     guides          the guide card lags the scroll slightly. it is the only
                     place on the page with a foreground object over a
                     background, and a small difference in speed is what makes
                     two planes read as two planes.

   three rules the whole file obeys:

     nothing here is required for anything to work or to be readable. every
     effect is a transform or a shadow on top of a layout that is already
     correct, so with this file blocked the page is the page.

     `prefers-reduced-motion` stops all of it, and so does a coarse pointer for
     the two hover effects: a tilt that needs a cursor is a tilt that does
     nothing on a phone except cost a touch handler.

     everything that moves on scroll or on pointer goes through one
     `requestAnimationFrame`, and writes custom properties rather than styles,
     so the css keeps the design and this file keeps the numbers. */
(function () {
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    var fine = !(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

    /* ---- the pointer effects ------------------------------------------- */
    /* both of them are the same two numbers: where the cursor is inside the
       element, from 0 to 1 on each axis. the css decides whether that becomes a
       tilt or a light. */
    function trackPointer(el, cls) {
        var raf = 0;
        var mx = 0.5, my = 0.5;

        function write() {
            raf = 0;
            el.style.setProperty('--sp-mx', mx.toFixed(4));
            el.style.setProperty('--sp-my', my.toFixed(4));
        }
        function queue() {
            if (raf) return;
            raf = window.requestAnimationFrame(write);
        }

        el.addEventListener('pointermove', function (e) {
            var r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            mx = (e.clientX - r.left) / r.width;
            my = (e.clientY - r.top) / r.height;
            queue();
        }, { passive: true });

        el.addEventListener('pointerenter', function () { el.classList.add(cls); }, { passive: true });
        el.addEventListener('pointerleave', function () {
            el.classList.remove(cls);
            // back to the middle, so the next lean starts from flat rather than
            // snapping from wherever the cursor happened to leave
            mx = 0.5; my = 0.5;
            queue();
        }, { passive: true });
    }

    if (fine) {
        var leaners = document.querySelectorAll('.lp-role-feature');
        Array.prototype.forEach.call(leaners, function (el) { trackPointer(el, 'sp-lean-on'); });

        var lit = document.querySelectorAll('.lp-sol-card');
        Array.prototype.forEach.call(lit, function (el) { trackPointer(el, 'sp-lit-on'); });
    }

    /* ---- the one pass of light across a band --------------------------- */
    /* a class, added once, never removed: the animation is `forwards` and runs a
       single time. removing the class on the way out and adding it again on the
       way back is a band that flashes every time you scroll past it. */
    if (window.IntersectionObserver) {
        var bands = document.querySelectorAll('.lp-statsx, .lp-intel-banner');
        if (bands.length) {
            var bandIo = new IntersectionObserver(function (entries) {
                entries.forEach(function (e) {
                    if (!e.isIntersecting) return;
                    e.target.classList.add('sp-swept');
                    bandIo.unobserve(e.target);
                });
            }, { threshold: 0.25 });
            Array.prototype.forEach.call(bands, function (el) { bandIo.observe(el); });
        }
    }

    /* ---- the guide card lagging the scroll ----------------------------- */
    var floaters = document.querySelectorAll('.lp-intel-guide');
    var floatList = Array.prototype.slice.call(floaters);
    if (floatList.length) {
        var fraf = 0;

        function floatStep() {
            fraf = 0;
            var vh = window.innerHeight || 1;
            for (var i = 0; i < floatList.length; i++) {
                var el = floatList[i];
                var r = el.getBoundingClientRect();
                // nothing to do for something that is nowhere near the window
                if (r.bottom < -200 || r.top > vh + 200) continue;
                // -1 at the bottom of the window, +1 at the top, 0 dead centre
                var p = 1 - (r.top + r.height * 0.5) / (vh * 0.5);
                el.style.setProperty('--sp-lag', (p * 26).toFixed(2) + 'px');
            }
        }
        function floatQueue() {
            if (fraf) return;
            fraf = window.requestAnimationFrame(floatStep);
        }
        window.addEventListener('scroll', floatQueue, { passive: true });
        window.addEventListener('resize', floatQueue, { passive: true });
        floatStep();
    }
})();
