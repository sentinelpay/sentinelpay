/* one trick per section.

   the page already arrives well: blocks rise into place as you scroll and the
   dark bands open out to the edges. what it did not have was a reason to stop
   at any particular section. this file gives each one a single thing it does
   that none of the others do, which is what makes a page feel built rather than
   assembled from a kit.

   what each one gets, and why that one:

     every heading   wiped up from behind a mask rather than faded in. it is the
                     one move that repeats, because it is the page's punctuation:
                     you know a new section has started before you have read a
                     word of it. done with a clip rather than by splitting the
                     text into lines, because splitting a heading into lines
                     means splitting a sentence, and croatian and german do not
                     break where english does.

     built for you   the role card leans toward the pointer, with the light on
                     it moving as it leans. it is the only card on the page you
                     choose the contents of, so it is the one that should feel
                     like an object in your hands.

     nine tools      the cards are dealt: each one arrives tipped back in three
                     dimensions and settles flat, one after another. they light
                     along the edge nearest the cursor rather than tilting,
                     because nine tilting cards would be a fairground.

     stats           one pass of light across the band as it arrives, once. the
                     numbers are already counting up, and a second entrance for
                     the same block would fight the first.

     guides          the guide card lags the scroll vertically. it is the only
                     place on the page with a foreground object over a
                     background, and a small difference in speed is what makes
                     two planes read as two planes.

     insights        the featured article drifts sideways instead, so the two
                     parallax sections are not the same parallax.

     questions       a rail down the left of the list fills as you read past it.
                     the section is a long list with no landmarks, and the rail
                     is the only place on the page that tells you where you are
                     inside a section rather than on the page.

     book a demo     a light travels once around the border of the form when it
                     arrives. it is the last thing on the page and the only
                     thing anyone is asked to fill in.

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

    /* ---- the things that follow the scroll ------------------------------ */
    /* three effects, one loop, one custom property each. they are together
       because they all need the same number, how far through the window an
       element is, and running three scroll listeners to compute the same thing
       three times is three times the work for no reason. */
    /* two of the three stop at the phone.

       the lag and the drift are parallax: a card sits a few pixels off where
       the page put it, and the offset follows the scroll. on a desktop, where
       scrolling is a wheel and the cards sit in a row, that reads as depth. on
       a phone it does not, for two reasons. the cards are stacked one per row
       and full width, so a card leaning against its neighbours has no
       neighbours to lean against, and the movement is just wobble. and phone
       scrolling has momentum: your finger has left the glass and the page is
       still moving, so anything tied to scroll position keeps moving after you
       have stopped asking it to. parallax that argues with momentum is the
       thing that makes a site feel cheap on a phone.

       the rail stays. it is a reading-progress line down the side of the
       questions, it is one element, and a progress line that follows momentum
       is a progress line doing its job rather than an effect fighting one. */
    var lagList = fine ? Array.prototype.slice.call(document.querySelectorAll('.lp-intel-guide')) : [];
    var driftList = fine ? Array.prototype.slice.call(document.querySelectorAll('.lp-ins-featured')) : [];
    var railList = Array.prototype.slice.call(document.querySelectorAll('.lp-faq-list'));

    if (lagList.length || driftList.length || railList.length) {
        var sraf = 0;

        // -1 when the element's middle is at the bottom of the window, +1 at the
        // top, 0 when it is dead centre
        function through(el, vh) {
            var r = el.getBoundingClientRect();
            if (r.bottom < -240 || r.top > vh + 240) return null;
            return 1 - (r.top + r.height * 0.5) / (vh * 0.5);
        }

        /* every measurement first, then every write.

           these loops used to read a rectangle and set a property, read the
           next and set the next. each write invalidates layout and each read
           after a write forces the browser to redo it, so a handful of
           elements became a handful of full layouts per frame on a page ten
           thousand pixels tall. reading them all, then writing them all, is one
           layout however many elements there are. */
        function scrollStep() {
            sraf = 0;
            var vh = window.innerHeight || 1;
            var i, el, r;
            var lagP = [], driftP = [], railP = [];

            for (i = 0; i < lagList.length; i++) lagP.push(through(lagList[i], vh));
            for (i = 0; i < driftList.length; i++) driftP.push(through(driftList[i], vh));
            for (i = 0; i < railList.length; i++) {
                r = railList[i].getBoundingClientRect();
                if (r.bottom < -240 || r.top > vh + 240) { railP.push(null); continue; }
                // 0 when the top of the list reaches the middle of the window,
                // 1 when the bottom does: the rail tracks reading, not scrolling
                var run = r.height + vh * 0.5;
                railP.push(Math.min(1, Math.max(0, (vh * 0.5 - r.top) / (run || 1))));
            }

            for (i = 0; i < lagList.length; i++) {
                if (lagP[i] !== null) lagList[i].style.setProperty('--sp-lag', (lagP[i] * 26).toFixed(2) + 'px');
            }
            for (i = 0; i < driftList.length; i++) {
                // sideways, and less of it: horizontal movement is far more
                // noticeable than vertical because nothing else on the page does it
                if (driftP[i] !== null) driftList[i].style.setProperty('--sp-drift', (driftP[i] * 14).toFixed(2) + 'px');
            }
            for (i = 0; i < railList.length; i++) {
                if (railP[i] !== null) railList[i].style.setProperty('--sp-prog', railP[i].toFixed(4));
            }
        }
        function scrollQueue() {
            if (sraf) return;
            sraf = window.requestAnimationFrame(scrollStep);
        }
        window.addEventListener('scroll', scrollQueue, { passive: true });
        window.addEventListener('resize', scrollQueue, { passive: true });
        scrollStep();
    }

    /* ---- the things that happen once, on arrival ------------------------ */
    /* headings, the dealt cards and the border trace are all the same shape of
       problem: add a class the first time the element is seen and never take it
       off again. one observer serves all of them, because the only thing that
       differs is which class goes on, and that is written on the element.

       and then a sweep behind the observer, which is the part that matters.

       an IntersectionObserver samples; it does not see every frame. in principle
       a jump down the page with a scrollbar drag or a page-down key can carry an
       element through the window between two samples without it ever being
       reported. the observer is right, it just never fires, and that would leave
       the element at opacity zero for the rest of the visit. since these rules
       hide headings and whole card grids, the result would be a blank section.

       i went looking for that and could not produce it here, so treat the sweep
       as insurance rather than as a fix for a measured bug. it stays because of
       what is at stake either way: never let a visual nicety be the only thing
       standing between the reader and the content.

       the sweep says anything whose top has passed the bottom of the window is
       shown, whatever the observer did. it works off a list that shrinks as
       elements are revealed and stops costing anything once that list is
       empty. */
    var pending = [];

    if (window.IntersectionObserver) {
        var onceGroups = [
            ['.lp-h2, .lp-statsx-heading, .lp-eyebrow', 'sp-in'],
            ['.lp-sol-card', 'sp-dealt'],
            ['.lp-demo-card', 'sp-traced']
        ];

        function reveal(el) {
            var want = el.getAttribute('data-sp-once');
            if (!want || el.classList.contains(want)) return;
            el.classList.add(want);
        }

        var onceIo = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                if (!e.isIntersecting) return;
                reveal(e.target);
                onceIo.unobserve(e.target);
            });
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });

        onceGroups.forEach(function (pair) {
            var found;
            try { found = document.querySelectorAll(pair[0]); } catch (err) { return; }
            Array.prototype.forEach.call(found, function (el, i) {
                // the hero is on screen before anything can be scrolled, and a
                // heading that animates in behind the loader is a heading nobody
                // sees arrive
                if (el.closest('.lp-hero')) return;
                el.setAttribute('data-sp-once', pair[1]);
                // capped, so the ninth card in the grid is not a second late
                el.style.setProperty('--sp-order', Math.min(i, 8));
                onceIo.observe(el);
                pending.push(el);
            });
        });

        function sweep() {
            if (!pending.length) return;
            var vh = window.innerHeight || 1;
            var left = [];
            for (var i = 0; i < pending.length; i++) {
                var el = pending[i];
                var want = el.getAttribute('data-sp-once');
                if (el.classList.contains(want)) continue;
                // anything whose top edge is inside the window, or above it
                // because we have already scrolled past, gets shown
                if (el.getBoundingClientRect().top < vh * 0.94) {
                    reveal(el);
                    onceIo.unobserve(el);
                    continue;
                }
                left.push(el);
            }
            pending = left;
        }

        var sweepRaf = 0;
        function sweepQueue() {
            if (sweepRaf || !pending.length) return;
            sweepRaf = window.requestAnimationFrame(function () { sweepRaf = 0; sweep(); });
        }
        window.addEventListener('scroll', sweepQueue, { passive: true });
        window.addEventListener('resize', sweepQueue, { passive: true });
        // a reload halfway down the page must not leave everything above the
        // fold hidden either
        sweep();
    }
})();
