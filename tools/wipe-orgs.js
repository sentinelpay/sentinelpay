'use strict';

// Removes every organisation and membership, for starting an environment over.
//
// It refuses to run against production, and it will not do anything at all
// unless you pass --yes. Without that it prints what it would remove and stops,
// because the thing it deletes cannot be got back.
//
//   DATABASE_URL=... node tools/wipe-orgs.js          # says what it would do
//   DATABASE_URL=... node tools/wipe-orgs.js --yes    # does it
//
// Tokens and checks are not deleted. They are let go of instead: their org_id
// is cleared first, so the rows survive and can join whichever organisation
// their owner makes next. A token left that way stops working until a new one
// is issued, which is the honest outcome of removing the organisation it
// belonged to.

const db = require('../api/db.js');

const GO = process.argv.includes('--yes');

async function main() {
    if (!db.available()) {
        console.error('no DATABASE_URL, nothing to do');
        process.exit(1);
    }
    if (process.env.NODE_ENV === 'production' && !process.env.WIPE_ORGS_I_MEAN_IT) {
        console.error('refusing to run against production');
        process.exit(1);
    }

    const counts = await db.query(`
        SELECT
          (SELECT count(*)::int FROM organisations) AS orgs,
          (SELECT count(*)::int FROM memberships) AS members,
          (SELECT count(*)::int FROM api_tokens WHERE org_id IS NOT NULL) AS tokens,
          (SELECT count(*)::int FROM screenings WHERE org_id IS NOT NULL) AS checks
    `);
    const n = counts.rows[0];

    const named = await db.query('SELECT name, host, created_at FROM organisations ORDER BY created_at');
    named.rows.forEach((r) => {
        console.log('  ' + (r.name || '(unnamed)') + (r.host ? '  ' + r.host : '') +
            '  ' + new Date(r.created_at).toISOString().slice(0, 10));
    });

    console.log('');
    console.log('would delete   ' + n.orgs + ' organisation(s) and ' + n.members + ' membership(s)');
    console.log('would let go   ' + n.tokens + ' token(s) and ' + n.checks + ' check(s), which stay but lose their organisation');

    if (!GO) {
        console.log('');
        console.log('nothing was changed. pass --yes to go ahead.');
        process.exit(0);
    }

    await db.query('UPDATE api_tokens SET org_id = NULL WHERE org_id IS NOT NULL');
    await db.query('UPDATE screenings SET org_id = NULL WHERE org_id IS NOT NULL');
    await db.query('DELETE FROM memberships');
    await db.query('DELETE FROM organisations');
    console.log('');
    console.log('done. every account will be asked to make an organisation next time it signs in.');
    process.exit(0);
}

main().catch((err) => {
    console.error('failed: ' + err.message);
    process.exit(1);
});
