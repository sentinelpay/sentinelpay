'use strict';

// The index key rotation, end to end, on a database of its own: the other
// test files share theirs and run alongside this one, and a rotation under
// them would pull every address out from under their lookups.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..', '..');
const CHILD = path.join(__dirname, 'rotation-child.js');
const TOOL = path.join(ROOT, 'tools', 'rotate-index-key.js');

const DATA = crypto.randomBytes(32).toString('base64');
const OLD = crypto.randomBytes(32).toString('base64');
const NEW = crypto.randomBytes(32).toString('base64');
const mac = (key, text) => crypto.createHmac('sha256', Buffer.from(key, 'base64'))
    .update(String(text).trim().toLowerCase(), 'utf8').digest('hex');

const base = process.env.DATABASE_URL;
const name = 'sp_rotation_' + crypto.randomBytes(4).toString('hex');
const url = base ? base.replace(/\/[^/?]+(\?|$)/, '/' + name + '$1') : '';

function env(extra) {
    const out = Object.assign({}, process.env, { DATABASE_URL: url, SUBMISSIONS_KEY: DATA }, extra);
    for (const k of ['SUBMISSIONS_INDEX_KEY', 'SUBMISSIONS_INDEX_KEY_PREVIOUS', 'SUBMISSIONS_TOKEN_KEY', 'SUBMISSIONS_KEY_PREVIOUS']) {
        if (!(k in extra)) delete out[k];
    }
    return out;
}
function child(mode, keys, ctx) {
    const out = execFileSync(process.execPath, [CHILD, mode], {
        env: Object.assign(env(keys), ctx ? { ROTATION_CTX: JSON.stringify(ctx) } : {}),
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(out.split('\n').find((l) => l.startsWith('RESULT ')).slice(7));
}
function tool(args, keys) {
    const r = spawnSync(process.execPath, [TOOL].concat(args), { env: env(keys), encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
}

const BEFORE = { SUBMISSIONS_INDEX_KEY: OLD };
const DURING = { SUBMISSIONS_INDEX_KEY: NEW, SUBMISSIONS_INDEX_KEY_PREVIOUS: OLD, SUBMISSIONS_TOKEN_KEY: OLD };
const AFTER = { SUBMISSIONS_INDEX_KEY: NEW, SUBMISSIONS_TOKEN_KEY: OLD };

test('the index key moves to a new one and nobody notices', { skip: !base, timeout: 240000 }, async () => {
    const admin = new Client({ connectionString: base });
    await admin.connect();
    await admin.query('CREATE DATABASE ' + name);
    try {
        const ctx = child('seed', BEFORE);
        const start = child('check', BEFORE, ctx);
        assert.strictEqual(start.user, mac(OLD, ctx.email));
        assert.ok(start.signIn && start.session && start.api && start.invite, 'the seed works before anything changes');

        // the tool will not run without the key the sessions were made under
        const bare = tool([], { SUBMISSIONS_INDEX_KEY: NEW, SUBMISSIONS_INDEX_KEY_PREVIOUS: OLD });
        assert.strictEqual(bare.code, 1);
        assert.match(bare.out, /SUBMISSIONS_TOKEN_KEY is not set/);
        const wrong = tool([], Object.assign({}, DURING, { SUBMISSIONS_TOKEN_KEY: NEW }));
        assert.strictEqual(wrong.code, 1);
        assert.match(wrong.out, /not the key the sessions/);

        // deployed with both keys: still reading under the old one
        const waiting = child('check', DURING, ctx);
        assert.strictEqual(waiting.live, 'previous');
        assert.ok(waiting.signIn && waiting.session && waiting.api && waiting.invite);

        const dry = tool([], DURING);
        assert.strictEqual(dry.code, 0, dry.out);
        assert.match(dry.out, /addresses to move: [1-9]/);
        assert.strictEqual(child('check', DURING, ctx).user, mac(OLD, ctx.email), 'a dry run writes nothing');

        const write = tool(['--write'], DURING);
        assert.strictEqual(write.code, 0, write.out);
        assert.match(write.out, /Switched/);

        const moved = child('check', DURING, ctx);
        assert.strictEqual(moved.live, 'index');
        assert.strictEqual(moved.user, mac(NEW, ctx.email));
        assert.strictEqual(moved.phone, mac(NEW, ctx.phone));
        assert.ok(moved.subjects.indexOf(mac(NEW, ctx.email)) !== -1);
        assert.strictEqual(moved.subjects.indexOf(mac(OLD, ctx.email)), -1, 'the trail follows the person');
        assert.deepStrictEqual(moved.fails, [mac(NEW, ctx.email)]);
        assert.deepStrictEqual(moved.signups, [], 'the unfinished sign-up is gone');
        assert.ok(moved.signIn && moved.session && moved.api, 'signed in, same session, same API token');
        assert.strictEqual(moved.invite, 'pozvana@primjer.hr', 'the invitation still opens and still reads');
        assert.ok(moved.recoveryAccepted, 'an old recovery code still works while the previous key is set');

        const verify = tool([], DURING);
        assert.strictEqual(verify.code, 0, verify.out);
        assert.match(verify.out, /Finished: nothing is under the previous key/);
        assert.match(verify.out, /accounts holding unused ones: 1/);

        // the previous key gone: the same account, session and token still work
        const after = child('check', AFTER, ctx);
        assert.ok(after.signIn && after.session && after.api && after.invite);
        assert.strictEqual(after.user, mac(NEW, ctx.email));
        assert.strictEqual(after.recoveryAccepted, false, 'and a code from before the switch no longer does');

        // and the data key after it: the invitation is one of the tables the
        // first version of that tool left behind
        const DATA2 = crypto.randomBytes(32).toString('base64');
        const rotating = Object.assign({}, AFTER, { SUBMISSIONS_KEY: DATA2, SUBMISSIONS_KEY_PREVIOUS: DATA });
        const data = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'rotate-key.js'), '--write'],
            { env: env(Object.assign({ SUBMISSIONS_INDEX_KEY: NEW }, rotating)), encoding: 'utf8' });
        assert.strictEqual(data.status, 0, data.stdout + data.stderr);
        assert.match(data.stdout, /invites: 1 row/);
        assert.match(data.stdout, /trials: 1 row/);
        const fresh = child('check', Object.assign({}, AFTER, { SUBMISSIONS_KEY: DATA2 }), ctx);
        assert.ok(fresh.signIn && fresh.session && fresh.api, 'signed in under the new data key alone');
        assert.strictEqual(fresh.invite, 'pozvana@primjer.hr', 'the invitation reads under the new data key alone');
    } finally {
        await admin.query('DROP DATABASE IF EXISTS ' + name + ' WITH (FORCE)').catch(() => {});
        await admin.end();
    }
});

// The data key rotation reads its list of tables from tools/rotate-key.js.
// That list once missed four tables and the check after it said all was well,
// because it only looked where the list told it. Every label the server seals
// under has to be on it, or be one the database never holds.
test('every sealed label is on the data key rotation list', () => {
    const { WORK } = require(path.join(ROOT, 'tools', 'rotate-key.js'));
    const covered = new Set();
    const sample = { id: 1, user_id: 1, org_id: 1, email_hash: 'h' };
    for (const job of WORK) for (const col of job.columns) covered.add(col.label(sample).split(':')[0]);
    const notInDatabase = new Set(['file-entry']);
    const used = new Set();
    for (const f of fs.readdirSync(path.join(__dirname, '..')).filter((f) => f.endsWith('.js'))) {
        const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
        for (const m of src.matchAll(/(?:db\.)?(?:seal|encrypt)\('([a-z-]+):'/g)) used.add(m[1]);
    }
    assert.ok(used.size > 5, 'the scan found the labels');
    for (const label of used) {
        assert.ok(covered.has(label) || notInDatabase.has(label), label + ' is sealed but tools/rotate-key.js does not rewrite it');
    }
});

// A value whose label carries the address hash has to be sealed again when
// the hash changes, or it can no longer be opened.
test('every label with an address hash in it is resealed by the index rotation', () => {
    const { WORK } = require(path.join(ROOT, 'tools', 'rotate-key.js'));
    const { ADDRESSES } = require(path.join(ROOT, 'tools', 'rotate-index-key.js'));
    const resealed = new Set();
    for (const a of ADDRESSES) for (const r of a.reseal) resealed.add(a.table + '.' + r.column);
    // dropped by the rotation rather than moved
    const dropped = new Set(['signup_codes.email_enc', 'signup_codes.name_enc']);
    for (const job of WORK) {
        for (const col of job.columns) {
            const a = col.label({ id: 1, user_id: 1, org_id: 1, email_hash: 'one' });
            const b = col.label({ id: 1, user_id: 1, org_id: 1, email_hash: 'two' });
            if (a === b) continue;
            const where = job.table + '.' + col.column;
            assert.ok(resealed.has(where) || dropped.has(where), where + ' is sealed under the address hash and the index rotation leaves it');
        }
    }
});
