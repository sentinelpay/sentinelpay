'use strict';

const crypto = require('crypto');
const path = require('path');
const { Pool } = require(path.join(__dirname, '..', 'api', 'node_modules', 'pg'));
const WRITE = process.argv.includes('--write');
function need(name) {
    const v = process.env[name];
    if (!v) {
        console.error('missing ' + name);
        process.exit(1);
    }
    return v;
}
if (String(process.env.APP_ENV || '').toLowerCase() !== 'staging') {
    console.error('refusing to run: APP_ENV must be exactly "staging".');
    console.error('this writes into the target database and must never point at production.');
    process.exit(1);
}
const SRC_URL = need('SRC_URL');
const DST_URL = need('DST_URL');
if (SRC_URL === DST_URL) {
    console.error('refusing to run: the source and the target are the same database.');
    process.exit(1);
}
if (/prod/i.test(DST_URL) && !process.env.I_KNOW_THE_TARGET_SAYS_PROD) {
    console.error('refusing to run: the target url has "prod" in it.');
    console.error('if that is genuinely the staging database, set I_KNOW_THE_TARGET_SAYS_PROD=1.');
    process.exit(1);
}
function readKey(value, what) {
    const buf = Buffer.from(String(value || ''), 'base64');
    if (buf.length !== 32) {
        console.error(what + ' must be 32 bytes base64, got ' + buf.length);
        process.exit(1);
    }
    return buf;
}

const SRC_KEY = readKey(need('SRC_KEY'), 'SRC_KEY');
const DST_KEY = readKey(need('DST_KEY'), 'DST_KEY');
const SRC_INDEX = process.env.SRC_INDEX_KEY
    ? readKey(process.env.SRC_INDEX_KEY, 'SRC_INDEX_KEY')
    : crypto.createHmac('sha256', SRC_KEY).update('blind-index-v1').digest();
const DST_INDEX = process.env.DST_INDEX_KEY
    ? readKey(process.env.DST_INDEX_KEY, 'DST_INDEX_KEY')
    : crypto.createHmac('sha256', DST_KEY).update('blind-index-v1').digest();
function seal(key, aad, plain) {
    const nonce = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
    c.setAAD(Buffer.from(aad, 'utf8'));
    const body = Buffer.concat([c.update(String(plain == null ? '' : plain), 'utf8'), c.final()]);
    return Buffer.concat([Buffer.from([1]), nonce, c.getAuthTag(), body]).toString('base64');
}
function open(key, aad, blob) {
    try {
        const buf = Buffer.from(String(blob || ''), 'base64');
        if (buf.length < 29 || buf[0] !== 1) return '';
        const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(1, 13), { authTagLength: 16 });
        d.setAAD(Buffer.from(aad, 'utf8'));
        d.setAuthTag(buf.subarray(13, 29));
        return Buffer.concat([d.update(buf.subarray(29)), d.final()]).toString('utf8');
    } catch (err) {
        return '';
    }
}
function blindIndex(key, email) {
    return crypto.createHmac('sha256', key)
        .update(String(email || '').trim().toLowerCase(), 'utf8').digest('hex');
}

const FIRST = ['Ana', 'Marko', 'Ivana', 'Luka', 'Petra', 'Ivan', 'Maja', 'Tomislav', 'Lara', 'Filip',
    'Nina', 'Josip', 'Sara', 'Karlo', 'Eva', 'Matej', 'Dora', 'Stjepan', 'Klara', 'Vito'];
const LAST = ['Anić', 'Babić', 'Cvitanović', 'Dujmović', 'Erceg', 'Franić', 'Grgić', 'Horvat',
    'Ivić', 'Jurić', 'Kovačević', 'Lukić', 'Marić', 'Novak', 'Perić', 'Radić', 'Šimić', 'Tomić'];
const DOMAIN = ['primjer.hr', 'ogledni.hr', 'testna-firma.hr', 'primjer.de', 'example.com'];
function invent(sourceHash) {
    const n = parseInt(sourceHash.slice(0, 8), 16);
    const first = FIRST[n % FIRST.length];
    const last = LAST[(n >>> 5) % LAST.length];
    const domain = DOMAIN[(n >>> 11) % DOMAIN.length];
    const tag = sourceHash.slice(0, 6);
    return {
        name: first + ' ' + last,
        email: (first + '.' + last + '.' + tag)
            .toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9.]/g, '') + '@' + domain,
    };
}
const STAFF = String(process.env.STAFF_EMAILS || '')
    .split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const src = new Pool({ connectionString: SRC_URL, ssl: sslFor(SRC_URL), max: 4 });
const dst = new Pool({ connectionString: DST_URL, ssl: sslFor(DST_URL), max: 4 });
function sslFor(url) {
    let host = '';
    try { host = new URL(url).hostname; } catch (err) { return undefined; }
    const priv = host.endsWith('.railway.internal') || host === 'localhost' || host === '127.0.0.1' || host === '::1';
    return priv ? false : { rejectUnauthorized: false };
}

async function main() {
    console.log(WRITE ? 'copying, and the target will be emptied first' : 'dry run: reading only');
    const users = (await src.query(
        'SELECT id, created_at, email_hash, email_enc, name_enc, password_hash, lang, flags, verified_at, last_login_at FROM users ORDER BY id')).rows;
    const subs = (await src.query(
        'SELECT id, received_at, kind, outcome, country, lang, email_hash, payload, encrypted, flags FROM submissions ORDER BY id')).rows;
    const audit = (await src.query(
        "SELECT at, kind, actor, subject, detail FROM audit_events ORDER BY at").catch(() => ({ rows: [] }))).rows;
    console.log('  users        ' + users.length);
    console.log('  submissions  ' + subs.length);
    console.log('  audit events ' + audit.length);
    console.log('  not copied:  sessions, reset links, sign-up codes, second factors, recovery codes, rate counters');

    let keptStaff = 0;
    let unreadable = 0;
    const rewritten = users.map((u) => {
        const realEmail = open(SRC_KEY, 'signup-email:' + u.email_hash, u.email_enc);
        const realName = open(SRC_KEY, 'signup-name:' + u.email_hash, u.name_enc);
        if (!realEmail) unreadable++;
        const isStaff = realEmail && STAFF.indexOf(realEmail.toLowerCase()) !== -1;
        const person = isStaff
            ? { email: realEmail, name: realName || 'Staff' }
            : invent(u.email_hash);
        if (isStaff) keptStaff++;
        const hash = blindIndex(DST_INDEX, person.email);
        return {
            id: u.id,
            created_at: u.created_at,
            email_hash: hash,
            email_enc: seal(DST_KEY, 'signup-email:' + hash, person.email),
            name_enc: seal(DST_KEY, 'signup-name:' + hash, person.name),

            password_hash: 'scrypt$32768$8$1$' +
                crypto.randomBytes(16).toString('base64') + '$' + crypto.randomBytes(64).toString('base64'),
            lang: u.lang, flags: u.flags, verified_at: u.verified_at, last_login_at: u.last_login_at,
            sourceHash: u.email_hash,
            person: person,
        };
    });
    const byOldHash = {};
    rewritten.forEach((u) => { byOldHash[u.sourceHash] = u; });
    const subsOut = subs.map((r) => {
        let fields = {};
        try {
            fields = JSON.parse(r.encrypted ? open(SRC_KEY, 'submission:' + r.id, r.payload) : r.payload) || {};
        } catch (err) { fields = {}; }
        const known = r.email_hash ? byOldHash[r.email_hash] : null;
        const person = (known && known.person)
            || (r.email_hash ? invent(r.email_hash) : invent('00000000'));

        const clean = Object.assign({}, fields, {
            email: person.email,
            name: person.name,
            firstName: person.name.split(' ')[0],
            lastName: person.name.split(' ').slice(1).join(' '),
            phone: fields.phone ? '+385 91 000 0000' : undefined,
            company: fields.company ? 'Ogledna firma d.o.o.' : undefined,
            website: fields.website ? 'primjer.hr' : undefined,
            ip: null,
            ua: fields.ua ? 'redacted' : undefined,
        });
        const hash = blindIndex(DST_INDEX, person.email);
        return { row: r, hash, clean };
    });
    if (!WRITE) {
        console.log('');
        console.log('would keep ' + keptStaff + ' staff account(s) with their own address, and invent the rest');
        if (unreadable) console.log(unreadable + ' user row(s) could not be opened with SRC_KEY and would be copied as invented people');
        console.log('run again with --write to do it');
        return;
    }
    const c = await dst.connect();
    try {
        await c.query('BEGIN');
        await c.query('TRUNCATE sessions, known_devices, recovery_codes, totp_pending, login_fails, rate_hits, reset_tokens, signup_codes, audit_events, submissions, users RESTART IDENTITY CASCADE');
        for (const u of rewritten) {
            await c.query(
                `INSERT INTO users (id, created_at, email_hash, email_enc, name_enc, password_hash, lang, flags, verified_at, last_login_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                [u.id, u.created_at, u.email_hash, u.email_enc, u.name_enc, u.password_hash,
                 u.lang, u.flags, u.verified_at, u.last_login_at]);
        }
        await c.query("SELECT setval('users_id_seq', GREATEST((SELECT COALESCE(MAX(id),1) FROM users), 1))");
        for (const s of subsOut) {
            const ins = await c.query(
                `INSERT INTO submissions (received_at, kind, outcome, country, lang, email_hash, flags, payload, encrypted)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,'',true) RETURNING id`,
                [s.row.received_at, s.row.kind, s.row.outcome, s.row.country, s.row.lang, s.hash, s.row.flags || '']);
            const id = ins.rows[0].id;
            await c.query('UPDATE submissions SET payload = $1 WHERE id = $2',
                [seal(DST_KEY, 'submission:' + id, JSON.stringify(s.clean)), id]);
        }
        for (const a of audit) {
            const known = a.subject ? byOldHash[a.subject] : null;
            await c.query(
                'INSERT INTO audit_events (at, kind, actor, subject, ip, detail) VALUES ($1,$2,$3,$4,NULL,$5)',
                [a.at, a.kind, a.actor, known ? known.email_hash : a.subject, a.detail]);
        }
        if (STAFF.length && process.env.STAFF_PASSWORD) {
            const hash = await scrypt(process.env.STAFF_PASSWORD);
            for (const u of rewritten) {
                const email = open(DST_KEY, 'signup-email:' + u.email_hash, u.email_enc);
                if (STAFF.indexOf(String(email).toLowerCase()) === -1) continue;
                await c.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, u.id]);
            }
            console.log('  staff accounts can sign in with STAFF_PASSWORD');
        }
        await c.query('COMMIT');
    } catch (err) {
        await c.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        c.release();
    }
    console.log('');
    console.log('done. ' + rewritten.length + ' user(s), ' + subsOut.length + ' submission(s), ' + audit.length + ' audit event(s).');
    console.log('nobody real is in there: every address and name outside the staff list was invented on the way through.');
}
function scrypt(password) {
    return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(16);
        crypto.scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (err, key) => {
            if (err) return reject(err);
            resolve(['scrypt', 32768, 8, 1, salt.toString('base64'), key.toString('base64')].join('$'));
        });
    });
}
main()
    .then(() => Promise.all([src.end(), dst.end()]))
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('snapshot failed: ' + err.message);
        Promise.all([src.end(), dst.end()]).finally(() => process.exit(1));
    });