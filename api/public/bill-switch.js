(function () {
    'use strict';

    // The quarterly / yearly / per scan switch on the plan cards. It lived
    // inside choose-plan.js, which also fetches the entitlement and sends a
    // signed-in visitor to the dashboard. The public pricing page must not do
    // that, so the switch moved out here and both pages load this instead.
    //
    // It finds the section by class rather than by id, because the two pages
    // give that section different ids.
    var sw = document.querySelector('.lp-bill-switch');
    var plans = document.querySelector('.lp-plans');
    if (!sw || !plans) return;

    var segs = [].slice.call(sw.querySelectorAll('.lp-bill-seg'));
    var thumb = sw.querySelector('.lp-bill-thumb');
    if (!segs.length) return;

    // the thumb is one element moved under whichever segment is chosen, so it
    // slides between them instead of three of them fading in and out.
    var place = function (seg) {
        if (!thumb || !seg) return;
        var box = sw.getBoundingClientRect();
        var r = seg.getBoundingClientRect();
        if (!r.width) return;
        thumb.style.width = r.width + 'px';
        thumb.style.height = r.height + 'px';
        thumb.style.setProperty('--x', (r.left - box.left) + 'px');
        thumb.style.setProperty('--y', (r.top - box.top) + 'px');
    };

    var pick = function (seg) {
        segs.forEach(function (s) { s.setAttribute('aria-selected', s === seg ? 'true' : 'false'); });
        plans.setAttribute('data-bill', seg.getAttribute('data-bill-go'));
        place(seg);
    };

    var current = function () {
        return segs.filter(function (s) { return s.getAttribute('aria-selected') === 'true'; })[0] || segs[0];
    };

    segs.forEach(function (s) {
        s.addEventListener('click', function () { pick(s); });
    });

    // measuring before the webfont lands puts the thumb under the wrong width,
    // so it is placed once the text has settled and only then made visible.
    var settle = function () {
        place(current());
        sw.classList.add('is-ready');
    };
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(settle);
    } else {
        settle();
    }
    window.addEventListener('resize', function () { place(current()); });
    if (window.ResizeObserver) {
        new ResizeObserver(function () { place(current()); }).observe(sw);
    }
})();
