# Tilemap Building Framework

**A reusable method for turning any 2D tileset pack into a working game map.**

Written to be handed to a person or an AI agent facing an unfamiliar pack. Nothing here assumes a particular artist, tileset or engine; the concrete numbers from the pack this was developed against live in the [appendix](#appendix--worked-example-limezu-modern-office) as an example, not as a rule.

It was derived from reproducing a promotional reference image **pixel-perfectly** (0 differing pixels across two renderers) and then building a second, navigable map from the same art. Most of what follows exists because something went wrong first.

---

## Pick your track

| Goal | Track |
|---|---|
| Recreate an existing picture exactly — a promo render, a mockup, a screenshot | **A — Reproduce** |
| Design your own level from a pack's art | **B — Author** |

They are genuinely different jobs. Track A is a search problem with a measurable answer. Track B is a design problem where "correct" means playable.

Both share Phases 0, 1, 3 and 4.

---

# Phase 0 — Inventory the pack

Before writing any code, answer these. Each one has silently wrecked an attempt.

1. **Is there a layered source?** Look for `.aseprite`, `.psd`, `.ora`, or an `examples/`/`designs/` folder beside any reference render. **This is the highest-leverage question in the whole process.** A layered file hands you the artist's own separation of floor / walls / furniture and removes nearly all guesswork. Finding one turned a stalled "close but visibly wrong" effort into an exact reproduction.
2. **What sheets exist, and what are their pixel dimensions?** List every image, its size, and whether the size divides evenly by the candidate tile size.
3. **Are there older versions of the pack bundled?** Packs often ship a `previous_version/` folder. Designs frequently predate the current art. Including the old sheets as match candidates raised exact coverage from 78% to 84% here — do not dismiss them.
4. **What is licensed?** Paid art usually cannot be redistributed. Plan for the buyer supplying it, and keep generated derivatives separate from the pristine pack.

**Output of this phase:** a table of every sheet, its dimensions, and a note of any layered source.

---

# Phase 1 — Determine geometry empirically

> **The rule: never assume two sheets in a pack share geometry.** They frequently do not, and the failure is silent — you get plausible-looking garbage frames rather than an error.

## 1.1 Establish the scale

A reference render is often exported at 2× or 3×. Check whether the canvas divides evenly by the tile size, then **verify by brute force**: for each candidate factor and offset, compare the upscaled source against the render and count identical pixels. The right answer scores ~100%; everything else scores far lower.

Getting this wrong is dangerous precisely because it *partially* works. At the wrong scale, flat areas like floor still "match" (uniform grey matches uniform grey) while every detailed sprite fails — which reads as "my matcher needs tuning" rather than "my premise is wrong".

## 1.2 Determine each sheet's frame size

Do not trust the filename. A sheet named `*_16x16` may contain 32-wide frames.

**Detection signature:** slice the sheet at your assumed width and look at adjacent cells. If detail hugs the *right* edge of one cell and the *left* edge of the next, those two cells are halves of one wider frame — a face or object spanning the boundary. Re-slice at the wider size and confirm the frames look whole.

This caught sitting animations being 32 px wide in a pack whose walking animations were 16.

## 1.3 Determine direction order and count

For character-style sheets, three cheap tests settle it without eyeballing:

- **Mirror test** — two frames that are *exact* pixel mirrors of each other are the left/right pair. Exactness matters: a near-match is a different pose, not a mirror.
- **Facing test** — count bright skin pixels in the head band. A frame facing away has ~none; a frame facing the viewer has the most; side views land in between.
- **Centroid test** — for a side view, which side of the cell the skin sits on tells you left from right.

Also determine the **direction count**. Not every animation has four. Sitting art often has only left/right, because you sit side-on at a desk. Dividing a frame count by 4 and getting a whole number does not prove four directions.

## 1.4 Record what you could not verify

If a sheet's layout does not resolve cleanly — a frame count that divides by neither your direction count nor any sensible alternative — **mark it unverified and do not register it**. Shipping a guessed layout means an animation that plays arbitrary frames, which looks like a rendering bug and costs far more to diagnose later than leaving it out.

**Output of this phase:** a per-sheet table of frame size, direction order, frames per direction, and an explicit "unverified" list.

---

# Track A — Reproduce a reference exactly

## A1. Work from the lossless source

If a layered source exists, target it, not the exported render. Rendered exports — GIF especially — apply palette quantization that shifts colours by a few counts, which defeats exact matching. Prove the relationship once (render == source upscaled N×), then target the source and assert against the render separately.

## A2. Match exactly, score by net error

**Do not use tolerant matching.** A tolerant match reproduces *nearly* the right pixels, which is the exact thing you are trying to eliminate.

For each placement candidate, score it by **net error reduction**: pixels it fixes minus pixels it breaks, measured against the layer it belongs to. Append placements in the order they improve the render. This handles occlusion and z-order implicitly — whatever ends up on top is what the source has on top — without needing to infer draw order separately.

Two constraints that matter:
- **Never paint outside the layer's silhouette.** If your correction mechanism can only add pixels, over-draw is uncorrectable.
- **Anchor on any matching pixel, not the sprite's first pixel.** When a sprite is partly hidden under another, its first pixel is often the covered one.

## A3. Close the last gap deliberately

Some pixels will not be expressible in the available tiles — hand-retouched art, or sprites from a pack you do not own. Two honest options:

- **Bake the residual** into a generated patch tileset drawn last, making 100% a construction rather than a hope. Make it a **per-pixel overlay** (transparent except corrections), not whole baked cells — cell-granular patching took one wrong pixel and condemned all 256, baking 78% of the image where per-pixel baked 12%.
- **Report the shortfall** and stop.

Either way, **state the split**: "87.74% real tileset art, 12.26% baked" says far more than "it looks identical".

## A4. When coverage is poor, diagnose in this order

1. **Wrong scale** — detail fails, flat areas pass. Re-check 1.1.
2. **Missing sheet** — cells match at *near* zero error but never exactly. Add candidates, especially older pack versions.
3. **Off-grid placement** — grid matching fails, sliding-window succeeds. Expected; artists place furniture freely. Keep those as objects, which support arbitrary pixel positions.
4. **Occlusion** — a sprite is partly covered so strict matching rejects it. See A2.

---

# Track B — Author an original map

## B1. Size the grid first

Budget before placing anything:
- A desk-and-chair workstation is roughly 4 × 3 tiles including clearance.
- **Aisles need 2 tiles, not 1.** Furniture sprites overhang their cells, and 1-tile aisles get swallowed by collision. This is the single biggest cause of a map that looks fine and cannot be walked.
- Reproducing dense promo art gives a cramped result. For a playable office, start around 30 × 24.

## B2. Make the layout declarative

Express rooms, doors and furniture rows as **data**, not code, so the level can be reshaped by editing a table:

```js
const LAYOUT = {
  size:  { w: 30, h: 24 },
  rooms: [ { name: 'main', x: 1, y: 1, w: 28, h: 14, floor: FLOOR_GREY }, ... ],
  interiorWalls: [ { x1: 1, y1: 15, x2: 28, y2: 15, gaps: [[5,6],[19,20]] } ],
  deskRows: [ { y: 3, xs: [3, 9, 15, 21] }, ... ],
};
```

## B3. Doorways need floor

An interior wall run sits *between* rooms, on tiles no room's floor covers. A gap in that wall is therefore a **hole, not a door** unless you explicitly lay floor in it. This stranded two rooms on the first build here and was caught immediately by the Phase 4 navigability gate.

## B4. Script the structure

Write tile layers with a script rather than many individual editor/tool calls — dramatically faster and less error-prone. Reserve interactive tooling for validation and single-object tweaks.

---

# Phase 3 — Collision and navigability

This phase is where "looks right" and "plays right" diverge, and where most of the hard-won lessons live.

## 3.1 A walkable cell needs TWO independent tests

Deriving walkability from one signal fails, and **each single test fails in a different direction**:

| Test alone | What wrongly passes |
|---|---|
| "art is solid here" | the **roof** — wall art is opaque, so the roof reads as interior |
| "a floor tile is here" | **exterior bleed** — a floor sprite whose pixels spill past the wall |

Require **both**. Chasing these separately produced a player who could walk on the roof, and later one who spawned outside the building entirely.

Also note: **do not derive walkability from the floor tile layer alone** if your pipeline puts non-grid-aligned floor into object layers. In the reproduced map only 134 of 272 cells are floor *tiles*; the rest are objects. A pathfinder that treated "no floor tile" as void considered most of a perfectly walkable map impassable.

## 3.2 Blocking threshold is a measured trade-off, not a guess

Sweep it and tabulate: walkable count, largest connected region, and how many walkable cells still carry significant furniture. Pick from the data. In dense art there may be no good answer — which is itself the finding, and worth reporting rather than hiding.

## 3.3 Connect rooms by cheapest path, not by growing the biggest region

If regions are disconnected and the art has no doorway, you must tunnel one. **Optimise for connecting rooms, not for maximising the largest region** — a greedy "grow the biggest blob" search just fattens the main space and leaves distant rooms sealed behind a dead end.

Use a cost-weighted shortest path (Dijkstra) between regions, weighting each cell by how obstructed it is. Constrain candidates to genuine interior cells, and allow a cell that is fully occluded but **flanked by floor** — the natural doorway is often completely hidden under furniture, while a roof cell has no floor neighbours at all. That distinction is what stops the tunnel escaping the building.

**A doorway must also be somewhere a player would look.** An unconstrained search once produced a technically-passable single tile at the far edge of the map, indistinguishable from solid furniture. It was reachable and utterly undiscoverable.

## 3.4 Narrow gaps need movement assistance

A 1-tile doorway with a body smaller than the tile demands near-perfect alignment. Players bump the frame and conclude the room is sealed — as happened here twice.

Add **doorway assist**: when moving along an axis, inspect the tile ahead. If it is open, settle toward the centre of the lane; if it is blocked but a neighbouring lane is open, slide toward that one. Restrict it to axis-aligned movement so open-room movement is unaffected.

## 3.5 Size the physics body to the feet

A top-down character's collision body should be much smaller than its sprite and sit at the feet, so heads and shoulders overlap furniture without blocking. A full-sprite body makes tight doorways impassable.

---

# Phase 4 — Gates

**Make correctness a number.** Every real bug in this project was found by measurement; none by looking at the picture and feeling satisfied.

| Gate | Asserts | Catches |
|---|---|---|
| **Pixel diff** | rendered map vs reference, 0 differing | any placement, ordering or tile-id error |
| **Navigability** | one connected region; every room, spawn and seat reachable | maps that look fine and cannot be walked |
| **Shipped renderer** | the *game's* canvas matches, not just the editor's | renderer disagreements |
| **Runtime sanity** | no errors; character moves, collides, stays in bounds | integration breakage |

Make them **exit non-zero**, so they are gates rather than reports. Emit a diff image and a per-cell error list — these turn "it looks wrong" into "cell (12,3) has 41 bad pixels".

**Verify the renderer you ship.** The authoring tool reported a perfect match while the game was at 91.55%, due to a layer-ordering difference. One gate would have shipped that.

---

# Pitfalls

Ordered by how much time each cost.

1. **Tile objects anchor bottom-left.** An object whose top-left tile is `(tx,ty)` and is `h` tall is written `y = (ty + h) * tileSize`, **not** `ty * tileSize`. Wrong by one row for every object. In-engine, the equivalent is a `(0, 1)` origin.
2. **Layer order is render order.** A correction/overlay layer must be created last. Creating it with the other tile layers buries it.
3. **Blank tiles.** Many sheets contain empty cells that are edge slices of multi-tile furniture. Placing one yields invisible furniture that looks like a loading bug. **Never place an unverified tile id.**
4. **Object array order is z-order.** Reordering objects changes the image.
5. **Hidden layers still render** in some rasterizers if left visible — collision and spawn markers will corrupt a pixel comparison.
6. **Engine frame slicing.** Some engines mis-slice tile-object frames and stretch a whole sheet into one object. Loading the sheet *also* as a spritesheet and placing by frame index is a reliable workaround.
7. **Palette quantization** in GIF/indexed exports shifts colours slightly. Never exact-match against one; use the lossless source.
8. **Camera vs map size.** At zoom Z a viewport of H pixels shows only H/Z world pixels. Compute the largest integer zoom that fits, and do not apply camera bounds when fitting — bounds clamp the scroll and fight centring.
9. **Query strings on the root URL** break naive static servers (`/?debug` resolving to a directory). Strip the query before resolving.

---

# Verifying an unknown tile id

Cheaper than placing one and wondering why nothing appears:

> Crop the candidate id range out of the sheet, upscale 8× nearest-neighbour, draw each id over its tile, save a PNG and look at it.

This identified every tile used in this project, and immediately exposed the blank edge slices.

---

# Appendix — Worked example: LimeZu Modern Office

Concrete values from the pack this method was developed against. **Illustrative, not prescriptive.**

## Map tiles

`Room_Builder_Office_16x16` — floors and walls:

| Art | Local ID |
|---|---|
| Grey office floor | 90, 106, 107, 110 |
| Wood / brick floor | 144, 145 |
| Wall, horizontal run | 1, 2 |
| Wall, vertical run | 10 (left), 12 (right) |
| Wall corner (flip for all four) | 18 |
| Door | 8 |

`Modern_Office_Shadowless_16x16` — furniture:

| Art | Local ID |
|---|---|
| Desk, 3 wide | 288–290, 481–483, 484–486, 500–502 |
| Monitor | 169 |
| Blue monitor + keyboard | 205–207, 712–715 |
| Office chair (dark) | 128, 130 |
| Chair (brown / orange) | 160–163, 718 |
| Cubicle divider (vertical) | 416, 419, 422 |
| Long counter / partition | 432–440 |
| Printer / scanner | 186 |
| Copier / machine | 680–683, 700–703 |
| Potted plants | 134, 166, 199 |
| Floor bushes | 780–783, 812–815 |
| Bookshelf with books | 217 |
| Whiteboard | 235 |
| Wall chart (red line) | 250 |
| Framed art | 192, 193, 208, 213 |
| Desk lamp | 730, 746 |
| Dark locker / cabinet | 640–643, 656–659 |
| Seated-character workstation | 620–623, 636–639 |
| Papers / folders | 441 |
| Keyboard | 443 |

**Local `0` and local `496` are blank** — edge slices of multi-tile furniture. They caused two "invisible furniture" bugs.

## Character sheets

From the LimeZu **free** pack (`Modern tiles_Free/Characters_free/`): Adam, Alex, Amelia, Bob.

**Direction order in every 4-way sheet: `right, up, left, down`.** Direction `d` occupies frames `d * framesPerDir` onward.

| Sheet | Frame | Frames | Directions |
|---|---|---|---|
| `_idle` | 16×32 | 4 | 4, 1 each |
| `_idle_anim` | 16×32 | 24 | 4, 6 each |
| `_run` | 16×32 | 24 | 4, 6 each |
| `_sit` | **32×32** | 12 | **2 (right, left)**, 6 each |
| `_sit2` | **32×32** | 12 | **2 (right, left)**, 6 each |
| `_sit3` | ? | ? | **unverified** |
| `_phone` | ? | 9 | **unverified** — divides by neither 4 nor 2 |

Note the sit sheets breaking the pattern in *both* frame width and direction count — exactly the case Phase 1 exists to catch. There is no separate walk sheet: **run is the movement animation**.

## This repo's implementation

| File | Role |
|---|---|
| `tools/build_map.js` | Track A — reproduce the reference |
| `tools/build_office_map.js` | Track B — author a playable map |
| `tools/verify_map.js` | pixel gate (editor renderer + reference) |
| `tools/verify_phaser.js` | pixel gate (shipped renderer) |
| `tools/verify_walkable.js` | navigability gate |
| `tools/aseprite.js`, `tools/png.js`, `tools/dump_rgba.ps1` | dependency-free asset I/O |
| `public/src/Character.js` | movement, facing, doorway assist |
| `public/src/CharacterAnims.js` | per-sheet geometry as data |
| `public/src/Pathfinder.js` | A* over the collision grid |

For the exact reproduction specification of the finished map — coordinate conventions, GID registry, constants, output fingerprint — see **`HOW_THIS_MAP_WAS_BUILT.md`**.
