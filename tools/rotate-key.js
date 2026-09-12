'use strict';

// Re-encrypt everything under a new key.
//
// How a rotation goes:
//
//   1. generate a key:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
//   2. on the host, set SUBMISSIONS_KEY_PREVIOUS to the key that is in
//      SUBMISSIONS_KEY today, and put the new key in SUBMISSIONS_KEY
//   3. restart. nothing breaks: rows written under the old key are still read,
//      because db.js tries the current key and then the previous one
//   4. run this, with the same two variables set:
//          node tools/rotate-key.js            # says what it would do
//          node tools/rotate-key.js --write    # does it
//   5. when it reports nothing left, remove SUBMISSIONS_KEY_PREVIOUS
//
// The blind index is not touched. It is keyed by SUBMISSIONS_INDEX_KEY, which is
// a different key on purpose and rotating it would mean every lookup by address
// stops working until every row is rewritten in the same instant. If that key
// ever has to change, it is a different and much more careful job than this one.
//
// Safe to run twice, safe to stop halfway: a row that is already under the new
// key is written back identically, and one that is not is fixed the next time.

const path = require('path');
const db = require(path.join(__dirname, '..', 'api', 'db.js'));

const WRITE = process.argv.includes('--write');

// what to rewrite: a table, its key column, and the sealed columns with the
// label each one was sealed under
const WORK = [
    {
        table: 'submissions',
        id: 'id',
        // the submissions payload is sealed to the row id
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

    for (const job of WORK) {
        const cols = job.columns.map((c) => c.column);
        const select = [job.id].concat(job.extra || [], cols).filter((v, i, a) => a.indexOf(v) === i);
        let rows;
        try {
            rows = await db.query(
                'SELECT ' + select.join(', ') + ' FROM ' + job.table +
                (job.where ? ' WHERE ' + job.where : ''), []);
        } catch (err) {
            // a table that does not exist yet is not an error: the schema is
            // created on boot by whichever module owns it
            console.log('  ' + job.table + ': skipped (' + err.message + ')');
            continue;
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
                    // neither key opened it. that is a row written under a key
                    // that is gone, and this tool must never quietly replace it
                    // with an empty string.
                    unreadable++;
                    continue;
                }
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

    console.log(touched + ' row(s) ' + (WRITE ? 'rewritten' : 'to rewrite'));
    if (unreadable) {
        console.error(unreadable + ' value(s) could not be opened with either key and were left alone.');
        console.error('That is data written under a key neither variable holds. Find that key before dropping anything.');
    }
    if (WRITE && !unreadable) {
        console.log('Done. Once this reports 0 rows, SUBMISSIONS_KEY_PREVIOUS can be removed.');
    }
    process.exit(unreadable ? 2 : 0);
}

main().catch((err) => {
    console.error('rotation failed: ' + err.message);
    process.exit(1);
});
