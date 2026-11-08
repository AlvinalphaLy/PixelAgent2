'use strict';
/*
 * Builds maps/office_v2.tmj so it reproduces Office_Design_2 pixel-for-pixel — or, with
 * `node tools/build_map.js office_v3`, the combined Office_Design_1 + Office_Design_2 layout.
 *
 * The reference GIF is exactly a 2x nearest upscale of Office_Design_2.aseprite (verified:
 * 58378/58378 px at offset 0,0), so matching the aseprite at 1x is matching the GIF.
 *
 * Strategy: decompose each aseprite layer back into the tileset stamps the artist used.
 * Matching is EXACT — tolerant matching would reproduce "nearly" the right pixels, which is
 * precisely what we're trying to eliminate. Each placement is chosen by net error reduction
 * (pixels it fixes minus pixels it breaks) against the layer it belongs to, which handles
 * occlusion and draw order implicitly: sprites are appended in the order they improve the
 * render, so whatever ends up on top is what the source has on top.
 *
 * Anything the tilesets genuinely cannot express is baked into a generated patch tileset, so
 * the final result is 100% by construction. The patch tile count is reported — it is the
 * honest measure of how much is baked rather than real furniture.
 */

const fs = require('fs');
const path = require('path');
const ase = require('./aseprite.js');
const png = require('./png.js');

const TILE = 16;
const PX = TILE * TILE;
const CACHE = process.env.RGBA_CACHE || '.cache/rgba';
const PACK = 'public/assets/tilesets/Modern_Office_Revamped_v1.2';
const TS_DIR = 'maps/tilesets';

// Which map to build: `node tools/build_map.js [office_v2|office_v3]`.
//   office_v2 — Office_Design_2 alone (the original pixel-perfect reproduction)
//   office_v3 — Office_Design_1 joined to the left of Office_Design_2 (tools/compose_designs.js)
// Each map gets its own generated character/patch sheets so building one never clobbers another.
const MAPS = {
  office_v2: { source: `${PACK}/6_Office_Designs/Office_Design_2.aseprite`, suffix: '' },
  // office_v3 also gets the seat-aware collision rules and a Seats layer (see below); office_v2
  // is deliberately left exactly as it was.
  office_v3: { source: 'compose', suffix: '_v3', seatRules: true, properties: [{ name: 'camera', type: 'string', value: 'follow' }] },
};
const MAP_NAME = process.argv[2] || 'office_v2';
const CFG = MAPS[MAP_NAME];
if (!CFG) throw new Error(`unknown map "${MAP_NAME}" — expected one of: ${Object.keys(MAPS).join(', ')}`);
const OUT_TMJ = `maps/${MAP_NAME}.tmj`;
const CHAR_FILE = `characters${CFG.suffix}`;
const PATCH_FILE = `patch${CFG.suffix}`;
const CHARACTER_LAYER = 2;
const MAX_CANDIDATES = 1200;

// Every sheet the design could plausibly have been drawn with, including the pack's
// previous version — the design predates the v1.2 revamp in places, and including the old
// sheets lifted exact layer-0 coverage from 78% to 84%.
const SHEETS = [
  { key: 'roombuilder', name: 'Room_Builder_Office_16x16', file: 'office_floor_walls.png', src: `${PACK}/1_Room_Builder_Office/Room_Builder_Office_16x16.png` },
  { key: 'shadowless', name: 'Modern_Office_Shadowless_16x16', file: 'furniture.png', src: `${PACK}/3_Modern_Office_Shadowless/Modern_Office_Shadowless_16x16.png` },
  { key: 'blackshadow', name: 'Modern_Office_Black_Shadow_16x16', file: 'furniture_shadow.png', src: `${PACK}/2_Modern_Office_Black_Shadow/Modern_Office_Black_Shadow.png` },
  { key: 'oldwalls', name: 'Office_Walls_Floors_Old_16x16', file: 'old_walls_floors.png', src: `${PACK}/7_Modern_Office_Previous_Version/Modern_Office_old/Office_walls_floors_16x16.png` },
  { key: 'oldint', name: 'Office_Interiors_Old_16x16', file: 'old_interiors.png', src: `${PACK}/7_Modern_Office_Previous_Version/Modern_Office_old/Office_interiors_16x16.png` },
  { key: 'oldintshadowless', name: 'Office_Interiors_Old_Shadowless_16x16', file: 'old_interiors_shadowless.png', src: `${PACK}/7_Modern_Office_Previous_Version/Modern_Office_old/Office_interiors_shadowless_16x16.png` },
];

function loadSurface(base) {
  const meta = JSON.parse(fs.readFileSync(path.join(CACHE, base + '.json'), 'utf8').replace(/^\uFEFF/, ''));
  return { ...meta, buf: fs.readFileSync(path.join(CACHE, base + '.rgba')) };
}
function readTileStrided(surf, px, py) {
  const out = Buffer.allocUnsafe(PX * 4);
  for (let row = 0; row < TILE; row++) {
    const src = (py + row) * surf.stride + px * 4;
    surf.buf.copy(out, row * TILE * 4, src, src + TILE * 4);
  }
  return out;
}
const isEmpty = (t) => { for (let i = 3; i < t.length; i += 4) if (t[i] !== 0) return false; return true; };
const isOpaque = (t) => { for (let i = 3; i < t.length; i += 4) if (t[i] !== 255) return false; return true; };

// --------------------------------------------------------------- tile atlas

const tiles = [];
for (const sh of SHEETS) {
  const surf = loadSurface('atlas_' + sh.key);
  const acols = Math.floor(surf.width / TILE);
  sh.cols = acols;
  sh.rows = Math.floor(surf.height / TILE);
  sh.width = surf.width;
  sh.height = surf.height;
  for (let r = 0; r < sh.rows; r++) {
    for (let c = 0; c < acols; c++) {
      const buf = readTileStrided(surf, c * TILE, r * TILE);
      if (isEmpty(buf)) continue;
      const solid = [];
      for (let i = 0; i < PX; i++) if (buf[i * 4 + 3] !== 0) solid.push(i);
      tiles.push({ sheet: sh.key, local: r * acols + c, buf, solid, opaque: isOpaque(buf) });
    }
  }
}
console.log(`atlas: ${tiles.length} tiles across ${SHEETS.length} sheets`);
const tileByKeyEarly = new Map(tiles.map((t) => [`${t.sheet}:${t.local}`, t]));

// color -> candidate (tile, pixel index) pairs, biggest sprites first
const byColor = new Map();
for (const t of tiles) {
  for (const idx of t.solid) {
    const col = t.buf.readUInt32LE(idx * 4);
    if (!byColor.has(col)) byColor.set(col, []);
    byColor.get(col).push({ t, idx });
  }
}
for (const list of byColor.values()) {
  list.sort((a, b) => b.t.solid.length - a.t.solid.length);
  if (list.length > MAX_CANDIDATES) list.length = MAX_CANDIDATES;
}

// ---------------------------------------------------------------- aseprite

let doc, layerPx, forceBlocked = [];
if (CFG.source === 'compose') {
  const comp = require('./compose_designs.js').compose();
  doc = { width: comp.width, height: comp.height, layers: comp.layers };
  layerPx = comp.layerPx;
  forceBlocked = comp.forceBlocked || [];
} else {
  doc = ase.parse(CFG.source);
  layerPx = doc.layers.map((l) => ase.layerToBGRA(doc, l.index, 0));
}
const W = doc.width, H = doc.height;
console.log(`building ${MAP_NAME} from ${CFG.source === 'compose' ? 'Office_Design_1 + Office_Design_2' : CFG.source}`);

let minX = W, minY = H, maxX = -1, maxY = -1;
for (const px of layerPx) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (px[(y * W + x) * 4 + 3] !== 0) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
}
const originX = Math.floor(minX / TILE) * TILE;
const originY = Math.floor(minY / TILE) * TILE;
const cols = Math.ceil((maxX + 1 - originX) / TILE);
const rows = Math.ceil((maxY + 1 - originY) / TILE);
console.log(`content (${minX},${minY})-(${maxX},${maxY}) -> grid ${cols}x${rows} @ origin (${originX},${originY})`);

// ------------------------------------------------------- exact decomposition

const eq = (a, ai, b, bi) =>
  a[ai] === b[bi] && a[ai + 1] === b[bi + 1] && a[ai + 2] === b[bi + 2] && a[ai + 3] === b[bi + 3];

/** Result of drawing tile pixel `s` of `tile` over the current render pixel at `d`. */
function over(tile, s, render, d, out) {
  const a = tile[s + 3];
  if (a === 255 || render[d + 3] === 0) {
    out[0] = tile[s]; out[1] = tile[s + 1]; out[2] = tile[s + 2]; out[3] = a;
    if (a !== 255 && render[d + 3] === 0) { /* straight copy onto empty */ }
    return;
  }
  if (a === 0) { out[0] = render[d]; out[1] = render[d + 1]; out[2] = render[d + 2]; out[3] = render[d + 3]; return; }
  const ia = 255 - a;
  out[0] = Math.round((tile[s] * a + render[d] * ia) / 255);
  out[1] = Math.round((tile[s + 1] * a + render[d + 1] * ia) / 255);
  out[2] = Math.round((tile[s + 2] * a + render[d + 2] * ia) / 255);
  out[3] = Math.max(render[d + 3], a);
}

function decomposeLayer(truth, label) {
  const render = Buffer.alloc(W * H * 4, 0);
  const placements = [];
  const dead = new Uint8Array(W * H);
  const tmp = [0, 0, 0, 0];

  const score = (t, ox, oy) => {
    let fixes = 0, breaks = 0;
    for (const i of t.solid) {
      const x = ox + (i % TILE), y = oy + Math.floor(i / TILE);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const d = (y * W + x) * 4;
      // Never paint outside the layer's silhouette. The patch layer can only *add* pixels,
      // so anything we over-draw here would be uncorrectable later.
      if (truth[d + 3] === 0) return -Infinity;
      const curOK = eq(render, d, truth, d);
      over(t.buf, i * 4, render, d, tmp);
      const newOK = tmp[0] === truth[d] && tmp[1] === truth[d + 1] &&
                    tmp[2] === truth[d + 2] && tmp[3] === truth[d + 3];
      if (curOK && !newOK) breaks++;
      else if (!curOK && newOK) fixes++;
    }
    return fixes - breaks;
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x, d = p * 4;
      if (dead[p] || eq(render, d, truth, d)) continue;

      const cands = byColor.get(truth.readUInt32LE(d)) || [];
      let best = null;
      const seen = new Set();
      for (const { t, idx } of cands) {
        const ox = x - (idx % TILE), oy = y - Math.floor(idx / TILE);
        const key = (ox + 64) * 100000 + (oy + 64) * 100 + 0;
        const dedupe = `${t.sheet}:${t.local}:${ox}:${oy}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        const net = score(t, ox, oy);
        if (net > 0 && (!best || net > best.net)) best = { t, ox, oy, net };
      }

      if (best) {
        for (const i of best.t.solid) {
          const tx = best.ox + (i % TILE), ty = best.oy + Math.floor(i / TILE);
          if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
          const dd = (ty * W + tx) * 4;
          over(best.t.buf, i * 4, render, dd, tmp);
          render[dd] = tmp[0]; render[dd + 1] = tmp[1]; render[dd + 2] = tmp[2]; render[dd + 3] = tmp[3];
        }
        placements.push({ sheet: best.t.sheet, local: best.t.local, x: best.ox, y: best.oy });
      } else {
        dead[p] = 1;
      }
    }
  }

  let wrong = 0, solid = 0;
  for (let i = 0; i < W * H; i++) {
    const d = i * 4;
    if (truth[d + 3] !== 0) solid++;
    if (!eq(render, d, truth, d)) wrong++;
  }
  console.log(`  ${label}: ${placements.length} placements, ${wrong} px still wrong (of ${solid} solid)`);
  return { placements, render, wrong };
}

console.log('\ndecomposing layers (exact match, net-error scoring):');
const decomposed = {};
for (const l of doc.layers) {
  if (l.index === CHARACTER_LAYER) continue;
  decomposed[l.index] = decomposeLayer(layerPx[l.index], `layer ${l.index} "${l.name}"`);
}

// ------------------------------------------------- characters -> own tileset

const charBlobs = [];
{
  const px = layerPx[CHARACTER_LAYER];
  const seen = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (px[(y * W + x) * 4 + 3] === 0 || seen[y * W + x]) continue;
      const stack = [[x, y]];
      let minx = x, maxx = x, miny = y, maxy = y, n = 0;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
        const q = cy * W + cx;
        if (seen[q] || px[q * 4 + 3] === 0) continue;
        seen[q] = 1; n++;
        if (cx < minx) minx = cx; if (cx > maxx) maxx = cx;
        if (cy < miny) miny = cy; if (cy > maxy) maxy = cy;
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
      if (n > 20) charBlobs.push({ minx, miny, maxx, maxy, n });
    }
  }
}
console.log(`\ncharacters: ${charBlobs.length} blobs`);

// Lay each character out on a 16px grid in a generated sheet.
const charCells = [];
for (const b of charBlobs) {
  const ox = Math.floor(b.minx / TILE) * TILE, oy = Math.floor(b.miny / TILE) * TILE;
  const cw = Math.ceil((b.maxx + 1 - ox) / TILE), ch = Math.ceil((b.maxy + 1 - oy) / TILE);
  for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
    charCells.push({ srcX: ox + tx * TILE, srcY: oy + ty * TILE });
  }
}
const charCols = Math.max(1, Math.min(8, charCells.length));
const charRows = Math.ceil(charCells.length / charCols);
const charSheet = Buffer.alloc(charCols * TILE * charRows * TILE * 4, 0);
const charSheetW = charCols * TILE;
charCells.forEach((cell, i) => {
  const dx = (i % charCols) * TILE, dy = Math.floor(i / charCols) * TILE;
  for (let r = 0; r < TILE; r++) for (let c = 0; c < TILE; c++) {
    const sx = cell.srcX + c, sy = cell.srcY + r;
    if (sx >= W || sy >= H) continue;
    const s = (sy * W + sx) * 4, d = ((dy + r) * charSheetW + dx + c) * 4;
    const p = layerPx[CHARACTER_LAYER];
    charSheet[d] = p[s]; charSheet[d + 1] = p[s + 1]; charSheet[d + 2] = p[s + 2]; charSheet[d + 3] = p[s + 3];
  }
  cell.local = i;
});
console.log(`  character sheet: ${charCols}x${charRows} tiles (${charCells.length} cells)`);

// ----------------------------------------------- assign gids / build layers

const usedSheets = new Set();
for (const k of Object.keys(decomposed)) for (const p of decomposed[k].placements) usedSheets.add(p.sheet);
const activeSheets = SHEETS.filter((s) => usedSheets.has(s.key));
console.log('\nsheets used:', activeSheets.map((s) => s.key).join(', '));

let gidCursor = 1;
const tilesets = [];
for (const s of activeSheets) {
  s.firstgid = gidCursor;
  gidCursor += s.cols * s.rows;
  tilesets.push({ firstgid: s.firstgid, source: `tilesets/${s.file.replace(/\.png$/, '.tsx')}` , _sheet: s });
}
const charFirstGid = gidCursor;
gidCursor += charCols * charRows;
const gidOf = (sheetKey, local) => SHEETS.find((s) => s.key === sheetKey).firstgid + local;

// Layer 0 grid-aligned placements become Floor/Walls tile layers; the rest become objects.
// Layer 0 is split into two tile layers plus an object layer, but the split must not
// reorder anything: the tile layers always draw before the objects, so as soon as one
// placement has to become an object, every later placement must too.
const floorLayer = new Array(cols * rows).fill(0);
const wallLayer = new Array(cols * rows).fill(0);
const structureObjects = [];
// Tile layers always draw before the object layer, so a placement may only be promoted to a
// tile layer if nothing already destined for the object layer sits under it. Tracking the
// object-claimed pixels lets the floor (laid down first) stay real tiles while only genuinely
// overlapping art spills into objects.
const objectMask = new Uint8Array(W * H);
const solidPixels = (p) => {
  const t = tileByKeyEarly.get(`${p.sheet}:${p.local}`);
  const out = [];
  for (const i of t.solid) {
    const x = p.x + (i % TILE), y = p.y + Math.floor(i / TILE);
    if (x >= 0 && y >= 0 && x < W && y < H) out.push(y * W + x);
  }
  return out;
};
for (const p of decomposed[0].placements) {
  const alignedX = (p.x - originX) % TILE === 0, alignedY = (p.y - originY) % TILE === 0;
  const tx = (p.x - originX) / TILE, ty = (p.y - originY) / TILE;
  const inGrid = alignedX && alignedY && tx >= 0 && ty >= 0 && tx < cols && ty < rows;
  const px = solidPixels(p);
  const clear = !px.some((q) => objectMask[q]);
  if (inGrid && clear && !floorLayer[ty * cols + tx]) floorLayer[ty * cols + tx] = gidOf(p.sheet, p.local);
  else if (inGrid && clear && !wallLayer[ty * cols + tx]) wallLayer[ty * cols + tx] = gidOf(p.sheet, p.local);
  else { structureObjects.push(p); for (const q of px) objectMask[q] = 1; }
}

let nextId = 1;
const toObject = (p, name) => ({
  id: nextId++, name, type: '', rotation: 0, visible: true,
  gid: gidOf(p.sheet, p.local), width: TILE, height: TILE,
  x: p.x - originX, y: p.y - originY + TILE, // Tiled anchors tile objects bottom-left
});

const structureObjs = structureObjects.map((p) => toObject(p, `struct_${p.sheet}_${p.local}`));
const furnitureObjs = [
  ...decomposed[1].placements.map((p) => toObject(p, `furn_${p.sheet}_${p.local}`)),
];
const detailObjs = (decomposed[3] ? decomposed[3].placements : []).map((p) => toObject(p, `detail_${p.sheet}_${p.local}`));
const characterObjs = charCells.map((cell, i) => ({
  id: nextId++, name: `character_${i}`, type: 'character', rotation: 0, visible: true,
  gid: charFirstGid + cell.local, width: TILE, height: TILE,
  x: cell.srcX - originX, y: cell.srcY - originY + TILE,
}));

module.exports = {};

// ------------------------------------------------------ render + patch layer

const finalRender = Buffer.alloc(W * H * 4, 0);
const tmp2 = [0, 0, 0, 0];
function drawTile(buf, ox, oy) {
  for (let i = 0; i < PX; i++) {
    if (buf[i * 4 + 3] === 0) continue;
    const x = ox + (i % TILE), y = oy + Math.floor(i / TILE);
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const d = (y * W + x) * 4;
    over(buf, i * 4, finalRender, d, tmp2);
    finalRender[d] = tmp2[0]; finalRender[d + 1] = tmp2[1]; finalRender[d + 2] = tmp2[2]; finalRender[d + 3] = tmp2[3];
  }
}
const tileByKey = new Map(tiles.map((t) => [`${t.sheet}:${t.local}`, t.buf]));
for (const arr of [floorLayer, wallLayer]) {
  for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
    const g = arr[ty * cols + tx];
    if (!g) continue;
    const s = activeSheets.find((sh) => g >= sh.firstgid && g < sh.firstgid + sh.cols * sh.rows);
    drawTile(tileByKey.get(`${s.key}:${g - s.firstgid}`), originX + tx * TILE, originY + ty * TILE);
  }
}
for (const p of structureObjects) drawTile(tileByKey.get(`${p.sheet}:${p.local}`), p.x, p.y);
for (const p of decomposed[1].placements) drawTile(tileByKey.get(`${p.sheet}:${p.local}`), p.x, p.y);
for (const cell of charCells) {
  const t = Buffer.alloc(PX * 4, 0);
  for (let r = 0; r < TILE; r++) for (let c = 0; c < TILE; c++) {
    const sx = cell.srcX + c, sy = cell.srcY + r;
    if (sx >= W || sy >= H) continue;
    const s = (sy * W + sx) * 4, d2 = (r * TILE + c) * 4;
    const p = layerPx[CHARACTER_LAYER];
    t[d2] = p[s]; t[d2 + 1] = p[s + 1]; t[d2 + 2] = p[s + 2]; t[d2 + 3] = p[s + 3];
  }
  drawTile(t, cell.srcX, cell.srcY);
}
if (decomposed[3]) for (const p of decomposed[3].placements) drawTile(tileByKey.get(`${p.sheet}:${p.local}`), p.x, p.y);

// truth = all layers flattened
const truthFlat = Buffer.alloc(W * H * 4, 0);
for (const px of layerPx) {
  for (let i = 0; i < truthFlat.length; i += 4) {
    const a = px[i + 3];
    if (!a) continue;
    if (a === 255 || truthFlat[i + 3] === 0) {
      truthFlat[i] = px[i]; truthFlat[i + 1] = px[i + 1]; truthFlat[i + 2] = px[i + 2]; truthFlat[i + 3] = a;
    } else {
      const ia = 255 - a;
      truthFlat[i] = Math.round((px[i] * a + truthFlat[i] * ia) / 255);
      truthFlat[i + 1] = Math.round((px[i + 1] * a + truthFlat[i + 1] * ia) / 255);
      truthFlat[i + 2] = Math.round((px[i + 2] * a + truthFlat[i + 2] * ia) / 255);
      truthFlat[i + 3] = Math.max(truthFlat[i + 3], a);
    }
  }
}

// Residual correction. The patch tile holds ONLY the pixels that still differ and is
// transparent everywhere else, so the semantic tiles beneath stay visible and the cost is
// measured in corrected pixels rather than whole baked cells.
const patchCells = [];
let patchPx = 0;
for (let ty = 0; ty < rows; ty++) {
  for (let tx = 0; tx < cols; tx++) {
    let bad = 0;
    for (let r = 0; r < TILE; r++) for (let c = 0; c < TILE; c++) {
      const x = originX + tx * TILE + c, y = originY + ty * TILE + r;
      if (x >= W || y >= H) continue;
      if (!eq(finalRender, (y * W + x) * 4, truthFlat, (y * W + x) * 4)) bad++;
    }
    if (bad) { patchCells.push({ tx, ty, bad }); patchPx += bad; }
  }
}
const patchCols = Math.max(1, Math.min(16, patchCells.length));
const patchRows = Math.max(1, Math.ceil(patchCells.length / patchCols));
const patchW = patchCols * TILE;
const patchSheet = Buffer.alloc(patchW * patchRows * TILE * 4, 0);
patchCells.forEach((cell, i) => {
  const dx = (i % patchCols) * TILE, dy = Math.floor(i / patchCols) * TILE;
  for (let r = 0; r < TILE; r++) for (let c = 0; c < TILE; c++) {
    const sx = originX + cell.tx * TILE + c, sy = originY + cell.ty * TILE + r;
    if (sx >= W || sy >= H) continue;
    const s = (sy * W + sx) * 4, d = ((dy + r) * patchW + dx + c) * 4;
    if (eq(finalRender, s, truthFlat, s)) continue; // agree already: leave transparent
    patchSheet[d] = truthFlat[s]; patchSheet[d + 1] = truthFlat[s + 1];
    patchSheet[d + 2] = truthFlat[s + 2]; patchSheet[d + 3] = truthFlat[s + 3];
  }
  cell.local = i;
});
const patchFirstGid = gidCursor;
gidCursor += patchCols * patchRows;
const patchLayer = new Array(cols * rows).fill(0);
for (const cell of patchCells) patchLayer[cell.ty * cols + cell.tx] = patchFirstGid + cell.local;

let truthSolid = 0;
for (let i = 0; i < W * H; i++) if (truthFlat[i * 4 + 3] !== 0) truthSolid++;
console.log(`\npatch: ${patchPx} corrected px across ${patchCells.length} tiles ` +
  `(${(100 * patchPx / truthSolid).toFixed(2)}% of image baked; ` +
  `${(100 - 100 * patchPx / truthSolid).toFixed(2)}% reproduced from real tileset art)`);

// ------------------------------------------------------------ write outputs

fs.mkdirSync(TS_DIR, { recursive: true });
for (const s of activeSheets) {
  fs.copyFileSync(s.src, path.join(TS_DIR, s.file));
  fs.writeFileSync(path.join(TS_DIR, s.file.replace(/\.png$/, '.tsx')),
    `<?xml version="1.0" encoding="UTF-8"?>\n<tileset version="1.10" tiledversion="1.12.1" name="${s.name}" ` +
    `tilewidth="16" tileheight="16" tilecount="${s.cols * s.rows}" columns="${s.cols}">\n` +
    ` <image source="${s.file}" width="${s.width}" height="${s.height}"/>\n</tileset>\n`);
}
fs.writeFileSync(path.join(TS_DIR, `${CHAR_FILE}.png`), png.encodeBGRA(charSheet, charSheetW, charRows * TILE));
fs.writeFileSync(path.join(TS_DIR, `${CHAR_FILE}.tsx`),
  `<?xml version="1.0" encoding="UTF-8"?>\n<tileset version="1.10" tiledversion="1.12.1" name="Design_Characters${CFG.suffix}_16x16" ` +
  `tilewidth="16" tileheight="16" tilecount="${charCols * charRows}" columns="${charCols}">\n` +
  ` <image source="${CHAR_FILE}.png" width="${charSheetW}" height="${charRows * TILE}"/>\n</tileset>\n`);
fs.writeFileSync(path.join(TS_DIR, `${PATCH_FILE}.png`), png.encodeBGRA(patchSheet, patchW, patchRows * TILE));
fs.writeFileSync(path.join(TS_DIR, `${PATCH_FILE}.tsx`),
  `<?xml version="1.0" encoding="UTF-8"?>\n<tileset version="1.10" tiledversion="1.12.1" name="Design_Patch${CFG.suffix}_16x16" ` +
  `tilewidth="16" tileheight="16" tilecount="${patchCols * patchRows}" columns="${patchCols}">\n` +
  ` <image source="${PATCH_FILE}.png" width="${patchW}" height="${patchRows * TILE}"/>\n</tileset>\n`);

// Collision. Most architecture ends up in object layers rather than the Walls tile layer, so
// deriving collision from that layer alone would leave the map almost entirely walkable.
// Instead: a cell blocks if non-floor art covers a meaningful share of it, or if it has no
// floor at all (outside the building). Run-length merged per row to keep the body count low.
// Floor art that spilled into the object layers must not count as an obstacle, so the tiles
// the Floor layer uses are treated as ground wherever they appear.
const floorTileKeys = new Set();
for (const g of floorLayer) {
  if (!g) continue;
  const s = activeSheets.find((sh) => g >= sh.firstgid && g < sh.firstgid + sh.cols * sh.rows);
  if (s) floorTileKeys.add(`${s.key}:${g - s.firstgid}`);
}

// Where is there actually FLOOR? The Floor tile layer only holds 134 of 272 cells — the rest
// spilled into objects — so walkability must be derived from the placements themselves.
// Without this, the roof counts as "inside" (its art is opaque) and the player can walk on it.
const hasFloor = new Uint8Array(cols * rows);
for (const p of decomposed[0].placements) {
  if (!floorTileKeys.has(`${p.sheet}:${p.local}`)) continue;
  const t = tileByKeyEarly.get(`${p.sheet}:${p.local}`);
  if (!t) continue;
  for (const i of t.solid) {
    const x = p.x + (i % TILE) - originX, y = p.y + Math.floor(i / TILE) - originY;
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (tx >= 0 && ty >= 0 && tx < cols && ty < rows) hasFloor[ty * cols + tx] = 1;
  }
}
for (let i = 0; i < cols * rows; i++) if (floorLayer[i]) hasFloor[i] = 1;

const coverage = new Uint16Array(cols * rows);
const markCoverage = (p) => {
  const key = `${p.sheet}:${p.local}`;
  if (floorTileKeys.has(key)) return; // ground, not an obstacle
  const t = tileByKeyEarly.get(key);
  if (!t) return;
  for (const i of t.solid) {
    const x = p.x + (i % TILE) - originX, y = p.y + Math.floor(i / TILE) - originY;
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;
    coverage[ty * cols + tx]++;
  }
};
for (const p of structureObjects) markCoverage(p);
for (const p of decomposed[1].placements) markCoverage(p);
if (decomposed[3]) for (const p of decomposed[3].placements) markCoverage(p);

// Inside/outside comes from the finished image, not the Floor tile layer — most of the
// floor ends up as objects, so an empty Floor cell does not mean "outside the building".
const inside = new Uint8Array(cols * rows);
for (let ty = 0; ty < rows; ty++) {
  for (let tx = 0; tx < cols; tx++) {
    let opaque = 0;
    for (let r = 0; r < TILE; r++) for (let c = 0; c < TILE; c++) {
      const x = originX + tx * TILE + c, y = originY + ty * TILE + r;
      if (x < W && y < H && truthFlat[(y * W + x) * 4 + 3] !== 0) opaque++;
    }
    inside[ty * cols + tx] = opaque >= PX * 0.5 ? 1 : 0;
  }
}

// The design packs a whole office into 16x17 tiles, so one cell holds a large chunk of a
// desk and only ~40 of 217 floor cells are genuinely open. The threshold was swept end to
// end: at 0.40 the aisles seal shut into unreachable pockets, and above 0.85 the character
// visibly walks through desks. 0.85 is the measured best trade-off, not a guess — it is the
// loosest setting that still blocks the worst clipping while leaving the aisles usable.
const BLOCK_COVERAGE = PX * 0.85;

// The Walls tile layer is just "the second grid-aligned layer-0 tile in a cell", so it can hold
// plain floor — a carpet patch or a floor tile laid over another floor tile. Treating all of it as
// wall sealed a corridor in office_v3. The pack draws every wall and furniture edge with the same
// dark outline colour and floor tiles never use it, so a Walls-layer tile blocks only if it has it.
const OUTLINE = 0xff503a3a; // rgb(58,58,80) as little-endian BGRA
const isStructural = (gid) => {
  const s = activeSheets.find((sh) => gid >= sh.firstgid && gid < sh.firstgid + sh.cols * sh.rows);
  const t = s && tileByKeyEarly.get(`${s.key}:${gid - s.firstgid}`);
  return !t || t.solid.some((i) => t.buf.readUInt32LE(i * 4) === OUTLINE);
};

const blocked = new Uint8Array(cols * rows);
for (let i = 0; i < cols * rows; i++) {
  // Both tests are required. "inside" alone lets the roof through, because wall art is
  // opaque. "hasFloor" alone lets through a strip down the left exterior where a floor tile
  // bleeds outside the building — the carver then tunnelled along it and the player spawned
  // outside the office.
  if (!hasFloor[i] || !inside[i]) blocked[i] = 1;
  else if (wallLayer[i] && isStructural(wallLayer[i])) blocked[i] = 1;   // wall art
  else if (coverage[i] >= BLOCK_COVERAGE) blocked[i] = 1;
}
// Cells the source knows are wall even though the coverage test can't see it (see compose_designs).
for (const [tx, ty] of forceBlocked) if (tx >= 0 && ty >= 0 && tx < cols && ty < rows) blocked[ty * cols + tx] = 1;

// Two gaps in the coverage test, both measured on the source pixels:
//  1. Thick walls seen from above (a white cap block) live in layer 0 and often land in the Floor
//     tile layer, so they count as floor with zero coverage. A cell whose layer-0 art is at least
//     a quarter wall-cap white / outline is wall — floors never use those colours.
//  2. Furniture that covers 50-85% of a cell (a plant, a printer table) stays walkable. Whole-cell
//     coverage can't separate those from chairs, which cover as much, so chairs are listed as
//     seats and every other cell is judged by the box the feet rest in (FEET_Y=12 in Character.js:
//     x 3-12, y 4-11). 60% of that box covered means the character would stand on the furniture.
//     The printer base beside the break-room entrance fills only the top of its cell (54% of the
//     feet box), so the only way into that room stays open.
const SEATS = CFG.seatRules ? require('./compose_designs.js').seatsFor(MAP_NAME) : [];
const seatCells = new Set(SEATS.map((s) => s.tile[1] * cols + s.tile[0]));
const WALL_COLOURS = new Set([0xff503a3a, 0xfff8f8f8, 0xfffdfdfd]); // outline, wall fill, cap fill
const furnitureLayers = layerPx.filter((_, i) => i !== 0 && i !== CHARACTER_LAYER);
let wallColourBlocked = 0, furnitureBlocked = 0;
const wallColourCells = new Set(); // never tunnelled through: they have zero furniture cost
for (let ty = 0; ty < rows && CFG.seatRules; ty++) for (let tx = 0; tx < cols; tx++) {
  const i = ty * cols + tx;
  if (blocked[i] || seatCells.has(i)) continue;
  let wallPx = 0, feetPx = 0, feetTotal = 0;
  for (let r = 0; r < TILE; r++) for (let c = 0; c < TILE; c++) {
    const x = originX + tx * TILE + c, y = originY + ty * TILE + r;
    if (x >= W || y >= H) continue;
    const o = (y * W + x) * 4;
    if (WALL_COLOURS.has(layerPx[0].readUInt32LE(o))) wallPx++;
    if (c >= 3 && c <= 12 && r >= 4 && r <= 11) {
      feetTotal++;
      if (furnitureLayers.some((L) => L[o + 3] !== 0)) feetPx++;
    }
  }
  if (wallPx >= PX / 4) { blocked[i] = 1; wallColourBlocked++; wallColourCells.add(i); }
  else if (feetTotal && feetPx / feetTotal >= 0.6) { blocked[i] = 1; furnitureBlocked++; }
}
console.log(`\ncollision: wall-colour blocked ${wallColourBlocked}, furniture-under-feet blocked ${furnitureBlocked}, seats ${SEATS.length}`);

function components(b) {
  const seen = new Uint8Array(cols * rows);
  const out = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    if (b[i] || seen[i]) continue;
    const stack = [[x, y]], cells = [];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
      const j = cy * cols + cx;
      if (seen[j] || b[j]) continue;
      seen[j] = 1; cells.push(j);
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    out.push(cells);
  }
  return out.sort((a, z) => z.length - a.length);
}

// The reference is a promo image of separate spaces: it has no doorway between the upper
// office and the lower rooms, and the upper office is pinched shut by furniture. Left alone
// the map is five unreachable pockets, so connections have to be tunnelled.
//
// Coverage can exceed 100% where objects overlap, so the doorway between floors is genuinely
// buried and reaching the lower rooms means cutting through it. Candidates are constrained
// (see carveable below) because an earlier unconstrained search tunnelled onto the roof.
const MIN_REGION = 4;
const carved = [];

/**
 * Connect substantial regions by carving the CHEAPEST PATH between them, weighted by how
 * buried each cell is. An earlier version carved whichever single cell grew the biggest
 * region, which just fattened the main office and left the lower rooms sealed behind a
 * dead-end corridor. Connecting rooms is the actual goal, so search for a route.
 */
function carvePathBetweenRegions() {
  for (let pass = 0; pass < 12; pass++) {
    const regions = components(blocked).filter((c) => c.length >= MIN_REGION);
    if (regions.length <= 1) return;

    const target = new Set(regions[0]);
    const others = new Set();
    for (let r = 1; r < regions.length; r++) for (const i of regions[r]) others.add(i);

    // Dijkstra outward from the main region; walkable cells are free, buried cells cost
    // their coverage, walls and floorless cells are impassable.
    const INF = Infinity;
    const dist = new Float64Array(cols * rows).fill(INF);
    const prev = new Int32Array(cols * rows).fill(-1);
    const queue = [];
    for (const i of target) { dist[i] = 0; queue.push(i); }

    let reached = -1;
    while (queue.length) {
      let bi = 0;
      for (let k = 1; k < queue.length; k++) if (dist[queue[k]] < dist[queue[bi]]) bi = k;
      const cur = queue.splice(bi, 1)[0];
      if (others.has(cur)) { reached = cur; break; }
      const cx = cur % cols, cy = Math.floor(cur / cols);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const n = ny * cols + nx;
        if (!carveable(n)) continue;
        const step = blocked[n] ? 1 + coverage[n] : 0;
        if (dist[cur] + step < dist[n]) {
          dist[n] = dist[cur] + step;
          prev[n] = cur;
          if (!queue.includes(n)) queue.push(n);
        }
      }
    }
    if (reached < 0) return;

    for (let n = reached; n !== -1 && !target.has(n); n = prev[n]) {
      if (blocked[n]) { blocked[n] = 0; carved.push([n % cols, Math.floor(n / cols)]); }
    }
  }
}
/**
 * Can this cell be tunnelled through? It must be inside the building, and either have floor
 * of its own or be flanked by floor. The flank test matters: the natural doorway between the
 * two halves of this office is fully hidden under furniture, so no floor tile was detected
 * there and the carver detoured to a single invisible tile at the far right edge that no
 * player would ever find.
 */
const forcedSet = new Set(forceBlocked.map(([tx, ty]) => ty * cols + tx));
function carveable(i) {
  if (forcedSet.has(i) || wallColourCells.has(i)) return false;
  if (!inside[i] || (wallLayer[i] && isStructural(wallLayer[i]))) return false;
  if (hasFloor[i]) return true;
  const x = i % cols, y = Math.floor(i / cols);
  let flanking = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
    if (hasFloor[ny * cols + nx]) flanking++;
  }
  return flanking >= 2;   // roof cells have no floor neighbours; a doorway does
}

carvePathBetweenRegions();

// Anything still not joined to the main region is unreachable, so block it outright. This is
// what stops the player standing on the roof or inside a sealed pocket.
const main = new Set(components(blocked)[0] || []);
let stranded = 0;
for (let i = 0; i < cols * rows; i++) {
  if (!blocked[i] && !main.has(i)) { blocked[i] = 1; stranded++; }
}
console.log(`
collision: carved ${carved.length} doorway(s) ${carved.map((c) => '(' + c + ')').join(' ')}`);
console.log(`  sealed ${stranded} unreachable cell(s); walkable region = ${main.size}`);

fs.writeFileSync(path.join(CACHE, `collision_debug_${MAP_NAME}.json`), JSON.stringify({
  cols, rows,
  hasFloor: Array.from(hasFloor),
  inside: Array.from(inside),
  coverage: Array.from(coverage),
  wall: Array.from(wallLayer, (v) => (v ? 1 : 0)),
}));

const collision = [];
for (let ty = 0; ty < rows; ty++) {
  let run = null;
  for (let tx = 0; tx <= cols; tx++) {
    const isBlocked = tx < cols && blocked[ty * cols + tx];
    if (isBlocked) { if (!run) run = { x: tx, w: 0 }; run.w++; }
    else if (run) {
      collision.push({ id: nextId++, name: 'blocked', type: 'collision', rotation: 0, visible: true,
        x: run.x * TILE, y: ty * TILE, width: run.w * TILE, height: TILE });
      run = null;
    }
  }
}
const spawns = charBlobs.map((b, i) => ({
  id: nextId++, name: `npc_spawn_${i + 1}`, type: 'npc_spawn', rotation: 0, visible: true, point: true,
  x: (b.minx + b.maxx) / 2 - originX, y: b.maxy + 1 - originY,
}));

// Seats: the object sits on the tile you stand on to sit; its properties say where the character
// goes once seated, which way it faces, and which chair overlay (if any) to draw over it.
// Overlays are lifted from the source design into one generated sheet, a 16x32 frame each.
const OVERLAY_FILE = `seat_overlays${CFG.suffix}`;
const overlaySeats = SEATS.filter((s) => s.overlay);
const overlaySheet = Buffer.alloc(Math.max(1, overlaySeats.length) * TILE * 32 * 4, 0);
const overlaySheetW = Math.max(1, overlaySeats.length) * TILE;
if (overlaySeats.length) {
  const compose = require('./compose_designs.js');
  const designs = {};
  overlaySeats.forEach((s, k) => {
    const { design, from } = s.overlay;
    designs[design] = designs[design] || compose.designLayers(design);
    const src = designs[design];
    let same = 0, opaque = 0;
    for (let y = 0; y < from.h; y++) for (let x = 0; x < from.w; x++) {
      const so = ((from.y + y) * src.w + from.x + x) * 4;
      const L = src.layers[from.layer];
      if (!L[so + 3]) continue;
      const d = (y * overlaySheetW + k * TILE + x) * 4;
      overlaySheet[d] = L[so]; overlaySheet[d + 1] = L[so + 1]; overlaySheet[d + 2] = L[so + 2]; overlaySheet[d + 3] = L[so + 3];
      // Sanity: the overlay must sit exactly on the chair it covers in the finished map.
      const mx = s.overlay.x + x, my = s.overlay.y + y, mo = (my * W + mx) * 4;
      opaque++;
      if (layerPx[1][mo] === L[so] && layerPx[1][mo + 1] === L[so + 1] && layerPx[1][mo + 2] === L[so + 2]) same++;
    }
    s.overlayFrame = k;
    console.log(`  seat overlay ${k} at (${s.overlay.x},${s.overlay.y}): ${same}/${opaque} px match the chair underneath`);
  });
  fs.writeFileSync(path.join(TS_DIR, `${OVERLAY_FILE}.png`), png.encodeBGRA(overlaySheet, overlaySheetW, 32));
  fs.mkdirSync('public/assets/tilesets', { recursive: true });
  fs.copyFileSync(path.join(TS_DIR, `${OVERLAY_FILE}.png`), path.join('public/assets/tilesets', `${OVERLAY_FILE}.png`));
}
const seatObjs = SEATS.map((s, k) => ({
  id: nextId++, name: `seat_${k + 1}`, type: 'seat', rotation: 0, visible: true, point: true,
  x: s.tile[0] * TILE + TILE / 2, y: s.tile[1] * TILE + 12,
  properties: [
    { name: 'facing', type: 'string', value: s.facing },
    { name: 'sitX', type: 'float', value: s.sit[0] },
    { name: 'sitY', type: 'float', value: s.sit[1] },
    { name: 'overlayFrame', type: 'int', value: s.overlay ? s.overlayFrame : -1 },
    { name: 'overlayX', type: 'float', value: s.overlay ? s.overlay.x : 0 },
    { name: 'overlayY', type: 'float', value: s.overlay ? s.overlay.y : 0 },
  ],
}));
if (overlaySeats.length) {
  CFG.properties = [...(CFG.properties || []),
    { name: 'seatOverlays', type: 'string', value: `assets/tilesets/${OVERLAY_FILE}.png` }];
}

const allTilesets = [
  ...tilesets.map(({ firstgid, source }) => ({ firstgid, source })),
  { firstgid: charFirstGid, source: `tilesets/${CHAR_FILE}.tsx` },
  { firstgid: patchFirstGid, source: `tilesets/${PATCH_FILE}.tsx` },
];

const map = {
  compressionlevel: -1, infinite: false, orientation: 'orthogonal', renderorder: 'right-down',
  tiledversion: '1.12.1', version: '1.10', type: 'map',
  width: cols, height: rows, tilewidth: TILE, tileheight: TILE,
  nextlayerid: 9, nextobjectid: nextId,
  ...(CFG.properties ? { properties: CFG.properties } : {}),
  tilesets: allTilesets,
  layers: [
    { id: 1, name: 'Floor', type: 'tilelayer', visible: true, opacity: 1, x: 0, y: 0, width: cols, height: rows, data: floorLayer },
    { id: 2, name: 'Walls', type: 'tilelayer', visible: true, opacity: 1, x: 0, y: 0, width: cols, height: rows, data: wallLayer },
    { id: 3, name: 'Structure', type: 'objectgroup', visible: true, opacity: 1, x: 0, y: 0, draworder: 'index', objects: structureObjs },
    { id: 4, name: 'Furniture', type: 'objectgroup', visible: true, opacity: 1, x: 0, y: 0, draworder: 'index', objects: furnitureObjs },
    { id: 5, name: 'Characters', type: 'objectgroup', visible: true, opacity: 1, x: 0, y: 0, draworder: 'index', objects: characterObjs },
    { id: 6, name: 'Details', type: 'objectgroup', visible: true, opacity: 1, x: 0, y: 0, draworder: 'index', objects: detailObjs },
    { id: 7, name: 'Patch', type: 'tilelayer', visible: true, opacity: 1, x: 0, y: 0, width: cols, height: rows, data: patchLayer },
    { id: 8, name: 'Collision', type: 'objectgroup', visible: false, opacity: 1, x: 0, y: 0, draworder: 'index', objects: collision },
    { id: 9, name: 'Spawns', type: 'objectgroup', visible: false, opacity: 1, x: 0, y: 0, draworder: 'index', objects: spawns },
    ...(CFG.seatRules ? [{ id: 10, name: 'Seats', type: 'objectgroup', visible: false, opacity: 1, x: 0, y: 0, draworder: 'index', objects: seatObjs }] : []),
  ],
};
map.nextlayerid = CFG.seatRules ? 11 : 10;

fs.writeFileSync(OUT_TMJ, JSON.stringify(map, null, 1));

// Phaser copy: same map but with tilesets embedded (Phaser can't follow .tsx refs) and the
// images mirrored into public/. Generated here so the two can never drift apart.
const PUB_TS = 'public/assets/tilesets';
const PUB_MAP = 'public/assets/maps';
fs.mkdirSync(PUB_TS, { recursive: true });
fs.mkdirSync(PUB_MAP, { recursive: true });
const embedded = [];
for (const s of activeSheets) {
  fs.copyFileSync(path.join(TS_DIR, s.file), path.join(PUB_TS, s.file));
  embedded.push({ firstgid: s.firstgid, name: s.name, image: `assets/tilesets/${s.file}`,
    imagewidth: s.width, imageheight: s.height, tilewidth: TILE, tileheight: TILE,
    tilecount: s.cols * s.rows, columns: s.cols, margin: 0, spacing: 0 });
}
for (const [file, firstgid, name, w, h, c] of [
  [`${CHAR_FILE}.png`, charFirstGid, `Design_Characters${CFG.suffix}_16x16`, charSheetW, charRows * TILE, charCols],
  [`${PATCH_FILE}.png`, patchFirstGid, `Design_Patch${CFG.suffix}_16x16`, patchW, patchRows * TILE, patchCols],
]) {
  fs.copyFileSync(path.join(TS_DIR, file), path.join(PUB_TS, file));
  embedded.push({ firstgid, name, image: `assets/tilesets/${file}`, imagewidth: w, imageheight: h,
    tilewidth: TILE, tileheight: TILE, tilecount: c * Math.ceil((w * h) / (TILE * TILE) / c), columns: c,
    margin: 0, spacing: 0 });
}
const gameMap = { ...map, tilesets: embedded };
fs.writeFileSync(path.join(PUB_MAP, `${MAP_NAME}.json`), JSON.stringify(gameMap, null, 1));
fs.writeFileSync(path.join(PUB_MAP, `${MAP_NAME}.manifest.json`), JSON.stringify(
  embedded.map((t) => ({ key: path.basename(t.image, '.png'), image: t.image, firstgid: t.firstgid,
    tilecount: t.tilecount, columns: t.columns })), null, 1));

console.log(`\nwrote ${OUT_TMJ}: ${cols}x${rows}`);
console.log(`wrote ${PUB_MAP}/${MAP_NAME}.json (+ manifest, ${embedded.length} tilesets)`);
console.log(`  Floor/Walls tiles : ${floorLayer.filter(Boolean).length}/${wallLayer.filter(Boolean).length}`);
console.log(`  Structure objects : ${structureObjs.length}`);
console.log(`  Furniture objects : ${furnitureObjs.length}`);
console.log(`  Character objects : ${characterObjs.length}`);
console.log(`  Detail objects    : ${detailObjs.length}`);
console.log(`  Patch tiles       : ${patchCells.length}`);
console.log(`  Collision rects   : ${collision.length}`);
