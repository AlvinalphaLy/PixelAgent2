'use strict';
/*
 * Navigability gate for a playable map. The pixel gates prove a map *looks* right; this
 * proves it can actually be walked.
 *
 * office_v2 taught the lesson: it is 28% walkable and splits into 5 disconnected pockets
 * with no route between the main office and the bottom rooms. That is invisible in a
 * screenshot and obvious to this check.
 *
 * Usage: node tools/verify_walkable.js [maps/office_play.tmj]
 * Exits non-zero unless every assertion passes.
 */

const fs = require('fs');

const TILE = 16;
const MIN_WALKABLE_PCT = 45;
const mapPath = process.argv[2] || 'maps/office_play.tmj';
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const W = map.width, H = map.height;

const layer = (name) => map.layers.find((l) => l.name === name);
const points = (name, type) => {
  const l = layer(name);
  return l ? l.objects.filter((o) => !type || o.type === type) : [];
};

// --- walkability grid --------------------------------------------------------
const blocked = new Uint8Array(W * H);
for (const r of (layer('Collision') || { objects: [] }).objects) {
  for (let y = Math.floor(r.y / TILE); y < Math.floor((r.y + r.height) / TILE); y++) {
    for (let x = Math.floor(r.x / TILE); x < Math.floor((r.x + r.width) / TILE); x++) {
      if (x >= 0 && y >= 0 && x < W && y < H) blocked[y * W + x] = 1;
    }
  }
}

// Interior = anywhere with a floor tile; walkability is measured against that, not the whole
// canvas, so a map padded with empty space isn't unfairly penalised.
const floor = layer('Floor').data;
let interior = 0;
for (let i = 0; i < W * H; i++) if (floor[i]) interior++;

let walkable = 0;
for (let i = 0; i < W * H; i++) if (floor[i] && !blocked[i]) walkable++;

// --- connected components ----------------------------------------------------
const seen = new Uint8Array(W * H);
const components = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (blocked[i] || seen[i] || !floor[i]) continue;
    const stack = [[x, y]];
    const cells = [];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
      const j = cy * W + cx;
      if (seen[j] || blocked[j] || !floor[j]) continue;
      seen[j] = 1;
      cells.push([cx, cy]);
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    components.push(cells);
  }
}
components.sort((a, b) => b.length - a.length);

const main = new Set((components[0] || []).map(([x, y]) => y * W + x));
const reachable = (px, py) => main.has(Math.floor(py / TILE) * W + Math.floor(px / TILE));

// --- assertions --------------------------------------------------------------
const pct = interior ? (100 * walkable / interior) : 0;
const failures = [];

if (components.length !== 1) {
  failures.push(`walkable area is split into ${components.length} components ` +
    `(sizes ${components.slice(0, 6).map((c) => c.length).join(', ')}${components.length > 6 ? ' …' : ''})`);
}
if (pct < MIN_WALKABLE_PCT) failures.push(`only ${pct.toFixed(1)}% of interior is walkable (need >= ${MIN_WALKABLE_PCT}%)`);

const spawn = points('Spawns', 'spawn')[0];
if (!spawn) failures.push('no player_spawn point');
else if (!reachable(spawn.x, spawn.y)) failures.push('player spawn is not in the main walkable region');

for (const room of points('Spawns', 'room_centre')) {
  if (!reachable(room.x, room.y)) failures.push(`room centre "${room.name}" is unreachable`);
}
const seats = points('Seats');
for (const s of seats) {
  if (!reachable(s.x, s.y)) failures.push(`seat "${s.name}" is not walkable/reachable`);
}

// --- report ------------------------------------------------------------------
console.log(`map            : ${mapPath} (${W}x${H})`);
console.log(`interior tiles : ${interior}`);
console.log(`walkable       : ${walkable} (${pct.toFixed(1)}%)`);
console.log(`components     : ${components.length}${components.length ? `, largest ${components[0].length}` : ''}`);
console.log(`seats          : ${seats.length}, all reachable: ${seats.every((s) => reachable(s.x, s.y))}`);
console.log('');
for (let y = 0; y < H; y++) {
  let line = '';
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    line += !floor[i] ? ' ' : blocked[i] ? '#' : (main.has(i) ? '.' : '!');
  }
  console.log(String(y).padStart(2) + ' ' + line);
}
console.log("   ' '=no floor  .=walkable  #=blocked  !=STRANDED");

console.log('');
if (failures.length) {
  console.log('GATE: FAIL');
  for (const f of failures) console.log('  - ' + f);
  process.exitCode = 1;
} else {
  console.log('GATE: PASS — single connected region, all rooms and seats reachable');
}
