"""Cut fixed weights out of the site's variable fonts, for the PDF report.

The site ships Inter and Plus Jakarta Sans as variable fonts: one file per
script covers every weight. Chromium writes a variable font into a PDF as
drawn outlines, one small picture per glyph, which made a seven page report
933 KB and leaves a reader's PDF tool unsure which font it is looking at.
A font with a single weight is embedded as a font, cut down to the letters
the page uses.

So the PDF gets its own copies, one per weight the report sets, taken from the
same files the site serves so the letters are the same. Run it again whenever
public/fonts changes or the report starts using a weight it did not before:

    pip install fonttools brotli
    python3 tools/print-fonts.py
"""
import os
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

SRC = 'api/public/fonts'
OUT = 'api/print-fonts'

# the weights the report's CSS asks for, family by family
WEIGHTS = {
    'inter': [400, 500, 600, 700],
    'jakarta': [600, 700, 800],
}

STYLE = {400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold'}

os.makedirs(OUT, exist_ok=True)
for family, weights in WEIGHTS.items():
    for part in ('latin', 'latin-ext'):
        src = os.path.join(SRC, family + '-' + part + '.woff2')
        for w in weights:
            font = instantiateVariableFont(TTFont(src), {'wght': w}, updateFontNames=False)
            # named for its weight, so a PDF's font list says Inter-SemiBold
            # where it would otherwise call every weight Regular
            names = font['name']
            base = names.getDebugName(1).replace(' ', '')
            style = STYLE[w]
            names.setName(style, 2, 3, 1, 0x409)
            names.setName(names.getDebugName(1) + ' ' + style, 4, 3, 1, 0x409)
            names.setName(base + '-' + style.replace(' ', ''), 6, 3, 1, 0x409)
            font['OS/2'].usWeightClass = w
            font.flavor = 'woff2'
            dest = os.path.join(OUT, family + '-' + part + '-' + str(w) + '.woff2')
            font.save(dest)
            print(dest, os.path.getsize(dest))
