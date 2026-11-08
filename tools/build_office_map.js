'use strict';
/*
 * Generates maps/office_play.tmj — a purpose-built, navigable office.
 *
 * This is the counterpart to build_map.js. That one reproduces reference art exactly and is
 * unwalkable (28% walkable, 5 disconnected pockets) because promo art is drawn to look good,
 * not to be navigated. This one is authored for play: wide aisles, connected rooms, and a
 * walkable seat tile in front of every desk.
 *
 * The layout is declarative — reshape the office by editing LAYOUT, not the code.
 * Tile ids come from the verified catalogue in docs/MAP_BUILDING_FRAMEWORK.md.
 */

const fs = require('fs');
const path = require('path');

const TILE = 16;
const OUT_TMJ = 'maps/office_play.tmj';
const PUB_MAP = 'public/assets/maps';
const PUB_TS = 'public/assets/tilesets';

// --- tilesets (already staged in maps/tilesets by build_map.js) ---------------
const SHEETS = [
  { key: 'office', name: 'Room_Builder_Office_16x16', file: 'office_floor_walls.png',
    firstgid: 1, cols: 16, rows: 14, width: 256, height: 224 },
  { key: 'furniture', name: 'Modern_Office_Shadowless_16x16', file: 'furniture.png',
    firstgid: 225, cols: 16, rows: 53, width: 256, height: 848 },
];
const office = (local) => 1 + local;
const furn = (local) => 225 + local;

// Verified tile ids — never place an unverified id (locals 0 and 496 are blank edge slices).
const T = {
  floorGrey: office(90),
  floorWood: office(144),
  wallH: office(1),
  wallV: office(10),
  corner: office(18),
};
const F = {
  deskL: furn(288), deskM: furn(289), deskR: furn(290),
  monitor: furn(169),
  chair: furn(128),
  divider: furn(416),
  plant: furn(134),
  plantTall: furn(199),
  printer: furn(186),
  bookshelf: furn(217),
  whiteboard: furn(235),
  chart: furn(250),
};

// --- layout ------------------------------------------------------------------
// Aisles are 2+ tiles wide: furniture overhangs its cell, and 1-tile aisles get swallowed
// by collision. That is the main reason the reproduced map fragmented.
const LAYOUT = {
  size: { w: 30, h: 24 },
  rooms: [
    { name: 'main', x: 1, y: 1, w: 28, h: 14, floor: T.floorGrey },
    { name: 'break', x: 1, y: 16, w: 12, h: 7, floor: T.floorWood },
    { name: 'meeting', x: 14, y: 16, w: 15, h: 7, floor: T.floorGrey },
  ],
  // Interior wall runs, with gaps left walkable.
  interiorWalls: [
    { x1: 1, y1: 15, x2: 28, y2: 15, gaps: [[5, 6], [19, 20]] },   // main | bottom rooms
    { x1: 13, y1: 16, x2: 13, y2: 22, gaps: [[19, 19]] },          // break | meeting
  ],
  // Each desk is 3 wide with its seat tile directly below (the 'down' side).
  deskRows: [
    { y: 3, xs: [3, 9, 15, 21] },
    { y: 9, xs: [3, 9, 15, 21] },
  ],
  spawn: { x: 14, y: 13 },
};

const W = LAYOUT.size.w, H = LAYOUT.size.h;
const idx = (x, y) => y * W + x;

const floorLayer = new Array(W * H).fill(0);
const wallLayer = new Array(W * H).fill(0);
const objects = [];      // { gid, tx, ty, blocks }
const seats = [];        // walkable tiles a character can sit on
const roomCentres = [];

// --- floors ------------------------------------------------------------------
for (const r of LAYOUT.rooms) {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) floorLayer[idx(x, y)] = r.floor;
  }
  roomCentres.push({ name: r.name, x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) });
}

// --- perimeter ---------------------------------------------------------------
const H_FLIP = 0x80000000, V_FLIP = 0x40000000;
for (let x = 1; x < W - 1; x++) {
  wallLayer[idx(x, 0)] = T.wallH;
  wallLayer[idx(x, H - 1)] = T.wallH;
}
for (let y = 1; y < H - 1; y++) {
  wallLayer[idx(0, y)] = T.wallV;
  wallLayer[idx(W - 1, y)] = T.wallV + H_FLIP;
}
wallLayer[idx(0, 0)] = T.corner;
wallLayer[idx(W - 1, 0)] = T.corner + H_FLIP;
wallLayer[idx(0, H - 1)] = T.corner + V_FLIP;
wallLayer[idx(W - 1, H - 1)] = T.corner + H_FLIP + V_FLIP;

// --- interior walls ----------------------------------------------------------
// Interior wall runs sit between rooms, on tiles no room's floor covers. A doorway therefore
// needs floor laid explicitly or it is a hole, not a door — the walkability gate caught this
// stranding both bottom rooms on the first run.
const floorNear = (x, y) => floorLayer[idx(x, y - 1)] || floorLayer[idx(x, y + 1)] ||
                            floorLayer[idx(x - 1, y)] || floorLayer[idx(x + 1, y)] || T.floorGrey;
for (const run of LAYOUT.interiorWalls) {
  const horizontal = run.y1 === run.y2;
  const inGap = (x, y) => (run.gaps || []).some(([a, b]) => {
    const v = horizontal ? x : y;
    return v >= a && v <= b;
  });
  if (horizontal) {
    for (let x = run.x1; x <= run.x2; x++) {
      if (inGap(x, run.y1)) floorLayer[idx(x, run.y1)] = floorNear(x, run.y1);
      else wallLayer[idx(x, run.y1)] = T.wallH;
    }
  } else {
    for (let y = run.y1; y <= run.y2; y++) {
      if (inGap(run.x1, y)) floorLayer[idx(run.x1, y)] = floorNear(run.x1, y);
      else wallLayer[idx(run.x1, y)] = T.wallV;
    }
  }
}

// --- workstations ------------------------------------------------------------
for (const row of LAYOUT.deskRows) {
  for (const x of row.xs) {
    objects.push({ gid: F.deskL, tx: x, ty: row.y, blocks: true });
    objects.push({ gid: F.deskM, tx: x + 1, ty: row.y, blocks: true });
    objects.push({ gid: F.deskR, tx: x + 2, ty: row.y, blocks: true });
    objects.push({ gid: F.monitor, tx: x + 1, ty: row.y, blocks: false });
    // Seat tile sits below the desk so a character can face it (direction 'up').
    objects.push({ gid: F.chair, tx: x + 1, ty: row.y + 1, blocks: false });
    seats.push({ x: x + 1, y: row.y + 1 });
    // Divider to the right of each cluster, leaving the aisle itself clear.
    objects.push({ gid: F.divider, tx: x + 3, ty: row.y, blocks: false });
  }
}

// --- decor -------------------------------------------------------------------
const decor = [
  { gid: F.bookshelf, tx: 2, ty: 1, blocks: true },
  { gid: F.whiteboard, tx: 12, ty: 1, blocks: true },
  { gid: F.chart, tx: 17, ty: 1, blocks: true },
  { gid: F.printer, tx: 26, ty: 3, blocks: true },
  { gid: F.plantTall, tx: 27, ty: 1, blocks: true },
  { gid: F.plant, tx: 27, ty: 13, blocks: true },
  // break room
  { gid: F.plant, tx: 2, ty: 21, blocks: true },
  { gid: F.printer, tx: 11, ty: 17, blocks: true },
  { gid: F.plantTall, tx: 11, ty: 21, blocks: true },
  // meeting room
  { gid: F.whiteboard, tx: 21, ty: 16, blocks: true },
  { gid: F.plant, tx: 27, ty: 21, blocks: true },
];
objects.push(...decor);

// --- collision ---------------------------------------------------------------
const blocked = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  if (!floorLayer[i]) blocked[i] = 1;   // outside any room
  if (wallLayer[i]) blocked[i] = 1;
}
for (const o of objects) if (o.blocks) blocked[idx(o.tx, o.ty)] = 1;

const collision = [];
let nextId = 1;
for (let y = 0; y < H; y++) {
  let run = null;
  for (let x = 0; x <= W; x++) {
    const isBlocked = x < W && blocked[idx(x, y)];
    if (isBlocked) { if (!run) run = { x, w: 0 }; run.w++; }
    else if (run) {
      collision.push({ id: nextId++, name: 'blocked', type: 'collision', rotation: 0, visible: true,
        x: run.x * TILE, y: y * TILE, width: run.w * TILE, height: TILE });
      run = null;
    }
  }
}

// --- emit --------------------------------------------------------------------
// Tiled anchors tile objects bottom-left, so y is (ty + 1) * TILE for a 1-tall object.
const furnitureObjects = objects.map((o) => ({
  id: nextId++, name: 'furniture', type: '', rotation: 0, visible: true,
  gid: o.gid, width: TILE, height: TILE, x: o.tx * TILE, y: (o.ty + 1) * TILE,
}));
const seatObjects = seats.map((s, i) => ({
  id: nextId++, name: `seat_${i + 1}`, type: 'seat', rotation: 0, visible: true, point: true,
  x: s.x * TILE + TILE / 2, y: s.y * TILE + TILE / 2,
}));
const spawnObjects = [{
  id: nextId++, name: 'player_spawn', type: 'spawn', rotation: 0, visible: true, point: true,
  x: LAYOUT.spawn.x * TILE + TILE / 2, y: LAYOUT.spawn.y * TILE + TILE / 2,
}, ...roomCentres.map((c) => ({
  id: nextId++, name: `room_${c.name}`, type: 'room_centre', rotation: 0, visible: true, point: true,
  x: c.x * TILE + TILE / 2, y: c.y * TILE + TILE / 2,
}))];

const map = {
  compressionlevel: -1, infinite: false, orientation: 'orthogonal', renderorder: 'right-down',
  tiledversion: '1.12.1', version: '1.10', type: 'map',
  width: W, height: H, tilewidth: TILE, tileheight: TILE,
  nextlayerid: 7, nextobjectid: nextId,
  properties: [{ name: 'camera', type: 'string', value: 'follow' }],
  tilesets: SHEETS.map((s) => ({ firstgid: s.firstgid, source: `tilesets/${s.file.replace(/\.png$/, '.tsx')}` })),
  layers: [
    { id: 1, name: 'Floor', type: 'tilelayer', visible: true, opacity: 1, x: 0, y: 0, width: W, height: H, data: floorLayer },
    { id: 2, name: 'Walls', type: 'tilelayer', visible: true, opacity: 1, x: 0, y: 0, width: W, height: H, data: wallLayer },
    { id: 3, name: 'Furniture', type: 'objectgroup', visible: true, opacity: 1, x: 0, y: 0, draworder: 'index', objects: furnitureObjects },
    { id: 4, name: 'Collision', type: 'objectgroup', visible: false, opacity: 1, x: 0, y: 0, draworder: 'index', objects: collision },
    { id: 5, name: 'Seats', type: 'objectgroup', visible: false, opacity: 1, x: 0, y: 0, draworder: 'index', objects: seatObjects },
    { id: 6, name: 'Spawns', type: 'objectgroup', visible: false, opacity: 1, x: 0, y: 0, draworder: 'index', objects: spawnObjects },
  ],
};

fs.writeFileSync(OUT_TMJ, JSON.stringify(map, null, 1));

// Phaser copy with tilesets embedded, generated in the same run so they cannot drift.
fs.mkdirSync(PUB_MAP, { recursive: true });
const embedded = SHEETS.map((s) => ({
  firstgid: s.firstgid, name: s.name, image: `assets/tilesets/${s.file}`,
  imagewidth: s.width, imageheight: s.height, tilewidth: TILE, tileheight: TILE,
  tilecount: s.cols * s.rows, columns: s.cols, margin: 0, spacing: 0,
}));
fs.writeFileSync(path.join(PUB_MAP, 'office_play.json'), JSON.stringify({ ...map, tilesets: embedded }, null, 1));
fs.writeFileSync(path.join(PUB_MAP, 'office_play.manifest.json'), JSON.stringify(
  embedded.map((t) => ({ key: path.basename(t.image, '.png'), image: t.image, firstgid: t.firstgid,
    tilecount: t.tilecount, columns: t.columns })), null, 1));

for (const s of SHEETS) {
  const src = path.join('maps/tilesets', s.file);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(PUB_TS, s.file));
}

console.log(`wrote ${OUT_TMJ}: ${W}x${H}`);
console.log(`  furniture objects : ${furnitureObjects.length}`);
console.log(`  seats             : ${seatObjects.length}`);
console.log(`  collision rects   : ${collision.length}`);
console.log(`  rooms             : ${roomCentres.map((r) => r.name).join(', ')}`);
