(function () {
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !window.IntersectionObserver) return;

    var GROUPS = [
        '.lp-section > .lp-section-inner > .lp-section-head',
        '.lp-roles-grid > *',
        '.lp-statsx-heading',
        '.lp-statsx-grid > *',
        '.lp-sol-grid > *',
        '.lp-ins-featured, .lp-ins-grid > *',
        '.lp-faq-list > *',
        '.lp-demo-card',
        '.lp-cta-band',
        '.lp-footer-top > *'
    ];
    var STAGGER = window.matchMedia && window.matchMedia('(max-width: 900px)').matches ? 45 : 70;

    var seen = [];
    GROUPS.forEach(function (sel) {
        var found;
        try { found = document.querySelectorAll(sel); } catch (err) { return; }
        Array.prototype.forEach.call(found, function (el, i) {
            if (el.classList.contains('lp-reveal')) return;
            if (el.closest('.lp-hero')) return;
            el.classList.add('lp-reveal');
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

        rootMargin: ['0px', '0px', Math.round(Math.max(260, (window.innerHeight || 800) * 0.45)) + 'px', '0px'].join(' '),
        threshold: 0
    });
    seen.forEach(function (el) { io.observe(el); });

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
    var pending = seen.slice();
    function sweep() {
        if (!pending.length) return;
        var vh = window.innerHeight || 1;
        var left = [];
        for (var i = 0; i < pending.length; i++) {
            var el = pending[i];
            if (el.classList.contains('lp-visible')) continue;

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