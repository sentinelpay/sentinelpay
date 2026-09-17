'use strict';

const crypto = require('crypto');
const db = require('./db.js');
const sanctions = require('./sanctions.js');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS screenings (
    id           bigserial   PRIMARY KEY,
    user_id      bigint      REFERENCES users(id) ON DELETE CASCADE,
    org_id       bigint      REFERENCES organisations(id) ON DELETE CASCADE,
    at           timestamptz NOT NULL DEFAULT now(),
    kind         text        NOT NULL DEFAULT 'live',
    asset        text        NOT NULL DEFAULT '',
    address      text        NOT NULL,
    verdict      text        NOT NULL,
    score        integer     NOT NULL DEFAULT 0,
    sources      text        NOT NULL DEFAULT '',
    list_date    text        NOT NULL DEFAULT '',
    detail_enc   text        NOT NULL DEFAULT '',
    digest       text        NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS screenings_user_idx ON screenings (user_id, at DESC);
ALTER TABLE screenings ADD COLUMN IF NOT EXISTS sandbox boolean NOT NULL DEFAULT false;
ALTER TABLE screenings ADD COLUMN IF NOT EXISTS org_id bigint REFERENCES organisations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS screenings_org_idx ON screenings (org_id, at DESC);
`;

let ready = null;

function init() {
    if (!db.available()) return Promise.resolve(false);
    if (ready) return ready;
    ready = db.query(SCHEMA)
        .then(() => {
            console.log('[screening] table ready');
            return true;
        })
        .catch((err) => {
            console.error('[screening] schema failed: ' + err.message);
            ready = null;
            return false;
        });
    return ready;
}

const SHAPES = [
    { asset: 'XBT', name: 'Bitcoin', re: /^(bc1[023456789acdefghjklmnpqrstuvwxyz]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/ },
    { asset: 'ETH', name: 'Ethereum', re: /^0x[0-9a-fA-F]{40}$/ },
    { asset: 'TRX', name: 'Tron', re: /^T[1-9A-HJ-NP-Za-km-z]{33}$/ },
    { asset: 'LTC', name: 'Litecoin', re: /^(ltc1[023456789acdefghjklmnpqrstuvwxyz]{11,71}|[LM3][a-km-zA-HJ-NP-Z1-9]{25,34})$/ },
    { asset: 'SOL', name: 'Solana', re: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ },
    { asset: 'XMR', name: 'Monero', re: /^4[0-9AB][1-9A-HJ-NP-Za-km-z]{93}$/ },
];

function identify(address) {
    const a = String(address || '').trim();
    for (const s of SHAPES) {
        if (s.re.test(a)) return { asset: s.asset, name: s.name };
    }
    return null;
}

function digestOf(payload) {
    return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

async function screen(userId, orgId, address, kind, sandbox) {
    const clean = String(address || '').trim();
    if (!clean || clean.length > 128) return { ok: false, reason: 'bad-address' };

    const shape = identify(clean);
    const hit = await sanctions.check(clean);
    const meta = await sanctions.status();

    const reasons = [];
    let verdict = 'clear';
    let score = 0;

    if (hit) {
        verdict = 'severe';
        score = 100;
        reasons.push({
            code: 'ofac-sdn',
            label: 'On the OFAC Specially Designated Nationals list',
            entity: hit.entity,
            programs: hit.programs,
            remarks: hit.remarks,
        });
    } else {
        reasons.push({
            code: 'no-sanctions-match',
            label: 'No match on the OFAC Specially Designated Nationals list',
        });
    }

    if (!shape) {
        reasons.push({
            code: 'unrecognised-format',
            label: 'This does not match an address format we recognise, so only an exact list match was possible',
        });
    }

    const sealed = {
        address: clean,
        asset: shape ? shape.asset : (hit ? hit.asset : ''),
        chain: shape ? shape.name : '',
        verdict,
        score,
        reasons,
        checkedAt: new Date().toISOString(),
        sources: [{ name: 'OFAC SDN', listDate: meta.listDate || '', addresses: meta.addressCount || 0 }],
    };
    const digest = digestOf(sealed);

    let id = null;
    if (await init()) {
        const res = await db.query(
            `INSERT INTO screenings (user_id, org_id, kind, asset, address, verdict, score, sources, list_date, detail_enc, digest, sandbox)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
            [userId, orgId, kind === 'history' ? 'history' : 'live', sealed.asset, clean, verdict, score,
             'OFAC SDN', meta.listDate || '', '', digest, Boolean(sandbox)]
        );
        id = res.rows[0].id;
        await db.query('UPDATE screenings SET detail_enc = $1 WHERE id = $2',
            [db.seal('screening:' + id, JSON.stringify(sealed)), id]);
    }

    return { ok: true, id, ...sealed, digest, sandbox: Boolean(sandbox) };
}

async function recent(orgId, limit, sandbox) {
    if (!(await init())) return [];
    const res = await db.query(
        `SELECT id, at, kind, asset, address, verdict, score, list_date, digest
         FROM screenings WHERE org_id = $1 AND sandbox = $3 ORDER BY at DESC, id DESC LIMIT $2`,
        [orgId, Math.min(Math.max(Number(limit) || 25, 1), 200), Boolean(sandbox)]
    );
    return res.rows.map((r) => ({
        id: r.id, at: r.at, kind: r.kind, asset: r.asset, address: r.address,
        verdict: r.verdict, score: r.score, listDate: r.list_date, digest: r.digest,
    }));
}

async function byId(orgId, id, sandbox) {
    if (!(await init())) return null;
    const res = await db.query(
        'SELECT id, detail_enc, digest, at FROM screenings WHERE id = $1 AND org_id = $2 AND sandbox = $3',
        [id, orgId, Boolean(sandbox)]);
    if (!res.rows.length) return null;
    const plain = db.open('screening:' + res.rows[0].id, res.rows[0].detail_enc);
    if (!plain) return null;
    try {
        const doc = JSON.parse(plain);
        doc.id = res.rows[0].id;
        doc.digest = res.rows[0].digest || doc.digest || '';
        return doc;
    } catch (err) {
        return null;
    }
}

async function stats(orgId, days, sandbox) {
    if (!(await init())) {
        return { total: 0, window: 0, days: [], verdicts: {}, assets: [], firstAt: null, lastAt: null };
    }
    const span = Math.min(Math.max(Number(days) || 30, 1), 365);
    const box = Boolean(sandbox);
    const [totalRes, dayRes, verdictRes, assetRes, edgeRes] = await Promise.all([
        db.query('SELECT count(*)::int AS n FROM screenings WHERE org_id = $1 AND sandbox = $2', [orgId, box]),
        db.query(
            `SELECT to_char(date_trunc('day', at), 'YYYY-MM-DD') AS d,
                    count(*)::int AS n,
                    count(*) FILTER (WHERE verdict <> 'clear')::int AS flagged
               FROM screenings
              WHERE org_id = $1 AND sandbox = $3 AND at >= now() - ($2 || ' days')::interval
           GROUP BY 1 ORDER BY 1`,
            [orgId, String(span), box]
        ),
        db.query(
            `SELECT verdict, count(*)::int AS n FROM screenings
              WHERE org_id = $1 AND sandbox = $3 AND at >= now() - ($2 || ' days')::interval
           GROUP BY 1`,
            [orgId, String(span), box]
        ),
        db.query(
            `SELECT COALESCE(NULLIF(asset, ''), 'other') AS asset, count(*)::int AS n
               FROM screenings
              WHERE org_id = $1 AND sandbox = $3 AND at >= now() - ($2 || ' days')::interval
           GROUP BY 1 ORDER BY n DESC`,
            [orgId, String(span), box]
        ),
        db.query('SELECT min(at) AS first_at, max(at) AS last_at FROM screenings WHERE org_id = $1 AND sandbox = $2',
            [orgId, box]),
    ]);

    const byDay = new Map(dayRes.rows.map((r) => [r.d, r]));
    const series = [];
    const now = new Date();
    for (let i = span - 1; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
        const row = byDay.get(d);
        series.push({ day: d, n: row ? row.n : 0, flagged: row ? row.flagged : 0 });
    }

    const verdicts = {};
    let windowTotal = 0;
    verdictRes.rows.forEach((r) => { verdicts[r.verdict] = r.n; windowTotal += r.n; });

    return {
        total: totalRes.rows[0].n,
        window: windowTotal,
        spanDays: span,
        days: series,
        verdicts,
        assets: assetRes.rows.map((r) => ({ asset: r.asset, n: r.n })),
        firstAt: edgeRes.rows[0].first_at,
        lastAt: edgeRes.rows[0].last_at,
    };
}

async function countFor(orgId) {
    if (!(await init())) return 0;
    const res = await db.query('SELECT count(*)::int AS n FROM screenings WHERE org_id = $1', [orgId]);
    return res.rows[0].n;
}

// checks written before organisations existed belong to whoever ran them, so
// they take the organisation that person was given.
async function adopt() {
    if (!(await init())) return 0;
    try {
        const res = await db.query(
            `UPDATE screenings s SET org_id = m.org_id
               FROM memberships m
              WHERE m.user_id = s.user_id AND s.org_id IS NULL`
        );
        if (res.rowCount) console.log('[screening] moved ' + res.rowCount + ' check(s) onto an organisation');
        return res.rowCount;
    } catch (err) {
        console.error('[screening] adopt failed: ' + err.message);
        return 0;
    }
}

module.exports = { screen, recent, byId, countFor, stats, identify, adopt };
