'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// One place for outbound mail. Everything the site sends goes through here so the
// sender, the styling and the failure behaviour stay identical across endpoints.

const MAIL_FROM = process.env.MAIL_FROM || 'sentinelpay <noreply@sentinelpay.org>';
const MAIL_TO = process.env.MAIL_TO || 'support@sentinelpay.org';
const SITE = 'https://sentinelpay.org';

function isConfigured() {
    return Boolean(process.env.RESEND_API_KEY);
}

function esc(s) {
    return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

// Email clients strip <style> blocks, ignore custom properties and mostly ignore
// flexbox, so the site's look is rebuilt here with tables and inline styles only.
//
// The palette is the site's, which is light: white card on a pale ground, navy
// text, one cyan accent, and the cyan to purple hairline the cards carry. it was
// dark until now, from back when the site was, and a dark email from a white
// site reads as coming from somewhere else.
//
// Every colour is a solid hex rather than rgba. Outlook drops rgba entirely and
// renders the element with no colour at all, which is how a border becomes a
// black line and muted text becomes unreadable.
const C = {
    page: '#f4f6fa',
    card: '#ffffff',
    line: '#e6e9f0',
    lineSoft: '#f0f2f7',
    text: '#0e2358',
    muted: '#6b7899',
    faint: '#94a0bd',
    cyan: '#0091c8',
    purple: '#7b6cff',
    tint: '#f2f9fc',
    tintLine: '#cfe9f4',
};

const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const LOGO = SITE + '/logo.png';
// the site's checklist marker, rendered once to a png at three times the size it
// is used at, so it stays sharp on a retina screen
const CHECK = SITE + '/mail-check.png';

// The footer is the same in every message, so its copy lives here rather than in
// each template. it follows the language of the message: an english row of links
// under a croatian letter is the seam people notice first.
// The legal identity of the sender. In the eu a commercial email carries the
// company's registered name, its seat and its registration numbers, and for a
// company that sells compliance this is the first thing a careful reader looks
// for. Placeholders until the d.o.o. is registered; set them without a code
// change once it is.
const LEGAL = {
    name: process.env.COMPANY_LEGAL_NAME || 'sentinelpay d.o.o. (in registration)',
    address: process.env.COMPANY_ADDRESS || 'ulica i kucni broj, 10000 zagreb, croatia',
    reg: process.env.COMPANY_REG || 'oib 00000000000 · mbs 000000000',
};

const FOOTER = {
    en: { questions: 'questions', privacy: 'privacy', terms: 'terms', blog: 'blog',
          contact: 'need a hand? write to', seat: 'registered office' },
    hr: { questions: 'pitanja', privacy: 'privatnost', terms: 'uvjeti', blog: 'blog',
          contact: 'trebate pomoć? pišite na', seat: 'sjedište' },
    de: { questions: 'fragen', privacy: 'datenschutz', terms: 'bedingungen', blog: 'blog',
          contact: 'brauchen sie hilfe? schreiben sie an', seat: 'sitz' },
};

function row(label, value) {
    if (!value) return '';
    return '<tr>' +
        '<td width="34%" style="padding:12px 18px 12px 0;vertical-align:top;font-size:13px;line-height:20px;color:' + C.muted + ';border-bottom:1px solid ' + C.lineSoft + ';">' + esc(label) + '</td>' +
        '<td style="padding:12px 0;vertical-align:top;font-size:14px;line-height:21px;color:' + C.text + ';font-weight:500;border-bottom:1px solid ' + C.lineSoft + ';">' + esc(value) + '</td>' +
        '</tr>';
}

// An amber band above everything else, the same colour the site's incident
// banner uses. It exists so a submission that needs a person to look at it
// cannot be skimmed past: the reasons are spelled out in words, not codes.
function reviewBand(notes) {
    if (!notes || !notes.length) return '';
    return '<tr><td style="padding:0 36px 24px;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
        'style="background:#fff8ee;border:1px solid #f6dfbc;border-radius:12px;">' +
        '<tr><td style="padding:14px 16px;">' +
        '<div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;color:#b26a00;">worth a look</div>' +
        notes.map((n) =>
            '<div style="margin-top:7px;font-size:13px;line-height:20px;color:#7a5417;">' + esc(n) + '</div>'
        ).join('') +
        '</td></tr></table></td></tr>';
}

// The six digit code, big enough to read off a phone at arm's length and spaced
// so it is not mistaken for a number. Rendered as text rather than an image: an
// image is blocked by default in most inboxes, and a code nobody can see is no
// code at all.
function codeBlock(code) {
    if (!code) return '';
    return '<tr><td style="padding:4px 36px 26px;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
        'style="background:' + C.tint + ';border:1px solid ' + C.tintLine + ';border-radius:14px;">' +
        '<tr><td align="center" style="padding:22px 14px;">' +
        '<div style="font-family:' + FONT + ';font-size:38px;line-height:46px;font-weight:800;' +
        'letter-spacing:0.24em;text-indent:0.24em;color:' + C.text + ';' +
        // tabular figures so the six digits sit on an even rhythm. most clients
        // ignore it and inter's default figures are even anyway, so it costs
        // nothing where it is not honoured.
        'font-variant-numeric:tabular-nums;font-feature-settings:\'tnum\';">' + esc(code) + '</div>' +
        '</td></tr></table></td></tr>';
}

// The facts about the code, under it, as a quiet line rather than as a bullet
// with a tick. a tick means "done"; nothing here is done, these are the terms
// the code comes with.
function codeMeta(items) {
    if (!items || !items.length) return '';
    return '<tr><td align="center" style="padding:0 36px 28px;">' +
        '<div style="font-size:12px;line-height:19px;color:' + C.muted + ';">' +
        items.map(esc).join('<span style="color:' + C.faint + ';"> &nbsp;·&nbsp; </span>') +
        '</div></td></tr>';
}

// One line of a checklist. The site paints its marker by masking the brand
// gradient into the shape of a stroked check, and neither a mask nor an svg
// survives an inbox, so the same thing is baked into a small png. it is the
// site's own path and its own gradient, at three times the size it is drawn.
//
// The alt text is the check character on purpose. a client that blocks images
// blocks this one too, and then the marker is a tick rather than an empty box.
// so the good case is the site's exact marker and the bad case is what the
// email had before, which is the right way round.
function tickRow(b) {
    return '<tr>' +
        // measured rather than guessed: at 9px the tick sat a pixel and a half above
        // the middle of the first line of text next to it
        '<td width="16" style="padding:11px 14px 0 0;vertical-align:top;font-family:' + FONT + ';' +
        'font-size:15px;line-height:16px;font-weight:400;color:' + C.cyan + ';">' +
        '<img src="' + CHECK + '" width="16" height="16" alt="&#10003;" ' +
        'style="display:block;width:16px;height:16px;border:0;outline:none;">' +
        '</td>' +
        '<td style="padding:7px 0;font-size:15px;line-height:23px;color:' + C.text + ';">' + esc(b) + '</td>' +
        '</tr>';
}

// A button that survives outlook: a table with a background colour and padding,
// rather than a styled anchor, which outlook renders as plain blue text.
//
// It spans the column rather than sitting as a pill in the middle of it.
// everything else in the card starts and ends on the same two edges, and a small
// centred element was the only thing breaking that line, so it read as floating
// rather than as the next step. full width keeps the centred label and gives it
// the same edges as the note below it.
function button(cta) {
    if (!cta) return '';
    return '<tr><td style="padding:6px 36px 0;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
        '<tr><td align="center" bgcolor="' + C.text + '" style="border-radius:12px;">' +
        '<a href="' + esc(cta.href) + '" style="display:block;padding:15px 24px;font-family:' + FONT + ';' +
        'font-size:14.5px;font-weight:700;line-height:19px;color:#ffffff;text-decoration:none;' +
        'border-radius:12px;text-align:center;">' +
        esc(cta.label) + '</a>' +
        '</td></tr></table></td></tr>';
}

function divider(pad) {
    return '<tr><td style="padding:' + (pad || '28px 36px') + ';">' +
        '<div style="height:1px;line-height:1px;font-size:0;background:' + C.line + ';">&nbsp;</div></td></tr>';
}

function layout({ eyebrow, title, intro, rows, bullets, cta, footnote, review, code, meta, lang }) {
    const f = FOOTER[lang] || FOOTER.en;
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">' +
        // apple mail and a few others honour this; everyone else falls through the
        // stack to the system font, which is what the site uses anyway
        '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800&display=swap" rel="stylesheet">' +
        '</head>' +
        '<body style="margin:0;padding:0;background:' + C.page + ';">' +

        // preheader: what the inbox list shows next to the subject, kept out of
        // the visible body
        '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' + esc(intro) + '</div>' +

        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + C.page + ';padding:40px 16px;">' +
        '<tr><td align="center">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
        'style="max-width:560px;background:' + C.card + ';border:1px solid ' + C.line + ';border-radius:18px;overflow:hidden;font-family:' + FONT + ';">' +

        // the gradient hairline every card on the site carries. outlook drops the
        // gradient and keeps the background colour, which is the cyan end of it,
        // so it degrades to a plain accent line rather than to nothing.
        '<tr><td style="height:3px;line-height:3px;font-size:0;background:' + C.cyan + ';' +
        'background-image:linear-gradient(90deg,#00d5ff 0%,' + C.purple + ' 100%);">&nbsp;</td></tr>' +

        // the mark on its own. no wordmark beside it: the logo is the signature,
        // and the name is in the sender line anyway.
        '<tr><td align="center" style="padding:32px 36px 0;">' +
        '<a href="' + SITE + '" style="text-decoration:none;">' +
        '<img src="' + LOGO + '" width="44" height="44" alt="sentinelpay" ' +
        'style="display:inline-block;width:44px;height:44px;border:0;outline:none;text-decoration:none;">' +
        '</a></td></tr>' +

        divider('24px 36px 26px') +

        '<tr><td style="padding:0 36px;">' +
        (eyebrow ? '<div style="font-size:11px;letter-spacing:0.11em;text-transform:uppercase;font-weight:700;color:' + C.cyan + ';">' + esc(eyebrow) + '</div>' : '') +
        '<div style="margin-top:10px;font-size:26px;line-height:33px;font-weight:800;letter-spacing:-0.02em;color:' + C.text + ';">' + esc(title) + '</div>' +
        '<div style="margin-top:12px;font-size:15px;line-height:24px;color:' + C.muted + ';">' + esc(intro) + '</div>' +
        '</td></tr>' +

        '<tr><td style="height:26px;line-height:26px;font-size:0;">&nbsp;</td></tr>' +

        reviewBand(review) +
        codeBlock(code) +
        codeMeta(meta) +

        (rows ? '<tr><td style="padding:0 36px 4px;">' +
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + rows + '</table>' +
            '</td></tr><tr><td style="height:22px;line-height:22px;font-size:0;">&nbsp;</td></tr>' : '') +

        // checklist, the same cyan tick the trial page uses
        (bullets && bullets.length ? '<tr><td style="padding:0 36px;">' +
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
            bullets.map(tickRow).join('') +
            '</table></td></tr><tr><td style="height:26px;line-height:26px;font-size:0;">&nbsp;</td></tr>' : '') +

        button(cta) +
        (cta ? '<tr><td style="height:28px;line-height:28px;font-size:0;">&nbsp;</td></tr>' : '') +

        (footnote ? '<tr><td style="padding:0 36px;">' +
            '<div style="padding:14px 16px;background:#f7f9fc;border:1px solid ' + C.lineSoft + ';border-radius:12px;' +
            'font-size:12px;line-height:19px;color:' + C.muted + ';">' + esc(footnote) + '</div>' +
            '</td></tr><tr><td style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>' : '') +

        divider('24px 36px') +

        // the footer, the way the site's is: a line of places to go, then the
        // quiet line nobody reads until they need it
        '<tr><td align="center" style="padding:0 36px 30px;text-align:center;">' +
        '<div style="font-size:12px;line-height:20px;color:' + C.faint + ';">' +
        '<a href="' + SITE + '/faq" style="color:' + C.muted + ';text-decoration:none;">' + esc(f.questions) + '</a>' +
        '<span style="color:' + C.faint + ';"> &nbsp;·&nbsp; </span>' +
        '<a href="' + SITE + '/privacy-policy" style="color:' + C.muted + ';text-decoration:none;">' + esc(f.privacy) + '</a>' +
        '<span style="color:' + C.faint + ';"> &nbsp;·&nbsp; </span>' +
        '<a href="' + SITE + '/terms-of-service" style="color:' + C.muted + ';text-decoration:none;">' + esc(f.terms) + '</a>' +
        '<span style="color:' + C.faint + ';"> &nbsp;·&nbsp; </span>' +
        '<a href="https://blog.sentinelpay.org" style="color:' + C.muted + ';text-decoration:none;">' + esc(f.blog) + '</a>' +
        '</div>' +
        '<div style="margin-top:14px;font-size:12px;line-height:19px;color:' + C.muted + ';">' +
        esc(f.contact) + ' <a href="mailto:' + MAIL_TO + '" style="color:' + C.cyan + ';text-decoration:none;">' + MAIL_TO + '</a>' +
        '</div>' +
        // who is writing to you, in the sense a company register understands
        '<div style="margin-top:18px;padding-top:16px;border-top:1px solid ' + C.lineSoft + ';' +
        'font-size:11px;line-height:18px;color:' + C.faint + ';">' +
        '<span style="color:' + C.muted + ';font-weight:600;">' + esc(LEGAL.name) + '</span><br>' +
        esc(f.seat) + ': ' + esc(LEGAL.address) + '<br>' +
        esc(LEGAL.reg) +
        '</div>' +
        '</td></tr>' +

        '</table>' +
        '</td></tr></table></body></html>';
}

// Plain-text alternative. Without it, spam filters mark an html-only mail down and
// some clients render nothing at all.
function textVersion({ title, intro, pairs, bullets, cta, footnote, review, code, meta, lang }) {
    const f = FOOTER[lang] || FOOTER.en;
    const lines = [title, '', intro, ''];
    if (code) lines.push(code, '');
    if (meta && meta.length) lines.push(meta.join(' · '), '');
    if (review && review.length) {
        lines.push('worth a look:');
        review.forEach((n) => lines.push('  - ' + n));
        lines.push('');
    }
    (pairs || []).forEach(([k, v]) => { if (v) lines.push(k + ': ' + v); });
    (bullets || []).forEach((b) => lines.push('- ' + b));
    if (cta) lines.push('', cta.label + ': ' + cta.href);
    if (footnote) lines.push('', footnote);
    lines.push('', f.contact + ' ' + MAIL_TO);
    lines.push('', SITE, LEGAL.name, f.seat + ': ' + LEGAL.address, LEGAL.reg);
    return lines.join('\n');
}

// Sends, or throws. It never resolves quietly when nothing was sent: an endpoint
// that answers "ok" while the inbox stays empty is the worst possible outcome.
// The finished message, without sending it. Pulled out of send() so that the
// preview and the real thing cannot drift: whatever you look at in the browser
// is byte for byte what lands in the inbox.
function compose(msg) {
    const { subject, eyebrow, title, intro, pairs, bullets, cta, footnote, review, code, meta, lang } = msg;
    const rows = (pairs || []).map(([k, v]) => row(k, v)).join('');
    return {
        subject: subject,
        html: layout({ eyebrow, title, intro, rows, bullets, cta, footnote, review, code, meta, lang }),
        text: textVersion({ title, intro, pairs, bullets, cta, footnote, review, code, meta, lang }),
    };
}

async function send(msg) {
    const { to, subject, replyTo } = msg;
    const { html, text } = compose(msg);

    if (!isConfigured()) {
        // in production a missing key is a hard failure: the form must not claim
        // success. locally there is no key by design, so write a preview instead.
        if (process.env.NODE_ENV === 'production') {
            const err = new Error('RESEND_API_KEY is not set, so no mail was sent');
            err.code = 'MAIL_NOT_CONFIGURED';
            throw err;
        }
        const file = path.join(os.tmpdir(), 'sentinelpay-mail-' + Date.now() + '.html');
        fs.writeFileSync(file, html);
        console.log('[mail preview] ' + subject + ' -> ' + file);
        return { preview: file };
    }

    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    // the field is reply_to on the v3 sdk, not replyTo. spelled the other way it
    // is simply an unknown property: no error, and every reply to a lead
    // notification went to noreply@ instead of to the person who wrote in.
    const payload = {
        from: MAIL_FROM,
        to: to || MAIL_TO,
        subject: subject,
        html: html,
        text: text,
    };
    if (replyTo) payload.reply_to = replyTo;
    const result = await resend.emails.send(payload);

    // the sdk reports api errors in the payload rather than by rejecting
    if (result && result.error) {
        const err = new Error(result.error.message || 'resend rejected the message');
        err.code = 'MAIL_REJECTED';
        err.detail = result.error;
        console.error('[mail] rejected: ' + JSON.stringify(result.error));
        throw err;
    }
    // the provider's own id for the message. without it, "the email never
    // arrived" cannot be told apart from "we never sent it", and neither can be
    // looked up in the provider's dashboard.
    const id = result && result.data && result.data.id;
    console.log('[mail] sent "' + subject + '" id=' + (id || 'no id returned'));
    return result;
}


// The message the person who signed up receives. It is the only mail a customer
// ever gets from us, so it carries the copy in the language they were reading the
// site in, and nothing else.
const TRIAL_COPY = {
    en: {
        subject: 'your sentinelpay trial is ready',
        eyebrow: 'free trial',
        title: 'your trial is ready',
        intro: 'you signed up at sentinelpay.org. here is what is waiting for you.',
        bullets: [
            'one free scan plus one from your history, right away',
            'the rest of your history is already there, just locked',
            'verify your number and the rest opens, plus 10 live checks',
            'every scan logged, so you can prove what you checked',
        ],
        ctaLabel: 'open your trial',
        viaAccount: 'your trial lives in your sentinelpay account, so the button opens the account first.',
        footnote: 'you are getting this because this address was used to start a trial at sentinelpay.org. if that was not you, ignore this email and nothing happens.',
    },
    hr: {
        subject: 'vaša sentinelpay proba je spremna',
        eyebrow: 'besplatna proba',
        title: 'vaša proba je spremna',
        intro: 'prijavili ste se na sentinelpay.org. evo što vas čeka.',
        bullets: [
            'odmah jedna besplatna provjera i jedna iz vaše povijesti',
            'ostatak povijesti već je tu, samo je zaključan',
            'potvrdite broj i otvara se ostatak, uz 10 provjera uživo',
            'svaka provjera zapisana, pa možete dokazati što ste provjerili',
        ],
        ctaLabel: 'otvorite svoju probu',
        viaAccount: 'vaša proba živi u vašem sentinelpay računu, pa vas gumb prvo vodi na račun.',
        footnote: 'ovaj mail dobivate jer je s ove adrese pokrenuta proba na sentinelpay.org. ako to niste bili vi, samo ga zanemarite i ništa se ne događa.',
    },
    de: {
        subject: 'ihre sentinelpay testphase ist bereit',
        eyebrow: 'kostenlose testphase',
        title: 'ihre testphase ist bereit',
        intro: 'sie haben sich auf sentinelpay.org angemeldet. das erwartet sie.',
        bullets: [
            'sofort eine kostenlose prüfung und eine aus ihrer historie',
            'der rest ihrer historie ist schon da, nur gesperrt',
            'bestätigen sie ihre nummer, dann öffnet sich der rest, plus 10 live-prüfungen',
            'jede prüfung protokolliert, damit sie belegen können, was sie geprüft haben',
        ],
        ctaLabel: 'testphase öffnen',
        viaAccount: 'ihre testphase liegt in ihrem sentinelpay konto, der button öffnet also zuerst das konto.',
        footnote: 'sie erhalten diese e-mail, weil mit dieser adresse eine testphase auf sentinelpay.org gestartet wurde. waren sie das nicht, ignorieren sie die e-mail einfach.',
    },
};

// The trial app does not exist yet. Until TRIAL_APP_URL is set the mail says so
// plainly rather than shipping a button that leads nowhere.
function trialWelcomeMessage({ to, lang }) {
    const copy = TRIAL_COPY[lang] || TRIAL_COPY.en;
    const appUrl = process.env.TRIAL_APP_URL || '';
    return {
        to: to,
        lang: lang,
        subject: copy.subject,
        eyebrow: copy.eyebrow,
        title: copy.title,
        intro: copy.intro,
        bullets: copy.bullets,
        // there is a way in either way. until the trial app exists it is the
        // account, which is where the trial will live, rather than a sentence
        // promising a link that has never been sent.
        cta: { href: appUrl || (SITE + '/auth'), label: copy.ctaLabel },
        footnote: (appUrl ? '' : copy.viaAccount + ' ') + copy.footnote,
    };
}
async function sendTrialWelcome(opts) { return send(trialWelcomeMessage(opts)); }

// The verification code, and the message that goes out instead when the address
// already has an account. Both exist so that registering tells the person at the
// address what happened, and tells whoever typed it in the form nothing at all:
// the form's answer is identical either way, so it cannot be used to find out
// who has an account here.
const SIGNUP_COPY = {
    en: {
        subject: 'your sentinelpay code',
        eyebrow: 'verify your email',
        title: 'here is your code',
        intro: 'enter this to finish creating your sentinelpay account.',
        meta: (m) => ['expires in ' + m + ' minutes', 'single use'],
        footnote: 'if you did not try to create an account, ignore this email. nothing has been created and nobody can use this code without it.',
        warning: 'we will never ask you for this code, by email, chat or phone.',
        existsEyebrow: 'your account',
        existsSubject: 'about your sentinelpay account',
        existsTitle: 'you already have an account',
        existsCta: 'sign in',
        existsIntro: 'somebody tried to create an account with this address, so we did not make a second one.',
        existsFootnote: 'if that was you, sign in instead. if it was not, you do not need to do anything: no account was created and nothing has changed.',
    },
    hr: {
        subject: 'vaš sentinelpay kod',
        eyebrow: 'potvrdite svoj email',
        title: 'evo vašeg koda',
        intro: 'unesite ga da dovršite izradu sentinelpay računa.',
        meta: (m) => ['istječe za ' + m + ' minuta', 'jednokratan'],
        footnote: 'ako niste vi pokušali izraditi račun, samo zanemarite ovaj mail. ništa nije izrađeno i bez njega nitko ne može iskoristiti ovaj kod.',
        warning: 'nikada vas nećemo tražiti ovaj kod, ni mailom, ni chatom, ni telefonom.',
        existsEyebrow: 'vaš račun',
        existsSubject: 'o vašem sentinelpay računu',
        existsTitle: 'račun s ovom adresom već postoji',
        existsCta: 'prijavite se',
        existsIntro: 'netko je pokušao izraditi račun s ovom adresom, pa nismo izradili drugi.',
        existsFootnote: 'ako ste to bili vi, samo se prijavite. ako niste, ne morate ništa napraviti: račun nije izrađen i ništa se nije promijenilo.',
    },
    de: {
        subject: 'ihr sentinelpay code',
        eyebrow: 'bestätigen sie ihre e-mail',
        title: 'hier ist ihr code',
        intro: 'geben sie ihn ein, um ihr sentinelpay konto fertig anzulegen.',
        meta: (m) => ['läuft in ' + m + ' minuten ab', 'einmalig'],
        footnote: 'wenn sie kein konto anlegen wollten, ignorieren sie diese e-mail. es wurde nichts angelegt, und ohne sie kann niemand diesen code verwenden.',
        warning: 'wir fragen sie nie nach diesem code, weder per e-mail noch im chat oder am telefon.',
        existsEyebrow: 'ihr konto',
        existsSubject: 'zu ihrem sentinelpay konto',
        existsTitle: 'sie haben bereits ein konto',
        existsCta: 'anmelden',
        existsIntro: 'jemand hat versucht, mit dieser adresse ein konto anzulegen, deshalb haben wir kein zweites erstellt.',
        existsFootnote: 'waren sie das, melden sie sich einfach an. waren sie es nicht, müssen sie nichts tun: es wurde kein konto angelegt und nichts hat sich geändert.',
    },
};

function signupCodeMessage({ to, code, lang, minutes }) {
    const copy = SIGNUP_COPY[lang] || SIGNUP_COPY.en;
    return {
        to: to,
        lang: lang,
        subject: copy.subject,
        eyebrow: copy.eyebrow,
        title: copy.title,
        intro: copy.intro,
        code: code,
        meta: copy.meta(minutes),
        footnote: copy.footnote + ' ' + copy.warning,
    };
}
async function sendSignupCode(opts) { return send(signupCodeMessage(opts)); }

function signupExistsMessage({ to, lang }) {
    const copy = SIGNUP_COPY[lang] || SIGNUP_COPY.en;
    return {
        to: to,
        lang: lang,
        subject: copy.existsSubject,
        eyebrow: copy.existsEyebrow,
        title: copy.existsTitle,
        intro: copy.existsIntro,
        cta: { href: SITE + '/auth', label: copy.existsCta },
        footnote: copy.existsFootnote,
    };
}
async function sendSignupExists(opts) { return send(signupExistsMessage(opts)); }

// ---------------------------------------------------------------------------
// previews
// ---------------------------------------------------------------------------
//
// Every message the site sends, built with sample values and handed back rather
// than sent. Editing a template and reloading a page beats editing a template
// and posting a form to find out what it looks like, and because the preview
// runs through compose() it cannot show something the inbox will not.

const PREVIEWS = {
    'signup-code': (lang) => signupCodeMessage({ to: 'ana@primjer.hr', code: '481902', lang, minutes: 15 }),
    'signup-exists': (lang) => signupExistsMessage({ to: 'ana@primjer.hr', lang }),
    'trial-welcome': (lang) => trialWelcomeMessage({ to: 'ana@primjer.hr', lang }),
    // the two that go to us rather than to a customer. these are written where
    // they are sent, so the sample here mirrors them rather than sharing code:
    // if the endpoint changes and this does not, the preview is stale, and the
    // note below says so out loud.
    'trial-notice': () => ({
        subject: 'review: new trial sign-up: ana anic @ primjer d.o.o.',
        eyebrow: 'free trial',
        title: 'a company signed up for the trial',
        intro: 'the welcome email has been sent to them, but something here is worth a second look.',
        review: ['the address is on a free consumer mailbox, and the website they gave is on that same domain. worth thirty seconds on the company name before you reply.'],
        pairs: [
            ['name', 'ana anic'], ['job title', 'head of compliance'],
            ['work email', 'ana@primjer.hr'], ['company', 'primjer d.o.o.'],
            ['website', 'primjer.hr'], ['industry', 'payments'],
            ['country', 'croatia'], ['language', 'hr'],
            ['domain check', 'free-email'],
        ],
    }),
    'account-notice': () => ({
        subject: 'new account: ana anic',
        eyebrow: 'accounts',
        title: 'somebody created an account',
        intro: 'the address was verified by code before the account was written.',
        pairs: [['name', 'ana anic'], ['email', 'ana@primjer.hr'], ['language', 'hr']],
    }),
};

function previewNames() { return Object.keys(PREVIEWS); }

function render(name, lang) {
    const make = PREVIEWS[name];
    if (!make) return null;
    const msg = make(['hr', 'de', 'en'].includes(lang) ? lang : 'en');
    return Object.assign({ name: name, lang: lang }, compose(msg));
}

module.exports = {
    send, compose, sendTrialWelcome, sendSignupCode, sendSignupExists,
    render, previewNames, isConfigured, MAIL_FROM, MAIL_TO,
};
