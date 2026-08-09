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
// The palette is the site's: near-black panel, cyan-to-purple accent, lowercase.
const C = {
    page: '#050505',
    card: '#0b0e13',
    line: 'rgba(255,255,255,0.09)',
    text: '#f2f5f8',
    muted: '#8b93a1',
    cyan: '#00f0ff',
    purple: '#a020f0',
};

function row(label, value) {
    if (!value) return '';
    return '<tr>' +
        '<td width="1%" style="padding:11px 18px 11px 0;vertical-align:top;font-size:12px;line-height:18px;color:' + C.muted + ';white-space:nowrap;border-bottom:1px solid ' + C.line + ';">' + esc(label) + '</td>' +
        '<td style="padding:11px 0;vertical-align:top;font-size:14px;line-height:20px;color:' + C.text + ';border-bottom:1px solid ' + C.line + ';">' + esc(value) + '</td>' +
        '</tr>';
}

// Builds the full document. `rows` is already-escaped markup from row().
// An amber band above everything else, the same colour the site's incident
// banner uses. It exists so a submission that needs a person to look at it
// cannot be skimmed past: the reasons are spelled out in words, not codes.
function reviewBand(notes) {
    if (!notes || !notes.length) return '';
    return '<tr><td style="padding:18px 28px 0;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
        'style="background:rgba(255,176,60,0.10);border:1px solid rgba(255,176,60,0.35);border-radius:10px;">' +
        '<tr><td style="padding:12px 14px;">' +
        '<div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#ffb03c;">worth a look</div>' +
        notes.map((n) =>
            '<div style="margin-top:6px;font-size:13px;line-height:19px;color:#ffe0bd;">' + esc(n) + '</div>'
        ).join('') +
        '</td></tr></table></td></tr>';
}

function layout({ eyebrow, title, intro, rows, bullets, cta, footnote, signoff, review }) {
    const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif";
    return '<!doctype html><html><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">' +
        '</head>' +
        '<body style="margin:0;padding:0;background:' + C.page + ';">' +
        // preheader: what the inbox list shows, kept out of the visible body
        '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' + esc(intro) + '</div>' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + C.page + ';padding:32px 16px;">' +
        '<tr><td align="center">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:' + C.card + ';border:1px solid ' + C.line + ';border-radius:16px;overflow:hidden;font-family:' + font + ';">' +

        // the gradient hairline the site uses on top of its cards
        '<tr><td style="height:3px;line-height:3px;font-size:0;background:' + C.cyan + ';background-image:linear-gradient(90deg,' + C.cyan + ' 0%,' + C.purple + ' 100%);">&nbsp;</td></tr>' +

        '<tr><td style="padding:28px 28px 0;">' +
        '<a href="' + SITE + '" style="text-decoration:none;color:' + C.text + ';font-size:16px;font-weight:700;letter-spacing:-0.01em;">sentinelpay</a>' +
        '</td></tr>' +

        '<tr><td style="padding:22px 28px 0;">' +
        '<div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:' + C.cyan + ';">' + esc(eyebrow) + '</div>' +
        '<div style="margin-top:8px;font-size:22px;line-height:30px;font-weight:700;color:' + C.text + ';">' + esc(title) + '</div>' +
        '<div style="margin-top:8px;font-size:14px;line-height:21px;color:' + C.muted + ';">' + esc(intro) + '</div>' +
        '</td></tr>' +

        reviewBand(review) +

        (rows ? '<tr><td style="padding:20px 28px 4px;">' +
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + rows + '</table>' +
            '</td></tr>' : '') +

        // checklist, styled like the one on the trial page: a cyan tick per line
        (bullets && bullets.length ? '<tr><td style="padding:20px 28px 0;">' +
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
            bullets.map(function (b) {
                return '<tr>' +
                    '<td width="1%" style="padding:5px 10px 5px 0;vertical-align:top;font-size:14px;line-height:21px;color:' + C.cyan + ';">&#10003;</td>' +
                    '<td style="padding:5px 0;font-size:14px;line-height:21px;color:' + C.text + ';">' + esc(b) + '</td>' +
                    '</tr>';
            }).join('') +
            '</table></td></tr>' : '') +

        // bulletproof-ish button: a padded anchor, which every client renders
        (cta ? '<tr><td style="padding:26px 28px 0;">' +
            '<a href="' + esc(cta.href) + '" style="display:inline-block;padding:13px 26px;border-radius:10px;background:' + C.cyan + ';color:#04252b;font-size:14px;font-weight:700;text-decoration:none;">' + esc(cta.label) + '</a>' +
            '</td></tr>' : '') +

        (footnote ? '<tr><td style="padding:18px 28px 0;">' +
            '<div style="padding:12px 14px;border:1px solid ' + C.line + ';border-radius:10px;font-size:12px;line-height:18px;color:' + C.muted + ';">' + esc(footnote) + '</div>' +
            '</td></tr>' : '') +

        '<tr><td style="padding:22px 28px 26px;">' +
        '<div style="border-top:1px solid ' + C.line + ';padding-top:14px;font-size:11px;line-height:17px;color:' + C.muted + ';">' +
        esc(signoff || 'sent automatically by sentinelpay.org. reply to this email to answer the sender directly.') +
        '</div></td></tr>' +

        '</table></td></tr></table></body></html>';
}

// Plain-text alternative. Without it, spam filters mark an html-only mail down and
// some clients render nothing at all.
function textVersion({ title, intro, pairs, bullets, cta, footnote, review }) {
    const lines = [title, '', intro, ''];
    if (review && review.length) {
        lines.push('worth a look:');
        review.forEach((n) => lines.push('  - ' + n));
        lines.push('');
    }
    (pairs || []).forEach(([k, v]) => { if (v) lines.push(k + ': ' + v); });
    (bullets || []).forEach((b) => lines.push('- ' + b));
    if (cta) lines.push('', cta.label + ': ' + cta.href);
    if (footnote) lines.push('', footnote);
    lines.push('', 'sent automatically by sentinelpay.org');
    return lines.join('\n');
}

// Sends, or throws. It never resolves quietly when nothing was sent: an endpoint
// that answers "ok" while the inbox stays empty is the worst possible outcome.
async function send({ to, subject, replyTo, eyebrow, title, intro, pairs, bullets, cta, footnote, signoff, review }) {
    const rows = (pairs || []).map(([k, v]) => row(k, v)).join('');
    const html = layout({ eyebrow, title, intro, rows, bullets, cta, footnote, signoff, review });
    const text = textVersion({ title, intro, pairs, bullets, cta, footnote, review });

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
    const result = await resend.emails.send({
        from: MAIL_FROM,
        to: to || MAIL_TO,
        replyTo: replyTo,
        subject: subject,
        html: html,
        text: text,
    });

    // the sdk reports api errors in the payload rather than by rejecting
    if (result && result.error) {
        const err = new Error(result.error.message || 'resend rejected the message');
        err.code = 'MAIL_REJECTED';
        throw err;
    }
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
            'confirm by sms to unlock it all and 10 live checks',
            'every scan logged, so you can prove what you checked',
        ],
        ctaLabel: 'open your trial',
        pending: 'we are opening your account now and this link will follow in a separate email shortly.',
        footnote: 'you are getting this because this address was used to start a trial at sentinelpay.org. if that was not you, ignore this email and nothing happens.',
        signoff: 'sent by sentinelpay.org. need a hand? open the live chat on our site.',
    },
    hr: {
        subject: 'vaša sentinelpay proba je spremna',
        eyebrow: 'besplatna proba',
        title: 'vaša proba je spremna',
        intro: 'prijavili ste se na sentinelpay.org. evo što vas čeka.',
        bullets: [
            'odmah jedna besplatna provjera i jedna iz vaše povijesti',
            'ostatak povijesti već je tu, samo je zaključan',
            'potvrdite se sms-om i otključavate sve i 10 provjera uživo',
            'svaka provjera zapisana, pa možete dokazati što ste provjerili',
        ],
        ctaLabel: 'otvorite svoju probu',
        pending: 'upravo otvaramo vaš račun i ovaj link stiže u zasebnom mailu ubrzo.',
        footnote: 'ovaj mail dobivate jer je s ove adrese pokrenuta proba na sentinelpay.org. ako to niste bili vi, samo ga zanemarite i ništa se ne događa.',
        signoff: 'šalje sentinelpay.org. trebate pomoć? otvorite chat uživo na našoj stranici.',
    },
    de: {
        subject: 'ihre sentinelpay testphase ist bereit',
        eyebrow: 'kostenlose testphase',
        title: 'ihre testphase ist bereit',
        intro: 'sie haben sich auf sentinelpay.org angemeldet. das erwartet sie.',
        bullets: [
            'sofort eine kostenlose prüfung und eine aus ihrer historie',
            'der rest ihrer historie ist schon da, nur gesperrt',
            'per sms bestätigen und alles plus 10 live-prüfungen freischalten',
            'jede prüfung protokolliert, damit sie belegen können, was sie geprüft haben',
        ],
        ctaLabel: 'testphase öffnen',
        pending: 'wir richten ihr konto gerade ein, der link folgt in kürze in einer separaten e-mail.',
        footnote: 'sie erhalten diese e-mail, weil mit dieser adresse eine testphase auf sentinelpay.org gestartet wurde. waren sie das nicht, ignorieren sie die e-mail einfach.',
        signoff: 'gesendet von sentinelpay.org. brauchen sie hilfe? öffnen sie den live-chat auf unserer website.',
    },
};

// The trial app does not exist yet. Until TRIAL_APP_URL is set the mail says so
// plainly rather than shipping a button that leads nowhere.
async function sendTrialWelcome({ to, lang }) {
    const copy = TRIAL_COPY[lang] || TRIAL_COPY.en;
    const appUrl = process.env.TRIAL_APP_URL || '';
    return send({
        to: to,
        subject: copy.subject,
        eyebrow: copy.eyebrow,
        title: copy.title,
        intro: copy.intro,
        bullets: copy.bullets,
        cta: appUrl ? { href: appUrl, label: copy.ctaLabel } : null,
        footnote: appUrl ? copy.footnote : copy.pending + ' ' + copy.footnote,
        signoff: copy.signoff,
    });
}

module.exports = { send, sendTrialWelcome, isConfigured, MAIL_FROM, MAIL_TO };
