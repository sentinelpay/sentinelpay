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

function esc(v) {
    return String(v === null || v === undefined ? '' : v)
        .replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}
function num(v) {
    return typeof v === 'number' ? v.toLocaleString('en-GB') : esc(v);
}
function longDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? esc(iso)
        : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function table(sh, opts) {
    const o = opts || {};
    const rows = o.skipEmpty ? sh.rows.filter((r) => r.slice(2).some((x) => typeof x === 'number' && x > 0)) : sh.rows;
    if (!rows.length) return '<p class="none">Nothing in this period.</p>';
    // rows grouped by their first column print as one table with a heading
    // line for each group, which reads the way the page's own breakdowns do
    let last = null;
    const body = rows.map((r) => {
        let pre = '';
        if (o.grouped && r[0] !== last) {
            last = r[0];
            pre = '<tr class="grp"><th colspan="' + (r.length - 1) + '">' + esc(r[0]) + '</th></tr>';
        }
        const cells = o.grouped ? r.slice(1) : r;
        return pre + '<tr>' + cells.map((x, i) => (i === 0
            ? '<td>' + esc(x) + '</td>'
            : '<td class="n">' + num(x) + (o.pct && i === cells.length - 1 ? '%' : '') + '</td>')).join('') + '</tr>';
    }).join('');
    const head = (o.grouped ? sh.head.slice(1) : sh.head);
    return '<table><thead><tr>' + head.map((h, i) => '<th' + (i ? ' class="n"' : '') + '>' +
        esc(i === 0 && o.grouped ? '' : h) + '</th>').join('') + '</tr></thead><tbody>' + body + '</tbody></table>';
}

// The paper sizes a report can be printed on. A4 unless asked otherwise: it is
// what a compliance file in Europe is kept on, and the browser's own default
// is whatever the reader's printer was last set to. Each size carries the
// margins that suit it, so a page of A5 is not laid out with A3's.
const PAPERS = {
    a4: { name: 'A4', w: 210, h: 297, mx: 16, my: 18, cols: 4, font: 13 },
    letter: { name: 'US Letter', w: 215.9, h: 279.4, mx: 16, my: 17, cols: 4, font: 13 },
    legal: { name: 'US Legal', w: 215.9, h: 355.6, mx: 16, my: 18, cols: 4, font: 13 },
    a3: { name: 'A3', w: 297, h: 420, mx: 22, my: 24, cols: 4, font: 14 },
    a5: { name: 'A5', w: 148, h: 210, mx: 11, my: 13, cols: 2, font: 11 },
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

function report(list, meta, out) {
    const by = (name) => list.find((sh) => sh.name === name);
    const rows = new Map(by('Summary').rows.map((r) => [r[0], r]));
    const sum = new Map(by('Summary').rows.map((r) => [r[0], r[1]]));
    const before = (key) => (rows.get(key) || [])[2];
    const sandbox = out.scope === 'sandbox';
    const paperKey = paperOf(meta.paper);
    const paper = PAPERS[paperKey];
    const ref = meta.reference;
    const org = meta.organisation || '';
    const from = longDate(out.period.from);
    const to = longDate(lastDay(out.period.to));
    const scopeWord = sandbox ? 'sandbox' : 'production';
    const generated = meta.generated.replace('T', ' ').slice(0, 16) + ' UTC';

    // A figure, what it was the period before, and a line of its own where it
    // has one. The earlier figure is set back: it is context for the number
    // above it, not a second number competing with it.
    const fig = (label, key, foot) => {
        const b = before(key);
        return '<div class="fig"><div class="k">' + esc(label) + '</div><div class="v">' +
            num(sum.get(key)) + '</div>' +
            (b !== '' && b !== undefined ? '<div class="w">' + num(b) + ' the period before</div>' : '') +
            (foot ? '<div class="f">' + esc(foot) + '</div>' : '') + '</div>';
    };
    const incl = sum.get('Screenings included this cycle');
    const daily = by('Daily');
    const compared = before('Period from')
        ? '<p class="cmp">Each figure is shown beside the same number of days before this period, ' +
          longDate(before('Period from')) + ' to ' + longDate(lastDay(before('Period to'))) + '.</p>'
        : '';
    const excluded = sum.has('Sandbox checks not included')
        ? '<p class="cmp">' + (sum.get('Sandbox checks not included')
            ? num(sum.get('Sandbox checks not included')) + ' sandbox checks were made in this period. ' +
              'They are test work, spend nothing and are not counted anywhere in this report.'
            : 'No sandbox checks were made in this period.') + '</p>'
        : '';

    // What runs along the top and the bottom of every printed page after the
    // cover: what the document is and whose, and where it sits in itself.
    const running = 'Sentinelpay · Usage and evidence report';
    const whose = org + ' · ' + from + ' to ' + to;
    // set in the document's own face, small and set back: without it the
    // browser prints these in its default serif at the size of body text
    const box = 'font-family:Inter, system-ui, sans-serif; font-size:' + (paperKey === 'a5' ? '6.5pt' : '7.5pt') +
        '; color:#6b7898; vertical-align:middle;';
    const pageCss =
        '@page { size:' + paper.w + 'mm ' + paper.h + 'mm; margin:' + paper.my + 'mm ' + paper.mx + 'mm; ' +
        '@top-left { content:' + cssStr(running) + '; ' + box + ' } ' +
        '@top-right { content:' + cssStr(whose) + '; ' + box + ' text-align:right; } ' +
        '@bottom-left { content:' + cssStr('Reference ' + ref.slice(0, 16)) + '; ' + box + ' } ' +
        '@bottom-right { content:"Page " counter(page) " of " counter(pages); ' + box + ' text-align:right; } } ' +
        // the cover is the whole sheet, with no margin and nothing running
        '@page :first { margin:0; @top-left { content:none; } @top-right { content:none; } ' +
        '@bottom-left { content:none; } @bottom-right { content:none; } } ' +
        ':root { --pw:' + paper.w + 'mm; --ph:' + paper.h + 'mm; --mx:' + paper.mx + 'mm; --my:' + paper.my + 'mm; ' +
        '--ar:' + paper.w + ' / ' + paper.h + '; ' +
        '--cols:' + paper.cols + '; --fs:' + paper.font + 'px; }';

    const sheetHead = '<div class="run" aria-hidden="true"><span>' + esc(running) + '</span><span>' + esc(whose) + '</span></div>';
    const sheetFoot = '<div class="run is-foot" aria-hidden="true"><span>Reference ' + esc(ref.slice(0, 16)) + '</span></div>';
    const signer = (title) => '<div class="signer"><div class="signer-t">' + esc(title) + '</div>' +
        ['Name', 'Role', 'Date', 'Signature'].map((l) => '<div class="line"><span></span>' + l + '</div>').join('') + '</div>';

    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<meta name="robots" content="noindex,nofollow">' +
        '<title>Usage report ' + esc(day(out.period.from)) + ' to ' + esc(day(out.period.to)) + ' · ' + esc(org) + '</title>' +
        '<link rel="icon" type="image/svg+xml" href="/logo.svg">' +
        '<link rel="stylesheet" href="/fonts.css">' +
        '<style>' + REPORT_CSS + pageCss + '</style></head>' +
        // Shown inside the usage page, the page around it carries the controls
        // and the way back, so the report is the paper alone. The reference is
        // on the body for that page to read and print under.
        (meta.embed
            ? '<body class="is-embed' + (sandbox ? ' is-sandbox' : '') + ' paper-' + paperKey + '" data-ref="' + esc(ref) + '">'
            : '<body class="paper-' + paperKey + (sandbox ? ' is-sandbox' : '') + '" data-ref="' + esc(ref) + '">' +
              '<div class="bar"><a href="' + esc(meta.back) + '">Back to usage</a>' +
              '<button type="button" id="print">Print or save as PDF</button></div>') +
        // a sandbox report says what it is before anything else, and again
        // across every printed page, so a copy cannot be mistaken for evidence
        (sandbox ? '<div class="wm" aria-hidden="true">Sandbox</div>' : '') +

        // ---- the cover, on a page alone and laid out the way Apple lays out
        // its own: the mark small in the corner, the title in two lines on a
        // column a little left of centre, the eye large under it, and at the
        // foot of that column whose report it is and the period it covers.
        // Every measure is a share of the paper's width, so the cover is the
        // same composition on A5 as on A3.
        '<main class="doc">' +
        '<section class="sheet cover">' +
        '<img class="c-mark" src="/logo.svg" alt="Sentinelpay">' +
        '<h1 class="c-title">Usage and<br>evidence report</h1>' +
        '<svg class="c-eye" viewBox="33 43 54 34" aria-hidden="true">' +
        '<defs><linearGradient id="eyeInk" x1="0%" y1="0%" x2="100%" y2="100%">' +
        '<stop offset="0%" stop-color="#00c8e0"/><stop offset="100%" stop-color="#8a2be2"/></linearGradient></defs>' +
        '<g fill="none" stroke="url(#eyeInk)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M38 60 Q 60 40 82 60 Q 60 80 38 60 Z"/><circle cx="60" cy="60" r="6"/></g>' +
        '<circle cx="60" cy="60" r="2" fill="url(#eyeInk)"/></svg>' +
        '<div class="c-foot"><div class="c-org">' + esc(org) + '</div>' +
        '<div class="c-period">' + from + ' to ' + to + '</div>' +
        (sandbox ? '<div class="c-sbx">Sandbox. Test data, not evidence.</div>' : '') + '</div>' +
        '</section>' +

        // ---- the details the cover leaves out, at the head of the statement
        '<section class="sheet statement">' + sheetHead +
        '<dl class="meta">' +
        '<div><dt>Organisation</dt><dd>' + esc(org) + '</dd></div>' +
        '<div><dt>Period</dt><dd>' + from + ' to ' + to + '</dd></div>' +
        '<div><dt>Scope</dt><dd>' + esc(sum.get('Scope')) + '</dd></div>' +
        (sum.get('Plan') ? '<div><dt>Plan</dt><dd>' + esc(sum.get('Plan')) + '</dd></div>' : '') +
        '<div><dt>Time zone</dt><dd>' + esc(sum.get('Time zone')) + '</dd></div>' +
        '<div><dt>Generated</dt><dd>' + esc(generated) + '</dd></div>' +
        '<div><dt>Paper</dt><dd>' + esc(paper.name) + '</dd></div>' +
        '</dl>' +

        // ---- the statement, and the two people who put their names to it,
        // before any figure: what the numbers are, then the numbers
        '<h2 class="big">Statement</h2>' +
        '<p>This report sets out the screening ' + esc(org) + ' carried out through Sentinelpay between ' +
        from + ' and ' + to + ', in the ' + scopeWord + ' scope. It was generated on ' + esc(generated) +
        ' from the records as they stood at that moment.</p>' +
        '<p>Every check and every decision counted here was sealed with a SHA-256 digest when it was written. ' +
        'Each one can be opened from its evidence file and its digest checked on its own, without this report ' +
        'and without access to Sentinelpay.</p>' +
        (sandbox
            ? '<p>This is the sandbox scope. Its checks are test work and are not evidence of screening.</p>'
            : '<p>Sandbox checks are test work. They spend no allowance and are left out of every figure here.</p>') +
        '<p>Any export of the same period carries the reference below, so a copy in any format can be matched to this one.</p>' +
        '<p class="ref">sha256:' + esc(ref) + '</p>' +
        '<div class="sign">' + signer('Prepared by') + signer('Reviewed by') + '</div>' +
        sheetFoot + '</section>' +

        // ---- the figures
        '<section class="sheet body">' + sheetHead +
        '<div class="part"><h2>At a glance</h2>' + compared + '<div class="figs">' +
        // the allowance is spent by production alone; a sandbox report saying
        // how much of it went would be saying something that never happened
        fig('Screenings', 'Screenings', !sandbox && incl !== '' && incl !== undefined
            ? num(sum.get('Screenings used this cycle')) + ' of ' + num(incl) + ' used this cycle' : '') +
        fig('Sanctioned', 'Sanctioned') +
        fig('Worth a look', 'Worth a look') +
        fig('Distinct addresses', 'Distinct addresses') +
        fig('Decisions recorded', 'Decisions recorded') +
        fig('Findings open now', 'Findings open now', sum.get('Oldest open finding') ? 'oldest from ' + longDate(sum.get('Oldest open finding')) : '') +
        fig('Checks on record', 'Checks on record') +
        fig('Sealed with a digest', 'Sealed with a digest', 'kept for ' + sum.get('Kept for (years)') + ' years') +
        '</div>' + excluded + '</div>' +
        '<div class="part"><h2>Screenings</h2>' + table(by('Screenings'), { grouped: true, pct: true, skipEmpty: true }) + '</div>' +
        '<div class="part"><h2>Review</h2>' + table(by('Review'), { grouped: true, pct: true }) + '</div>' +
        '<div class="part"><h2>Sanctions coverage</h2>' + table(by('Coverage'), { grouped: true, pct: true, skipEmpty: true }) + '</div>' +
        '<div class="part"><h2>API</h2>' + table(by('API'), { pct: true }) + '</div>' +
        '<div class="part"><h2>Team</h2>' + table(by('Team'), { grouped: true, pct: true }) + '</div>' +
        '<div class="part"><h2>Evidence</h2>' + table(by('Evidence'), { grouped: true, pct: true }) + '</div>' +
        '<div class="part is-days"><h2>Day by day</h2>' + table({
            head: ['Day', 'Screenings', 'Flagged', 'Sanctioned', 'Decisions', 'API calls'],
            rows: daily.rows.map((r) => [r[0], r[1], r[2], r[3], r[5], r[8]]),
        }) + '</div>' +
        '<p class="end">End of report · sha256:' + esc(ref) + '</p>' +
        sheetFoot + '</section>' +
        '</main>' +
        '<script src="/report.js"></script></body></html>';
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
.body .run.is-foot { margin-top:28px; }

/* ---- cover
   Measured off Apple's own cover and kept as shares of the sheet: the column
   starts 39% in, the title's top at 29% down, the eye from 46%, the foot at
   89%. Sizes are shares of the width too, through the sheet's own container
   units, so A5 is A3 made smaller rather than laid out again. */
.cover { position:relative; padding:0; aspect-ratio:var(--ar); min-height:0; container-type:inline-size; overflow:hidden; }
.c-mark { position:absolute; top:4.6%; right:8.5%; width:6cqw; height:auto; }
.c-title { position:absolute; top:29%; left:39%; right:8%; margin:0;
  font:700 5.3cqw/1.12 'Plus Jakarta Sans', Inter, sans-serif; letter-spacing:-.015em; color:var(--ink); }
/* the eye is wider than it is tall, so it is given the width that makes
   it weigh what Apple's square mark weighs on the same page */
.c-eye { position:absolute; top:46%; left:39%; width:25cqw; height:auto; }
.c-foot { position:absolute; top:88.5%; left:39%; right:8%; }
.c-org { font:600 2.6cqw/1.3 'Plus Jakarta Sans', Inter, sans-serif; color:var(--ink); overflow-wrap:anywhere; }
.c-period { font:500 2.1cqw/1.4 Inter, sans-serif; color:var(--ink-3); margin-top:.3cqw; }
.c-sbx { font:600 1.8cqw/1.4 Inter, sans-serif; color:#a06000; margin-top:.8cqw; }

/* the details the cover leaves out, opening the statement */
.statement .meta { margin:0 0 22px; padding:0 0 14px; border:0; border-bottom:1px solid var(--line);
  display:grid; grid-template-columns:max-content 1fr; gap:4px 28px; font-size:.88em; }
.meta div { display:contents; }
.meta dt { color:var(--ink-3); }
.meta dd { margin:0; font-weight:600; }

/* ---- statement */
h2 { font:700 14px 'Plus Jakarta Sans', Inter, sans-serif; margin:0 0 8px; padding-bottom:6px; border-bottom:1px solid var(--line); break-after:avoid; }
h2.big { font-size:20px; border:0; padding:0; margin:0 0 14px; }
.statement p { margin:0 0 10px; color:var(--ink-2); max-width:150mm; }
.statement .ref { margin-top:16px; color:var(--ink); font-weight:600; word-break:break-all; font-size:11.5px; }
.sign { display:grid; grid-template-columns:1fr 1fr; gap:10mm; margin-top:auto; padding-top:18mm; }
.signer-t { font:700 12px 'Plus Jakarta Sans', Inter, sans-serif; margin-bottom:6px; }
.signer .line { font-size:10px; color:var(--ink-3); margin-top:14px; }
.signer .line span { display:block; height:22px; border-bottom:1px solid var(--ink); margin-bottom:3px; }

/* ---- figures */
.part { margin-top:22px; }
.part:first-of-type { margin-top:0; }
.figs { display:grid; grid-template-columns:repeat(var(--cols), 1fr); border:1px solid var(--line); border-radius:6px; overflow:hidden; break-inside:avoid; }
.fig { padding:10px 12px; border-right:1px solid var(--line); border-bottom:1px solid var(--line); margin:0 -1px -1px 0; }
.fig .k { color:var(--ink-3); font-size:.85em; }
.fig .v { font-size:1.4em; font-weight:700; margin-top:2px; font-variant-numeric:tabular-nums; }
.fig .f, .fig .w { color:var(--ink-3); font-size:.8em; margin-top:1px; font-variant-numeric:tabular-nums; }
.cmp { margin:0 0 8px; color:var(--ink-3); font-size:.88em; }
.figs + .cmp { margin:8px 0 0; }
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
.paper-a5 .sign { gap:6mm; padding-top:8mm; }
.paper-a5 .signer .line { margin-top:9px; }
.paper-a5 .signer .line span { height:16px; }
@media (max-width: 700px) {
  .sheet { padding:22px 16px; }
  .statement { min-height:0; }
  .figs { grid-template-columns:repeat(2, 1fr); }
  .sign { grid-template-columns:1fr; gap:6mm; padding-top:24px; }
  .run { display:none; }
}

/* inside the usage page: the sheets on whatever is behind the frame, not on a
   grey desk of their own */
html:has(body.is-embed) { background:transparent; }
.is-embed .doc { padding:4px 0 28px; }
.is-embed .sheet { box-shadow:0 1px 2px rgba(14,35,88,.1), 0 10px 32px rgba(0,0,0,.18); }

@media print {
  html, body { background:#fff; }
  .bar, .run { display:none; }
  .doc { padding:0; }
  .sheet { width:auto; max-width:none; margin:0; padding:0; box-shadow:none; border-radius:0; }
  /* a page each, the height of the page less its margins, less a hair so a
     rounding never spills a cover onto a blank second page */
  .statement { min-height:0; height:calc(var(--ph) - 2 * var(--my) - 2mm); break-after:page; }
  /* the cover is the whole sheet, its margin taken off by the first page's
     rule, less a hair so it never spills onto a blank second page */
  .cover { width:var(--pw); height:calc(var(--ph) - 1mm); aspect-ratio:auto; break-after:page; }
  .part.is-days { break-before:page; }
}
`;

function filename(out, format) {
    return 'sentinelpay-usage-' + day(out.period.from) + '-to-' + day(out.period.to) +
        (out.scope === 'sandbox' ? '-sandbox' : '') + '.' + format;
}

module.exports = { FORMATS, PAPERS, paperOf, sheets, reference, csv, json, xlsx, report, filename, crc32, csvCell };
