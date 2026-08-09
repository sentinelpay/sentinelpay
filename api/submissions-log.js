'use strict';

// An append-only record of everything the forms receive.
//
// There are three copies and they exist for different reasons:
//
//   stdout    written first, always, before anything can fail. the platform's
//             own log retention picks it up, so even a total database outage
//             leaves a trace of who came in
//   postgres  the real store: queryable, encrypted, and it survives a redeploy
//   file      the fallback for local development and for the minutes when the
//             database is unreachable
//
// Mail can bounce, a provider can be down, an inbox can be missed and a
// database can be restarting. A lead must survive all four.

const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('./db');

// Only used when there is no database. Railway's filesystem is ephemeral: a
// redeploy wipes it, which is the whole reason the database exists.
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

// one file per month, so it stays greppable by hand and never grows unbounded
function currentFile(when) {
    const stamp = when.toISOString().slice(0, 7);
    return path.join(LOG_DIR, 'submissions-' + stamp + '.jsonl');
}

function writeFile(entry, when) {
    if (!ensureDir()) return;
    try {
        fs.appendFileSync(currentFile(when), JSON.stringify(entry) + '\n');
    } catch (err) {
        console.error('[submissions] write failed: ' + err.message);
    }
}

// The caller does not wait for this. It runs once per form submission in the
// request path, and the visitor's response must not depend on a database round
// trip, so the durable copy goes out first and the insert catches up.
function record(kind, req, fields, outcome) {
    const when = new Date();
    const entry = Object.assign({
        ts: when.toISOString(),
        kind: kind,
        outcome: outcome,
        ip: req && req.realIp ? req.realIp : null,
        country: req && req.headers ? (req.headers['cf-ipcountry'] || null) : null,
        ua: req && req.headers ? String(req.headers['user-agent'] || '').slice(0, 200) : null,
    }, fields);

    // first, and synchronously: this is the copy that survives everything else
    console.log('[submission] ' + JSON.stringify(entry));

    if (!db.available()) {
        writeFile(entry, when);
        return;
    }

    // The stored row carries the fields, not the envelope: kind and outcome are
    // columns of their own, and the timestamp is the database's.
    const stored = Object.assign({}, entry);
    delete stored.ts;
    delete stored.kind;
    delete stored.outcome;

    db.insert(kind, outcome, stored)
        .then((ok) => {
            // Falling back on failure rather than on absence: a database that
            // rejected this row is exactly when the file copy earns its keep.
            if (!ok) writeFile(entry, when);
        })
        .catch((err) => {
            console.error('[submissions] insert threw: ' + err.message);
            writeFile(entry, when);
        });
}

// Newest first. Reads the database when there is one, and only falls back to
// the files when there is not, so the two never interleave into a half-list
// that looks complete.
async function recent(limit, kind, flaggedOnly) {
    if (db.available()) {
        try {
            const rows = await db.recent(limit, kind, flaggedOnly);
            if (rows) return { source: 'postgres', rows: rows };
        } catch (err) {
            console.error('[submissions] read failed: ' + err.message);
        }
    }
    return { source: 'file:' + LOG_DIR, rows: fromFiles(limit, kind, flaggedOnly) };
}

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
                const row = JSON.parse(lines[i]);
                if (kind && row.kind !== kind) continue;
                if (flaggedOnly && !(row.flags && row.flags.length)) continue;
                out.push(row);
            } catch (err) { /* skip a torn line */ }
        }
        if (out.length >= max) break;
    }
    return out;
}

module.exports = { record, recent, LOG_DIR };
