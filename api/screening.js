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
-- Which project a check belonged to. Nullable and staying that way: a check run
-- from the dashboard belongs to the company rather than to one of its projects,
-- and every check written before this column existed has no honest answer. A
-- default would invent one.
ALTER TABLE screenings ADD COLUMN IF NOT EXISTS project_id bigint REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS screenings_project_idx ON screenings (org_id, project_id, at DESC);

-- What a person decided about a check, which is a different thing from what
-- the engine said about it.
--
-- Everything above this line is the machine's answer: on the list or not, a
-- hundred or nothing, sealed and dated. None of it is a decision. A regulator
-- does not ask how many addresses were screened, they ask who looked at the
-- one that matched and what they concluded -- and until this column there was
-- nowhere in the product for that answer to live. The dashboard had the words
-- for it translated into three languages and nothing behind them.
--
-- Four states and no more. Nothing decided is the state every check ever
-- written is already in, so it is the empty string rather than a word: a
-- default that claims a decision was made would be a lie about ten thousand
-- rows. 'holding' is somebody saying they are on it, which stops two analysts
-- working the same alert. 'cleared' and 'confirmed' are the two ways a check
-- stops needing a person.
ALTER TABLE screenings ADD COLUMN IF NOT EXISTS decision   text NOT NULL DEFAULT '';
ALTER TABLE screenings ADD COLUMN IF NOT EXISTS decided_at timestamptz;
ALTER TABLE screenings ADD COLUMN IF NOT EXISTS decided_by bigint REFERENCES users(id) ON DELETE SET NULL;
-- The queue, and only the queue: a partial index, because the question asked
-- of this table every time somebody opens the dashboard is "what is flagged
-- and not yet dealt with", and that is a hundredth of the rows in it.
CREATE INDEX IF NOT EXISTS screenings_queue_idx
    ON screenings (org_id, sandbox, decision, at DESC)
    WHERE verdict <> 'clear';

-- And the history of those decisions, which is the part that has to survive
-- being argued with.
--
-- Append only. A decision can be revisited -- an analyst clears an alert, a
-- reviewer disagrees a week later -- and a column that is overwritten loses
-- the first answer along with the fact that anybody ever gave it. The column
-- above is the latest of these rows, kept beside the check so the queue can be
-- asked for without a join; this table is the record.
--
-- The note is sealed. An analyst writing down why an address was cleared is
-- writing about a customer, and that belongs under the same key as everything
-- else in this product that names one. The digest is over the decision as it
-- was made, so a copy of it handed to somebody can be checked against ours,
-- exactly as the check's own digest can.
CREATE TABLE IF NOT EXISTS check_decisions (
    id           bigserial   PRIMARY KEY,
    at           timestamptz NOT NULL DEFAULT now(),
    screening_id bigint      NOT NULL REFERENCES screenings(id) ON DELETE CASCADE,
    org_id       bigint      NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    actor_id     bigint      REFERENCES users(id) ON DELETE SET NULL,
    -- the name as it was when the decision was made, sealed like every other
    -- name in this product. Kept beside the id rather than looked up through
    -- it: people leave, accounts are closed, and an audit record that loses
    -- who made it the day somebody's account is deleted is not an audit
    -- record. Covered by the digest, so it cannot be quietly changed either.
    actor_enc    text        NOT NULL DEFAULT '',
    decision     text        NOT NULL,
    note_enc     text        NOT NULL DEFAULT '',
    digest       text        NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS check_decisions_check_idx ON check_decisions (screening_id, at DESC);
CREATE INDEX IF NOT EXISTS check_decisions_org_idx   ON check_decisions (org_id, at DESC);
`;

// The four states, and what each one means to the queue.
//
// `open` is not stored -- a check nobody has touched has an empty decision --
// but it is asked for by name, because "show me what is open" is the question
// the queue is, and making the caller know that open means empty would put the
// shape of the column into every screen that reads it.
const DECISIONS = ['holding', 'cleared', 'confirmed', 'open'];
// The two that take a check out of the queue. A check on hold is still work.
const DECIDED = ['cleared', 'confirmed'];
// and the two that have to say why. "Cleared" with no reason is the sentence
// an auditor asks about and nobody can answer; "holding" is not a conclusion,
// so it does not need one.
const NEEDS_WHY = ['cleared', 'confirmed'];
const NOTE_MAX = 2000;

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

// The bands this organisation draws, read here when the caller has not got
// them.
//
// A check made from the dashboard already carries them: the membership row is
// read to decide whether the person may screen at all, and the bands come with
// it. A check made through a token does not -- a token carries an organisation
// id and nothing else -- and defaulting there would quietly measure every API
// check against the shipped lines while the dashboard used the company's own.
// One lookup on a primary key, on the path that has no other way to know.
async function bandsFor(orgId) {
    try {
        const res = await db.query(
            'SELECT risk_mid, risk_high, risk_severe FROM organisations WHERE id = $1',
            [Number(orgId)]);
        if (!res.rowCount) return null;
        return {
            mid: Number(res.rows[0].risk_mid),
            high: Number(res.rows[0].risk_high),
            severe: Number(res.rows[0].risk_severe),
        };
    } catch (err) {
        console.error('[screening] could not read the risk bands: ' + err.message);
        return null;
    }
}

async function screen(userId, orgId, address, kind, sandbox, projectId, bands) {
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

    // Read before the row is written, so what is sealed is what was in force
    // when the check ran rather than whatever it is by the time it is asked.
    const asked = bands && bands.mid && bands.high && bands.severe
        ? bands
        : (await bandsFor(orgId));
    const lines = {
        mid: Number(asked && asked.mid) || 51,
        high: Number(asked && asked.high) || 81,
        severe: Number(asked && asked.severe) || 100,
    };

    const sealed = {
        address: clean,
        asset: shape ? shape.asset : (hit ? hit.asset : ''),
        chain: shape ? shape.name : '',
        verdict,
        score,
        // The lines this score was read against, at the moment it was read.
        //
        // An organisation can move them, and this product promises a verdict
        // reproducible a year later. A score of sixty means one thing under a
        // middle band of fifty-one and another under one of seventy, so a
        // sealed check that records the score and not the bands records half
        // a verdict: next March nobody could say whether the amber it showed
        // was right, only what number it had.
        //
        // Sealed, so it is covered by the digest along with everything else.
        bands: lines,
        reasons,
        checkedAt: new Date().toISOString(),
        sources: [{ name: 'OFAC SDN', listDate: meta.listDate || '', addresses: meta.addressCount || 0 }],
    };
    const digest = digestOf(sealed);

    let id = null;
    if (await init()) {
        const res = await db.query(
            `INSERT INTO screenings (user_id, org_id, kind, asset, address, verdict, score, sources, list_date, detail_enc, digest, sandbox, project_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
            [userId, orgId, kind === 'history' ? 'history' : 'live', sealed.asset, clean, verdict, score,
             'OFAC SDN', meta.listDate || '', '', digest, Boolean(sandbox),
             projectId ? Number(projectId) : null]
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

// The log, as somebody actually asks for it: a window of time, one verdict or
// all of them, one project or all of them, and a particular address.
//
// Paged by a cursor rather than an offset. Checks arrive while somebody is
// reading, and an offset walks the same row twice or steps over one every time
// the top of the list moves.
//
// The cursor is the pair the list is sorted by -- the moment and the id -- and
// not the id alone. Those two do not agree: a batch written in one go ascends
// by id while descending by time, so an id cursor against a time sort hands
// back rows that have already been read. It did, for twenty-one of a hundred
// and twenty.
async function log(orgId, q) {
    if (!(await init())) return { rows: [], more: false };
    const want = q || {};
    const cap = Math.min(Math.max(Number(want.limit) || 50, 1), 200);

    // written against the alias from the start. an earlier version built them
    // bare and put the alias on afterwards with a regular expression, which is
    // a parser nobody asked for sitting between a query and the database.
    const where = ['s.org_id = $1', 's.sandbox = $2'];
    const args = [Number(orgId), Boolean(want.sandbox)];
    const add = (sql, value) => { args.push(value); where.push(sql.replace('$n', '$' + args.length)); };

    if (want.from) add('s.at >= $n::timestamptz', want.from);
    if (want.to) add('s.at < $n::timestamptz', want.to);
    if (want.verdict === 'flagged') where.push("s.verdict <> 'clear'");
    else if (want.verdict) add('s.verdict = $n', String(want.verdict));
    if (want.project === 'none') where.push('s.project_id IS NULL');
    else if (want.project) add('s.project_id = $n', Number(want.project));
    // What a person made of it, which is a different question from what the
    // engine did. 'open' is stored as nothing, so it is asked for as nothing;
    // 'waiting' is the queue -- open and on hold together -- because "what is
    // still work" is one question and not two.
    if (want.state === 'open') where.push("s.decision = ''");
    else if (want.state === 'waiting') where.push("s.decision IN ('', 'holding')");
    else if (want.state) add('s.decision = $n', String(want.state));
    // an address is matched from the front: these are long strings nobody
    // types in full, and a match anywhere inside one would scan the table
    if (want.address) add('s.address LIKE $n', String(want.address).trim() + '%');
    // where to carry on from: the exact place of the last row already read, in
    // the order this list is in
    const at = spot(want.cursor);
    if (at) {
        args.push(at.at, at.id);
        where.push('(s.at, s.id) < ($' + (args.length - 1) + '::timestamptz, $' + args.length + ')');
    }

    args.push(cap + 1);
    const res = await db.query(
        `SELECT s.id, s.at, s.kind, s.asset, s.address, s.verdict, s.score, s.list_date, s.digest,
                s.project_id, p.name AS project_name, s.decision
           FROM screenings s
           LEFT JOIN projects p ON p.id = s.project_id
          WHERE ` + where.join(' AND ') + `
       ORDER BY s.at DESC, s.id DESC
          LIMIT $` + args.length,
        args
    );
    const rows = res.rows.slice(0, cap).map((r) => ({
        id: String(r.id), at: r.at, kind: r.kind, asset: r.asset, address: r.address,
        verdict: r.verdict, score: r.score, listDate: r.list_date, digest: r.digest,
        projectId: r.project_id ? String(r.project_id) : '',
        projectName: r.project_name || '',
        state: r.decision || 'open',
    }));
    const last = rows[rows.length - 1];
    return {
        rows,
        more: res.rows.length > cap,
        next: last ? new Date(last.at).toISOString() + '~' + last.id : '',
    };
}

// The cursor, which is one place in this list written down. It is handed out
// by the query and handed back unread, so the shape stays in this file.
function spot(raw) {
    const cut = String(raw || '').split('~');
    if (cut.length !== 2) return null;
    const when = new Date(cut[0]);
    const id = Number(cut[1]);
    if (isNaN(when.getTime()) || !Number.isSafeInteger(id) || id < 1) return null;
    return { at: when.toISOString(), id };
}

async function byId(orgId, id, sandbox) {
    if (!(await init())) return null;
    const res = await db.query(
        `SELECT s.id, s.detail_enc, s.digest, s.at, s.verdict, s.score, s.asset, s.address,
                s.decision, s.decided_at, s.project_id, p.name AS project_name
           FROM screenings s
           LEFT JOIN projects p ON p.id = s.project_id
          WHERE s.id = $1 AND s.org_id = $2 AND s.sandbox = $3`,
        [id, orgId, Boolean(sandbox)]);
    if (!res.rows.length) return null;
    const row = res.rows[0];
    const plain = db.open('screening:' + row.id, row.detail_enc);
    // A row whose sealed record cannot be opened is still a row somebody has to
    // be able to work: the key may have been rotated, or this check may predate
    // the seal. What the engine said is in columns of its own, so the check is
    // rebuilt from those rather than disappearing from the queue.
    let doc = null;
    if (plain) {
        try { doc = JSON.parse(plain); } catch (err) { doc = null; }
    }
    if (!doc) {
        doc = {
            address: row.address, asset: row.asset, chain: '',
            verdict: row.verdict, score: row.score, reasons: [], sources: [],
            checkedAt: row.at, sealed: false,
        };
    }
    doc.id = row.id;
    doc.at = row.at;
    doc.digest = row.digest || doc.digest || '';
    doc.projectId = row.project_id ? String(row.project_id) : '';
    doc.projectName = row.project_name || '';
    // What a person made of it, beside what the engine made of it. Named
    // `state` rather than `decision` on the way out, because the word on the
    // screen for the empty one is "open" and nothing outside this file should
    // have to know that open is stored as nothing.
    doc.state = row.decision || 'open';
    doc.decidedAt = row.decided_at || null;
    doc.history = await decisionsFor(orgId, row.id);
    // who, taken from the decision that set the state rather than from the
    // users table: the name that matters is the one in force when it was made.
    // Nobody, where the state is open -- putting an alert back is not a
    // conclusion, and it must not leave the last person's name on it.
    doc.decidedBy = doc.state === 'open' ? '' : ((doc.history[0] && doc.history[0].by) || '');
    return doc;
}

// Every decision ever made about one check, newest first.
//
// The notes come back opened, because the only caller is the drawer that shows
// them to somebody already allowed to read this organisation's work. They are
// sealed at rest and not in transit to their own owner.
async function decisionsFor(orgId, checkId) {
    if (!(await init())) return [];
    const res = await db.query(
        `SELECT id, at, decision, note_enc, digest, actor_enc
           FROM check_decisions
          WHERE screening_id = $1 AND org_id = $2
          ORDER BY at DESC, id DESC LIMIT 50`,
        [Number(checkId), Number(orgId)]);
    return res.rows.map((r) => ({
        id: String(r.id),
        at: r.at,
        state: r.decision,
        by: r.actor_enc ? (db.open('decided-by:' + r.id, r.actor_enc) || '') : '',
        note: r.note_enc ? (db.open('decision:' + r.id, r.note_enc) || '') : '',
        digest: r.digest || '',
    }));
}

// A person's conclusion about one check.
//
// Written as a row of its own first and only then reflected onto the check, so
// that the record exists before the shortcut to it does. If the second write
// fails the history still holds what was decided, which is the way round that
// can be repaired; the other way round leaves a check claiming a decision
// nobody can produce.
async function decide(orgId, checkId, who, state, note) {
    if (!(await init())) return { ok: false, reason: 'unavailable' };
    if (DECISIONS.indexOf(state) === -1) return { ok: false, reason: 'bad-state' };

    const why = String(note == null ? '' : note).trim().slice(0, NOTE_MAX);
    // A conclusion with no reason is the sentence an auditor asks about and
    // nobody can answer. Taking one up, or putting it back, needs no argument.
    if (NEEDS_WHY.indexOf(state) !== -1 && !why) return { ok: false, reason: 'needs-why' };

    const mine = await db.query(
        'SELECT id, verdict FROM screenings WHERE id = $1 AND org_id = $2',
        [Number(checkId), Number(orgId)]);
    if (!mine.rows.length) return { ok: false, reason: 'gone' };
    // A clear check is not a thing to decide about. The engine found nothing,
    // there is no alert, and a queue that can be filled by hand with checks
    // that never needed anybody is a queue nobody trusts.
    if (mine.rows[0].verdict === 'clear') return { ok: false, reason: 'not-an-alert' };

    const at = new Date().toISOString();
    const sealed = {
        check: String(checkId),
        state,
        note: why,
        by: (who && who.name) || '',
        at,
    };
    const stamp = digestOf(sealed);

    // The row first, because both sealed fields are keyed on its own id: a
    // record that cannot be opened without knowing where it sits cannot be
    // lifted out of the table and read somewhere else.
    const put = await db.query(
        `INSERT INTO check_decisions (screening_id, org_id, actor_id, decision, digest)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, at`,
        [Number(checkId), Number(orgId), who && who.id ? Number(who.id) : null, state, stamp]);
    const made = put.rows[0];
    const name = (who && who.name) || '';
    if (name || why) {
        await db.query(
            'UPDATE check_decisions SET actor_enc = $1, note_enc = $2 WHERE id = $3',
            [name ? db.seal('decided-by:' + made.id, name) : '',
             why ? db.seal('decision:' + made.id, why) : '', made.id]);
    }

    // 'open' is stored as nothing, and putting a check back in the queue takes
    // the name and the moment off it too: a check nobody has concluded about
    // should not carry somebody's name as though they had.
    const now = state === 'open' ? '' : state;
    await db.query(
        `UPDATE screenings SET decision = $1,
                decided_at = CASE WHEN $1 = '' THEN NULL ELSE now() END,
                decided_by = CASE WHEN $1 = '' THEN NULL ELSE $2::bigint END
          WHERE id = $3 AND org_id = $4`,
        [now, who && who.id ? Number(who.id) : null, Number(checkId), Number(orgId)]);

    return {
        ok: true,
        state,
        at: made.at,
        by: (who && who.name) || '',
        note: why,
        digest: stamp,
    };
}

// What is waiting, and how much of it there is.
//
// The one question the first screen of this product has to answer, asked as
// one round trip: the alerts nobody has concluded about, newest first, with
// the counts that say whether the handful shown is all of them.
//
// Flagged and not clear, because a clear check is not an alert. On hold is
// counted apart from open -- it is still work, but it is somebody's work, and
// a team that cannot tell those two apart does the same alert twice.
async function queue(orgId, sandbox, limit) {
    if (!(await init())) return { rows: [], open: 0, holding: 0 };
    const cap = Math.min(Math.max(Number(limit) || 8, 1), 50);
    const box = Boolean(sandbox);

    const [rows, counts] = await Promise.all([
        db.query(
            `SELECT s.id, s.at, s.kind, s.asset, s.address, s.verdict, s.score, s.digest,
                    s.decision, s.project_id, p.name AS project_name
               FROM screenings s
               LEFT JOIN projects p ON p.id = s.project_id
              WHERE s.org_id = $1 AND s.sandbox = $2 AND s.verdict <> 'clear'
                AND s.decision IN ('', 'holding')
              ORDER BY s.at DESC, s.id DESC
              LIMIT $3`,
            [Number(orgId), box, cap]),
        db.query(
            `SELECT s.decision AS d, count(*)::int AS n
               FROM screenings s
              WHERE s.org_id = $1 AND s.sandbox = $2 AND s.verdict <> 'clear'
              GROUP BY s.decision`,
            [Number(orgId), box]),
    ]);

    const tally = { open: 0, holding: 0, cleared: 0, confirmed: 0 };
    counts.rows.forEach((r) => {
        const key = r.d || 'open';
        if (tally[key] === undefined) return;
        tally[key] = r.n;
    });

    return {
        rows: rows.rows.map((r) => ({
            id: String(r.id), at: r.at, kind: r.kind, asset: r.asset, address: r.address,
            verdict: r.verdict, score: r.score, digest: r.digest,
            state: r.decision || 'open',
            projectId: r.project_id ? String(r.project_id) : '',
            projectName: r.project_name || '',
        })),
        ...tally,
    };
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

module.exports = {
    screen, recent, log, byId, countFor, stats, identify, adopt,
    decide, decisionsFor, queue,
    // the vocabulary, so the routes and the tests hold to the same four words
    DECISIONS, DECIDED, NEEDS_WHY, NOTE_MAX,
};
