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
    'sentinelpay', 'Sentinelpay', 'support@sentinelpay.org', 'privacy@sentinelpay.org',
    'yourcompany.com', 'sentinelpay.org',
    'ceem', 'mind', 'chibby', 'mind, chibby', 'ceem, mind, chibby',
    # internal state keys and an IANA timezone id. never shown as prose, never translated.
    'auto', 'system', 'UTC',
    # the api token prefix. printed verbatim, never translated.
    'sp_live_',
    # preset and scope state keys. compared in code, never shown as prose.
    'none', 'all', 'read', 'custom',
    # how a list is shown and what a project's state is. both are compared in
    # code and written to storage; the words a reader sees are capitalised.
    'grid', 'list', 'active', 'archived',
    'Ceem', 'Mind', 'Chibby', 'Mind, chibby', 'Ceem, mind, chibby',
    'elektromaterijal', 'Elektromaterijal', 'racunala', 'Racunala',
    'traveler', 'Traveler', 'futura', 'Futura', 'majice', 'Majice',
    'Aave', 'ApeCoin', 'Arbitrum', 'Avalanche', 'BNB', 'Bitcoin',
    'Chainlink', 'Compound', 'Curve', 'Dai', 'Decentraland', 'ENS',
    'Ethereum', 'Jupiter', 'Lido', 'Maker', 'Optimism', 'PancakeSwap',
    'Pepe', 'Polygon', 'Shiba Inu', 'Solana', 'Synthetix', 'Tether',
    'The Graph', 'The Sandbox', 'Tron', 'USD Coin', 'Uniswap',
    'Wrapped Bitcoin',
}
SKIP_RE = re.compile(r'^[\W\d\s]*$')
SKIP_RE_LIST = [
    re.compile(r'^0x[0-9a-f]{4}_[0-9a-f]{3}$'),
    re.compile(r'^[\d.,]+[km]? [A-Z]{3,5}$'),
]
LOGOS = {'elektromaterijal', 'racunala.hr', 'traveler', 'majice.hr', 'futura'}

SKIP_SERVER = {
    'expired', 'forbidden', 'id required', 'unknown template',
    'no database, so there is no row to delete',
}

SKIP_LANG_CODE = re.compile(r'^(?:en|hr|de)$')

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
        if SKIP_LANG_CODE.match(s):
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
    for a in ('placeholder', 'alt', 'title', 'aria-label', 'data-mail-subject', 'data-mail-body'):
        attrs += re.findall(a + r'="([^"]*)"', body)
    total += report('html-attr', f, attrs)

for f in sorted(x for x in os.listdir(PUB) if x.endswith('.js')):
    src = open(os.path.join(PUB, f), encoding='utf-8').read()
    if f in ('i18n.js', 'i18n-title.js'):
        continue
    if f in ('hero3d.js',):
        continue
    if f in ('dash-data.js',):
        continue
    if f in ('inbox.js',):
        continue
    lits = []
    lits += [x for x in re.findall(r"return\s+'((?:[^'\\]|\\.)*)'", src)]
    lits += [x for x in re.findall(r"textContent\s*=\s*'((?:[^'\\]|\\.)*)'", src)]
    lits += re.findall(r"\.show\(\s*'((?:[^'\\]|\\.)*)'", src)
    lits += re.findall(r"alert\(\s*'((?:[^'\\]|\\.)*)'", src)
    lits += re.findall(r"\b(?:label|title|heading|placeholder|group|name)\s*:\s*'((?:[^'\\]|\\.)+)'", src)

    lits += re.findall(r"[^a-zA-Z_.]t\(\s*'((?:[^'\\]|\\.)*)'", src)
    # strings handed to our own helpers, which translate them inside. the sweep below
    # only looks at literals containing a space, so single words like Theme or Timezone
    # would otherwise never be checked.
    TRANSLATING_HELPERS = r"(?:acctLabel|acctRow|head|card|crumb|sectionTitle|sectionNote)"
    lits += re.findall(TRANSLATING_HELPERS + r"\(\s*'((?:[^'\\]|\\.)+)'", src)
    CODEY = re.compile(r'^[^a-zA-Z]|[\\\[\]{}<>=()]|^https?:|\bdata-|\baria-')
    CLASSY = re.compile(r'^[a-z0-9-]+(?: [a-z0-9-]+)*$')
    def codey(lit):
        if lit.strip() in ('Sentinelpay ·', 'Sentinelpay'):
            return True
        if CODEY.search(lit):
            return True
        if lit == 'use strict':
            return True
        bare = lit.strip()
        return bool('-' in bare and CLASSY.match(bare))
    for lit in re.findall(r"'((?:[^'\\\n]|\\.){4,})'", src):
        if ' ' not in lit or codey(lit):
            continue
        lits.append(lit)
    lits = [x for x in lits if not codey(x)]
    total += report('js-literal', f, lits)

SERVER = ['api/index.js', 'api/accounts.js']
SERVER_ERR = re.compile(
    r"status\(\s*(\d{3})\s*\)[\s\S]{0,40}?\{\s*error:\s*(['\"])((?:\\.|(?!\2).)*)\2")
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
