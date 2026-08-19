'use strict';

/* Fills a staging database with invented submissions, so the inbox, the pager
   and the "worth a look" filter have something to show.

   Why this exists rather than a copy of production: copying the real database
   into staging is the mistake that turns one breach into two, and it puts real
   people's names on a box with weaker secrets and a wider door. Staging gets
   made up data or it gets nothing.

   It refuses to run unless APP_ENV=staging. That guard is the whole point of the
   file: a seeder pointed at production is a seeder that writes rubbish into a
   table somebody is going to have to explain.

       APP_ENV=staging DATABASE_URL=... SUBMISSIONS_KEY=... node tools/seed-staging.js 40
*/

if (String(process.env.APP_ENV || '').toLowerCase() !== 'staging') {
    console.error('refusing to run: APP_ENV must be exactly "staging".');
    console.error('this writes invented rows and must never point at production.');
    process.exit(1);
}
if (!process.env.DATABASE_URL) {
    console.error('refusing to run: no DATABASE_URL.');
    process.exit(1);
}

const path = require('path');
const submissions = require(path.join(__dirname, '..', 'api', 'submissions-log'));

const FIRST = ['ana', 'ivan', 'marta', 'luka', 'petra', 'nikola', 'sara', 'josip', 'lea', 'marko'];
const LAST = ['anic', 'horvat', 'kovacevic', 'novak', 'babic', 'maric', 'juric', 'vukovic'];
const COMPANY = ['primjer d.o.o.', 'testna trgovina', 'demo exchange', 'proba pay', 'uzorak otc'];
const INDUSTRY = ['exchange', 'webshop', 'otc desk', 'payments', 'gaming'];
const COUNTRY = ['HR', 'DE', 'AT', 'SI', 'IT', 'NL'];
const SIZE = ['1-10', '10-50', '50-200'];

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function maybe(a, chance) { return Math.random() < chance ? a : null; }

// a request shaped like the real one, so record() takes the same path it takes
// in production and we are not testing a special case
function fakeReq(country) {
    return {
        realIp: '203.0.113.' + (1 + Math.floor(Math.random() * 250)),
        headers: {
            'cf-ipcountry': country,
            'user-agent': 'seed/1.0 (staging)',
        },
    };
}

const wanted = Math.min(Math.max(Number(process.argv[2]) || 30, 1), 200);

(async () => {
    let made = 0;
    for (let i = 0; i < wanted; i++) {
        const first = pick(FIRST);
        const last = pick(LAST);
        const country = pick(COUNTRY);
        const company = pick(COMPANY);
        const domain = 'primjer-tvrtka.hr';
        const email = first + '.' + last + i + '@' + domain;
        // one in five carries a review flag, which is roughly what the real
        // ratio has been, so the "worth a look" tab is not empty and not full
        const flags = Math.random() < 0.2 ? [pick(['free-email', 'website-is-a-mailbox', 'disposable-email'])] : [];
        const kind = pick(['demo', 'demo', 'trial', 'account']);

        const fields = kind === 'account'
            ? { email, name: first + ' ' + last, lang: pick(['en', 'hr', 'de']) }
            : {
                name: first + ' ' + last,
                email,
                company,
                website: domain,
                jobTitle: pick(['compliance', 'cto', 'founder', 'operations']),
                industry: pick(INDUSTRY),
                formCountry: country,
                size: pick(SIZE),
                volume: String(100 * (1 + Math.floor(Math.random() * 90))),
                solutions: [pick(['transaction screening', 'wallet investigations', 'api & data feeds'])],
                message: maybe('poruka iz seed skripte, ' + (i + 1), 0.6),
                flags,
            };

        const ref = submissions.record(kind, fakeReq(country), fields, kind === 'account' ? 'created' : 'accepted');
        if (ref) made++;
        // the inserts are fire and forget inside record(), so give the pool a
        // moment rather than opening two hundred at once
        await new Promise((r) => setTimeout(r, 25));
    }

    console.log('seeded ' + made + ' submissions into staging.');
    // record() writes in the background; wait before the process exits or the
    // last few never land
    await new Promise((r) => setTimeout(r, 1500));
    process.exit(0);
})();
