'use strict';
/*
 * Composes Office_Design_1 (left) and Office_Design_2 (right) into one office, layer by layer,
 * so tools/build_map.js can decompose the result exactly as it does a single design.
 *
 * Why these offsets
 * -----------------
 * Design 2 has a corridor stub on its left edge (source rows 32-101) that leads off-canvas.
 * Its geometry is identical to Design 1's top wall: 6px cap, 25px wall face, 1px outline,
 * then floor. Shifting Design 2 up 32px relative to Design 1 lines the stub up with Design 1's
 * top wall exactly, and its floor (two tiles tall) with Design 1's open floor rows 2-3 at the
 * right edge — the only rows there not occupied by furniture.
 *
 * Horizontally both must stay on the 16px grid, or every tile of one design turns into an
 * off-grid object. On the grid the two walls land 9px apart (Design 1's right wall at x 192-198,
 * Design 2's left wall at x 201-207), so Design 1's floor is widened by 9px and the two walls
 * become one shared wall at x 201-207.
 *
 * Wall surgery (all in the composed canvas, Design 1 at (0,32), Design 2 at (192,0)):
 *   - Design 1's own right wall (x 192-198) is dropped.
 *   - x 192-206 is filled by copying Design 1's floor/wall layer from 16px to the left. Floor,
 *     wall faces and caps all repeat every 16px, so the copy is seamless.
 *   - Design 2 is pasted for source x >= 9 only. Its stub's lilac wall face is skipped so Design
 *     1's brick wall runs up to the doorway.
 *   - The doorway (two tiles tall) gets Design 2's grey floor across the whole tile column, so it
 *     stays one grid-aligned tile.
 *   - Below the doorway the shared wall starts with a closed end cap, the same style as Design 1's
 *     own top-right corner.
 *   - Below Design 2's upper room, Design 1's right wall and bottom corner are moved 9px right
 *     to close Design 1's side.
 *
 * Usage: node tools/compose_designs.js [out.png]   (writes a 1x preview of the composite)
 */

const ase = require('./aseprite.js');

const DESIGNS = 'public/assets/tilesets/Modern_Office_Revamped_v1.2/6_Office_Designs';
const TILE = 16;

const D1 = { ox: 0, oy: 32 };    // Design 1 placement in the composed canvas
const D2 = { ox: 192, oy: 0 };   // Design 2 placement (Design 2 sits 32px higher)

function loadLayers(file) {
  const doc = ase.parse(file);
  return { w: doc.width, h: doc.height, layers: doc.layers.map((l) => ase.layerToBGRA(doc, l.index, 0)) };
}

function compose() {
  const d1 = loadLayers(`${DESIGNS}/Office_Design_1.aseprite`);
  const d2 = loadLayers(`${DESIGNS}/Office_Design_2.aseprite`);

  const W = Math.ceil((D2.ox + 247) / TILE) * TILE;  // 247 = Design 2 content width
  const H = Math.ceil(Math.max(D1.oy + 182, D2.oy + 262) / TILE) * TILE;
  const nLayers = Math.max(d1.layers.length, d2.layers.length);
  const out = Array.from({ length: nLayers }, () => Buffer.alloc(W * H * 4, 0));

  const get = (src, x, y) => {
    if (x < 0 || y < 0 || x >= src.w || y >= src.h) return null;
    return [src.buf[(y * src.w + x) * 4], src.buf[(y * src.w + x) * 4 + 1],
      src.buf[(y * src.w + x) * 4 + 2], src.buf[(y * src.w + x) * 4 + 3]];
  };
  const put = (buf, x, y, p) => {
    if (!p || x < 0 || y < 0 || x >= W || y >= H) return;
    const d = (y * W + x) * 4;
    buf[d] = p[0]; buf[d + 1] = p[1]; buf[d + 2] = p[2]; buf[d + 3] = p[3];
  };
  const pasteOpaque = (buf, src, ox, oy, keep) => {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const p = get(src, x, y);
      if (p[3] && (!keep || keep(x, y))) put(buf, ox + x, oy + y, p);
    }
  };
  const L = (doc, i) => ({ w: doc.w, h: doc.h, buf: doc.layers[i] });

  // ---- layer 0: floor + walls --------------------------------------------------------------
  const f = out[0];
  const d1f = L(d1, 0), d2f = L(d2, 0);

  // Design 1 without its right wall.
  pasteOpaque(f, d1f, D1.ox, D1.oy, (x) => x < 192);

  // Widen Design 1 to x 206 by repeating its floor/wall pattern one tile to the left.
  for (let y = 0; y < d1f.h; y++) for (let x = 192; x <= 206; x++) {
    const p = get(d1f, x - TILE, y);
    if (p && p[3]) put(f, D1.ox + x, D1.oy + y, p);
  }

  // Design 2 from its left wall rightwards, minus the stub's lilac face (x 9-14, y 38-62).
  pasteOpaque(f, d2f, D2.ox, D2.oy, (x, y) => x >= 9 && !(x <= 14 && y >= 38 && y <= 62));

  // Doorway floor: Design 2's stub floor across the full tile column, rows 64-95.
  for (let y = 64; y <= 95; y++) for (let x = 0; x < TILE; x++) put(f, D2.ox + x, D2.oy + y, get(d2f, x, y));

  // Shared wall starts below the doorway with a closed cap (source y 96 is already outline).
  const OUTLINE = get(d2f, 9, 120), FILL = get(d2f, 11, 120);
  for (let y = 97; y <= 100; y++) {
    put(f, D2.ox + 9, D2.oy + y, OUTLINE);
    for (let x = 10; x <= 14; x++) put(f, D2.ox + x, D2.oy + y, FILL);
    put(f, D2.ox + 15, D2.oy + y, OUTLINE);
  }

  // Below Design 2's upper room (its bottom cap ends at source y 165), Design 1's right wall and
  // bottom-right corner shift 9px right to x 201-207.
  const lastD2Row = D2.oy + 165;
  for (let y = 0; y < d1f.h; y++) {
    if (D1.oy + y <= lastD2Row) continue;
    for (let x = 192; x <= 198; x++) {
      const p = get(d1f, x, y);
      if (p && p[3]) put(f, D1.ox + x + 9, D1.oy + y, p);
    }
  }

  // ---- layers 1+: furniture, characters, details — straight placement --------------------
  for (let i = 1; i < nLayers; i++) {
    if (i < d1.layers.length) pasteOpaque(out[i], L(d1, i), D1.ox, D1.oy);
    if (i < d2.layers.length) pasteOpaque(out[i], L(d2, i), D2.ox, D2.oy);
  }

  // The shared wall (x 201-207) sits in the right 7px of tile column 12, with 9px of widened
  // floor beside it, so the build's coverage test sees a mostly-floor cell and leaves it walkable
  // — letting the player walk through the wall from one office into the other. Every cell of the
  // shared wall below the doorway is blocked explicitly.
  const wallCol = Math.floor((D2.ox + 9) / TILE);
  const forceBlocked = [];
  for (let ty = Math.floor((D2.oy + 96) / TILE); ty <= Math.floor((D1.oy + 181) / TILE); ty++) {
    forceBlocked.push([wallCol, ty]);
  }

  return {
    width: W, height: H,
    layers: out.map((_, i) => ({ index: i, name: `Layer ${i + 1}` })),
    layerPx: out,
    forceBlocked,
  };
}

/*
 * Seats, in each design's own coordinates. A seat has:
 *   tile    — the walkable cell you stand on to sit (it stays walkable even though a chair covers
 *             it; coverage alone can't tell a chair from a plant or table, so seats are listed)
 *   sit     — where the character's feet go once seated (sprite origin is bottom-centre)
 *   facing  — which way the chair faces, read off the art:
 *               up    chair seen from behind (desk chairs facing their desk, the blue waiting chairs)
 *               down  backrest at the top, seat toward the viewer (armchairs, mesh chairs)
 *               left / right  side chairs, backrest on the opposite side
 *   overlay — for 'up' only: the chair art drawn back OVER the seated character so it hides the
 *             body, exactly as Office_Design_2 does with its own seated worker (its 4th layer is a
 *             copy of that chair laid over the character).
 * Positions come from measuring the art: the designs' own seated characters put the head 8px
 * (desk chairs) / 10px (blue chairs) above the chair top; the walking frame's head is 23px above
 * the feet, sit3's feet are on frame row 30, and sit's body spans x 6-21 of its 32px frame.
 * Two chairs already have a character painted into the art (blue chair D1 (7,10), desk chair
 * D2 (9,9)), so they are not seats.
 */
const D2_CHAIR_OVERLAY = { layer: 3, x: 144, y: 137, w: 16, h: 21 }; // Office_Design_2's own chair-over-character
const deskChairUp = (tx, ty) => ({                                  // Design 2 cubicle chair, facing its desk
  tile: [tx, ty], sit: [tx * 16 + 8, ty * 16 + 8], facing: 'up',
  overlay: { from: D2_CHAIR_OVERLAY, x: tx * 16, y: ty * 16 - 7 },
});
const D1_SEATS = [
  { tile: [6, 3], sit: [100, 61], facing: 'left' },                 // orange side chair by the manager's desk
  { tile: [8, 10], sit: [136, 176], facing: 'up', overlay: { from: { layer: 1, x: 128, y: 164, w: 16, h: 12 }, x: 128, y: 164 } },
  { tile: [9, 10], sit: [152, 176], facing: 'up', overlay: { from: { layer: 1, x: 144, y: 164, w: 16, h: 12 }, x: 144, y: 164 } },
  { tile: [0, 7], sit: [8, 121], facing: 'down' },                  // lounge armchairs
  { tile: [1, 7], sit: [24, 121], facing: 'down' },
];
const D2_SEATS = [
  deskChairUp(4, 5), deskChairUp(7, 5), deskChairUp(10, 5),         // front cubicle row
  deskChairUp(3, 9), deskChairUp(6, 9), deskChairUp(12, 9),         // back cubicle row ((9,9) is occupied)
  { tile: [3, 5], sit: [56, 106], facing: 'down' },                 // mesh-back chairs
  { tile: [9, 5], sit: [152, 106], facing: 'down' },
  { tile: [7, 12], sit: [124, 203], facing: 'right' },              // orange chair, lower-left room
];

/**
 * Seats for a map, in that map's coordinates. Overlay sources keep their own design's
 * coordinates (`design`) so the build can lift the chair pixels from the right file.
 */
function seatsFor(mapName) {
  if (mapName !== 'office_v3') return [];
  const place = (s, o, design) => ({
    tile: [s.tile[0] + o.ox / TILE, s.tile[1] + o.oy / TILE],
    sit: [s.sit[0] + o.ox, s.sit[1] + o.oy],
    facing: s.facing,
    overlay: s.overlay ? { design, from: s.overlay.from, x: s.overlay.x + o.ox, y: s.overlay.y + o.oy } : null,
  });
  return [...D1_SEATS.map((s) => place(s, D1, 1)), ...D2_SEATS.map((s) => place(s, D2, 2))];
}

/** Raw layers of one source design (1 or 2), for lifting overlay pixels. */
function designLayers(n) {
  return loadLayers(`${DESIGNS}/Office_Design_${n}.aseprite`);
}

/** All layers flattened with the same over-compositing build_map.js uses for its truth image. */
function flatten(comp) {
  const t = Buffer.alloc(comp.width * comp.height * 4, 0);
  for (const p of comp.layerPx) {
    for (let i = 0; i < t.length; i += 4) {
      const a = p[i + 3];
      if (!a) continue;
      if (a === 255 || t[i + 3] === 0) { t[i] = p[i]; t[i + 1] = p[i + 1]; t[i + 2] = p[i + 2]; t[i + 3] = a; }
      else {
        const ia = 255 - a;
        t[i] = Math.round((p[i] * a + t[i] * ia) / 255);
        t[i + 1] = Math.round((p[i + 1] * a + t[i + 1] * ia) / 255);
        t[i + 2] = Math.round((p[i + 2] * a + t[i + 2] * ia) / 255);
        t[i + 3] = Math.max(t[i + 3], a);
      }
    }
  }
  return t;
}

module.exports = { compose, flatten, seatsFor, designLayers };

if (require.main === module) {
  const fs = require('fs');
  const png = require('./png.js');
  const comp = compose();
  const outFile = process.argv[2] || 'composite_preview.png';
  fs.writeFileSync(outFile, png.encodeBGRA(flatten(comp), comp.width, comp.height));
  console.log(`composite ${comp.width}x${comp.height}, ${comp.layers.length} layers -> ${outFile}`);
}
