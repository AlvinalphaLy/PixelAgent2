/*
 * A character in the office — the player today, AI agents later.
 *
 * setIntent(dx, dy) is the ONLY movement input. The keyboard drives it now; an NPC
 * following pathfinder waypoints drives the same method later. One movement implementation,
 * not two, so player and NPC can never diverge in how they collide or animate.
 */
class Character {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} x world pixels
   * @param {number} y world pixels (the character's FEET land here)
   * @param {string} name one of the staged characters, e.g. 'Adam'
   */
  constructor(scene, x, y, name = 'Adam', opts = {}) {
    this.scene = scene;
    this.name = name;
    this.speed = opts.speed || 60;
    this.facing = opts.facing || 'down';
    this.seated = false;
    this.canWalk = opts.canWalk || null;   // (tileX, tileY) => boolean, powers doorway assist

    CharacterAnims.register(scene, name);

    this.sprite = scene.physics.add.sprite(x, y, CharacterAnims.textureKey(name, 'idle'));
    // Feet on the tile: the art is 16x32 with the body in the lower half.
    this.sprite.setOrigin(0.5, 1);

    // The physics body is much smaller than the sprite and sits at the feet, so heads and
    // shoulders can overlap desks without blocking. With furniture this tight, a full-sprite
    // body makes doorways impassable.
    const bw = opts.bodyWidth || 10;
    const bh = opts.bodyHeight || 8;
    this.sprite.body.setSize(bw, bh);
    this.sprite.body.setOffset((CharacterAnims.FRAME_W - bw) / 2, CharacterAnims.FRAME_H - bh);
    this.sprite.setCollideWorldBounds(true);

    this.intent = { x: 0, y: 0 };
    this.play('idle_anim');
  }

  /** Normalised movement direction; (0,0) to stop. */
  setIntent(dx, dy) {
    const len = Math.hypot(dx, dy);
    this.intent = len > 0 ? { x: dx / len, y: dy / len } : { x: 0, y: 0 };
  }

  /** Sit still, facing `dir` — for desks. */
  /** Sit still. Sitting art is side-on only, so the facing is snapped to right/left. */
  sit(dir = this.facing, variant = 'sit') {
    this.seated = true;
    this.facing = CharacterAnims.resolveDir(variant, dir);
    this.setIntent(0, 0);
    this.sprite.body.setVelocity(0, 0);
    this.play(variant);
  }

  stand() {
    if (!this.seated) return;
    this.seated = false;
    this.play('idle_anim');
  }

  play(sheet) {
    const dir = CharacterAnims.resolveDir(sheet, this.facing);
    const key = CharacterAnims.animKey(this.name, sheet, dir);
    if (this.scene.anims.exists(key)) this.sprite.play(key, true);
    this.currentSheet = sheet;
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }
  get tileX() { return Math.floor(this.sprite.x / 16); }
  get tileY() { return Math.floor((this.sprite.y - 1) / 16); }

  update() {
    if (this.seated) return;
    const body = this.sprite.body;
    let vx = this.intent.x * this.speed;
    let vy = this.intent.y * this.speed;

    // Doorway assist. Openings here are a single tile wide and the body is 10px inside a
    // 16px tile, so threading one by hand demands near-perfect alignment — players just bump
    // the frame and conclude the room is sealed. When moving straight along an axis, look at
    // the tile ahead: if it is open, settle into the middle of the lane; if it is blocked but
    // a neighbouring lane is open, slide toward that instead. Only for axis-aligned movement,
    // so free movement in open rooms is untouched.
    const TILE = 16;
    const canWalk = this.canWalk;
    if (canWalk && vy !== 0 && vx === 0) {
      const tx = this.tileX, ahead = this.tileY + (vy > 0 ? 1 : -1);
      let lane = null;
      if (canWalk(tx, ahead)) lane = tx;
      else if (canWalk(tx - 1, ahead)) lane = tx - 1;
      else if (canWalk(tx + 1, ahead)) lane = tx + 1;
      if (lane !== null) {
        const off = (lane * TILE + TILE / 2) - this.sprite.x;
        if (Math.abs(off) > 0.5) vx = Math.sign(off) * Math.min(this.speed, Math.abs(off) * 8);
      }
    } else if (canWalk && vx !== 0 && vy === 0) {
      const ty = this.tileY, ahead = this.tileX + (vx > 0 ? 1 : -1);
      let lane = null;
      if (canWalk(ahead, ty)) lane = ty;
      else if (canWalk(ahead, ty - 1)) lane = ty - 1;
      else if (canWalk(ahead, ty + 1)) lane = ty + 1;
      if (lane !== null) {
        const off = (lane * TILE + TILE) - this.sprite.y;
        if (Math.abs(off) > 0.5) vy = Math.sign(off) * Math.min(this.speed, Math.abs(off) * 8);
      }
    }
    body.setVelocity(vx, vy);

    const moving = this.intent.x !== 0 || this.intent.y !== 0;
    if (moving) {
      // Favour the dominant axis so diagonals pick one sprite rather than flickering.
      this.facing = Math.abs(this.intent.x) >= Math.abs(this.intent.y)
        ? (this.intent.x > 0 ? 'right' : 'left')
        : (this.intent.y > 0 ? 'down' : 'up');
    }
    const wanted = moving ? 'run' : 'idle_anim';
    const key = CharacterAnims.animKey(this.name, wanted, this.facing);
    if (this.sprite.anims.currentAnim?.key !== key) this.play(wanted);
  }
}

if (typeof module !== 'undefined') module.exports = Character;
