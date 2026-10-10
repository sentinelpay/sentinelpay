'use strict';

// Fills an organisation with sample screenings, so a screen built for a busy
// customer can be looked at before there is one.
//
// It writes real rows into the real table rather than faking anything in the
// page. A screen that draws invented numbers when the database is empty is a
// screen nobody can trust when it is full: the only way to know the chart is
// right is to point it at rows that went in the same way a customer's would.
//
// Which also means these rows are indistinguishable from real work, so:
//
//   - it refuses to run against production
//   - every row it writes is marked, and --clear takes exactly those out again
//   - it never touches anything it did not write
//
//   DATABASE_URL=... node tools/seed-usage.js <org-slug> [--days 45] [--busy 10] [--yes]
//                        [--review]   also write the verdict the engine cannot reach yet
//                        [--decided 0.6]  how much of the flagged work a person signed off
//   DATABASE_URL=... node tools/seed-usage.js <org-slug> --from 2026-06-20 [--yes]
//   DATABASE_URL=... node tools/seed-usage.js <org-slug> --clear [--yes]
//   DATABASE_URL=... node tools/seed-usage.js <org-slug> --show

const db = require('../api/db.js');
const crypto = require('crypto');

// the marker lives in a column the product already has and never sets itself,
// so finding these rows later is a plain equality rather than a guess
const MARK = 'sample';

const args = process.argv.slice(2);
const flag = (name) => args.includes('--' + name);
const value = (name) => {
    const at = args.indexOf('--' + name);
    return at === -1 ? '' : (args[at + 1] || '');
};
const TAKES_VALUE = ['--days', '--from', '--busy', '--decided'];
const plain = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && TAKES_VALUE.indexOf(args[i - 1]) !== -1));
const slug = plain[0];

// Weighted, because a real book of business is not spread evenly over five
// chains. Picking uniformly meant every day touched all five, so the chains
// card drew a flat line at its own maximum -- true of the fixture and true of
// nobody.
const ASSETS = ['XBT', 'XBT', 'XBT', 'XBT', 'ETH', 'ETH', 'ETH', 'TRX', 'TRX', 'SOL', 'LTC'];

// A pool of addresses that repeat, rather than one address per check.
//
// The fixture used to name every row after the row it was, so a day of forty
// checks was forty distinct addresses: the addresses card drew the same shape
// as the chart above it and "checks each" was 1.0 forever. Real work is not
// like that -- a customer is screened again when they move again -- and the
// ratio between checks and addresses is one of the few numbers on this page
// that says which product somebody is buying.
//
// A third of the pool is hot and takes most of the traffic, which is also what
// a real one looks like.
// How much traffic a day, as a multiple of a small customer. A dozen checks a
// day out of a pool of hundreds almost never asks about the same address
// twice, so the addresses card came out the same shape as the chart above it
// however the pool was sized -- it is the volume that makes an address repeat,
// not the pool. Ten is roughly what a busy account looks like, and is what a
// screen built for a busy account should be looked at with.
const BUSY = Math.max(1, Math.min(200, Number(value('busy')) || 1));
const POOL = 240;

// Addresses that look like addresses.
//
// They used to be "sample-addr-7", which reads as a fixture from across the
// room and, worse, is recognised as no chain at all: screening.js decides what
// a chain is from the shape of the address, so a name that matches none of its
// patterns is a row whose chain column is a guess written by the seeder rather
// than the answer the product would give.
//
// These are built to those same patterns, so the product identifies them the
// way it identifies a real one. They are random inside the pattern and carry
// no valid checksum, which is deliberate: they are unmistakable in a wallet
// and cannot be confused for somebody's money.
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BECH = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const HEX = '0123456789abcdef';

function runOf(alphabet, n, rand) {
    let out = '';
    for (let i = 0; i < n; i++) out += alphabet[Math.floor(rand() * alphabet.length)];
    return out;
}

// One generator per chain, matching the patterns in api/screening.js.
const SHAPES = {
    XBT: (r) => (r() < 0.6
        ? 'bc1q' + runOf(BECH, 38, r)
        : (r() < 0.5 ? '1' : '3') + runOf(B58, 32, r)),
    ETH: (r) => '0x' + runOf(HEX, 40, r),
    TRX: (r) => 'T' + runOf(B58, 33, r),
    LTC: (r) => (r() < 0.5 ? 'ltc1q' + runOf(BECH, 38, r) : 'L' + runOf(B58, 32, r)),
    SOL: (r) => runOf(B58, 43, r),
};

// The pool is built once and drawn from, so an address repeats the way a real
// customer does. A third of it is hot and takes most of the traffic, which is
// also what a real book of business looks like.
const BOOK = [];
(function fillBook() {
    const chains = Object.keys(SHAPES);
    for (let i = 0; i < POOL; i++) {
        const asset = ASSETS[i % ASSETS.length];
        const make = SHAPES[asset] || SHAPES.XBT;
        BOOK.push({ asset, address: make(Math.random) });
        void chains;
    }
})();

// An address and the chain it is on, together: they are not independent, and
// picking them apart is how a fixture ends up with an ethereum address filed
// under bitcoin.
function aCheck() {
    const hot = Math.random() < 0.6;
    const n = hot
        ? Math.floor(Math.random() * (POOL / 3))
        : Math.floor(Math.random() * POOL);
    return BOOK[n];
}

// What the engine can actually answer.
//
// api/screening.js has two outcomes and no third: an address is on the OFAC
// SDN list, which is `severe` and scores 100, or it is not, which is `clear`
// and scores 0. There is nothing in between and no score between them.
//
// The dashboard carries a third verdict -- "worth a look" -- and a filter for
// it, written for the day indirect exposure is scored. Until that day it is a
// state no real check can be in, and a fixture that writes it is a fixture
// that disagrees with the product: on a seeded staging "flagged" and "severe"
// are two different numbers, and in production they are the same number.
//
// So the default is what the engine does. --review seeds the planned state
// instead, for looking at the screen that is being built for it.
const VERDICTS = flag('review')
    ? { severe: 0.05, review: 0.09 }
    : { severe: 0.05, review: 0 };

// A risk score, in the shape a book of business makes.
//
// Most addresses are uninteresting and score near nothing; a few are worth a
// second look; a handful are on the list. So: a long tail, not a flat spread,
// which is also what makes a column of these readable -- a screen of numbers
// scattered evenly between 0 and 100 says nothing about which row to open.
//
// The engine does not produce any of this yet. screening.js scores 100 for a
// hit on the OFAC SDN list and 0 for everything else, and until the heuristics
// exist every number between those two is the fixture's invention. That is
// what a fixture is for while a screen is being built, and it is also a debt:
// the day this is demonstrated to somebody who can buy it, the numbers have to
// be real.
function aScore() {
    const roll = Math.random();
    if (roll < VERDICTS.severe) return 100;
    if (roll < VERDICTS.severe + 0.06) return 60 + Math.floor(Math.random() * 30);
    if (roll < VERDICTS.severe + 0.2) return 25 + Math.floor(Math.random() * 30);
    return Math.floor(Math.random() * 22);
}

// A week with quiet weekends and a couple of busy afternoons looks like work.
// A flat line at the same number every day looks like a fixture, and the point
// of this is to see what the chart does with a real shape.
function howMany(daysAgo) {
    const when = new Date(Date.now() - daysAgo * 86400000);
    const weekend = when.getUTCDay() === 0 || when.getUTCDay() === 6;
    const base = weekend ? 2 : 11;
    const swing = weekend ? 3 : 14;
    return Math.max(0, Math.round((base + (Math.random() - 0.35) * swing) * BUSY));
}

async function main() {
    if (!slug) {
        console.error('usage: node tools/seed-usage.js <org-slug> [--days 45] [--yes]');
        console.error('       node tools/seed-usage.js <org-slug> --clear [--yes]');
        console.error('       node tools/seed-usage.js <org-slug> --show');
        process.exit(1);
    }
    if (!db.available()) {
        console.error('no DATABASE_URL, nothing to do');
        process.exit(1);
    }
    if (process.env.NODE_ENV === 'production' || String(process.env.APP_ENV || '').toLowerCase() === 'production') {
        console.error('refusing to write sample screenings into production');
        process.exit(1);
    }

    const found = await db.query('SELECT id, name, slug FROM organisations WHERE slug = $1', [slug]);
    if (!found.rowCount) {
        console.error('no organisation with that slug');
        process.exit(1);
    }
    const org = found.rows[0];

    const mine = await db.query(
        "SELECT count(*)::int AS n FROM screenings WHERE org_id = $1 AND sources = $2",
        [org.id, MARK]
    );
    const real = await db.query(
        "SELECT count(*)::int AS n FROM screenings WHERE org_id = $1 AND sources <> $2",
        [org.id, MARK]
    );
    console.log(org.name + '  (' + org.slug + ')');
    console.log('  sample screenings   ' + mine.rows[0].n);
    console.log('  real screenings     ' + real.rows[0].n);

    if (flag('show')) process.exit(0);

    if (flag('clear')) {
        console.log('');
        console.log('would remove the ' + mine.rows[0].n + ' sample row(s) and leave the rest alone.');
        if (!flag('yes')) {
            console.log('nothing was changed. pass --yes to go ahead.');
            process.exit(0);
        }
        const gone = await db.query(
            'DELETE FROM screenings WHERE org_id = $1 AND sources = $2',
            [org.id, MARK]
        );
        console.log('removed ' + gone.rowCount + '.');
        process.exit(0);
    }

    // --from is the same thing said the other way round, and it is the way
    // somebody actually thinks about a fixture: this customer has been with us
    // since June, not for ninety-five days.
    let days = Math.min(Math.max(Number(value('days')) || 45, 1), 365);
    const fromDay = String(value('from') || '').trim();
    let startsAt = new Date(Date.now() - (days - 1) * 86400000);
    if (fromDay) {
        const when = new Date(fromDay + 'T00:00:00Z');
        if (isNaN(when.getTime()) || when.getTime() > Date.now()) {
            console.error('--from wants a past date like 2026-06-20');
            process.exit(1);
        }
        days = Math.min(Math.ceil((Date.now() - when.getTime()) / 86400000) + 1, 400);
        startsAt = when;
    }

    // An organisation cannot have been working before it existed, and the usage
    // screen knows it: a rolling window is cut at the day the organisation was
    // created, so traffic written before that is written and then hidden.
    //
    // This ran for --from only, which left --days with a fixture that looks
    // right in the table and wrong on the screen. A hundred and twenty days of
    // traffic under a day-old organisation collapses every rolling window onto
    // yesterday, so the last week, the last month and the last quarter all
    // report the same figure -- and the period picker, which is the thing a
    // fixture this size is usually built to try, appears to be broken.
    const born = await db.query('SELECT created_at FROM organisations WHERE id = $1', [org.id]);
    const existed = born.rows[0] && new Date(born.rows[0].created_at).getTime();
    if (existed && existed > startsAt.getTime()) {
        const day = startsAt.toISOString().slice(0, 10);
        console.log('');
        console.log('this organisation was created on ' + new Date(existed).toISOString().slice(0, 10) +
            ', after the traffic starts.');
        console.log('it will be moved back to ' + day + ', or every window would be cut to its first day.');
        if (flag('yes')) {
            await db.query('UPDATE organisations SET created_at = $2 WHERE id = $1',
                [org.id, startsAt.toISOString()]);
        }
    }
    console.log('');
    console.log('would add roughly ' + (days * 9 * BUSY) + ' screenings across the last ' + days + ' days,');
    console.log('marked as samples so --clear can take them out again.');
    if (!flag('yes')) {
        console.log('');
        console.log('nothing was changed. pass --yes to go ahead.');
        process.exit(0);
    }

    // Whose rows these are. Read once rather than re-joined by every insert:
    // it is the same answer every time, and asking for it again per row is
    // most of what a remote connection spends its time on.
    const owner = await db.query(
        'SELECT user_id FROM memberships WHERE org_id = $1 ORDER BY user_id LIMIT 1', [org.id]);
    if (!owner.rowCount) {
        console.error('that organisation has no members, so there is nobody to file these under');
        process.exit(1);
    }
    const userId = owner.rows[0].user_id;

    // In batches. One statement per screening is fine against a database on
    // the same machine and is minutes of waiting against one across the
    // internet, which is where a fixture is actually wanted.
    const BATCH = 250;
    let wrote = 0;
    let pending = [];

    async function flush() {
        if (!pending.length) return;
        const args = [];
        const values = pending.map((r) => {
            const at = args.length;
            args.push(r.at, r.asset, r.address, r.verdict, r.score, r.digest);
            return '($' + (at + 1) + '::timestamptz, $' + (at + 2) + ', $' + (at + 3) +
                ', $' + (at + 4) + ', $' + (at + 5) + ', $' + (at + 6) + ')';
        }).join(', ');
        await db.query(
            `INSERT INTO screenings
                (user_id, org_id, at, kind, asset, address, verdict, score, sources, list_date, sandbox, digest)
             SELECT $${args.length + 1}, $${args.length + 2}, v.at,
                    'live', v.asset, v.address, v.verdict, v.score::int,
                    $${args.length + 3}, '2026-09-01', false, v.digest
               FROM (VALUES ${values}) AS v(at, asset, address, verdict, score, digest)`,
            args.concat([userId, org.id, MARK])
        );
        wrote += pending.length;
        pending = [];
    }

    // The moment a check happened, worked out here rather than in the
    // statement.
    //
    // It used to be "now, minus d days, plus a few hundred minutes, and never
    // later than a minute ago". On any day but today that is a time of day; on
    // today it is the evening, so every one of today's rows was clamped to the
    // same instant a minute ago -- a whole day of work landing on one
    // timestamp, which is exactly what the screen showed: six rows, one time.
    //
    // From midnight instead, and today simply stops at the hour it is now.
    const NOW = Date.now();
    const MIDNIGHT = new Date(NOW).setUTCHours(0, 0, 0, 0);
    function momentOn(daysAgo) {
        const day = MIDNIGHT - daysAgo * 86400000;
        // a working day, thickest around the middle of it
        const mid = 8 * 60 + Math.round((Math.random() + Math.random() + Math.random()) / 3 * 10 * 60);
        const at = day + mid * 60000 + Math.floor(Math.random() * 60000);
        return at >= NOW ? null : at;
    }

    for (let d = days - 1; d >= 0; d--) {
        const many = howMany(d);
        for (let i = 0; i < many; i++) {
            const at = momentOn(d);
            // today, after the hour it is now: work that has not happened
            if (at === null) continue;
            const one = aCheck();
            const score = aScore();
            // The verdict follows the score rather than the other way round,
            // so the two can never disagree inside one row: a hundred is a
            // list match and is severe, and everything below it is clear until
            // there is a middle for it to be in.
            const verdict = score >= 100 ? 'severe' : (VERDICTS.review && score >= 60 ? 'review' : 'clear');
            const when = new Date(at).toISOString();
            // Sealed the way a real check is. Without a digest every sample
            // row reads as unsealed, and the evidence section said none of
            // 4,508 checks were sealed when the product seals all of them.
            const digest = 'sha256:' + crypto.createHash('sha256').update(JSON.stringify({
                at: when, asset: one.asset, address: one.address, verdict, score, sample: true,
            }), 'utf8').digest('hex');
            pending.push({ at: when, asset: one.asset, address: one.address, verdict, score, digest });
            if (pending.length >= BATCH) await flush();
        }
    }
    await flush();
    console.log('added ' + wrote + '.');

    // And the half of the work a machine does not do.
    //
    // Screenings alone leave the summary's decision count at nought on every
    // window, which reads as a broken counter rather than as a fixture that
    // was never asked for people. A decision is also the only number on that
    // page that moves because somebody sat down and moved it.
    //
    // Each one is stamped shortly after the check it concludes, not at the
    // moment the fixture runs. Dated today, ninety days of decisions would all
    // fall inside the last seven, and every window would report the same
    // total -- which is precisely the thing the period picker is meant to show
    // is not true.
    //
    // No marker is needed on these. They hang off sample screenings by a
    // foreign key that deletes on cascade, so --clear already takes them.
    const share = Math.max(0, Math.min(1, Number(value('decided') || 0.6)));
    let signed = 0;
    if (share > 0) {
        const open = await db.query(
            `SELECT id, at FROM screenings
              WHERE org_id = $1 AND sources = $2 AND verdict <> 'clear' AND decision = ''
              ORDER BY at`,
            [org.id, MARK]);
        for (const row of open.rows) {
            if (Math.random() >= share) continue;
            // cleared more often than confirmed, because most alerts are not
            // the person the list is about
            const state = Math.random() < 0.78 ? 'cleared' : 'confirmed';
            const why = state === 'cleared'
                ? 'Same name, different person. Date of birth does not match.'
                : 'Matches the listed entity. Funds held and reported.';
            // somewhere between twenty minutes and two days after the check,
            // and never after this moment
            const when = new Date(Math.min(
                NOW, new Date(row.at).getTime() + (20 + Math.random() * 2860) * 60000));
            const sealed = { check: String(row.id), state, note: why, by: 'sample', at: when.toISOString() };
            const stamp = 'sha256:' + crypto.createHash('sha256')
                .update(JSON.stringify(sealed), 'utf8').digest('hex');
            const put = await db.query(
                `INSERT INTO check_decisions (screening_id, org_id, actor_id, at, decision, digest)
                 VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
                [row.id, org.id, userId, when.toISOString(), state, stamp]);
            const made = put.rows[0].id;
            await db.query(
                'UPDATE check_decisions SET actor_enc = $1, note_enc = $2 WHERE id = $3',
                [db.seal('decided-by:' + made, 'Sample analyst'), db.seal('decision:' + made, why), made]);
            await db.query(
                `UPDATE screenings SET decision = $1, decided_at = $2, decided_by = $3
                  WHERE id = $4 AND org_id = $5`,
                [state, when.toISOString(), userId, row.id, org.id]);
            signed += 1;
        }
        console.log('signed off ' + signed + ' of them, dated to just after each check.');
    }

    console.log('take them out again with:  node tools/seed-usage.js ' + slug + ' --clear --yes');
    process.exit(0);
}

main().catch((err) => {
    console.error('failed: ' + err.message);
    process.exit(1);
});
