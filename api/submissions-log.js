'use strict';

// An append-only record of everything the forms receive.
//
// There are three copies and they exist for different reasons:
//
//   stdout    a line per submission, carrying no personal data at all: what kind
//             of form, how it went, which country, and a short reference. it
//             goes to the platform's log store, which is somebody else's system
//             with somebody else's retention, and which we cannot delete a line
//             out of when a person asks us to. so nothing personal goes in it.
//   postgres  the real store: queryable, encrypted, and it survives a redeploy
//   file      the fallback for local development and for the minutes when the
//             database is unreachable. ours, on our disk, swept on the same
//             schedule as the database and scrubbed by the same erasure request
//
// Mail can bounce, a provider can be down, an inbox can be missed and a
// database can be restarting. A lead must survive all four.
//
// The reference in the log line is the thread back to the row: it says nothing
// about anybody on its own, and it is deleted with the row it belongs to, so it
// buys us a debuggable log without buying us a second copy of the personal data.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const db = require('./db');

// The fallback file holds the same personal data the database does, so it lives
// under the same promise: the retention window the privacy policy quotes.
const RETENTION_DAYS = Math.max(Number(process.env.SUBMISSIONS_RETENTION_DAYS || 365), 1);

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
    // short, random, and meaningless on its own: enough to tie a log line to a
    // row while looking at both, and nothing at all to somebody holding only the
    // log
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

    // What goes to stdout. Not the entry: a name, an address and an ip printed
    // here end up in a log store we do not control, cannot scope, and cannot
    // erase from when somebody exercises their right to be forgotten. an ip is
    // personal data on its own, so this line is the shape of the traffic and
    // nothing more.
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

    // whoever has the inbox open hears about it. only the reference and the
    // shape travel: the listener turns around and asks for the row properly,
    // through the same gate as everything else, so the stream itself never
    // carries anybody's details.
    bus.emit('submission', { ref: ref, kind: kind, outcome: outcome, country: entry.country || null });

    // handed back so the internal notification can carry the reference instead
    // of the person: one short string that ties the mail, the log line and the
    // row together, and means nothing to anybody who does not hold all three.
    return ref;
}

// ---------------------------------------------------------------------------
// the fallback file, under the same rules as the database
// ---------------------------------------------------------------------------

// Monthly files past the retention window. A file is a whole month, so it goes
// only once every day in it is out of the window, which errs on keeping rather
// than on deleting something still inside it.
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
        // the last instant of that month: while it is in the future, some of the
        // month is still inside the window
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

// An erasure request has to reach this copy too. Without it, deleting the row
// and leaving the file is a promise we did not keep.
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
                const row = JSON.parse(line);
                if (String(row.email || '').trim().toLowerCase() === target) { removed++; return false; }
                return true;
            } catch (err) {
                return true; // a torn line names nobody we can match
            }
        });
        if (keep.length === lines.length) continue;
        try {
            // written whole and moved into place, so an interrupted erasure
            // cannot leave a half file behind
            const tmp = full + '.tmp';
            fs.writeFileSync(tmp, keep.length ? keep.join('\n') + '\n' : '');
            fs.renameSync(tmp, full);
        } catch (err) {
            console.error('[submissions] cannot rewrite ' + file + ': ' + err.message);
        }
    }
    return removed;
}

// Once shortly after boot, then daily, next to the database's own sweep.
function startRetention() {
    setTimeout(() => { purgeFiles(); }, 40000).unref();
    setInterval(() => { purgeFiles(); }, 24 * 60 * 60 * 1000).unref();
}

// Newest first. Reads the database when there is one, and only falls back to
// the files when there is not, so the two never interleave into a half-list
// that looks complete.
async function recent(limit, kind, flaggedOnly, offset) {
    if (db.available()) {
        try {
            const rows = await db.recent(limit, kind, flaggedOnly, offset);
            if (rows) {
                // the total is what lets a pager say "of 34". only the database
                // can answer it cheaply, so the file fallback below reports what
                // it actually read and nothing more.
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

// ---------------------------------------------------------------------------
// telling the open inbox that something arrived
// ---------------------------------------------------------------------------
//
// One emitter, in this process. That is the honest scope of it: with two
// servers running, a submission handled by one would not wake a page connected
// to the other. There is one server, and when there are two this becomes a row
// in the database that the stream polls, or redis. Written down so the limit is
// known rather than discovered.
const bus = new (require('events').EventEmitter)();
// a page per open tab, and the default of ten warns on the eleventh
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

module.exports = { record, recent, bus, purgeFiles, forgetInFiles, startRetention, LOG_DIR, RETENTION_DAYS };
