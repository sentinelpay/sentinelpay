'use strict';

// Has this password already been in a breach.
//
// Length and "not your own name" are the two rules we had, and they pass
// "Password123456" without blinking. The passwords that actually get accounts
// taken are not weak in the shape sense: they are ordinary passwords that are
// already on a list somebody is working through. NIST 800-63B says to check
// against that list, and this is the check.
//
// The password never leaves this process.
//
// SHA-1 of the password is computed here, the first five characters of the hex
// are sent, and the service answers with every hash it has that begins with
// those five: around eight hundred of them. The comparison happens locally. The
// service learns five characters of a hash, which is about a million passwords
// worth of ambiguity, and cannot tell which one was asked about. That is the
// k-anonymity model haveibeenpwned publishes, and sha-1 here is a bucket label,
// not a security claim.
//
// Everything about it fails open. If the service is down, or slow, or the
// network is blocked, a sign-up must not be refused: the cost of that is a
// person who cannot make an account, and the cost of letting one weak password
// through is one weak password.

const crypto = require('crypto');

const ON = String(process.env.BREACH_CHECK || 'true').trim().toLowerCase() !== 'false';
// How many appearances make a password not worth having. One is already too
// many for a password nobody should reuse, and the count is there so the number
// can be raised rather than argued about.
const MIN_HITS = Math.max(Number(process.env.BREACH_MIN_HITS || 1), 1);
const TIMEOUT_MS = Math.min(Math.max(Number(process.env.BREACH_TIMEOUT_MS || 1500), 200), 5000);
const ENDPOINT = 'https://api.pwnedpasswords.com/range/';

// A small cache of prefixes, because a form somebody is retyping asks the same
// question repeatedly and the answer changes about once a year.
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

// true when the password is on the list often enough to refuse, false for
// everything else including every kind of failure.
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
                    // asks the service to pad the answer with fake hashes, so the
                    // size of the response cannot be used to narrow down which
                    // prefix was asked about
                    'Add-Padding': 'true',
                    'User-Agent': 'sentinelpay-signup-check',
                },
            });
            if (!resp.ok) return false;
            body = await resp.text();
            remember(prefix, body);
        } catch (err) {
            // aborted, offline, dns, tls: all the same answer
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
        // the padding the service adds is sent as a count of zero
        return Number.isFinite(hits) && hits >= MIN_HITS;
    }
    return false;
}

module.exports = { isBreached, enabled: () => ON };
