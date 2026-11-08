/*
 * Art adapter for the LimeZu character sheets.
 *
 * Every value below was MEASURED from the files. Two sheets do not share the walking
 * geometry, which is exactly the kind of thing that silently plays garbage frames:
 *
 *   idle / idle_anim / run : 16x32, FOUR directions — right, up, left, down
 *   sit / sit2             : 32x32, TWO directions — right, left
 *
 * Sitting is 32 wide and has no up/down variant because you sit side-on at a desk. The
 * alternating skin position across adjacent 16px cells (x~13 then x~0.9) is the giveaway:
 * the face spans a tile boundary, so the real frame is 32 wide.
 *
 * Evidence for the 4-way order: idle frames 0 and 2 are exact pixel mirrors (diff 0.0) so
 * they are the side views; frame 1 has zero bright skin in the head band (back of head = up)
 * while frame 3 has the most (face = down); frame 0's skin centroid sits right of centre
 * (8.66 vs 7.5) so it faces right. For sit, frames 0-5 all face right and 6-11 are their
 * mirrors, confirmed by eye at 8x.
 *
 *   sit3                   : 16x32, sitting FACING THE VIEWER (down), 12 frames = two 6-frame
 *                            loops (head turned one way, then the other). Measured: every frame's
 *                            content spans x 0-15, so frames are 16 wide, not 32; feet on row 30.
 *
 * There is no sitting-from-behind sheet. Facing up is drawn the way LimeZu's own Office_Design_2
 * does it: the walking 'up' frame, with the chair drawn back over the character (GameScene).
 *
 * NOT registered, because its layout is still unverified — do not add it by guessing:
 *   phone (144x32) 9 frames, which divides by neither 4 nor 2 directions
 */
const CharacterAnims = {
  DIRS4: ['right', 'up', 'left', 'down'],
  DIRS2: ['right', 'left'],
  DIRS1: ['down'],

  SHEETS: {
    idle:      { w: 16, dirs: 4, framesPerDir: 1, rate: 1,  repeat: -1 },
    idle_anim: { w: 16, dirs: 4, framesPerDir: 6, rate: 6,  repeat: -1 },
    run:       { w: 16, dirs: 4, framesPerDir: 6, rate: 10, repeat: -1 },
    sit:       { w: 32, dirs: 2, framesPerDir: 6, rate: 6,  repeat: -1 },
    sit2:      { w: 32, dirs: 2, framesPerDir: 6, rate: 6,  repeat: -1 },
    sit3:      { w: 16, dirs: 1, framesPerDir: 6, rate: 4,  repeat: -1 },
  },

  // Base walking-frame size. Sheets may be wider (sit is 32) — see SHEETS[].w — but the
  // physics body is always sized against the walking frame.
  FRAME_W: 16,
  FRAME_H: 32,

  dirsFor(sheet) {
    const n = this.SHEETS[sheet].dirs;
    return n === 1 ? this.DIRS1 : n === 2 ? this.DIRS2 : this.DIRS4;
  },
  textureKey(name, sheet) { return `char-${name}-${sheet}`; },
  animKey(name, sheet, dir) { return `${name}-${sheet}-${dir}`; },

  /** Sitting only exists side-on, so map any facing onto the nearest available direction. */
  resolveDir(sheet, dir) {
    const dirs = this.dirsFor(sheet);
    if (dirs.includes(dir)) return dir;
    return dirs[0];
  },

  preload(scene, name) {
    for (const [sheet, cfg] of Object.entries(this.SHEETS)) {
      scene.load.spritesheet(
        this.textureKey(name, sheet),
        `assets/characters/${name}_${sheet}.png`,
        { frameWidth: cfg.w, frameHeight: this.FRAME_H }
      );
    }
  },

  register(scene, name) {
    for (const [sheet, cfg] of Object.entries(this.SHEETS)) {
      const texture = this.textureKey(name, sheet);
      if (!scene.textures.exists(texture)) continue;
      this.dirsFor(sheet).forEach((dir, d) => {
        const key = this.animKey(name, sheet, dir);
        if (scene.anims.exists(key)) return;
        const start = d * cfg.framesPerDir;
        scene.anims.create({
          key,
          frames: scene.anims.generateFrameNumbers(texture, { start, end: start + cfg.framesPerDir - 1 }),
          frameRate: cfg.rate,
          repeat: cfg.repeat,
        });
      });
    }
  },
};

if (typeof module !== 'undefined') module.exports = CharacterAnims;
