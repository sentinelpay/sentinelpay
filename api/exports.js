'use strict';

// The usage page as a file, in the four shapes a compliance team asks for.
//
// Every format is drawn from one list of sheets, built once from the same
// payload the page draws. A CSV that said one thing and a workbook that said
// another would be two records of one period, and an examiner holding both is
// entitled to ask which is true. So there is one set of numbers, and one
// reference over them: a SHA-256 of the sheets themselves, printed in every
// format, so a printed report and a spreadsheet handed over months apart can
// be shown to describe the same thing.

const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FORMATS = ['csv', 'xlsx', 'json', 'html'];

// the codes the lists use, written the way a person reads a chain
const CHAIN_NAMES = {
    XBT: 'BTC', BSC: 'BNB', MATIC: 'POL', ARB: 'Arbitrum', BASE: 'Base', OP: 'Optimism',
};
function chainName(code) {
    if (!code || code === 'other') return 'Not recognised';
    return CHAIN_NAMES[code] || code;
}

const KIND_NAMES = [
    ['live', 'Live checks'], ['rescreen', 'Re-screens'], ['transaction', 'Transaction screens'],
    ['history', 'History sweeps'], ['bulk', 'Bulk screens'],
];
// 'other' is the work in the scope not being reported -- the sandbox on the
// production report, production on the sandbox one. It is said once, as what
// was left out, and never counted among the kinds of work that were done.
const LIST_NAMES = [
    ['ofac', 'OFAC SDN'], ['ofacOther', 'OFAC non-SDN lists'], ['eu', 'EU consolidated list'],
    ['uk', 'UK sanctions list'], ['un', 'UN consolidated list'], ['ca', 'Canada (SEMA)'],
    ['au', 'Australia (DFAT)'], ['ch', 'Switzerland (SECO)'], ['jp', 'Japan (MOF)'],
];
const THEME_NAMES = [
    ['cyber', 'Cyber-related'], ['drugs', 'Narcotics'], ['terror', 'Terrorism'], ['dprk', 'North Korea'],
    ['crime', 'Organised crime'], ['russia', 'Russia and Ukraine'], ['iran', 'Iran'],
    ['weapons', 'Weapons proliferation'], ['other', 'Other programmes'],
];

// A date as its day. What comes back from the database is a Date, not a
// string, and String() of a Date starts with the weekday: cut to ten
// characters it read "Fri Jun 12", which a parser takes for the year 2001.
function day(iso) {
    if (!iso) return '';
    const d = iso instanceof Date ? iso : new Date(iso);
    return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10) : d.toISOString().slice(0, 10);
}
function share(n, all) {
    return all ? Math.round((n / all) * 1000) / 10 : 0;
}
const total = (line) => (line && line.total) || 0;

// The sheets. Each is { name, head, rows, note? }: a heading row and rows of
// plain values, numbers kept as numbers so a spreadsheet can add them up.
function sheets(out, org, sub) {
    const s = out.screenings || {};
    const v = s.verdicts || {};
    const kinds = out.kinds || {};
    const rv = out.review || {};
    const q = rv.queue || {};
    const li = out.lists || {};
    const ap = out.api || {};
    const tm = out.team || {};
    const ev = out.evidence || {};
    const es = ev.state || {};
    const shape = out.org || {};
    const inc = (sub && sub.included) || {};
    const list = [];

    // The window before this one, the same length, cut to the same number of
    // days where this one is still running, so a quarter two days old is
    // compared with two days and not with three months. Beside each count it
    // can be compared on; blank beside the ones that are a state now rather
    // than a count over a window.
    const prev = out.previous || null;
    const pk = (prev && prev.kinds) || {};
    const pr = (prev && prev.review) || {};
    const pa = (prev && prev.api) || {};
    const was = (fn) => { if (!prev) return ''; try { return fn(); } catch (e) { return ''; } };
    // checks made in the other scope over the same window: on the production
    // report, the sandbox work it leaves out, said so rather than hidden
    const other = out.scope === 'sandbox' ? null : total(kinds.other);
    list.push({
        name: 'Summary',
        head: ['Item', 'Value', 'Period before'],
        rows: [
            ['Organisation', (org && org.name) || '', ''],
            ['Period from', day(out.period.from), was(() => day(prev.from))],
            ['Period to', day(out.period.to), was(() => day(prev.to))],
            ['Scope', out.scope === 'sandbox' ? 'Sandbox' : 'Production', ''],
            ['Time zone', out.zone || 'UTC', ''],
            ['Plan', sub ? sub.planName : '', ''],
            ['Screenings', s.total || 0, was(() => prev.total || 0)],
            ['Screenings included this cycle', inc.screenings == null ? '' : inc.screenings, ''],
            ['Screenings used this cycle', out.cycle ? out.cycle.used : s.total || 0, ''],
            ['Sanctioned', v.severe || 0, was(() => prev.severe || 0)],
            ['Worth a look', v.review || 0, was(() => Math.max(0, (prev.flagged || 0) - (prev.severe || 0)))],
            ['Clear', v.clear || 0, was(() => Math.max(0, (prev.total || 0) - (prev.flagged || 0)))],
            ['Distinct addresses', s.addresses || 0, was(() => prev.addresses || 0)],
            ['Chains screened', s.assetCount || 0, was(() => prev.assetCount || 0)],
            ['History sweeps', total(kinds.history), was(() => total(pk.history))],
            ['Decisions recorded', total(rv.decisions), was(() => total(pr.decisions))],
            ['Cleared', total(rv.cleared), was(() => total(pr.cleared))],
            ['Confirmed', total(rv.confirmed), was(() => total(pr.confirmed))],
            ['Findings open now', q.open || 0, ''],
            ['Oldest open finding', day(q.oldest), ''],
            ['Members', shape.members || 0, ''],
            ['Projects', shape.projects || 0, ''],
            ['Active API tokens', shape.tokens || 0, ''],
            ['API calls', total(ap.calls), was(() => total(pa.calls))],
            ['Webhook deliveries', total(ap.deliveries), was(() => total(pa.deliveries))],
            ['Checks on record', es.checks || 0, ''],
            ['Sealed with a digest', es.sealed || 0, ''],
            ['Decisions on record', es.decisions || 0, ''],
            ['Oldest record', day(es.oldest), ''],
            ['Kept for (years)', es.retentionYears || '', ''],
        ].concat(other === null ? [] : [['Sandbox checks not included', other, was(() => total(pk.other))]]),
    });

    // One row per day, every daily line on the page side by side. The days are
    // the same buckets in every series, cut in the reader's zone on the server,
    // so they line up by position.
    const days = s.days || [];
    const at = (line, i) => (line && line.days && line.days[i] ? line.days[i].n || 0 : 0);
    list.push({
        name: 'Daily',
        head: ['Day', 'Screenings', 'Flagged', 'Sanctioned', 'Distinct addresses', 'Decisions',
            'Cleared', 'Confirmed', 'API calls', 'Webhook deliveries'],
        rows: days.map((d, i) => [
            d.day, d.n || 0, d.flagged || 0, d.severe || 0, d.addresses || 0,
            at(rv.decisions, i), at(rv.cleared, i), at(rv.confirmed, i),
            at(ap.calls, i), at(ap.deliveries, i),
        ]),
    });

    list.push({
        name: 'Screenings',
        head: ['Breakdown', 'Row', 'Checks', 'Share %'],
        rows: [].concat(
            KIND_NAMES.map(([k, name]) => ['By kind', name, total(kinds[k]), share(total(kinds[k]), s.total)]),
            ['severe', 'review', 'clear'].map((k) => ['By verdict',
                { severe: 'Sanctioned', review: 'Worth a look', clear: 'Clear' }[k], v[k] || 0, share(v[k] || 0, s.total)]),
            (s.assets || []).map((a) => ['By chain', chainName(a.asset), a.n, share(a.n, s.total)]),
            (s.projects || []).map((p) => ['By project', p.id ? (p.name || 'Unnamed project') : 'No project', p.n, share(p.n, s.total)])
        ),
    });

    const took = rv.took || {};
    const age = q.age || {};
    const tookAll = (took.hour || 0) + (took.day || 0) + (took.week || 0) + (took.longer || 0);
    list.push({
        name: 'Review',
        head: ['Breakdown', 'Row', 'Count', 'Share %'],
        rows: [
            ['Time to a decision', 'Under an hour', took.hour || 0, share(took.hour || 0, tookAll)],
            ['Time to a decision', 'Within a day', took.day || 0, share(took.day || 0, tookAll)],
            ['Time to a decision', 'Within a week', took.week || 0, share(took.week || 0, tookAll)],
            ['Time to a decision', 'Longer than a week', took.longer || 0, share(took.longer || 0, tookAll)],
            ['Still open, by age', 'Under a day', age.day || 0, share(age.day || 0, q.open)],
            ['Still open, by age', 'One to seven days', age.week || 0, share(age.week || 0, q.open)],
            ['Still open, by age', 'Seven to thirty days', age.month || 0, share(age.month || 0, q.open)],
            ['Still open, by age', 'Over thirty days', age.older || 0, share(age.older || 0, q.open)],
        ],
    });

    const bl = li.byList || {};
    const bt = li.byTheme || {};
    const blAll = LIST_NAMES.reduce((a, [k]) => a + (bl[k] || 0), 0);
    const btAll = THEME_NAMES.reduce((a, [k]) => a + (bt[k] || 0), 0);
    const bcAll = (li.byChain || []).reduce((a, r) => a + r.n, 0);
    list.push({
        name: 'Coverage',
        head: ['Breakdown', 'Row', 'Designated addresses', 'Share %'],
        rows: [].concat(
            LIST_NAMES.map(([k, name]) => ['By list', name, bl[k] || 0, share(bl[k] || 0, blAll)]),
            THEME_NAMES.map(([k, name]) => ['By programme', name, bt[k] || 0, share(bt[k] || 0, btAll)]),
            (li.byChain || []).map((r) => ['By chain', chainName(r.asset), r.n, share(r.n, bcAll)])
        ),
    });

    const eps = ap.byEndpoint || [];
    const epAll = eps.reduce((a, e) => a + e.n, 0);
    list.push({
        name: 'API',
        head: ['Endpoint', 'Calls', 'Share %'],
        rows: eps.map((e) => [e.path, e.n, share(e.n, epAll)]),
    });

    const ts = tm.state || {};
    const roles = ts.roles || {};
    const seen = ts.seen || {};
    const members = shape.members || 0;
    list.push({
        name: 'Team',
        head: ['Breakdown', 'Row', 'Members', 'Share %'],
        rows: [].concat(
            [['owner', 'Owner'], ['admin', 'Admin'], ['analyst', 'Analyst'], ['viewer', 'Viewer']]
                .map(([k, name]) => ['By role', name, roles[k] || 0, share(roles[k] || 0, members)]),
            [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['older', 'Longer ago'], ['never', 'Never']]
                .map(([k, name]) => ['Last signed in', name, seen[k] || 0, share(seen[k] || 0, members)]),
            [['Security', 'Members with two-factor', ts.mfa || 0, share(ts.mfa || 0, members)]]
        ),
    });

    const ea = es.age || {};
    list.push({
        name: 'Evidence',
        head: ['Breakdown', 'Row', 'Records', 'Share %'],
        rows: [
            ['Records, by age', 'Under 30 days', ea.month || 0, share(ea.month || 0, es.checks)],
            ['Records, by age', '30 to 90 days', ea.quarter || 0, share(ea.quarter || 0, es.checks)],
            ['Records, by age', '90 days to a year', ea.year || 0, share(ea.year || 0, es.checks)],
            ['Records, by age', 'Over a year', ea.older || 0, share(ea.older || 0, es.checks)],
            ['Sealed, by kind', 'Checks', es.sealed || 0, share(es.sealed || 0, (es.sealed || 0) + (es.decisions || 0))],
            ['Sealed, by kind', 'Decisions', es.decisions || 0, share(es.decisions || 0, (es.sealed || 0) + (es.decisions || 0))],
        ],
    });
    return list;
}

// The reference over the numbers, not over any one file: the same period
// exported as a spreadsheet and as a printed report carries the same one.
function reference(list) {
    return crypto.createHash('sha256').update(JSON.stringify(list), 'utf8').digest('hex');
}

// ---- csv

function csvCell(value) {
    const s = String(value === null || value === undefined ? '' : value);
    // a cell that begins with one of these is run as a formula by a spreadsheet,
    // which is how a file of numbers becomes something that does things
    const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
    return /[",\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

function csv(list, meta) {
    const lines = ['Sentinelpay usage report', 'Reference,sha256:' + meta.reference,
        'Generated,' + meta.generated, ''];
    list.forEach((sh) => {
        lines.push(csvCell(sh.name));
        lines.push(sh.head.map(csvCell).join(','));
        sh.rows.forEach((r) => lines.push(r.map(csvCell).join(',')));
        lines.push('');
    });
    // a byte-order mark, or Excel opens a file of Croatian names as mojibake
    return '﻿' + lines.join('\r\n') + '\r\n';
}

// ---- json

function json(list, meta, out) {
    return JSON.stringify({
        report: 'sentinelpay-usage',
        version: 1,
        reference: 'sha256:' + meta.reference,
        generated: meta.generated,
        organisation: meta.organisation,
        period: { from: out.period.from, to: out.period.to, zone: out.zone || 'UTC' },
        scope: out.scope === 'sandbox' ? 'sandbox' : 'production',
        sheets: list.map((sh) => ({
            name: sh.name,
            columns: sh.head,
            rows: sh.rows,
        })),
    }, null, 2) + '\n';
}

// ---- xlsx
//
// A workbook is a zip of a few XML files. Written here rather than pulled in as
// a dependency: the format needed is one sheet per table with a bold heading
// row and numbers that stay numbers, which is a hundred lines, and a library
// for it is a large surface to add to a service that holds sanctions data.

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();
function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
    const parts = [];
    const central = [];
    let offset = 0;
    files.forEach(({ name, data }) => {
        const raw = Buffer.from(data, 'utf8');
        const packed = zlib.deflateRawSync(raw);
        const nameBuf = Buffer.from(name, 'utf8');
        const crc = crc32(raw);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6); // names are utf-8
        local.writeUInt16LE(8, 8); // deflate
        local.writeUInt32LE(0, 10); // time and date: none, so the bytes depend on the numbers alone
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(packed.length, 18);
        local.writeUInt32LE(raw.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);
        parts.push(local, nameBuf, packed);

        const dir = Buffer.alloc(46);
        dir.writeUInt32LE(0x02014b50, 0);
        dir.writeUInt16LE(20, 4);
        dir.writeUInt16LE(20, 6);
        dir.writeUInt16LE(0x0800, 8);
        dir.writeUInt16LE(8, 10);
        dir.writeUInt32LE(0, 12);
        dir.writeUInt32LE(crc, 16);
        dir.writeUInt32LE(packed.length, 20);
        dir.writeUInt32LE(raw.length, 24);
        dir.writeUInt16LE(nameBuf.length, 28);
        dir.writeUInt32LE(offset, 42);
        central.push(dir, nameBuf);
        offset += local.length + nameBuf.length + packed.length;
    });
    const dirBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(dirBuf.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat(parts.concat([dirBuf, end]));
}

function xmlText(v) {
    return String(v).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
        // characters XML 1.0 has no way to carry
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}
function colName(i) {
    let s = '';
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
}
function cellXml(value, ref, style) {
    const st = style ? ' s="' + style + '"' : '';
    if (typeof value === 'number' && Number.isFinite(value)) {
        return '<c r="' + ref + '"' + st + '><v>' + value + '</v></c>';
    }
    return '<c r="' + ref + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' +
        xmlText(value === null || value === undefined ? '' : value) + '</t></is></c>';
}
function sheetXml(sh) {
    const rows = [sh.head].concat(sh.rows);
    const widths = sh.head.map((_, c) => Math.min(60, Math.max(10,
        ...rows.map((r) => String(r[c] === undefined ? '' : r[c]).length + 2))));
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        // the heading row stays on screen while the rows scroll under it
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
        '<cols>' + widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>' +
        '<sheetData>' + rows.map((r, ri) => '<row r="' + (ri + 1) + '">' +
            r.map((v, ci) => cellXml(v, colName(ci) + (ri + 1), ri === 0 ? 1 : 0)).join('') + '</row>').join('') +
        '</sheetData></worksheet>';
}

function xlsx(list, meta) {
    // the reference and the moment, as the first sheet's last two rows, so a
    // workbook carries the same proof a printed report does
    const withRef = list.map((sh, i) => (i === 0 ? {
        ...sh, rows: sh.rows.concat([['Generated', meta.generated], ['Reference', 'sha256:' + meta.reference]]),
    } : sh));
    const files = [
        { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Default Extension="xml" ContentType="application/xml"/>' +
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
            withRef.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) +
                '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
            '</Types>' },
        { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
            '</Relationships>' },
        { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
            withRef.map((sh, i) => '<sheet name="' + xmlText(sh.name.slice(0, 31)) + '" sheetId="' + (i + 1) +
                '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>' },
        { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            withRef.map((_, i) => '<Relationship Id="rId' + (i + 1) +
                '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' +
                (i + 1) + '.xml"/>').join('') +
            '<Relationship Id="rId' + (withRef.length + 1) +
                '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
            '</Relationships>' },
        { name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
            '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
            '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
            '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
            '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
            '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
            '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
            '</styleSheet>' },
    ].concat(withRef.map((sh, i) => ({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXml(sh) })));
    return zip(files);
}

// ---- the printed report
//
// A page made to be printed or saved as a PDF and signed. Laid out for A4,
// with the reference on every page and room at the end for the two people who
// put their names to it, which is how a report like this is handed over.

// ---- the language the paper is printed in
//
// The dashboard's own dictionary, read from the file the browser loads, so the
// report and the screen around it say the same thing in the same words and one
// set of translations is kept. Only what is printed changes with the language:
// the sheets, and the reference taken over them, are the same in every one, so
// a Croatian copy and an English copy of one period carry one reference.
const LANGS = ['en', 'hr', 'de'];
const LOCALES = { en: 'en-GB', hr: 'hr-HR', de: 'de-DE' };
let DICT = null;
function dictionary() {
    if (DICT) return DICT;
    try {
        const src = fs.readFileSync(path.join(__dirname, 'public', 'i18n.js'), 'utf8');
        // the object literal after "var T =", found by its own closing brace:
        // braces are counted and quoted strings stepped over, so a brace
        // inside a translation does not end it early
        const start = src.indexOf('{', src.indexOf('var T = '));
        let depth = 0;
        let end = -1;
        for (let i = start; i < src.length; i++) {
            const c = src[i];
            if (c === '"' || c === "'") {
                for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
                continue;
            }
            if (c === '{') depth++;
            else if (c === '}' && --depth === 0) { end = i; break; }
        }
        DICT = vm.runInNewContext('(' + src.slice(start, end + 1) + ')', Object.create(null), { timeout: 2000 });
    } catch (err) {
        console.error('[exports] could not read the dictionary: ' + err.message);
        DICT = { hr: {}, de: {} };
    }
    return DICT;
}
function langOf(v) {
    const l = String(v || '').toLowerCase().slice(0, 2);
    return LANGS.includes(l) ? l : 'en';
}
// The strings a report asked for that the dictionary does not have, for the
// test that holds every printed word to a translation.
const MISSED = new Set();
function speaker(lang) {
    const d = lang === 'en' ? null : (dictionary()[lang] || {});
    const locale = LOCALES[lang];
    // a phrase in the language, with its {holes} filled; plain text
    const tr = (s, vals) => {
        let t = s;
        if (d) {
            if (Object.prototype.hasOwnProperty.call(d, s)) t = d[s];
            else MISSED.add(lang + ': ' + s);
        }
        return vals ? t.replace(/\{(\w+)\}/g, (m, k) => (k in vals ? String(vals[k]) : m)) : t;
    };
    // the same, escaped for the page, with the values escaped too and {br} a
    // line break where the language wants one
    const h = (s, vals) => {
        let t = s;
        if (d) {
            if (Object.prototype.hasOwnProperty.call(d, s)) t = d[s];
            else MISSED.add(lang + ': ' + s);
        }
        return esc(t).replace(/\{(\w+)\}/g, (m, k) => (k === 'br' ? '<br>' : (vals && k in vals ? esc(vals[k]) : m)));
    };
    const num = (v) => (typeof v === 'number' ? v.toLocaleString(locale) : esc(v));
    const date = (iso) => {
        if (!iso) return '';
        const x = new Date(iso);
        return Number.isNaN(x.getTime()) ? esc(iso)
            : x.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    };
    return { lang, locale, tr, h, num, date };
}

// The fonts, inside the page rather than linked from it. A PDF is rendered
// with every request refused, so what the page needs it has to carry.
//
// Not the files fonts.css serves, though. Those are variable fonts, and
// Chromium puts a variable font into a PDF as a drawing of each letter rather
// than as a font: a seven page report came to 933 KB. print-fonts holds the
// same letters cut at the fixed weights the report uses (tools/print-fonts.py
// makes them), each declared here with the character range fonts.css gives
// its file, so a page in Croatian or German reaches for the same second file
// the site does.
let FONTS = null;
function inlineFonts() {
    if (FONTS !== null) return FONTS;
    try {
        const css = fs.readFileSync(path.join(__dirname, 'public', 'fonts.css'), 'utf8');
        const dir = path.join(__dirname, 'print-fonts');
        const have = fs.readdirSync(dir);
        FONTS = '';
        for (const block of css.split('@font-face').slice(1)) {
            const family = (block.match(/font-family:\s*'([^']+)'/) || [])[1];
            const file = (block.match(/\/fonts\/([a-z-]+)\.woff2/) || [])[1];
            const range = (block.match(/unicode-range:\s*([^;]+);/) || [])[1];
            if (!family || !file) continue;
            for (const name of have) {
                const m = name.match(/^(.+)-(\d{3})\.woff2$/);
                if (!m || m[1] !== file) continue;
                FONTS += "@font-face{font-family:'" + family + "';font-style:normal;font-weight:" + m[2] + ';' +
                    'src:url(data:font/woff2;base64,' + fs.readFileSync(path.join(dir, name)).toString('base64') + ") format('woff2');" +
                    (range ? 'unicode-range:' + range.trim() + ';' : '') + '}';
            }
        }
    } catch (err) {
        console.error('[exports] could not inline the fonts: ' + err.message);
        FONTS = '';
    }
    return FONTS;
}

function esc(v) {
    return String(v === null || v === undefined ? '' : v)
        .replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

// A sheet as a table on the paper. The headings and the names of the rows are
// the sheet's own words in English, said in the paper's language here; a name
// the dictionary does not know -- a chain, a route, a project somebody named --
// is printed as it is.
function table(sh, opts, sp) {
    const o = opts || {};
    const label = (x) => (typeof x === 'string' && /[a-z]/.test(x) && !/^(GET|POST) \//.test(x) && !o.raw ? sp.tr(x) : x);
    const rows = o.skipEmpty ? sh.rows.filter((r) => r.slice(2).some((x) => typeof x === 'number' && x > 0)) : sh.rows;
    if (!rows.length) return '<p class="none">' + sp.h('Nothing in this period.') + '</p>';
    // A bar beside each count, as long as the count against the largest in
    // its group, so what dominates reads before any number does. A muted row
    // -- the ordinary outcome, Clear -- is drawn in grey, and the eye goes to
    // the ones that are not.
    // without groups the whole table is one: the count is the second column
    const key = (r) => (o.grouped ? r[0] : '');
    const count = (r) => Number(o.grouped ? r[2] : r[1]) || 0;
    const most = new Map();
    if (o.bars) {
        for (const r of rows) most.set(key(r), Math.max(most.get(key(r)) || 0, count(r)));
    }
    const bar = (r) => {
        const top = most.get(key(r)) || 0;
        const w = top ? Math.round(count(r) / top * 1000) / 10 : 0;
        return '<td class="sh-bar">' + (w ? '<i' + (o.mute && o.mute.includes(o.grouped ? r[1] : r[0]) ? ' class="is-mute"' : '') +
            ' style="width:' + w + '%"></i>' : '') + '</td>';
    };
    // rows grouped by their first column print as one table with a heading
    // line for each group, which reads the way the page's own breakdowns do
    const line = (r) => {
        const cells = o.grouped ? r.slice(1) : r;
        return '<tr>' + cells.map((x, i) => (i === 0
            ? '<td>' + esc(o.keep && o.keep(r) ? x : label(x)) + '</td>' + (o.bars ? bar(r) : '')
            : '<td class="n">' + sp.num(x) + (o.pct && i === cells.length - 1 ? '%' : '') + '</td>')).join('') + '</tr>';
    };
    let body;
    if (o.grouped) {
        const groups = [];
        for (const r of rows) {
            if (!groups.length || groups[groups.length - 1].k !== r[0]) groups.push({ k: r[0], rows: [] });
            groups[groups.length - 1].rows.push(line(r));
        }
        body = groups.map((g) => bodies(o.noGroupHead ? '' : '<tr class="grp"><th colspan="' +
            (rows[0].length - 1 + (o.bars ? 1 : 0)) + '">' + esc(label(g.k)) + '</th></tr>', g.rows)).join('');
    } else body = '<tbody>' + rows.map(line).join('') + '</tbody>';
    let head = (o.grouped ? sh.head.slice(1) : sh.head);
    if (o.heads) head = [head[0]].concat(o.heads);
    const ths = head.map((x, i) => '<th' + (i ? ' class="n"' : '') + '>' + esc(i === 0 && o.grouped ? '' : sp.tr(x)) + '</th>');
    if (o.bars) ths.splice(1, 0, '<th></th>');
    return '<table' + (o.bars ? ' class="has-bars"' : '') + '><thead><tr>' + ths.join('') + '</tr></thead>' + body + '</table>';
}

// A group of rows on paper: its heading and first three rows held together,
// and its last three, so where a page has to break a group it leaves three
// rows on either side and never two chains alone at the top of a page. A
// group of six or fewer is held whole.
function bodies(head, rows) {
    if (rows.length <= 6) return '<tbody class="g-keep">' + head + rows.join('') + '</tbody>';
    return '<tbody class="g-keep">' + head + rows.slice(0, 3).join('') + '</tbody>' +
        '<tbody>' + rows.slice(3, -3).join('') + '</tbody>' +
        '<tbody class="g-keep">' + rows.slice(-3).join('') + '</tbody>';
}

// The paper sizes a report can be printed on. A4 unless asked otherwise: it is
// what a compliance file in Europe is kept on, and the browser's own default
// is whatever the reader's printer was last set to. Each size carries the
// margins that suit it, so a page of A5 is not laid out with A3's.
const PAPERS = {
    a4: { name: 'A4', w: 210, h: 297, mx: 16, my: 18, mt: 26, head: 22, cols: 4, font: 13 },
    letter: { name: 'US Letter', w: 215.9, h: 279.4, mx: 16, my: 17, mt: 25, head: 22, cols: 4, font: 13 },
    legal: { name: 'US Legal', w: 215.9, h: 355.6, mx: 16, my: 18, mt: 26, head: 22, cols: 4, font: 13 },
    a3: { name: 'A3', w: 297, h: 420, mx: 22, my: 24, mt: 33, head: 26, cols: 4, font: 14 },
    a5: { name: 'A5', w: 148, h: 210, mx: 11, my: 13, mt: 16, head: 16, cols: 2, font: 11 },
};
function paperOf(key) {
    return PAPERS[String(key || '').toLowerCase()] ? String(key).toLowerCase() : 'a4';
}

// A string set inside a stylesheet. Escaped for css, and with no way to close
// the style element it sits in: an organisation named "</style>" stays a name.
function cssStr(v) {
    return '"' + String(v === null || v === undefined ? '' : v)
        .replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ').replace(/</g, '\\3C ') + '"';
}

function lastDay(iso) {
    return new Date(new Date(iso).getTime() - 1).toISOString();
}

// The cover's art: a grid of three modules across the paper's width and three
// down, each filled with one shape taken from the logo -- the shield's lower
// half, the iris of the eye, and the quarters and halves of that circle -- in
// two blues on the dashboard's own dark. The logo itself sits in the middle
// module, the one bright thing on the page. Drawn in the paper's millimetres,
// so the modules stay square on every size and only the space under them
// changes.
// The chapters after the statement, each starting a page of its own, in the
// order they print. The PDF's bookmarks are built from these headings.
const CHAPTERS = ['Overview of the period', 'Screenings and review', 'Sanctions coverage', 'API, team and evidence', 'Day by day', 'Appendix'];

// The period as columns, one for each day (or hour, for a day's report): the
// flagged checks at the foot of each column in the darker blue and the clear
// ones above them in the lighter, so how much of a day was flagged reads off
// the column itself. The two blues pass the colour-blindness checks against
// the white of the page; the legend names them, and the day-by-day table at
// the end has every figure the columns are drawn from.
function periodChart(daily, hourly, sp, low) {
    const rows = daily.rows;
    // lower on A5 and Letter, the two sheets that are short for their width,
    // where the overview has the least room to end on its page
    const W = 1000, H = low ? 200 : 250, R = 8, T = 30, B = 32;
    const top = Math.max(1, ...rows.map((r) => Number(r[1]) || 0));
    // a round step for three or four lines: 1, 2 or 5 times a power of ten
    const raw = top / 3;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((k) => k * pow).find((v) => v >= raw);
    const max = Math.ceil(top / step) * step;
    // the left edge as wide as the widest number on the axis: a fixed one
    // held "500" and cut "60.000" to "0.000". A digit of Inter at 15px is
    // about nine units wide, a separator about four.
    const widest = Math.max(...[0, step, max].map((v) => {
        const t = String(sp.num(v));
        return (t.match(/\d/g) || []).length * 9.2 + (t.match(/\D/g) || []).length * 4.6;
    }));
    const L = Math.max(52, Math.ceil(widest) + 16);
    const pw = W - L - R, ph = H - T - B;
    const y = (v) => T + ph - ph * v / max;
    // never wider than a fourteenth of the width: the first days of a cycle
    // stand as columns from the left, not as blocks across the whole page
    const bw = Math.min(pw / rows.length, pw / 14);
    const gap = Math.min(4, bw * 0.22);
    const n2 = (v) => Math.round(v * 10) / 10;
    const out = [];
    for (let v = 0; v <= max; v += step) {
        out.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + n2(y(v)) + '" y2="' + n2(y(v)) + '" class="' + (v ? 'grid' : 'base') + '"/>' +
            '<text x="' + (L - 10) + '" y="' + n2(y(v) + 5) + '" text-anchor="end">' + sp.num(v) + '</text>');
    }
    // a column: flat at the baseline, its top corners rounded, the two parts
    // parted by a hairline of the page's white
    const col = (x, w, y0, y1, cls, round) => {
        const r = round ? Math.min(4, w / 2, y0 - y1) : 0;
        return '<path class="' + cls + '" d="M' + n2(x) + ' ' + n2(y0) + 'V' + n2(y1 + r) +
            (r ? 'Q' + n2(x) + ' ' + n2(y1) + ' ' + n2(x + r) + ' ' + n2(y1) : '') + 'H' + n2(x + w - r) +
            (r ? 'Q' + n2(x + w) + ' ' + n2(y1) + ' ' + n2(x + w) + ' ' + n2(y1 + r) : '') + 'V' + n2(y0) + 'Z"/>';
    };
    let peak = 0;
    rows.forEach((r, i) => {
        const n = Number(r[1]) || 0, f = Math.min(n, Number(r[2]) || 0);
        if (n > (Number(rows[peak][1]) || 0)) peak = i;
        const x = L + i * bw + gap / 2, w = Math.max(1, bw - gap);
        const yb = y(0), yf = y(f), yn = y(n);
        if (f) out.push(col(x, w, yb, yf, 'flag', f === n));
        if (n > f) out.push(col(x, w, f ? yf - 1.5 : yb, yn, 'clear', true));
    });
    const when = (v) => (hourly ? String(v).slice(11, 16)
        : new Date(String(v).slice(0, 10) + 'T12:00:00Z').toLocaleDateString(sp.locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }));
    const ticks = rows.length <= 5 ? rows.map((r, i) => i) : [0, 1, 2, 3, 4].map((k) => Math.round(k * (rows.length - 1) / 4));
    // a date under its column, held inside the chart at either edge
    ticks.forEach((i) => {
        const mid = L + i * bw + bw / 2;
        const [x, anchor] = mid < L + 45 ? [L + i * bw, 'start'] : mid > W - R - 45 ? [L + (i + 1) * bw, 'end'] : [mid, 'middle'];
        out.push('<text x="' + n2(x) + '" y="' + (H - 8) + '" text-anchor="' + anchor + '">' + esc(when(rows[i][0])) + '</text>');
    });
    // the busiest day, named on its column
    const pn = Number(rows[peak][1]) || 0;
    if (pn) {
        const px = L + peak * bw + bw / 2;
        const anchor = px < L + 120 ? 'start' : px > W - R - 120 ? 'end' : 'middle';
        out.push('<text class="peak" x="' + n2(px) + '" y="' + n2(y(pn) - 9) + '" text-anchor="' + anchor + '">' +
            sp.h(hourly ? '{n} · busiest hour' : '{n} · busiest day', { n: sp.num(pn) }) + '</text>');
    }
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
        esc(sp.tr(hourly ? 'Checks by hour' : 'Checks by day')) + '">' + out.join('') + '</svg>';
}

// The head of every page after the cover, as one picture: the mark and the
// name side by side. It is printed in the page's top margin, where a picture
// can only sit on the line of text, so a mark and a word set separately came
// out with the mark riding higher than the word. Drawn together they line up.
// The name is Plus Jakarta Sans at 700, its letters taken out of that font as
// outlines (from print-fonts/jakarta-latin-700.woff2, 100 units to the em).
const WORDMARK = { w: 581.2, cap: 74.5, d: 'M33.8 75.7Q26.7 75.7 20.7 73.1Q14.6 70.5 10.2 65.8Q5.9 61.2 3.9 55L15.2 50.1Q17.9 56.5 23 60.1Q28.1 63.8 34.5 63.8Q38.1 63.8 40.8 62.6Q43.4 61.5 44.9 59.5Q46.3 57.5 46.3 54.7Q46.3 51.4 44.4 49.2Q42.4 47.1 38.5 45.9L24.2 41.3Q15.5 38.6 11.1 33.2Q6.7 27.8 6.7 20.5Q6.7 14.1 9.8 9.2Q13 4.3 18.6 1.5Q24.3 -1.2 31.6 -1.2Q38.3 -1.2 43.9 1.1Q49.5 3.5 53.5 7.6Q57.6 11.8 59.6 17.4L48.4 22.4Q46.2 16.8 41.8 13.7Q37.4 10.7 31.6 10.7Q28.2 10.7 25.6 11.8Q23 13 21.6 15Q20.1 17.1 20.1 19.9Q20.1 23 22.1 25.3Q24.1 27.7 28.2 29L41.9 33.3Q50.8 36.2 55.2 41.3Q59.7 46.4 59.7 53.9Q59.7 60.3 56.4 65.2Q53.1 70.1 47.3 72.9Q41.5 75.7 33.8 75.7ZM96.6 75.7Q88.2 75.7 81.9 71.9Q75.6 68.1 72.1 61.6Q68.6 55.1 68.6 47.2Q68.6 39 72.2 32.6Q75.7 26.3 81.8 22.6Q88 18.9 95.6 18.9Q102 18.9 106.8 21Q111.7 23.1 115.1 26.8Q118.5 30.5 120.3 35.2Q122.1 40 122.1 45.5Q122.1 46.9 122 48.4Q121.8 49.9 121.4 51H79.4V41H114L107.8 45.7Q108.7 41.1 107.3 37.5Q106 33.9 103 31.8Q99.9 29.7 95.6 29.7Q91.5 29.7 88.3 31.7Q85.1 33.8 83.5 37.8Q81.8 41.7 82.2 47.3Q81.8 52.3 83.6 56.1Q85.3 60 88.8 62.1Q92.2 64.2 96.7 64.2Q101.2 64.2 104.3 62.3Q107.5 60.4 109.3 57.2L119.9 62.4Q118.3 66.3 114.9 69.3Q111.5 72.3 106.8 74Q102.2 75.7 96.6 75.7ZM132 74.5V20.1H144.3V30.8L143.3 28.9Q145.2 24 149.6 21.4Q153.9 18.9 159.7 18.9Q165.7 18.9 170.4 21.5Q175 24.1 177.6 28.7Q180.2 33.4 180.2 39.5V74.5H167.1V42.6Q167.1 39 165.7 36.4Q164.3 33.8 161.9 32.3Q159.4 30.9 156.1 30.9Q152.9 30.9 150.4 32.3Q147.9 33.8 146.5 36.4Q145.1 39 145.1 42.6V74.5ZM216.1 75.1Q206.9 75.1 201.9 70Q196.8 65 196.8 55.8V31.8H187.4V20.1H188.4Q192.4 20.1 194.6 18Q196.8 15.9 196.8 11.9V7.7H209.9V20.1H222.4V31.8H209.9V55.1Q209.9 57.8 210.9 59.7Q211.8 61.6 213.9 62.6Q215.9 63.6 219.1 63.6Q219.8 63.6 220.8 63.5Q221.7 63.4 222.6 63.3V74.5Q221.2 74.7 219.4 74.9Q217.6 75.1 216.1 75.1ZM232.6 74.5V20.1H245.7V74.5ZM232.6 14V0H245.7V14ZM257.8 74.5V20.1H270.1V30.8L269.1 28.9Q271 24 275.4 21.4Q279.7 18.9 285.5 18.9Q291.5 18.9 296.2 21.5Q300.8 24.1 303.4 28.7Q306 33.4 306 39.5V74.5H292.9V42.6Q292.9 39 291.5 36.4Q290.1 33.8 287.7 32.3Q285.2 30.9 281.9 30.9Q278.7 30.9 276.2 32.3Q273.7 33.8 272.3 36.4Q270.9 39 270.9 42.6V74.5ZM342.9 75.7Q334.5 75.7 328.2 71.9Q321.9 68.1 318.4 61.6Q314.9 55.1 314.9 47.2Q314.9 39 318.5 32.6Q322 26.3 328.2 22.6Q334.3 18.9 341.9 18.9Q348.3 18.9 353.2 21Q358 23.1 361.4 26.8Q364.8 30.5 366.6 35.2Q368.4 40 368.4 45.5Q368.4 46.9 368.3 48.4Q368.1 49.9 367.7 51H325.7V41H360.3L354.1 45.7Q355 41.1 353.7 37.5Q352.3 33.9 349.3 31.8Q346.2 29.7 341.9 29.7Q337.8 29.7 334.6 31.7Q331.4 33.8 329.8 37.8Q328.1 41.7 328.5 47.3Q328.1 52.3 329.9 56.1Q331.6 60 335.1 62.1Q338.5 64.2 343 64.2Q347.5 64.2 350.7 62.3Q353.8 60.4 355.6 57.2L366.2 62.4Q364.6 66.3 361.2 69.3Q357.8 72.3 353.2 74Q348.5 75.7 342.9 75.7ZM378.3 74.5V-1.2H391.4V74.5ZM403.5 94.5V20.1H415.8V30.9L414.6 28.2Q417.4 23.8 422.2 21.3Q427 18.9 433.3 18.9Q441 18.9 447.2 22.7Q453.4 26.5 457.1 32.9Q460.7 39.3 460.7 47.3Q460.7 55.2 457.1 61.7Q453.5 68.2 447.3 72Q441.1 75.7 433.2 75.7Q427.3 75.7 422.4 73.3Q417.4 71 414.5 66.6L416.6 64V94.5ZM431.7 63.7Q436.2 63.7 439.7 61.6Q443.2 59.5 445.2 55.8Q447.1 52.1 447.1 47.3Q447.1 42.5 445.2 38.8Q443.2 35.2 439.7 33Q436.2 30.9 431.7 30.9Q427.4 30.9 424 33Q420.5 35.1 418.6 38.8Q416.6 42.6 416.6 47.3Q416.6 52.1 418.6 55.8Q420.5 59.5 424 61.6Q427.4 63.7 431.7 63.7ZM487.2 75.7Q481.5 75.7 477.3 73.8Q473.1 71.9 470.8 68.3Q468.5 64.8 468.5 60.1Q468.5 55.6 470.5 52Q472.5 48.5 476.7 46.1Q480.9 43.7 487.3 42.7L505.1 39.8V49.8L489.8 52.4Q485.9 53.1 484 54.9Q482.1 56.7 482.1 59.6Q482.1 62.4 484.2 64Q486.4 65.7 489.6 65.7Q493.7 65.7 496.9 64Q500 62.2 501.8 59.1Q503.5 56 503.5 52.3V38.3Q503.5 34.8 500.8 32.4Q498 30.1 493.5 30.1Q489.3 30.1 486.1 32.3Q482.8 34.6 481.3 38.3L470.6 33.1Q472.2 28.8 475.7 25.6Q479.1 22.5 483.8 20.7Q488.5 18.9 494 18.9Q500.7 18.9 505.8 21.3Q510.9 23.8 513.8 28.1Q516.6 32.5 516.6 38.3V74.5H504.2V65.2L507 65Q504.9 68.5 502 70.8Q499.1 73.2 495.4 74.5Q491.7 75.7 487.2 75.7ZM535.3 96.5Q533.1 96.5 531 96.2Q528.9 95.8 527.2 94.9V84Q528.5 84.3 530.4 84.6Q532.2 84.9 533.8 84.9Q538.3 84.9 540.4 82.8Q542.4 80.8 544 77.4L547.6 69L547.4 80L523.7 20.1H537.8L554.4 64.3H549.4L565.9 20.1H580.1L556.4 80Q554.3 85.2 551.3 88.9Q548.3 92.6 544.4 94.5Q540.4 96.5 535.3 96.5Z' };
function headPicture(px) {
    const H = 150, gap = 40, w = Math.round(H + gap + WORDMARK.w);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + H + '" ' +
        'width="' + Math.round(px * w / H) + '" height="' + px + '">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#00e0ff"/><stop offset="1" stop-color="#a020f0"/></linearGradient></defs>' +
        '<g transform="scale(1.25)" fill="none" stroke="url(#g)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M60 15 L25 30 V55 C25 80 50 100 60 105 C70 100 95 80 95 55 V30 Z"/>' +
        '<path d="M38 60 Q 60 40 82 60 Q 60 80 38 60 Z"/><circle cx="60" cy="60" r="6"/></g>' +
        '<path transform="translate(' + (H + gap) + ' ' + ((H - WORDMARK.cap) / 2).toFixed(1) + ')" fill="#0e2358" d="' + WORDMARK.d + '"/></svg>';
    return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

// The same head on screen, where the sheet draws it itself: the mark and the
// name in the page's own face. The mark
// is the cover's, solid rather than glowing: a glow is a picture to a PDF.
const LETTERHEAD = '<svg class="lh-mark" viewBox="0 0 120 120" aria-hidden="true">' +
    '<defs><linearGradient id="lhInk" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#00e0ff"/><stop offset="1" stop-color="#a020f0"/></linearGradient></defs>' +
    '<g fill="none" stroke="url(#lhInk)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M60 15 L25 30 V55 C25 80 50 100 60 105 C70 100 95 80 95 55 V30 Z"/>' +
    '<path d="M38 60 Q 60 40 82 60 Q 60 80 38 60 Z"/><circle cx="60" cy="60" r="6"/></g></svg>' +
    '<span>Sentinelpay</span>';

function coverArt(paper) {
    const W = paper.w;
    const H = paper.h;
    const m = W / 3;
    const n = (v) => Math.round(v * 100) / 100;
    const A = '#131d4f';
    const B = '#1b2a72';
    const at = (c, r) => [n(c * m), n(r * m)];
    const quarter = (c, r, corner, fill) => {
        const [x, y] = at(c, r);
        const x2 = n(x + m);
        const y2 = n(y + m);
        const d = {
            tl: `M${x} ${y} H${x2} A${n(m)} ${n(m)} 0 0 1 ${x} ${y2} Z`,
            br: `M${x2} ${y2} H${x} A${n(m)} ${n(m)} 0 0 1 ${x2} ${y} Z`,
        }[corner];
        return `<path d="${d}" fill="${fill}"/>`;
    };
    const dee = (c, r, side, fill) => {
        const [x, y] = at(c, r);
        const h = n(m / 2);
        const d = side === 'r'
            ? `M${x} ${y} H${n(x + h)} A${h} ${h} 0 0 1 ${n(x + h)} ${n(y + m)} H${x} Z`
            : `M${n(x + m)} ${y} H${n(x + h)} A${h} ${h} 0 0 0 ${n(x + h)} ${n(y + m)} H${n(x + m)} Z`;
        return `<path d="${d}" fill="${fill}"/>`;
    };
    const shield = (c, r, fill) => {
        const [x, y] = at(c, r);
        const k = m / 70;
        const X = (v) => n(x + v * k);
        const Y = (v) => n(y + v * k);
        return `<path d="M${X(0)} ${Y(0)} H${X(70)} V${Y(22)} C${X(70)} ${Y(48)} ${X(48)} ${Y(63)} ${X(35)} ${Y(70)} ` +
            `C${X(22)} ${Y(63)} ${X(0)} ${Y(48)} ${X(0)} ${Y(22)} Z" fill="${fill}"/>`;
    };
    const disc = (c, r, fill) => {
        const [x, y] = at(c, r);
        return `<circle cx="${n(x + m / 2)}" cy="${n(y + m / 2)}" r="${n(m / 2)}" fill="${fill}"/>`;
    };
    const full = (c, r, fill) => {
        const [x, y] = at(c, r);
        return `<rect x="${x}" y="${y}" width="${n(m)}" height="${n(m)}" fill="${fill}"/>`;
    };
    // the logo, centred in the middle module at the size it had on A4
    const k = m / 70;
    const lx = n(m + m / 2 - 60 * 0.37 * k);
    const ly = n(m + m / 2 - 60 * 0.37 * k);
    return `<svg class="c-art" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` +
        '<defs><linearGradient id="coverInk" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#00e0ff"/><stop offset="1" stop-color="#a020f0"/></linearGradient></defs>' +
        `<rect width="${W}" height="${H}" fill="#0b1020"/>` +
        quarter(0, 0, 'tl', B) + full(1, 0, A) + dee(2, 0, 'l', B) +
        shield(0, 1, A) + disc(1, 1, B) + shield(2, 1, A) +
        disc(0, 2, B) + dee(1, 2, 'r', A) + quarter(2, 2, 'br', B) +
        `<g transform="translate(${lx} ${ly}) scale(${n(0.37 * k)})" fill="none" stroke="url(#coverInk)" ` +
        'stroke-width="6" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M60 15 L25 30 V55 C25 80 50 100 60 105 C70 100 95 80 95 55 V30 Z"/>' +
        '<path d="M38 60 Q 60 40 82 60 Q 60 80 38 60 Z"/><circle cx="60" cy="60" r="6"/></g>' +
        `<circle cx="${n(lx + 60 * 0.37 * k)}" cy="${n(ly + 60 * 0.37 * k)}" r="${n(0.9 * k)}" fill="url(#coverInk)"/>` +
        '</svg>';
}

function report(list, meta, out) {
    const by = (name) => list.find((sh) => sh.name === name);
    const rows = new Map(by('Summary').rows.map((r) => [r[0], r]));
    const sum = new Map(by('Summary').rows.map((r) => [r[0], r[1]]));
    const before = (key) => (rows.get(key) || [])[2];
    const sandbox = out.scope === 'sandbox';
    const paperKey = paperOf(meta.paper);
    const paper = PAPERS[paperKey];
    const ref = meta.reference;
    const sp = speaker(langOf(meta.lang));
    const { tr, h, num, date } = sp;
    // The room under the grid, in shares of the width: 41 on A4, 29 on
    // Letter, which is shorter for its width. The gap over the rule and the
    // margin under the last line are 14mm and 15mm on A4 and shrink with that
    // room, so on Letter the title does not run into the line beneath it.
    const room = (paper.h / paper.w - 1) * 100;
    const r2 = (v) => Math.round(v * 100) / 100;
    const coverBelow = r2(Math.min(14 / 210 * 100, room * 0.161));
    const coverFoot = r2(Math.min(15 / 210 * 100, room * 0.17));
    const org = meta.organisation || '';
    const from = date(out.period.from);
    const to = date(lastDay(out.period.to));
    const span = tr('{from} to {to}', { from, to });
    const scopeName = tr(sandbox ? 'Sandbox' : 'Production');
    // when it was made, as a reader says it: "11 October 2026 at 22:22 UTC"
    const generated = tr('{date} at {time} UTC', { date: date(meta.generated), time: meta.generated.slice(11, 16) });

    const incl = sum.get('Screenings included this cycle');
    const daily = by('Daily');
    const left = sum.get('Sandbox checks not included');
    const excluded = sum.has('Sandbox checks not included')
        ? '<p class="cmp">' + (left
            ? h('{n} sandbox checks were made in this period. They are test work, spend nothing and are not counted anywhere in this report.', { n: num(left) })
            : h('No sandbox checks were made in this period.')) + '</p>'
        : '';

    // What runs along the top and the bottom of every printed page after the
    // cover: our head with a line under it, and at the foot the reference and
    // where the page sits in the document.
    const refLine = tr('Reference {ref}', { ref: ref.slice(0, 16) });
    // "Page 2 of 7" in the paper's language, its two numbers counted by the
    // page rule itself
    const pageOf = tr('Page {n} of {all}').split(/\{n\}|\{all\}/);
    const counted = cssStr(pageOf[0] || '') + ' counter(page) ' + cssStr(pageOf[1] || '') + ' counter(pages) ' + cssStr(pageOf[2] || '');
    // set in the document's own face, small and set back: without it the
    // browser prints these in its default serif at the size of body text
    const box = 'font-family:Inter, system-ui, sans-serif; font-size:' + (paperKey === 'a5' ? '6.5pt' : '7.5pt') +
        '; color:#6b7898; vertical-align:middle;';
    // the line under the head runs the width of the page: each of the three
    // boxes along the top draws its part of it
    const rule = 'vertical-align:bottom; padding-bottom:' + (paperKey === 'a5' ? 2 : 3) + 'mm; margin-bottom:' +
        (paperKey === 'a5' ? 3 : 6) + 'mm; border-bottom:1px solid rgba(14,35,88,.14);';
    const pageCss =
        '@page { size:' + paper.w + 'mm ' + paper.h + 'mm; margin:' + paper.mt + 'mm ' + paper.mx + 'mm ' + paper.my + 'mm; ' +
        '@top-left { content:url("' + headPicture(paper.head) + '"); ' + rule + ' } ' +
        '@top-center { content:""; ' + rule + ' } ' +
        '@top-right { content:""; ' + rule + ' } ' +
        '@bottom-left { content:' + cssStr(refLine) + '; ' + box + ' } ' +
        '@bottom-right { content:' + counted + '; ' + box + ' text-align:right; } } ' +
        // the cover is the whole sheet, with no margin and nothing running
        '@page :first { margin:0; @top-left { content:none; } @top-center { content:none; } @top-right { content:none; } ' +
        '@bottom-left { content:none; } @bottom-right { content:none; } } ' +
        ':root { --pw:' + paper.w + 'mm; --ph:' + paper.h + 'mm; --mx:' + paper.mx + 'mm; --my:' + paper.my + 'mm; --mt:' + paper.mt + 'mm; ' +
        '--ar:' + paper.w + ' / ' + paper.h + '; ' +
        '--cols:' + paper.cols + '; --fs:' + paper.font + 'px; }';

    // on screen the sheet draws the head itself; on paper the page rule does
    const sheetHead = '<div class="lh sheet-lh">' + LETTERHEAD + '</div>';
    // The foot drawn on screen, where the page rule cannot be. The dialog
    // shows the PDF itself; this is for the paper opened on its own, which
    // cannot know where its pages will break, so it carries the reference.
    const sheetFoot = () => '<div class="run is-foot" aria-hidden="true"><span>' + esc(refLine) + '</span></div>';
    const dt = (k, v) => '<div><dt>' + h(k) + '</dt><dd>' + v + '</dd></div>';

    // one group of a sheet's rows, as a sheet of its own
    const rowsOf = (sh, name) => ({ head: sh.head, rows: sh.rows.filter((r) => r[0] === name) });

    // A list that can run long -- chains, projects, endpoints -- shows its ten
    // largest in the chapter and the rest as one row, so the table answers
    // where the work went in a glance. Every row is still in the report: the
    // whole list goes to the appendix at the end, largest first.
    const CAP = 10;
    const appendix = [];
    const cap = (sh, name, other, title, what, unit, at) => {
        const i = at === undefined ? 2 : at;
        const mine = sh.rows.filter((r) => name === null || r[0] === name);
        if (mine.length <= CAP) return { sh, capped: false };
        const sorted = mine.slice().sort((a, b) => (Number(b[i]) || 0) - (Number(a[i]) || 0));
        const kept = sorted.slice(0, CAP);
        const rest = sorted.slice(CAP);
        const n = rest.reduce((a, r) => a + (Number(r[i]) || 0), 0);
        const whole = sorted.reduce((a, r) => a + (Number(r[i]) || 0), 0);
        const pct = whole ? Math.round(n / whole * 1000) / 10 : 0;
        const otherRow = name === null ? [tr(other, { n: num(rest.length) }), n, pct] : [name, tr(other, { n: num(rest.length) }), n, pct];
        // the names we gave rows translate; the ones people gave do not
        const named = (x) => (x === 'No project' || x === 'Unnamed project' ? tr(x) : x);
        appendix.push({ title, what, unit, rows: sorted.map((r) => (name === null ? r : r.slice(1))).map((r) => [named(r[0])].concat(r.slice(1))) });
        const rows = [];
        let placed = false;
        for (const r of sh.rows) {
            if (name !== null && r[0] !== name) { rows.push(r); continue; }
            if (!placed) { rows.push(...kept, otherRow); placed = true; }
        }
        return { sh: { head: sh.head, rows }, capped: true };
    };
    const fullList = '<p class="part-note">' + h('The full list is in the appendix at the end of this report.') + '</p>';
    // Projects only when somebody used them: a period with every check outside
    // any project says so in a line rather than a table of one row at 100%.
    const projectless = !by('Screenings').rows.some((r) => r[0] === 'By project' && r[1] !== 'No project');
    const screens0 = projectless
        ? { head: by('Screenings').head, rows: by('Screenings').rows.filter((r) => r[0] !== 'By project') }
        : by('Screenings');
    const byChainCut = cap(screens0, 'By chain', 'Other chains ({n})', 'Checks by chain', 'Chain', 'Checks');
    const byProjectCut = cap(byChainCut.sh, 'By project', 'Other projects ({n})', 'Checks by project', 'Project', 'Checks');
    const screenings = byProjectCut.sh;
    const coverageCut = cap(by('Coverage'), 'By chain', 'Other chains ({n})', 'Designated addresses by chain', 'Chain', 'Designated addresses');
    const apiCut = cap(by('API'), null, 'Other endpoints ({n})', 'API calls by endpoint', 'Endpoint', 'Calls', 1);

    // the particulars of the report itself, last, the way an audit report
    // keeps them after the findings rather than ahead of them
    const tail = '<div class="part about"><h3>' + h('Report details') + '</h3><dl class="facts">' +
        dt('Organisation', esc(org)) +
        dt('Period', esc(span)) +
        dt('Scope', esc(scopeName)) +
        (sum.get('Plan') ? dt('Plan', esc(sum.get('Plan'))) : '') +
        dt('Time zone', esc(sum.get('Time zone'))) +
        dt('Generated', esc(generated)) +
        // A4 is A4 in every language; only the American sizes have a name to say
        dt('Paper', esc(/^US /.test(paper.name) ? tr(paper.name) : paper.name)) +
        dt('Reference', '<span class="ref">sha256:' + esc(ref) + '</span>') +
        '</dl></div>' +
        '<p class="end">' + h('End of report') + '</p>';

    // two groups of a sheet side by side, each under its own small title
    const pairOf = (sh, left, right, unit) => '<div class="pair">' + [left, right].map((g) =>
        '<div><h4 class="pair-t">' + h(g) + '</h4>' +
        table(rowsOf(sh, g), { grouped: true, pct: true, bars: true, noGroupHead: true, heads: [unit, 'Share'] }, sp) + '</div>').join('') + '</div>';

    // Day by day: every day under its month (every hour under its day, for a
    // day's report), the days with nothing on them set back so the busy ones
    // read first, and the period's totals at the foot.
    const dayTable = () => {
        const hourly = out.period && out.period.grain === 'hour';
        const head = [hourly ? 'Hour' : 'Day', 'Screenings', 'Flagged', 'Sanctioned', 'Decisions', 'API calls'];
        const rows = daily.rows.map((r) => [r[0], r[1], r[2], r[3], r[5], r[8]]);
        if (!rows.length) return '<p class="none">' + h('Nothing in this period.') + '</p>';
        const whenOf = (v) => {
            const d = new Date(String(v).slice(0, 10) + 'T12:00:00Z');
            return hourly
                ? { group: date(String(v).slice(0, 10)), label: String(v).slice(11, 16) }
                : { group: d.toLocaleDateString(sp.locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
                    label: d.toLocaleDateString(sp.locale, { weekday: 'short', day: 'numeric', timeZone: 'UTC' }) };
        };
        // under its month, and broken over a page like any other group: with
        // three days on either side of the break
        const groups = [];
        const totals = [0, 0, 0, 0, 0];
        for (const r of rows) {
            const w = whenOf(r[0]);
            const vals = r.slice(1).map((x) => Number(x) || 0);
            vals.forEach((x, i) => { totals[i] += x; });
            if (!groups.length || groups[groups.length - 1].k !== w.group) groups.push({ k: w.group, rows: [] });
            groups[groups.length - 1].rows.push('<tr' + (vals.every((x) => !x) ? ' class="is-zero"' : '') + '><td>' + esc(w.label) + '</td>' +
                vals.map((x) => '<td class="n">' + num(x) + '</td>').join('') + '</tr>');
        }
        const body = groups.map((g) => bodies('<tr class="grp"><th colspan="6">' + esc(g.k) + '</th></tr>', g.rows)).join('');
        return '<table class="days"><thead><tr>' + head.map((x, i) => '<th' + (i ? ' class="n"' : '') + '>' + h(x) + '</th>').join('') +
            '</tr></thead>' + body + '<tfoot><tr class="tot"><td>' + h('Total') + '</td>' +
            totals.map((x) => '<td class="n">' + num(x) + '</td>').join('') + '</tr></tfoot></table>';
    };

    // A short part goes to the next page whole rather than leave two rows of
    // its table behind; a long one would leave an empty page doing that, so
    // it breaks between rows like any table longer than a page.
    const keepShort = (inner) => inner.split('<div class="part').map((seg, i) =>
        (i && (seg.match(/<tr/g) || []).length <= 18 ? ' keep' : '') + seg).join('<div class="part');

    // A chapter: a sheet of its own on screen and a fresh page on paper, its
    // title a bookmark in the PDF.
    const chapter = (i, inner) => '<section class="sheet chapter">' + sheetHead +
        '<div class="l-head"><div class="l-rule"></div><h2 class="big">' + h(CHAPTERS[i]) + '</h2></div>' + keepShort(inner) + sheetFoot() + '</section>';

    // ---- the overview
    const n0 = (v) => Number(v) || 0;
    const has = (v) => v !== '' && v !== undefined && v !== null;
    const one = (v) => Math.round(v * 10) / 10;
    const total = n0(sum.get('Screenings'));
    const severe = n0(sum.get('Sanctioned'));
    const review = n0(sum.get('Worth a look'));
    const prevTotal = before('Screenings');
    let lede;
    if (!total) lede = h('No checks were made between {from} and {to}.', { from, to });
    else {
        const d = has(prevTotal) && n0(prevTotal) ? one((total - n0(prevTotal)) / n0(prevTotal) * 100) : null;
        const args = { from, to, n: num(total), pct: d === null ? '' : num(Math.abs(d)) + '%' };
        lede = h(d === null ? 'The total number of checks between {from} and {to} was {n}.'
            : d > 0 ? 'The total number of checks between {from} and {to} was {n}, {pct} more than in the period before.'
                : d < 0 ? 'The total number of checks between {from} and {to} was {n}, {pct} fewer than in the period before.'
                    : 'The total number of checks between {from} and {to} was {n}, the same as in the period before.', args) + ' ' +
            (severe + review
                ? h('The number flagged was {flagged}: {severe} on a sanctions list and {review} worth a look.',
                    { flagged: num(severe + review), severe: num(severe), review: num(review) })
                : h('None of them was flagged.'));
    }
    // a figure beside the same figure the period before, and the change
    const prevSpan = has(before('Period from'))
        ? tr('{from} to {to}', { from: date(before('Period from')), to: date(lastDay(before('Period to'))) }) : '';
    const change = (key) => {
        const a = sum.get(key), b = before(key);
        if (!has(a) || !has(b)) return '—';
        if (!n0(b)) return n0(a) ? '—' : '0%';
        const d = one((n0(a) - n0(b)) / n0(b) * 100);
        return (d > 0 ? '+' : d < 0 ? '−' : '') + num(Math.abs(d)) + '%';
    };
    const sup = (k) => '<sup>' + k + '</sup>';
    const line = (label, mark, key, note, value) => '<tr><td>' + h(label) + (mark ? sup(mark) : '') +
        (note ? '<small>' + note + '</small>' : '') + '</td>' +
        '<td class="n">' + (value !== undefined ? value : num(sum.get(key))) + '</td>' +
        '<td class="n was">' + (value !== undefined || !has(before(key)) ? '—' : num(before(key))) + '</td>' +
        '<td class="n">' + (value !== undefined ? '—' : change(key)) + '</td></tr>';
    const now = (label, mark, key, note) => '<tr><td>' + h(label) + (mark ? sup(mark) : '') +
        (note ? '<small>' + note + '</small>' : '') + '</td><td class="n">' + num(sum.get(key)) + '</td>' +
        '<td class="n was">—</td><td class="n">—</td></tr>';
    const group = (label, note) => '<tr class="grp"><th colspan="4">' + h(label) +
        (note ? ' <span>· ' + h(note) + '</span>' : '') + '</th></tr>';
    // the allowance is spent by production alone; a sandbox report saying
    // how much of it went would be saying something that never happened
    const used = n0(sum.get('Screenings used this cycle'));
    const planRow = !sandbox && has(incl) && n0(incl)
        ? line('Share of the plan used', 0, '', h('{used} of {included} used this cycle', { used: num(used), included: num(n0(incl)) }) +
            (sum.get('Plan') ? ', ' + esc(sum.get('Plan')) : ''), num(one(used / n0(incl) * 100)) + '%')
        : '';
    const notes = [
        ['Sanctioned', 'the address was on a sanctions list when it was checked.'],
        ['Worth a look', 'the address is on no list, but its risk score fell in the middle or high band the organisation has set.'],
        ['Distinct addresses', 'each address counted once, however many times it was checked.'],
        ['Findings open now', 'flagged checks with no decision recorded, as they stood when the report was made.'],
        ['Sealed with a digest', 'a record given a SHA-256 digest when it was written, which can be checked without this report.'],
    ];
    const overview = '<p class="lede">' + lede + '</p>' +
        // no columns to draw for a period with no days in it
        (total && daily.rows.length ? '<div class="figure"><div class="fig-t"><b>' + h(out.period && out.period.grain === 'hour' ? 'Checks by hour' : 'Checks by day') + '</b>' +
            '<span class="key"><span><i class="k-flag"></i>' + h('Flagged') + '</span><span><i class="k-clear"></i>' + h('Clear') + '</span></span></div>' +
            periodChart(daily, out.period && out.period.grain === 'hour', sp, paperKey === 'a5' || paperKey === 'letter') + '</div>' : '') +
        '<table class="sum"><thead><tr><th></th>' +
        '<th class="n">' + h('This period') + '<small>' + esc(span) + '</small></th>' +
        '<th class="n">' + h('The period before') + (prevSpan ? '<small>' + esc(prevSpan) + '</small>' : '') + '</th>' +
        '<th class="n">' + h('Change') + '</th></tr></thead><tbody>' +
        group('Screenings') +
        line('Total', 0, 'Screenings') +
        line('Sanctioned', 1, 'Sanctioned') +
        line('Worth a look', 2, 'Worth a look') +
        line('Distinct addresses', 3, 'Distinct addresses') +
        planRow +
        group('Review') +
        line('Decisions recorded', 0, 'Decisions recorded') +
        now('Findings open now', 4, 'Findings open now',
            sum.get('Oldest open finding') ? h('oldest from {date}', { date: date(sum.get('Oldest open finding')) }) : '') +
        group('Evidence', 'as it stood when the report was made') +
        now('Checks on record', 0, 'Checks on record') +
        now('Sealed with a digest', 5, 'Sealed with a digest',
            has(sum.get('Kept for (years)')) ? h('kept for {n} years', { n: num(sum.get('Kept for (years)')) }) : '') +
        '</tbody></table>' + excluded +
        '<div class="notes">' + notes.map((x, i) => '<div><span>' + (i + 1) + '</span><span>' + h(x[0]) + ': ' + h(x[1]) + '</span></div>').join('') + '</div>';

    return '<!doctype html><html lang="' + sp.lang + '"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<meta name="robots" content="noindex,nofollow">' +
        '<title>' + h('Usage report {from} to {to}', { from: day(out.period.from), to: day(out.period.to) }) + ' · ' + esc(org) + '</title>' +
        // for a PDF the page is self-contained; in the browser it links what
        // the site already serves
        (meta.forPdf
            ? '<style>' + inlineFonts() + '</style>'
            : '<link rel="icon" type="image/svg+xml" href="/logo.svg"><link rel="stylesheet" href="/fonts.css">') +
        '<style>' + REPORT_CSS + pageCss + '</style></head>' +
        // Shown inside the usage page, the page around it carries the controls
        // and the way back, so the report is the paper alone. The reference is
        // on the body for that page to read and print under.
        (meta.embed || meta.forPdf
            ? '<body class="is-embed' + (sandbox ? ' is-sandbox' : '') + ' paper-' + paperKey + '" data-ref="' + esc(ref) + '">'
            : '<body class="paper-' + paperKey + (sandbox ? ' is-sandbox' : '') + '" data-ref="' + esc(ref) + '">' +
              '<div class="bar"><a href="' + esc(meta.back) + '">' + h('Back to usage') + '</a>' +
              '<button type="button" id="print">' + h('Print or save as PDF') + '</button></div>') +
        // a sandbox report says what it is before anything else, and again
        // across every printed page, so a copy cannot be mistaken for evidence
        (sandbox ? '<div class="wm" aria-hidden="true">' + h('Sandbox') + '</div>' : '') +

        // ---- the cover, a page of its own: the brand's shapes over the top
        // two thirds, and under them what the document is, whose, and for
        // which period. The title block sits a fixed share below the grid, so
        // a shorter sheet like Letter keeps the same gap rather than running
        // the title into the shapes.
        '<main class="doc">' +
        '<section class="sheet cover" style="--below:' + coverBelow + 'cqw; --foot:' + coverFoot + 'cqw">' +
        coverArt(paper) +
        '<div class="c-rule"></div>' +
        // set in capitals and broken across two lines, which is how it would
        // read as a bookmark, so the PDF's contents start at the statement
        '<p class="c-title">' + h('Usage and{br}evidence report') + '</p>' +
        '<div class="c-meta"><span><b>' + esc(org) + '</b><i>·</i>' + esc(scopeName) + '</span>' +
        '<span>' + esc(span) + '</span></div>' +
        (sandbox ? '<div class="c-sbx">' + h('Sandbox. Test data, not evidence of screening.') + '</div>' : '') +
        '</section>' +

        // ---- the statement, as a letter: our name at the head, whose report
        // it is and what it covers, what the figures are, our name under it
        // with the reference that seals it, and room at the foot for the
        // organisation to put its own name to it. Before any figure: what the
        // numbers are, then the numbers.
        // The page is the statement and the confirmation under it, nothing
        // else: whose report it is and for when is in its first sentence, and
        // the rest of the particulars are at the end of the report.
        '<section class="sheet statement">' + sheetHead +
        '<div class="l-head"><div class="l-rule"></div>' +
        '<h2 class="big">' + h('Statement on screening') + '</h2></div>' +
        '<p>' + h(sandbox
            ? 'This report sets out the screening {org} carried out through Sentinelpay between {from} and {to}, in the sandbox scope. It was generated on {generated} from the records as they stood at that moment.'
            : 'This report sets out the screening {org} carried out through Sentinelpay between {from} and {to}, in the production scope. It was generated on {generated} from the records as they stood at that moment.',
        { org, from, to, generated }) + '</p>' +
        '<p>' + h('Every check and every decision counted here was sealed with a SHA-256 digest when it was written. Each one can be opened from its evidence file and its digest checked on its own, without this report and without access to Sentinelpay.') + '</p>' +
        '<p>' + h(sandbox
            ? 'This is the sandbox scope. Its checks are test work and are not evidence of screening.'
            : 'Sandbox checks are test work. They spend no allowance and are left out of every figure here.') + '</p>' +
        // the reference in the sentence that says what it is for, set so a
        // reader copying it by eye can find where it starts and ends
        '<p>' + h('Every export of this period, CSV, Excel or JSON, carries the same reference, {ref}, so a copy in any format can be matched to this one.',
            { ref: '\u0001' }).replace('\u0001', '<span class="ref">sha256:' + esc(ref) + '</span>') + '</p>' +
        // at the foot of the page, whatever the length of the text above
        '<div class="confirm"><div class="confirm-t">' + h('Confirmation by the organisation') + '</div>' +
        '<p>' + h('This report has been reviewed and matches the records of the organisation.') + '</p>' +
        '<div class="fields">' + ['Name and role', 'Date', 'Signature'].map((l) => '<div>' + h(l) + '</div>').join('') + '</div></div>' +
        sheetFoot() + '</section>' +

        // ---- the period on one page: what happened in two sentences, the
        // days as columns, the figures beside the period before, and what the
        // words in them mean. Someone who reads one page reads this one.
        chapter(0, overview) +

        // ---- the detail, a chapter to a page
        chapter(1,
            '<div class="part"><h3>' + h('Screenings') + '</h3>' +
            '<p class="part-what">' + h('Every check in the period, by how it was made, how it ended and on which chain.') + '</p>' +
            table(screenings, {
                grouped: true, pct: true, skipEmpty: true, bars: true, mute: ['Clear'], heads: ['Checks', 'Share'],
                // chains and the names people gave their projects are printed as they are
                keep: (r) => r[0] === 'By chain' || (r[0] === 'By project' && r[1] !== 'No project' && r[1] !== 'Unnamed project'),
            }, sp) +
            (projectless ? '<p class="part-note">' + h('No check was assigned to a project.') + '</p>' : '') +
            (byChainCut.capped || byProjectCut.capped ? fullList : '') + '</div>' +
            '<div class="part"><h3>' + h('Review') + '</h3>' +
            '<p class="part-what">' + h('How long it took for a decision to be recorded on a flagged check, and how old the findings still waiting are.') + '</p>' +
            '<div class="pair">' +
            '<div><h4 class="pair-t">' + h('Time to a decision') + '</h4>' +
            table(rowsOf(by('Review'), 'Time to a decision'), { grouped: true, pct: true, bars: true, noGroupHead: true, heads: ['Decisions', 'Share'] }, sp) + '</div>' +
            '<div><h4 class="pair-t">' + h('Still open, by age') + '</h4>' +
            table(rowsOf(by('Review'), 'Still open, by age'), { grouped: true, pct: true, bars: true, noGroupHead: true, heads: ['Findings', 'Share'] }, sp) + '</div>' +
            '</div></div>') +
        chapter(2,
            '<p class="part-what">' + h('What the checks are matched against: the addresses on the sanctions lists, by list, by programme and by chain, as the lists stood when the report was made.') + '</p>' +
            table(coverageCut.sh, {
                grouped: true, pct: true, skipEmpty: true, bars: true, heads: ['Designated addresses', 'Share'],
                keep: (r) => r[0] === 'By chain' || (r[0] === 'By list' && /^OFAC SDN$/.test(r[1])),
            }, sp) + (coverageCut.capped ? fullList : '')) +
        chapter(3,
            '<div class="part"><h3>' + h('API') + '</h3>' +
            '<p class="part-what">' + h('Calls to the API in the period, by endpoint.') + '</p>' +
            table(apiCut.sh, { pct: true, keep: () => true, bars: true, heads: ['Calls', 'Share'] }, sp) +
            (apiCut.capped ? fullList : '') + '</div>' +
            '<div class="part"><h3>' + h('Team') + '</h3>' +
            '<p class="part-what">' + h('The people in the organisation, by role and by when they last signed in, and how many sign in with a second factor.') + '</p>' +
            pairOf(by('Team'), 'By role', 'Last signed in', 'Members') +
            '<div class="pair-after"><h4 class="pair-t">' + h('Security') + '</h4>' +
            table(rowsOf(by('Team'), 'Security'), { grouped: true, pct: true, bars: true, noGroupHead: true, heads: ['Members', 'Share'] }, sp) + '</div></div>' +
            '<div class="part"><h3>' + h('Evidence') + '</h3>' +
            '<p class="part-what">' + h('The sealed records the organisation holds, by age and by kind, as they stood when the report was made.') + '</p>' +
            pairOf(by('Evidence'), 'Records, by age', 'Sealed, by kind', 'Records') + '</div>') +
        chapter(4,
            '<p class="part-what">' + h(out.period && out.period.grain === 'hour'
                ? 'Every hour in the period, in the organisation’s time zone, {zone}.'
                : 'Every day in the period, in the organisation’s time zone, {zone}.', { zone: sum.get('Time zone') || 'UTC' }) + '</p>' +
            dayTable() +
        (appendix.length ? '' : tail)) +
        // ---- the appendix: every row of a list the chapters cut at ten
        (appendix.length ? chapter(5, '<p class="part-what">' + h('Every row of the lists the chapters show ten of, largest first.') + '</p>' + appendix.map((a) => {
            return '<div class="part apx"><h3>' + h(a.title) + '</h3><div class="apx-cols">' +
                table({ head: [a.what, a.unit, 'Share'], rows: a.rows }, { pct: true, keep: () => true, raw: true }, sp) + '</div></div>';
        }).join('') + tail) : '') +
        '</main>' +
        (meta.forPdf ? '' : '<script src="/report.js"></script>') + '</body></html>';
}

const REPORT_CSS = `
:root { --ink:#0e2358; --ink-2:rgba(14,35,88,.74); --ink-3:rgba(14,35,88,.54); --ink-4:rgba(14,35,88,.4);
  --line:rgba(14,35,88,.12); --soft:#f5f7fb; --link:#0091c8; }
* { box-sizing:border-box; }
html { background:#e9edf4; }
body { margin:0; color:var(--ink); font:var(--fs, 13px)/1.5 Inter, system-ui, sans-serif;
  -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.bar { position:sticky; top:0; z-index:4; display:flex; justify-content:space-between; align-items:center; gap:12px;
  padding:10px max(16px, calc(50% - var(--pw) / 2)); background:#fff; border-bottom:1px solid var(--line); }
.bar a { color:var(--ink-2); text-decoration:none; font-weight:500; }
.bar a:hover { color:var(--ink); }
.bar button { font:600 13px Inter, system-ui, sans-serif; color:#fff; background:var(--ink); border:0; border-radius:8px;
  padding:8px 14px; cursor:pointer; }

/* On screen, each part of the document is a sheet of the paper it will print
   on: the cover and the statement a page each, the figures one long sheet.
   In print the sheets dissolve into the pages and the margins the page rule
   sets. */
.doc { padding:24px 0 48px; }
.sheet { position:relative; width:var(--pw); max-width:calc(100% - 32px); margin:0 auto 20px; background:#fff;
  padding:var(--my) var(--mx); box-shadow:0 1px 3px rgba(14,35,88,.08), 0 12px 40px rgba(14,35,88,.08); border-radius:3px; }
.statement { min-height:var(--ph); display:flex; flex-direction:column; }

/* the running head and foot, drawn on screen where the page rule cannot be */
.run { display:flex; justify-content:space-between; gap:16px; margin:calc(var(--my) * -0.55) 0 calc(var(--my) * 0.45);
  font-size:9.5px; color:var(--ink-4); }
.run.is-foot { margin:auto 0 calc(var(--my) * -0.55); padding-top:calc(var(--my) * 0.45); }

/* ---- cover
   The art fills the sheet; everything on it is measured in shares of the
   sheet's width through its container units, so A5 is A3 made smaller rather
   than laid out again. The grid is as tall as the sheet is wide, so the type
   is placed from there: 100cqw down, then --below, set per paper. */
.cover { position:relative; padding:0; aspect-ratio:var(--ar); min-height:0; container-type:inline-size;
  overflow:hidden; background:#0b1020; color:#fff; }
.c-art { position:absolute; inset:0; width:100%; height:100%; display:block; }
.c-rule { position:absolute; left:7.6cqw; top:calc(100cqw + var(--below)); width:14.3cqw; height:.55cqw;
  background:linear-gradient(90deg, #00e0ff, #a020f0); }
.c-title { position:absolute; left:7.6cqw; right:7.6cqw; top:calc(100cqw + var(--below) + 3.8cqw); margin:0;
  font:600 4.7cqw/1.04 'Plus Jakarta Sans', Inter, sans-serif; letter-spacing:-.01em; text-transform:uppercase;
  color:#fff; overflow-wrap:anywhere; }
.c-meta { position:absolute; left:7.6cqw; right:7.6cqw; bottom:var(--foot); display:flex; justify-content:space-between;
  gap:4cqw; font:500 1.76cqw/1.4 Inter, sans-serif; color:rgba(255,255,255,.82); }
.c-meta b { font:600 1.76cqw/1.4 'Plus Jakarta Sans', Inter, sans-serif; color:#fff; }
.c-meta i { font-style:normal; margin:0 1.2cqw; color:rgba(255,255,255,.55); }
.c-meta span:last-child { text-align:right; }
.c-sbx { position:absolute; left:7.6cqw; right:7.6cqw; bottom:calc(var(--foot) + 4.1cqw); font:600 1.6cqw/1.4 Inter, sans-serif; color:#f0b45a; }

/* ---- statement, laid out as a letter */
.lh { display:flex; align-items:center; gap:.7em; padding-bottom:1.2em; border-bottom:1px solid var(--line);
  font:700 1.3em 'Plus Jakarta Sans', Inter, sans-serif; letter-spacing:-.01em; }
.lh-mark { width:1.75em; height:1.75em; flex:none; }
.to { margin-top:1.7em; color:var(--ink-2); }
.to-org { font:700 1.15em 'Plus Jakarta Sans', Inter, sans-serif; color:var(--ink); margin-bottom:2px; }
/* the details, in the rows the usage page sets its own in */
.facts { margin:1.2em 0 0; font-size:.88em; }
.facts div { display:flex; justify-content:space-between; align-items:baseline; gap:16px; padding:.45em 0;
  border-bottom:1px solid rgba(14,35,88,.08); }
.facts div:last-child { border-bottom:0; }
.facts dt { color:var(--ink-4); }
.facts dd { margin:0; font-weight:600; color:var(--ink-2); text-align:right; }
.statement > * { flex-shrink:0; }
.l-rule { width:44px; height:3px; border-radius:2px; background:linear-gradient(90deg, #00e0ff, #a020f0); margin:2.2em 0 .9em; }

/* ---- statement */
h2.big { font:700 20px 'Plus Jakarta Sans', Inter, sans-serif; margin:0 0 14px; break-after:avoid; }
h3 { font:700 14px 'Plus Jakarta Sans', Inter, sans-serif; margin:0 0 8px; padding-bottom:6px; border-bottom:1px solid var(--line); break-after:avoid; }
.statement p { margin:0 0 10px; color:var(--ink-2); max-width:150mm; }
.statement .ref { color:var(--ink); font-weight:600; word-break:break-all; }
.confirm { margin-top:auto; padding-top:1.2em; border-top:1px solid var(--line); }
.confirm-t { font:700 .96em 'Plus Jakarta Sans', Inter, sans-serif; }
.statement .confirm p { font-size:.88em; margin:.2em 0 0; }
.fields { display:grid; grid-template-columns:2fr 1fr 1.3fr; gap:14px; margin-top:2.6em; }
.fields div { border-top:1px solid var(--ink); padding-top:5px; font-size:.77em; color:var(--ink-3); }

/* ---- figures */
.part { margin-top:26px; }
.part:first-of-type { margin-top:0; }
.chapter .l-rule { margin-top:0; }
.chapter .sheet-lh, .statement .sheet-lh { margin-bottom:1.7em; }
.statement .l-rule { margin-top:0; }
.about { margin-top:30px; break-inside:avoid; }
/* the appendix lists run down the left column and on into the right, a page
   at a time like a newspaper's; one column on A5 and narrow screens */
.apx-cols { columns:2; column-gap:28px; }
.apx table td:first-child { word-break:break-word; }
.paper-a5 .apx-cols { columns:1; }
.about .ref { word-break:break-all; font-weight:600; }
.about .facts dd { max-width:70%; }
.chapter .run.is-foot { margin-top:28px; }

/* ---- the overview */
.lede { margin:0 0 18px; color:var(--ink-2); max-width:150mm; }
.figure { margin:0 0 22px; break-inside:avoid; }
.fig-t { display:flex; justify-content:space-between; align-items:baseline; gap:12px; margin:0 0 4px; }
.fig-t b { font:700 .92em 'Plus Jakarta Sans', Inter, sans-serif; }
.key { display:flex; gap:14px; font-size:.8em; color:var(--ink-3); }
.key i { display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:5px; vertical-align:-1px; }
.k-flag { background:#3a50b0; }
.k-clear { background:#7f9be0; }
.chart { display:block; width:100%; height:auto; font:15px Inter, sans-serif; fill:#7a86a6; }
.chart .grid { stroke:rgba(14,35,88,.08); stroke-width:1.5; }
.chart .base { stroke:rgba(14,35,88,.3); stroke-width:1.5; }
.chart .flag { fill:#3a50b0; }
.chart .clear { fill:#7f9be0; }
.chart .peak { fill:var(--ink-2); font-weight:600; }
/* the figures beside the period before: every number in one face and weight,
   the earlier ones set back in colour only */
table.sum thead th { vertical-align:bottom; line-height:1.35; padding-bottom:6px; border-bottom:1px solid var(--ink); }
table.sum th small { display:block; font-weight:400; color:var(--ink-4); }
table.sum th.n { width:19%; }
table.sum th.n:last-child { width:13%; }
/* a gap no number can close: a change of +228,394,400% still stands apart
   from the figure before it */
table.sum tr td.n, table.sum tr th.n { padding-left:14px; white-space:nowrap; }
table.sum td { padding:3px 0; }
table.sum tr.grp th { padding:9px 0 3px; }
table.sum td small { display:block; color:var(--ink-4); font-size:.82em; line-height:1.3; }
table.sum td.n { font-weight:500; }
table.sum td.was { color:var(--ink-3); }
table.sum tr.grp th span { font-weight:400; color:var(--ink-4); }
sup { font-size:.62em; color:var(--ink-4); margin-left:1px; }
.cmp { margin:10px 0 0; color:var(--ink-3); font-size:.88em; }
.notes { margin:16px 0 0; padding:10px 0 0; border-top:1px solid var(--line); font-size:.77em; color:var(--ink-3); line-height:1.5; }
.notes div { display:grid; grid-template-columns:14px 1fr; }
/* The paper holds whatever the period holds: where there is more than a page
   of it, it goes on to the next page in whole blocks. The notes are one
   block, the figure is one, a table row is one; none of them is left with
   a single line on a page of its own. */
.notes, .cmp, .lede { break-inside:avoid; }

/* ---- the chapters' tables: what is measured under each title, a bar
   beside every count, and the numbers in the same columns throughout */
.part-what { margin:-4px 0 10px; color:var(--ink-3); font-size:.88em; }
.part-note { margin:6px 0 0; color:var(--ink-3); font-size:.88em; }
table.has-bars td.n, table.has-bars th.n { width:64px; }
table.has-bars td:last-child, table.has-bars th:last-child { width:62px; color:var(--ink-3); }
td.sh-bar { width:40%; padding:0 4px 0 14px; }
/* square ends: a gradient with rounded corners goes into a PDF as a picture */
td.sh-bar i { display:block; height:7px; background:linear-gradient(90deg, #00b4e6, #6a4ff0); }
td.sh-bar i.is-mute { background:rgba(14,35,88,.14); }
.pair { display:grid; grid-template-columns:1fr 1fr; gap:30px; }
.pair-t { font:700 .92em 'Plus Jakarta Sans', Inter, sans-serif; margin:0 0 6px; }
.pair-after { margin-top:18px; }
/* day by day: the empty days set back, the totals ruled off at the foot */
/* a ledger: tighter than the other tables, so a month of days stands on one page of A4 */
table.days td { padding:1.5px 0; line-height:1.35; }
table.days tr.grp th { padding:8px 0 3px; }
table.days tr.is-zero td { color:var(--ink-4); }
table.days tr.grp th { color:var(--ink); text-transform:capitalize; }
table.days tfoot td { font-weight:600; border-top:1px solid var(--ink); border-bottom:0; padding-top:6px; }
table.days tfoot { display:table-row-group; }
h3:has(+ .part-what) { border:0; padding-bottom:0; margin-bottom:6px; }
table.has-bars tr.grp th { color:var(--ink); }
/* side by side the labels keep to one line and the bar takes what is left */
.pair td:first-child { white-space:nowrap; }
.pair td.sh-bar { width:100%; }
.paper-a5 .pair { grid-template-columns:1fr; gap:14px; }
/* A5 has the overview in half the room: smaller type in the table and the
   notes, and less air between them, so it still ends on its page */
.paper-a5 .lede { margin-bottom:10px; }
.paper-a5 .figure { margin-bottom:10px; }
.paper-a5 table.sum { font-size:.84em; }
.paper-a5 table.sum tr.grp th { padding:6px 0 2px; }
.paper-a5 table.sum td { padding:2px 0; }
.paper-a5 .cmp { margin-top:6px; font-size:.8em; }
.paper-a5 .notes { margin-top:8px; padding-top:6px; font-size:.7em; line-height:1.4; }
table { width:100%; border-collapse:collapse; font-size:.92em; }
thead th { text-align:left; font-weight:600; color:var(--ink-3); font-size:.85em; padding:4px 0; border-bottom:1px solid var(--line); }
td { padding:4px 0; border-bottom:1px solid var(--line); }
.n { text-align:right; font-variant-numeric:tabular-nums; padding-left:12px; white-space:nowrap; }
tr.grp th { text-align:left; font-weight:700; padding:12px 0 4px; border-bottom:1px solid var(--line); }
tr { break-inside:avoid; }
.none { color:var(--ink-3); margin:0; }
.end { margin:24px 0 0; font-size:10px; color:var(--ink-3); word-break:break-all; }

/* the sandbox: a band on the cover and the word across every page, faint
   enough to read through and impossible to miss */
.wm { position:fixed; inset:0; display:grid; place-items:center; pointer-events:none; z-index:3;
  font:800 120px/1 'Plus Jakarta Sans', Inter, sans-serif; color:rgba(224,164,58,.13);
  transform:rotate(-30deg); letter-spacing:.06em; text-transform:uppercase; }

/* small paper and narrow screens: two figures to a row, the meta under itself */
/* A5 has the same letter in two thirds of the room: every gap a little less,
   so the longest of it, German with a plan named, still ends on its page */
.paper-a5 .lh { padding-bottom:.8em; }
.paper-a5 .to { margin-top:1em; }
.paper-a5 .facts { margin-top:.8em; }
.paper-a5 .facts div { padding:.25em 0; }
.paper-a5 .l-rule { margin:1.2em 0 .6em; }
.paper-a5 .statement p { margin-bottom:7px; }
.paper-a5 .confirm { padding-top:.9em; }
.paper-a5 .fields { margin-top:1.7em; gap:10px; }
/* screens only: A5 is narrower than 700px too, and printed it took the
   phone's layout, its signature fields stacked off the foot of the page */
@media screen and (max-width: 700px) {
  .sheet { padding:22px 16px; }
  .statement { min-height:0; }
  .fields { grid-template-columns:1fr; gap:22px; }
  .pair { grid-template-columns:1fr; gap:16px; }
  .apx-cols { columns:1; }
  td.sh-bar { width:28%; padding-left:8px; }
  /* a phone's width: the dates under the column heads may wrap, and the
     numbers keep a gap between them */
  .n { padding-left:10px; }
  table { font-size:.86em; }
  table.sum th.n { white-space:normal; }
  .run { display:none; }
}

/* inside the usage page: the sheets on whatever is behind the frame, not on a
   grey desk of their own */
html:has(body.is-embed) { background:transparent; }
/* and the dashboard's own scrollbar rather than the browser's: the same thin
   bar in the same blues, in the theme the usage page passes in, which the
   frame cannot read for itself */
html:has(body.is-embed) {
  --sb-track:#f0f0f2; --sb-thumb:rgba(0,145,200,.25); --sb-thumb-edge:rgba(0,145,200,.15); --sb-thumb-hover:rgba(0,145,200,.5);
  scrollbar-width:thin; scrollbar-color:var(--sb-thumb) var(--sb-track); }
html[data-theme="dark"]:has(body.is-embed) {
  --sb-track:#131a33; --sb-thumb:rgba(0,200,230,.28); --sb-thumb-edge:rgba(0,200,230,.16); --sb-thumb-hover:rgba(0,200,230,.55); }
.is-embed ::-webkit-scrollbar, html:has(body.is-embed)::-webkit-scrollbar { width:6px; height:6px; }
html:has(body.is-embed)::-webkit-scrollbar-track { background:var(--sb-track); }
html:has(body.is-embed)::-webkit-scrollbar-thumb { background:var(--sb-thumb); border-radius:10px; border:1px solid var(--sb-thumb-edge); }
html:has(body.is-embed)::-webkit-scrollbar-thumb:hover { background:var(--sb-thumb-hover); }
.is-embed .doc { padding:4px 0 28px; }
.is-embed .sheet { box-shadow:0 1px 2px rgba(14,35,88,.1), 0 10px 32px rgba(0,0,0,.18); }

@media print {
  html, body { background:#fff; }
  .bar, .run { display:none; }
  .doc { padding:0; }
  .sheet { width:auto; max-width:none; margin:0; padding:0; box-shadow:none; border-radius:0; }
  /* the usage page's own rules for its sheets are the stronger ones, and
     they printed. The shadow: a blurred edge on every page, drawn as a picture the size of the
     page, four of them in each PDF */
  .is-embed .sheet { box-shadow:none; }
  /* and its padding: 4px above the cover pushed the cover's last two points
     onto a second page of their own, a dark line on an empty sheet */
  .is-embed .doc { padding:0; }
  /* a page each, the height of the page less its margins, less a hair so a
     rounding never spills a cover onto a blank second page */
  .statement { min-height:0; height:calc(var(--ph) - var(--mt) - var(--my) - 2mm); break-after:page; }
  .sheet-lh { display:none; }
  .statement .to { margin-top:0; }
  /* the cover is the whole sheet, its margin taken off by the first page's
     rule, less a hair so it never spills onto a blank second page */
  /* the page's own width rather than the nominal one: A5 comes out a fifth
     of a millimetre wider than 148mm, and a cover drawn to the number left
     a hairline of white down its edge */
  .cover { width:100%; height:var(--ph); aspect-ratio:auto; break-after:page; }
  /* every chapter from the overview on starts a page of its own */
  .chapter { break-before:page; }
  /* and a section in it goes to the next page whole rather than leave two
     rows of its table alone at the top of one; a section longer than a page
     breaks where it must */
  .chapter .part.keep { break-inside:avoid; }
  /* the title and the rule over it are one */
  .l-head { break-inside:avoid; break-after:avoid; }
  tr.grp { break-after:avoid; }
  tbody.g-keep { break-inside:avoid; }
  table.days tbody:last-of-type tr:last-child { break-after:avoid; }
  /* on A5 the two halves of a pair stand one over the other, and a part as
     tall as that may break between them rather than leave a page half empty */
  .paper-a5 .chapter .part.keep:has(.pair) { break-inside:auto; }
  .paper-a5 .pair > div, .paper-a5 .pair-after { break-inside:avoid; }
  .chapter .part h3, .chapter .part .part-what, h4.pair-t { break-after:avoid; break-inside:avoid; }
}
`;

function filename(out, format) {
    return 'sentinelpay-usage-' + day(out.period.from) + '-to-' + day(out.period.to) +
        (out.scope === 'sandbox' ? '-sandbox' : '') + '.' + format;
}

module.exports = { FORMATS, PAPERS, paperOf, langOf, MISSED, dictionary, sheets, reference, csv, json, xlsx, report, filename, crc32, csvCell };
