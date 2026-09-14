'use strict';

const path = require('path');
const db = require(path.join(__dirname, '..', 'api', 'db.js'));

const WRITE = process.argv.includes('--write');

const WORK = [
    {
        table: 'submissions',
        id: 'id',
        columns: [{ column: 'payload', label: (row) => 'submission:' + row.id }],
        where: 'encrypted = true',
    },
    {
        table: 'users',
        id: 'id',
        columns: [
            { column: 'email_enc', label: (row) => 'signup-email:' + row.email_hash },
            { column: 'name_enc', label: (row) => 'signup-name:' + row.email_hash },
            { column: 'totp_enc', label: (row) => 'totp:' + row.id },
        ],
        extra: ['email_hash'],
    },
    {
        table: 'signup_codes',
        id: 'email_hash',
        columns: [
            { column: 'email_enc', label: (row) => 'signup-email:' + row.email_hash },
            { column: 'name_enc', label: (row) => 'signup-name:' + row.email_hash },
        ],
        extra: ['email_hash'],
    },
    {
        table: 'reset_tokens',
        id: 'token_hash',
        columns: [{ column: 'email_enc', label: (row) => 'reset-email:' + row.email_hash }],
        extra: ['email_hash'],
    },
];

async function main() {
    if (!db.available()) {
        console.error('no DATABASE_URL: nothing to rotate');
        process.exit(1);
    }
    if (!db.rotating()) {
        console.error('SUBMISSIONS_KEY_PREVIOUS is not set. Set it to the old key and try again;');
        console.error('without it this would read nothing and write nothing.');
        process.exit(1);
    }
    console.log(WRITE ? 'rewriting rows under the current key' : 'dry run, nothing will be written');

    let touched = 0;
    let unreadable = 0;
    let stale = 0;

    for (const job of WORK) {
        const cols = job.columns.map((c) => c.column);
        const select = [job.id].concat(job.extra || [], cols).filter((v, i, a) => a.indexOf(v) === i);
        let rows;
        try {
            rows = await db.query(
                'SELECT ' + select.join(', ') + ' FROM ' + job.table +
                (job.where ? ' WHERE ' + job.where : ''), []);
        } catch (err) {
            if (err.code === '42P01') {
                console.log('  ' + job.table + ': not present yet, skipped');
                continue;
            }
            console.error('  ' + job.table + ': ' + err.message);
            throw err;
        }

        let n = 0;
        for (const row of rows.rows) {
            const sets = [];
            const args = [];
            for (const spec of job.columns) {
                const blob = row[spec.column];
                if (!blob) continue;
                const label = spec.label(row);
                const plain = db.open(label, blob);
                if (!plain) {
                    unreadable++;
                    continue;
                }
                if (!db.openCurrent(label, blob)) stale++;
                args.push(db.seal(label, plain));
                sets.push(spec.column + ' = $' + args.length);
            }
            if (!sets.length) continue;
            n++;
            if (!WRITE) continue;
            args.push(row[job.id]);
            await db.query(
                'UPDATE ' + job.table + ' SET ' + sets.join(', ') + ' WHERE ' + job.id + ' = $' + args.length,
                args
            );
        }
        console.log('  ' + job.table + ': ' + n + ' row(s)' + (WRITE ? ' rewritten' : ' would be rewritten'));
        touched += n;
    }

    console.log(touched + ' row(s) ' + (WRITE ? 'rewritten' : 'read'));
    console.log(stale + ' value(s) still under the previous key.');
    if (unreadable) {
        console.error(unreadable + ' value(s) could not be opened with either key and were left alone.');
        console.error('That is data written under a key neither variable holds. Find that key before dropping anything.');
    }
    if (!unreadable) {
        console.log(stale
            ? 'Not finished: run again with --write, then run without it to check.'
            : 'Finished: nothing is under the previous key, so SUBMISSIONS_KEY_PREVIOUS can be removed.');
    }
    process.exit(unreadable ? 2 : 0);
}

main().catch((err) => {
    console.error('rotation failed: ' + err.message);
    process.exit(1);
});
