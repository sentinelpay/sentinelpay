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

// The compare table, on a phone. Five columns do not fit 390 pixels: the table
// scrolled sideways inside itself, a plan and a half showed, and the buttons
// spilled out of their own edges. Below 720 pixels the plan names become tabs
// and the table shows the features against one plan at a time, Growth first,
// since that is the one marked as the pick. Wider than that the attribute is
// set and nothing reads it.
(function () {
    'use strict';
    var table = document.querySelector('.lp-cmp-table');
    if (!table) return;
    var plans = [].slice.call(table.querySelectorAll('.lp-cmp-row.is-head .lp-cmp-plan'));
    if (!plans.length) return;
    var names = plans.map(function (cell) { return cell.querySelector('.lp-cmp-plan-name'); });
    var head = table.querySelector('.lp-cmp-row.is-head');
    head.setAttribute('role', 'tablist');
    var i18n = window.SentinelI18n;
    head.setAttribute('aria-label', i18n && i18n.t ? i18n.t('Plan') : 'Plan');

    function show(i) {
        // column 1 is the feature, so plan i is column i + 2
        table.setAttribute('data-show', String(i + 2));
        plans.forEach(function (cell, k) {
            cell.classList.toggle('is-on', k === i);
            if (names[k]) {
                names[k].setAttribute('aria-selected', k === i ? 'true' : 'false');
                names[k].tabIndex = k === i ? 0 : -1;
            }
        });
    }
    names.forEach(function (name, i) {
        if (!name) return;
        name.setAttribute('role', 'tab');
        name.addEventListener('click', function () { show(i); });
        name.addEventListener('keydown', function (e) {
            var to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(i); return; }
            if (to === null) return;
            e.preventDefault();
            to = (to + names.length) % names.length;
            show(to);
            if (names[to]) names[to].focus();
        });
    });
    var pick = plans.findIndex ? plans.findIndex(function (c) { return c.classList.contains('is-pick'); }) : -1;
    show(pick === -1 ? 0 : pick);
})();
