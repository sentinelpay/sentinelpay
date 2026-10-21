'use strict';

// What a person can still do after they are no longer who they were: an
// admin removed, a member moved down, a project closed. And what a check
// says when it could not really be made.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const db = require('../db');
const orgs = require('../orgs');
const tokens = require('../tokens');
const projects = require('../projects');
const screening = require('../screening');
const trial = require('../trial');

const live = { skip: db.available() ? false : 'no DATABASE_URL' };

async function aPerson(tag) {
    const email = tag + Date.now() + crypto.randomBytes(3).toString('hex') + '@primjer.hr';
    const hash = db.blindIndex(email);
    await require('../accounts').readUser(0);
    const res = await db.query(
        `INSERT INTO users (email_hash, email_enc, name_enc, password_hash, lang)
         VALUES ($1, $2, $3, 'x', 'hr') RETURNING id`,
        [hash, db.seal('signup-email:' + hash, email), db.seal('signup-name:' + hash, 'T')]);
    return res.rows[0].id;
}

test('a token stops working when its maker leaves, is removed or is moved below admin', live, async () => {
    await orgs.init();
    const owner = await aPerson('own');
    const made = await orgs.create(owner, 'Tokens ' + Date.now(), 'localhost', 'owner');
    const orgId = made.org.id;
    const admins = [await aPerson('adm'), await aPerson('adm')];
    for (const a of admins) {
        await db.query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'admin')", [orgId, a]);
    }
    const one = await tokens.mint(admins[0], orgId, 'one', ['screenings:read'], 30, 'live');
    const two = await tokens.mint(admins[1], orgId, 'two', ['screenings:read'], 30, 'live');
    assert.ok(one.ok && two.ok);
    assert.strictEqual((await tokens.read(one.token)).ok, true);

    assert.strictEqual((await orgs.removeMember(owner, orgId, admins[0])).ok, true);
    assert.strictEqual((await tokens.read(one.token)).ok, false, 'a removed admin\'s token still works');

    assert.strictEqual((await orgs.setRole(owner, orgId, admins[1], 'viewer')).ok, true);
    assert.strictEqual((await tokens.read(two.token)).ok, false, 'a demoted admin\'s token still works');
    // and being made admin again does not bring the old token back
    assert.strictEqual((await orgs.setRole(owner, orgId, admins[1], 'admin')).ok, true);
    assert.strictEqual((await tokens.read(two.token)).reason, 'revoked');

    await db.query('DELETE FROM organisations WHERE id = $1', [orgId]);
    await db.query('DELETE FROM users WHERE id = ANY($1)', [[owner, ...admins]]);
});

test('a project token stops with its project and never reaches the rest', live, async () => {
    await orgs.init();
    await projects.init();
    const owner = await aPerson('prj');
    const made = await orgs.create(owner, 'Projects ' + Date.now(), 'localhost', 'owner');
    const orgId = made.org.id;
    const p = await projects.create(orgId, 'Card program');
    assert.ok(p.ok, 'could not make a project');
    const t = await tokens.mint(owner, orgId, 'card', ['screenings:read'], 30, 'live', p.project.id);
    assert.ok(t.ok);
    assert.strictEqual((await tokens.read(t.token)).projectId, String(p.project.id));
    await projects.archive(orgId, p.project.id, true);
    assert.strictEqual((await tokens.read(t.token)).reason, 'archived');
    await projects.archive(orgId, p.project.id, false);
    await projects.remove(orgId, p.project.id);
    const after = await tokens.read(t.token);
    assert.strictEqual(after.ok, false, 'a deleted project\'s token now reaches the whole organisation');

    await db.query('DELETE FROM organisations WHERE id = $1', [orgId]);
    await db.query('DELETE FROM users WHERE id = $1', [owner]);
});

test('a token is deleted only by its own organisation, and is gone at once', live, async () => {
    await orgs.init();
    const owner = await aPerson('del');
    const a = (await orgs.create(owner, 'Del A ' + Date.now(), 'localhost', 'owner')).org.id;
    const b = (await orgs.create(owner, 'Del B ' + Date.now(), 'localhost', 'owner')).org.id;
    const made = await tokens.mint(owner, a, 'to delete', ['screenings:read'], 30, 'live');
    const id = made.row.id;
    assert.strictEqual((await tokens.remove(b, id)).reason, 'missing', 'another organisation deleted the token');
    assert.strictEqual((await tokens.read(made.token)).ok, true);
    assert.strictEqual((await tokens.remove(a, id)).ok, true);
    assert.strictEqual((await tokens.read(made.token)).ok, false, 'a deleted token still works');
    assert.ok(!(await tokens.list(a)).some((r) => r.id === id), 'a deleted token is still listed');
    await db.query('DELETE FROM organisations WHERE id = ANY($1)', [[a, b]]);
    await db.query('DELETE FROM users WHERE id = $1', [owner]);
});

test('an address is read out of what was pasted, and nothing else passes for one', () => {
    const eth = '0x8589427373D6D84E98730D7795D8f6f8731FDA16';
    assert.strictEqual(screening.normalise('​' + eth), eth, 'a zero-width space hides an address');
    assert.strictEqual(screening.normalise('ethereum:' + eth + '@1?value=1e18'), eth);
    assert.strictEqual(screening.normalise('bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=1'),
        'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
    assert.strictEqual(screening.normalise(' ' + eth.replace('0x', '０ｘ') + ' '), eth, 'full width letters hide an address');
    assert.strictEqual(screening.normalise('0x8589427373D6D84E98730D7795D8f6f8731FDА16'), '', 'a Cyrillic look-alike passes');
});

test('a string that is no address and on no list is refused, not sealed clear', live, async () => {
    const out = await screening.screen(null, null, 'hello world, not an address', 'live', false, null);
    assert.strictEqual(out.ok, false);
});

// The sandbox answers from fixed addresses and never asks the real list, so a
// test token is no way to screen for free.
test('the sandbox answers from its own addresses, not the list', live, async () => {
    const sanctions = require('../sanctions');
    const real = sanctions.check;
    let asked = 0;
    sanctions.check = async () => { asked++; return null; };
    try {
        const hit = await screening.screen(null, null, '0x000000000000000000000000000000000000dEaD', 'live', true, null);
        assert.strictEqual(hit.verdict, 'severe');
        assert.match(hit.reasons[0].entity, /SANDBOX/);
        const other = await screening.screen(null, null, '0x8589427373D6D84E98730D7795D8f6f8731FDA16', 'live', true, null);
        assert.strictEqual(other.verdict, 'clear');
        assert.strictEqual(other.sources[0].listDate, 'sandbox');
        assert.strictEqual(asked, 0, 'the sandbox asked the real list');
    } finally {
        sanctions.check = real;
    }
});

test('no check is made, or charged, against a list that is missing or old', live, async () => {
    const before = await db.query('SELECT * FROM sanctions_meta WHERE id = 1').catch(() => ({ rows: [] }));
    await require('../sanctions').status();
    await db.query(`INSERT INTO sanctions_meta (id, address_count, refreshed_at) VALUES (1, 0, now())
                    ON CONFLICT (id) DO UPDATE SET address_count = 0, refreshed_at = now()`);
    assert.strictEqual((await screening.listReady()).reason, 'list-missing');
    await db.query("UPDATE sanctions_meta SET address_count = 900, refreshed_at = now() - interval '4 days' WHERE id = 1");
    assert.strictEqual((await screening.listReady()).reason, 'list-stale');
    await db.query("UPDATE sanctions_meta SET refreshed_at = now() WHERE id = 1");
    assert.strictEqual((await screening.listReady()).ok, true);
    if (before.rows[0]) {
        const b = before.rows[0];
        await db.query('UPDATE sanctions_meta SET address_count = $1, refreshed_at = $2 WHERE id = 1', [b.address_count, b.refreshed_at]);
    } else {
        await db.query('DELETE FROM sanctions_meta WHERE id = 1');
    }

    const index = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    const route = index.slice(index.indexOf("app.post('/v1/screen'"), index.indexOf("app.get('/v1/screenings'"));
    assert.ok(route.indexOf('screening.listReady()') < route.indexOf('trial.spend('), 'a check is charged before the list is looked at');
    assert.match(route, /const kind = 'live';/, 'the request chooses which allowance it is drawn from');
    assert.match(route, /roleAtLeast\(me\.org\.role, 'analyst'\)/, 'a viewer can run checks');
});

test('one trial per company, read by the domain it owns, and none at once from an open mailbox', live, async () => {
    await orgs.init();
    const host = 'firma' + crypto.randomBytes(4).toString('hex') + '.co.uk';
    const a = await aPerson('t1');
    const b = await aPerson('t2');
    const oa = (await orgs.create(a, 'A ' + Date.now(), 'localhost', 'owner')).org.id;
    const ob = (await orgs.create(b, 'B ' + Date.now(), 'localhost', 'owner')).org.id;
    const first = await trial.activate(oa, a, { email: 'ana@' + host, website: 'https://shop.' + host, consent: true, notGambling: true });
    assert.strictEqual(first.state, 'starter');
    assert.strictEqual(first.companyHost, host, 'the trial is held by the subdomain, not the company');
    const again = await trial.activate(ob, b, { email: 'ivo@eu.' + host, website: 'eu.' + host, consent: true, notGambling: true });
    assert.strictEqual(again.reason, 'company-already-has-a-trial', 'a new subdomain is a new company');

    const c = await aPerson('t3');
    const oc = (await orgs.create(c, 'C ' + Date.now(), 'localhost', 'owner')).org.id;
    const free = await trial.activate(oc, c, { email: 'x@gmail.com', website: 'z' + Date.now() + '.gmail.com', consent: true, notGambling: true, openMailbox: true });
    assert.strictEqual(free.state, 'pending', 'an open mailbox started a trial at once');

    // a request still waiting holds nothing for the company it names
    const d = await aPerson('t4');
    const od = (await orgs.create(d, 'D ' + Date.now(), 'localhost', 'owner')).org.id;
    const victim = 'victim' + crypto.randomBytes(4).toString('hex') + '.hr';
    await trial.activate(od, d, { email: 'x@elsewhere.hr', website: victim, consent: true, notGambling: true });
    const e = await aPerson('t5');
    const oe = (await orgs.create(e, 'E ' + Date.now(), 'localhost', 'owner')).org.id;
    assert.strictEqual((await trial.activate(oe, e, { email: 'boss@' + victim, website: victim, consent: true, notGambling: true })).state,
        'starter', 'a waiting request held another company\'s trial');

    await db.query('DELETE FROM trials WHERE org_id = ANY($1)', [[oa, ob, oc, od, oe]]);
    await db.query('DELETE FROM organisations WHERE id = ANY($1)', [[oa, ob, oc, od, oe]]);
    await db.query('DELETE FROM users WHERE id = ANY($1)', [[a, b, c, d, e]]);
});

test.after(async () => {
    await new Promise((r) => setTimeout(r, 250));
    await db.close();
});

// Sending an invitation again closes the link that went before it, and the
// role it gives can be changed while it is open but never to owner, and
// never through an organisation it does not belong to.
test('a resent invitation kills the old link, and its role changes in its own organisation only', live, async () => {
    const invites = require('../invites');
    await orgs.init();
    const owner = await aPerson('inv');
    const orgId = (await orgs.create(owner, 'Invites ' + Date.now(), 'localhost', 'owner')).org.id;
    const elsewhere = (await orgs.create(owner, 'Elsewhere ' + Date.now(), 'localhost', 'owner')).org.id;
    const made = await invites.create(orgId, owner, { email: 'new' + Date.now() + '@primjer.hr', role: 'viewer', days: 7 });
    assert.ok(made.ok, made.reason);
    const id = made.invite.id;

    const again = await invites.resend(orgId, id, owner, 14);
    assert.ok(again.ok, again.reason);
    assert.notStrictEqual(again.secret, made.secret);
    assert.strictEqual(await invites.read(made.secret), null, 'the first link still opens');
    assert.ok(await invites.read(again.secret));
    assert.strictEqual((await invites.resend(elsewhere, id, owner, 7)).reason, 'missing');

    assert.strictEqual((await invites.setRole(orgId, id, 'admin')).invite.role, 'admin');
    assert.strictEqual((await invites.setRole(orgId, id, 'owner')).reason, 'bad-role');
    assert.strictEqual((await invites.setRole(elsewhere, id, 'viewer')).reason, 'missing');

    await invites.revoke(orgId, id);
    assert.strictEqual((await invites.resend(orgId, id, owner, 7)).reason, 'missing', 'a cancelled invitation came back');
    assert.strictEqual((await invites.setRole(orgId, id, 'viewer')).reason, 'missing');
    assert.ok(!(await invites.listFor(orgId)).some((i) => String(i.id) === String(id)), 'a cancelled invitation is still listed');
});

// Mail is written in the language the account chose, and an invitation to
// somebody with an account goes in theirs, whatever the sender picked. The
// team page is never told which language that was: it would say the address
// has an account.
test('an account keeps its language, and an invitation follows the one it is for', live, async () => {
    const accounts = require('../accounts');
    const invites = require('../invites');
    await orgs.init();
    const owner = await aPerson('lng');
    assert.deepStrictEqual(await accounts.setLang(owner, 'de'), { ok: true, lang: 'de' });
    assert.strictEqual((await accounts.setLang(owner, 'fr')).reason, 'bad-lang');
    assert.strictEqual((await accounts.readUser(owner)).lang, 'de');

    const email = (await db.query('SELECT email_enc, email_hash FROM users WHERE id = $1', [owner])).rows[0];
    const address = db.open('signup-email:' + email.email_hash, email.email_enc);
    assert.strictEqual(await accounts.langOfEmail(address), 'de');
    assert.strictEqual(await accounts.langOfEmail(address.toUpperCase()), 'de', 'the lookup cares about case');
    assert.strictEqual(await accounts.langOfEmail('nobody' + Date.now() + '@primjer.hr'), '');

    const orgId = (await orgs.create(owner, 'Lang ' + Date.now(), 'localhost', 'owner')).org.id;
    const made = await invites.create(orgId, owner, { email: 'lng' + Date.now() + '@primjer.hr', role: 'viewer', days: 7, lang: 'hr' });
    assert.ok(made.ok, made.reason);
    assert.strictEqual((await invites.read(made.secret)).lang, 'hr');
    const again = await invites.resend(orgId, made.invite.id, owner, 7);
    assert.strictEqual(again.lang, 'hr', 'a resend forgot the language');
    const listed = (await invites.listFor(orgId)).find((i) => String(i.id) === String(made.invite.id));
    assert.ok(listed && !('lang' in listed), 'the team page is told the language');
    assert.ok(!('lang' in made.invite));
});

// Only the person an invitation is for can turn it down. Once they have, it
// cannot be accepted, the team page still shows it with the answer, and
// sending it again opens it again.
test('an invitation is declined by the person it is for, and opened again by a resend', live, async () => {
    const invites = require('../invites');
    const accounts = require('../accounts');
    await orgs.init();
    const owner = await aPerson('dcl');
    const orgId = (await orgs.create(owner, 'Decline ' + Date.now(), 'localhost', 'owner')).org.id;
    const guest = await aPerson('gst');
    const g = await accounts.readUser(guest);
    const made = await invites.create(orgId, owner, { email: g.email, role: 'viewer', days: 7 });
    assert.ok(made.ok, made.reason);

    const stranger = { userId: owner, email: 'someone-else@primjer.hr', totpOn: false, mfa: false };
    assert.strictEqual((await invites.decline(made.secret, stranger)).reason, 'not-yours');

    const me = { userId: guest, email: g.email, totpOn: false, mfa: false };
    assert.ok((await invites.decline(made.secret, me)).ok);
    assert.strictEqual((await invites.read(made.secret)).state, 'declined');
    assert.strictEqual((await invites.accept(made.secret, me)).reason, 'declined', 'a declined invitation was accepted');
    assert.strictEqual((await invites.decline(made.secret, me)).reason, 'declined');
    const row = (await invites.listFor(orgId)).find((i) => String(i.id) === String(made.invite.id));
    assert.ok(row && row.state === 'declined' && row.declinedAt, 'the team page lost the answer');

    const again = await invites.resend(orgId, made.invite.id, owner, 7);
    assert.ok(again.ok, again.reason);
    assert.strictEqual((await invites.read(again.secret)).state, 'sent');
    assert.ok((await invites.accept(again.secret, me)).ok);
});

// The picture is a number on the account, set by the account, shown to the
// people it shares an organisation with, and only ever a number.
test('an account keeps the picture it picked, and the team page is told', live, async () => {
    const accounts = require('../accounts');
    await orgs.init();
    const owner = await aPerson('pic');
    const orgId = (await orgs.create(owner, 'Pictures ' + Date.now(), 'localhost', 'owner')).org.id;
    assert.strictEqual((await accounts.setAvatar(owner, 4294967295)).avatar, 4294967295);
    assert.strictEqual((await accounts.setAvatar(owner, -1)).reason, 'bad-avatar');
    assert.strictEqual((await accounts.setAvatar(owner, 1.5)).reason, 'bad-avatar');
    assert.strictEqual((await accounts.setAvatar(owner, '<svg>')).reason, 'bad-avatar');
    assert.strictEqual((await accounts.setAvatar(owner, 4294967296)).reason, 'bad-avatar');
    await accounts.setAvatar(owner, 123456);
    const rows = await orgs.members(owner, orgId);
    assert.strictEqual(rows.find((r) => r.you).avatar, 123456);
    assert.deepStrictEqual(await accounts.setAvatar(owner, null), { ok: true, avatar: null });
    assert.strictEqual((await orgs.members(owner, orgId)).find((r) => r.you).avatar, null);
});

// The audit logs page reads an account's own trail a page at a time. Lines
// written in the same instant are neither read twice nor stepped over, a
// group filter keeps only its kinds, and another account's lines never show.
test('an account reads its own trail, filtered and a page at a time', live, async () => {
    const accounts = require('../accounts');
    const me = 'trail-' + crypto.randomBytes(4).toString('hex');
    const other = me + '-other';
    const kinds = ['login', 'token-created', '2fa-on', 'login', 'token-deleted', 'org-created', 'login'];
    for (const k of kinds) {
        await db.query("INSERT INTO audit_events (kind, actor, at) VALUES ($1, $2, now() - interval '1 minute')", [k, me]);
    }
    await db.query("INSERT INTO audit_events (kind, actor) VALUES ('login', $1)", [other]);
    const seen = [];
    let cursor = '';
    for (let i = 0; i < 5; i++) {
        const page = await accounts.accountTrail(me, { limit: 2, cursor });
        page.rows.forEach((r) => seen.push(String(r.id)));
        if (!page.more) break;
        cursor = page.cursor;
    }
    assert.strictEqual(seen.length, kinds.length, 'a page read a line twice or skipped one');
    assert.strictEqual(new Set(seen).size, kinds.length);
    const tokensOnly = await accounts.accountTrail(me, { groups: ['tokens'] });
    assert.deepStrictEqual(tokensOnly.rows.map((r) => r.kind).sort(), ['token-created', 'token-deleted']);
    const asc = await accounts.accountTrail(me, { order: 'asc', limit: 50 });
    assert.ok(asc.rows.every((r, i) => i === 0 || new Date(asc.rows[i - 1].at) <= new Date(r.at)));
    const none = await accounts.accountTrail(me, { from: new Date(Date.now() + 3600000).toISOString() });
    assert.strictEqual(none.rows.length, 0, 'a window in the future found lines');
    await db.query('DELETE FROM audit_events WHERE actor = $1 OR actor = $2', [me, other]);
});
