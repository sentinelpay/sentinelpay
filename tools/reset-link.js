'use strict';

// Issues a password reset link for an account, and prints it.
//
// The product only ever hands a reset link out by email. Staging has no mail
// provider, so on staging nobody can get back into an account they are locked
// out of. This writes the same row the normal path writes -- same table, same
// hashed token, same expiry -- and prints the link instead of mailing it. It
// is not a second way in: it needs the database and the data key, which is to
// say it needs what an operator already has.
//
//   DATABASE_URL=... SUBMISSIONS_KEY=... node tools/reset-link.js you@example.com --site https://staging.sentinelpay.org
//
// The link is single use and expires. Whoever opens it chooses the password,
// so no password is ever typed into a terminal, a chat or a log.
//
// It refuses to run against production, because on production the email works
// and that is the path that should be used.
//
// On staging it can also let somebody in who has no account yet. Signing up
// sends a code by email, which staging cannot do, so a new colleague could
// not get an account of their own there at all. With --create the same link
// is issued for an address nobody has; opening it asks for a name and a
// password and makes the account, the way the reset page already does for an
// address it does not know. Only where the database is marked staging:
//
//   railway run --environment staging node tools/reset-link.js them@example.com --create --site https://staging.sentinelpay.org

const path = require('path');
const db = require(path.join(__dirname, '..', 'api', 'db.js'));
const accounts = require(path.join(__dirname, '..', 'api', 'accounts.js'));

const args = process.argv.slice(2);
const value = (name) => {
    const at = args.indexOf('--' + name);
    return at === -1 ? '' : (args[at + 1] || '');
};
const TAKES_VALUE = ['--site', '--lang'];
const plain = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && TAKES_VALUE.indexOf(args[i - 1]) !== -1));
const email = (plain[0] || '').trim();

(async () => {
    if (!email) {
        console.error('usage: node tools/reset-link.js <email> [--create] [--site https://staging.sentinelpay.org] [--lang hr]');
        process.exit(1);
    }
    // Staging runs with NODE_ENV=production too, for the secure cookie it
    // needs behind https, so that alone does not say this is production:
    // APP_ENV does.
    if (!db.available()) {
        console.error('no DATABASE_URL, nothing to do');
        process.exit(1);
    }
    // A working reset link for any account, printed without an email, is
    // for staging only, and the database says whether it is: in production
    // the reset email works, so use it.
    const staging = (await require('../api/app-env.js').requireTarget(db, ['staging', 'development'], 'reset-link')) === 'staging';

    const site = (value('site') || process.env.SITE_URL || '').replace(/\/+$/, '');
    if (!site) {
        console.error('no --site and no SITE_URL, so the link cannot be built.');
        console.error('pass the site the database belongs to, e.g. --site https://staging.sentinelpay.org');
        process.exit(1);
    }

    // The public endpoint deliberately answers the same way whether or not the
    // address has an account, so that it cannot be used to find out who has
    // one. That is right there and wrong here: finishReset() creates an account
    // when none exists, so a typo would quietly make a second, empty one rather
    // than let you back into the one you meant.
    const hash = db.blindIndex(email);
    if (!hash) {
        console.error('SUBMISSIONS_KEY is not set, so the account cannot be looked up by email');
        process.exit(1);
    }
    const who = await db.query('SELECT id FROM users WHERE email_hash = $1', [hash]);
    const create = args.includes('--create');
    if (!who.rowCount && !(create && staging)) {
        console.error('no account with that address in this database.');
        console.error('check the address, and check that DATABASE_URL and SUBMISSIONS_KEY are the pair this site runs on:');
        console.error('a mismatched key hashes the address to something nobody has.');
        if (create) console.error('--create only works on a database marked staging.');
        else console.error('to let a new colleague make an account on staging, add --create.');
        process.exit(1);
    }

    const started = await accounts.startReset(email, value('lang') || 'hr');
    if (!started.ok) {
        if (started.reason === 'rate') {
            console.error('a link was issued for this address a moment ago; the next one can be issued in ' +
                started.retryIn + 's.');
            console.error('that earlier link is still the valid one -- issuing this replaces it.');
        } else {
            console.error('could not issue a link (' + started.reason + ')');
        }
        process.exit(1);
    }

    console.log('account   ' + (who.rowCount ? who.rows[0].id : 'none yet: opening the link makes one, asking for a name and a password'));
    console.log('expires   in ' + started.expiresInMin + ' minutes');
    console.log('');
    console.log(site + '/reset-password?token=' + encodeURIComponent(started.token));
    console.log('');
    console.log('single use. opening it asks for a new password; 2FA, if it is on, still applies at sign in.');
    process.exit(0);
})().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
