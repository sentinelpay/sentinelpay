'use strict';

// Which environment a database belongs to, said by the database itself.
//
// The operator tools used to decide whether they were pointed at production
// by reading the shell they ran in: NODE_ENV, APP_ENV, a variable to say
// "I mean it". The shell says nothing about the database the URL in it
// names. Staging runs with NODE_ENV=production, so the override got used,
// and the same override took the guard off production. So the server marks
// the database it runs on, once, and a tool that writes asks the database.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_env (
    id      integer     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    name    text        NOT NULL,
    set_at  timestamptz NOT NULL DEFAULT now()
);
`;

// What the server running here is: staging when it says so in so many
// words, then what Railway calls the environment, then production for a
// production build, and development for anything else.
function deployedAs(env) {
    const e = env || {};
    if (String(e.APP_ENV || '').trim().toLowerCase() === 'staging') return 'staging';
    const railway = String(e.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase();
    if (railway === 'production' || railway === 'staging') return railway;
    if (e.NODE_ENV === 'production') return 'production';
    return 'development';
}

// Written the first time a server starts on a database and never changed by
// one after: a server that disagrees with the mark says so loudly, because
// one of the two is pointed at the wrong database.
async function mark(db, env) {
    if (!db.available()) return '';
    const name = deployedAs(env || process.env);
    try {
        await db.query(SCHEMA);
        await db.query('INSERT INTO app_env (id, name) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [name]);
        const got = await read(db);
        if (got && got !== name) {
            console.error('[security] SERIOUS: this server runs as ' + name + ' but its database is marked ' + got +
                '. One of them is pointed at the wrong place.');
        }
        return got;
    } catch (err) {
        console.error('[app-env] could not mark the database: ' + err.message);
        return '';
    }
}

async function read(db) {
    try {
        const res = await db.query('SELECT name FROM app_env WHERE id = 1');
        return res.rowCount ? String(res.rows[0].name) : '';
    } catch (err) {
        return '';
    }
}

// For a tool: go on only where the database says it is one of these, and
// otherwise stop before anything is written, saying where it was pointed.
async function requireTarget(db, allowed, what) {
    const name = await read(db);
    if (allowed.indexOf(name) !== -1) return name;
    let where = 'this database';
    try {
        const u = new URL(process.env.DATABASE_URL || '');
        where = u.hostname + (u.pathname || '');
    } catch (err) { /* not a url to show */ }
    console.error('refusing to run' + (what ? ' ' + what : '') + ': ' + where + ' is marked ' +
        (name ? '"' + name + '"' : 'as nothing') + ', and this only runs on ' + allowed.join(' or ') + '.');
    if (!name) console.error('a database is marked by starting the server on it once.');
    process.exit(1);
    return '';
}

module.exports = { deployedAs, mark, read, requireTarget, SCHEMA };
