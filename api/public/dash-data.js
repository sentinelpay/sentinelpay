/* Everything the dashboard shows, before any of it is real.
 *
 * This file exists so that the screens can be designed, argued about and shown
 * to somebody in a meeting while the engine behind them is still being built.
 * Every value in here is invented. The addresses are valid in shape and belong
 * to nobody; the entity names are either public facts a five second search
 * confirms (the OFAC list is public) or obvious placeholders.
 *
 * Two rules while this file is the source of truth:
 *
 *   1. nothing in here is presented to a visitor as a real finding. the shell
 *      carries a sample-data marker on every screen, and it is removed in the
 *      same commit that removes this file.
 *   2. the shapes are the shapes we intend to build. when the engine arrives it
 *      answers with these fields, and the views do not change. that is the whole
 *      point of writing it down now: the api has to be designed by what the
 *      screen needs, not the other way round.
 */
(function () {
    'use strict';

    var now = Date.now();
    var hour = 3600 * 1000;
    var day = 24 * hour;

    function ago(ms) { return new Date(now - ms).toISOString(); }

    // ---- the risk bands -----------------------------------------------------
    // Four, not a hundred point score. A number pretends to a precision nobody
    // can defend in a meeting; a band is a decision. The score is kept alongside
    // because some customers' own policies are written against one, and because
    // an api that only answers in words is hard to threshold against.
    var BANDS = {
        severe: { key: 'severe', label: 'Severe', score: 95 },
        high: { key: 'high', label: 'High', score: 78 },
        medium: { key: 'medium', label: 'Medium', score: 44 },
        low: { key: 'low', label: 'Low', score: 8 },
    };

    // ---- exposure categories ------------------------------------------------
    // What the money on the other side was doing. Ordered worst first, because
    // that is the order a person reads them in.
    var CATEGORIES = [
        { key: 'sanctions', label: 'Sanctioned entity', tone: 'severe' },
        { key: 'stolen', label: 'Stolen funds', tone: 'severe' },
        { key: 'darknet', label: 'Darknet market', tone: 'high' },
        { key: 'mixer', label: 'Mixer', tone: 'high' },
        { key: 'scam', label: 'Fraud and scams', tone: 'high' },
        { key: 'gambling', label: 'Gambling', tone: 'medium' },
        { key: 'p2p', label: 'P2P exchange', tone: 'medium' },
        { key: 'unknown', label: 'Unattributed', tone: 'medium' },
        { key: 'exchange', label: 'Regulated exchange', tone: 'low' },
        { key: 'merchant', label: 'Merchant services', tone: 'low' },
    ];

    // ---- the screenings -----------------------------------------------------
    var SCREENINGS = [
        {
            id: 'scr_8f21a4',
            subject: '0x9A7c4F2b8E1d6c3A5b0F8e2D4c7A9b1E3f5C8d0A',
            kind: 'address',
            chain: 'Ethereum',
            asset: 'USDT',
            band: 'severe',
            decision: null,
            at: ago(2 * hour),
            by: 'Vibor Sumic',
            balance: '412,900.00 USDT',
            firstSeen: ago(410 * day),
            lastSeen: ago(6 * day),
            txCount: 1284,
            counterparties: 37,
            // the one sentence the whole screen is built around
            verdict: 'This address received 4,200 USDT from an address on the OFAC sanctions list, two hops away, six days ago.',
            reasons: [
                {
                    key: 'sanctions',
                    weight: 'severe',
                    title: 'Indirect exposure to a sanctioned address',
                    detail: '4,200 USDT arrived through one intermediate address from 0x7F3b…21Ae, listed by OFAC on 12 March 2026 under the cyber-related programme.',
                    source: 'OFAC SDN list, retrieved today',
                    evidence: 'tx_2f9c81',
                },
                {
                    key: 'mixer',
                    weight: 'high',
                    title: 'Funds passed through a mixer',
                    detail: '18% of everything this address has ever received came out of a mixing service within three hops.',
                    source: 'Sentinelpay attribution, confidence high',
                    evidence: 'tx_77b210',
                },
                {
                    key: 'age',
                    weight: 'low',
                    title: 'Address is not new',
                    detail: 'First activity 14 months ago, 1,284 transactions since. A new address with this pattern would rate worse.',
                    source: 'Chain history',
                    evidence: null,
                },
            ],
            exposure: [
                { key: 'sanctions', share: 4 },
                { key: 'mixer', share: 18 },
                { key: 'darknet', share: 6 },
                { key: 'unknown', share: 31 },
                { key: 'exchange', share: 33 },
                { key: 'merchant', share: 8 },
            ],
            path: [
                { hop: 0, label: 'Sanctioned address', ref: '0x7F3b…21Ae', note: 'OFAC SDN, cyber-related', amount: '12,000 USDT', at: ago(9 * day), tone: 'severe' },
                { hop: 1, label: 'Intermediate address', ref: '0x1c88…9dF2', note: 'No attribution', amount: '4,200 USDT', at: ago(7 * day), tone: 'medium' },
                { hop: 2, label: 'This address', ref: '0x9A7c…8d0A', note: 'The address you screened', amount: '4,200 USDT', at: ago(6 * day), tone: 'high' },
            ],
            transactions: [
                { id: 'tx_2f9c81', dir: 'in', amount: '4,200.00 USDT', from: '0x1c88…9dF2', at: ago(6 * day), tag: 'sanctions' },
                { id: 'tx_77b210', dir: 'in', amount: '31,500.00 USDT', from: '0x54ba…77c1', at: ago(21 * day), tag: 'mixer' },
                { id: 'tx_91ad02', dir: 'out', amount: '12,000.00 USDT', from: '0x9A7c…8d0A', at: ago(24 * day), tag: 'exchange' },
                { id: 'tx_5c7712', dir: 'in', amount: '97,000.00 USDT', from: '0xbb31…0e4d', at: ago(40 * day), tag: 'exchange' },
                { id: 'tx_0ad334', dir: 'out', amount: '8,400.00 USDT', from: '0x9A7c…8d0A', at: ago(52 * day), tag: 'merchant' },
            ],
        },
        {
            id: 'scr_44c0b9',
            subject: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
            kind: 'address',
            chain: 'Bitcoin',
            asset: 'BTC',
            band: 'low',
            decision: 'approved',
            at: ago(5 * hour),
            by: 'Vibor Sumic',
            balance: '2.41 BTC',
            firstSeen: ago(900 * day),
            lastSeen: ago(1 * day),
            txCount: 96,
            counterparties: 11,
            verdict: 'Nothing on this address reaches anything we flag. Everything it has received came from regulated exchanges.',
            reasons: [
                { key: 'clean', weight: 'low', title: 'No exposure to flagged categories', detail: 'Five hops out, nothing this address has touched appears on a sanctions list or in an attributed illicit cluster.', source: 'Sentinelpay attribution', evidence: null },
                { key: 'exchange', weight: 'low', title: 'Counterparties are regulated venues', detail: '88% of incoming value came from two exchanges that are licensed in the EU.', source: 'Sentinelpay attribution, confidence high', evidence: 'tx_bb0091' },
            ],
            exposure: [
                { key: 'exchange', share: 88 },
                { key: 'merchant', share: 9 },
                { key: 'unknown', share: 3 },
            ],
            path: [],
            transactions: [
                { id: 'tx_bb0091', dir: 'in', amount: '1.20000000 BTC', from: 'bc1q…k4m2', at: ago(1 * day), tag: 'exchange' },
                { id: 'tx_cc1182', dir: 'in', amount: '0.85000000 BTC', from: 'bc1q…7t1x', at: ago(19 * day), tag: 'exchange' },
                { id: 'tx_dd2273', dir: 'out', amount: '0.30000000 BTC', from: 'bc1q…ar0s', at: ago(26 * day), tag: 'merchant' },
            ],
        },
        {
            id: 'scr_1b77e3',
            subject: '0x4D2f9b1A7c3E5d8F0b6A2c4E7d9B1f3A5c8E0d2B',
            kind: 'address',
            chain: 'Polygon',
            asset: 'USDC',
            band: 'medium',
            decision: 'escalated',
            at: ago(28 * hour),
            by: 'Josip Družianić',
            balance: '18,220.00 USDC',
            firstSeen: ago(120 * day),
            lastSeen: ago(3 * day),
            txCount: 212,
            counterparties: 19,
            verdict: 'Just under a third of what this address holds came from addresses nobody has attributed. Nothing is flagged, but nothing is explained either.',
            reasons: [
                { key: 'unknown', weight: 'medium', title: 'Large unattributed share', detail: '29% of incoming value came from addresses with no attribution. That is not evidence of anything, and it is also not evidence of nothing.', source: 'Sentinelpay attribution', evidence: null },
                { key: 'velocity', weight: 'medium', title: 'Value moves straight through', detail: 'Median time between receiving and sending is 11 minutes across 212 transactions.', source: 'Chain history', evidence: 'tx_31fa77' },
            ],
            exposure: [
                { key: 'unknown', share: 29 },
                { key: 'p2p', share: 22 },
                { key: 'exchange', share: 41 },
                { key: 'gambling', share: 8 },
            ],
            path: [],
            transactions: [
                { id: 'tx_31fa77', dir: 'in', amount: '6,000.00 USDC', from: '0x77ac…12bb', at: ago(3 * day), tag: 'unknown' },
                { id: 'tx_42ab88', dir: 'out', amount: '5,950.00 USDC', from: '0x4D2f…0d2B', at: ago(3 * day), tag: 'p2p' },
            ],
        },
        {
            id: 'scr_920fd1', subject: '0xE1a7C3b5D9f2A4c6E8b0D2f4A6c8E0b2D4f6A8c0', kind: 'address', chain: 'Ethereum', asset: 'ETH',
            band: 'high', decision: 'rejected', at: ago(2 * day), by: 'Vibor Sumic', balance: '0.04 ETH',
            firstSeen: ago(60 * day), lastSeen: ago(2 * day), txCount: 8, counterparties: 3,
            verdict: 'Two of the three addresses that ever paid this one are attributed to a darknet market.',
            reasons: [{ key: 'darknet', weight: 'high', title: 'Direct exposure to a darknet market', detail: '61% of incoming value came directly from a cluster attributed to a darknet marketplace.', source: 'Sentinelpay attribution, confidence medium', evidence: 'tx_aa1122' }],
            exposure: [{ key: 'darknet', share: 61 }, { key: 'unknown', share: 27 }, { key: 'exchange', share: 12 }],
            path: [], transactions: [{ id: 'tx_aa1122', dir: 'in', amount: '0.90000000 ETH', from: '0x33cd…88ff', at: ago(2 * day), tag: 'darknet' }],
        },
        {
            id: 'scr_77aa10', subject: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', kind: 'address', chain: 'Tron', asset: 'USDT',
            band: 'low', decision: 'approved', at: ago(3 * day), by: 'Josip Družianić', balance: '96,100.00 USDT',
            firstSeen: ago(300 * day), lastSeen: ago(4 * day), txCount: 540, counterparties: 44,
            verdict: 'A payment processor address with nothing flagged against it in five hops.',
            reasons: [{ key: 'clean', weight: 'low', title: 'No exposure to flagged categories', detail: 'Nothing within five hops appears on a sanctions list or in an attributed illicit cluster.', source: 'Sentinelpay attribution', evidence: null }],
            exposure: [{ key: 'merchant', share: 64 }, { key: 'exchange', share: 30 }, { key: 'unknown', share: 6 }],
            path: [], transactions: [{ id: 'tx_ee3344', dir: 'in', amount: '25,000.00 USDT', from: 'TXk1…9mQ2', at: ago(4 * day), tag: 'merchant' }],
        },
    ];

    // ---- alerts -------------------------------------------------------------
    // What monitoring found while nobody was looking. An alert is a thing that
    // needs a decision, so every one of them carries the rule that produced it:
    // "why am I seeing this" is the first question and it should not need a
    // click.
    var ALERTS = [
        { id: 'alr_5521', at: ago(40 * 60 * 1000), band: 'severe', subject: '0x9A7c4F2b8E1d6c3A5b0F8e2D4c7A9b1E3f5C8d0A', chain: 'Ethereum', rule: 'Any exposure to a sanctioned address', summary: 'Received 4,200 USDT two hops from an OFAC-listed address.', screening: 'scr_8f21a4', state: 'open' },
        { id: 'alr_5518', at: ago(3 * hour), band: 'high', subject: '0xE1a7C3b5D9f2A4c6E8b0D2f4A6c8E0b2D4f6A8c0', chain: 'Ethereum', rule: 'Darknet exposure above 25%', summary: '61% of incoming value came directly from an attributed darknet cluster.', screening: 'scr_920fd1', state: 'open' },
        { id: 'alr_5511', at: ago(9 * hour), band: 'medium', subject: '0x4D2f9b1A7c3E5d8F0b6A2c4E7d9B1f3A5c8E0d2B', chain: 'Polygon', rule: 'Unattributed share above 25%', summary: '29% of incoming value has no attribution.', screening: 'scr_1b77e3', state: 'open' },
        { id: 'alr_5502', at: ago(1 * day), band: 'medium', subject: 'bc1q9h6mq4f2c8v3x7k1p5n0y8t2r4w6e9u1i3o5a', chain: 'Bitcoin', rule: 'Single transfer above 50,000 EUR', summary: 'Received 1.84 BTC in one transfer.', screening: null, state: 'acknowledged' },
        { id: 'alr_5497', at: ago(2 * day), band: 'low', subject: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', chain: 'Tron', rule: 'New counterparty', summary: 'First transfer from an address never seen before.', screening: 'scr_77aa10', state: 'closed' },
        { id: 'alr_5488', at: ago(4 * day), band: 'high', subject: '0x71bE3C9a2D4f6B8e0A2c4E6d8F0b2A4c6E8d0F2b', chain: 'Arbitrum', rule: 'Mixer exposure above 10%', summary: '22% of incoming value came out of a mixing service.', screening: null, state: 'closed' },
    ];

    // ---- what is being watched ---------------------------------------------
    var WATCHED = [
        { id: 'wat_01', label: 'Treasury, hot wallet', address: '0x9A7c4F2b8E1d6c3A5b0F8e2D4c7A9b1E3f5C8d0A', chain: 'Ethereum', since: ago(120 * day), rules: 3, lastCheck: ago(40 * 60 * 1000), band: 'severe' },
        { id: 'wat_02', label: 'Settlement, BTC', address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', chain: 'Bitcoin', since: ago(200 * day), rules: 2, lastCheck: ago(2 * hour), band: 'low' },
        { id: 'wat_03', label: 'Customer 4471, payout', address: '0x4D2f9b1A7c3E5d8F0b6A2c4E7d9B1f3A5c8E0d2B', chain: 'Polygon', since: ago(30 * day), rules: 4, lastCheck: ago(3 * hour), band: 'medium' },
        { id: 'wat_04', label: 'Merchant float, TRON', address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', chain: 'Tron', since: ago(64 * day), rules: 2, lastCheck: ago(5 * hour), band: 'low' },
        { id: 'wat_05', label: 'Cold storage', address: 'bc1q9h6mq4f2c8v3x7k1p5n0y8t2r4w6e9u1i3o5a', chain: 'Bitcoin', since: ago(320 * day), rules: 1, lastCheck: ago(6 * hour), band: 'low' },
    ];

    // ---- rules, written as sentences ---------------------------------------
    // The whole point of this screen: a rule a compliance officer can read back
    // to their auditor without a translator.
    var RULES = [
        { id: 'rul_01', on: true, text: 'Alert me if any watched address receives value from a sanctioned address, at any distance.', band: 'severe', hits: 2 },
        { id: 'rul_02', on: true, text: 'Alert me if darknet exposure goes above 25% of incoming value.', band: 'high', hits: 1 },
        { id: 'rul_03', on: true, text: 'Alert me if mixer exposure goes above 10% of incoming value.', band: 'high', hits: 1 },
        { id: 'rul_04', on: true, text: 'Alert me if the unattributed share goes above 25%.', band: 'medium', hits: 1 },
        { id: 'rul_05', on: true, text: 'Alert me if a single transfer is worth more than 50,000 EUR.', band: 'medium', hits: 1 },
        { id: 'rul_06', on: false, text: 'Alert me the first time value arrives from an address we have never seen.', band: 'low', hits: 0 },
    ];

    // ---- cases --------------------------------------------------------------
    var CASES = [
        { id: 'case_0042', title: 'Sanctions exposure, treasury hot wallet', opened: ago(2 * hour), state: 'open', owner: 'Vibor Sumic', band: 'severe', items: 3, note: 'Two hops from an OFAC listing. Payment held pending legal.' },
        { id: 'case_0041', title: 'Darknet exposure, customer 9920', opened: ago(2 * day), state: 'review', owner: 'Josip Družianić', band: 'high', items: 5, note: 'Account frozen, awaiting customer explanation.' },
        { id: 'case_0038', title: 'Unattributed flow, customer 4471', opened: ago(6 * day), state: 'review', owner: 'Vibor Sumic', band: 'medium', items: 2, note: 'Pass-through pattern. Watching for a week before deciding.' },
        { id: 'case_0031', title: 'Large inbound, cold storage', opened: ago(14 * day), state: 'closed', owner: 'Josip Družianić', band: 'low', items: 1, note: 'Source confirmed as the customer own exchange account. No action.' },
    ];

    // ---- the policy ---------------------------------------------------------
    // Read as a document, because it is one: this is what gets exported and
    // attached to the bank questionnaire.
    var POLICY = {
        updated: ago(11 * day),
        by: 'Vibor Sumic',
        version: 4,
        thresholds: [
            { key: 'sanctions', label: 'Any exposure to a sanctioned address', action: 'block', value: 'any' },
            { key: 'darknet', label: 'Darknet market exposure', action: 'block', value: 'above 25%' },
            { key: 'mixer', label: 'Mixer exposure', action: 'review', value: 'above 10%' },
            { key: 'unknown', label: 'Unattributed share', action: 'review', value: 'above 25%' },
            { key: 'gambling', label: 'Gambling exposure', action: 'allow', value: 'below 40%' },
            { key: 'amount', label: 'Single transfer', action: 'review', value: 'above 50,000 EUR' },
        ],
        approvals: [
            { what: 'Release a payment held by a Severe finding', who: 'Two people, one of them the MLRO' },
            { what: 'Release a payment held by a High finding', who: 'The MLRO' },
            { what: 'Change a threshold in this policy', who: 'The MLRO, recorded in the audit log' },
        ],
        jurisdictions: ['European Union', 'United Kingdom', 'United States'],
        lists: [
            { name: 'OFAC SDN', updated: ago(6 * hour) },
            { name: 'EU consolidated list', updated: ago(9 * hour) },
            { name: 'UN Security Council list', updated: ago(30 * hour) },
            { name: 'UK OFSI list', updated: ago(14 * hour) },
        ],
    };

    // ---- reports ------------------------------------------------------------
    var REPORTS = [
        { id: 'rep_2026_08', title: 'August 2026, monthly screening report', period: 'August 2026', made: ago(12 * day), checks: 1841, flagged: 26, blocked: 4 },
        { id: 'rep_2026_07', title: 'July 2026, monthly screening report', period: 'July 2026', made: ago(43 * day), checks: 1622, flagged: 19, blocked: 2 },
        { id: 'rep_2026_06', title: 'June 2026, monthly screening report', period: 'June 2026', made: ago(73 * day), checks: 1480, flagged: 22, blocked: 5 },
    ];

    // ---- activity -----------------------------------------------------------
    var ACTIVITY = [
        { at: ago(40 * 60 * 1000), who: 'Monitoring', what: 'Alert raised on Treasury, hot wallet', kind: 'alert' },
        { at: ago(2 * hour), who: 'Vibor Sumic', what: 'Screened 0x9A7c…8d0A', kind: 'screening' },
        { at: ago(2 * hour), who: 'Vibor Sumic', what: 'Opened case 0042', kind: 'case' },
        { at: ago(5 * hour), who: 'Vibor Sumic', what: 'Approved bc1qar0…5mdq', kind: 'decision' },
        { at: ago(28 * hour), who: 'Josip Družianić', what: 'Escalated 0x4D2f…0d2B', kind: 'decision' },
        { at: ago(2 * day), who: 'Vibor Sumic', what: 'Rejected 0xE1a7…A8c0', kind: 'decision' },
        { at: ago(11 * day), who: 'Vibor Sumic', what: 'Changed the mixer threshold to 10%', kind: 'policy' },
    ];

    // ---- usage and keys -----------------------------------------------------
    // Thirty days of checks, for the shape rather than the numbers: a chart on
    // an overview answers "is this normal" and nothing else, so it is drawn
    // small, without axes, and the only figure that gets read out is today's.
    var SERIES = [];
    (function () {
        var base = 42;
        for (var i = 29; i >= 0; i--) {
            var weekend = [0, 6].indexOf(new Date(now - i * day).getUTCDay()) !== -1;
            var n = Math.round(base * (weekend ? 0.35 : 1) + (Math.sin(i / 2.3) * 9) + (i % 5) * 3);
            SERIES.push({ at: ago(i * day), checks: Math.max(4, n), flagged: Math.max(0, Math.round(n * 0.06)) });
        }
    })();

    // How the month's checks came out, for the bar on the overview
    var RISK_MIX = [
        { band: 'severe', count: 6 },
        { band: 'high', count: 21 },
        { band: 'medium', count: 148 },
        { band: 'low', count: 1109 },
    ];

    var ACCOUNT = {
        plan: 'Growth',
        checksUsed: 1284,
        checksIncluded: 5000,
        renews: new Date(now + 18 * day).toISOString(),
        seats: 3,
        chains: ['Bitcoin', 'Ethereum', 'Polygon', 'Arbitrum', 'Tron', 'Solana', 'Base', 'Avalanche'],
    };

    var KEYS = [
        { id: 'key_live_01', label: 'Production', prefix: 'sp_live_9f2a', created: ago(90 * day), lastUsed: ago(20 * 60 * 1000), calls: 41200 },
        { id: 'key_test_01', label: 'Sandbox', prefix: 'sp_test_4c71', created: ago(90 * day), lastUsed: ago(3 * day), calls: 980 },
    ];

    var TEAM = [
        { name: 'Vibor Sumic', role: 'MLRO', email: 'vibor@sentinelpay.org', twofa: true, last: ago(20 * 60 * 1000) },
        { name: 'Josip Družianić', role: 'Analyst', email: 'josip@sentinelpay.org', twofa: true, last: ago(28 * hour) },
        { name: 'Vitali Friesen', role: 'Read only', email: 'vitali@sentinelpay.org', twofa: false, last: ago(4 * day) },
    ];

    window.SentinelDashData = {
        sample: true,
        bands: BANDS,
        categories: CATEGORIES,
        screenings: SCREENINGS,
        alerts: ALERTS,
        watched: WATCHED,
        rules: RULES,
        cases: CASES,
        policy: POLICY,
        reports: REPORTS,
        activity: ACTIVITY,
        account: ACCOUNT,
        series: SERIES,
        riskMix: RISK_MIX,
        keys: KEYS,
        team: TEAM,

        // Anything typed into the search box gets an answer, because a demo where
        // the box only works for five addresses is a demo that ends early. An
        // address we do not have is answered with a low-risk screening built on
        // the spot and marked as a sample like everything else here.
        find: function (query) {
            var q = String(query || '').trim();
            if (!q) return null;
            var hit = null;
            SCREENINGS.forEach(function (s) {
                if (s.subject.toLowerCase() === q.toLowerCase() || s.id === q) hit = s;
            });
            if (hit) return hit;
            var made = JSON.parse(JSON.stringify(SCREENINGS[1]));
            made.id = 'scr_' + Math.random().toString(16).slice(2, 8);
            made.subject = q;
            made.chain = /^0x/i.test(q) ? 'Ethereum' : (/^T/.test(q) ? 'Tron' : 'Bitcoin');
            made.at = new Date().toISOString();
            made.decision = null;
            SCREENINGS.unshift(made);
            return made;
        },

        byId: function (id) {
            var hit = null;
            SCREENINGS.forEach(function (s) { if (s.id === id) hit = s; });
            return hit;
        },
    };
})();
