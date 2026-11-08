'use strict';
/*
 * Second acceptance gate: the live Phaser canvas must be pixel-identical to the reference.
 *
 * Tiled's rasterizer passing is not sufficient — Phaser could draw overlapping furniture in
 * a different order and still look plausible. Loads the game with ?pixeltest (map only, 1:1,
 * no player or camera offset), screenshots the canvas, and diffs it against the aseprite.
 *
 * Usage: node tools/verify_phaser.js   (expects the dev server on :8080)
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW_PATH || 'playwright');
const ase = require('./aseprite.js');
const png = require('./png.js');

const ASE = 'public/assets/tilesets/Modern_Office_Revamped_v1.2/6_Office_Designs/Office_Design_2.aseprite';
const OUT = process.env.VERIFY_OUT ||
  'C:/Users/alvin/AppData/Local/Temp/claude/d--PixelAgents2/ba7261ae-5370-41e3-88dc-68802d6b2247/scratchpad';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 400 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('http://localhost:8080/?map=office_v2&pixeltest', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.game && window.game.scene.getScene('GameScene') &&
    window.game.scene.getScene('GameScene').pixelTest !== undefined, { timeout: 15000 });
  await page.waitForTimeout(1200);

  const shotPath = path.join(OUT, 'phaser_canvas.png');
  await page.locator('canvas').screenshot({ path: shotPath });
  await browser.close();

  const shot = png.decodeToBGRA(fs.readFileSync(shotPath));

  const doc = ase.parse(ASE);
  const truth = Buffer.alloc(doc.width * doc.height * 4, 0);
  for (const l of doc.layers) {
    const p = ase.layerToBGRA(doc, l.index, 0);
    for (let i = 0; i < truth.length; i += 4) {
      const a = p[i + 3];
      if (!a) continue;
      if (a === 255 || truth[i + 3] === 0) {
        truth[i] = p[i]; truth[i + 1] = p[i + 1]; truth[i + 2] = p[i + 2]; truth[i + 3] = a;
      } else {
        const ia = 255 - a;
        truth[i] = Math.round((p[i] * a + truth[i] * ia) / 255);
        truth[i + 1] = Math.round((p[i + 1] * a + truth[i + 1] * ia) / 255);
        truth[i + 2] = Math.round((p[i + 2] * a + truth[i + 2] * ia) / 255);
        truth[i + 3] = Math.max(truth[i + 3], a);
      }
    }
  }

  // Compare only where the reference has content; the canvas is transparent elsewhere.
  let same = 0, considered = 0;
  const perCell = new Map();
  for (let y = 0; y < Math.min(shot.height, doc.height); y++) {
    for (let x = 0; x < Math.min(shot.width, doc.width); x++) {
      const t = (y * doc.width + x) * 4;
      if (truth[t + 3] === 0) continue;
      const s = (y * shot.width + x) * 4;
      considered++;
      if (shot.bgra[s] === truth[t] && shot.bgra[s + 1] === truth[t + 1] && shot.bgra[s + 2] === truth[t + 2]) same++;
      else {
        const k = `${Math.floor(x / 16)},${Math.floor(y / 16)}`;
        perCell.set(k, (perCell.get(k) || 0) + 1);
      }
    }
  }

  const differing = considered - same;
  console.log(`canvas        : ${shot.width}x${shot.height}`);
  console.log(`vs aseprite   : ${same}/${considered} identical (${(100 * same / considered).toFixed(4)}%), ${differing} differing`);
  if (differing) {
    console.log('worst cells   :', [...perCell.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([k, v]) => `${k}:${v}`).join('  '));
  }
  console.log('page errors   :', errors.length ? errors : 'none');
  const pass = differing === 0 && errors.length === 0;
  console.log(`\nGATE: ${pass ? 'PASS — Phaser render is pixel-perfect' : 'FAIL'}`);
  process.exitCode = pass ? 0 : 1;
})();
