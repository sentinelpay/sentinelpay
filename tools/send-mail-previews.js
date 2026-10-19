'use strict';

// Sends every email the product sends, filled with example details, to one
// address, so they can be read side by side in a real inbox: how they look
// in Gmail or Outlook, on a phone, in dark mode, and whether they read as
// one family. The same examples the staff mail preview page shows.
//
//   RESEND_API_KEY=... node tools/send-mail-previews.js you@example.com
//   RESEND_API_KEY=... node tools/send-mail-previews.js you@example.com --yes
//   RESEND_API_KEY=... node tools/send-mail-previews.js you@example.com --lang all --only invite,reset-link --yes
//
// Without --yes it lists what it would send and sends nothing. --lang is en,
// hr, de or all (en by default); --only names the templates to send. Each
// subject starts with [Preview], and nothing in them is a working code or
// link. It sends from whatever MAIL_FROM the environment it runs in has, so
// run it where mail is set up: in production with railway run, or with the
// key in the shell.

const path = require('path');
const mailer = require(path.join(__dirname, '..', 'api', 'mailer.js'));

const args = process.argv.slice(2);
const value = (name) => {
    const at = args.indexOf('--' + name);
    return at === -1 ? '' : (args[at + 1] || '');
};
const TAKES_VALUE = ['--lang', '--only'];
const plain = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && TAKES_VALUE.indexOf(args[i - 1]) !== -1));
const to = (plain[0] || '').trim();
const yes = args.includes('--yes');
const langArg = (value('lang') || 'en').toLowerCase();
const langs = langArg === 'all' ? ['en', 'hr', 'de'] : [langArg];
const only = value('only').split(',').map((x) => x.trim()).filter(Boolean);
// the two notices go to us, not to customers, and are written in English only
const OURS = ['trial-notice', 'account-notice'];

(async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        console.error('usage: node tools/send-mail-previews.js <email> [--lang en|hr|de|all] [--only name,name] [--yes]');
        process.exit(1);
    }
    if (langs.some((l) => ['en', 'hr', 'de'].indexOf(l) === -1)) {
        console.error('--lang is en, hr, de or all');
        process.exit(1);
    }
    const names = mailer.previewNames().filter((n) => !only.length || only.indexOf(n) !== -1);
    const unknown = only.filter((n) => mailer.previewNames().indexOf(n) === -1);
    if (unknown.length) {
        console.error('no such template: ' + unknown.join(', '));
        console.error('there are: ' + mailer.previewNames().join(', '));
        process.exit(1);
    }
    const plan = [];
    names.forEach((n) => {
        (OURS.indexOf(n) !== -1 ? ['en'] : langs).forEach((l) => {
            if (plan.some((p) => p.name === n && p.lang === l)) return;
            plan.push({ name: n, lang: l });
        });
    });
    plan.forEach((p) => {
        const msg = mailer.previewMessage(p.name, p.lang);
        console.log('  ' + p.lang + '  ' + p.name.padEnd(20) + '  ' + msg.subject);
    });
    console.log('');
    if (!yes) {
        console.log(plan.length + ' email(s) to ' + to + '. Nothing sent; run again with --yes to send them.');
        process.exit(0);
    }
    if (!mailer.isConfigured()) {
        console.error('RESEND_API_KEY is not set here, so nothing can be sent. Run it where mail is set up.');
        process.exit(1);
    }
    let sent = 0;
    for (const p of plan) {
        const msg = mailer.previewMessage(p.name, p.lang);
        msg.to = to;
        msg.subject = '[Preview] ' + msg.subject;
        try {
            await mailer.send(msg);
            sent++;
        } catch (err) {
            console.error('  could not send ' + p.name + ' (' + p.lang + '): ' + err.message);
        }
        // one a second, well inside what the mail provider accepts
        await new Promise((r) => setTimeout(r, 1000));
    }
    console.log('sent ' + sent + ' of ' + plan.length + ' to ' + to);
})().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
