'use strict';

// The largest report a period can make, from invented numbers, so the paper
// can be looked at full before any customer fills it.
//
// A year of days, the longest period there is: an annual plan's cycle. Every
// kind of check, every list, programme and role with something in it, sixty
// four chains, two hundred projects, every API endpoint, numbers in the
// millions, and an organisation name of eighty characters. On whichever plan
// is asked for, so each plan's cover can be seen. Only ever served on
// staging and in development, and never written anywhere: it is drawn and
// thrown away.

const NAME = 'Internationale Handels- und Verwahrungsgesellschaft für digitale Vermögenswerte AG';

const CHAINS = ['XBT', 'ETH', 'TRX', 'SOL', 'BNB', 'BASE', 'XRP', 'ARB', 'TON', 'POL', 'LTC', 'DOGE', 'OP', 'AVAX',
    'SUI', 'HYPE', 'ADA', 'XLM', 'HBAR', 'DOT', 'NEAR', 'APT', 'XMR', 'ATOM', 'ETC', 'TAO', 'S', 'ZKS', 'LINEA', 'MNT',
    'CRO', 'ICP', 'FIL', 'KAS', 'ALGO', 'SEI', 'INJ', 'TIA', 'STRK', 'BLAST', 'SCR', 'UNI', 'BERA', 'KAIA', 'XTZ', 'VET',
    'ZEC', 'DASH', 'EOS', 'BSV', 'STX', 'GNO', 'CELO', 'FLR', 'EGLD', 'ZORA', 'FLOW', 'OSMO', 'KAVA', 'RBTC', 'METIS',
    'ONE', 'GLMR', 'BCH'];

const ENDPOINTS = ['POST /v1/screen', 'GET /v1/screenings', 'GET /v1/screenings/stats',
    'GET /v1/screenings/:id', 'GET /v1/screenings/:id/evidence'];

const PROJECT_WORDS = ['Card program', 'OTC desk', 'Retail exchange', 'Custody', 'Payouts', 'Merchant checkout',
    'Treasury', 'Market making', 'Staking', 'Corporate accounts'];

// the same numbers on every run, so two looks at the sample can be compared
function seeded(seed) {
    let x = seed >>> 0;
    return () => {
        x = (x * 1664525 + 1013904223) >>> 0;
        return x / 4294967296;
    };
}

const DAY = 86400000;

// the plan the sample is on, for its cover: Enterprise unless asked
const PLAN_NAMES = { starter: 'Starter', growth: 'Growth', enterprise: 'Enterprise' };

function full(now, plan) {
    const key = PLAN_NAMES[String(plan || '').toLowerCase()] ? String(plan).toLowerCase() : 'enterprise';
    const rnd = seeded(20260914);
    const end = new Date(now || Date.now());
    end.setUTCHours(0, 0, 0, 0);
    const from = new Date(end.getTime() - 365 * DAY);
    const iso = (t) => new Date(t).toISOString();

    // a year of work that grows, quieter at weekends, with a fortnight of
    // nothing in August when an integration was down: the shape of a real one
    const days = [];
    for (let t = from.getTime(), i = 0; t < end.getTime(); t += DAY, i++) {
        const d = new Date(t);
        const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
        const down = d.getUTCMonth() === 7 && d.getUTCDate() >= 4 && d.getUTCDate() <= 17;
        const base = 18000 + i * 90;
        const n = down ? 0 : Math.round(base * (weekend ? 0.42 : 1) * (0.85 + rnd() * 0.3));
        const flagged = Math.round(n * (0.08 + rnd() * 0.04));
        const severe = Math.round(flagged * (0.45 + rnd() * 0.1));
        days.push({ day: iso(t).slice(0, 10), n, flagged, severe, addresses: Math.round(n * 0.71) });
    }
    const sum = (k) => days.reduce((a, d) => a + d[k], 0);
    const total = sum('n');
    const flagged = sum('flagged');
    const severe = sum('severe');

    // a line over the year as a share of each day's checks
    const line = (part) => {
        const ds = days.map((d) => ({ day: d.day, n: Math.round(d.n * part) }));
        return { total: ds.reduce((a, d) => a + d.n, 0), days: ds };
    };
    const after = (part) => {
        const ds = days.map((d) => ({ day: d.day, n: Math.round(d.flagged * part) }));
        return { total: ds.reduce((a, d) => a + d.n, 0), days: ds };
    };

    const chains = CHAINS.map((asset, i) => ({ asset, n: Math.round(total * 0.36 / Math.pow(i + 1, 1.25)) }));
    const projects = Array.from({ length: 200 }, (_, i) => ({
        id: String(i + 1),
        name: PROJECT_WORDS[i % PROJECT_WORDS.length] + ' ' + String(Math.floor(i / PROJECT_WORDS.length) + 1).padStart(2, '0') +
            (i % 9 === 0 ? ', Frankfurt and Zagreb settlement with the long descriptive name' : ''),
        n: Math.round(total * 0.05 / Math.pow(i + 1, 0.8)),
    }));
    projects.push({ id: '', name: '', n: Math.round(total * 0.02) });

    const decisions = after(0.93);
    const members = { owner: 1, admin: 7, analyst: 48, viewer: 131 };
    const memberCount = members.owner + members.admin + members.analyst + members.viewer;

    const out = {
        period: { key: 'c0', from: iso(from), to: iso(end), grain: 'day' },
        scope: 'live',
        zone: 'Europe/Zagreb',
        screenings: {
            total, flagged, clear: total - flagged, addresses: Math.round(total * 0.64), assetCount: CHAINS.length,
            verdicts: { severe, review: flagged - severe, clear: total - flagged },
            assets: chains, projects, days,
        },
        kinds: {
            live: line(0.61), rescreen: line(0.17), transaction: line(0.12), history: line(0.07), bulk: line(0.03),
            other: line(0.09),
        },
        review: {
            decisions, cleared: after(0.51), confirmed: after(0.38), holding: after(0.04),
            took: { hour: 412345, day: 1234567, week: 345678, longer: 98765 },
            queue: { open: 76543, holding: 4321, oldest: iso(from.getTime() + 20 * DAY),
                age: { day: 12345, week: 23456, month: 21098, older: 19644 } },
        },
        lists: {
            byList: { ofac: 1287, ofacOther: 143, eu: 912, uk: 655, un: 287, ca: 198, au: 176, ch: 154, jp: 61 },
            byTheme: { cyber: 1211, drugs: 342, terror: 233, dprk: 512, crime: 187, russia: 698, iran: 274, weapons: 96, other: 131 },
            byChain: CHAINS.slice(0, 36).map((asset, i) => ({ asset, n: Math.round(2400 / Math.pow(i + 1, 1.1)) })),
        },
        api: {
            calls: line(0.88), deliveries: after(1.6),
            byEndpoint: ENDPOINTS.map((path, i) => ({ path, n: Math.round(total * [0.74, 0.08, 0.03, 0.09, 0.06][i]) })),
        },
        team: { state: { mfa: 171, roles: members, seen: { today: 61, week: 58, month: 39, older: 24, never: 5 } } },
        evidence: {
            state: { checks: 98765432, sealed: 98765432, decisions: 4567890, oldest: iso(from.getTime() - 4 * 365 * DAY),
                retentionYears: 10, age: { month: 2987654, quarter: 6123456, year: 23456789, older: 66197533 } },
        },
        cycle: { used: total },
        org: { members: memberCount, projects: projects.length - 1, tokens: 64 },
    };
    // the year before, a little smaller, so every change beside a figure is a
    // real one
    const shrink = (l, k) => ({ total: Math.round(l.total * k), days: l.days });
    out.previous = {
        from: iso(from.getTime() - 365 * DAY), to: iso(from),
        total: Math.round(total * 0.62), flagged: Math.round(flagged * 0.7), severe: Math.round(severe * 0.74),
        addresses: Math.round(total * 0.62 * 0.66), assetCount: 41,
        kinds: { history: shrink(out.kinds.history, 0.5), other: shrink(out.kinds.other, 0.8) },
        review: { decisions: shrink(decisions, 0.6), cleared: shrink(out.review.cleared, 0.6), confirmed: shrink(out.review.confirmed, 0.6) },
        api: { calls: shrink(out.api.calls, 0.55), deliveries: shrink(out.api.deliveries, 0.5) },
    };
    return {
        out,
        org: { name: NAME.slice(0, 80) },
        sub: { plan: key, planName: PLAN_NAMES[key] + ', annual', included: { screenings: Math.round(total * 0.9) } },
    };
}

module.exports = { full, NAME };
