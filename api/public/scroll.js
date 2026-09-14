(function () {
    var reducedAll = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var bands = document.querySelectorAll('.lp-statsx, .lp-cta-band');
    var bandList = Array.prototype.slice.call(bands);
    function bandStep() {
        for (var i = 0; i < bandList.length; i++) {
            var el = bandList[i];
            var r = el.getBoundingClientRect();
            var vh = window.innerHeight || 1;

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
    var root = document.documentElement;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    var MAX_SHRINK = 0.07;
    var ticking = false;
    var lastP = -1;
    function apply() {
        ticking = false;
        var h = hero.offsetHeight || window.innerHeight;
        var p = Math.min(Math.max(window.scrollY / (h * 0.85), 0), 1);

        var e = 1 - Math.pow(1 - p, 2);
        if (Math.abs(e - lastP) < 0.002) return;
        lastP = e;
        root.style.setProperty('--sp-fold-scale', (1 - e * MAX_SHRINK).toFixed(4));

        hero.style.willChange = (e > 0.001 && e < 0.999) ? 'transform' : 'auto';
    }
    function onScroll() {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(apply);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    apply();
})();