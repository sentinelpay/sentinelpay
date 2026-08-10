/* the questions and answers on the homepage.

   an accordion is easy to build badly. the two things that make it read as
   finished rather than as a toggle:

   the answer's height is measured and animated, so the card grows and the page
   below it slides down instead of jumping. `height: auto` cannot be animated,
   so the real height is measured, set as a number, and handed back to `auto`
   once the animation has arrived. giving it back matters: an answer left at a
   fixed height would clip if the window is narrowed and the text rewraps.

   only one is open at a time. six open answers is a wall of text and nobody
   reads a wall of text.

   the markup starts closed and stays usable without this file: the answers are
   in the html, so a visitor with javascript off reads all six at once, which is
   worse but not broken. */
(function () {
    var items = [].slice.call(document.querySelectorAll('.lp-faq-item'));
    if (!items.length) return;

    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function panelOf(item) { return item.querySelector('.lp-faq-a'); }
    function buttonOf(item) { return item.querySelector('.lp-faq-q'); }

    // the answers are visible in the markup so that they exist without script.
    // now that script is running, close them.
    items.forEach(function (item) {
        var panel = panelOf(item);
        panel.hidden = false;
        panel.style.height = '0px';
        item.classList.remove('is-open');
        buttonOf(item).setAttribute('aria-expanded', 'false');
    });

    function close(item) {
        if (!item.classList.contains('is-open')) return;
        var panel = panelOf(item);
        // from its real height to zero: starting from `auto` gives the browser
        // nothing to animate between
        panel.style.height = panel.scrollHeight + 'px';
        void panel.offsetHeight;
        item.classList.remove('is-open');
        buttonOf(item).setAttribute('aria-expanded', 'false');
        panel.style.height = '0px';
    }

    function open(item) {
        var panel = panelOf(item);
        item.classList.add('is-open');
        buttonOf(item).setAttribute('aria-expanded', 'true');
        if (reduced) { panel.style.height = 'auto'; return; }
        panel.style.height = panel.scrollHeight + 'px';
        // hand the height back once it has arrived, so a narrower window that
        // rewraps the text is not clipped by a number measured earlier
        var done = function (e) {
            if (e.propertyName !== 'height') return;
            panel.removeEventListener('transitionend', done);
            if (item.classList.contains('is-open')) panel.style.height = 'auto';
        };
        panel.addEventListener('transitionend', done);
    }

    items.forEach(function (item) {
        buttonOf(item).addEventListener('click', function () {
            var isOpen = item.classList.contains('is-open');
            // one at a time: the others close as this one opens, and both
            // animations run together
            items.forEach(function (other) { if (other !== item) close(other); });
            if (isOpen) close(item); else open(item);
        });
    });

    // a link into an answer opens it: /#faq-3 or a search engine's jump link
    // should not land on a closed card
    window.addEventListener('hashchange', function () {
        var target = document.querySelector(location.hash || '#none');
        if (!target) return;
        var item = target.closest && target.closest('.lp-faq-item');
        if (item) open(item);
    });
})();
