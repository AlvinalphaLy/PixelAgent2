# How `office_v2` Was Built — Pixel-Perfect Reproduction of `Office_Design_2`

**Audience:** whoever maintains this repo, rebuilds this map, or recreates it in another project — including a future Claude session.

> If you only need to **recreate the map elsewhere**, skip to [Reproducing this exactly](#reproducing-this-exactly). That section is the specification; everything before it is the story of how it was arrived at.

## Result

`maps/office_v2.tmj` reproduces `Office_Design_2.gif` with **zero differing pixels**, verified three independent ways:

| Check | Result |
|---|---|
| vs aseprite source, via Tiled's rasterizer | 58378/58378 — **0 differing** |
| vs `Office_Design_2.gif` at 2× | 233512/233512 — **0 differing** |
| vs the live Phaser canvas | 58378/58378 — **0 differing** |

Of the finished image, **87.74% is real tileset art** placed as tiles and objects. The remaining **12.26% (7157 px)** is a per-pixel patch overlay — art the shipped tilesets cannot express.

---

## The discovery that made it possible

The first three attempts eyeballed the layout and kept landing visibly wrong. The breakthrough was realising the reference **was not something to approximate** — it ships inside the LimeZu pack already on disk:

```
public/assets/tilesets/Modern_Office_Revamped_v1.2/6_Office_Designs/
  Office_Design_2.gif       512x544   <- the reference
  Office_Design_2.aseprite  layered source
```

Two measurements then settled everything:

1. **The GIF is exactly a 2× nearest upscale of the aseprite** — 58378/58378 pixels at offset (0,0). So matching the aseprite at 1× *is* matching the GIF. All work targets 1×.
2. **The real grid is 16×17 tiles**, not the 26×25 or 32×34 guessed earlier. The aseprite canvas is 256×400 with a 16×16 grid field; content occupies (0,0)–(246,261).

Earlier guesses failed because the GIF is 2×. Slicing it at 16px made flat floor "match" (uniform grey matches uniform grey) while every detailed sprite failed — a misleading partial success that hid the real problem.

**Lesson: find the source of truth before trying to imitate it.**

---

## Pipeline

```bash
node tools/build_map.js     # decompose + emit map (also exports the Phaser copy)
node tools/verify_map.js    # gate 1: Tiled render + GIF, exits non-zero on any diff
node tools/verify_phaser.js # gate 2: live Phaser canvas (needs the dev server running)
```

| Tool | Role |
|---|---|
| `tools/dump_rgba.ps1` | Converts any image (incl. animated GIF frame 0) to raw BGRA via .NET, so Node needs no image-decoding dependency |
| `tools/aseprite.js` | Minimal `.aseprite` parser — layers, cels, zlib-compressed pixel data |
| `tools/png.js` | Dependency-free PNG encode/decode on Node's zlib |
| `tools/build_map.js` | The decomposition and map emitter |
| `tools/verify_map.js` | Gate 1 |
| `tools/verify_phaser.js` | Gate 2 |

### What `build_map.js` actually does

1. **Load every candidate sheet** — 6 of them, 2504 tiles. Critically this includes the pack's *previous version* (`7_Modern_Office_Previous_Version`). Floor cells were matching the current sheets at 0.96 mean error but never exactly; the design predates the v1.2 revamp in places. Adding the old sheets lifted exact layer-0 coverage from 78% to 84%.
2. **Parse the aseprite into layers.** The artist's own separation does the hard work:
   - layer 0 — floor + walls
   - layer 1 — furniture
   - layer 2 — two characters (Modern Interiors art we don't own)
   - layer 3 — one small object
3. **Decompose each layer into tile placements.** Matching is **exact**, never tolerant — tolerant matching reproduces *nearly* the right pixels, which is exactly what we're eliminating. Each candidate is scored by **net error reduction** (pixels it fixes minus pixels it breaks) against its layer. This handles occlusion and draw order implicitly: sprites are appended in the order they improve the render, so whatever ends up on top is what the source has on top.
4. **Extract the characters.** Their pixels ship inside the design file, so they're lifted into a generated `maps/tilesets/characters.png` rather than matched.
5. **Patch the remainder.** Any pixel still wrong is baked into `maps/tilesets/patch.png` — transparent except the corrections — so 100% is a construction, not a hope.
6. **Export the Phaser copy** (`public/assets/maps/office_v2.json` + a tileset manifest) in the same run, so the two cannot drift.

---

# Reproducing this exactly

Everything below is the specification. It is enough to regenerate the map, or to read and hand-edit it, without reverse-engineering the source.

## Coordinate system and conventions

Get these wrong and the map is subtly or catastrophically misplaced. The bottom-left rule in particular cost real time during development.

**Geometry.** Tile size **16 × 16**. Grid **16 wide × 17 tall**. Content origin `(0, 0)` in source pixels. Rendered canvas **256 × 272**.

**Tile layers.** `data` is a flat row-major array: `index = y * width + x`. A value of `0` means empty.

**GIDs.**
```
GID      = firstgid + localId
localId  = row * columns + col          (within that tileset's own sheet)
```
A GID is meaningless without knowing which tileset owns it — see the registry below. To resolve one: find the tileset with the **largest** `firstgid` that is `<= gid`.

**Flip bits are additive on the GID:**

| Flip | Add |
|---|---|
| Horizontal | `0x80000000` |
| Vertical | `0x40000000` |
| Diagonal | `0x20000000` |

Mask them off before computing `localId`.

**⚠️ Tile objects anchor BOTTOM-LEFT.** This is the single most important convention here, and the easiest to get wrong. An object whose **top-left tile** is `(tx, ty)` and which is `h` tiles tall is written:

```
x = tx * 16
y = (ty + h) * 16        <-- NOT ty * 16
```

For the 1-tile-tall objects used throughout this map, that is `y = (ty + 1) * 16`. Using `ty * 16` shifts every object up exactly one row — which is precisely the bug that produced overlapping desks and wall decor mid-project.

In a renderer, the equivalent is `setOrigin(0, 1)` on the sprite.

**Object z-order is array order.** Object layers use `draworder: "index"`, so the sequence objects appear in the file *is* the draw order. Reordering them changes the image.

**Layer order is render order.** In particular `Patch` must be created **last** — it holds per-pixel corrections, so creating it alongside the other tile layers buries it beneath the furniture. That exact mistake made Tiled render 100% while Phaser rendered 91.55%.

**`Collision` and `Spawns` must stay `visible: false`.** Tiled's rasterizer draws object markers for visible layers, which corrupts any pixel comparison.

## Tileset registry

GIDs only mean anything with this exact set, in this exact order. `characters.tsx` and `patch.tsx` are **generated by the build**, not shipped.

| firstgid | tileset | tiles | source |
|---|---|---|---|
| 1 | `office_floor_walls.tsx` | 224 | `1_Room_Builder_Office/Room_Builder_Office_16x16.png` |
| 225 | `furniture.tsx` | 848 | `3_Modern_Office_Shadowless/Modern_Office_Shadowless_16x16.png` |
| 1073 | `furniture_shadow.tsx` | 848 | `2_Modern_Office_Black_Shadow/Modern_Office_Black_Shadow.png` |
| 1921 | `old_walls_floors.tsx` | 192 | `7_..._Previous_Version/Modern_Office_old/Office_walls_floors_16x16.png` |
| 2113 | `old_interiors.tsx` | 528 | `7_..._Previous_Version/Modern_Office_old/Office_interiors_16x16.png` |
| 2641 | `old_interiors_shadowless.tsx` | 528 | `7_..._Previous_Version/Modern_Office_old/Office_interiors_shadowless_16x16.png` |
| 3169 | `characters.tsx` | 4 | **generated** — lifted from aseprite layer 2 |
| 3173 | `patch.tsx` | 192 | **generated** — residual pixel corrections |

`firstgid` values follow from the sheet order and each sheet's tile count. Change the order or add a sheet and **every GID shifts**.

## Layers

| # | Layer | Type | Contents | Visible |
|---|---|---|---|---|
| 1 | `Floor` | tilelayer | 134 tiles | yes |
| 2 | `Walls` | tilelayer | 4 tiles | yes |
| 3 | `Structure` | objectgroup | 306 — layer-0 art that could not be a grid tile | yes |
| 4 | `Furniture` | objectgroup | 464 | yes |
| 5 | `Characters` | objectgroup | 4 | yes |
| 6 | `Details` | objectgroup | 2 | yes |
| 7 | `Patch` | tilelayer | 182 tiles — **must draw last** | yes |
| 8 | `Collision` | objectgroup | 39 merged rects, in pixels | **no** |
| 9 | `Spawns` | objectgroup | 2 NPC points | **no** |

Only 134 of 272 cells are `Floor` **tiles** — most of the floor spilled into `Structure` objects because it is not grid-aligned. Anything deriving walkability from the Floor layer alone will be badly wrong; see the collision notes below.

## Tunable constants

In `tools/build_map.js`:

| Constant | Value | Meaning |
|---|---|---|
| `TILE` | 16 | tile size |
| `MAX_CANDIDATES` | 1200 | per-colour candidate cap during matching |
| `CHARACTER_LAYER` | 2 | aseprite layer extracted rather than matched |
| inside test | `opaque >= PX * 0.5` | cell counts as interior if half its art is opaque |
| `BLOCK_COVERAGE` | `PX * 0.85` | furniture coverage at which a cell blocks movement |
| `MIN_REGION` | 4 | smallest walkable region worth connecting |
| carve cost | `1 + coverage` | Dijkstra weight when tunnelling a doorway |
| carveable | `inside && !wall && (hasFloor \|\| >= 2 floor-neighbours)` | what may be tunnelled through |

In `public/src/Character.js`: speed `60`, sprite origin `(0.5, 1)`, physics body **10 × 8** at the feet — deliberately much smaller than the 16 × 32 sprite so heads overlap desks without blocking.

## Regenerating

**What must travel with this document:**
- `tools/` — `build_map.js`, `aseprite.js`, `png.js`, `dump_rgba.ps1`, `verify_map.js`, `verify_phaser.js`
- The **LimeZu Modern Office** pack (paid art — not redistributable; the buyer supplies it)
- Node 18+, and Tiled installed for `tmxrasterizer.exe` (used by the gates)

**Steps:**

1. Place the pack at `public/assets/tilesets/Modern_Office_Revamped_v1.2/`.
2. Dump each sheet plus the reference GIF to raw BGRA — `build_map.js` reads from this cache, it does not decode PNGs itself:
   ```
   powershell -File tools/dump_rgba.ps1 -Source <image> -OutBase <cache>/<name>
   ```
   Required names: `ref` (from `Office_Design_2.gif`), `atlas_roombuilder`, `atlas_shadowless`, `atlas_blackshadow`, `atlas_oldwalls`, `atlas_oldint`, `atlas_oldintshadowless`. The cache location is the `RGBA_CACHE` env var.
3. `node tools/build_map.js`

The build is **deterministic** — no randomness, no wall-clock input — so the same pack and the same constants produce the same map. The gates below are what prove it.

## Output fingerprint

A correct rebuild produces exactly this. Any deviation means something differs.

```
map              16 x 17, tile 16
Floor           134 tiles
Walls             4 tiles
Structure       306 objects
Furniture       464 objects
Characters        4 objects
Details           2 objects
Patch           182 tiles
Collision        39 objects
Spawns            2 objects
nextobjectid    818
patch coverage  7157 px (12.26% baked, 87.74% real tileset art)
```

## How to know you succeeded

```bash
node tools/verify_map.js      # must print 0 differing, twice
node tools/verify_phaser.js   # must print 0 differing (needs: npm run dev)
```

`verify_map.js` compares against **both** the aseprite source and the GIF upscaled 2×. `verify_phaser.js` compares the live game canvas. Both exit non-zero on any difference. Two renderers are checked deliberately: Tiled's rasterizer once reported a perfect match while Phaser was at 91.55%, because of a layer-ordering difference.

---

## Four bugs that cost real accuracy

Each was found by measurement, not by looking at the picture.

1. **Patch baked whole cells.** One bad pixel condemned all 256 in the cell — 78.7% of the image baked. Making the patch a per-pixel overlay dropped it to 19%.
2. **Placements could paint outside the silhouette.** An additive overlay can add pixels but never erase them, so any over-draw was uncorrectable. Rejecting any placement that paints where the layer is transparent fixed it.
3. **The layer split silently reordered the draw sequence.** Re-assembling layer 0 into Floor/Walls/objects invented ~3600 bad pixels on its own. Tile layers always draw before object layers, so a placement may only be promoted to a tile layer if nothing already destined for the object layer sits under it.
4. **Phaser buried the Patch layer.** Tiled rendered 100% while the live game rendered 91.55% — the scene created all three tile layers up front, putting Patch *under* the furniture. **Gating only on Tiled's rasterizer would have shipped this.**

---

## Known limits — stated plainly

- **The GIF has 6 animation frames.** This matches **frame 0**. No static map can match all six.
- **12.26% is fused image**, not movable furniture. Those cells cannot be rearranged like real objects.
- **This is art, not a level.** Furniture buries ~110 of the 217 floor cells at 100%+ coverage; only ~40 are genuinely open. There is no collision setting that is both physically honest and freely navigable — the parameter space was measured end to end. The shipped compromise blocks cells ≥85% covered, tunnels 3 cells to connect the rooms (the design has no doorway between them), and relies on doorway assist in `Character.js` to make the resulting 1-tile gaps passable. Characters still clip past furniture edges in places. For genuine gameplay use `office_play`, which is built for walking.
