'use strict';

// The help subdomain: one page, served the same for every path.
//
// Node's own http server rather than a framework, because one file needs no
// framework and a dependency is something to keep patched. The page has no
// script and loads nothing from anywhere else, and the headers say so, so a
// page on this subdomain cannot be used to run something against the rest of
// the domain or be framed by somebody else's.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const PAGE = fs.readFileSync(path.join(__dirname, 'index.html'));

const HEADERS = {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; " +
        "font-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cache-Control': 'public, max-age=300',
};

http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain' });
        return res.end('method not allowed');
    }
    res.writeHead(200, HEADERS);
    res.end(req.method === 'HEAD' ? undefined : PAGE);
}).listen(PORT, '0.0.0.0', () => {
    console.log('help page on port ' + PORT);
});
