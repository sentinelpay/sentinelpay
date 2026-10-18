# i18n audit

Finds user-visible english that never reaches the dictionary. The site translates
at runtime by matching english source text, so anything the matcher cannot see
silently stays english. This checks all three places text comes from:

- html text nodes
- html attributes that render or are read aloud: `placeholder`, `alt`, `title`, `aria-label`
- string literals in our js that reach the user: returned validation messages,
  `textContent` assignments, toast and alert calls, and anything wrapped in `t('…')`

Run from the repo root:

    node tools/i18n-keys.js /tmp/i18n-keys.json
    python3 tools/i18n-audit.py /tmp/i18n-keys.json

Exits with a per-file list and a total. Zero means every visible string has a
croatian and german entry.

# reset plan

Puts an account back to having no plan, so `/dashboard` sends it to
`/choose-a-plan` again. For trying that path more than once.

    DATABASE_URL=... SUBMISSIONS_KEY=... node tools/reset-plan.js you@example.com
    DATABASE_URL=... SUBMISSIONS_KEY=... node tools/reset-plan.js you@example.com --yes

Without `--yes` it prints the current plan and stops. It runs only on a database
marked staging or development (see "which database this is" below).

The address is never stored in readable form, so the lookup hashes what you type
with the index key (`SUBMISSIONS_INDEX_KEY`, or one derived from `SUBMISSIONS_KEY`)
and matches that. The key has to be the one the environment uses, or it finds
nobody.

An address listed in `DEV_PLAN_EMAILS` is granted enterprise again on the next
dashboard load, because that grant is re-applied on every visit. Take it out of
the variable and restart before resetting, or this will not hold. The tool warns
when it sees the address there.

# reset link

Prints a password reset link instead of mailing it, for an environment with no
mail provider. Staging has none, so without this nobody locked out of a staging
account can get back in.

    DATABASE_URL=... SUBMISSIONS_KEY=... node tools/reset-link.js you@example.com \
        --site https://staging.sentinelpay.org

It writes the row the normal forgot-password path writes: same table, same
hashed token, same expiry, same single use. Nobody types a password anywhere --
the link asks for one. It runs only on a database marked staging or development;
on production the email works and is the path to use.

`--site` is the site that database belongs to. Get it wrong and the link points
at a deployment where the token does not exist.

`--create` lets a new colleague into staging. Signing up sends a code by email,
which staging cannot do, so there was no way to make a second account there.
With `--create` the link is issued for an address that has no account, and
opening it asks for a name and a password and makes one. It only works on a
database marked staging:

    railway run --environment staging node tools/reset-link.js them@example.com \
        --create --site https://staging.sentinelpay.org

`DATABASE_URL` and `SUBMISSIONS_KEY` have to be the pair the site runs on. The
address is stored hashed, so the wrong key hashes it to something nobody has and
the tool reports no such account rather than a key mismatch -- the message says
so, because the two look identical from here.

Unlike the public endpoint, this refuses an address with no account. The public
one cannot, or it would tell the world who has an account; but `finishReset`
creates an account when none exists, so here a typo would quietly make a second
empty one instead of letting you back into the one you meant.

# taking two-factor off an account

An account holds up to three authenticator apps and no recovery codes; the
security page asks for a second while there is one. A person who has lost every
device with an app on it writes to support, and once support
is satisfied the person writing owns the account -- on a call, from the address
on the account, and confirmed by the owner of their organisation when they are
not the owner -- this takes two-factor off:

    DATABASE_URL=... SUBMISSIONS_KEY=... node tools/remove-2fa.js them@example.com
    DATABASE_URL=... SUBMISSIONS_KEY=... node tools/remove-2fa.js them@example.com \
        --yes --by "your name" --why "ticket 1042, call with the owner"

Without `--yes` it lists the apps on the account and does nothing. With it,
every app comes off, two-factor is off, every session the account has is ended,
and the audit trail records `2fa-off-by-support` under the name given in `--by`,
with the reason given in `--why`. It will not run without both. The person then signs in with their
password and adds an app again.

It runs against production: that is where people lose phones.

# which database this is

The tools that write invented or destructive things (`wipe-orgs`, `reset-plan`,
`seed-usage`, `seed-staging`, `reset-link`, `snapshot-to-staging`) ask the
database which environment it belongs to, not the shell. The server writes that
into a one-row `app_env` table the first time it starts on a database:
`staging` where `APP_ENV=staging`, otherwise what Railway calls the
environment, otherwise `production` for a production build and `development`
for anything else. A server that finds a different mark logs it as serious.

So a shell that happens to hold production's `DATABASE_URL` cannot seed, wipe
or print reset links into it, whatever `NODE_ENV` says, and there is no
override variable. `snapshot-to-staging` needs a target marked `staging` and a
source that is not. A database nobody has started a server on is marked as
nothing, and the tools refuse it.

# print fonts

Cuts fixed weights out of the variable fonts in `api/public/fonts` into
`api/print-fonts`, for the PDF report. Chromium writes a variable font into a
PDF as a drawing of every letter, which made a seven page report 933 KB; with
fixed weights it is about 160 KB and the PDF lists its fonts by name.

    pip install fonttools brotli
    python3 tools/print-fonts.py

Run it again when the site's fonts change or the report starts setting a weight
it did not before. A test fails if the report asks for a weight that has no file.
