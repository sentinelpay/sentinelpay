'use strict';

// Where the rate limits actually keep their counters.
//
// express-rate-limit's default store is a map in the process, which has two
// holes that matter here. Every deploy empties it, so an attacker working
// through a password list only has to wait for the next push; and if this ever
// runs as two instances, every limit silently doubles because each instance
// counts its own half.
//
// So the counters that protect an account live in postgres, where both problems
// go away: one shared count, and it survives a restart. The coarse ceiling on
// every page and asset does not use this, on purpose. That one runs on every
// image and font on the site, and a database round trip per request would cost
// more than the thing it is defending against.
//
// Without a database this falls back to counting in memory, which is what the
// library would have done anyway. A missing database must not mean a missing
// limit.

const db = require('./db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rate_hits (
    key       text        PRIMARY KEY,
    hits      integer     NOT NULL DEFAULT 0,
    reset_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_hits_reset_idx ON rate_hits (reset_at);
`;

let ready = null;
function init() {
    if (!db.available()) return Promise.resolve(false);
    if (ready) return ready;
    ready = db.query(SCHEMA)
        .then(() => true)
        .catch((err) => {
            console.error('[rate] schema failed: ' + err.message);
            ready = null;
            return false;
        });
    return ready;
}

// Spent windows, swept on a timer rather than on every write: the row is
// harmless once its window is over, it is simply in the way.
function startSweep() {
    const run = () => {
        if (!db.available()) return;
        db.query("DELETE FROM rate_hits WHERE reset_at < now() - interval '1 hour'")
            .catch((err) => console.error('[rate] sweep failed: ' + err.message));
    };
    setTimeout(run, 60 * 1000).unref();
    setInterval(run, 60 * 60 * 1000).unref();
}

class PostgresStore {
    constructor() {
        this.windowMs = 60 * 1000;
        this.memory = new Map();
        this.localOnly = false;
    }

    init(options) {
        this.windowMs = options.windowMs;
    }

    // the fallback, used when there is no database or a query failed. same
    // shape, same answers, one process.
    _memory(key, delta) {
        const now = Date.now();
        let row = this.memory.get(key);
        if (!row || row.resetTime.getTime() <= now) {
            row = { totalHits: 0, resetTime: new Date(now + this.windowMs) };
            this.memory.set(key, row);
        }
        row.totalHits = Math.max(0, row.totalHits + delta);
        // a map that only ever grows is a leak with a schedule
        if (this.memory.size > 20000) {
            for (const [k, v] of this.memory) {
                if (v.resetTime.getTime() <= now) this.memory.delete(k);
            }
        }
        return { totalHits: row.totalHits, resetTime: row.resetTime };
    }

    async increment(key) {
        if (!(await init())) return this._memory(key, 1);
        try {
            // one statement does the whole thing: start a window if there is
            // none or the last one is over, otherwise add to it. two requests
            // arriving together cannot both see an empty counter.
            const res = await db.query(
                `INSERT INTO rate_hits (key, hits, reset_at)
                 VALUES ($1, 1, now() + ($2 || ' milliseconds')::interval)
                 ON CONFLICT (key) DO UPDATE SET
                     hits = CASE WHEN rate_hits.reset_at <= now() THEN 1 ELSE rate_hits.hits + 1 END,
                     reset_at = CASE WHEN rate_hits.reset_at <= now()
                                     THEN now() + ($2 || ' milliseconds')::interval
                                     ELSE rate_hits.reset_at END
                 RETURNING hits, reset_at`,
                [String(key).slice(0, 200), String(this.windowMs)]
            );
            const row = res.rows[0];
            return { totalHits: row.hits, resetTime: new Date(row.reset_at) };
        } catch (err) {
            console.error('[rate] increment failed, counting in memory: ' + err.message);
            return this._memory(key, 1);
        }
    }

    async decrement(key) {
        if (!(await init())) { this._memory(key, -1); return; }
        try {
            await db.query(
                'UPDATE rate_hits SET hits = GREATEST(hits - 1, 0) WHERE key = $1 AND reset_at > now()',
                [String(key).slice(0, 200)]
            );
        } catch (err) {
            console.error('[rate] decrement failed: ' + err.message);
        }
    }

    async resetKey(key) {
        this.memory.delete(key);
        if (!(await init())) return;
        try {
            await db.query('DELETE FROM rate_hits WHERE key = $1', [String(key).slice(0, 200)]);
        } catch (err) {
            console.error('[rate] reset failed: ' + err.message);
        }
    }
}

// One address, as a limit key.
//
// An ipv4 address is one machine. An ipv6 address is not: the smallest thing
// anybody is given is a /64, and many providers hand out a /56 or shorter, so
// keying on the full address gives one attacker more buckets than there are
// grains of sand. The network is the unit that costs money to obtain, so the
// network is what is counted.
function ipKey(ip) {
    const raw = String(ip || 'unknown');
    if (!raw.includes(':')) return raw;
    // ::ffff:1.2.3.4 is an ipv4 address wearing an ipv6 hat
    const mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return mapped[1];
    const groups = raw.split('%')[0].split(':');
    // expand the :: shorthand only as far as the first four groups, which is all
    // a /64 needs
    const idx = raw.indexOf('::');
    if (idx !== -1) {
        const head = raw.slice(0, idx).split(':').filter(Boolean);
        while (head.length < 4) head.push('0');
        return head.slice(0, 4).join(':') + '::/64';
    }
    return groups.slice(0, 4).join(':') + '::/64';
}

module.exports = { PostgresStore, ipKey, startSweep };
