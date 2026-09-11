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
    # the company, its domain and its addresses. the brand is written Sentinelpay
    # in prose now that the site is no longer all lowercase, and lowercase inside
    # a domain, so both spellings are here.
    'sentinelpay', 'Sentinelpay', 'support@sentinelpay.org', 'privacy@sentinelpay.org',
    'yourcompany.com', 'sentinelpay.org',
    # author bylines, alone or together: names, not copy
    'ceem', 'mind', 'chibby', 'mind, chibby', 'ceem, mind, chibby',
    'Ceem', 'Mind', 'Chibby', 'Mind, chibby', 'Ceem, mind, chibby',
    # the companies in the logo strip. real names, the same in every language.
    'elektromaterijal', 'Elektromaterijal', 'racunala', 'Racunala',
    'traveler', 'Traveler', 'futura', 'Futura', 'majice', 'Majice',
    # the thirty assets in the proof ring. the tooltip on each chip is the
    # asset's name, and an asset's name is the same word in every language:
    # nobody screens for 'Bitcoin' in english and something else in german.
    'Aave', 'ApeCoin', 'Arbitrum', 'Avalanche', 'BNB', 'Bitcoin',
    'Chainlink', 'Compound', 'Curve', 'Dai', 'Decentraland', 'ENS',
    'Ethereum', 'Jupiter', 'Lido', 'Maker', 'Optimism', 'PancakeSwap',
    'Pepe', 'Polygon', 'Shiba Inu', 'Solana', 'Synthetix', 'Tether',
    'The Graph', 'The Sandbox', 'Tron', 'USD Coin', 'Uniswap',
    'Wrapped Bitcoin',
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

# machine answers, not copy. these are returned by endpoints a panel never calls
# or intercepted before anything is drawn, so nobody reads them in any language:
#
#   expired            the reset panel catches the 410 itself and swaps the
#                      whole panel for the expired one; the string never lands
#   forbidden          staff endpoints, answered to curl and not to a screen
#   id required        the same
#   unknown template   the same, for the mail previewer
#   no database...     the same, for the account deleter
SKIP_SERVER = {
    'expired', 'forbidden', 'id required', 'unknown template',
    'no database, so there is no row to delete',
}


def report(kind, path, strings):
    miss = []
    seen = set()
    for s in strings:
        s = re.sub(r'\s+', ' ', s).strip()
        if not s or s in seen or s in KEYS or s in SKIP_EXACT or s in LOGOS:
            continue
        if kind == 'server' and s in SKIP_SERVER:
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
    if f in ('hero3d.js',):
        # the raymarched hero background. every string in it is glsl source for
        # the gpu, not a word anybody reads, so there is nothing here to
        # translate and every literal would be a false positive.
        continue
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

# 4. the answers the server writes.
#
#    this was the hole. every message the api returns for a 4xx is handed to the
#    panel and put on screen through the same t() the rest of the page uses, so
#    an english sentence there is an english sentence in front of a croatian
#    reader. the audit only ever walked api/public, so those were invisible to
#    it: a password rule that said "password must be at least 12 characters" sat
#    untranslated in the reset dialog for as long as it existed.
#
#    only what can reach a screen is checked. a 5xx is swallowed by the client
#    and replaced with one generic line, so the text of a 500 never shows;
#    503 does, because the panel is written to pass it through. anything not
#    inside a res.status(...).json({ error: ... }) is a log line, and log lines
#    are for us.
SERVER = ['api/index.js', 'api/accounts.js']
SERVER_ERR = re.compile(
    r"status\(\s*(\d{3})\s*\)[\s\S]{0,40}?\{\s*error:\s*(['\"])((?:\\.|(?!\2).)*)\2")
# the password rules are returned as plain strings and put in the same place
PW_RULE = re.compile(r"return\s+'((?:\\.|[^'])*[a-z] [a-z][^']*)';")

for f in SERVER:
    if not os.path.exists(f):
        continue
    src = open(f, encoding='utf-8').read()
    found = []
    for m in SERVER_ERR.finditer(src):
        code = int(m.group(1))
        if code >= 500 and code != 503:
            continue
        found.append(m.group(3))
    inside = src.find('function passwordProblem')
    if inside != -1:
        found += PW_RULE.findall(src[inside:inside + 1600])
    total += report('server', f, found)

print()
print('MISSING TOTAL:', total)
