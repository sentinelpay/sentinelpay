/* the hero background, raymarched.

   what this draws: an infinite three dimensional lattice, tubes along all three
   axes with a node where they meet, twisting slowly around the axis the camera
   is flying down. it is not a video of a 3d scene and it is not a 2d picture
   pretending: every frame is solved from scratch by marching a ray per pixel
   through a distance field, so it is genuinely infinite, never repeats, never
   loads, and is sharp at any resolution.

   why by hand rather than with a 3d library: three.js is about six hundred
   kilobytes to draw one rectangle. everything below is one full screen triangle
   and one fragment shader, which is the entire job. no dependency, nothing to
   keep up to date, nothing extra to download, and it stays inside our own
   content security policy because it is a file on our own origin.

   why it never gets in the way of the words:

     the shader dims itself toward the middle of the screen, where the headline
     and the buttons are. the lattice is brightest at the edges and falls away
     to nothing behind the copy, so the contrast of the text is not at the mercy
     of whatever the animation happens to be doing that second.

     it composites with `screen`, so black adds nothing. the hero's own gradient
     is still the background; this is light laid over it, not a replacement.

   why it does not cost the user anything:

     it stops dead when the hero scrolls off screen and when the tab goes to the
     background. an animation nobody is looking at is a flat battery.

     it renders below css resolution and is scaled up. a glow has no edges to go
     soft, so the difference is invisible and the pixel count is halved.

     reduced motion, no webgl, an old phone that fails to compile the shader:
     in every one of those cases this file removes its own canvas and the svg
     scene that is already in the markup is what you see. the hero is never
     blank, and it never depends on this having worked. */
(function () {
    var hero = document.querySelector('.lp-hero');
    if (!hero) return;

    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

    var canvas = document.createElement('canvas');
    canvas.className = 'sp-hero-gl';
    canvas.setAttribute('aria-hidden', 'true');

    var gl = null;
    try {
        var opts = {
            alpha: true,
            antialias: false,
            depth: false,
            stencil: false,
            premultipliedAlpha: false,
            // the frame is thrown away every time, so let the driver skip the copy
            preserveDrawingBuffer: false,
            powerPreference: 'low-power',
            failIfMajorPerformanceCaveat: true
        };
        gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    } catch (err) {
        gl = null;
    }
    // no webgl, or webgl only through a software rasteriser: leave the svg alone
    if (!gl) return;

    var VERT = [
        'attribute vec2 aPos;',
        'void main() { gl_Position = vec4(aPos, 0.0, 1.0); }'
    ].join('\n');

    /* the shader.

       `map` is the distance field: for any point in space it returns how far the
       nearest piece of lattice is. `mod` folds all of space into one four unit
       cell, which is what makes the structure infinite for the price of one cell.

       the march is a glow accumulation rather than a surface hit. a normal
       raymarch stops at the first surface and then has to light it, which needs
       three extra samples per pixel for the normal. adding `exp(-d)` at every
       step instead gives volumetric neon for nothing, and it is the look we
       want: light in the dark, not plastic under a lamp. */
    var STEPS = coarse ? 44 : 72;
    var FRAG = [
        'precision highp float;',
        '#define STEPS ' + STEPS,
        'uniform vec2 uRes;',
        'uniform float uT;',
        'uniform float uFade;',

        'mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }',

        'float map(vec3 p) {',
        // the twist is what stops it reading as a static grid you are flying
        // through: the further away a cell is, the more it is turned
        '    p.xy *= rot(p.z * 0.055 + uT * 0.06);',
        '    vec3 q = mod(p + 2.0, 4.0) - 2.0;',
        // tubes along each axis, and a node where the three meet
        '    float tx = length(q.yz) - 0.045;',
        '    float ty = length(q.xz) - 0.045;',
        '    float tz = length(q.xy) - 0.045;',
        '    float lat = min(min(tx, ty), tz);',
        '    float node = length(q) - 0.095;',
        '    return min(lat, node);',
        '}',

        'void main() {',
        '    vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;',

        '    vec3 ro = vec3(0.0, 0.0, uT * 1.15);',
        '    vec3 rd = normalize(vec3(uv, 1.25));',
        // a slow drift of the camera itself, so the flight is never quite straight
        '    rd.xz *= rot(sin(uT * 0.07) * 0.10);',
        '    rd.yz *= rot(cos(uT * 0.05) * 0.07);',

        '    vec3 col = vec3(0.0);',
        '    float t = 0.35;',
        '    for (int i = 0; i < STEPS; i++) {',
        '        vec3 p = ro + rd * t;',
        '        float d = map(p);',
        // near cyan, far violet: our own two ends, and depth reads as colour
        '        vec3 c = mix(vec3(0.10, 0.80, 1.00), vec3(0.50, 0.32, 1.00), clamp(t / 26.0, 0.0, 1.0));',
        '        float g = exp(-d * 48.0);',
        // nothing within the first few units contributes: a tube passing close
        // to the camera would otherwise flare across the whole screen, which is
        // the searchlight-in-the-face effect and it happens at random
        '        float near = smoothstep(0.6, 5.5, t);',
        '        col += c * (g + g * g * 1.1) * near * exp(-t * 0.098) * 0.095;',
        // never step further than the field says is safe, never smaller than a
        // step that would take all day
        '        t += max(d * 0.8, 0.035);',
        '        if (t > 32.0) break;',
        '    }',

        // the middle of the screen is where the words are, so the middle of the
        // screen is where this is dimmest
        '    float r = length(uv * vec2(0.72, 1.0));',
        '    col *= smoothstep(0.11, 0.60, r);',
        // and the corners fall away so it meets the page rather than stopping
        '    col *= 1.0 - smoothstep(0.55, 1.25, r) * 0.55;',

        // filmic enough: nothing clips to white, so the bright cores stay coloured
        '    col = vec3(1.0) - exp(-col * 1.5);',
        '    gl_FragColor = vec4(col * uFade, 1.0);',
        '}'
    ].join('\n');

    function compile(type, src) {
        var sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
            gl.deleteShader(sh);
            return null;
        }
        return sh;
    }

    var vs = compile(gl.VERTEX_SHADER, VERT);
    var fs = compile(gl.FRAGMENT_SHADER, FRAG);
    // a driver that will not compile this is a driver we quietly give up on
    if (!vs || !fs) return;

    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    // one triangle rather than two: it covers the screen with three vertices
    // instead of six and has no seam down the diagonal
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    var uRes = gl.getUniformLocation(prog, 'uRes');
    var uT = gl.getUniformLocation(prog, 'uT');
    var uFade = gl.getUniformLocation(prog, 'uFade');

    hero.insertBefore(canvas, hero.firstChild);

    // below css resolution on purpose, and harder on a phone. a glow has no
    // edges, so there is nothing for the upscale to soften.
    var SCALE = coarse ? 0.5 : 0.68;
    var MAXW = 1500;

    function resize() {
        var w = hero.clientWidth || window.innerWidth;
        var h = hero.clientHeight || window.innerHeight;
        var s = Math.min(SCALE, MAXW / Math.max(w, 1));
        var pw = Math.max(1, Math.round(w * s));
        var ph = Math.max(1, Math.round(h * s));
        if (canvas.width === pw && canvas.height === ph) return;
        canvas.width = pw;
        canvas.height = ph;
        gl.viewport(0, 0, pw, ph);
        gl.uniform2f(uRes, pw, ph);
    }

    var running = true;      // hero is on screen
    var awake = true;        // tab is in front
    var raf = 0;
    var t0 = 0;
    var shown = 0;           // the fade in, so the first frame is not a flash

    function frame(now) {
        raf = 0;
        if (!running || !awake) return;
        if (!t0) t0 = now;
        resize();
        shown = Math.min(1, shown + 0.02);
        gl.uniform1f(uT, (now - t0) / 1000);
        gl.uniform1f(uFade, shown);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        raf = window.requestAnimationFrame(frame);
    }

    function start() {
        if (raf || !running || !awake) return;
        raf = window.requestAnimationFrame(frame);
    }
    function stop() {
        if (!raf) return;
        window.cancelAnimationFrame(raf);
        raf = 0;
    }

    // the context can be taken away at any time (a laptop switching gpu, a
    // driver reset). without this the canvas freezes on its last frame for ever.
    canvas.addEventListener('webglcontextlost', function (e) {
        e.preventDefault();
        stop();
    });
    canvas.addEventListener('webglcontextrestored', function () {
        t0 = 0;
        start();
    });

    document.addEventListener('visibilitychange', function () {
        awake = !document.hidden;
        if (awake) { t0 = 0; start(); } else stop();
    });

    if (window.IntersectionObserver) {
        new IntersectionObserver(function (entries) {
            running = entries[0].isIntersecting;
            if (running) { t0 = 0; start(); } else stop();
        }, { threshold: 0 }).observe(hero);
    }

    window.addEventListener('resize', function () { resize(); }, { passive: true });

    resize();
    start();
})();
