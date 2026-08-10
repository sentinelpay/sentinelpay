<p align="center">
  <img src="api/public/logo.svg" alt="sentinelpay" width="200"/>
</p>

<p align="center">
  <strong>pre-deposit wallet risk scoring for crypto treasuries</strong>
</p>

<p align="center">
  <a href="https://sentinelpay.org">sentinelpay.org</a>
  ·
  <a href="https://sentinelpay.org/start-free-trial">start a free trial</a>
  ·
  <a href="https://sentinelpay.org/book-a-demo">book a demo</a>
  ·
  <a href="https://x.com/sentinelpayorg">@sentinelpayorg</a>
</p>

---

**this repository is the public site at sentinelpay.org**: the marketing pages, the blog, the legal pages, and the two endpoints behind the sign-up forms. the scoring api and the risk engine are separate services and live in their own repositories.

the site is in production. it serves three languages, renders per request, ships a content security policy with no `unsafe-inline` for scripts, and never loses a form submission even when email delivery fails.

## what is here

```
api/
  index.js            server: routing, rendering, security headers, form endpoints
  mailer.js           every outbound email, in one place
  submissions-log.js  append-only record of everything the forms receive
  public/             11 pages, 3 stylesheets, 4 scripts, all assets
content/              blog author data
docs/                 site overview, written for people joining the project
help-center/          help.sentinelpay.org, a separate small service
tools/                the translation audit that gates every release
```

no build step, no framework, no bundler. the pages are html on disk; the server adds what only it can know.

### branches

| branch | what it is |
| --- | --- |
| `main` | the site, deployed on every push |
| `dev` | an older line of work, last touched june 2026 |
| `legacy/app-snapshot` | the application this repository used to hold, before it was stripped down to the site: prisma schema, supabase auth, the dashboard. kept because it is the only copy, and worth reading before rebuilding any of it |

## the site

| page | url |
| --- | --- |
| homepage | `/` → `/en`, `/hr` or `/de` |
| free trial | `/start-free-trial` |
| book a demo | `/book-a-demo` |
| blog | `blog.sentinelpay.org`, four articles |
| legal | `/privacy-policy`, `/terms-of-service` |
| help centre | `help.sentinelpay.org` |

## three languages, one source of truth

english, croatian and german. **592 translated strings per language**, keyed on the english source text rather than on invented ids, so a page and its dictionary can never drift apart silently.

- **the homepage has real addresses**: `/en`, `/hr`, `/de`, each with a self-referencing canonical and `hreflang` alternates. the bare domain resolves a language and redirects to it, 302 and never cached, because the answer depends on the visitor.
- **first visit picks a language from the visitor's country**, resolved server-side from `cf-ipcountry`. the guess is never written to the cookie, so it cannot harden into a stored preference.
- **tab titles are translated before first paint.** an inline script in `<head>` sets the title from the cookie, so no page ever shows an english title and then swaps it. measured at one title frame per language.
- **every translated article can be read in the original.** croatian and german readers get a pill under the byline that flips one article back to the english it was written in, headline, body and tab title together, while the site stays in their language. english readers are already reading the original, so they never see the button.
- **`tools/i18n-audit.py` refuses to pass on any untranslated string**, including strings written at runtime by javascript. it currently reports zero missing.

## security

| control | how |
| --- | --- |
| content security policy | every inline script is hashed at boot and listed, so `script-src` needs no `unsafe-inline`. `script-src-attr 'none'` blocks inline event handlers. styles still allow it |
| clickjacking | `frame-ancestors 'none'` |
| transport | hsts, two years, `includeSubDomains`, preload |
| bot defence | cloudflare turnstile on both forms, plus a honeypot field |
| origin lockdown | a secret injected by a cloudflare transform rule; with `CF_ORIGIN_STRICT` the origin answers 403 to anything that did not come through cloudflare |
| rate limits | 300/min per ip site-wide, 5/hour for demo requests, 3/hour for trial sign-ups |
| ip trust | `cf-connecting-ip` is trusted only when the request proves it came through our own cloudflare, so a forged header cannot buy a fresh rate-limit bucket |
| input | 10kb body cap, parameter pollution guard, strict field validation, work email and website required to be on one domain |
| headers | `nosniff`, `no-referrer`, and a permissions policy that turns off every sensor api |

the site works with javascript switched off far enough to say so: the loader stays, and underneath it a message in the visitor's language links to instructions for their exact browser.

## forms

| form | who gets an email | logged |
| --- | --- | --- |
| homepage, `/book-a-demo` | the team, at `MAIL_TO` | yes |
| `/start-free-trial` | the applicant, in their own language, plus a copy to the team | yes |

**one rule decides whether a sign-up is accepted: the work email and the website must be on the same domain.** subdomains either way are fine. it applies to every address from every provider, with no exemptions, and it is the whole of the automatic check that stands in for reading a form by hand. gambling operators are declined by policy, in the form and again on the server.

what the provider is does not decide anything. it decides what the submission is **tagged** with, and a person takes it from there:

| tag | what it means |
| --- | --- |
| `free-email` | the address is on a consumer mailbox: gmail, outlook, aol, net.hr |
| `disposable-email` | a throwaway service, the kind built to stop existing |
| `website-is-a-mailbox` | the site they gave is a mail provider rather than a company |
| `domain-mismatch` | the pair disagrees. this one is a refusal, not a tag |

a tagged submission puts an amber band at the top of the notification with the reason in words, prefixes the subject with `review:`, and stores the tags in a column of their own so `GET /v1/submissions?flagged=1` answers "what needs a look" without decrypting every row.

### the mailbox lists

`api/data/free-email-domains.txt` and `api/data/disposable-email-domains.txt`, around thirteen thousand domains, read once at boot. the upstream free list contains the whole disposable list, so the two are separated when they are written: a domain is one or the other, never both, and a tag therefore says exactly one thing.

refresh them monthly:

```bash
node tools/refresh-mail-domains.js
```

it rewrites both files, prints what was added and removed, and refuses to write a suspiciously small download over a good one. croatian consumer providers are not carried upstream, so they live in the script and survive every refresh. the files are plain sorted text, one domain per line, so a month of drift reads as an ordinary diff.

if a domain is missing or wrong, nothing is accepted or refused that would not have been anyway. the cost is a submission that arrives without a tag, or with one it did not deserve.

every submission is written to stdout **and** to postgres before any email is attempted, so a bounce, an outage or a missed inbox never costs a lead. emails are sent through resend from `noreply@sentinelpay.org`, in the site's own dark house style, with a plain-text alternative.

## the submission store

leads live in postgres, not on the container's disk. everything a form collects belongs to somebody who is not a customer yet, so the table is built to be worth less than it looks if it ever leaves us.

| control | how |
| --- | --- |
| encryption at rest | the personal fields go into one aes-256-gcm blob, sealed with the row's own id as additional authenticated data, so a ciphertext cannot be moved between rows. a copy of the database without `SUBMISSIONS_KEY` is a copy of nothing |
| lookups without the data | the work email is stored only as an hmac-sha256 blind index under a separate key, so we can find or erase somebody's rows without their address being in the table |
| transport | tls is required on any host that is not on the private network, and `sslmode=disable` in the url is refused rather than honoured |
| injection | every value is a bound parameter. there is no string concatenation anywhere near a query |
| blast radius | pool capped, ten second statement timeout, and the row is written inside one transaction so a half-written lead is impossible |
| retention | rows delete themselves after `SUBMISSIONS_RETENTION_DAYS`, swept at boot and once a day |
| erasure | `POST /v1/forget` removes every row for an address, matched through the blind index |
| never losing a lead | a line to stdout first, always, then the row. if the database is unreachable the row falls back to `LOG_DIR/submissions-YYYY-MM.jsonl` and the visitor still gets a 200 |
| nothing personal in the platform log | the stdout line is `ref=… kind=… outcome=… country=… flags=…` and no more. a name, an address or an ip printed there ends up in the hosting provider's log store, which we cannot scope, cannot set a retention on and cannot delete a single line out of when somebody exercises their right to erasure. the `ref` is random, meaningless alone, and stored on the row, so a log line can still be tied back to a submission while looking at both |
| the fallback file follows the same rules | monthly files past the retention window are deleted daily, and `POST /v1/forget` rewrites them without the matching lines. a promise kept about one copy and not the other is not a promise |

generate the keys once, and keep them somewhere other than the database backups:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # SUBMISSIONS_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # SUBMISSIONS_INDEX_KEY
```

**losing `SUBMISSIONS_KEY` loses the leads.** that is what it is for. the index key can be derived from it, so it is optional, but a separate one is better: whoever holds the index then cannot test guesses against the ciphertext.

the app only needs to read, write and delete its own table. if you are creating the role by hand rather than letting the provider do it:

```sql
CREATE ROLE sentinelpay_app LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE sentinelpay TO sentinelpay_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON submissions TO sentinelpay_app;
GRANT USAGE ON SEQUENCE submissions_id_seq TO sentinelpay_app;
```

## accounts

creating an account is two steps, and the account only exists after the second one.

1. `POST /v1/auth/register` takes the name, the work email, a password and the consent tickbox. it hashes the password, writes a **pending** row, and emails a six digit code. nothing that can be logged into has been created.
2. `POST /v1/auth/verify` takes the address and the code. it checks the code, then writes the user, in one transaction.

`POST /v1/auth/resend` sends a fresh code for a sign-up already in progress. signing in is not built yet: the log in form says so.

what is deliberate:

| control | how |
| --- | --- |
| the address is proved | a code that only the inbox receives, so an address nobody can read the mail for never becomes an account |
| the code is not stored | only an hmac of it, bound to the address it was sent to, compared in constant time. a copy of the table verifies nothing |
| the password is not stored | scrypt (n=32768, r=8) with a per-user salt, hashed in the process before the pending row is written. argon2id is the better hash and the only reason it is not here is that it is a native module |
| the address is not readable | encrypted like the submissions, found through the same blind index |
| guessing | five wrong codes end the code, twenty verify attempts an hour per ip. a million answers, and nothing like enough tries |
| mailbombing | five codes an hour per address and sixty seconds between them, enforced on the row rather than the ip, plus five registers and five resends an hour per ip |
| enumeration | registering an address that already has an account gets the same reply as one that does not. the difference goes to the inbox, where only its owner can read it. an unknown address asked to resend is answered as though a code went out |
| replay | a code is consumed inside the transaction that writes the user, so two requests with the same code cannot make two accounts |
| expiry | codes last `SIGNUP_CODE_TTL_MIN` minutes, and unfinished sign-ups are swept every six hours |
| retention | an account with no sign-in for `ACCOUNT_RETENTION_MONTHS` is deleted on the same sweep. there is no sign-in yet, so the clock runs from when the account was made and starts measuring properly the day signing in exists, without a migration |
| erasure | `POST /v1/forget` removes the account and anything half-made under the same address |
| when no code arrives | `GET /v1/account-status?email=…` behind `ADMIN_TOKEN` says whether the address already has an account, whether a sign-up is in progress, how many codes went out and how many wrong guesses are left. the form cannot answer that without telling every stranger who has an account here, so the answer lives behind the token |

there are no accounts without `DATABASE_URL` and `SUBMISSIONS_KEY`. registration answers "not available" rather than falling back to a file: a lead in a file is a lead, an account in a file is a security problem.

the tables are `users` and `signup_codes`, created on boot. a hand-made role needs them too:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON users, signup_codes TO sentinelpay_app;
GRANT USAGE ON SEQUENCE users_id_seq TO sentinelpay_app;
```

## contributing

`CONTRIBUTING.md` is the short list of things that are easy to get wrong here: the
house style, the two rules that break production if forgotten, and the parts of this
codebase that behave in a way you would not expect.

## running locally

```bash
cd api && npm install && npm run dev
```

that is the whole setup. with no `RESEND_API_KEY` the mailer writes each message to a preview file instead of sending, so the forms are testable offline.

### environment

nothing is required to boot. everything below changes behaviour when set.

| variable | effect |
| --- | --- |
| `RESEND_API_KEY` | enables outbound email. in production its absence is a hard failure, never a silent one |
| `MAIL_TO`, `MAIL_FROM` | where form notifications land and who they come from |
| `TRIAL_APP_URL` | adds the "open your trial" button to the welcome email |
| `TURNSTILE_SECRET_KEY` | enforces the bot challenge. without it the forms accept unverified submissions |
| `CF_ORIGIN_SECRET`, `CF_ORIGIN_HEADER` | the shared secret a cloudflare transform rule injects |
| `CF_ORIGIN_STRICT` | extends that guard to every route, so the origin url is useless on its own |
| `ALLOWED_ORIGINS` | cors allowlist. a wildcard is refused in production |
| `DATABASE_URL` | postgres connection string. without it submissions fall back to the filesystem, which a redeploy wipes |
| `DATABASE_CA_CERT` | the provider's ca certificate, so the tls chain is verified rather than merely encrypted |
| `DATABASE_POOL_MAX` | connection pool ceiling, 8 by default |
| `SUBMISSIONS_KEY` | 32 bytes base64. encrypts the personal fields at rest. without it they are stored in the clear and the log says so at boot |
| `SUBMISSIONS_INDEX_KEY` | 32 bytes base64 for the blind index. derived from `SUBMISSIONS_KEY` when unset |
| `SUBMISSIONS_RETENTION_DAYS` | how long a lead is kept, 365 by default |
| `SIGNUP_CODE_TTL_MIN` | how long a verification code is good for, 15 by default, clamped to 5 to 60 |
| `ACCOUNT_RETENTION_MONTHS` | how long an account survives without a sign-in, 24 by default |
| `LOG_DIR` | the fallback submission log, used only when there is no database or it is unreachable |
| `ADMIN_TOKEN` | enables the operations endpoints below |
| `CSP_STRICT` | set to `false` only to fall back to `unsafe-inline` in an emergency |

### status banner

a running incident is announced above the nav on every page, and the form submit is
disabled while it stops mail reaching us, so nobody is walked through four steps into
a dead end. env-driven, so it goes up and comes down without a deploy: unset
`STATUS_MESSAGE` and the banner, the attributes and the disabling all disappear.

| variable | effect |
| --- | --- |
| `STATUS_MESSAGE` | a preset key, or free text. empty or unset hides everything |
| `STATUS_LINK`, `STATUS_LINK_TEXT` | optional link. a preset supplies its own label |
| `STATUS_BLOCKS_MAIL` | `true` while submissions cannot reach us |
| `STATUS_MESSAGE_HR`, `STATUS_MESSAGE_DE` | croatian and german text for a custom message |
| `STATUS_LINK_TEXT_HR`, `STATUS_LINK_TEXT_DE` | the same, for a custom button label |

presets are written properly in all three languages and need nothing else set:
`email-outage` · `degraded` · `maintenance`. free text shows as typed in every
language unless the per-language variables are given: machine translating whatever
someone types would produce exactly the stiff wording the rest of the site avoids.

`STATUS_BLOCKS_MAIL=true` disables every form's submit button, in the markup and not
only visually, and makes the forms' mailto fallback inert. the support and privacy
addresses in the footer and the legal pages stay clickable on purpose: they are the
contact routes those pages are obliged to offer.

### operations

with `ADMIN_TOKEN` set:

```
GET  /v1/submissions?limit=50&kind=trial   read the submission log back
GET  /v1/submissions?flagged=1             only the ones a person should look at
GET  /v1/mail-status                       what the mailer and the database are configured with
POST /v1/mail-status?send=1                send a test message and report the provider's answer
POST /v1/forget   {"email":"…"}            erase every row belonging to an address
```

pass the token as a header, not a query string, because a query string is written to every access log and proxy log it passes through:

```bash
curl -H "x-admin-token: $ADMIN_TOKEN" https://sentinelpay.org/v1/submissions
```

`?token=…` still works so nothing that already relies on it breaks. all four answer with the ordinary 404 page when the token is missing or wrong, so their existence is not discoverable. the comparison is timing-safe, and the two that return personal data are `no-store`.

## releasing

deployed on railway from the dockerfile at the repository root, behind cloudflare. pushing to `main` deploys.

two rules matter:

1. **bump the `?v=` on any stylesheet or script you touch.** assets are served with a one-year immutable cache; the query string is the only thing that busts it.
2. **run the translation audit before pushing.** it must report zero missing.

```bash
node tools/i18n-keys.js /tmp/keys.json && python3 tools/i18n-audit.py /tmp/keys.json
```

html is never cached hard, so copy changes go live with the deploy.

## stack

| layer | tech |
| --- | --- |
| runtime | node 22, express 5 |
| data | postgres, encrypted at rest by the application |
| email | resend |
| edge | cloudflare: dns, waf, turnstile, geo, email routing |
| hosting | railway, docker |
| dependencies | seven, all direct. no framework, no bundler, no build |

## license

mit
