/*
 * A* over the map's walkable grid.
 *
 * Not needed for keyboard play, but it is what makes NPCs and click-to-move possible, and a
 * path is just a list of waypoints a Character walks toward with setIntent — the same input
 * path the keyboard uses, so there is no second movement implementation.
 */
class Pathfinder {
  /** @param {Phaser.Tilemaps.Tilemap} map a map with a 'Collision' object layer */
  constructor(map, tileSize = 16) {
    this.w = map.width;
    this.h = map.height;
    this.tile = tileSize;
    this.blocked = new Uint8Array(this.w * this.h);

    // Collision is the single source of truth. Do NOT also treat "no Floor-layer tile" as
    // blocked: office_v2 keeps most of its floor in object layers (only 134 of 272 cells are
    // Floor tiles), so that check marked most of a perfectly walkable map as void. The map
    // builders already fold inside/outside into Collision.
    const collision = map.getObjectLayer('Collision');
    if (collision) {
      for (const r of collision.objects) {
        for (let y = Math.floor(r.y / tileSize); y < Math.floor((r.y + r.height) / tileSize); y++) {
          for (let x = Math.floor(r.x / tileSize); x < Math.floor((r.x + r.width) / tileSize); x++) {
            if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.blocked[y * this.w + x] = 1;
          }
        }
      }
    }
  }

  isWalkable(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h && !this.blocked[ty * this.w + tx];
  }

  /** @returns {Array<{x,y}>} tile waypoints from start to goal, empty if unreachable. */
  find(sx, sy, gx, gy) {
    if (!this.isWalkable(gx, gy) || !this.isWalkable(sx, sy)) return [];
    const start = sy * this.w + sx, goal = gy * this.w + gx;
    if (start === goal) return [];

    const open = [start];
    const came = new Map();
    const g = new Map([[start, 0]]);
    const h = (i) => Math.abs((i % this.w) - gx) + Math.abs(Math.floor(i / this.w) - gy);
    const f = new Map([[start, h(start)]]);

    while (open.length) {
      // Small maps, so a linear scan for the best node is cheaper than a heap.
      let bi = 0;
      for (let i = 1; i < open.length; i++) if ((f.get(open[i]) ?? 1e9) < (f.get(open[bi]) ?? 1e9)) bi = i;
      const cur = open.splice(bi, 1)[0];

      if (cur === goal) {
        const path = [];
        for (let n = cur; n !== start; n = came.get(n)) path.push({ x: n % this.w, y: Math.floor(n / this.w) });
        return path.reverse();
      }

      const cx = cur % this.w, cy = Math.floor(cur / this.w);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!this.isWalkable(nx, ny)) continue;
        const n = ny * this.w + nx;
        const tentative = (g.get(cur) ?? 1e9) + 1;
        if (tentative < (g.get(n) ?? 1e9)) {
          came.set(n, cur);
          g.set(n, tentative);
          f.set(n, tentative + h(n));
          if (!open.includes(n)) open.push(n);
        }
      }
    }
    return [];
  }
}

if (typeof module !== 'undefined') module.exports = Pathfinder;
