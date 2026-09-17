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
