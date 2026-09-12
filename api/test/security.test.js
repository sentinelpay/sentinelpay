'use strict';

// The tests that exist because these are the things that must not quietly break.
//
// Two halves. The first needs nothing but node and runs everywhere, including
// on a laptop with no database: the maths, the key handling, the address
// masking. The second needs a postgres and covers the flows, and it skips
// rather than fails when DATABASE_URL is not set, so `npm test` on a fresh
// clone still tells you something true.
//
// What is deliberately not here: anything that asserts on wording. A test that
// breaks when a sentence is reworded teaches people to stop running tests.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

process.env.SUBMISSIONS_KEY = process.env.SUBMISSIONS_KEY ||
    crypto.randomBytes(32).toString('base64');
// the breach check talks to the internet; the flow tests are not about it
process.env.BREACH_CHECK = 'false';

const totp = require('../totp');
const { ipKey } = require('../rate-store');
const db = require('../db');
const accounts = require('../accounts');

// ---------------------------------------------------------------------------
// one time passwords
// ---------------------------------------------------------------------------

test('totp matches the published test vectors', () => {
    // RFC 6238, appendix B: the ascii secret "12345678901234567890", sha-1.
    const secret = totp.base32Encode(Buffer.from('12345678901234567890', 'ascii'));
    assert.strictEqual(totp.codeFor(secret, Math.floor(59 / 30)), '287082');
    assert.strictEqual(totp.codeFor(secret, Math.floor(1111111109 / 30)), '081804');
    assert.strictEqual(totp.codeFor(secret, Math.floor(1234567890 / 30)), '005924');
});

test('totp accepts one step of drift and no more', () => {
    const secret = totp.newSecret();
    const now = Date.now();
    const step = Math.floor(now / 1000 / 30);
    assert.notStrictEqual(totp.checkCode(secret, totp.codeFor(secret, step), now), null);
    assert.notStrictEqual(totp.checkCode(secret, totp.codeFor(secret, step - 1), now), null);
    assert.notStrictEqual(totp.checkCode(secret, totp.codeFor(secret, step + 1), now), null);
    assert.strictEqual(totp.checkCode(secret, totp.codeFor(secret, step - 2), now), null);
    assert.strictEqual(totp.checkCode(secret, totp.codeFor(secret, step + 2), now), null);
});

test('totp refuses anything that is not six digits', () => {
    const secret = totp.newSecret();
    for (const bad of ['', '12345', '1234567', 'abcdef', null, undefined]) {
        assert.strictEqual(totp.checkCode(secret, bad), null);
    }
});

test('recovery codes are unique and readable', () => {
    const codes = totp.newRecoveryCodes(50);
    assert.strictEqual(new Set(codes).size, 50);
    for (const c of codes) assert.match(c, /^\d{5}-\d{5}$/);
});

// ---------------------------------------------------------------------------
// keys
// ---------------------------------------------------------------------------

test('a sealed value opens again, and only with its own label', () => {
    const blob = db.seal('label-a:1', 'ana@primjer.hr');
    assert.strictEqual(db.open('label-a:1', blob), 'ana@primjer.hr');
    // the label is authenticated, so the wrong one does not decrypt to
    // something else, it does not decrypt at all
    assert.strictEqual(db.open('label-b:1', blob), '');
});

test('ciphertext is not the plaintext, and is different every time', () => {
    const one = db.seal('x:1', 'ana@primjer.hr');
    const two = db.seal('x:1', 'ana@primjer.hr');
    assert.ok(!one.includes('ana@primjer.hr'));
    assert.notStrictEqual(one, two, 'the nonce should make every ciphertext different');
    assert.strictEqual(db.open('x:1', one), db.open('x:1', two));
});

test('the blind index is stable, keyed, and not reversible by shape', () => {
    const a = db.blindIndex('ANA@primjer.hr');
    const b = db.blindIndex('ana@primjer.hr ');
    assert.strictEqual(a, b, 'case and space must not change the index');
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.notStrictEqual(a, db.blindIndex('ana@primjer.de'));
});

// ---------------------------------------------------------------------------
// rate limit keys
// ---------------------------------------------------------------------------

test('ipv6 is counted by network and ipv4 by address', () => {
    assert.strictEqual(ipKey('1.2.3.4'), '1.2.3.4');
    assert.strictEqual(ipKey('::ffff:1.2.3.4'), '1.2.3.4');
    assert.strictEqual(ipKey('2a01:4f8:c17:b8f::1'), '2a01:4f8:c17:b8f::/64');
    assert.strictEqual(ipKey('2a01:4f8:c17:b8f:1:2:3:4'), '2a01:4f8:c17:b8f::/64');
    // two addresses in one /64 must land in the same bucket
    assert.strictEqual(ipKey('2a01:4f8:c17:b8f::dead'), ipKey('2a01:4f8:c17:b8f::beef'));
});

// ---------------------------------------------------------------------------
// passwords
// ---------------------------------------------------------------------------

test('a password verifies against its own hash and nothing else', async () => {
    const hash = await accounts.hashPassword('a-very-long-password-1');
    assert.ok(hash.startsWith('scrypt$'));
    assert.ok(!hash.includes('a-very-long-password-1'));
    assert.strictEqual(await accounts.verifyPassword('a-very-long-password-1', hash), true);
    assert.strictEqual(await accounts.verifyPassword('a-very-long-password-2', hash), false);
    assert.strictEqual(await accounts.verifyPassword('', hash), false);
});

test('a broken hash is a no, not a crash', async () => {
    for (const bad of ['', 'nonsense', 'scrypt$x$y$z$q$w', null]) {
        assert.strictEqual(await accounts.verifyPassword('anything', bad), false);
    }
});

// ---------------------------------------------------------------------------
// the flows, when there is a database to run them against
// ---------------------------------------------------------------------------

const haveDb = Boolean(process.env.DATABASE_URL);
const flow = { skip: haveDb ? false : 'no DATABASE_URL' };

// the code is never stored, so a test that wants to finish a sign-up has to
// find it the way an attacker would have to: by trying all million.
async function codeFor(emailHash) {
    const row = await db.query('SELECT code_hash FROM signup_codes WHERE email_hash = $1', [emailHash]);
    const target = row.rows[0].code_hash;
    for (let i = 0; i < 1000000; i++) {
        const guess = String(i).padStart(6, '0');
        const h = crypto.createHmac('sha256', db.indexKey())
            .update('signup-code:' + emailHash + ':' + guess, 'utf8').digest('hex');
        if (h === target) return guess;
    }
    throw new Error('the code did not match any of the million');
}

function freshEmail(tag) {
    return tag + Date.now() + crypto.randomBytes(3).toString('hex') + '@primjer.hr';
}

test('a sign-up can only be finished by the browser that started it', flow, async () => {
    const email = freshEmail('origin');
    const started = await accounts.startSignup({
        email, name: 'Ana Anic', password: 'a-very-long-password-1', lang: 'en', flags: [],
    });
    assert.ok(started.ok && started.origin);

    const code = await codeFor(db.blindIndex(email));

    assert.strictEqual((await accounts.verifySignup(email, code, '')).reason, 'bad-origin');
    assert.strictEqual((await accounts.verifySignup(email, code, 'someone-elses')).reason, 'bad-origin');
    assert.strictEqual((await accounts.verifySignup(email, code, started.origin)).ok, true);

    await accounts.forget(email);
});

test('the sign-in throttle follows the address, account or not', flow, async () => {
    const email = freshEmail('throttle');
    const started = await accounts.startSignup({
        email, name: 'Ana Anic', password: 'a-very-long-password-1', lang: 'en', flags: [],
    });
    await accounts.verifySignup(email, await codeFor(db.blindIndex(email)), started.origin);

    let last = null;
    for (let i = 0; i < 7; i++) last = await accounts.signIn(email, 'wrong-password-here');
    assert.strictEqual(last.reason, 'too-many-attempts');
    assert.ok(last.retryIn > 0);

    // an address nobody has must be slowed down the same way, or the throttle
    // itself says which addresses exist
    const unknown = freshEmail('nobody');
    let u = null;
    for (let i = 0; i < 7; i++) u = await accounts.signIn(unknown, 'wrong-password-here');
    assert.strictEqual(u.reason, 'too-many-attempts');

    await db.query('DELETE FROM login_fails WHERE email_hash = $1', [db.blindIndex(email)]);
    const good = await accounts.signIn(email, 'a-very-long-password-1');
    assert.strictEqual(good.ok, true);
    const left = await db.query('SELECT 1 FROM login_fails WHERE email_hash = $1', [db.blindIndex(email)]);
    assert.strictEqual(left.rowCount, 0, 'a success should clear the counter');

    await accounts.forget(email);
});

test('two-factor: enrolling, signing in, reuse, and recovery', flow, async () => {
    const email = freshEmail('twofa');
    const started = await accounts.startSignup({
        email, name: 'Ana Anic', password: 'a-very-long-password-1', lang: 'en', flags: [],
    });
    const made = await accounts.verifySignup(email, await codeFor(db.blindIndex(email)), started.origin);
    const userId = made.userId || (await db.query('SELECT id FROM users WHERE email_hash = $1', [db.blindIndex(email)])).rows[0].id;

    const secret = await accounts.startTotp(userId);
    assert.ok(secret);

    // an account is not protected until the app has proved it works
    let signIn = await accounts.signIn(email, 'a-very-long-password-1');
    assert.strictEqual(signIn.ok, true, 'an unconfirmed secret must not lock anybody out');

    assert.strictEqual((await accounts.confirmTotp(userId, '000000')).reason, 'bad-code');
    const step = Math.floor(Date.now() / 1000 / 30);
    const confirmed = await accounts.confirmTotp(userId, totp.codeFor(secret, step));
    assert.strictEqual(confirmed.ok, true);
    assert.strictEqual(confirmed.codes.length, 10);

    // now the password alone is not enough
    signIn = await accounts.signIn(email, 'a-very-long-password-1');
    assert.strictEqual(signIn.reason, 'totp-required');
    assert.ok(signIn.pending);

    // the code that switched it on has been used and must not work again
    assert.strictEqual((await accounts.finishTotp(signIn.pending, totp.codeFor(secret, step))).reason, 'code-used');
    assert.strictEqual((await accounts.finishTotp(signIn.pending, '000000')).reason, 'bad-code');

    const next = await accounts.finishTotp(signIn.pending, totp.codeFor(secret, step + 1));
    assert.strictEqual(next.ok, true);
    assert.ok(next.session);

    // and a recovery code works once
    const again = await accounts.signIn(email, 'a-very-long-password-1');
    const rescued = await accounts.finishTotp(again.pending, confirmed.codes[0]);
    assert.strictEqual(rescued.ok, true);
    assert.strictEqual(rescued.usedRecovery, true);
    assert.strictEqual(rescued.recoveryLeft, 9);

    const third = await accounts.signIn(email, 'a-very-long-password-1');
    assert.strictEqual((await accounts.finishTotp(third.pending, confirmed.codes[0])).reason, 'bad-code',
        'a spent recovery code must not work twice');

    await accounts.forget(email);
});

test('a reset link works once and ends every session', flow, async () => {
    const email = freshEmail('reset');
    const started = await accounts.startSignup({
        email, name: 'Ana Anic', password: 'a-very-long-password-1', lang: 'en', flags: [],
    });
    const made = await accounts.verifySignup(email, await codeFor(db.blindIndex(email)), started.origin);
    assert.ok(made.session);

    const link = await accounts.startReset(email, 'hr');
    assert.ok(link.ok && link.token);

    const done = await accounts.finishReset(link.token, 'another-very-long-password-2', {});
    assert.strictEqual(done.ok, true);
    assert.strictEqual(done.email, email, 'the notice needs the address the link was for');

    assert.strictEqual((await accounts.finishReset(link.token, 'third-very-long-password-3', {})).reason, 'bad-token');
    assert.strictEqual(await accounts.readSession(made.session.token), null, 'the old session should be gone');

    await accounts.forget(email);
});

test('changing the password needs the old one and ends other sessions', flow, async () => {
    const email = freshEmail('change');
    const started = await accounts.startSignup({
        email, name: 'Ana Anic', password: 'a-very-long-password-1', lang: 'en', flags: [],
    });
    const made = await accounts.verifySignup(email, await codeFor(db.blindIndex(email)), started.origin);
    const userId = made.userId || (await db.query('SELECT id FROM users WHERE email_hash = $1', [db.blindIndex(email)])).rows[0].id;

    const other = await accounts.startSession(userId);
    assert.ok(other);

    assert.strictEqual((await accounts.changePassword(userId, 'not-it', 'a-new-long-password-2')).reason, 'bad-password');
    assert.strictEqual((await accounts.changePassword(userId, 'a-very-long-password-1', 'a-new-long-password-2')).ok, true);

    await accounts.revokeOtherSessions(userId, made.session.token);
    assert.strictEqual(await accounts.readSession(other.token), null);
    assert.ok(await accounts.readSession(made.session.token), 'the session doing the change should survive');

    await accounts.forget(email);
});

test('deleting an account needs the password and takes everything with it', flow, async () => {
    const email = freshEmail('delete');
    const started = await accounts.startSignup({
        email, name: 'Ana Anic', password: 'a-very-long-password-1', lang: 'en', flags: [],
    });
    const made = await accounts.verifySignup(email, await codeFor(db.blindIndex(email)), started.origin);
    const userId = made.userId || (await db.query('SELECT id FROM users WHERE email_hash = $1', [db.blindIndex(email)])).rows[0].id;

    assert.strictEqual((await accounts.deleteAccount(userId, 'not-it')).reason, 'bad-password');
    assert.strictEqual((await accounts.deleteAccount(userId, 'a-very-long-password-1')).ok, true);

    assert.strictEqual(await accounts.readSession(made.session.token), null);
    const gone = await db.query('SELECT 1 FROM users WHERE email_hash = $1', [db.blindIndex(email)]);
    assert.strictEqual(gone.rowCount, 0);
});

test('the audit trail records the flow and names nobody', flow, async () => {
    const email = freshEmail('audit');
    const started = await accounts.startSignup({
        email, name: 'Ana Anic', password: 'a-very-long-password-1', lang: 'en', flags: [],
    });
    await accounts.verifySignup(email, await codeFor(db.blindIndex(email)), started.origin);
    await accounts.signIn(email, 'wrong-password-here');

    // the writes are deliberately not awaited by the code that triggers them
    await new Promise((r) => setTimeout(r, 600));

    const rows = await accounts.recentAudit({ limit: 100, subject: db.blindIndex(email) });
    const kinds = rows.map((r) => r.kind);
    for (const wanted of ['signup-started', 'signup-finished', 'login-refused']) {
        assert.ok(kinds.includes(wanted), 'expected ' + wanted + ' in the trail');
    }
    assert.ok(!JSON.stringify(rows).includes(email), 'no address should ever reach the trail');

    await accounts.forget(email);
});

test.after(async () => {
    // the connection pool keeps the process alive otherwise, and a test run that
    // never exits looks exactly like a test run that hung
    await new Promise((r) => setTimeout(r, 250));
    await db.close();
});
