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
        '.lp-intel-featured, .lp-intel-guides > *',
        '.lp-sol-grid > *',
        '.lp-ins-featured, .lp-ins-grid > *',
        '.lp-faq-list > *',
        '.lp-demo-card',
        '.lp-cta-band',
        '.lp-footer-top > *'
    ];

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
            el.style.transitionDelay = Math.min(i, 5) * 70 + 'ms';
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
        rootMargin: '0px 0px 260px 0px',
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
})();
