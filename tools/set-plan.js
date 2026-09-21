'use strict';

// Puts an organisation on a plan.
//
// We sell these by talking to people: the paid cards on the pricing page lead
// to a conversation, not to a card form. So this is how a customer actually
// gets put on a plan until there is a payment flow, and it writes the same rows
// the product reads -- no special case, no second source of truth.
//
//   DATABASE_URL=... node tools/set-plan.js <org-slug> <plan> <term> [--paid] [--note "..."]
//   DATABASE_URL=... node tools/set-plan.js <org-slug> --cancel
//   DATABASE_URL=... node tools/set-plan.js <org-slug> --show
//
//   plan   starter | growth | enterprise
//   term   quarterly | yearly | scan
//
// Without --yes it prints what it would do and stops. --paid records that the
// money arrived; leave it off for a plan agreed but not yet paid, which is a
// real state and one you want to be able to find later.

const db = require('../api/db.js');
const billing = require('../api/billing.js');
const plans = require('../api/plans.js');

const args = process.argv.slice(2);
const flag = (name) => args.includes('--' + name);
const value = (name) => {
    const at = args.indexOf('--' + name);
    return at === -1 ? '' : (args[at + 1] || '');
};
const plain = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--note'));

const slug = plain[0];
const planKey = plain[1];
const termKey = plain[2];

function money(cents, currency) {
    if (cents === null || cents === undefined) return 'agreed';
    return (cents / 100).toLocaleString('en-GB', { minimumFractionDigits: 2 }) + ' ' + currency;
}

// pg hands back Date objects, and String(date) is a sentence, not a date
function day(value) {
    if (!value) return '';
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
}

function line(sub) {
    if (!sub) return '  (no plan)';
    return '  ' + sub.plan + ' / ' + sub.term +
        '   ' + money(sub.priceCents, sub.currency) +
        (sub.paid ? '   paid' : '   NOT PAID') +
        '\n  term   ' + day(sub.startedAt) + ' -> ' + (sub.termEndsAt ? day(sub.termEndsAt) : 'open') +
        (sub.renewsAt ? '   renews ' + day(sub.renewsAt) : '   does not renew') +
        '\n  period ' + day(sub.periodStart) + ' -> ' + day(sub.periodEnd);
}

async function main() {
    if (!slug) {
        console.error('usage: node tools/set-plan.js <org-slug> <plan> <term> [--paid] [--note "..."] [--yes]');
        console.error('       node tools/set-plan.js <org-slug> --cancel [--yes]');
        console.error('       node tools/set-plan.js <org-slug> --show');
        console.error('plans: ' + Object.keys(plans.PLANS).join(', ') + '   terms: ' + Object.keys(plans.TERMS).join(', '));
        process.exit(1);
    }
    if (!db.available()) {
        console.error('no DATABASE_URL, nothing to do');
        process.exit(1);
    }

    const found = await db.query('SELECT id, name, slug FROM organisations WHERE slug = $1', [slug]);
    if (!found.rowCount) {
        console.error('no organisation with that slug');
        process.exit(1);
    }
    const org = found.rows[0];
    const now = await billing.get(org.id);

    console.log(org.name + '  (' + org.slug + ')');
    console.log('now:');
    console.log(line(now));

    if (flag('show')) process.exit(0);

    if (flag('cancel')) {
        console.log('');
        console.log('would stop it renewing. what is paid for runs to the end of its term.');
        if (!flag('yes')) {
            console.log('nothing was changed. pass --yes to go ahead.');
            process.exit(0);
        }
        const out = await billing.cancel(org.id, null);
        if (!out.ok) {
            console.error('nothing to cancel');
            process.exit(1);
        }
        console.log('done:');
        console.log(line(out.subscription));
        process.exit(0);
    }

    if (!plans.isPlan(planKey)) {
        console.error('unknown plan: ' + planKey + '. one of ' + Object.keys(plans.PLANS).join(', '));
        process.exit(1);
    }
    if (!plans.isTerm(termKey)) {
        console.error('unknown term: ' + termKey + '. one of ' + Object.keys(plans.TERMS).join(', '));
        process.exit(1);
    }

    const price = plans.listPrice(planKey, termKey);
    console.log('');
    console.log('would set   ' + planKey + ' / ' + termKey + '   ' + money(price, plans.CURRENCY) +
        (flag('paid') ? '   paid' : '   NOT PAID'));
    if (now) console.log('            replacing what is above, which is kept in the history');
    if (plans.plan(planKey).negotiated && price !== null) {
        console.log('note: the pricing page says "from" for this plan. the listed price is');
        console.log('      being written. change it in the row if what was agreed differs.');
    }

    if (!flag('yes')) {
        console.log('');
        console.log('nothing was changed. pass --yes to go ahead.');
        process.exit(0);
    }

    const out = await billing.start(org.id, null, {
        plan: planKey,
        term: termKey,
        paid: flag('paid'),
        note: value('note'),
    });
    if (!out.ok) {
        console.error('failed: ' + out.reason);
        process.exit(1);
    }
    console.log('');
    console.log('done:');
    console.log(line(out.subscription));
    process.exit(0);
}

main().catch((err) => {
    console.error('failed: ' + err.message);
    process.exit(1);
});
