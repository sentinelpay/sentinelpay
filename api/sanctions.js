'use strict';

const db = require('./db.js');

const SDN_URL = process.env.OFAC_SDN_URL ||
    'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML';
const FETCH_TIMEOUT_MS = Number(process.env.OFAC_TIMEOUT_MS || 120000);
const REFRESH_EVERY_MS = Number(process.env.OFAC_REFRESH_MS || 6 * 60 * 60 * 1000);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sanctioned_addresses (
    address_key text        PRIMARY KEY,
    asset       text        NOT NULL,
    address     text        NOT NULL,
    entity_uid  text        NOT NULL,
    entity_name text        NOT NULL,
    entity_type text        NOT NULL DEFAULT '',
    programs    text        NOT NULL DEFAULT '',
    remarks     text        NOT NULL DEFAULT '',
    list_date   text        NOT NULL DEFAULT '',
    added_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sanctioned_asset_idx ON sanctioned_addresses (asset);

CREATE TABLE IF NOT EXISTS sanctions_meta (
    id           integer     PRIMARY KEY DEFAULT 1,
    list_date    text        NOT NULL DEFAULT '',
    record_count integer     NOT NULL DEFAULT 0,
    address_count integer    NOT NULL DEFAULT 0,
    refreshed_at timestamptz,
    last_error   text        NOT NULL DEFAULT '',
    CONSTRAINT sanctions_meta_one_row CHECK (id = 1)
);
`;

let ready = null;

function init() {
    if (!db.available()) return Promise.resolve(false);
    if (ready) return ready;
    ready = db.query(SCHEMA)
        .then(() => {
            console.log('[sanctions] tables ready');
            return true;
        })
        .catch((err) => {
            console.error('[sanctions] schema failed: ' + err.message);
            ready = null;
            return false;
        });
    return ready;
}

function keyFor(address) {
    return String(address || '').trim().toLowerCase();
}

function textOf(block, tag) {
    const m = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>').exec(block);
    if (!m) return '';
    return m[1]
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .trim();
}

function parseSdn(xml) {
    const listDate = textOf(xml, 'Publish_Date');
    const recordCount = Number(textOf(xml, 'Record_Count') || 0);
    const rows = [];
    const seen = Object.create(null);

    const entryRe = /<sdnEntry>([\s\S]*?)<\/sdnEntry>/g;
    let m;
    while ((m = entryRe.exec(xml)) !== null) {
        const entry = m[1];
        if (entry.indexOf('Digital Currency Address') === -1) continue;

        const uid = textOf(entry, 'uid');
        const type = textOf(entry, 'sdnType');
        const first = textOf(entry, 'firstName');
        const last = textOf(entry, 'lastName');
        const name = [first, last].filter(Boolean).join(' ') || '(unnamed)';
        const remarks = textOf(entry, 'remarks');

        const programs = [];
        const progRe = /<program>([^<]*)<\/program>/g;
        let p;
        while ((p = progRe.exec(entry)) !== null) programs.push(p[1].trim());

        const idRe = /<id>([\s\S]*?)<\/id>/g;
        let idm;
        while ((idm = idRe.exec(entry)) !== null) {
            const idBlock = idm[1];
            const idType = textOf(idBlock, 'idType');
            if (idType.indexOf('Digital Currency Address - ') !== 0) continue;
            const asset = idType.slice('Digital Currency Address - '.length).trim();
            const address = textOf(idBlock, 'idNumber');
            if (!address) continue;
            const key = keyFor(address);
            if (seen[key]) continue;
            seen[key] = true;
            rows.push({
                key, asset, address, uid, name, type,
                programs: programs.join(','),
                remarks,
                listDate,
            });
        }
    }
    return { listDate, recordCount, rows };
}

async function fetchList() {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(SDN_URL, {
            signal: ac.signal,
            redirect: 'follow',
            headers: { 'User-Agent': 'sentinelpay-sanctions/1' },
        });
        if (!res.ok) throw new Error('list fetch returned ' + res.status);
        return await res.text();
    } finally {
        clearTimeout(timer);
    }
}

async function refresh(opts) {
    const force = Boolean(opts && opts.force);
    if (!(await init())) return { ok: false, reason: 'no-database' };

    if (!force) {
        const meta = await status();
        if (meta.refreshedAt && Date.now() - new Date(meta.refreshedAt).getTime() < REFRESH_EVERY_MS) {
            return { ok: true, skipped: true, ...meta };
        }
    }

    let parsed;
    try {
        parsed = parseSdn(await fetchList());
    } catch (err) {
        await db.query(
            `INSERT INTO sanctions_meta (id, last_error) VALUES (1, $1)
             ON CONFLICT (id) DO UPDATE SET last_error = $1`,
            [err.message.slice(0, 300)]
        ).catch(() => {});
        console.error('[sanctions] refresh failed: ' + err.message);
        return { ok: false, reason: err.message };
    }

    if (!parsed.rows.length) {
        return { ok: false, reason: 'list parsed to zero addresses, refusing to replace what is there' };
    }

    const c = await db.connect();
    try {
        await c.query('BEGIN');
        await c.query('DELETE FROM sanctioned_addresses');
        const CHUNK = 200;
        for (let i = 0; i < parsed.rows.length; i += CHUNK) {
            const slice = parsed.rows.slice(i, i + CHUNK);
            const values = [];
            const args = [];
            slice.forEach((r, n) => {
                const b = n * 9;
                values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`);
                args.push(r.key, r.asset, r.address, r.uid, r.name, r.type, r.programs, r.remarks, r.listDate);
            });
            await c.query(
                `INSERT INTO sanctioned_addresses
                 (address_key, asset, address, entity_uid, entity_name, entity_type, programs, remarks, list_date)
                 VALUES ${values.join(',')}
                 ON CONFLICT (address_key) DO NOTHING`,
                args
            );
        }
        await c.query(
            `INSERT INTO sanctions_meta (id, list_date, record_count, address_count, refreshed_at, last_error)
             VALUES (1, $1, $2, $3, now(), '')
             ON CONFLICT (id) DO UPDATE SET
                list_date = $1, record_count = $2, address_count = $3, refreshed_at = now(), last_error = ''`,
            [parsed.listDate, parsed.recordCount, parsed.rows.length]
        );
        await c.query('COMMIT');
    } catch (err) {
        await c.query('ROLLBACK').catch(() => {});
        console.error('[sanctions] write failed: ' + err.message);
        return { ok: false, reason: err.message };
    } finally {
        c.release();
    }

    console.log('[sanctions] ' + parsed.rows.length + ' addresses from the list published ' + parsed.listDate);
    return { ok: true, listDate: parsed.listDate, addressCount: parsed.rows.length, recordCount: parsed.recordCount };
}

async function check(address) {
    if (!(await init())) return null;
    const key = keyFor(address);
    if (!key) return null;
    const res = await db.query(
        `SELECT asset, address, entity_uid, entity_name, entity_type, programs, remarks, list_date
         FROM sanctioned_addresses WHERE address_key = $1`,
        [key]
    );
    if (!res.rows.length) return null;
    const r = res.rows[0];
    return {
        listed: true,
        asset: r.asset,
        address: r.address,
        entity: r.entity_name,
        entityType: r.entity_type,
        entityUid: r.entity_uid,
        programs: r.programs ? r.programs.split(',').filter(Boolean) : [],
        remarks: r.remarks,
        listDate: r.list_date,
        source: 'OFAC SDN',
    };
}

async function checkMany(addresses) {
    if (!(await init())) return {};
    const keys = [];
    const seen = Object.create(null);
    for (const a of addresses || []) {
        const k = keyFor(a);
        if (!k || seen[k]) continue;
        seen[k] = true;
        keys.push(k);
    }
    if (!keys.length) return {};
    const res = await db.query(
        `SELECT address_key, asset, address, entity_uid, entity_name, entity_type, programs, remarks, list_date
         FROM sanctioned_addresses WHERE address_key = ANY($1)`,
        [keys]
    );
    const out = Object.create(null);
    for (const r of res.rows) {
        out[r.address_key] = {
            listed: true,
            asset: r.asset,
            address: r.address,
            entity: r.entity_name,
            entityType: r.entity_type,
            entityUid: r.entity_uid,
            programs: r.programs ? r.programs.split(',').filter(Boolean) : [],
            remarks: r.remarks,
            listDate: r.list_date,
            source: 'OFAC SDN',
        };
    }
    return out;
}

async function status() {
    if (!(await init())) return { available: false };
    const res = await db.query(
        'SELECT list_date, record_count, address_count, refreshed_at, last_error FROM sanctions_meta WHERE id = 1'
    );
    if (!res.rows.length) {
        return { available: true, listDate: '', addressCount: 0, refreshedAt: null, lastError: '' };
    }
    const r = res.rows[0];
    return {
        available: true,
        listDate: r.list_date,
        recordCount: r.record_count,
        addressCount: r.address_count,
        refreshedAt: r.refreshed_at,
        lastError: r.last_error,
    };
}

let timer = null;

function startRefresh() {
    if (timer || !db.available()) return;
    const run = () => {
        refresh().catch((err) => console.error('[sanctions] scheduled refresh: ' + err.message));
    };
    setTimeout(run, 15000).unref && setTimeout(run, 15000).unref();
    timer = setInterval(run, REFRESH_EVERY_MS);
    if (timer.unref) timer.unref();
}

module.exports = { refresh, check, checkMany, status, startRefresh, keyFor, parseSdn };
