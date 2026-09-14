(function () {
    var SEL = 'img[data-fb], .article-avatar img, .lp-ins-avatar img, .lp-ins-cover-img, .bad-net-mark img, .lp-net-mark img';
    document.querySelectorAll(SEL).forEach(function (img) {
        function fail() {
            var fb = img.getAttribute('data-fb');
            if (fb) { img.removeAttribute('data-fb'); img.src = fb; }
            else { img.remove(); }
        }
        img.addEventListener('error', fail);
        if (img.complete && img.naturalWidth === 0) fail();
    });
})();