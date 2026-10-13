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

    DATABASE_URL=... SP_INDEX_KEY=... node tools/reset-plan.js you@example.com
    DATABASE_URL=... SP_INDEX_KEY=... node tools/reset-plan.js you@example.com --yes

Without `--yes` it prints the current plan and stops. It refuses to run when
`NODE_ENV=production`.

The address is never stored in readable form, so the lookup hashes what you type
with `SP_INDEX_KEY` and matches that. The key has to be the one the environment
uses, or it finds nobody.

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
the link asks for one. It refuses to run on production, where the email works
and is the path to use: when `NODE_ENV=production` and `APP_ENV` is not
`staging` (staging runs with `NODE_ENV=production` too, for its secure cookie).

`--site` is the site that database belongs to. Get it wrong and the link points
at a deployment where the token does not exist.

`--create` lets a new colleague into staging. Signing up sends a code by email,
which staging cannot do, so there was no way to make a second account there.
With `--create` the link is issued for an address that has no account, and
opening it asks for a name and a password and makes one. It only works where
`APP_ENV=staging`:

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

# print fonts

Cuts fixed weights out of the variable fonts in `api/public/fonts` into
`api/print-fonts`, for the PDF report. Chromium writes a variable font into a
PDF as a drawing of every letter, which made a seven page report 933 KB; with
fixed weights it is about 160 KB and the PDF lists its fonts by name.

    pip install fonttools brotli
    python3 tools/print-fonts.py

Run it again when the site's fonts change or the report starts setting a weight
it did not before. A test fails if the report asks for a weight that has no file.
