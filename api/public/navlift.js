(function () {
    var root = document.documentElement;
    if (!document.querySelector('.lp-nav')) return;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    var TRAVEL = 220;

    var MAX_RADIUS = 26;
    var raf = 0;
    var last = -1;

    function apply() {
        raf = 0;
        var y = window.scrollY || root.scrollTop || 0;
        var p = Math.min(Math.max(y / TRAVEL, 0), 1);
        var e = 1 - Math.pow(1 - p, 3);
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
    apply();
})();