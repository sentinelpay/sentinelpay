# Working on sentinelpay

Standing rules. These were said once and should not have to be said again.

## This is staging, and staging is where things get built

The dashboard runs on staging. Development happens in the open, in the real
product, in front of the real data. Building a screen before the thing behind
it exists is **the method, not a mistake**: the screen is how we decide what to
build next, and it is cheaper to look at a metric and then write its counter
than to write a counter and then guess at how it should read.

So, concretely:

- Build the whole surface and let the parts fill in. A grid of sixteen metrics
  where eleven have no counter yet is a correct grid.
- Do not argue the product should only show what is shipped. Do not say "a link
  is a promise there is more there". Do not wait for a backend before drawing
  the front.
- Do not ask whether to build ahead. Build it, say plainly in the reply which
  parts have nothing behind them yet, and move on.

The one place this flips is **text aimed at people outside the company** --
LinkedIn, the pricing page, the README, anything a customer or a candidate
reads as a description of what exists today. Those claim only what is true.
Inside the dashboard, build ahead.

## Writing

Copy must not read as AI. The tells, in order of how often they show up:

- Triplets. Three clauses, three examples, three adjectives.
- "Not X, but Y."
- Em-dashes as a rhythm. Use a colon, a full stop, or restructure.
- Balanced hedging that lands on no position.
- Short sentences that sound profound and say nothing.
- Perfectly even structure: every paragraph the same length and shape.
- No concrete detail. Real numbers, real names, real specifics instead.

Take a position. Vary sentence length. Say the thing.

## The product

- The monospace face is **for addresses and nothing else**. Tickers, dates,
  counts, labels all use the normal face.
- Every number on a screen uses the same face and weight as the numbers beside
  it. The display face is for headings.
- Before claiming a UI change works, **run the real app and look at it** --
  both light and dark. Tests do not catch a misplaced glyph or a collided class.
- CSS class names collide. `.use-grid` and `.use-cell` were already taken and
  silently won. Grep before naming.
- The dashboard scrolls inside a box, not as a document, so `href="#id"` does
  not move it. Links scroll themselves.

## Shipping

Every change, in order:

1. `cd api && npm test` (needs `DATABASE_URL` and a 32-byte base64
   `SUBMISSIONS_KEY`)
2. `node tools/i18n-keys.js /tmp/keys.json && python3 tools/i18n-audit.py /tmp/keys.json`
   -- must read `MISSING TOTAL: 0`, and new keys must appear exactly twice
   (hr and de), never duplicating an existing one
3. `node tools/bump-assets.js <changed files> --yes`
4. Commit, then push to the working branch **and** to `staging`

Commit messages say what changed and why it was wrong before. No model names,
no tool names, anywhere in the repo.
