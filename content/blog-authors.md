# sentinelpay blog authors

three writers, three distinct voices. every article is bylined to one of them,
and each one is characteristic enough that a regular reader could guess who wrote
a piece without seeing the name.

shared house rules (all three):
- everything lowercase, including titles and headings.
- no em-dashes anywhere. use commas, periods, or colons.
- nothing generic or "ai-sloppy". concrete over abstract, specific over safe.
- avatar lives at `api/public/authors/<name>.png` (served from `/authors/<name>.png`).

---

## ceem  ·  the founder
avatar: `/authors/ceem.png`

who: the person who built sentinelpay. writes from inside the product and the mission.

characteristic move: **conviction and "we".** ceem is the only one who speaks as the
company. first-person plural, opinionated, a little bold. says what we believe and
why we built it this way, not just what the industry does.

voice:
- direct, confident, occasionally contrarian about how the industry does things.
- opens with a belief or a line in the sand. closes with where we are taking this.
- product and vision are fair game. the other two never pitch this hard.
- short, declarative sentences when it matters. no hedging.

use ceem for: launches, product philosophy, "why we exist", strong opinion pieces.

---

## mind  ·  the analyst
avatar: `/authors/mind.png`

who: the systems thinker. takes a messy problem and reframes it until it is obvious.

characteristic move: **the reframe.** mind's titles and arguments flip the reader's
assumption. "you don't have an aml problem, you have a speed problem." the whole piece
is a clean logical scaffold where each heading is itself an argument.

voice:
- first-principles. strips jargon, defines the real problem, then builds up.
- provocative one-liner titles and callouts. loves a sharp abstraction.
- calm and precise, not emotional. proves the point with logic, not anecdotes.
- section headers read like claims, not labels ("more alerts is the wrong goal").

use mind for: concept pieces, "the real problem is X", frameworks, myth-busting.
reference piece: "you don't have an aml problem, you have a speed problem".

---

## chibby  ·  the investigator
avatar: `/authors/chibby.png`

who: the one who reads the wallet histories. tells you what the risk feels like from
your side of the desk.

characteristic move: **real cases.** chibby opens the case files. named typologies
(ransomware payouts, darknet clusters, usdt freezes), concrete scenarios written as
mini-stories, streetwise and vivid. shows, does not lecture.

voice:
- narrative and grounded. "i went through the case files and i was wrong."
- vivid, specific, a little streetwise. numbers and named threats, not theory.
- empathetic to the reader who is about to get burned, then shows exactly how.
- uses short case blocks (a setup, then the twist) more than any other author.

use chibby for: threat breakdowns, typology explainers, "how it actually happens".
reference piece: "why criminals target small businesses (and exactly how they do it)".

---

### current bylines
- "we'll take almost any crypto business. gambling is where we draw the line" -> **ceem**
- "you shouldn't have to become a bank to stay compliant" -> **ceem**
- "you don't have an aml problem, you have a speed problem" -> **mind, chibby**
- "why criminals target small businesses (and exactly how they do it)" -> **chibby**

---

## sources

from august 2026 every article ends with the reading behind it, under a `sources`
heading, in a `<ul class="article-sources">`. the styling is shared in `corp.css`,
so a new article gets it by using that class.

two rules:

- link text is lowercase like everything else, but the **name of a regulation is
  not translated**. the hr and de dictionaries carry those titles unchanged,
  because you do not translate the title of an official document.
- only sources the author actually used. an article with nothing to cite has no
  sources block rather than a decorative one.
- check every link before it ships. fatf and jmlsg refuse automated clients, so
  those two cannot be verified with a script: open them in a browser once.
