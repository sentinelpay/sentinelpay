'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAIL_FROM = process.env.MAIL_FROM || 'sentinelpay <noreply@sentinelpay.org>';
const MAIL_TO = process.env.MAIL_TO || 'support@sentinelpay.org';
const SITE = 'https://sentinelpay.org';

function isConfigured() {
    return Boolean(process.env.RESEND_API_KEY);
}

function esc(s) {
    return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

const C = {
    page: '#f4f6fa',
    card: '#ffffff',
    line: '#e6e9f0',
    lineSoft: '#f0f2f7',
    text: '#0e2358',
    muted: '#6b7899',
    faint: '#94a0bd',
    cyan: '#0091c8',
    accent: '#2563eb',
    purple: '#7b6cff',
    tint: '#f2f9fc',
    tintLine: '#cfe9f4',
};

const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const FACES = [
    { family: "'Inter'", file: '/fonts/inter-latin.woff2', range: LATIN },
    { family: "'Inter'", file: '/fonts/inter-latin-ext.woff2', range: LATIN_EXT },
    { family: "'Plus Jakarta Sans'", file: '/fonts/jakarta-latin.woff2', range: LATIN },
    { family: "'Plus Jakarta Sans'", file: '/fonts/jakarta-latin-ext.woff2', range: LATIN_EXT },
];
const FONT = "Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Helvetica,Arial,sans-serif";
const DISPLAY = "'Plus Jakarta Sans',Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Helvetica,Arial,sans-serif";
const LOGO = SITE + '/logo.png';
const CHECK = SITE + '/mail-check.png';

const LEGAL = {
    name: process.env.COMPANY_LEGAL_NAME || 'Sentinelpay d.o.o. (in registration)',
    address: process.env.COMPANY_ADDRESS || 'Ulica i kućni broj, 10000 Zagreb, Croatia',
    reg: process.env.COMPANY_REG || 'OIB 00000000000 · MBS 000000000',
};
const FOOTER = {
    en: { questions: 'Questions', privacy: 'Privacy', terms: 'Terms', blog: 'Blog',
          contact: 'Need a hand? Write to', seat: 'Registered office' },
    hr: { questions: 'Pitanja', privacy: 'Privatnost', terms: 'Uvjeti', blog: 'Blog',
          contact: 'Trebate pomoć? Pišite na', seat: 'Sjedište' },
    de: { questions: 'Fragen', privacy: 'Datenschutz', terms: 'Bedingungen', blog: 'Blog',
          contact: 'Brauchen Sie Hilfe? Schreiben Sie an', seat: 'Sitz' },
};
function row(label, value) {
    if (!value) return '';
    return '<tr>' +
        '<td width="34%" style="padding:12px 18px 12px 0;vertical-align:top;font-size:13px;line-height:20px;color:' + C.muted + ';border-bottom:1px solid ' + C.lineSoft + ';">' + esc(label) + '</td>' +
        '<td style="padding:12px 0;vertical-align:top;font-size:14px;line-height:21px;color:' + C.text + ';font-weight:500;border-bottom:1px solid ' + C.lineSoft + ';">' + esc(value) + '</td>' +
        '</tr>';
}
function reviewBand(notes) {
    if (!notes || !notes.length) return '';
    return '<tr><td style="padding:0 36px 24px;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
        'style="background:#fff8ee;border:1px solid #f6dfbc;border-radius:12px;">' +
        '<tr><td style="padding:14px 16px;">' +
        '<div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;color:#b26a00;">Worth a look</div>' +
        notes.map((n) =>
            '<div style="margin-top:7px;font-size:13px;line-height:20px;color:#7a5417;">' + esc(n) + '</div>'
        ).join('') +
        '</td></tr></table></td></tr>';
}
function codeBlock(code) {
    if (!code) return '';
    return '<tr><td style="padding:4px 36px 26px;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
        'class="sp-note" style="background:' + C.tint + ';border:1px solid ' + C.tintLine + ';border-radius:14px;">' +
        '<tr><td align="center" style="padding:22px 14px;">' +
        '<div class="sp-title" style="font-family:' + DISPLAY + ';font-size:38px;line-height:46px;font-weight:800;' +
        'letter-spacing:0.24em;text-indent:0.24em;color:' + C.text + ';' +
        'font-variant-numeric:tabular-nums;font-feature-settings:\'tnum\';">' + esc(code) + '</div>' +
        '</td></tr></table></td></tr>';
}

function tickRow(b) {
    return '<tr>' +

        '<td width="16" style="padding:11px 14px 0 0;vertical-align:top;font-family:' + FONT + ';' +
        'font-size:15px;line-height:16px;font-weight:400;color:' + C.cyan + ';">' +
        '<img src="' + CHECK + '" width="16" height="16" alt="&#10003;" ' +
        'style="display:block;width:16px;height:16px;border:0;outline:none;">' +
        '</td>' +
        '<td style="padding:7px 0;font-size:15px;line-height:23px;color:' + C.text + ';">' + esc(b) + '</td>' +
        '</tr>';
}
function button(cta) {
    if (!cta) return '';

    return '<tr><td style="padding:6px 36px 0;">' +
        '<!--[if mso]>' +
        '<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" ' +
        'href="' + esc(cta.href) + '" style="height:47px;v-text-anchor:middle;width:488px;" ' +
        'arcsize="21%" stroke="f" fillcolor="' + C.text + '">' +
        '<w:anchorlock/>' +
        '<center style="color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;">' +
        esc(cta.label) + '</center>' +
        '</v:roundrect><![endif]-->' +
        '<!--[if !mso]><!-->' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
        '<tr><td align="center" bgcolor="' + C.text + '" style="border-radius:10px;">' +
        '<a href="' + esc(cta.href) + '" style="display:block;padding:14px 24px;font-family:' + DISPLAY + ';' +
        'font-size:13.5px;font-weight:700;letter-spacing:-0.006em;line-height:19px;color:#ffffff;text-decoration:none;' +
        'border-radius:10px;text-align:center;">' +
        esc(cta.label) + '</a>' +
        '</td></tr></table>' +
        '<!--<![endif]-->' +
        '</td></tr>';
}
function divider(pad) {
    return '<tr><td style="padding:' + (pad || '28px 36px') + ';">' +
        '<div class="sp-rule" style="height:1px;line-height:1px;font-size:0;background:' + C.line + ';">&nbsp;</div></td></tr>';
}
function layout({ eyebrow, title, intro, rows, bullets, cta, footnote, review, code, lang }) {
    const f = FOOTER[lang] || FOOTER.en;

    return '<!doctype html><html lang="' + esc(lang || 'en') + '" ' +
        'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">' +
        '<head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">' +
        '<!--[if mso]><style>*{mso-line-height-rule:exactly;}</style>' +
        '<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch>' +
        '</o:OfficeDocumentSettings></xml><![endif]-->' +
        '<style>' +
        FACES.map((f) =>
            '@font-face{font-family:' + f.family + ';font-style:normal;font-weight:300 800;' +
            'font-display:swap;src:url(' + SITE + f.file + ') format(\'woff2\');' +
            'unicode-range:' + f.range + ';}'
        ).join('') +
        '</style>' +
        '<style>' +
        '@media only screen and (max-width:620px){' +
        '.sp-pad{padding-left:22px!important;padding-right:22px!important;}' +
        '.sp-band{padding-left:22px!important;padding-right:22px!important;padding-top:28px!important;padding-bottom:24px!important;}' +
        '.sp-title{font-size:21px!important;line-height:26px!important;}' +
        '.sp-card{border-radius:20px!important;}' +
        '}' +
        '@media (prefers-color-scheme:dark){' +
        '.sp-page{background:#0a0c14!important;}' +
        '.sp-card{background:#101426!important;border-color:rgba(255,255,255,0.10)!important;}' +
        '.sp-title,.sp-strong{color:#ffffff!important;}' +
        '.sp-body,.sp-quiet{color:rgba(255,255,255,0.62)!important;}' +
        '.sp-note{background:#161b2e!important;border-color:rgba(255,255,255,0.09)!important;}' +
        '.sp-rule{background:rgba(255,255,255,0.12)!important;}' +
        '.sp-topline{border-top-color:rgba(255,255,255,0.10)!important;}' +
        '.sp-quiet{color:rgba(255,255,255,0.42)!important;}' +
        '.sp-quiet b,.sp-quiet span{color:rgba(255,255,255,0.62)!important;}' +
        '.sp-foot a{color:rgba(255,255,255,0.72)!important;}' +
        '}' +
        '</style>' +
        '</head>' +
        '<body class="sp-page" style="margin:0;padding:0;background:' + C.page + ';">' +
        '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' + esc(intro) + '</div>' +
        '<table role="presentation" class="sp-page" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + C.page + ';">' +
        '<tr><td align="center" style="padding:40px 16px;">' +

        '<!--[if mso]><table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +

        'class="sp-card" style="max-width:560px;background:' + C.card + ';border:1px solid ' + C.line + ';border-radius:26px;overflow:hidden;' +
        'box-shadow:0 24px 60px -34px rgba(14,35,88,0.3),0 2px 8px rgba(14,35,88,0.04);font-family:' + FONT + ';">' +
        '<tr><td class="sp-band" align="center" bgcolor="' + C.tint + '" ' +
        'style="padding:34px 36px 30px;background-color:' + C.tint + ';' +
        'background-image:linear-gradient(135deg,rgba(0,240,255,0.13) 0%,rgba(123,108,255,0.10) 52%,rgba(160,32,240,0.10) 100%);">' +
        '<a href="' + SITE + '" style="text-decoration:none;">' +
        '<img src="' + LOGO + '" width="52" height="52" alt="Sentinelpay" ' +
        'style="display:block;margin:0 auto;width:52px;height:52px;border:0;outline:none;text-decoration:none;">' +
        '</a>' +
        '</td></tr>' +
        '<tr><td style="height:3px;line-height:3px;font-size:0;background:' + C.cyan + ';' +
        'background-image:linear-gradient(90deg,#00f0ff 0%,' + C.purple + ' 50%,#a020f0 100%);">&nbsp;</td></tr>' +
        '<tr><td class="sp-pad" style="padding:30px 36px 0;">' +
        (eyebrow ? '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
            '<td width="3" bgcolor="' + C.accent + '" style="width:3px;height:14px;line-height:14px;font-size:0;' +
            'background:' + C.accent + ';border-radius:2px;">&nbsp;</td>' +
            '<td style="padding-left:9px;font-family:' + FONT + ';font-size:11px;line-height:14px;' +
            'letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:' + C.accent + ';">' +
            esc(eyebrow) + '</td></tr></table>' : '') +

        '<div class="sp-title" style="margin-top:14px;font-family:' + DISPLAY + ';font-size:25px;line-height:29px;font-weight:800;letter-spacing:-0.02em;color:' + C.text + ';">' + esc(title) + '</div>' +
        '<div class="sp-body" style="margin-top:12px;font-size:14.5px;line-height:22px;color:' + C.muted + ';">' + esc(intro) + '</div>' +
        '</td></tr>' +
        '<tr><td style="height:26px;line-height:26px;font-size:0;">&nbsp;</td></tr>' +
        reviewBand(review) +
        codeBlock(code) +
        (rows ? '<tr><td style="padding:0 36px 4px;">' +
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + rows + '</table>' +
            '</td></tr><tr><td style="height:22px;line-height:22px;font-size:0;">&nbsp;</td></tr>' : '') +
        (bullets && bullets.length ? '<tr><td style="padding:0 36px;">' +
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
            bullets.map(tickRow).join('') +
            '</table></td></tr><tr><td style="height:26px;line-height:26px;font-size:0;">&nbsp;</td></tr>' : '') +
        button(cta) +
        (cta ? '<tr><td style="height:28px;line-height:28px;font-size:0;">&nbsp;</td></tr>' : '') +
        (footnote ? '<tr><td style="padding:0 36px;">' +
            '<div class="sp-note" style="padding:14px 16px;background:#f7f9fc;border:1px solid ' + C.lineSoft + ';border-radius:12px;' +
            'font-size:12px;line-height:19px;color:' + C.muted + ';">' + esc(footnote) + '</div>' +
            '</td></tr><tr><td style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>' : '') +
        divider('24px 36px') +

        '<tr><td class="sp-foot sp-pad" align="center" style="padding:0 36px 30px;text-align:center;">' +
        '<div class="sp-quiet" style="font-size:12px;line-height:20px;color:' + C.faint + ';">' +
        '<a href="' + SITE + '/faq" style="color:' + C.muted + ';text-decoration:none;">' + esc(f.questions) + '</a>' +
        '<span style="color:' + C.faint + ';"> &nbsp;·&nbsp; </span>' +
        '<a href="' + SITE + '/privacy-policy" style="color:' + C.muted + ';text-decoration:none;">' + esc(f.privacy) + '</a>' +
        '<span style="color:' + C.faint + ';"> &nbsp;·&nbsp; </span>' +
        '<a href="' + SITE + '/terms-of-service" style="color:' + C.muted + ';text-decoration:none;">' + esc(f.terms) + '</a>' +
        '<span style="color:' + C.faint + ';"> &nbsp;·&nbsp; </span>' +
        '<a href="https://blog.sentinelpay.org" style="color:' + C.muted + ';text-decoration:none;">' + esc(f.blog) + '</a>' +
        '</div>' +
        '<div class="sp-body" style="margin-top:14px;font-size:12px;line-height:19px;color:' + C.muted + ';">' +
        esc(f.contact) + ' <a href="mailto:' + MAIL_TO + '" style="color:' + C.cyan + ';text-decoration:none;">' + MAIL_TO + '</a>' +
        '</div>' +
        '<div class="sp-quiet sp-topline" style="margin-top:18px;padding-top:16px;border-top:1px solid ' + C.lineSoft + ';' +
        'font-size:11px;line-height:18px;color:' + C.faint + ';">' +
        '<span style="color:' + C.muted + ';font-weight:600;">' + esc(LEGAL.name) + '</span><br>' +
        esc(f.seat) + ': ' + esc(LEGAL.address) + '<br>' +
        esc(LEGAL.reg) +
        '</div>' +
        '</td></tr>' +
        '<tr><td style="height:3px;line-height:3px;font-size:0;background:' + C.cyan + ';' +
        'background-image:linear-gradient(90deg,#00f0ff 0%,' + C.purple + ' 50%,#a020f0 100%);">&nbsp;</td></tr>' +
        '</table>' +
        '<!--[if mso]></td></tr></table><![endif]-->' +
        '</td></tr></table></body></html>';
}

function textVersion({ title, intro, pairs, bullets, cta, footnote, review, code, lang }) {
    const f = FOOTER[lang] || FOOTER.en;
    const lines = [title, '', intro, ''];
    if (code) lines.push(code, '');
    if (review && review.length) {
        lines.push('Worth a look:');
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
function compose(msg) {
    const { subject, eyebrow, title, intro, pairs, bullets, cta, footnote, review, code, lang } = msg;
    const rows = (pairs || []).map(([k, v]) => row(k, v)).join('');
    return {
        subject: subject,
        html: layout({ eyebrow, title, intro, rows, bullets, cta, footnote, review, code, lang }),
        text: textVersion({ title, intro, pairs, bullets, cta, footnote, review, code, lang }),
    };
}
async function domainStatus() {
    if (!isConfigured()) return 'no api key, so nothing to ask';
    const sender = (MAIL_FROM.match(/<([^>]+)>/) || [null, MAIL_FROM])[1];
    const domain = sender.split('@').pop().trim().toLowerCase();
    try {
        const { Resend } = require('resend');
        const list = await new Resend(process.env.RESEND_API_KEY).domains.list();
        if (list && list.error) {
            const name = String(list.error.name || '');
            if (name === 'restricted_api_key') {
                return 'the key may send but may not read the domain list, so this check cannot run. '
                    + 'that is a permission on the key, not a problem with the domain.';
            }
            if (name === 'validation_error' || name === 'missing_api_key' || /api key/i.test(list.error.message || '')) {
                return 'the provider refused the key: ' + (list.error.message || name)
                    + '. it has most likely been revoked or rotated.';
            }
            return 'could not ask the provider: ' + (list.error.message || name || 'unknown error');
        }
        const rows = (list && list.data && (list.data.data || list.data)) || [];
        if (!Array.isArray(rows)) return 'unexpected answer from the provider';
        const mine = rows.find((d) => String(d.name || '').toLowerCase() === domain);
        if (!mine) {
            return domain + ' is NOT added at the provider, so nothing sent from it can be delivered. '
                + 'known domains: ' + (rows.map((d) => d.name).join(', ') || 'none');
        }
        return {
            sendingAs: sender,
            domain: mine.name,
            status: mine.status,
            region: mine.region || null,
            ok: mine.status === 'verified',
        };
    } catch (err) {
        return 'could not ask the provider: ' + err.message;
    }
}
async function send(msg) {
    const { to, subject, replyTo } = msg;
    const { html, text } = compose(msg);
    if (!isConfigured()) {
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
    const payload = {
        from: MAIL_FROM,
        to: to || MAIL_TO,
        subject: subject,
        html: html,
        text: text,
    };
    payload.reply_to = replyTo || MAIL_TO;
    const result = await resend.emails.send(payload);
    if (result && result.error) {
        const err = new Error(result.error.message || 'resend rejected the message');
        err.code = 'MAIL_REJECTED';
        err.detail = result.error;
        console.error('[mail] rejected: ' + JSON.stringify(result.error));
        throw err;
    }
    const id = result && result.data && result.data.id;
    console.log('[mail] sent "' + subject + '" id=' + (id || 'no id returned'));
    return result;
}
const TRIAL_COPY = {
    en: {
        subject: 'Your Sentinelpay trial is ready',
        eyebrow: 'Free trial',
        title: 'Your trial is ready',
        intro: 'You signed up at sentinelpay.org. Here is what is waiting for you.',
        bullets: [
            'One free scan plus one from your history, right away',
            'The rest of your history is already there, just locked',
            'Verify your number and the rest opens, plus 10 live checks',
            'Every scan logged, so you can prove what you checked',
        ],
        ctaLabel: 'Open your trial',
        viaAccount: 'Your trial lives in your Sentinelpay account, so the button opens the account first.',
        footnote: 'You are getting this because this address was used to start a trial at sentinelpay.org. If that was not you, ignore this email and nothing happens.',
    },
    hr: {
        subject: 'Vaša Sentinelpay proba je spremna',
        eyebrow: 'Besplatna proba',
        title: 'Vaša proba je spremna',
        intro: 'Prijavili ste se na sentinelpay.org. Evo što vas čeka.',
        bullets: [
            'Odmah jedna besplatna provjera i jedna iz vaše povijesti',
            'Ostatak povijesti već je tu, samo je zaključan',
            'Potvrdite broj i otvara se ostatak, uz 10 provjera uživo',
            'Svaka provjera zapisana, pa možete dokazati što ste provjerili',
        ],
        ctaLabel: 'Otvorite svoju probu',
        viaAccount: 'Vaša proba živi u vašem Sentinelpay računu, pa vas gumb prvo vodi na račun.',
        footnote: 'Ovaj mail dobivate jer je s ove adrese pokrenuta proba na sentinelpay.org. Ako to niste bili vi, samo ga zanemarite i ništa se ne događa.',
    },
    de: {
        subject: 'Ihre Sentinelpay-Testphase ist bereit',
        eyebrow: 'Kostenlose Testphase',
        title: 'Ihre Testphase ist bereit',
        intro: 'Sie haben sich auf sentinelpay.org angemeldet. Das erwartet Sie.',
        bullets: [
            'Sofort eine kostenlose Prüfung und eine aus Ihrer Historie',
            'Der Rest Ihrer Historie ist schon da, nur gesperrt',
            'Bestätigen Sie Ihre Nummer, dann öffnet sich der Rest, plus 10 Live-Prüfungen',
            'Jede Prüfung protokolliert, damit Sie belegen können, was Sie geprüft haben',
        ],
        ctaLabel: 'Testphase öffnen',
        viaAccount: 'Ihre Testphase liegt in Ihrem Sentinelpay-Konto, der Button öffnet also zuerst das Konto.',
        footnote: 'Sie erhalten diese E-Mail, weil mit dieser Adresse eine Testphase auf sentinelpay.org gestartet wurde. Waren Sie das nicht, ignorieren Sie die E-Mail einfach.',
    },
};
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
        cta: { href: appUrl || (SITE + '/auth'), label: copy.ctaLabel },
        footnote: (appUrl ? '' : copy.viaAccount + ' ') + copy.footnote,
    };
}
async function sendTrialWelcome(opts) { return send(trialWelcomeMessage(opts)); }
const SIGNUP_COPY = {
    en: {
        subject: 'Your Sentinelpay code',
        eyebrow: 'Verify your email',
        title: 'Here is your code',

        intro: (m) => 'Enter this to finish creating your Sentinelpay account. It works once and stops working in ' + m + ' minutes.',
        footnote: 'If you did not try to create an account, ignore this email. Nothing has been created and nobody can use this code without it.',
        warning: 'We will never ask you for this code, by email, chat or phone.',
    },
    hr: {
        subject: 'Vaš Sentinelpay kod',
        eyebrow: 'Potvrdite svoj email',
        title: 'Evo vašeg koda',
        intro: (m) => 'Unesite ga da dovršite izradu Sentinelpay računa. Vrijedi ' + m + ' minuta i može se iskoristiti samo jednom.',
        footnote: 'Ako niste vi pokušali izraditi račun, samo zanemarite ovaj mail. Ništa nije izrađeno i bez njega nitko ne može iskoristiti ovaj kod.',
        warning: 'Nikada vas nećemo tražiti ovaj kod, ni mailom, ni chatom, ni telefonom.',
    },
    de: {
        subject: 'Ihr Sentinelpay-Code',
        eyebrow: 'Bestätigen Sie Ihre E-Mail',
        title: 'Hier ist Ihr Code',
        intro: (m) => 'Geben Sie ihn ein, um Ihr Sentinelpay-Konto fertig anzulegen. Er gilt ' + m + ' Minuten und kann nur einmal verwendet werden.',
        footnote: 'Wenn Sie kein Konto anlegen wollten, ignorieren Sie diese E-Mail. Es wurde nichts angelegt, und ohne sie kann niemand diesen Code verwenden.',
        warning: 'Wir fragen Sie nie nach diesem Code, weder per E-Mail noch im Chat oder am Telefon.',
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
        intro: copy.intro(minutes),
        code: code,
        footnote: copy.footnote + ' ' + copy.warning,
    };
}
async function sendSignupCode(opts) { return send(signupCodeMessage(opts)); }
const RESET_COPY = {
    en: {
        subject: 'Reset your Sentinelpay password',
        eyebrow: 'Password reset',
        title: 'Set a new password',
        intro: (m) => 'Somebody asked for a new password on this address. The link below works once and stops working in ' + m + ' minutes.',
        label: 'Set a new password',
        footnote: 'If this was not you, ignore this email. Nothing has changed, and the link stops working on its own.',
        warning: 'We will never ask you for your password, by email, chat or phone.',
    },
    hr: {
        subject: 'Postavite novu Sentinelpay lozinku',
        eyebrow: 'Nova lozinka',
        title: 'Postavite novu lozinku',
        intro: (m) => 'Netko je zatražio novu lozinku za ovu adresu. Poveznica ispod vrijedi ' + m + ' minuta i može se iskoristiti samo jednom.',
        label: 'Postavite novu lozinku',
        footnote: 'Ako to niste bili vi, samo zanemarite ovaj mail. Ništa nije promijenjeno, a poveznica prestaje vrijediti sama od sebe.',
        warning: 'Nikada vas nećemo tražiti vašu lozinku, ni mailom, ni chatom, ni telefonom.',
    },
    de: {
        subject: 'Setzen Sie Ihr Sentinelpay-Passwort zurück',
        eyebrow: 'Passwort zurücksetzen',
        title: 'Neues Passwort setzen',
        intro: (m) => 'Jemand hat für diese Adresse ein neues Passwort angefordert. Der Link unten gilt ' + m + ' Minuten und kann nur einmal verwendet werden.',
        label: 'Neues Passwort setzen',
        footnote: 'Wenn Sie das nicht waren, ignorieren Sie diese E-Mail. Es hat sich nichts geändert, und der Link verfällt von selbst.',
        warning: 'Wir fragen Sie nie nach Ihrem Passwort, weder per E-Mail noch im Chat oder am Telefon.',
    },
};
function resetLinkMessage({ to, link, lang, minutes }) {
    const copy = RESET_COPY[lang] || RESET_COPY.en;
    return {
        to: to,
        lang: lang,
        subject: copy.subject,
        eyebrow: copy.eyebrow,
        title: copy.title,
        intro: copy.intro(minutes),
        cta: { href: link, label: copy.label },
        footnote: copy.footnote + ' ' + copy.warning,
    };
}
async function sendResetLink(opts) { return send(resetLinkMessage(opts)); }

const CHANGED_COPY = {
    en: {
        subject: 'Your Sentinelpay password was changed',
        eyebrow: 'Security',
        title: 'Your password was changed',
        intro: (w) => 'This happened on ' + w + '. Every other device that was signed in has been signed out.',
        footnote: 'If this was you, there is nothing to do. If it was not, ask for a new password straight away and write to us: whoever did this no longer has a way in, but we should look at how they got one.',
    },
    hr: {
        subject: 'Vaša Sentinelpay lozinka je promijenjena',
        eyebrow: 'Sigurnost',
        title: 'Lozinka je promijenjena',
        intro: (w) => 'Dogodilo se ' + w + '. Svi ostali uređaji na kojima ste bili prijavljeni su odjavljeni.',
        footnote: 'Ako ste to bili vi, ne treba ništa raditi. Ako nisu, odmah zatražite novu lozinku i pišite nam: onaj ko je to napravio više nema pristup, ali želimo vidjeti kako ga je dobio.',
    },
    de: {
        subject: 'Ihr Sentinelpay-Passwort wurde geändert',
        eyebrow: 'Sicherheit',
        title: 'Ihr Passwort wurde geändert',
        intro: (w) => 'Das war am ' + w + '. Alle anderen angemeldeten Geräte wurden abgemeldet.',
        footnote: 'Waren Sie das, ist nichts zu tun. Waren Sie es nicht, fordern Sie sofort ein neues Passwort an und schreiben Sie uns: der Zugang ist bereits weg, aber wir wollen wissen, wie er entstanden ist.',
    },
};
function passwordChangedMessage({ to, lang, when, ip, country }) {
    const copy = CHANGED_COPY[lang] || CHANGED_COPY.en;
    const label = (LABELS[lang] || LABELS.en);
    return {
        to: to,
        lang: lang,
        subject: copy.subject,
        eyebrow: copy.eyebrow,
        title: copy.title,
        intro: copy.intro(when),
        pairs: [
            [label.when, when],
            [label.where, country || label.unknown],
            [label.address, ip || label.unknown],
        ],
        footnote: copy.footnote,
    };
}
const SIGNIN_COPY = {
    en: {
        subject: 'A new sign-in to your Sentinelpay account',
        eyebrow: 'Security',
        title: 'Somebody signed in',
        intro: (w) => 'A device that had not signed in before did so on ' + w + '.',
        footnote: 'If this was you, there is nothing to do. If it was not, change your password now: that signs out every device, including the one this is about.',
    },
    hr: {
        subject: 'Nova prijava na vaš Sentinelpay račun',
        eyebrow: 'Sigurnost',
        title: 'Netko se prijavio',
        intro: (w) => 'Uređaj s kojeg se dosad nije prijavljivalo prijavio se ' + w + '.',
        footnote: 'Ako ste to bili vi, ne treba ništa raditi. Ako nisu, promijenite lozinku sada: time se odjavljuju svi uređaji, uključujući ovaj.',
    },
    de: {
        subject: 'Eine neue Anmeldung bei Ihrem Sentinelpay-Konto',
        eyebrow: 'Sicherheit',
        title: 'Jemand hat sich angemeldet',
        intro: (w) => 'Ein Gerät, das sich vorher nie angemeldet hatte, hat es am ' + w + ' getan.',
        footnote: 'Waren Sie das, ist nichts zu tun. Waren Sie es nicht, ändern Sie jetzt Ihr Passwort: das meldet jedes Gerät ab, auch dieses.',
    },
};
const LABELS = {
    en: { when: 'When', where: 'Country', address: 'Network address', unknown: 'not recorded' },
    hr: { when: 'Kada', where: 'Zemlja', address: 'Mrežna adresa', unknown: 'nije zabilježeno' },
    de: { when: 'Wann', where: 'Land', address: 'Netzwerkadresse', unknown: 'nicht erfasst' },
};
function newSignInMessage({ to, lang, when, ip, country }) {
    const copy = SIGNIN_COPY[lang] || SIGNIN_COPY.en;
    const label = (LABELS[lang] || LABELS.en);
    return {
        to: to,
        lang: lang,
        subject: copy.subject,
        eyebrow: copy.eyebrow,
        title: copy.title,
        intro: copy.intro(when),
        pairs: [
            [label.when, when],
            [label.where, country || label.unknown],
            [label.address, ip || label.unknown],
        ],
        footnote: copy.footnote,
    };
}
async function sendPasswordChanged(opts) { return send(passwordChangedMessage(opts)); }
async function sendNewSignIn(opts) { return send(newSignInMessage(opts)); }

const PREVIEWS = {
    'signup-code': (lang) => signupCodeMessage({ to: 'ana@primjer.hr', code: '481902', lang, minutes: 15 }),
    'trial-welcome': (lang) => trialWelcomeMessage({ to: 'ana@primjer.hr', lang }),
    'reset-link': (lang) => resetLinkMessage({
        to: 'ana@primjer.hr', lang, minutes: 60,
        link: SITE + '/reset-password?token=example-token-not-a-real-one',
    }),
    'password-changed': (lang) => passwordChangedMessage({
        to: 'ana@primjer.hr', lang, when: '12.09.2026. 14:20 (UTC)', ip: '198.51.100.24', country: 'HR',
    }),
    'new-sign-in': (lang) => newSignInMessage({
        to: 'ana@primjer.hr', lang, when: '12.09.2026. 14:20 (UTC)', ip: '198.51.100.24', country: 'HR',
    }),
    'trial-notice': () => ({
        subject: 'Review: new trial sign-up: Ana Anić @ Primjer d.o.o.',
        eyebrow: 'Free trial',
        title: 'A company signed up for the trial',
        intro: 'The welcome email has been sent to them, but something here is worth a second look.',
        review: ['The address is on a free consumer mailbox, and the website they gave is on that same domain. Worth thirty seconds on the company name before you reply.'],
        pairs: [
            ['Name', 'Ana Anić'], ['Job title', 'Head of compliance'],
            ['Work email', 'ana@primjer.hr'], ['Company', 'Primjer d.o.o.'],
            ['Website', 'primjer.hr'], ['Industry', 'Payments'],
            ['Country', 'Croatia'], ['Language', 'hr'],
            ['Domain check', 'Free email'],
        ],
    }),
    'account-notice': () => ({
        subject: 'New account: Ana Anić',
        eyebrow: 'Accounts',
        title: 'Somebody created an account',
        intro: 'The address was verified by code before the account was written.',
        pairs: [['Name', 'Ana Anić'], ['Email', 'ana@primjer.hr'], ['Language', 'hr']],
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
    send, compose, sendTrialWelcome, sendSignupCode, sendResetLink,
    render, previewNames, isConfigured, domainStatus, MAIL_FROM, MAIL_TO,
    sendPasswordChanged, sendNewSignIn,
};