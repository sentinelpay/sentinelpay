/* the page arriving as you scroll it.

   the reference we are following animates almost everything into place: a
   section's heading rises and fades in, then the cards under it follow one after
   another rather than all at once. it reads as considered, and it costs almost
   nothing, because the only thing moving is opacity and a transform, both of
   which the compositor handles without touching layout.

   three decisions in here worth knowing about:

   the elements are chosen by this file rather than tagged in the html. thirty
   `class="lp-reveal"` attributes spread over a thousand lines of markup is thirty
   places to forget, and the markup should say what a thing is rather than how it
   arrives. the selectors below are a list of what counts as a block.

   nothing is hidden until we know we can show it again. the class that hides is
   added by script, so a page whose javascript never runs shows everything: the
   worst case is no animation, never invisible content. that is also why this
   cannot be done in css alone.

   it fires once and disconnects. a reveal that plays again every time you scroll
   past is a page that will not sit still. */
(function () {
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !window.IntersectionObserver) return;

    // what counts as a block worth arriving. ordered roughly down the page, but
    // order here does not matter: each group is staggered against its own
    // siblings, not against the document.
    var GROUPS = [
        '.lp-section > .lp-section-inner > .lp-section-head',
        '.lp-roles-grid > *',
        // the band's own heading is not inside a `.lp-section-head`, so it needs
        // naming here or it is the one block on the page that does not arrive
        '.lp-statsx-heading',
        '.lp-statsx-grid > *',
        '.lp-sol-grid > *',
        '.lp-ins-featured, .lp-ins-grid > *',
        '.lp-faq-list > *',
        '.lp-demo-card',
        '.lp-cta-band',
        '.lp-footer-top > *'
    ];

    /* the gap between one card in a group and the next.

       a stagger is how you say "these belong together": the row settles left to
       right and reads as one movement. a phone puts that row in a column, so
       the same seventy milliseconds is no longer a row settling, it is a queue
       forming, and by the fourth card you are waiting for it. narrower, and the
       group still arrives in order without anybody counting it out. */
    var STAGGER = window.matchMedia && window.matchMedia('(max-width: 900px)').matches ? 45 : 70;

    var seen = [];
    GROUPS.forEach(function (sel) {
        var found;
        try { found = document.querySelectorAll(sel); } catch (err) { return; }
        // the stagger is per group, so a row of four cards arrives left to right
        Array.prototype.forEach.call(found, function (el, i) {
            if (el.classList.contains('lp-reveal')) return;
            // the hero is already on screen when the page loads and must not
            // fade in behind the loader
            if (el.closest('.lp-hero')) return;
            el.classList.add('lp-reveal');
            // capped, so the tenth card in a group is not a second and a half late
            el.style.transitionDelay = Math.min(i, 5) * STAGGER + 'ms';
            seen.push(el);
        });
    });

    if (!seen.length) return;

    var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
            if (!e.isIntersecting) return;
            e.target.classList.add('lp-visible');
            io.unobserve(e.target);
        });
    }, {
        // the root is grown downward, so an element starts arriving while it is
        // still a screen-quarter below the fold and has finished by the time it
        // is being read. shrinking the root instead, which is the intuitive
        // reading of a negative margin here, delays the reveal until the element
        // is well inside the viewport: scroll quickly and you get a blank screen
        // for the length of the transition, which is exactly what this is meant
        // to avoid.
        // relative to the window rather than a flat 260, because the number is
        // really "start a bit before it is read" and a phone's window is half a
        // desktop's. it also has to cover more ground: a flick scrolls a phone
        // faster than a wheel scrolls a desktop, so the block has less time
        // between being told to arrive and being looked at.
        rootMargin: ['0px', '0px', Math.round(Math.max(260, (window.innerHeight || 800) * 0.45)) + 'px', '0px'].join(' '),
        threshold: 0
    });

    seen.forEach(function (el) { io.observe(el); });

    // anything already on screen when this runs is shown without animating: it
    // was there before the page could have been scrolled, so animating it would
    // be a flash of movement nobody asked for
    requestAnimationFrame(function () {
        seen.forEach(function (el) {
            var r = el.getBoundingClientRect();
            if (r.top < window.innerHeight * 1.05) {
                el.style.transitionDelay = '0ms';
                el.classList.add('lp-visible');
                io.unobserve(el);
            }
        });
    });

    /* and a sweep behind the observer.

       an IntersectionObserver samples rather than watching every frame. in the
       cases that worry me, a scrollbar dragged the length of the page or a jump
       to an anchor near the bottom, a block can in principle enter and leave the
       window between two samples without ever being reported. the observer is
       not wrong, it simply never fires, and because the class it would have
       added is the one that makes the block visible, what would be left behind
       is a section that stays blank until you happen to scroll past it slowly.

       i could not get that to happen on this page: jumping to the bottom and
       back, and walking down it in fast steps, both leave nothing hidden even
       without this. so this is insurance rather than a fix for something i
       measured, and it is here because of what it protects against: hiding
       content is the one failure this file can cause, and the cost of being
       certain is a list that shrinks as blocks are shown and stops costing
       anything once it is empty. */
    var pending = seen.slice();

    function sweep() {
        if (!pending.length) return;
        var vh = window.innerHeight || 1;
        var left = [];
        for (var i = 0; i < pending.length; i++) {
            var el = pending[i];
            if (el.classList.contains('lp-visible')) continue;
            // its top edge is inside the window, or above it because we have
            // already scrolled past: either way it must not be invisible
            if (el.getBoundingClientRect().top < vh * 0.98) {
                el.classList.add('lp-visible');
                io.unobserve(el);
                continue;
            }
            left.push(el);
        }
        pending = left;
    }

    var raf = 0;
    function queue() {
        if (raf || !pending.length) return;
        raf = window.requestAnimationFrame(function () { raf = 0; sweep(); });
    }
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue, { passive: true });
})();
