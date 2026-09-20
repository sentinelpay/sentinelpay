'use strict';

// Puts an account's organisations back to having no plan, so opening one sends
// it to /choose-a-plan again.
//
// A plan belongs to an organisation, so this clears every organisation the
// address is a member of. That is what you want on staging: one person, their
// own companies, all back to the start.
//
// It refuses to run against production, and it will not change anything unless
// you pass --yes. Without that it prints what it would do and stops.
//
//   DATABASE_URL=... node tools/reset-plan.js you@example.com
//   DATABASE_URL=... node tools/reset-plan.js you@example.com --yes
//
// The email is not stored anywhere in readable form, so it cannot be found with
// a LIKE query: the users table keeps a keyed hash of it. This hashes what you
// type with the same key and looks that up, which is why SP_INDEX_KEY has to be
// the one the environment uses. Get that wrong and it simply finds nobody.
//
// One thing this cannot do on its own: if the address is still in
// DEV_PLAN_EMAILS, the next dashboard load grants enterprise straight back,
// because the grant is re-applied on every visit. Take it out of that variable
// first. This says so rather than letting you wonder.

const db = require('../api/db.js');

const args = process.argv.slice(2);
const GO = args.includes('--yes');
const email = args.filter((a) => !a.startsWith('--'))[0];

const DEV_PLAN_EMAILS = String(process.env.DEV_PLAN_EMAILS || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

async function main() {
    if (!email) {
        console.error('usage: node tools/reset-plan.js <email> [--yes]');
        process.exit(1);
    }
    if (!db.available()) {
        console.error('no DATABASE_URL, nothing to do');
        process.exit(1);
    }
    if (process.env.NODE_ENV === 'production' && !process.env.RESET_PLAN_I_MEAN_IT) {
        console.error('refusing to run against production');
        process.exit(1);
    }

    const hash = db.blindIndex(email);
    if (!hash) {
        console.error('SP_INDEX_KEY is not set, so the account cannot be looked up by email');
        process.exit(1);
    }

    const who = await db.query('SELECT id FROM users WHERE email_hash = $1', [hash]);
    if (!who.rowCount) {
        console.error('no account with that address in this database');
        process.exit(1);
    }
    const userId = who.rows[0].id;

    const found = await db.query(
        `SELECT o.id, o.name, m.role, t.state, t.note
           FROM memberships m
           JOIN organisations o ON o.id = m.org_id
      LEFT JOIN trials t ON t.org_id = o.id
          WHERE m.user_id = $1
       ORDER BY o.created_at`,
        [userId]
    );

    console.log('account      ' + userId);
    if (!found.rowCount) {
        console.log('');
        console.log('this account is in no organisation, so it has no plan to reset.');
        process.exit(0);
    }
    found.rows.forEach((r) => {
        console.log('  ' + String(r.name || '(unnamed)').padEnd(24) +
            (r.state || 'none') + (r.note ? '  (' + r.note + ')' : ''));
    });
    console.log('would set    none, on ' + found.rowCount + ' organisation(s)');

    const stillGranted = DEV_PLAN_EMAILS.indexOf(String(email).trim().toLowerCase()) !== -1;
    if (stillGranted) {
        console.log('');
        console.log('WARNING: this address is in DEV_PLAN_EMAILS. Resetting it here will not');
        console.log('         hold, because the grant is re-applied on every dashboard load.');
        console.log('         Remove it from that variable and restart the app first.');
    }

    if (!GO) {
        console.log('');
        console.log('nothing was changed. pass --yes to go ahead.');
        process.exit(0);
    }

    await db.query(
        `UPDATE trials
            SET state = 'none',
                company_host = '',
                company_enc = '',
                live_used = 0,
                history_used = 0,
                started_at = NULL,
                expires_at = NULL,
                verified_at = NULL,
                requested_at = NULL,
                note = 'reset for dev',
                updated_at = now()
          WHERE org_id IN (SELECT org_id FROM memberships WHERE user_id = $1)`,
        [userId]
    );

    console.log('');
    console.log('done. opening any of those organisations now goes to /choose-a-plan.');
    if (stillGranted) {
        console.log('but see the warning above: take the address out of DEV_PLAN_EMAILS or');
        console.log('this comes straight back.');
    }
    process.exit(0);
}

main().catch((err) => {
    console.error('failed: ' + err.message);
    process.exit(1);
});
