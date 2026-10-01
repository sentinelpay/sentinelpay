'use strict';

// What a person decided about a check.
//
// Everything the engine writes about a check is a machine's answer: on the
// list or not, a hundred or nothing, sealed and dated. None of it is a
// decision, and a regulator does not ask how many addresses were screened --
// they ask who looked at the one that matched and what they concluded. Until
// this existed the product had the words for that translated into three
// languages and nothing behind them.
//
// So what is held here is what makes the answer worth having a year later: the
// reason cannot be skipped, the history cannot be overwritten, the name
// survives the account, and a check that never needed anybody cannot be given
// a decision at all.

const test = require('node:test');
const assert = require('node:assert');
const db = require('../db.js');
const orgs = require('../orgs.js');
const accounts = require('../accounts.js');
const screening = require('../screening.js');

const live = db.available();

async function aPerson(email) {
    const start = await accounts.startSignup({
        email, name: 'Ana Analyst', password: 'a long enough passphrase', lang: 'en', flags: [],
    });
    const done = await accounts.verifySignup(email, start.code, start.origin);
    assert.ok(done.ok && done.userId, 'could not make a person to test with');
    return done.userId;
}

// A flagged check to work. The engine only flags an address that is on the
// list, so the row is written the way the engine writes one and then made to
// look like a hit -- which is also the only way to test this without the list.
async function anAlert(orgId, userId) {
    const made = await screening.screen(userId, orgId,
        'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'live', false, null);
    assert.ok(made.ok && made.id, 'the check did not run');
    await db.query("UPDATE screenings SET verdict = 'severe', score = 100 WHERE id = $1", [made.id]);
    return made.id;
}

async function aClearCheck(orgId, userId) {
    const made = await screening.screen(userId, orgId,
        'bc1q9d4ywgfnd8h43da5tpcxcn6ajv590cnrm0247d', 'live', false, null);
    assert.ok(made.ok && made.id, 'the check did not run');
    await db.query("UPDATE screenings SET verdict = 'clear', score = 0 WHERE id = $1", [made.id]);
    return made.id;
}

test('the four states are the only four', () => {
    assert.deepStrictEqual(screening.DECISIONS, ['holding', 'cleared', 'confirmed', 'open']);
    assert.deepStrictEqual(screening.DECIDED, ['cleared', 'confirmed']);
    assert.deepStrictEqual(screening.NEEDS_WHY, ['cleared', 'confirmed']);
});

test('a conclusion without a reason is refused', { skip: !live }, async () => {
    await orgs.init();
    const who = await aPerson('dec1-' + Date.now() + '@example.com');
    const org = (await orgs.create(who, 'Decide', 'localhost', 'owner')).org;
    const id = await anAlert(org.id, who);

    for (const state of ['cleared', 'confirmed']) {
        const out = await screening.decide(org.id, id, { id: who, name: 'Ana' }, state, '   ');
        assert.strictEqual(out.ok, false, state + ' was accepted with no reason');
        assert.strictEqual(out.reason, 'needs-why');
    }

    // taking one up, or putting it back, is not a conclusion and needs none
    const held = await screening.decide(org.id, id, { id: who, name: 'Ana' }, 'holding', '');
    assert.strictEqual(held.ok, true, 'taking an alert up needed an argument');

    const back = await screening.decide(org.id, id, { id: who, name: 'Ana' }, 'open', '');
    assert.strictEqual(back.ok, true, 'putting an alert back needed an argument');
});

test('a word nobody meant is not a state', { skip: !live }, async () => {
    await orgs.init();
    const who = await aPerson('dec2-' + Date.now() + '@example.com');
    const org = (await orgs.create(who, 'Decide two', 'localhost', 'owner')).org;
    const id = await anAlert(org.id, who);
    for (const bad of ['', 'done', 'CLEARED', 'clear', null, 7]) {
        const out = await screening.decide(org.id, id, { id: who, name: 'Ana' }, bad, 'because');
        assert.strictEqual(out.ok, false, JSON.stringify(bad) + ' was taken as a state');
        assert.strictEqual(out.reason, 'bad-state');
    }
});

// A queue that can be filled by hand with checks that never needed anybody is a
// queue nobody trusts.
test('a check that came back clear cannot be decided about', { skip: !live }, async () => {
    await orgs.init();
    const who = await aPerson('dec3-' + Date.now() + '@example.com');
    const org = (await orgs.create(who, 'Decide three', 'localhost', 'owner')).org;
    const id = await aClearCheck(org.id, who);
    const out = await screening.decide(org.id, id, { id: who, name: 'Ana' }, 'cleared', 'looks fine');
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.reason, 'not-an-alert');
});

test('a decision is kept, read back, and sealed', { skip: !live }, async () => {
    await orgs.init();
    const who = await aPerson('dec4-' + Date.now() + '@example.com');
    const org = (await orgs.create(who, 'Decide four', 'localhost', 'owner')).org;
    const id = await anAlert(org.id, who);

    const out = await screening.decide(org.id, id, { id: who, name: 'Ana Analyst' },
        'cleared', 'Same name, different person: date of birth does not match.');
    assert.strictEqual(out.ok, true);
    assert.ok(out.digest, 'the decision was not sealed');

    const back = await screening.byId(org.id, id, false);
    assert.strictEqual(back.state, 'cleared', 'the check does not carry the decision');
    assert.strictEqual(back.decidedBy, 'Ana Analyst', 'the check does not say who decided');
    assert.ok(back.decidedAt, 'the check does not say when');
    assert.strictEqual(back.history.length, 1);
    assert.strictEqual(back.history[0].note,
        'Same name, different person: date of birth does not match.',
        'the reason did not survive being sealed and opened');

    // and the note is not sitting in the table in the clear
    const raw = await db.query('SELECT note_enc, actor_enc FROM check_decisions WHERE screening_id = $1', [id]);
    assert.doesNotMatch(raw.rows[0].note_enc, /different person/,
        'the reason is stored in the clear');
    assert.doesNotMatch(raw.rows[0].actor_enc, /Ana/,
        'the name is stored in the clear');
});

// The part that has to survive being argued with.
test('changing a decision keeps the one before it', { skip: !live }, async () => {
    await orgs.init();
    const who = await aPerson('dec5-' + Date.now() + '@example.com');
    const org = (await orgs.create(who, 'Decide five', 'localhost', 'owner')).org;
    const id = await anAlert(org.id, who);

    await screening.decide(org.id, id, { id: who, name: 'Ana' }, 'cleared', 'false positive');
    await screening.decide(org.id, id, { id: who, name: 'Boris' }, 'confirmed', 'it is them after all');

    const back = await screening.byId(org.id, id, false);
    assert.strictEqual(back.state, 'confirmed', 'the newest decision is not the one in force');
    assert.strictEqual(back.history.length, 2, 'a decision was overwritten');
    assert.strictEqual(back.history[0].state, 'confirmed');
    assert.strictEqual(back.history[1].state, 'cleared',
        'the first decision is gone, along with the fact that anybody made it');
    assert.strictEqual(back.history[1].note, 'false positive',
        'the reason given the first time is gone');
    assert.strictEqual(back.history[1].by, 'Ana', 'who gave the first answer is gone');
});

// Putting an alert back means putting it back: a check nobody has concluded
// about must not carry somebody's name as though they had.
test('an alert put back is open again, with nobody on it', { skip: !live }, async () => {
    await orgs.init();
    const who = await aPerson('dec6-' + Date.now() + '@example.com');
    const org = (await orgs.create(who, 'Decide six', 'localhost', 'owner')).org;
    const id = await anAlert(org.id, who);

    await screening.decide(org.id, id, { id: who, name: 'Ana' }, 'cleared', 'false positive');
    await screening.decide(org.id, id, { id: who, name: 'Ana' }, 'open', '');

    const back = await screening.byId(org.id, id, false);
    assert.strictEqual(back.state, 'open');
    assert.strictEqual(back.decidedAt, null, 'a reopened alert still says when it was decided');
    assert.strictEqual(back.decidedBy, '', 'a reopened alert still has somebody\'s name on it');
    assert.strictEqual(back.history.length, 2, 'reopening did not go into the history');
    assert.strictEqual(back.history[0].state, 'open',
        'the history does not record that it was put back');
});

test('the queue is what is still work, counted apart', { skip: !live }, async () => {
    await orgs.init();
    const who = await aPerson('dec7-' + Date.now() + '@example.com');
    const org = (await orgs.create(who, 'Decide seven', 'localhost', 'owner')).org;
    const a = await anAlert(org.id, who);
    const b = await anAlert(org.id, who);
    const c = await anAlert(org.id, who);
    await aClearCheck(org.id, who);

    await screening.decide(org.id, b, { id: who, name: 'Ana' }, 'holding', '');
    await screening.decide(org.id, c, { id: who, name: 'Ana' }, 'cleared', 'false positive');

    const q = await screening.queue(org.id, false, 20);
    assert.strictEqual(q.open, 1, 'the open alerts are miscounted');
    assert.strictEqual(q.holding, 1, 'an alert somebody is on is counted as nobody\'s');
    assert.strictEqual(q.cleared, 1);
    assert.strictEqual(q.rows.length, 2, 'the queue is not what is still work');

    const ids = q.rows.map((r) => String(r.id));
    assert.ok(ids.indexOf(String(a)) !== -1, 'an open alert is missing from the queue');
    assert.ok(ids.indexOf(String(b)) !== -1, 'an alert on hold fell out of the queue');
    assert.ok(ids.indexOf(String(c)) === -1, 'a decided alert is still in the queue');

    // and a clear check was never in it
    assert.strictEqual(q.rows.every((r) => r.verdict !== 'clear'), true,
        'a check that came back clear is in the queue');
});

test('the log can be asked what is still work', { skip: !live }, async () => {
    await orgs.init();
    const who = await aPerson('dec8-' + Date.now() + '@example.com');
    const org = (await orgs.create(who, 'Decide eight', 'localhost', 'owner')).org;
    const a = await anAlert(org.id, who);
    const b = await anAlert(org.id, who);
    await screening.decide(org.id, b, { id: who, name: 'Ana' }, 'cleared', 'false positive');

    const open = await screening.log(org.id, { state: 'open' });
    assert.deepStrictEqual(open.rows.map((r) => String(r.id)), [String(a)]);

    const done = await screening.log(org.id, { state: 'cleared' });
    assert.deepStrictEqual(done.rows.map((r) => String(r.id)), [String(b)]);

    const waiting = await screening.log(org.id, { state: 'waiting' });
    assert.deepStrictEqual(waiting.rows.map((r) => String(r.id)), [String(a)]);

    // and every row says what state it is in, so a list can show it
    const all = await screening.log(org.id, {});
    assert.strictEqual(all.rows.every((r) => typeof r.state === 'string'), true,
        'the log does not say what state a check is in');
});
