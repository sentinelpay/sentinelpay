'use strict';

const crypto = require('crypto');
const db = require('./db.js');
const sanctions = require('./sanctions.js');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS screenings (
    id           bigserial   PRIMARY KEY,
    user_id      bigint      REFERENCES users(id) ON DELETE CASCADE,
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

async function screen(userId, address, kind) {
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
            `INSERT INTO screenings (user_id, kind, asset, address, verdict, score, sources, list_date, detail_enc, digest)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
            [userId, kind === 'history' ? 'history' : 'live', sealed.asset, clean, verdict, score,
             'OFAC SDN', meta.listDate || '', '', digest]
        );
        id = res.rows[0].id;
        await db.query('UPDATE screenings SET detail_enc = $1 WHERE id = $2',
            [db.seal('screening:' + id, JSON.stringify(sealed)), id]);
    }

    return { ok: true, id, ...sealed, digest };
}

async function recent(userId, limit) {
    if (!(await init())) return [];
    const res = await db.query(
        `SELECT id, at, kind, asset, address, verdict, score, list_date, digest
         FROM screenings WHERE user_id = $1 ORDER BY at DESC, id DESC LIMIT $2`,
        [userId, Math.min(Math.max(Number(limit) || 25, 1), 200)]
    );
    return res.rows.map((r) => ({
        id: r.id, at: r.at, kind: r.kind, asset: r.asset, address: r.address,
        verdict: r.verdict, score: r.score, listDate: r.list_date, digest: r.digest,
    }));
}

async function byId(userId, id) {
    if (!(await init())) return null;
    const res = await db.query('SELECT id, detail_enc FROM screenings WHERE id = $1 AND user_id = $2', [id, userId]);
    if (!res.rows.length) return null;
    const plain = db.open('screening:' + res.rows[0].id, res.rows[0].detail_enc);
    if (!plain) return null;
    try {
        return JSON.parse(plain);
    } catch (err) {
        return null;
    }
}

async function countFor(userId) {
    if (!(await init())) return 0;
    const res = await db.query('SELECT count(*)::int AS n FROM screenings WHERE user_id = $1', [userId]);
    return res.rows[0].n;
}

module.exports = { screen, recent, byId, countFor, identify };
