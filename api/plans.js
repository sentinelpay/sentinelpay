'use strict';

// What we sell, as data.
//
// This is the same catalogue as the pricing page, in one place the server can
// read. It exists because a price that lives only in html cannot be checked
// against what somebody was charged, and a quota that lives only in a card's
// bullet list cannot be enforced.
//
// A word of warning about names. `trials.state` has a value called 'starter'
// which means the first stage of a free trial, and this file has a plan called
// 'starter' which is a thing you buy for money. They are different vocabularies
// that happen to share a word. Nothing in the code should ever compare one to
// the other: a trial has a state, an organisation has a subscription, and the
// screen decides what to show by asking which of the two exists.
//
// Prices are in cents, so nothing here is ever a float. VAT is not included,
// which the pricing page says out loud and an invoice would have to.

const CURRENCY = 'EUR';

// quarterly and yearly are paid for the whole term up front. per-scan has no
// term at all: it bills what was used, month by month, and can be left at any
// time. That difference is why `termMonths` is null for it rather than 1.
const TERMS = {
    quarterly: { key: 'quarterly', termMonths: 3, upfront: true },
    yearly: { key: 'yearly', termMonths: 12, upfront: true },
    scan: { key: 'scan', termMonths: null, upfront: false, metered: true },
};

const PLANS = {
    starter: {
        key: 'starter',
        name: 'Starter',
        screenings: 1000,
        addresses: 100,
        seats: 3,
        // what the term costs in total, not per month: it is what leaves the
        // bank account, and per month is arithmetic we can do for display
        price: { quarterly: 29700, yearly: 98400 },
        perScan: 25,
    },
    growth: {
        key: 'growth',
        name: 'Growth',
        screenings: 10000,
        addresses: 2500,
        seats: 10,
        price: { quarterly: 119700, yearly: 398400 },
        perScan: 15,
    },
    enterprise: {
        key: 'enterprise',
        name: 'Enterprise',
        screenings: 50000,
        addresses: 25000,
        seats: 25,
        price: { quarterly: 447000, yearly: 1488000 },
        perScan: 8,
        // the page says "from", and it means it: this one is agreed, so a
        // subscription may carry a price that is not the one listed here
        negotiated: true,
    },
};

function plan(key) {
    return PLANS[String(key || '').toLowerCase()] || null;
}

function term(key) {
    return TERMS[String(key || '').toLowerCase()] || null;
}

// What this plan on this term costs, in cents, or null when there is no list
// price to read (per-scan is billed on use, enterprise is agreed).
function listPrice(planKey, termKey) {
    const p = plan(planKey);
    const t = term(termKey);
    if (!p || !t) return null;
    if (t.metered) return null;
    const cents = p.price[t.key];
    return typeof cents === 'number' ? cents : null;
}

function isPlan(key) {
    return Boolean(plan(key));
}

function isTerm(key) {
    return Boolean(term(key));
}

// Everything a screen needs to show the catalogue without knowing these shapes.
function catalogue() {
    return {
        currency: CURRENCY,
        terms: Object.keys(TERMS).map((k) => ({ ...TERMS[k] })),
        plans: Object.keys(PLANS).map((k) => ({ ...PLANS[k] })),
    };
}

module.exports = {
    CURRENCY, PLANS, TERMS,
    plan, term, listPrice, isPlan, isTerm, catalogue,
};
