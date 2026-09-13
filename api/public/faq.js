(function () {
    var items = [].slice.call(document.querySelectorAll('.lp-faq-item'));
    if (!items.length) return;

    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function panelOf(item) { return item.querySelector('.lp-faq-a'); }
    function buttonOf(item) { return item.querySelector('.lp-faq-q'); }

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
            items.forEach(function (other) { if (other !== item) close(other); });
            if (isOpen) close(item); else open(item);
        });
    });
    window.addEventListener('hashchange', function () {
        var target = document.querySelector(location.hash || '#none');
        if (!target) return;
        var item = target.closest && target.closest('.lp-faq-item');
        if (item) open(item);
    });
})();