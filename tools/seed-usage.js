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
//   DATABASE_URL=... node tools/seed-usage.js <org-slug> [--days 45] [--yes]
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
const TAKES_VALUE = ['--days', '--from'];
const plain = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && TAKES_VALUE.indexOf(args[i - 1]) !== -1));
const slug = plain[0];

const ASSETS = ['XBT', 'ETH', 'TRX', 'SOL', 'LTC'];

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
    return Math.max(0, Math.round(base + (Math.random() - 0.35) * swing));
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
    console.log('would add roughly ' + (days * 9) + ' screenings across the last ' + days + ' days,');
    console.log('marked as samples so --clear can take them out again.');
    if (!flag('yes')) {
        console.log('');
        console.log('nothing was changed. pass --yes to go ahead.');
        process.exit(0);
    }

    let wrote = 0;
    for (let d = days - 1; d >= 0; d--) {
        const many = howMany(d);
        for (let i = 0; i < many; i++) {
            // a few of them come back as something worth looking at, in the
            // proportion a real book of business tends to
            const roll = Math.random();
            const verdict = roll < 0.05 ? 'severe' : (roll < 0.14 ? 'review' : 'clear');
            await db.query(
                `INSERT INTO screenings
                    (user_id, org_id, at, kind, asset, address, verdict, score, sources, list_date, sandbox)
                 SELECT m.user_id, $1,
                        now() - ($2 || ' days')::interval + ($3 || ' minutes')::interval,
                        'live', $4, $5, $6, $7, $8, '2026-09-01', false
                   FROM memberships m WHERE m.org_id = $1 ORDER BY m.user_id LIMIT 1`,
                [org.id, String(d), String(Math.floor(Math.random() * 600) + 480),
                 pick(ASSETS), 'sample-' + d + '-' + i, verdict, verdict === 'clear' ? 0 : 60 + Math.floor(Math.random() * 40),
                 MARK]
            );
            wrote++;
        }
    }
    console.log('added ' + wrote + '.');
    console.log('take them out again with:  node tools/seed-usage.js ' + slug + ' --clear --yes');
    process.exit(0);
}

main().catch((err) => {
    console.error('failed: ' + err.message);
    process.exit(1);
});
