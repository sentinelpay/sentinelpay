// The printed usage report's one button. A file of its own because the page
// allows no inline script, and opened with ?print=1 it goes straight to the
// print dialog, which is what "print" in the export list means.
(function () {
    var b = document.getElementById('print');
    if (b) b.addEventListener('click', function () { window.print(); });
    if (/[?&]print=1\b/.test(location.search)) {
        window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 250); });
    }
    // Shown inside the usage page, a key pressed while reading the paper is
    // pressed in here and never reaches the page around it. Escape is the one
    // that page needs to hear, to close the window the paper sits in.
    if (window.parent !== window) {
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            try { window.parent.postMessage({ sp: 'report-close' }, location.origin); } catch (err) { /* nothing to close */ }
        });
    }
})();
