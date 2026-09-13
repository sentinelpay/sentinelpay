(function () {
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    var fine = !(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

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
            mx = 0.5; my = 0.5;
            queue();
        }, { passive: true });
    }
    if (fine) {
        var leaners = document.querySelectorAll('.lp-roles-panels');
        Array.prototype.forEach.call(leaners, function (el) { trackPointer(el, 'sp-lean-on'); });

        var lit = document.querySelectorAll('.lp-sol-card');
        Array.prototype.forEach.call(lit, function (el) { trackPointer(el, 'sp-lit-on'); });
    }

    if (window.IntersectionObserver) {
        var bands = document.querySelectorAll('.lp-statsx');
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
    var driftList = fine ? Array.prototype.slice.call(document.querySelectorAll('.lp-ins-featured')) : [];
    var railList = Array.prototype.slice.call(document.querySelectorAll('.lp-faq-list'));
    var openList = Array.prototype.slice.call(document.querySelectorAll('.lp-proof-panel'));
    if (driftList.length || railList.length || openList.length) {
        var sraf = 0;
        function through(el, vh) {
            var r = el.getBoundingClientRect();
            if (r.bottom < -240 || r.top > vh + 240) return null;
            return 1 - (r.top + r.height * 0.5) / (vh * 0.5);
        }
        function scrollStep() {
            sraf = 0;
            var vh = window.innerHeight || 1;
            var narrow = (window.innerWidth || 0) <= 720;
            var i, el, r;
            var driftP = [], railP = [], openP = [];
            for (i = 0; i < driftList.length; i++) driftP.push(through(driftList[i], vh));
            for (i = 0; i < openList.length; i++) {
                r = openList[i].getBoundingClientRect();
                if (r.bottom < -240 || r.top > vh + 240) { openP.push(null); continue; }
                var mid = r.top + r.height * 0.5;
                var reach = (vh + r.height) * 0.5;
                var d = Math.min(1, Math.abs(mid - vh * 0.5) / (reach || 1));
                openP.push(1 - Math.pow(d, 1.55));
            }
            for (i = 0; i < railList.length; i++) {
                r = railList[i].getBoundingClientRect();
                if (r.bottom < -240 || r.top > vh + 240) { railP.push(null); continue; }
                var run = r.height + vh * 0.5;
                railP.push(Math.min(1, Math.max(0, (vh * 0.5 - r.top) / (run || 1))));
            }
            for (i = 0; i < driftList.length; i++) {
                if (driftP[i] !== null) driftList[i].style.setProperty('--sp-drift', (driftP[i] * 14).toFixed(2) + 'px');
            }
            for (i = 0; i < railList.length; i++) {
                if (railP[i] !== null) railList[i].style.setProperty('--sp-prog', railP[i].toFixed(4));
            }
            if (!narrow) {
                for (i = 0; i < openList.length; i++) {
                    if (openP[i] !== null) openList[i].style.setProperty('--sp-open', openP[i].toFixed(4));
                }
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
                if (el.closest('.lp-hero')) return;
                el.setAttribute('data-sp-once', pair[1]);

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
        sweep();
    }
})();