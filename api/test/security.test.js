'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

process.env.SUBMISSIONS_KEY = process.env.SUBMISSIONS_KEY ||
    crypto.randomBytes(32).toString('base64');
process.env.BREACH_CHECK = 'false';

const totp = require('../totp');
const { ipKey } = require('../rate-store');
const db = require('../db');
const accounts = require('../accounts');

test('totp matches the published test vectors', () => {
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

test('a sealed value opens again, and only with its own label', () => {
    const blob = db.seal('label-a:1', 'ana@primjer.hr');
    assert.strictEqual(db.open('label-a:1', blob), 'ana@primjer.hr');
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

test('ipv6 is counted by network and ipv4 by address', () => {
    assert.strictEqual(ipKey('1.2.3.4'), '1.2.3.4');
    assert.strictEqual(ipKey('::ffff:1.2.3.4'), '1.2.3.4');
    assert.strictEqual(ipKey('2a01:4f8:c17:b8f::1'), '2a01:4f8:c17:b8f::/64');
    assert.strictEqual(ipKey('2a01:4f8:c17:b8f:1:2:3:4'), '2a01:4f8:c17:b8f::/64');
    assert.strictEqual(ipKey('2a01:4f8:c17:b8f::dead'), ipKey('2a01:4f8:c17:b8f::beef'));
});

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

const haveDb = Boolean(process.env.DATABASE_URL);
const flow = { skip: haveDb ? false : 'no DATABASE_URL' };

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

// Two-factor holds up to three authenticator apps, each under its own name,
// and a code from any of them signs in. There are no recovery codes: a second
// app on another device is the way back in. One an older account was given
// still works once, so nobody is locked out by the change.
test('two-factor: up to three apps, signing in with any, reuse, and taking them off', flow, async () => {
    const email = freshEmail('twofa');
    const pass = 'a-very-long-password-1';
    const started = await accounts.startSignup({ email, name: 'Ana Anic', password: pass, lang: 'en', flags: [] });
    const made = await accounts.verifySignup(email, await codeFor(db.blindIndex(email)), started.origin);
    const userId = made.userId || (await db.query('SELECT id FROM users WHERE email_hash = $1', [db.blindIndex(email)])).rows[0].id;
    const step = Math.floor(Date.now() / 1000 / 30);
    assert.strictEqual(accounts.MAX_FACTORS, 3);

    const first = await accounts.startTotp(userId);
    assert.strictEqual((await accounts.signIn(email, pass)).ok, true, 'an unconfirmed secret must not lock anybody out');
    assert.strictEqual((await accounts.confirmTotp(userId, '000000', 'iPhone')).reason, 'bad-code');
    const one = await accounts.confirmTotp(userId, totp.codeFor(first, step), 'iPhone');
    assert.strictEqual(one.ok, true);
    assert.strictEqual(one.codes, undefined, 'recovery codes are handed out again');

    let signIn = await accounts.signIn(email, pass);
    assert.strictEqual(signIn.reason, 'totp-required');
    assert.strictEqual((await accounts.finishTotp(signIn.pending, totp.codeFor(first, step))).reason, 'code-used');
    assert.strictEqual((await accounts.finishTotp(signIn.pending, '000000')).reason, 'bad-code');
    assert.strictEqual((await accounts.finishTotp(signIn.pending, totp.codeFor(first, step + 1))).ok, true);

    // a second and a third, added while two-factor stays on; a fourth is refused
    const second = await accounts.startTotp(userId);
    assert.strictEqual((await accounts.signIn(email, pass)).reason, 'totp-required', 'adding an app switched two-factor off');
    assert.strictEqual((await accounts.confirmTotp(userId, totp.codeFor(second, step), '  1Password   work ')).ok, true);
    const third = await accounts.startTotp(userId);
    assert.strictEqual((await accounts.confirmTotp(userId, totp.codeFor(third, step), 'iPad')).ok, true);
    const fourth = await accounts.startTotp(userId);
    assert.strictEqual((await accounts.confirmTotp(userId, totp.codeFor(fourth, step), 'one too many')).reason, 'too-many');
    const apps = await accounts.listFactors(userId);
    assert.deepStrictEqual(apps.map((f) => f.name), ['iPhone', '1Password work', 'iPad']);
    assert.ok(apps[0].usedAt, 'the app that signed in does not say so');

    // any of them signs in
    assert.strictEqual((await accounts.finishTotp((await accounts.signIn(email, pass)).pending, totp.codeFor(third, step + 1))).ok, true);

    // a recovery code an older account was given still works, once
    const old = '12345-67890';
    await db.query('INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1, $2)', [userId,
        crypto.createHmac('sha256', db.indexKey() || Buffer.alloc(32)).update('recovery:' + userId + ':' + totp.normaliseRecovery(old), 'utf8').digest('hex')]);
    assert.strictEqual((await accounts.finishTotp((await accounts.signIn(email, pass)).pending, old)).usedRecovery, true);
    assert.strictEqual((await accounts.finishTotp((await accounts.signIn(email, pass)).pending, old)).reason, 'bad-code',
        'a spent recovery code must not work twice');

    // taking them off, one at a time, the last taking two-factor with it
    assert.strictEqual((await accounts.removeFactor(userId, '999999999')).reason, 'not-found');
    assert.deepStrictEqual(await accounts.removeFactor(userId, apps[0].id), { ok: true, left: 2 });
    assert.deepStrictEqual(await accounts.removeFactor(userId, apps[1].id), { ok: true, left: 1 });
    assert.strictEqual((await accounts.signIn(email, pass)).reason, 'totp-required', 'two-factor went before the last app');
    assert.deepStrictEqual(await accounts.removeFactor(userId, apps[2].id), { ok: true, left: 0 });
    assert.strictEqual((await accounts.signIn(email, pass)).ok, true, 'two-factor stayed on with no app left');

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

    await new Promise((r) => setTimeout(r, 600));

    const rows = await accounts.recentAudit({ limit: 100, subject: db.blindIndex(email) });
    const kinds = rows.map((r) => r.kind);
    for (const wanted of ['signup-started', 'signup-finished', 'login-refused']) {
        assert.ok(kinds.includes(wanted), 'expected ' + wanted + ' in the trail');
    }
    assert.ok(!JSON.stringify(rows).includes(email), 'no address should ever reach the trail');

    await accounts.forget(email);
});

const sanctions = require('../sanctions');
const screening = require('../screening');
const trial = require('../trial');

const SDN_SAMPLE = `<?xml version="1.0" standalone="yes"?>
<sdnList>
  <publshInformation><Publish_Date>09/10/2026</Publish_Date><Record_Count>2</Record_Count></publshInformation>
  <sdnEntry>
    <uid>4632</uid>
    <lastName>TEST ENTITY LTD</lastName>
    <sdnType>Entity</sdnType>
    <remarks>(Linked To: SOMETHING)</remarks>
    <programList><program>IRAN</program><program>SDGT</program></programList>
    <idList>
      <id><uid>1</uid><idType>Email Address</idType><idNumber>x@y.z</idNumber></id>
      <id><uid>2</uid><idType>Digital Currency Address - XBT</idType><idNumber>1CounterFeitAddressForTests000000</idNumber></id>
      <id><uid>3</uid><idType>Digital Currency Address - ETH</idType><idNumber>0x00000000000000000000000000000000DeadBeef</idNumber></id>
    </idList>
  </sdnEntry>
  <sdnEntry>
    <uid>99</uid>
    <lastName>NO ADDRESSES HERE</lastName>
    <sdnType>Entity</sdnType>
    <idList><id><uid>4</uid><idType>Passport</idType><idNumber>A123</idNumber></id></idList>
  </sdnEntry>
</sdnList>`;

test('the sanctions parser takes only digital currency addresses, and keeps who they belong to', () => {
    const parsed = sanctions.parseSdn(SDN_SAMPLE);
    assert.strictEqual(parsed.listDate, '09/10/2026');
    assert.strictEqual(parsed.rows.length, 2, 'the passport and the email address are not addresses');
    const eth = parsed.rows.find((r) => r.asset === 'ETH');
    assert.strictEqual(eth.name, 'TEST ENTITY LTD');
    assert.strictEqual(eth.programs, 'IRAN,SDGT');
    assert.strictEqual(eth.key, eth.address.toLowerCase(), 'lookups are case insensitive');
});

test('an address is recognised by shape without asking anyone', () => {
    assert.strictEqual(screening.identify('0x8589427373D6D84E98730D7795D8f6f8731FDA16').asset, 'ETH');
    assert.strictEqual(screening.identify('TNiq9AXBp9EjUqhDhrwrfvAA8U3GUQZH81').asset, 'TRX');
    assert.strictEqual(screening.identify('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq').asset, 'XBT');
    assert.strictEqual(screening.identify('not an address'), null);
});

// These two were written when a trial hung off the person and were never
// updated when it moved to the organisation. They went on passing in the sense
// that they never ran: the suite skips them without a database, and the test
// database had no schema, because nothing at boot created one. Fixing the boot
// order made nine skipped tests start running and these two start failing,
// which is what a skipped test is for.
async function aPerson(email) {
    const hash = db.blindIndex(email);
    const res = await db.query(
        `INSERT INTO users (email_hash, email_enc, name_enc, password_hash, lang)
         VALUES ($1, $2, $3, 'x', 'hr') RETURNING id`,
        [hash, db.seal('signup-email:' + hash, email), db.seal('signup-name:' + hash, 'T')]
    );
    return res.rows[0].id;
}

async function anOrg(userId, name) {
    const res = await db.query(
        'INSERT INTO organisations (name, slug) VALUES ($1, $2) RETURNING id',
        [name, crypto.randomBytes(10).toString('hex')]
    );
    const orgId = res.rows[0].id;
    await db.query('INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, $3)',
        [orgId, userId, 'owner']);
    return orgId;
}

test('a new organisation has no plan and no quota until a trial is activated', { skip: !db.available() }, async () => {
    // a company of its own each run: a trial outlives the people who made it
    const firm = 'primjer-firma-' + crypto.randomBytes(4).toString('hex') + '.hr';
    const email = 'trial-' + crypto.randomBytes(6).toString('hex') + '@' + firm;
    const userId = await aPerson(email);
    const orgId = await anOrg(userId, 'Primjer');

    const fresh = await trial.ensure(orgId, userId, email);
    assert.strictEqual(fresh.state, 'none');
    assert.strictEqual(fresh.liveIncluded, 0, 'nothing is included before a trial exists');

    const refused = await trial.spend(orgId, 'live');
    assert.strictEqual(refused.ok, false);
    assert.strictEqual(refused.reason, 'no-trial');

    const halfway = await trial.activate(orgId, userId, {
        email, website: firm, consent: true, notGambling: false,
    });
    assert.strictEqual(halfway.reason, 'both-confirmations-required');

    const mismatch = await trial.activate(orgId, userId, {
        email: 'someone@gmail.com', website: firm, consent: true, notGambling: true,
    });
    assert.strictEqual(mismatch.state, 'pending', 'a free address does not open a trial by itself');

    const started = await trial.activate(orgId, userId, {
        email, website: 'https://www.' + firm + '/o-nama', consent: true, notGambling: true,
    });
    assert.strictEqual(started.state, 'starter');
    assert.strictEqual(started.liveLeft, 1);
    assert.strictEqual(started.historyLeft, 1);
    assert.strictEqual(started.historyOpen, false, 'the history stays locked until the number is verified');

    assert.strictEqual((await trial.spend(orgId, 'live')).liveLeft, 0);
    assert.strictEqual((await trial.spend(orgId, 'live')).reason, 'out-of-checks');
    await trial.spend(orgId, 'history');
    assert.strictEqual((await trial.spend(orgId, 'history')).reason, 'history-locked');

    const verified = await trial.markPhoneVerified(orgId, '+38591' + crypto.randomBytes(3).toString('hex'));
    assert.strictEqual(verified.state, 'verified');
    assert.strictEqual(verified.historyOpen, true);
    assert.ok(verified.liveLeft > 0, 'verifying the number adds live checks');

    await db.query('DELETE FROM trials WHERE org_id = $1', [orgId]);
    await db.query('DELETE FROM users WHERE id = $1', [userId]);
});

test('one trial per company', { skip: !db.available() }, async () => {
    const host = 'firma-' + crypto.randomBytes(4).toString('hex') + '.hr';
    const ids = [];
    for (const who of ['ana', 'ivo']) {
        const email = who + '@' + host;
        const userId = await aPerson(email);
        // two people at the same company, each with their own organisation:
        // the point of the rule is that the company gets one trial, not that
        // one row blocks another
        ids.push({ id: userId, orgId: await anOrg(userId, who), email });
    }
    const first = await trial.activate(ids[0].orgId, ids[0].id, {
        email: ids[0].email, website: host, consent: true, notGambling: true,
    });
    assert.strictEqual(first.state, 'starter');

    const second = await trial.activate(ids[1].orgId, ids[1].id, {
        email: ids[1].email, website: host, consent: true, notGambling: true,
    });
    assert.strictEqual(second.ok, false);
    assert.strictEqual(second.reason, 'company-already-has-a-trial');

    for (const u of ids) await db.query('DELETE FROM trials WHERE org_id = $1', [u.orgId]);
    for (const u of ids) await db.query('DELETE FROM users WHERE id = $1', [u.id]);
});

test.after(async () => {
    await new Promise((r) => setTimeout(r, 250));
    await db.close();
});

// The code to scan, drawn by the page from the outline the server sends: a
// true QR code of the address the app is given, its three finder squares in
// their corners, and nothing in it fetched from anywhere.
test('the setup code is a QR code of the authenticator address', () => {
    const { qrPath } = require('../qr');
    const url = totp.otpauthUrl('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', 'ana@example.com', 'Sentinelpay');
    const q = qrPath(url);
    assert.ok(q.size >= 21 && (q.size - 17) % 4 === 0, 'not a QR size: ' + q.size);
    const runs = q.d.split('z').filter(Boolean);
    // a finder square's top edge is a run of seven dark modules
    for (const at of ['M0 0h7', 'M' + (q.size - 7) + ' 0h7', 'M0 ' + (q.size - 7) + 'h7']) {
        assert.ok(runs.some((r) => r.startsWith(at)), 'no finder square at ' + at);
    }
    assert.match(q.d, /^(M\d+ \d+h\d+v1h-\d+z)+$/);
    // the same address gives the same code, a different one a different code
    assert.equal(qrPath(url).d, q.d);
    assert.notEqual(qrPath(url + 'x').d, q.d);
    const index = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.js'), 'utf8');
    assert.match(index, /qr: qrPath\(totp\.otpauthUrl\(secret, me\.email \|\| 'sentinelpay', 'Sentinelpay'\)\)/, 'the setup answer carries no code to scan');
    assert.ok(require('fs').existsSync(require('path').join(__dirname, '..', 'vendor', 'qrcode-generator-1.4.4', 'LICENSE.txt')), 'the encoder has no licence beside it');
});

// Removing an app is a click, from a session that passed the second step.
// Every app change on an account with two-factor asks that of the session;
// the first app replaces every session the account had with one that has.
test('app changes need a session that passed the second step', () => {
    const index = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.js'), 'utf8');
    for (const path of ['/v1/account/totp/start', '/v1/account/totp/confirm', '/v1/account/totp/remove',
        '/v1/account/totp/off', '/v1/account/password', '/v1/account/delete']) {
        const at = index.indexOf("app.post('" + path + "'");
        assert.ok(at > 0, path + ' is gone');
        const route = index.slice(at, index.indexOf('\n});\n', at));
        assert.match(route, /if \(secondStepOwed\(me, res\)\) return;/, path + ' takes a session that skipped the second step');
    }
    const remove = index.slice(index.indexOf("app.post('/v1/account/totp/remove'"), index.indexOf("app.post('/v1/account/totp/off'"));
    assert.doesNotMatch(remove, /password/, 'removing an app asks for the password');
    assert.match(remove, /tellTwoFactor\(req, me, out\.left \? 'removed' : 'off'\)/, 'the owner is not told');
    const confirm = index.slice(index.indexOf("app.post('/v1/account/totp/confirm'"), index.indexOf("app.get('/v1/account/totp'"));
    assert.match(confirm, /if \(out\.first\) \{\n\s+const fresh = await accounts\.freshSessionAfterTotp\(me\.userId\);/);
    assert.doesNotMatch(confirm, /markSessionMfa/, 'a new app vouches for the session that added it');
});

test('the first app ends every older session and opens one that passed the second step', flow, async () => {
    const email = freshEmail('fresh');
    const started = await accounts.startSignup({ email, name: 'Ana Anic', password: 'a-very-long-password-1', lang: 'en', flags: [] });
    const made = await accounts.verifySignup(email, await codeFor(db.blindIndex(email)), started.origin);
    const other = await accounts.startSession(made.userId);
    const fresh = await accounts.freshSessionAfterTotp(made.userId);
    assert.strictEqual(await accounts.readSession(made.session.token), null, 'the session in hand survived');
    assert.strictEqual(await accounts.readSession(other.token), null, 'another session survived');
    assert.strictEqual((await accounts.readSession(fresh.token)).mfa, true);
    await accounts.forget(email);
});

// A reset link proves the inbox and nothing else. An account with two-factor
// gets its new password and signs in with it and a code.
test('a reset on an account with two-factor opens no session', flow, async () => {
    const email = freshEmail('reset2fa');
    const pass = 'a-very-long-password-1';
    const started = await accounts.startSignup({ email, name: 'Ana Anic', password: pass, lang: 'en', flags: [] });
    const made = await accounts.verifySignup(email, await codeFor(db.blindIndex(email)), started.origin);
    const secret = await accounts.startTotp(made.userId);
    assert.ok((await accounts.confirmTotp(made.userId, totp.codeFor(secret, Math.floor(Date.now() / 30000)), 'phone')).ok);
    const link = await accounts.startReset(email, 'en');
    const done = await accounts.finishReset(link.token, 'another-very-long-password-2', {});
    assert.strictEqual(done.ok, true);
    assert.strictEqual(done.session, null, 'the reset link signed in past the second step');
    assert.strictEqual(done.signIn, true);
    assert.strictEqual((await accounts.signIn(email, 'another-very-long-password-2')).reason, 'totp-required');
    await accounts.forget(email);
});

// Guesses at the second step are spent before they are checked, six to a
// half finished sign-in, ten to the account in a quarter of an hour, so a
// burst sent all at once gets no more than one sent a try at a time.
test('a burst of second-step guesses gets six, and the account holds after ten', flow, async () => {
    const email = freshEmail('burst');
    const pass = 'a-very-long-password-1';
    const started = await accounts.startSignup({ email, name: 'Ana Anic', password: pass, lang: 'en', flags: [] });
    const made = await accounts.verifySignup(email, await codeFor(db.blindIndex(email)), started.origin);
    const step = Math.floor(Date.now() / 30000);
    const secret = await accounts.startTotp(made.userId);
    assert.ok((await accounts.confirmTotp(made.userId, totp.codeFor(secret, step), 'phone')).ok);
    const wrong = totp.codeFor(secret, step + 40);

    const one = (await accounts.signIn(email, pass)).pending;
    const burst = await Promise.all(Array.from({ length: 20 }, () => accounts.finishTotp(one, wrong)));
    assert.strictEqual(burst.filter((r) => r.reason === 'bad-code').length, 6, 'more than six guesses were checked');

    const two = (await accounts.signIn(email, pass)).pending;
    for (let i = 0; i < 4; i++) assert.strictEqual((await accounts.finishTotp(two, wrong)).reason, 'bad-code');
    const three = (await accounts.signIn(email, pass)).pending;
    assert.strictEqual((await accounts.finishTotp(three, totp.codeFor(secret, step + 1))).reason, 'too-many-attempts',
        'the account took an eleventh guess');

    // past the quarter hour it signs in again, and a code is good once
    await db.query("UPDATE users SET totp_fail_at = now() - interval '16 minutes' WHERE id = $1", [made.userId]);
    const four = (await accounts.signIn(email, pass)).pending;
    const twice = await Promise.all([accounts.finishTotp(four, totp.codeFor(secret, step + 1)),
        accounts.finishTotp(four, totp.codeFor(secret, step + 1))]);
    assert.strictEqual(twice.filter((r) => r.ok).length, 1, 'one code signed in twice');
    const five = (await accounts.signIn(email, pass)).pending;
    assert.strictEqual((await accounts.finishTotp(five, totp.codeFor(secret, step))).reason, 'code-used',
        'the code before the last one used still works');
    await accounts.forget(email);
});

// Signing up with an address that has an account looks exactly like signing
// up with one that has not, and nothing a code can do opens the account.
test('sign-up says nothing about which addresses have accounts', flow, async () => {
    const email = freshEmail('exists');
    const started = await accounts.startSignup({ email, name: 'Ana Anic', password: 'a-very-long-password-1', lang: 'en', flags: [] });
    await accounts.verifySignup(email, await codeFor(db.blindIndex(email)), started.origin);

    const again = await accounts.startSignup({ email, name: 'Eve Evil', password: 'evils-long-password-9', lang: 'en', flags: [] });
    assert.strictEqual(again.ok, true, 'a taken address is answered differently');
    assert.strictEqual(again.exists, true);
    assert.strictEqual(again.code, null, 'a code was made for an address that has an account');
    const tries = await Promise.all(Array.from({ length: 12 }, (_, i) =>
        accounts.verifySignup(email, String(i).padStart(6, '0'), again.origin)));
    assert.ok(tries.every((r) => !r.ok && !r.session), 'a sign-up code opened an existing account');
    const index = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.js'), 'utf8');
    assert.doesNotMatch(index, /already has an account\. Try logging in instead/);
    await accounts.forget(email);
});

test('an owner of an organisation others work in cannot delete their account out from under it', flow, async () => {
    const email = freshEmail('owner');
    const pass = 'a-very-long-password-1';
    const started = await accounts.startSignup({ email, name: 'Ana Anic', password: pass, lang: 'en', flags: [] });
    const made = await accounts.verifySignup(email, await codeFor(db.blindIndex(email)), started.origin);
    await require('../orgs').init();
    const orgId = await anOrg(made.userId, 'Shared');
    const mate = await aPerson(freshEmail('mate'));
    await db.query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'analyst')", [orgId, mate]);
    assert.strictEqual((await accounts.deleteAccount(made.userId, pass)).reason, 'owns-org');
    await db.query('DELETE FROM memberships WHERE user_id = $1', [mate]);
    assert.strictEqual((await accounts.deleteAccount(made.userId, pass)).ok, true, 'an owner alone in the organisation is kept');
    await db.query('DELETE FROM organisations WHERE id = $1', [orgId]);
    await db.query('DELETE FROM users WHERE id = $1', [mate]);
});

// Opening an invitation link joins nothing. The link can be put in front of
// a signed-in person from any page; the organisations page asks, and the
// join is a POST the cross-site check covers.
test('an invitation is joined on a click, not by opening its link', () => {
    const index = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.js'), 'utf8');
    const get = index.slice(index.indexOf("app.get('/invite/:secret'"), index.indexOf("const ORGS_JOIN"));
    assert.doesNotMatch(get, /invites\.accept|setOrgCookie/, 'opening the link joins the organisation');
    assert.match(index, /app\.post\('\/v1\/invites\/accept', requireCloudflareOrigin, accountLimiter,/);
    const invites = require('fs').readFileSync(require('path').join(__dirname, '..', 'invites.js'), 'utf8');
    assert.match(invites, /WHERE id = \$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now\(\)/);
    assert.match(invites, /ON CONFLICT \(org_id, user_id\) DO NOTHING/, 'accepting can change a role somebody already has');
});
