'use strict';

// Takes two-factor off an account whose owner has lost every device with an
// authenticator app on it.
//
// There are no recovery codes. The security page asks for a second app while
// there is only one, and a person who added two can sign in with either. One
// who lost them all writes to support, and this is what support runs once it
// is satisfied the person writing is the person who owns the account: on a
// call, from the address on the account, and, for anyone who is not the
// owner of their organisation, confirmed by that owner. Without it a lost
// phone would be a lost account, and there would be no way back in at all.
//
//   DATABASE_URL=... SUBMISSIONS_KEY=... node tools/remove-2fa.js them@example.com
//   DATABASE_URL=... SUBMISSIONS_KEY=... node tools/remove-2fa.js them@example.com --yes --why "ticket 1042, call with owner"
//
// Without --yes it says what it would do and does nothing. With it, every app
// comes off the account, two-factor is off, every session the account has is
// ended, and the audit trail gets a line saying it was done by hand and why.
// The person signs in with their password and adds an app again.
//
// It runs against production: that is where people lose phones.

const path = require('path');
const db = require(path.join(__dirname, '..', 'api', 'db.js'));
const accounts = require(path.join(__dirname, '..', 'api', 'accounts.js'));

const args = process.argv.slice(2);
const value = (name) => {
    const at = args.indexOf('--' + name);
    return at === -1 ? '' : (args[at + 1] || '');
};
const TAKES_VALUE = ['--why'];
const plain = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && TAKES_VALUE.indexOf(args[i - 1]) !== -1));
const email = (plain[0] || '').trim();
const yes = args.includes('--yes');
const why = value('why').trim();

(async () => {
    if (!email) {
        console.error('usage: node tools/remove-2fa.js <email> [--yes --why "what was checked, and how"]');
        process.exit(1);
    }
    if (!db.available()) {
        console.error('no DATABASE_URL, nothing to do');
        process.exit(1);
    }
    const hash = db.blindIndex(email);
    if (!hash) {
        console.error('SUBMISSIONS_KEY is not set, so the account cannot be looked up by email');
        process.exit(1);
    }
    const who = await db.query('SELECT id, totp_at FROM users WHERE email_hash = $1', [hash]);
    if (!who.rowCount) {
        console.error('no account with that address in this database.');
        console.error('(or DATABASE_URL and SUBMISSIONS_KEY are not the pair this site runs on: the address is');
        console.error(' stored hashed, and the wrong key hashes it to an account nobody has.)');
        process.exit(1);
    }
    const user = who.rows[0];
    const apps = await accounts.listFactors(user.id);
    if (!user.totp_at && !apps.length) {
        console.log('two-factor is already off for this account; nothing to do.');
        process.exit(0);
    }
    console.log('account ' + user.id + ': two-factor on since ' + (user.totp_at ? new Date(user.totp_at).toISOString().slice(0, 10) : '?') +
        ', ' + apps.length + ' app' + (apps.length === 1 ? '' : 's') + ':');
    apps.forEach((a) => console.log('  - ' + (a.name || 'Authenticator app') + ', added ' +
        new Date(a.createdAt).toISOString().slice(0, 10) + (a.usedAt ? ', last used ' + new Date(a.usedAt).toISOString().slice(0, 10) : '')));
    if (!yes) {
        console.log('');
        console.log('nothing done. to take two-factor off and end every session, run it again with');
        console.log('  --yes --why "what you checked to be sure this is the owner"');
        process.exit(0);
    }
    if (!why) {
        console.error('--why is needed with --yes: the audit trail says why two-factor was taken off by hand.');
        process.exit(1);
    }
    await accounts.clearFactors(user.id);
    await db.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
    accounts.audit('2fa-off-by-support', { actor: user.id, subject: hash, detail: why.slice(0, 200) });
    console.log('done: two-factor is off and every session is ended. they sign in with their password and add an app again.');
    // the audit write is not awaited by its caller; give it a moment to land
    setTimeout(() => process.exit(0), 500);
})().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
