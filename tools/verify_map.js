'use strict';
/*
 * Acceptance check for the generated map: rasterize maps/office_v2.tmj with Tiled's own
 * renderer, then pixel-diff it against the aseprite reference — every layer, characters
 * included, since those are now extracted into their own generated tileset.
 *
 * Also asserts against the GIF itself: the GIF is exactly a 2x nearest upscale of the
 * aseprite (verified 58378/58378 at offset 0,0), so a 2x upscale of our render must equal
 * GIF frame 0 on every content pixel.
 *
 * Exit code is non-zero unless the match is pixel-perfect.
 *
 * Usage: node tools/verify_map.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ase = require('./aseprite.js');
const png = require('./png.js');

const TILE = 16;
const TMJ = 'maps/office_v2.tmj';
const ASE = 'public/assets/tilesets/Modern_Office_Revamped_v1.2/6_Office_Designs/Office_Design_2.aseprite';
const RASTERIZER = 'C:/Program Files/Tiled/tmxrasterizer.exe';
const OUT = process.env.VERIFY_OUT ||
  'C:/Users/alvin/AppData/Local/Temp/claude/d--PixelAgents2/ba7261ae-5370-41e3-88dc-68802d6b2247/scratchpad';
const GIF_RGBA = path.join(process.env.RGBA_CACHE ||
  'C:/Users/alvin/AppData/Local/Temp/claude/d--PixelAgents2/ba7261ae-5370-41e3-88dc-68802d6b2247/scratchpad/rgba', 'ref');

const renderPath = path.join(OUT, 'verify_render.png');
execFileSync(RASTERIZER, [TMJ, renderPath]);
const mine = png.decodeToBGRA(fs.readFileSync(renderPath));
const W = mine.width, H = mine.height;

const doc = ase.parse(ASE);
const truth = Buffer.alloc(doc.width * doc.height * 4, 0);
for (const l of doc.layers) {
  const p = ase.layerToBGRA(doc, l.index, 0);
  for (let i = 0; i < truth.length; i += 4) {
    const a = p[i + 3];
    if (!a) continue;
    if (a === 255) { truth[i] = p[i]; truth[i + 1] = p[i + 1]; truth[i + 2] = p[i + 2]; truth[i + 3] = 255; }
    else {
      const ia = 255 - a;
      truth[i] = Math.round((p[i] * a + truth[i] * ia) / 255);
      truth[i + 1] = Math.round((p[i + 1] * a + truth[i + 1] * ia) / 255);
      truth[i + 2] = Math.round((p[i + 2] * a + truth[i + 2] * ia) / 255);
      truth[i + 3] = Math.max(truth[i + 3], a);
    }
  }
}

const diff = Buffer.alloc(W * H * 4, 0);
const perCell = new Map();
let same = 0, considered = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const m = (y * W + x) * 4, t = (y * doc.width + x) * 4;
    if (!mine.bgra[m + 3] && !truth[t + 3]) { diff[m + 3] = 255; continue; }
    considered++;
    const ok = mine.bgra[m + 3] === truth[t + 3] && mine.bgra[m] === truth[t] &&
               mine.bgra[m + 1] === truth[t + 1] && mine.bgra[m + 2] === truth[t + 2];
    if (ok) {
      same++;
      diff[m] = truth[t] >> 2; diff[m + 1] = truth[t + 1] >> 2; diff[m + 2] = truth[t + 2] >> 2; diff[m + 3] = 255;
    } else {
      diff[m] = 255; diff[m + 1] = 0; diff[m + 2] = 255; diff[m + 3] = 255;
      const k = `${Math.floor(x / TILE)},${Math.floor(y / TILE)}`;
      perCell.set(k, (perCell.get(k) || 0) + 1);
    }
  }
}
fs.writeFileSync(path.join(OUT, 'verify_diff.png'), png.encodeBGRA(diff, W, H));

const differing = considered - same;
const pct = (100 * same / considered).toFixed(4);
console.log(`render          : ${W}x${H}`);
console.log(`vs aseprite     : ${same}/${considered} identical (${pct}%), ${differing} differing`);
console.log(`cells w/ diffs  : ${perCell.size}`);
if (differing) {
  console.log('worst cells     :', [...perCell.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([k, v]) => `${k}:${v}`).join('  '));
  console.log(`diff image      : ${path.join(OUT, 'verify_diff.png')}`);
}

// --- GIF assertion: our render upscaled 2x must equal GIF frame 0 on content pixels.
let gifDiff = null;
try {
  const meta = JSON.parse(fs.readFileSync(GIF_RGBA + '.json', 'utf8').replace(/^﻿/, ''));
  const gif = fs.readFileSync(GIF_RGBA + '.rgba');
  let gSame = 0, gCons = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = (y * doc.width + x) * 4;
      if (truth[t + 3] === 0) continue;
      const m = (y * W + x) * 4;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const gx = x * 2 + dx, gy = y * 2 + dy;
        if (gx >= meta.width || gy >= meta.height) continue;
        const g = gy * meta.stride + gx * 4;
        gCons++;
        if (gif[g] === mine.bgra[m] && gif[g + 1] === mine.bgra[m + 1] && gif[g + 2] === mine.bgra[m + 2]) gSame++;
      }
    }
  }
  gifDiff = gCons - gSame;
  console.log(`vs GIF (2x)     : ${gSame}/${gCons} identical (${(100 * gSame / gCons).toFixed(4)}%), ${gifDiff} differing`);
} catch (e) {
  console.log(`vs GIF (2x)     : skipped (${e.message})`);
}

const pass = differing === 0 && gifDiff === 0;
console.log(`\nGATE: ${pass ? 'PASS — pixel-perfect' : 'FAIL — not yet identical'}`);
process.exitCode = pass ? 0 : 1;
