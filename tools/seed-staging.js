'use strict';

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
        await new Promise((r) => setTimeout(r, 25));
    }
    console.log('seeded ' + made + ' submissions into staging.');
    await new Promise((r) => setTimeout(r, 1500));
    process.exit(0);
})();