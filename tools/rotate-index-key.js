'use strict';

// Moves every address and phone number in the database from the previous
// index key to the new one.
//
// The index key turns an address into the hash the database finds it by.
// Anyone holding the key and a copy of the database can test whether a given
// address is a customer, so a key that has been seen has to be replaced. The
// hashes cannot be changed by the server one at a time as people turn up: a
// lookup in between would miss, and somebody signing up again in that minute
// would get a second account. So this rewrites them all in one transaction,
// with the tables locked against writes, and moves the marker in hash_keys
// over in the same commit. The server reads the marker every two seconds while
// SUBMISSIONS_INDEX_KEY_PREVIOUS is set and follows it.
//
// What it does not move, and why:
//   - sessions, API tokens, invitation and reset links stay under
//     SUBMISSIONS_TOKEN_KEY. They are 256 random bits; the key adds nothing to
//     them, and moving them would sign everybody out and stop every
//     integration.
//   - unfinished sign-ups are deleted. Their code is hashed with the address
//     in it and nobody has the code but the person, who asks for a new one.
//   - recovery codes and remembered devices cannot be rehashed without what
//     they were made from. A device moves over the next time it signs in; a
//     recovery code works under either key for as long as the previous one is
//     set. The last run says how many are still waiting.
//
//   SUBMISSIONS_INDEX_KEY=<new> SUBMISSIONS_INDEX_KEY_PREVIOUS=<old> \
//   SUBMISSIONS_TOKEN_KEY=<old> node tools/rotate-index-key.js [--write]
//
// Without --write it reads, counts and writes nothing. Run it again after
// --write: it should say nothing is left under the previous key.

const path = require('path');
const crypto = require('crypto');
const db = require(path.join(__dirname, '..', 'api', 'db.js'));

const WRITE = process.argv.includes('--write');

function mac(key, text) {
    return crypto.createHmac('sha256', key).update(String(text).trim().toLowerCase(), 'utf8').digest('hex');
}

// Each table that holds an address hash, how to read the address back, and
// which sealed values carry the hash in their label and so have to be sealed
// again under the new one.
const ADDRESSES = [
    {
        table: 'users', id: 'id', hash: 'email_hash',
        plain: { column: 'email_enc', label: (h) => 'signup-email:' + h },
        reseal: [
            { column: 'email_enc', label: (h) => 'signup-email:' + h },
            { column: 'name_enc', label: (h) => 'signup-name:' + h },
        ],
    },
    {
        table: 'reset_tokens', id: 'token_hash', hash: 'email_hash',
        plain: { column: 'email_enc', label: (h) => 'reset-email:' + h },
        reseal: [{ column: 'email_enc', label: (h) => 'reset-email:' + h }],
    },
    {
        table: 'invites', id: 'id', hash: 'email_hash',
        plain: { column: 'email_enc', label: (h) => 'invite:' + h },
        reseal: [{ column: 'email_enc', label: (h) => 'invite:' + h }],
    },
];

const TABLES = ['users', 'signup_codes', 'reset_tokens', 'invites', 'submissions',
    'trials', 'login_fails', 'audit_events', 'recovery_codes', 'known_devices'];

function refuse(lines) {
    lines.forEach((l) => console.error(l));
    process.exit(1);
}

async function main() {
    if (!db.available()) refuse(['no DATABASE_URL: nothing to rotate']);
    const k = db.keys();
    if (!process.env.SUBMISSIONS_INDEX_KEY || !k.index) {
        refuse(['SUBMISSIONS_INDEX_KEY is not set to a 32-byte base64 key. It is the new key.']);
    }
    if (!k.previous) {
        refuse(['SUBMISSIONS_INDEX_KEY_PREVIOUS is not set. Set it to the index key in use now and',
            'SUBMISSIONS_INDEX_KEY to the new one, on the server, then run this there.']);
    }
    if (k.previous.equals(k.index)) refuse(['the new index key is the same as the previous one.']);
    if (!process.env.SUBMISSIONS_TOKEN_KEY) {
        refuse(['SUBMISSIONS_TOKEN_KEY is not set. Sessions and API tokens are hashed with the key from before',
            'the first rotation, and once the previous key is removed nothing else holds it. Set',
            'SUBMISSIONS_TOKEN_KEY to the same value as SUBMISSIONS_INDEX_KEY_PREVIOUS, deploy, and run this again.']);
    }
    if (!(await db.init())) refuse(['the database is not answering']);
    const marker = await db.readKeys();
    if (marker.token_fp !== db.fingerprint(k.token)) {
        refuse(['SUBMISSIONS_TOKEN_KEY is not the key the sessions and API tokens in this database were made',
            'with. Check the value; with this one every session and every integration would stop working.']);
    }
    const fpNew = db.fingerprint(k.index);
    const fpOld = db.fingerprint(k.previous);
    const switched = marker.index_fp === fpNew;
    if (!switched && marker.index_fp !== fpOld) {
        refuse(['the addresses in this database are under neither key. SUBMISSIONS_INDEX_KEY_PREVIOUS has to be',
            'the key they are under now.']);
    }

    console.log(WRITE ? 'moving addresses to the new index key' : 'dry run, nothing will be written');
    if (switched) console.log('the database already reads under the new key, since ' + new Date(marker.index_since).toISOString());

    const c = await db.connect();
    const have = new Set();
    const n = { moved: 0, current: 0, unreadable: 0, other: 0, signups: 0, fails: 0, failsDropped: 0,
        audit: 0, submissions: 0, phones: 0 };
    const toNew = new Map();
    const isNew = new Set();
    function learn(plain) {
        const o = mac(k.previous, plain), w = mac(k.index, plain);
        toNew.set(o, w);
        isNew.add(w);
        return { o, w };
    }
    try {
        await c.query('BEGIN');
        for (const t of TABLES) {
            if ((await c.query('SELECT to_regclass($1) AS r', [t])).rows[0].r) have.add(t);
        }
        // reads go on, writes wait for the commit, so nothing is written under
        // the previous key between this read and the switch
        if (WRITE) {
            for (const t of TABLES) if (have.has(t)) await c.query('LOCK TABLE ' + t + ' IN EXCLUSIVE MODE');
        }

        for (const spec of ADDRESSES) {
            if (!have.has(spec.table)) continue;
            const cols = [spec.id, spec.hash].concat(spec.reseal.map((r) => r.column))
                .filter((v, i, a) => a.indexOf(v) === i);
            const rows = (await c.query('SELECT ' + cols.join(', ') + ' FROM ' + spec.table)).rows;
            for (const row of rows) {
                const h = row[spec.hash];
                const plain = db.tryOpen(spec.plain.label(h), row[spec.plain.column]);
                if (plain === null || !plain) { n.unreadable++; continue; }
                const { o, w } = learn(plain);
                if (h === w) { n.current++; continue; }
                if (h !== o) { n.other++; continue; }
                const sets = [spec.hash + ' = $1'];
                const args = [w];
                let readable = true;
                for (const r of spec.reseal) {
                    const blob = row[r.column];
                    if (!blob) continue;
                    const value = db.tryOpen(r.label(o), blob);
                    if (value === null) { readable = false; break; }
                    args.push(db.seal(r.label(w), value));
                    sets.push(r.column + ' = $' + args.length);
                }
                if (!readable) { n.unreadable++; continue; }
                n.moved++;
                if (!WRITE) continue;
                args.push(row[spec.id]);
                await c.query('UPDATE ' + spec.table + ' SET ' + sets.join(', ') +
                    ' WHERE ' + spec.id + ' = $' + args.length, args);
            }
            console.log('  ' + spec.table + ': read');
        }

        if (have.has('signup_codes')) {
            const rows = (await c.query('SELECT email_hash, email_enc FROM signup_codes')).rows;
            for (const row of rows) {
                const plain = db.tryOpen('signup-email:' + row.email_hash, row.email_enc);
                if (plain) learn(plain);
                if (!isNew.has(row.email_hash)) n.signups++;
            }
            if (WRITE && n.signups) {
                await c.query('DELETE FROM signup_codes WHERE NOT (email_hash = ANY($1))', [Array.from(isNew)]);
            }
        }

        if (have.has('submissions')) {
            const rows = (await c.query(
                'SELECT id, email_hash, payload, encrypted FROM submissions WHERE email_hash IS NOT NULL')).rows;
            for (const row of rows) {
                if (isNew.has(row.email_hash)) continue;
                let w = toNew.get(row.email_hash);
                const body = row.encrypted ? db.tryOpen('submission:' + row.id, row.payload) : row.payload;
                try {
                    const email = body ? JSON.parse(body).email : '';
                    if (email) {
                        const got = learn(email);
                        if (row.email_hash === got.w) continue;
                        if (row.email_hash === got.o) w = got.w;
                    }
                } catch (err) { /* a payload that is not JSON keeps the map's answer */ }
                if (!w) { n.other++; continue; }
                n.submissions++;
                if (WRITE) await c.query('UPDATE submissions SET email_hash = $1 WHERE id = $2', [w, row.id]);
            }
        }

        if (have.has('trials')) {
            const rows = (await c.query(
                'SELECT org_id, phone_hash, phone_enc FROM trials WHERE phone_hash IS NOT NULL AND org_id IS NOT NULL')).rows;
            for (const row of rows) {
                const phone = db.tryOpen('trial-phone:' + row.org_id, row.phone_enc);
                if (!phone) { n.unreadable++; continue; }
                const o = mac(k.previous, phone), w = mac(k.index, phone);
                if (row.phone_hash === w) continue;
                if (row.phone_hash !== o) { n.other++; continue; }
                n.phones++;
                if (WRITE) await c.query('UPDATE trials SET phone_hash = $1 WHERE org_id = $2', [w, row.org_id]);
            }
        }

        // a count of wrong passwords for an address nobody has an account,
        // sign-up or link for cannot be moved, and has nothing left to guard
        if (have.has('login_fails')) {
            const rows = (await c.query('SELECT email_hash FROM login_fails')).rows;
            for (const row of rows) {
                if (isNew.has(row.email_hash)) continue;
                const w = toNew.get(row.email_hash);
                if (w) n.fails++; else n.failsDropped++;
                if (!WRITE) continue;
                if (w) {
                    await c.query('DELETE FROM login_fails WHERE email_hash = $1', [w]);
                    await c.query('UPDATE login_fails SET email_hash = $1 WHERE email_hash = $2', [w, row.email_hash]);
                } else {
                    await c.query('DELETE FROM login_fails WHERE email_hash = $1', [row.email_hash]);
                }
            }
        }

        // The audit trail refuses every UPDATE, and this is the one it has to
        // take: the subject is the person's pseudonym, and left under the old
        // key it would stop matching them the day the old key is gone. Nothing
        // else in the row changes. The trigger is off for this statement only,
        // inside this transaction, with the table locked, and is back before
        // the commit; the rotation is written to the trail itself.
        if (have.has('audit_events')) {
            const olds = Array.from(toNew.keys());
            const news = olds.map((o) => toNew.get(o));
            const due = (await c.query('SELECT count(*)::int AS n FROM audit_events WHERE subject = ANY($1)', [olds])).rows[0].n;
            n.audit = due;
            if (WRITE && due) {
                await c.query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_update');
                await c.query(
                    `UPDATE audit_events a SET subject = m.w
                       FROM (SELECT unnest($1::text[]) AS o, unnest($2::text[]) AS w) m
                      WHERE a.subject = m.o`, [olds, news]);
                await c.query('ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_update');
            }
        }

        const since = switched ? marker.index_since : new Date();
        const recovery = have.has('recovery_codes')
            ? (await c.query('SELECT count(DISTINCT user_id)::int AS n FROM recovery_codes WHERE used_at IS NULL AND created_at < $1', [since])).rows[0].n
            : 0;
        const devices = have.has('known_devices')
            ? (await c.query('SELECT count(*)::int AS n FROM known_devices WHERE last_at < $1', [since])).rows[0].n
            : 0;

        const stale = n.moved + n.signups + n.submissions + n.phones + n.fails + n.failsDropped + n.audit;
        if (WRITE) {
            if (!switched) {
                await c.query('UPDATE hash_keys SET index_fp = $1, index_since = now() WHERE id = 1', [fpNew]);
            }
            await c.query("INSERT INTO audit_events (kind, actor, detail) VALUES ('index-key-rotated', 'operator', $1)",
                [JSON.stringify({ moved: n.moved, submissions: n.submissions, phones: n.phones, audit: n.audit,
                    signupsDropped: n.signups, failsDropped: n.failsDropped })]);
            await c.query('COMMIT');
        } else {
            await c.query('ROLLBACK');
        }

        const verb = WRITE ? 'moved' : 'to move';
        console.log('  addresses ' + verb + ': ' + n.moved + ', already under the new key: ' + n.current);
        console.log('  submissions ' + verb + ': ' + n.submissions + ', phone numbers ' + verb + ': ' + n.phones);
        console.log('  audit lines ' + verb + ': ' + n.audit + ', sign-in failure counts ' + verb + ': ' + n.fails +
            (n.failsDropped ? ', dropped for addresses with no account: ' + n.failsDropped : ''));
        console.log('  unfinished sign-ups ' + (WRITE ? 'deleted' : 'to delete') + ': ' + n.signups +
            (n.signups ? ' (those people ask for a new code)' : ''));
        if (n.unreadable) console.error('  ' + n.unreadable + ' row(s) could not be opened with SUBMISSIONS_KEY and were left alone.');
        if (n.other) console.error('  ' + n.other + ' row(s) are under neither index key and were left alone.');
        console.log('  recovery codes from before the switch, accounts holding unused ones: ' + recovery);
        console.log('  remembered devices not seen since the switch: ' + devices);

        if (!WRITE) {
            if (!switched) console.log('Run again with --write to move them and switch the server over.');
            else console.log(stale ? 'Not finished: ' + stale + ' still under the previous key. Run again with --write.'
                : 'Finished: nothing is under the previous key.');
            if (!stale && switched) {
                console.log(recovery
                    ? 'SUBMISSIONS_INDEX_KEY_PREVIOUS still lets ' + recovery + ' account(s) use recovery codes made before the switch.\n' +
                      'Remove it once they have used them or turned two-factor off and on, or now, if losing them is acceptable.'
                    : 'SUBMISSIONS_INDEX_KEY_PREVIOUS can be removed. Keep SUBMISSIONS_TOKEN_KEY as it is.');
                if (devices) console.log('Devices not seen by then are greeted as new once, with the usual sign-in mail.');
            }
        } else {
            console.log('Switched. The server reads under the new key within two seconds. Run again without --write to check.');
        }
    } catch (err) {
        await c.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        c.release();
    }
    process.exit(n.unreadable || n.other ? 2 : 0);
}

if (require.main === module) {
    main().catch((err) => {
        console.error('rotation failed, nothing was changed: ' + err.message);
        process.exit(1);
    });
}

module.exports = { ADDRESSES };
