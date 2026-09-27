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
//   DATABASE_URL=... node tools/seed-usage.js <org-slug> --from 2026-06-20 [--yes]
//   DATABASE_URL=... node tools/seed-usage.js <org-slug> --clear [--yes]
//   DATABASE_URL=... node tools/seed-usage.js <org-slug> --show

const db = require('../api/db.js');

// the marker lives in a column the product already has and never sets itself,
// so finding these rows later is a plain equality rather than a guess
const MARK = 'sample';

const args = process.argv.slice(2);
const flag = (name) => args.includes('--' + name);
const value = (name) => {
    const at = args.indexOf('--' + name);
    return at === -1 ? '' : (args[at + 1] || '');
};
const TAKES_VALUE = ['--days', '--from', '--busy'];
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
function anAddress() {
    const hot = Math.random() < 0.6;
    const n = hot
        ? Math.floor(Math.random() * (POOL / 3))
        : Math.floor(Math.random() * POOL);
    return 'sample-addr-' + n;
}

function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
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
    if (fromDay) {
        const when = new Date(fromDay + 'T00:00:00Z');
        if (isNaN(when.getTime()) || when.getTime() > Date.now()) {
            console.error('--from wants a past date like 2026-06-20');
            process.exit(1);
        }
        days = Math.min(Math.ceil((Date.now() - when.getTime()) / 86400000) + 1, 400);

        // An organisation cannot have been working before it existed, and the
        // usage screen knows it: a rolling window is cut at the day the
        // organisation was created, so traffic written before that would be
        // written and then hidden. The fixture is made whole instead.
        const born = await db.query('SELECT created_at FROM organisations WHERE id = $1', [org.id]);
        const existed = born.rows[0] && new Date(born.rows[0].created_at).getTime();
        if (existed && existed > when.getTime()) {
            console.log('');
            console.log('this organisation was created on ' + new Date(existed).toISOString().slice(0, 10) +
                ', after the date asked for.');
            console.log('it will be moved back to ' + fromDay + ' so the traffic is not hidden.');
            if (flag('yes')) {
                await db.query('UPDATE organisations SET created_at = $2 WHERE id = $1',
                    [org.id, when.toISOString()]);
            }
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
            args.push(String(r.d), String(r.minute), r.asset, r.address, r.verdict, r.score);
            return '($' + (at + 1) + ', $' + (at + 2) + ', $' + (at + 3) + ', $' + (at + 4) +
                ', $' + (at + 5) + ', $' + (at + 6) + ')';
        }).join(', ');
        await db.query(
            `INSERT INTO screenings
                (user_id, org_id, at, kind, asset, address, verdict, score, sources, list_date, sandbox)
             SELECT $${args.length + 1}, $${args.length + 2},
                    -- never later than this moment. the offset within the day
                    -- is added to a day that has already happened, and on
                    -- today that lands in the evening, so a fixture was
                    -- quietly writing screenings that had not happened yet --
                    -- which every count over a running period then disagreed
                    -- about, depending on where it stopped.
                    least(now() - (v.d || ' days')::interval + (v.minute || ' minutes')::interval,
                          now() - interval '1 minute'),
                    'live', v.asset, v.address, v.verdict, v.score::int,
                    $${args.length + 3}, '2026-09-01', false
               FROM (VALUES ${values}) AS v(d, minute, asset, address, verdict, score)`,
            args.concat([userId, org.id, MARK])
        );
        wrote += pending.length;
        pending = [];
    }

    for (let d = days - 1; d >= 0; d--) {
        const many = howMany(d);
        for (let i = 0; i < many; i++) {
            // a few of them come back as something worth looking at, in the
            // proportion a real book of business tends to
            const roll = Math.random();
            const verdict = roll < 0.05 ? 'severe' : (roll < 0.14 ? 'review' : 'clear');
            pending.push({
                d,
                minute: Math.floor(Math.random() * 600) + 480,
                asset: pick(ASSETS),
                address: anAddress(),
                verdict,
                score: verdict === 'clear' ? 0 : 60 + Math.floor(Math.random() * 40),
            });
            if (pending.length >= BATCH) await flush();
        }
    }
    await flush();
    console.log('added ' + wrote + '.');
    console.log('take them out again with:  node tools/seed-usage.js ' + slug + ' --clear --yes');
    process.exit(0);
}

main().catch((err) => {
    console.error('failed: ' + err.message);
    process.exit(1);
});
