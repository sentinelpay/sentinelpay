'use strict';

// Moves every versioned asset in the html one number up.
//
// The version in a filename is what makes a browser fetch the new file instead
// of the one it already has. Bumping it by hand means typing the number you
// think is there, and the day you are wrong nothing happens: the replace finds
// nothing, exits quietly, and the deploy ships html pointing at a url every
// browser already has cached. That is exactly how a fix reached staging and was
// invisible on it -- a revert had put the number back and the next bump was
// still looking for the one after it.
//
// So this reads the number that is actually there rather than being told, and
// it fails loudly if the pages disagree with each other.
//
//   node tools/bump-assets.js dash-app.js dash.css        what it would do
//   node tools/bump-assets.js dash-app.js --yes            do it
//   node tools/bump-assets.js --all --yes                  every asset
//   node tools/bump-assets.js dash-app.js --by 2 --yes     skip a number
//
// Naming the files matters: bumping one that did not change costs every visitor
// a download of something they already have. --by is for when a number was
// served once and taken back, and going one up would land on it again.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'api', 'public');
const args = process.argv.slice(2);
const GO = args.includes('--yes');
const ALL = args.includes('--all');
const STEP = (() => {
    const at = args.indexOf('--by');
    const n = at === -1 ? 1 : Number(args[at + 1]);
    return Number.isSafeInteger(n) && n > 0 ? n : 1;
})();
const WANT = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--by'));
if (!ALL && !WANT.length) {
    console.error('name the assets to bump, or pass --all');
    console.error('  node tools/bump-assets.js dash-app.js dash.css --yes');
    process.exit(1);
}
const NAME = /(?:^|["'\/])([a-z0-9-]+)\.(\d+)\.(css|js)\b/g;

const pages = fs.readdirSync(DIR).filter((f) => f.endsWith('.html'));
if (!pages.length) {
    console.error('no pages in ' + DIR);
    process.exit(1);
}

// asset -> { version -> [pages] }
const seen = new Map();
const text = new Map();
pages.forEach((page) => {
    const body = fs.readFileSync(path.join(DIR, page), 'utf8');
    text.set(page, body);
    let m;
    NAME.lastIndex = 0;
    while ((m = NAME.exec(body)) !== null) {
        const key = m[1] + '.' + m[3];
        if (!seen.has(key)) seen.set(key, new Map());
        const byVersion = seen.get(key);
        if (!byVersion.has(m[2])) byVersion.set(m[2], []);
        byVersion.get(m[2]).push(page);
    }
});

if (!seen.size) {
    console.error('no versioned assets found, which cannot be right');
    process.exit(1);
}

// A file asked for as two different versions is two caches of the same thing,
// and one of them is stale on somebody's machine right now.
let split = false;
seen.forEach((byVersion, key) => {
    if (byVersion.size > 1) {
        split = true;
        console.error('disagreement on ' + key + ':');
        byVersion.forEach((where, version) => {
            console.error('  ' + version + '  ' + where.slice(0, 4).join(', ') +
                (where.length > 4 ? ' and ' + (where.length - 4) + ' more' : ''));
        });
    }
});
if (split) {
    console.error('');
    console.error('fix those by hand first: every page has to ask for the same file.');
    process.exit(1);
}

const moves = [];
seen.forEach((byVersion, key) => {
    if (!ALL && WANT.indexOf(key) === -1) return;
    const from = [...byVersion.keys()][0];
    const bits = key.split('.');
    moves.push({
        name: bits[0],
        ext: bits[1],
        from,
        to: String(Number(from) + STEP),
    });
});

// a name nobody recognises is a typo, and a typo that bumps nothing is the
// whole problem this file exists to stop
const missing = WANT.filter((w) => !seen.has(w));
if (missing.length) {
    console.error('not an asset on any page: ' + missing.join(', '));
    console.error('known: ' + [...seen.keys()].sort().join(', '));
    process.exit(1);
}

moves.forEach((mv) => {
    console.log('  ' + mv.name + '.' + mv.ext + '   ' + mv.from + ' -> ' + mv.to);
});

if (!GO) {
    console.log('');
    console.log('nothing was changed. pass --yes to go ahead.');
    process.exit(0);
}

let touched = 0;
pages.forEach((page) => {
    let body = text.get(page);
    const before = body;
    moves.forEach((mv) => {
        const find = new RegExp('(^|["\'\\/])' + mv.name + '\\.' + mv.from + '\\.' + mv.ext + '\\b', 'g');
        body = body.replace(find, '$1' + mv.name + '.' + mv.to + '.' + mv.ext);
    });
    if (body !== before) {
        fs.writeFileSync(path.join(DIR, page), body);
        touched++;
    }
});

// The thing the old way could not do: check that it worked.
let wrong = 0;
pages.forEach((page) => {
    const body = fs.readFileSync(path.join(DIR, page), 'utf8');
    moves.forEach((mv) => {
        const stale = new RegExp('(^|["\'\\/])' + mv.name + '\\.' + mv.from + '\\.' + mv.ext + '\\b');
        if (stale.test(body)) {
            console.error('still on the old version: ' + page + ' -> ' + mv.name + '.' + mv.from + '.' + mv.ext);
            wrong++;
        }
    });
});
if (wrong) process.exit(1);

console.log('');
console.log('done, ' + touched + ' page(s) rewritten.');
