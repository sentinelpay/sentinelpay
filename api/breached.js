'use strict';

const crypto = require('crypto');

const ON = String(process.env.BREACH_CHECK || 'true').trim().toLowerCase() !== 'false';
const MIN_HITS = Math.max(Number(process.env.BREACH_MIN_HITS || 1), 1);
const TIMEOUT_MS = Math.min(Math.max(Number(process.env.BREACH_TIMEOUT_MS || 1500), 200), 5000);
const ENDPOINT = 'https://api.pwnedpasswords.com/range/';

const cache = new Map();
const CACHE_MAX = 200;
const CACHE_TTL_MS = 60 * 60 * 1000;

function cached(prefix) {
    const hit = cache.get(prefix);
    if (!hit) return null;
    if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(prefix); return null; }
    return hit.body;
}

function remember(prefix, body) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(prefix, { at: Date.now(), body });
}

async function isBreached(password) {
    if (!ON) return false;
    if (typeof password !== 'string' || password.length === 0) return false;

    const sha = crypto.createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    const prefix = sha.slice(0, 5);
    const suffix = sha.slice(5);

    let body = cached(prefix);
    if (body === null) {
        const stop = new AbortController();
        const timer = setTimeout(() => stop.abort(), TIMEOUT_MS);
        try {
            const resp = await fetch(ENDPOINT + prefix, {
                signal: stop.signal,
                headers: {
                    'Add-Padding': 'true',
                    'User-Agent': 'sentinelpay-signup-check',
                },
            });
            if (!resp.ok) return false;
            body = await resp.text();
            remember(prefix, body);
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('[breach] could not ask: ' + err.message);
            }
            return false;
        } finally {
            clearTimeout(timer);
        }
    }

    for (const line of body.split('\n')) {
        const sep = line.indexOf(':');
        if (sep === -1) continue;
        if (line.slice(0, sep).trim().toUpperCase() !== suffix) continue;
        const hits = Number(line.slice(sep + 1).trim());
        return Number.isFinite(hits) && hits >= MIN_HITS;
    }
    return false;
}

module.exports = { isBreached, enabled: () => ON };
