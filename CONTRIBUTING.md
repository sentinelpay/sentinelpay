# contributing

read `README.md` first, then `docs/SITE-OVERVIEW.md` if you want the long version.
this file is the short list of things that are easy to get wrong here.

## commits

- commit as `ceemv22 <ceemv22@aol.com>`. some editors and containers reset the git
  identity without warning, so check `git config user.name` before you commit
- commits are not signed: `commit.gpgsign false`
- no trailers, no session links, no attribution lines. the history was rewritten once
  to strip them and it stays clean
- work on `main`. no feature branches, no scratch branches. a branch name is public
  the moment it is pushed and stays in the network graph after deletion
- push with `git push origin HEAD:main`

## house style, all site copy

- **everything lowercase.** headings, buttons, labels, error messages, emails
- **no em-dashes anywhere**, in copy or in docs. use a comma, a full stop or brackets
- plain words over jargon. write the way the existing pages are written
- croatian and german are peers, not afterthoughts

## two rules that break production if forgotten

**1. bump the `?v=` on any css or js you touch.** assets are served with a one-year
immutable cache and the query string is the only thing that busts it. the version
appears in all 11 html files, change it everywhere:

```
corp.css?v=N   i18n.js?v=N   demo-form.js?v=N   style.css?v=N   landing.css?v=N
```

**2. run the translation audit before pushing.** it must report zero missing.

```bash
node tools/i18n-keys.js /tmp/keys.json && python3 tools/i18n-audit.py /tmp/keys.json
```

any new user-facing string needs an entry in both the `hr` and `de` dictionaries in
`api/public/i18n.js`, keyed on the english source text.

## things that will surprise you

**csp hashes are computed at boot** from the inline `<script>` bodies in
`public/*.html`. nothing injected per request may be a script. the noscript notice,
the status banner and the geo language attribute are all plain markup for this reason.

**the fold pages are tuned to the pixel.** `/book-a-demo` and `/start-free-trial` own
exactly one viewport, with five `max-height` tiers and a pinned step height. changing
a padding there moves the partner logo strip out of frame. always re-measure across
viewports after touching them.

**`i18n.js` translates by matching english source text**, walking text nodes and a
short list of attributes. it preserves surrounding whitespace, so a translation that
starts with punctuation will render with a leading space.

**the mailer never resolves quietly.** if a send fails the endpoint returns 500
rather than telling the visitor it worked. every submission is written to stdout
and postgres before any email is attempted.

**the submission payload is encrypted with the row's id as additional
authenticated data.** the row therefore has to exist before the blob can be
sealed to it, which is why the insert is two statements in one transaction. if
you change the shape of what is stored, remember the ciphertext of an old row
still has the old shape: `recent()` reports a row it cannot read rather than
dropping it, and that is on purpose.

**a database outage must never cost a lead.** `record()` writes stdout first,
synchronously, then hands the row to postgres without the request waiting for
it. if that fails the row goes to the fallback file. do not make the form's
response depend on the insert.

## testing

there is no test suite. verification is done with playwright-core against a local
server, measuring real geometry rather than eyeballing screenshots:

```bash
cd api && node index.js          # chromium at /opt/pw-browsers/chromium
```

what is worth re-checking after a change: fold geometry across 10 viewports, the
demo and trial forms end to end, one title frame per language with no english
flash, and zero missing translations.

## working agreements

- the site is in production. it is the only thing customers can see
- the product behind it does not exist yet. copy must not promise what is not built
- gambling operators are refused, by policy, in the form and again on the server
- one rule accepts or refuses a sign-up: the work email and the website on the
  same domain, for everybody, no exemption by provider. the mailbox lists in
  `api/data/` only decide what a submission is tagged with, so a wrong entry
  there costs a misleading tag and never a lost lead. refresh them monthly with
  `node tools/refresh-mail-domains.js` and commit the two files
- secrets never go in the repo, in chat, or in a url that gets pasted anywhere
