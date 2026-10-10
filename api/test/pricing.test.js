'use strict';

// The pricing page and the catalogue, held against each other.
//
// plans.js has said from the beginning that a quota living only in a card's
// bullet list cannot be enforced, and it was right in a way nobody noticed:
// the page sold ten thousand screenings a month while the product allowed a
// term's worth at a time, and no test could see the disagreement because one
// side was html.
//
// So the page marks each claim with the catalogue key it is making, and this
// checks the two agree. Wording is free -- a card argues for a sale and the
// dashboard describes what somebody has, and those are not the same sentence
// -- but a claim cannot appear on one side and be missing from the other, and
// a number cannot be printed that the product does not allow.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const plans = require('../plans.js');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'pricing.html'), 'utf8');

// Enough of a parser for one known page: every plan card, and the feature keys
// inside it. A card is a div carrying data-plan, and it ends where the next one
// begins.
function cards() {
    const out = {};
    const open = /<div class="lp-plan-card[^"]*" data-plan="([a-z]+)">/g;
    const starts = [];
    let m;
    while ((m = open.exec(HTML))) starts.push({ plan: m[1], at: m.index });
    for (let i = 0; i < starts.length; i++) {
        const to = i + 1 < starts.length ? starts[i + 1].at : HTML.length;
        out[starts[i].plan] = HTML.slice(starts[i].at, to);
    }
    return out;
}

function keysIn(card) {
    const found = new Set();
    const feat = /data-feat="([^"]+)"/g;
    let m;
    while ((m = feat.exec(card))) {
        for (const k of m[1].split(/\s+/)) if (k) found.add(k);
    }
    return found;
}

// A plain <li> with no data-feat is a claim the catalogue has never heard of.
function untagged(card) {
    const out = [];
    const li = /<li class="lp-plan-feat(?: lp-plan-swap)?"(?: data-feat="[^"]*")?>([\s\S]*?)<\/li>/g;
    let m;
    while ((m = li.exec(card))) {
        if (m[0].indexOf('data-feat=') === -1) out.push(m[1].replace(/<[^>]*>/g, '').trim());
    }
    return out;
}

const CARDS = cards();
const SOLD = ['starter', 'growth', 'enterprise'];

test('the pricing page shows a card for every plan in the catalogue', () => {
    for (const key of Object.keys(plans.PLANS)) {
        assert.ok(CARDS[key], 'no pricing card for the ' + key + ' plan');
    }
    assert.ok(CARDS.trial, 'no pricing card for the free trial');
});

test('every claim on a card is a claim the catalogue knows', () => {
    const quota = new Set(plans.QUOTA_FEATURES);
    for (const plan of ['trial'].concat(SOLD)) {
        const known = new Set(plans.carries(plan).map((f) => f.key));
        for (const key of keysIn(CARDS[plan])) {
            assert.ok(known.has(key) || quota.has(key),
                'the ' + plan + ' card claims "' + key + '", which no tier carries');
        }
    }
});

test('every claim in the catalogue reaches the page', () => {
    for (const plan of ['trial'].concat(SOLD)) {
        const on = keysIn(CARDS[plan]);
        // A card may restate something it inherits -- growth says the history
        // sweep again -- so only what this tier adds has to appear on it.
        const adds = plans.carries(plan).filter((f) => f.tier === plan);
        for (const f of adds) {
            assert.ok(on.has(f.key),
                'the catalogue gives ' + plan + ' "' + f.key + '" and the card never says so');
        }
    }
});

test('no bullet on a plan card is untethered from the catalogue', () => {
    for (const plan of ['trial'].concat(SOLD)) {
        const loose = untagged(CARDS[plan]);
        assert.deepStrictEqual(loose, [],
            'the ' + plan + ' card makes claims the catalogue cannot see: ' + loose.join(' | '));
    }
});

// The bug that started this. A quarterly plan is invoiced for three months and
// allowed three months of screening in one go, so the card has to say a
// quarter's worth, not a month's.
test('the quotas printed on a card are the quotas the product allows', () => {
    const fmt = (n) => n.toLocaleString('en-US');
    for (const plan of SOLD) {
        const card = CARDS[plan];
        const q = plans.included(plan, 'quarterly');
        const y = plans.included(plan, 'yearly');

        const swapQ = /<span class="lp-swap-q">([^<]*)<\/span>/.exec(card);
        const swapY = /<span class="lp-swap-y">([^<]*)<\/span>/.exec(card);
        assert.ok(swapQ && swapY, 'the ' + plan + ' card has no quarterly and yearly quota row');
        assert.ok(swapQ[1].includes(fmt(q.screenings)),
            'the ' + plan + ' card says "' + swapQ[1] + '" for a quarter, but the plan allows ' +
            fmt(q.screenings));
        assert.ok(swapY[1].includes(fmt(y.screenings)),
            'the ' + plan + ' card says "' + swapY[1] + '" for a year, but the plan allows ' +
            fmt(y.screenings));

        const addr = /data-feat="quota-addresses">([^<]*)</.exec(card);
        const seats = /data-feat="quota-seats">([^<]*)</.exec(card);
        assert.ok(addr[1].includes(fmt(q.addresses)),
            'the ' + plan + ' card says "' + addr[1] + '", but the plan allows ' + fmt(q.addresses));
        assert.ok(seats[1].includes(fmt(q.seats)),
            'the ' + plan + ' card says "' + seats[1] + '", but the plan allows ' + fmt(q.seats));
    }
});

test('a plan carries everything under it, and in order', () => {
    const growth = plans.carries('growth').map((f) => f.key);
    const starter = plans.carries('starter').map((f) => f.key);
    assert.deepStrictEqual(growth.slice(0, starter.length), starter,
        'growth should begin with everything starter carries, unchanged and in the same order');
    assert.ok(growth.length > starter.length, 'growth should add something of its own');
    assert.deepStrictEqual(plans.carries('nonsense'), [], 'an unknown plan carries nothing');
});

// The product shows what we ship. Not because the pricing page is dishonest --
// that is a commercial decision and not this file's business -- but because the
// same sentence beside a meter of what somebody is already using reads as a
// description of what they have rather than an argument for buying it.
test('shipped and promised divide what a plan carries, with nothing lost', () => {
    for (const plan of ['trial'].concat(SOLD)) {
        const all = plans.carries(plan).map((f) => f.key).sort();
        const split = plans.shipped(plan).concat(plans.promised(plan)).map((f) => f.key).sort();
        assert.deepStrictEqual(split, all, 'shipped and promised do not add back up for ' + plan);
        for (const f of plans.shipped(plan)) assert.strictEqual(f.built, true);
        for (const f of plans.promised(plan)) assert.strictEqual(f.built, false);
    }
});

// Only OFAC SDN is loaded. Until the others are, the catalogue has to say so,
// or the dashboard will tell a paying customer we check lists we do not have.
test('a list we do not load is not marked as shipped', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'sanctions.js'), 'utf8');
    const loadsEU = /\bEU_|eu_sanctions|consolidated/i.test(source);
    if (loadsEU) return; // built since: this test has done its job and can go
    const eu = plans.carries('trial').find((f) => f.key === 'lists-eu-uk-un');
    assert.ok(eu, 'the EU, UK and UN claim should still be in the catalogue');
    assert.strictEqual(eu.built, false,
        'sanctions.js loads only the OFAC SDN list, so this cannot be marked as built');
});

// What the product says it has, and what it says it owes.
//
// The dashboard used to render only what we ship, on the reasoning that
// "coming soon" beside a paid feature reads as an excuse. That is the wrong
// half of the choice: a customer on Growth is paying for the EU, UK and UN
// lists today, and leaving the line out does not make the gap smaller -- it
// makes it invisible to the one person who most needs to see it. Said with the
// word that is true, it is a disclosure; said nowhere, the pricing page
// quietly disagrees with the product and nobody can see where.
test('a plan carries everything it is sold as carrying, marked for what it is', () => {
    const all = plans.carries('growth');
    assert.ok(all.length > plans.shipped('growth').length,
        'the dashboard is being sent only what we ship again');
    for (const f of all) {
        assert.strictEqual(typeof f.built, 'boolean',
            f.key + ' does not say whether it is built');
    }
    // the one that matters most
    const lists = all.find((f) => f.key === 'lists-eu-uk-un');
    assert.ok(lists, 'the EU, UK and UN lists are not in what Growth carries');
    assert.strictEqual(lists.built, false,
        'the lists are marked built -- if that is true, sanctions.js should load them');
});

test('what a plan does not carry is the tiers above it, and nothing else', () => {
    const beyond = plans.beyond('growth');
    assert.deepStrictEqual(beyond.map((f) => f.tier), ['enterprise', 'enterprise'],
        'a plan is shown things it already has, or things that belong to nobody');

    // every line has to say which plan it is in: "it is in Growth" is the whole
    // of the answer to "why do I not have it"
    for (const f of plans.beyond('trial')) {
        assert.ok(f.tier, f.key + ' belongs to no plan');
        assert.strictEqual(typeof f.built, 'boolean',
            f.key + ' does not say whether it is built');
    }

    // and the top of the ladder is owed nothing by anybody above it
    assert.deepStrictEqual(plans.beyond('enterprise'), []);

    // nothing is in both lists
    const mine = new Set(plans.carries('starter').map((f) => f.key));
    for (const f of plans.beyond('starter')) {
        assert.ok(!mine.has(f.key), f.key + ' is both carried and not carried');
    }
});

test('the dashboard draws the difference rather than hiding it', () => {
    const src = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '..', 'public', 'dash-app.js'), 'utf8');
    assert.match(src, /plans\.carries|out\.includes|u\.includes/, 'the plan list is gone');
    assert.match(src, /r\.built \? '' : ' is-soon'/,
        'an unbuilt feature is drawn the same as a built one');
    assert.match(src, /t\('Coming'\)/, 'nothing says a feature is not here yet');
    assert.match(src, /t\('Not in this plan'\)/, 'nothing lists what the plan does not carry');

    const css = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '..', 'public', 'dash.css'), 'utf8');
    // a tick is a thing that is here; drawing one beside a thing that is not
    // would be the lie the word next to it exists to prevent
    assert.match(css, /\.use-carry\.is-soon::before\s*\{[^}]*border-radius:\s*50%/,
        'a feature that is not built still gets a tick');
});
