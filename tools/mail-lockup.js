/* The masthead lockup, rendered once to a png.
   ------------------------------------------------------------------------
   Gmail strips @font-face. There is no way around that: not a <link>, not a
   <style>, not an inline rule. So in gmail every word of a message is set in
   whatever the fallback stack lands on, and the one word where that is not
   good enough is the company's own name.

   A wordmark is an image everywhere else on the internet for exactly this
   reason, so it is an image here too. The rest of the message stays text: a
   heading rendered to a picture cannot be translated, cannot reflow on a phone
   and disappears when images are blocked, and none of that is worth trading for
   a typeface.

   Rendered at three times the size it is used at, the same way the checklist
   marker is, so it stays sharp on a retina screen.

   Regenerate after a change to the logo or the display face:

       node tools/mail-lockup.js

   It needs the site running on port 3210 so the woff2 files resolve. */
'use strict';

const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const ORIGIN = process.env.LOCKUP_ORIGIN || 'http://127.0.0.1:3210';
const OUT = path.join(__dirname, '..', 'api', 'public', 'mail-lockup.png');
const SCALE = 3;
const W = 190;
const H = 80;

const HTML = `<!doctype html><meta charset="utf-8">
<style>
  @font-face{font-family:'Plus Jakarta Sans';font-style:normal;font-weight:300 800;
    src:url(${ORIGIN}/fonts/jakarta-latin.woff2) format('woff2');}
  html,body{margin:0;padding:0;background:transparent;}
  #lock{width:${W}px;height:${H}px;display:flex;flex-direction:column;
        align-items:center;justify-content:flex-start;gap:4px;}
  #lock svg{width:52px;height:52px;display:block;}
  #name{font-family:'Plus Jakarta Sans';font-size:16px;line-height:20px;font-weight:800;
        letter-spacing:-0.006em;color:#0e2358;}
</style>
<div id="lock">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#00ffff"/><stop offset="100%" stop-color="#a020f0"/>
      </linearGradient>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3.5" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <g filter="url(#glow)" fill="none" stroke="url(#g)" stroke-width="3.5"
       stroke-linecap="round" stroke-linejoin="round">
      <path d="M60 15 L25 30 V55 C25 80 50 100 60 105 C70 100 95 80 95 55 V30 Z"/>
      <path d="M38 60 Q 60 40 82 60 Q 60 80 38 60 Z"/>
      <g><circle cx="60" cy="60" r="6"/><circle cx="60" cy="60" r="2" fill="url(#g)" stroke="none"/></g>
      <path d="M60 15 V 30" stroke-width="2" opacity="0.6"/>
      <path d="M60 90 V 105" stroke-width="2" opacity="0.6"/>
    </g>
  </svg>
  <div id="name">Sentinelpay</div>
</div>`;

(async () => {
    const browser = await chromium.launch({ args: ['--no-proxy-server'] });
    const page = await browser.newPage({
        viewport: { width: W, height: H },
        deviceScaleFactor: SCALE,
    });
    await page.setContent(HTML, { waitUntil: 'networkidle' });
    // the face has to have arrived before the shot, or the name is rendered in
    // the fallback and the whole point of the file is lost
    const ok = await page.evaluate(async () => {
        await document.fonts.ready;
        return document.fonts.check('800 16px "Plus Jakarta Sans"');
    });
    if (!ok) {
        await browser.close();
        console.error('the display face did not load; is the site running on ' + ORIGIN + '?');
        process.exit(1);
    }
    await page.locator('#lock').screenshot({ path: OUT, omitBackground: true });
    await browser.close();
    console.log('wrote ' + OUT + ' at ' + (W * SCALE) + 'x' + (H * SCALE));
})();
