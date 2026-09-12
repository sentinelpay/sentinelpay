'use strict';

// Time based one time passwords, RFC 6238, written out rather than installed.
//
// It is about eighty lines of hmac and base32, and the alternative is a
// dependency in the path that decides who gets into the admin pages. The maths
// is not the risky part of 2FA and never was: the risky parts are the window you
// accept, whether a code can be used twice, and what happens when somebody loses
// their phone. Those are decided here, in the open.
//
//   - SHA-1, six digits, thirty second step. Not a choice: it is what every
//     authenticator app implements, and an app that cannot read our code is a
//     2FA rollout that fails on the first person.
//   - one step of drift either way, so a phone whose clock is half a minute out
//     still works. that is the usual compromise and it is ninety seconds of
//     total validity, not the five minutes some implementations allow.
//   - a code that has been used is refused for the rest of its step. without
//     that, anybody who reads a code over a shoulder or out of a log has thirty
//     seconds to use it themselves.
//   - recovery codes, because a phone in a river must not be the end of an
//     account. they are stored as hashes, single use, and using one is an event
//     worth seeing in the audit trail.

const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_S = 30;
const DIGITS = 6;
const DRIFT = 1;

function base32Encode(buf) {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const byte of buf) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
    return out;
}

function base32Decode(str) {
    const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
    let bits = 0;
    let value = 0;
    const out = [];
    for (const ch of clean) {
        const idx = ALPHABET.indexOf(ch);
        if (idx === -1) continue;
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(out);
}

// 160 bits, which is the size the hmac uses internally anyway.
function newSecret() {
    return base32Encode(crypto.randomBytes(20));
}

function codeFor(secret, counter) {
    const key = base32Decode(secret);
    const buf = Buffer.alloc(8);
    buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
    buf.writeUInt32BE(counter >>> 0, 4);
    const mac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = mac[mac.length - 1] & 0x0f;
    const bin = ((mac[offset] & 0x7f) << 24) | ((mac[offset + 1] & 0xff) << 16) |
        ((mac[offset + 2] & 0xff) << 8) | (mac[offset + 3] & 0xff);
    return String(bin % Math.pow(10, DIGITS)).padStart(DIGITS, '0');
}

// Which step a code belongs to, or null. The step is returned rather than true,
// because the caller has to remember it: the same code inside the same step must
// not work twice.
function checkCode(secret, code, now) {
    const digits = String(code || '').replace(/\D/g, '');
    if (digits.length !== DIGITS) return null;
    const step = Math.floor((now || Date.now()) / 1000 / STEP_S);
    for (let d = -DRIFT; d <= DRIFT; d++) {
        const candidate = codeFor(secret, step + d);
        // constant time, so the comparison itself says nothing about how close a
        // wrong code was
        const a = Buffer.from(candidate, 'utf8');
        const b = Buffer.from(digits, 'utf8');
        if (a.length === b.length && crypto.timingSafeEqual(a, b)) return step + d;
    }
    return null;
}

// What goes in the qr code. The label is what the app shows in its list, so it
// carries the site and the address; the issuer is repeated as a parameter
// because some apps read one and some read the other.
function otpauthUrl(secret, account, issuer) {
    const label = encodeURIComponent(issuer + ':' + account);
    return 'otpauth://totp/' + label +
        '?secret=' + secret +
        '&issuer=' + encodeURIComponent(issuer) +
        '&algorithm=SHA1&digits=' + DIGITS + '&period=' + STEP_S;
}

// Ten of them, in a shape that can be read down a phone line without asking
// which letter that was: digits only, in two groups.
function newRecoveryCodes(count) {
    const out = [];
    for (let i = 0; i < (count || 10); i++) {
        const n = crypto.randomBytes(5).readUIntBE(0, 5) % 10000000000;
        const s = String(n).padStart(10, '0');
        out.push(s.slice(0, 5) + '-' + s.slice(5));
    }
    return out;
}

function normaliseRecovery(code) {
    return String(code || '').replace(/\D/g, '');
}

module.exports = {
    newSecret, checkCode, otpauthUrl, newRecoveryCodes, normaliseRecovery,
    codeFor, base32Encode, base32Decode, STEP_S, DIGITS,
};
