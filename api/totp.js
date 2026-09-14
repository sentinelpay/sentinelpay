'use strict';

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

function checkCode(secret, code, now) {
    const digits = String(code || '').replace(/\D/g, '');
    if (digits.length !== DIGITS) return null;
    const step = Math.floor((now || Date.now()) / 1000 / STEP_S);
    for (let d = -DRIFT; d <= DRIFT; d++) {
        const candidate = codeFor(secret, step + d);
        const a = Buffer.from(candidate, 'utf8');
        const b = Buffer.from(digits, 'utf8');
        if (a.length === b.length && crypto.timingSafeEqual(a, b)) return step + d;
    }
    return null;
}

function otpauthUrl(secret, account, issuer) {
    const label = encodeURIComponent(issuer + ':' + account);
    return 'otpauth://totp/' + label +
        '?secret=' + secret +
        '&issuer=' + encodeURIComponent(issuer) +
        '&algorithm=SHA1&digits=' + DIGITS + '&period=' + STEP_S;
}

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
