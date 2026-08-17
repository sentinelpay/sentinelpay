/* the hero's screening lane.

   every landing page in this market shows the same thing: a screenshot of a
   dashboard, or an illustration of a shield. we show the product doing the one
   thing it exists to do. addresses arrive from below, cross a gate, and are
   either let through or held. when one is held the whole line stops behind it,
   which is the promise on the left of the screen made literal rather than
   claimed.

   three rules it follows, and they are the difference between this and a toy:

   it is labelled an illustration, on the page, above the lane. we sell
   compliance. invented numbers that could be mistaken for real screening
   results would be the single most expensive thing on this website, and no
   amount of "obviously it is a demo" survives a screenshot in the wrong
   context.

   the addresses are not real. they are drawn from a fixed alphabet at random
   and are checked to be of the right shape and nothing more. nobody's actual
   wallet appears on our front page, flagged, forever, in google's cache.

   it stops for `prefers-reduced-motion`. the lane still fills in, once, with a
   settled row of results, so somebody who cannot take movement sees the same
   story rather than an empty box. */
(function () {
    var rowsEl = document.getElementById('sp-lane-rows');
    var laneEl = document.getElementById('sp-lane');
    var seenEl = document.getElementById('sp-lane-seen');
    var heldEl = document.getElementById('sp-lane-held');
    if (!rowsEl || !laneEl) return;

    var t = function (x) { return window.SentinelI18n ? window.SentinelI18n.t(x) : x; };
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var MAX_ROWS = 6;
    var HEX = '0123456789abcdef';
    var B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

    // one in nine is held. often enough to see it happen while somebody reads
    // the headline, rare enough that the product does not look like it refuses
    // everything.
    var HOLD_EVERY = 9;

    var REASONS = [
        'received from a sanctioned entity',
        'one hop from a mixer',
        'linked to a known scam address'
    ];

    function pick(set) { return set.charAt(Math.floor(Math.random() * set.length)); }

    function fakeAddress() {
        var kind = Math.random();
        var out, i;
        if (kind < 0.6) {
            // evm shaped
            out = '0x';
            for (i = 0; i < 40; i++) out += pick(HEX);
        } else if (kind < 0.85) {
            // bech32 shaped
            out = 'bc1q';
            for (i = 0; i < 38; i++) out += pick('023456789acdefghjklmnpqrstuvwxyz');
        } else {
            out = '1';
            for (i = 0; i < 33; i++) out += pick(B58);
        }
        return out;
    }

    // middle removed rather than the end cut off: the last characters are what
    // anybody actually compares an address by
    function shorten(addr) {
        return addr.slice(0, 10) + '…' + addr.slice(-6);
    }

    var seen = 0;
    var held = 0;
    var counter = 0;
    var paused = false;

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }

    function addRow() {
        if (paused) return;

        counter++;
        var isHeld = counter % HOLD_EVERY === 0;
        var addr = fakeAddress();

        var row = el('div', 'sp-row');
        row.appendChild(el('span', 'sp-row-addr', shorten(addr)));

        var state = el('span', 'sp-row-state');
        state.appendChild(el('span', 'sp-row-dots'));
        row.appendChild(state);
        rowsEl.insertBefore(row, rowsEl.firstChild);

        while (rowsEl.children.length > MAX_ROWS) {
            rowsEl.removeChild(rowsEl.lastChild);
        }

        // the verdict lands a beat after the row does, because a score that is
        // already there was never computed in front of anybody
        setTimeout(function () {
            state.textContent = '';
            seen++;
            if (seenEl) seenEl.textContent = String(seen);

            if (!isHeld) {
                row.classList.add('is-clear');
                state.appendChild(el('span', 'sp-row-tick', '✓'));
                state.appendChild(el('span', 'sp-row-word', t('cleared')));
                return;
            }

            held++;
            if (heldEl) heldEl.textContent = String(held);
            row.classList.add('is-held');
            state.appendChild(el('span', 'sp-row-word', t('held')));
            row.appendChild(el('span', 'sp-row-why', t(REASONS[held % REASONS.length])));

            // and the line stops. this is the part that is worth building: the
            // page pauses exactly as long as it takes to read why.
            paused = true;
            laneEl.classList.add('is-stopped');
            setTimeout(function () {
                paused = false;
                laneEl.classList.remove('is-stopped');
            }, 2600);
        }, 620);
    }

    if (reduced) {
        // the same story, told once and left still. one row fewer than the
        // moving version, because the held row carries a second line and the
        // sixth would be cut off by the lane's own height.
        for (var k = 0; k < MAX_ROWS - 1; k++) { counter = k === 2 ? HOLD_EVERY - 1 : k; addRow(); }
        return;
    }

    // nothing runs until the lane is on screen, and it stops again when the tab
    // is not being looked at: an animation nobody can see is a battery bill
    var timer = null;
    function start() { if (!timer) timer = setInterval(addRow, 1250); }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) stop(); else start();
    });

    if (window.IntersectionObserver) {
        new IntersectionObserver(function (entries) {
            entries.forEach(function (e) { if (e.isIntersecting) { addRow(); start(); } else { stop(); } });
        }, { threshold: 0.15 }).observe(laneEl);
    } else {
        addRow();
        start();
    }
})();
