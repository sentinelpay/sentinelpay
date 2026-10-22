'use strict';

// One step of rotation.test.js, in a process of its own, because the keys are
// read when db.js loads and each step needs different ones.

process.env.BREACH_CHECK = 'false';

const db = require('../db');
const accounts = require('../accounts');
const orgs = require('../orgs');
const projects = require('../projects');
const invites = require('../invites');
const billing = require('../billing');
const tokens = require('../tokens');
const screening = require('../screening');
const trial = require('../trial');

async function boot() {
    for (const step of [db.init, accounts.init, orgs.init, projects.init, invites.init,
        billing.init, tokens.adopt, screening.adopt, trial.adopt]) await step();
}

async function codeFor(emailHash) {
    const row = await db.query('SELECT code_hash FROM signup_codes WHERE email_hash = $1', [emailHash]);
    for (let i = 0; i < 1000000; i++) {
        const guess = String(i).padStart(6, '0');
        if (db.indexHash('signup-code:' + emailHash + ':' + guess) === row.rows[0].code_hash) return guess;
    }
    throw new Error('no code matched');
}

async function seed() {
    const email = 'Rotation.Owner@Primjer.hr';
    const password = 'a-very-long-password-1';
    const started = await accounts.startSignup({ email, name: 'Ana Anic', password, lang: 'en', flags: [] });
    await accounts.verifySignup(email, await codeFor(db.blindIndex(email)), started.origin);
    const signed = await accounts.signIn(email, password);
    await accounts.signIn(email, 'not-the-password');
    const userId = signed.userId;
    const org = (await orgs.create(userId, 'Rotation', 'localhost', 'owner')).org;
    const api = (await tokens.mint(userId, org.id, 'key', ['screenings:read'], 30, 'live')).token;
    const inv = await invites.create(org.id, userId, { email: 'pozvana@primjer.hr', role: 'analyst', days: 7, needMfa: false, lang: 'en' });
    await db.query('INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1, $2)',
        [userId, db.indexHash('recovery:' + userId + ':1234567890')]);
    const phone = '+385 91 000 0000';
    await db.query(`INSERT INTO trials (org_id, user_id, state, phone_hash, phone_enc) VALUES ($1, $2, 'verified', $3, $4)`,
        [org.id, userId, db.blindIndex(phone), db.seal('trial-phone:' + org.id, phone)]);
    // a sign-up nobody finished, which the rotation drops
    await accounts.startSignup({ email: 'half@primjer.hr', name: 'Half', password, lang: 'en', flags: [] });
    await new Promise((r) => setTimeout(r, 300));
    return { email, password, userId, orgId: org.id, session: signed.session.token, api, invite: inv.secret, phone };
}

async function check(ctx) {
    const rows = async (sql, args) => (await db.query(sql, args || [])).rows;
    // read before signing in, which adds to the trail and clears the failures
    const before = {
        user: (await rows('SELECT email_hash FROM users WHERE id = $1', [ctx.userId]))[0].email_hash,
        subjects: (await rows("SELECT DISTINCT subject FROM audit_events WHERE subject ~ '^[0-9a-f]{64}$'")).map((r) => r.subject),
        fails: (await rows('SELECT email_hash FROM login_fails')).map((r) => r.email_hash),
        signups: (await rows('SELECT email_hash FROM signup_codes')).map((r) => r.email_hash),
        phone: (await rows('SELECT phone_hash FROM trials WHERE org_id = $1', [ctx.orgId]))[0].phone_hash,
        recovery: (await rows('SELECT code_hash FROM recovery_codes WHERE user_id = $1', [ctx.userId]))[0].code_hash,
    };
    const invite = await invites.read(ctx.invite);
    return Object.assign(before, {
        signIn: Boolean((await accounts.signIn(ctx.email, ctx.password)).ok),
        session: Boolean(await accounts.readSession(ctx.session)),
        api: Boolean((await tokens.read(ctx.api)).ok),
        invite: invite ? invite.email : null,
        recoveryAccepted: db.indexHashes('recovery:' + ctx.userId + ':1234567890').indexOf(before.recovery) !== -1,
        live: db.keys().live.equals(db.keys().index) ? 'index' : 'previous',
        // signing in cleared the failures; one more, for the next step to find
        wrong: (await accounts.signIn(ctx.email, 'not-the-password')).reason,
    });
}

(async () => {
    await boot();
    const mode = process.argv[2];
    const out = mode === 'seed' ? await seed() : await check(JSON.parse(process.env.ROTATION_CTX));
    process.stdout.write('RESULT ' + JSON.stringify(out) + '\n');
    await db.close();
    process.exit(0);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
