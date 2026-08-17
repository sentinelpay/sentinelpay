"""Full i18n coverage audit.

The old check only walked static HTML text nodes, which is exactly why the
validation messages stayed english: they are written by javascript at runtime.
This looks at every source of user-visible text we have:

  1. HTML text nodes
  2. HTML attributes that render or are read aloud: placeholder, alt, title, aria-label
  3. string literals in our js that reach the user: returned validation messages,
     textContent assignments, toast/alert calls
"""
import re, json, os, sys, html as htmlmod

PUB = 'api/public'
KEYS = set(json.load(open(sys.argv[1], encoding='utf-8')))

SKIP_EXACT = {
    'sentinelpay', 'support@sentinelpay.org', 'privacy@sentinelpay.org',
    'yourcompany.com', 'sentinelpay.org',
    # author bylines, alone or together: names, not copy
    'ceem', 'mind', 'chibby', 'mind, chibby', 'ceem, mind, chibby',
}
SKIP_RE = re.compile(r'^[\W\d\s]*$')          # punctuation / numbers only
# an invented wallet address in the hero illustration. it is data, not copy, and
# translating it would be meaningless in any language.
SKIP_RE_LIST = [
    re.compile(r'^0x[0-9a-f]{4}_[0-9a-f]{3}$'),
    # amounts on the chips in the hero illustration: a number and a ticker. the
    # ticker is the same in every language, and the number is not copy.
    re.compile(r'^[\d.,]+[km]? [A-Z]{3,5}$'),
]
LOGOS = {'elektromaterijal', 'racunala.hr', 'traveler', 'majice.hr', 'futura'}


def report(kind, path, strings):
    miss = []
    seen = set()
    for s in strings:
        s = re.sub(r'\s+', ' ', s).strip()
        if not s or s in seen or s in KEYS or s in SKIP_EXACT or s in LOGOS:
            continue
        if any(r.match(s) for r in SKIP_RE_LIST):
            continue
        if SKIP_RE.match(s) or not re.search(r'[a-zA-Z]{2}', s):
            continue
        seen.add(s)
        miss.append(s)
    if miss:
        print('%-14s %-24s %d' % (kind, path, len(miss)))
        for m in miss:
            print('    ', json.dumps(m, ensure_ascii=False))
    return len(miss)


total = 0
for f in sorted(x for x in os.listdir(PUB) if x.endswith('.html')):
    raw = open(os.path.join(PUB, f), encoding='utf-8').read()
    body = re.sub(r'<script[\s\S]*?</script>', '', raw, flags=re.I)
    body = re.sub(r'<style[\s\S]*?</style>', '', body, flags=re.I)
    body = htmlmod.unescape(body)
    total += report('html-text', f, re.findall(r'>([^<>]+)<', body))
    attrs = []
    # data-mail-* is the subject and body a mailto link is built from: copy the
    # reader sees, just assembled at runtime rather than rendered in place.
    for a in ('placeholder', 'alt', 'title', 'aria-label', 'data-mail-subject', 'data-mail-body'):
        attrs += re.findall(a + r'="([^"]*)"', body)
    total += report('html-attr', f, attrs)

for f in sorted(x for x in os.listdir(PUB) if x.endswith('.js')):
    src = open(os.path.join(PUB, f), encoding='utf-8').read()
    if f in ('i18n.js', 'i18n-title.js'):
        continue                                   # the dictionary itself
    if f in ('inbox.js',):
        # the staff inbox. english on purpose and not translated: it is an
        # internal tool for three people who all read english, and the three
        # dictionaries are for the site visitors see. it is skipped here rather
        # than half translated, so a real miss on a real page still stands out.
        continue
    lits = []
    lits += re.findall(r"return\s+'((?:[^'\\]|\\.)*)'", src)
    lits += re.findall(r"textContent\s*=\s*'((?:[^'\\]|\\.)*)'", src)
    lits += re.findall(r"\.show\(\s*'((?:[^'\\]|\\.)*)'", src)
    lits += re.findall(r"alert\(\s*'((?:[^'\\]|\\.)*)'", src)
    # a string wrapped in t('…') is looked up at runtime, so it still has to be
    # in the dictionary. check those too rather than trusting the wrapper.
    lits += re.findall(r"[^a-zA-Z_.]t\(\s*'((?:[^'\\]|\\.)*)'", src)
    # strings sitting in a config object reach the user too. the step headings did,
    # and none of the patterns above saw them because they are neither returned nor
    # assigned. take every literal that reads like a sentence and drop the ones that
    # are plainly code: selectors, class and event names, urls, attributes.
    # prose starts with a letter and carries no code punctuation. that alone
    # separates copy from selectors, regex fragments and concatenation stubs.
    CODEY = re.compile(r'^[^a-zA-Z]|[\\\[\]{}<>=()]|^https?:|\bdata-|\baria-')
    for lit in re.findall(r"'((?:[^'\\\n]|\\.){4,})'", src):
        if ' ' not in lit or CODEY.search(lit):
            continue
        lits.append(lit)
    total += report('js-literal', f, lits)

print()
print('MISSING TOTAL:', total)
