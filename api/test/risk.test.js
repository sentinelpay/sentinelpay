'use strict';

// Where an organisation draws the line between a score worth a look and one
// worth acting on.
//
// Two things are checked here and they are different in kind. One is that the
// setter refuses what nobody meant to write, because a band that is not a
// whole number between one and a hundred starts colouring checks by accident.
// The other is that a check records the bands it was measured against -- which
// is not a nicety: this product promises a verdict reproducible a year later,
// and a score of sixty means one thing under a middle band of fifty-one and
// another under one of seventy. A sealed check that records the score and not
// the lines records half a verdict.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db.js');
const orgs = require('../orgs.js');
const accounts = require('../accounts.js');

const live = db.available();

async function aPerson(email) {
    const start = await accounts.startSignup({
        email, name: 'Bands', password: 'a long enough passphrase', lang: 'en', flags: [],
    });
    const done = await accounts.verifySignup(email, start.code, start.origin);
    // the id is on the answer, not on the session it also hands back: the
    // session carries a token and how long it lasts and nothing else
    assert.ok(done.ok && done.userId, 'could not make a person to test with');
    return done.userId;
}

test('the bands ship with the product', () => {
    assert.deepStrictEqual(orgs.RISK_DEFAULT, { mid: 51, high: 81, severe: 100 });
});

test('a band nobody meant is refused', { skip: !live }, async () => {
    await orgs.init();
    const who = await aPerson('bands-' + Date.now() + '@example.com');
    const made = await orgs.create(who, 'Bands', 'localhost', 'owner');
    const id = made.org.id;

    for (const [mid, high, severe, why] of [
        [0, 80, 95, 'a band below one'],
        [51, 81, 101, 'a band above a hundred'],
        [80, 80, 95, 'a middle equal to the one above it'],
        [90, 50, 95, 'a middle above the one above it'],
        [51.5, 80, 95, 'a band that is not whole'],
        ['fifty', 80, 95, 'a band that is not a number'],
        [null, 80, 95, 'a band that is missing'],
        [40, 70, 70, 'a top equal to the one below it'],
        [40, 70, 60, 'a top below the one below it'],
        [40, 70, null, 'a top that is missing'],
    ]) {
        const out = await orgs.setRisk(id, mid, high, severe);
        assert.strictEqual(out.ok, false, why + ' was accepted');
        assert.strictEqual(out.reason, 'bad-bands', why + ' gave the wrong reason');
    }

    // and the organisation still has what it shipped with
    const back = await orgs.membership(who, id);
    assert.deepStrictEqual(back.risk, orgs.RISK_DEFAULT,
        'a refused band changed the organisation anyway');
});

test('a band that makes sense is kept, and read back', { skip: !live }, async () => {
    await orgs.init();
    const who = await aPerson('bands2-' + Date.now() + '@example.com');
    const made = await orgs.create(who, 'Bands two', 'localhost', 'owner');

    const out = await orgs.setRisk(made.org.id, 40, 70, 90);
    assert.strictEqual(out.ok, true);
    assert.deepStrictEqual(out.org.risk, { mid: 40, high: 70, severe: 90 });

    const back = await orgs.membership(who, made.org.id);
    assert.deepStrictEqual(back.risk, { mid: 40, high: 70, severe: 90 },
        'the bands did not survive being read back');
});

// The part that matters a year from now.
test('a check seals the bands it was measured against', { skip: !live }, async () => {
    const screening = require('../screening.js');
    await orgs.init();
    const who = await aPerson('bands3-' + Date.now() + '@example.com');
    const made = await orgs.create(who, 'Bands three', 'localhost', 'owner');
    await orgs.setRisk(made.org.id, 30, 60, 85);

    // no bands passed: the token path has none, and the check has to find
    // them rather than fall back to what the product ships with
    const done = await screening.screen(who, made.org.id,
        'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'live', false, null);
    assert.strictEqual(done.ok, true, 'the check did not run');

    const one = await screening.byId(made.org.id, done.id, false);
    assert.ok(one, 'the check could not be opened');
    assert.deepStrictEqual(one.bands, { mid: 30, high: 60, severe: 85 },
        'the check did not record the lines it was read against');

    // and moving the line afterwards does not move what was already sealed
    await orgs.setRisk(made.org.id, 10, 20, 30);
    const again = await screening.byId(made.org.id, done.id, false);
    assert.deepStrictEqual(again.bands, { mid: 30, high: 60, severe: 85 },
        'moving the bands rewrote a verdict that had already been given');
});

// The dashboard reads the same lines the server wrote, and refuses nonsense the
// same way rather than colouring by accident.
test('the screen falls back where the bands make no sense', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'dash-app.js'), 'utf8');
    const at = src.indexOf('function riskLines()');
    assert.notStrictEqual(at, -1, 'the dashboard no longer reads the bands from the organisation');
    const body = src.slice(at, at + 700);
    assert.match(body, /lastMe && lastMe\.org && lastMe\.org\.risk/,
        'the bands are not read from the organisation');
    assert.match(body, /mid >= 1 && mid < high && high < severe && severe <= 100/,
        'the dashboard does not check the bands before using them');
    assert.match(body, /return RISK_BANDS/,
        'there is no fallback when the bands make no sense');
});
