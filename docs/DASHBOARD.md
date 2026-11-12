# the dashboard, for whoever picks it up next

this is the way in for someone taking over the dashboard (the app at `/dashboard` and
`/account`). read it once, then read `CLAUDE.md` at the root, which holds the standing
rules. where `CONTRIBUTING.md` disagrees with either, it is older: we no longer work on
`main`, assets are versioned by `tools/bump-assets.js` and not by `?v=`, and the dashboard
copy is in sentence case.

## who does what

| area | owner | files |
| --- | --- | --- |
| the dashboard: every screen, drawer, modal and the way it looks | Mind | `api/public/dash-app.js`, `api/public/dash.css`, `api/public/dashboard-next.html` |
| the engine: screening, risk scores, sanctions lists, the public API's answers | Vibor | `api/screening.js`, `api/sanctions.js` |
| shared: routes, translations, the numbers the Usage screen draws | both, say before you change a lot | `api/index.js`, `api/public/i18n.js`, `api/usage.js` |

`dash-app.js` is one file of about 15,000 lines. Two people changing it at once will
collide, so say in the chat which screen you are on.

## how we work

we build with Claude, one feature at a time.

1. describe the feature the way you want it: which screen, who uses it, what it shows,
   what you can do there. a screenshot of something you like is worth a paragraph.
2. Claude builds it, runs the tests, looks at it in the real app in light, dark and on a
   phone, and sends you screenshots.
3. it goes to staging. you look at it on `staging.sentinelpay.org` and say what to change.
4. repeat until it is right, then the next feature.

a few things make this go faster:

- one feature per request. "the team page, plus billing, plus a new chart" comes back
  slower and worse than three requests.
- say what is wrong, not only that something is: "the email is too far from the picture"
  beats "looks off".
- Claude reads `CLAUDE.md` on its own. you do not have to repeat those rules.

## branches and where things run

| what | branch | address |
| --- | --- | --- |
| staging, where everything is built | `staging` | `staging.sentinelpay.org`, behind Cloudflare Access: ask Vibor to add your email |
| production, what customers see | `main` | `sentinelpay.org` |

Railway deploys each branch on push. Work goes to `staging` and to your working branch,
never to `main`: production moves only when we decide to ship staging to it.

## running it on your machine

you need node 22 and postgres.

```bash
cd api && npm install
export DATABASE_URL='postgres://postgres:<password>@127.0.0.1:5432/sentinelpay'
export SUBMISSIONS_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
APP_ENV=staging PORT=3410 node index.js
```

- `APP_ENV=staging` is what turns the dashboard on. without it `/dashboard` is a 404.
- keep `SUBMISSIONS_KEY` the same between runs, or the accounts you made can no longer
  be read.
- there is no mail locally. sign up at `http://127.0.0.1:3410/?signin=create` and the
  six-digit code is in the newest `sentinelpay-mail-*.html` in your temp folder.
- `node tools/seed-usage.js <org-slug> --yes` fills an organisation with sample checks,
  so charts and tables have something to draw, and `--clear` takes them out again. it
  refuses to run against production.
- the server limits each address to 300 API requests a minute. clicking around fast in
  development can reach it; restart the server to clear it.

## where things are

| file | what it holds |
| --- | --- |
| `api/public/dashboard-next.html` | the page shell: almost empty, `dash-app.js` draws everything |
| `api/public/dash-app.js` | every screen, the navigation, modals, drawers, live updates |
| `api/public/dash.css` | all of the dashboard's styling, light and dark |
| `api/public/i18n.js` | the Croatian and German for every string, keyed on the English |
| `api/index.js` | the routes: the pages and every `/v1/...` endpoint the dashboard calls |
| `api/orgs.js`, `invites.js`, `tokens.js`, `accounts.js`, `billing.js` | what those endpoints do with the database |
| `api/test/` | the tests. `sample.test.js` checks the dashboard's source |

### screens

each address is drawn by one function in `dash-app.js`. find it with
`grep -n "function viewTeam" api/public/dash-app.js`, since line numbers move.

| address | function |
| --- | --- |
| `/dashboard/org/<slug>` | `viewOverview` |
| `/dashboard/org/<slug>/projects` | `viewProjects` |
| `/dashboard/org/<slug>/checks` | `viewChecks` |
| `/dashboard/org/<slug>/team` | `viewTeam` |
| `/dashboard/org/<slug>/usage` | `viewUsage` |
| `/dashboard/org/<slug>/billing` | `viewBilling` |
| `/dashboard/org/<slug>/settings` | `viewOrgSettings` |
| `/dashboard/org/<slug>/tokens` | `viewTokens` |
| `/dashboard/organisations` | `viewOrgs` |
| `/account/preferences` | `viewPreferences` |
| `/account/security` | `viewSecurity` |
| `/account/logs` | `viewLogs` |

`paintCanvas()` decides which one to draw and `NAV` near the top of the file is the
sidebar. a new screen needs both.

### parts every screen is built from

use these rather than writing a new one. most of the look comes from them.

| helper | what it is |
| --- | --- |
| `t('English text')` | the text in the reader's language |
| `fill('{n} members', { n: 3 })` | the same, with values put in |
| `pageHead`, `sectionTitle`, `sectionNote` | a screen's heading, a section's heading and the line under it |
| `modalShell(title, sub)` | a modal, with its backdrop, close button and focus handling |
| `drawer(title)` | the panel that slides in from the right, as on the team and token screens |
| `wideBtn`, `rowBtn` | a full-width button, a small button in a table row |
| `rowMenu(label, items)` | the ⋮ menu at the end of a row |
| `tag(text, kind)` | a pill: `ok`, `bad`, `mid`, `off`, `inv` |
| `dimCell`, `factsBox` | a table cell with its own heading for narrow screens |
| `toast(text, 'good')` | the short message at the bottom |
| `postJson(url, body)` | a POST that turns an error answer into a thrown error with its message |
| `confirmFirst(run)` | asks for the password again before something that hands out access |
| `onLive(...)` | live updates from the server, so a change made in one tab shows in another |
| `avatarArt(seed)` | the sentinel pictures |
| `icon(name)` | the icon set |

## the rules that come up most

all of these are in `CLAUDE.md`. these are the ones a new person trips on.

- **build ahead.** inside the dashboard a screen can be drawn before what is behind it
  exists. say in the commit which parts have nothing behind them yet.
- **every string goes through `t()`**, and every new string gets a Croatian and a German
  entry in `i18n.js`, next to `"Remove app"` in each dictionary. the audit below fails
  otherwise.
- **monospace is for wallet addresses only.** numbers, dates, counts and labels use the
  normal face, and numbers beside each other use the same face and weight.
- **look at it before saying it works**: light, dark and a phone. the tests do not catch
  a misplaced icon.
- **grep before naming a class.** `.use-grid` and `.use-cell` were already taken once and
  silently won.
- **the dashboard scrolls inside a box**, so `href="#section"` does not move it. links
  scroll themselves.
- **copy should not read as written by a machine**: no lists of three, no "not X but Y",
  real numbers over vague words.
- **`sample.test.js` checks the source of `dash-app.js` and `dash.css`.** when you change
  something on purpose and a test that describes the old behaviour fails, change the
  test to describe the new behaviour, in the same commit.

## shipping a change

in this order, every time:

```bash
cd api && npm test                                   # needs DATABASE_URL and SUBMISSIONS_KEY
node tools/i18n-keys.js /tmp/keys.json && python3 tools/i18n-audit.py /tmp/keys.json
                                                     # must say MISSING TOTAL: 0
node tools/bump-assets.js dash-app.js dash.css --yes # every css or js file you changed
git commit                                           # what changed and why it was wrong before
git push origin HEAD:staging                         # and to your working branch
```

`bump-assets.js` gives each changed file a new number in every page that loads it. skip
it and browsers keep the old file.

on a brand new database the first `npm test` fails a handful of tests, because the test
files run side by side and race to create the tables. run it again: from the second run
on it is green.

## two things the server does that you will not see in the files

- **scripts and sheets are sent without their comments** (`api/slim.js`). what the
  browser gets is shorter than the file; that is expected.
- **the dictionary is sent one language at a time** (`api/i18n-split.js`). you still
  write every translation in `i18n.js`.
