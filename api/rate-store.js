'use strict';

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

    _memory(key, delta) {
        const now = Date.now();
        let row = this.memory.get(key);
        if (!row || row.resetTime.getTime() <= now) {
            row = { totalHits: 0, resetTime: new Date(now + this.windowMs) };
            this.memory.set(key, row);
        }
        row.totalHits = Math.max(0, row.totalHits + delta);
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

function ipKey(ip) {
    const raw = String(ip || 'unknown');
    if (!raw.includes(':')) return raw;
    const mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return mapped[1];
    const groups = raw.split('%')[0].split(':');
    const idx = raw.indexOf('::');
    if (idx !== -1) {
        const head = raw.slice(0, idx).split(':').filter(Boolean);
        while (head.length < 4) head.push('0');
        return head.slice(0, 4).join(':') + '::/64';
    }
    return groups.slice(0, 4).join(':') + '::/64';
}

module.exports = { PostgresStore, ipKey, startSweep };
