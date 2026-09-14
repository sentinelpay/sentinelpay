'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const db = require('./db');

const RETENTION_DAYS = Math.max(Number(process.env.SUBMISSIONS_RETENTION_DAYS || 365), 1);

const LOG_DIR = process.env.LOG_DIR || path.join(os.tmpdir(), 'sentinelpay-logs');

let ready = false;
function ensureDir() {
    if (ready) return true;
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        ready = true;
    } catch (err) {
        console.error('[submissions] cannot create ' + LOG_DIR + ': ' + err.message);
    }
    return ready;
}

function currentFile(when) {
    const stamp = when.toISOString().slice(0, 7);
    return path.join(LOG_DIR, 'submissions-' + stamp + '.jsonl');
}

function fileLine(entry) {
    if (!db.encrypted()) return JSON.stringify(entry);
    const envelope = {
        ts: entry.ts,
        ref: entry.ref,
        kind: entry.kind,
        outcome: entry.outcome,
        country: entry.country || null,
        flags: entry.flags || [],
        email_hash: entry.email ? db.blindIndex(entry.email) : null,
        enc: db.seal('file-entry:' + entry.ref, JSON.stringify(entry)),
    };
    return JSON.stringify(envelope);
}

function readLine(line) {
    const row = JSON.parse(line);
    if (!row || !row.enc) return row;
    const opened = db.open('file-entry:' + row.ref, row.enc);
    if (!opened) return row;
    try {
        return Object.assign({}, row, JSON.parse(opened), { email_hash: row.email_hash });
    } catch (err) {
        return row;
    }
}

function writeFile(entry, when) {
    if (!ensureDir()) return;
    const file = currentFile(when);
    try {
        fs.appendFileSync(file, fileLine(entry) + '\n', { mode: 0o600 });
        try { fs.chmodSync(file, 0o600); } catch (chmodErr) {  }
    } catch (err) {
        console.error('[submissions] write failed: ' + err.message);
    }
}

function record(kind, req, fields, outcome) {
    const when = new Date();
    const ref = crypto.randomBytes(4).toString('hex');
    const entry = Object.assign({
        ts: when.toISOString(),
        ref: ref,
        kind: kind,
        outcome: outcome,
        ip: req && req.realIp ? req.realIp : null,
        country: req && req.headers ? (req.headers['cf-ipcountry'] || null) : null,
        ua: req && req.headers ? String(req.headers['user-agent'] || '').slice(0, 200) : null,
    }, fields);

    console.log('[submission] ' + [
        'ref=' + ref,
        'kind=' + kind,
        'outcome=' + outcome,
        'country=' + (entry.country || '-'),
        'flags=' + ((fields && Array.isArray(fields.flags) && fields.flags.join('|')) || 'none'),
    ].join(' '));

    if (!db.available()) {
        writeFile(entry, when);
        return ref;
    }

    const stored = Object.assign({}, entry);
    delete stored.ts;
    delete stored.kind;
    delete stored.outcome;

    db.insert(kind, outcome, stored)
        .then((ok) => {
            if (!ok) writeFile(entry, when);
        })
        .catch((err) => {
            console.error('[submissions] insert threw: ' + err.message);
            writeFile(entry, when);
        });

    bus.emit('submission', { ref: ref, kind: kind, outcome: outcome, country: entry.country || null });

    return ref;
}

function purgeFiles() {
    if (!ensureDir()) return 0;
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000);
    let removed = 0;
    let files;
    try {
        files = fs.readdirSync(LOG_DIR).filter((f) => /^submissions-\d{4}-\d{2}\.jsonl$/.test(f));
    } catch (err) {
        return 0;
    }
    for (const file of files) {
        const stamp = file.slice('submissions-'.length, -'.jsonl'.length);
        const end = new Date(Date.UTC(Number(stamp.slice(0, 4)), Number(stamp.slice(5, 7)), 1) - 1);
        if (end >= cutoff) continue;
        try {
            fs.unlinkSync(path.join(LOG_DIR, file));
            removed++;
        } catch (err) {
            console.error('[submissions] cannot remove ' + file + ': ' + err.message);
        }
    }
    if (removed) console.log('[submissions] retention: removed ' + removed + ' fallback file(s) past ' + RETENTION_DAYS + ' days');
    return removed;
}

function forgetInFiles(email) {
    if (!ensureDir()) return 0;
    const target = String(email || '').trim().toLowerCase();
    if (!target) return 0;
    let files;
    try {
        files = fs.readdirSync(LOG_DIR).filter((f) => /^submissions-\d{4}-\d{2}\.jsonl$/.test(f));
    } catch (err) {
        return 0;
    }
    let removed = 0;
    for (const file of files) {
        const full = path.join(LOG_DIR, file);
        let lines;
        try {
            lines = fs.readFileSync(full, 'utf8').split('\n').filter(Boolean);
        } catch (err) {
            continue;
        }
        const keep = lines.filter((line) => {
            try {
                const row = readLine(line);
                const hash = db.blindIndex(target);
                if (String(row.email || '').trim().toLowerCase() === target ||
                    (hash && row.email_hash === hash)) { removed++; return false; }
                return true;
            } catch (err) {
                return true;
            }
        });
        if (keep.length === lines.length) continue;
        try {
            const tmp = full + '.tmp';
            fs.writeFileSync(tmp, keep.length ? keep.join('\n') + '\n' : '');
            fs.renameSync(tmp, full);
        } catch (err) {
            console.error('[submissions] cannot rewrite ' + file + ': ' + err.message);
        }
    }
    return removed;
}

function startRetention() {
    setTimeout(() => { purgeFiles(); }, 40000).unref();
    setInterval(() => { purgeFiles(); }, 24 * 60 * 60 * 1000).unref();
}

async function recent(limit, kind, flaggedOnly, offset) {
    if (db.available()) {
        try {
            const rows = await db.recent(limit, kind, flaggedOnly, offset);
            if (rows) {
                const total = await db.count(kind, flaggedOnly).catch(() => rows.length);
                return { source: 'postgres', rows: rows, total: total };
            }
        } catch (err) {
            console.error('[submissions] read failed: ' + err.message);
        }
    }
    const all = fromFiles(500, kind, flaggedOnly);
    const skip = Math.max(Number(offset) || 0, 0);
    const max = Math.min(Math.max(Number(limit) || 50, 1), 500);
    return { source: 'file:' + LOG_DIR, rows: all.slice(skip, skip + max), total: all.length };
}

const bus = new (require('events').EventEmitter)();
bus.setMaxListeners(50);

function fromFiles(limit, kind, flaggedOnly) {
    const max = Math.min(Math.max(Number(limit) || 50, 1), 500);
    if (!ensureDir()) return [];
    let files;
    try {
        files = fs.readdirSync(LOG_DIR).filter((f) => /^submissions-\d{4}-\d{2}\.jsonl$/.test(f)).sort().reverse();
    } catch (err) {
        return [];
    }
    const out = [];
    for (const file of files) {
        let lines;
        try {
            lines = fs.readFileSync(path.join(LOG_DIR, file), 'utf8').split('\n').filter(Boolean);
        } catch (err) {
            continue;
        }
        for (let i = lines.length - 1; i >= 0 && out.length < max; i--) {
            try {
                const row = readLine(lines[i]);
                if (kind && row.kind !== kind) continue;
                if (flaggedOnly && !(row.flags && row.flags.length)) continue;
                out.push(row);
            } catch (err) {  }
        }
        if (out.length >= max) break;
    }
    return out;
}

module.exports = { record, recent, bus, purgeFiles, forgetInFiles, startRetention, LOG_DIR, RETENTION_DAYS };
