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
        screeningsPerMonth: 1000,
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
        screeningsPerMonth: 10000,
        addresses: 2500,
        seats: 10,
        price: { quarterly: 119700, yearly: 398400 },
        perScan: 15,
    },
    enterprise: {
        key: 'enterprise',
        name: 'Enterprise',
        screeningsPerMonth: 50000,
        addresses: 25000,
        seats: 25,
        price: { quarterly: 447000, yearly: 1488000 },
        perScan: 8,
        // the page says "from", and it means it: this one is agreed, so a
        // subscription may carry a price that is not the one listed here
        negotiated: true,
    },
};

// The half of a plan that is not a number.
//
// Quotas were data here from the start, because a quota that lives only in a
// card's bullet list cannot be enforced. Everything else a plan carries -- the
// lists, the monitoring, the evidence file, the response time -- stayed in the
// pricing page's bullet lists, which meant the product could not say what a
// customer had bought without pointing at the sales page. So it is data too.
//
// Tiers are cumulative the way the pricing cards say they are: a Growth
// customer has what Growth adds and everything under it. `carries()` does that
// walk, so nothing has to repeat a line to inherit it.
//
// `built` is the part that matters. A claim on a pricing page is a promise to
// somebody deciding whether to buy; the same claim inside the product, beside
// the meter counting what they are using, reads as a description of what they
// already have. Those are not the same sentence. Anything not built yet is
// false here, and the dashboard shows only what is true -- so the gap between
// what we sell and what we ship is a value that can be queried and counted,
// rather than something remembered.
const TIERS = [
    {
        key: 'trial',
        adds: [
            { key: 'history-sweep', built: false,
              text: 'A one-off sweep of a connected key, back through its whole history' },
            // Only OFAC SDN is loaded (see sanctions.js). The other three are
            // sold and not built, which is why this is the one claim on the
            // page that a customer could most reasonably feel misled by.
            { key: 'lists-ofac', built: true,
              text: 'Counterparties screened against the OFAC SDN list' },
            { key: 'lists-eu-uk-un', built: false,
              text: 'Counterparties screened against the EU, UK and UN lists' },
            { key: 'verdict-fast', built: true,
              text: 'An answer in under a second, with its evidence attached' },
            { key: 'evidence-file', built: true,
              text: 'An evidence file you keep, whether or not you stay' },
        ],
    },
    {
        key: 'starter',
        adds: [
            { key: 'rescreen-on-change', built: false,
              text: 'Re-screened the moment a list changes' },
            { key: 'reproducible', built: true,
              text: 'Any verdict reproducible a year later' },
            { key: 'data-export', built: true,
              text: 'Your data leaves with you, in full, on request' },
        ],
    },
    {
        key: 'growth',
        adds: [
            { key: 'chains', built: false,
              text: 'Ten chains from one key, not ten integrations' },
            { key: 'monitoring', built: false,
              text: 'Continuous monitoring and alerts' },
            { key: 'threshold-preview', built: false,
              text: 'See what a threshold would have caught before you set it' },
            { key: 'api', built: true,
              text: 'API access, with a token per project' },
        ],
    },
    {
        key: 'enterprise',
        adds: [
            { key: 'four-eyes', built: false,
              text: 'Four eyes on severe findings, enforced' },
            { key: 'residency-sso', built: false,
              text: 'EU data residency, SSO and an agreed response time' },
        ],
    },
];

// The quota rows, which are numbers and so are already data. They are named
// here only so the pricing page can be checked against them line for line:
// the page once said ten thousand screenings a month while the product allowed
// a quarter of them at a time, and nothing could have caught that.
const QUOTA_FEATURES = ['quota-screenings', 'quota-addresses', 'quota-seats'];

// Everything a plan carries, its own tier and every tier under it, in the order
// the pricing page introduces them. A key not in TIERS at all is nobody's.
function carries(planKey) {
    const want = String(planKey || '').toLowerCase();
    const out = [];
    for (const tier of TIERS) {
        for (const f of tier.adds) out.push({ ...f, tier: tier.key });
        if (tier.key === want) return out;
    }
    // A trial is not a plan, and asking about one is not a mistake: it carries
    // the base tier and nothing else.
    return want === 'trial' ? out.filter((f) => f.tier === 'trial') : [];
}

// What a plan carries and we actually ship. This is what the product shows.
function shipped(planKey) {
    return carries(planKey).filter((f) => f.built);
}

// What a plan is sold as carrying and we do not ship yet.
//
// This used to be rendered by nothing: the dashboard showed only what we ship,
// on the reasoning that "coming soon" beside a paid feature reads as an excuse.
// That was the wrong half of the choice. A customer on Growth is paying for
// the EU, UK and UN lists today -- leaving the line out does not make the gap
// smaller, it makes it invisible, and the one person who most needs to see it
// is the one who bought it. Said plainly, with the word that is true, it is a
// disclosure; said nowhere, it is the pricing page quietly disagreeing with
// the product.
function promised(planKey) {
    return carries(planKey).filter((f) => !f.built);
}

// What a plan does not carry: everything in the tiers above it.
//
// The order is the order the pricing page introduces things, and the tier each
// one belongs to rides along, because "this is in Growth" is the whole of the
// answer to "why do I not have it".
function beyond(planKey) {
    const want = String(planKey || '').toLowerCase();
    const mine = new Set(carries(want).map((f) => f.key));
    const out = [];
    for (const tier of TIERS) {
        for (const f of tier.adds) {
            if (!mine.has(f.key)) out.push({ ...f, tier: tier.key });
        }
    }
    return out;
}

function plan(key) {
    return PLANS[String(key || '').toLowerCase()] || null;
}

function term(key) {
    return TERMS[String(key || '').toLowerCase()] || null;
}

// What a plan allows in one period of a given term.
//
// The catalogue holds a monthly rate because that is the number a buyer
// compares between us and anybody else. A period is a term, though -- a
// quarterly plan is invoiced for three months and allowed three months of
// screening in one go -- so the allowance for a period is the rate times the
// term. Per-scan has no term and no allowance to run out of.
//
// Seats and addresses are not multiplied. Ten seats is ten seats whether the
// invoice covers three months or twelve; they are a standing limit rather than
// something spent and refilled.
function included(planKey, termKey) {
    const p = plan(planKey);
    if (!p) return null;
    const t = term(termKey);
    const span = t && t.termMonths ? t.termMonths : 1;
    return {
        screenings: t && t.metered ? null : p.screeningsPerMonth * span,
        addresses: p.addresses,
        seats: p.seats,
    };
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
    CURRENCY, PLANS, TERMS, TIERS, QUOTA_FEATURES,
    plan, term, included, listPrice, isPlan, isTerm, catalogue,
    carries, shipped, promised, beyond,
};
