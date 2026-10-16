'use strict';

// A QR code as the outline of its dark modules, for the screen that turns
// two-factor on: the page draws it as one path, so the secret it carries is
// never an image fetched from anywhere, ours or anybody else's.
//
// The encoding is Kazuhiko Arase's QR Code Generator, kept as it was
// published under vendor/ (MIT licence beside it): a QR code is a small,
// settled standard, and the library is one file with nothing under it.

const qrcode = require('./vendor/qrcode-generator-1.4.4/qrcode.js');

// { size, d }: a square of size modules, and a path of the dark ones, a run
// of them along a row drawn as one rectangle. Medium error correction, which
// survives a phone camera at an angle and keeps the code small.
function qrPath(text) {
    const q = qrcode(0, 'M');
    q.addData(String(text));
    q.make();
    const n = q.getModuleCount();
    const d = [];
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (!q.isDark(r, c)) continue;
            let len = 1;
            while (c + len < n && q.isDark(r, c + len)) len++;
            d.push('M' + c + ' ' + r + 'h' + len + 'v1h-' + len + 'z');
            c += len - 1;
        }
    }
    return { size: n, d: d.join('') };
}

module.exports = { qrPath };
