class GameScene extends Phaser.Scene {
  /**
   * @param {Array}  manifest tileset list emitted by the map build tools
   * @param {string} mapKey   base name, e.g. 'office_play' or 'office_v2'
   */
  constructor(manifest, mapKey) {
    super('GameScene');
    this.manifest = manifest;
    this.mapKey = mapKey;
    this.characterName = 'Adam';
  }

  preload() {
    this.load.tilemapTiledJSON('map', `assets/maps/${this.mapKey}.json`);
    for (const ts of this.manifest) {
      this.load.image(ts.key, ts.image);
      // Spritesheet twin: object layers are placed by frame index, because Phaser's
      // createFromObjects does not slice tile-object frames correctly (it stretches the
      // whole sheet into each object).
      this.load.spritesheet(`${ts.key}__sheet`, ts.image, { frameWidth: 16, frameHeight: 16 });
    }
    CharacterAnims.preload(this, this.characterName);
  }

  create() {
    const map = this.make.tilemap({ key: 'map' });
    this.map = map;
    const tilesets = this.manifest.map((ts) => map.addTilesetImage(
      map.tilesets.find((t) => t.firstgid === ts.firstgid).name, ts.key));

    // Draw order must match the .tmj layer order. Patch (when present) corrects residual
    // pixels and therefore has to come last — creating it with the other tile layers buries
    // it under the furniture.
    for (const name of ['Floor', 'Walls']) {
      if (map.getLayer(name)) map.createLayer(name, tilesets);
    }
    for (const name of ['Structure', 'Furniture', 'Characters', 'Details']) {
      const layer = map.getObjectLayer(name);
      if (!layer) continue;
      for (const obj of layer.objects) {
        if (!obj.gid) continue;
        const ts = this.tilesetFor(obj.gid);
        if (!ts) continue;
        this.add.image(obj.x, obj.y, `${ts.key}__sheet`, obj.gid - ts.firstgid).setOrigin(0, 1);
      }
    }
    if (map.getLayer('Patch')) map.createLayer('Patch', tilesets);

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    this.blockers = this.physics.add.staticGroup();
    const collision = map.getObjectLayer('Collision');
    if (collision) {
      for (const r of collision.objects) {
        const body = this.add.rectangle(r.x + r.width / 2, r.y + r.height / 2, r.width, r.height);
        this.physics.add.existing(body, true);
        this.blockers.add(body);
      }
    }

    // `?pixeltest` renders the map alone at 1:1 so it can be diffed against the reference.
    this.pixelTest = new URLSearchParams(location.search).has('pixeltest');
    if (this.pixelTest) {
      this.cameras.main.setZoom(1).setScroll(0, 0);
      return;
    }

    const spawn = this.findSpawn(map);
    this.pathfinder = new Pathfinder(map);
    this.player = new Character(this, spawn.x, spawn.y, this.characterName, {
      canWalk: (tx, ty) => this.pathfinder.isWalkable(tx, ty),
    });
    this.physics.add.collider(this.player.sprite, this.blockers);

    this.path = [];

    this.setupCamera(map);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.sitKeys = this.input.keyboard.addKeys('ENTER,SPACE,E');
    this.input.on('pointerdown', (p) => {
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      const path = this.pathfinder.find(
        this.player.tileX, this.player.tileY,
        Math.floor(wp.x / 16), Math.floor(wp.y / 16));
      this.path = path;
    });
  }

  /** Camera mode is declared by the map, not inferred — the two maps want different things. */
  setupCamera(map) {
    const cam = this.cameras.main;
    // Phaser hands back an empty OBJECT, not an array, when a map declares no properties —
    // so this must not assume .find() exists.
    const props = Array.isArray(map.properties) ? map.properties : [];
    const prop = props.find((p) => p.name === 'camera');
    const mode = prop ? prop.value : 'fit';

    if (mode === 'follow') {
      cam.setZoom(2);
      cam.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
      cam.startFollow(this.player.sprite, true);
      return;
    }
    const fitZoom = Math.floor(Math.min(cam.width / map.widthInPixels, cam.height / map.heightInPixels));
    if (fitZoom >= 1) {
      // No bounds here: they clamp the scroll and fight centerOn, pinning the map top-left.
      cam.setZoom(fitZoom);
      cam.centerOn(map.widthInPixels / 2, map.heightInPixels / 2);
    } else {
      cam.setZoom(1);
      cam.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
      cam.startFollow(this.player.sprite, true);
    }
  }

  tilesetFor(gid) {
    let best = null;
    for (const ts of this.manifest) {
      if (gid >= ts.firstgid && (!best || ts.firstgid > best.firstgid)) best = ts;
    }
    return best;
  }

  findSpawn(map) {
    const spawns = map.getObjectLayer('Spawns');
    const point = spawns && spawns.objects.find((o) => o.type === 'spawn');
    if (point) return { x: point.x, y: point.y };

    // No declared spawn, so pick the most OPEN walkable tile rather than the first one found.
    // Scanning from a corner drops the player in whatever cramped nook happens to come first
    // — on office_v2 that was a one-tile gap at the edge of the map.
    const blocked = (map.getObjectLayer('Collision') || { objects: [] }).objects;
    const isBlocked = (tx, ty) => {
      const px = tx * 16 + 8, py = ty * 16 + 8;
      return blocked.some((r) => px >= r.x && px < r.x + r.width && py >= r.y && py < r.y + r.height);
    };

    let best = null;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (isBlocked(x, y)) continue;
        let open = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
            if (!isBlocked(nx, ny)) open++;
          }
        }
        // Tie-break toward the middle of the map so we start somewhere central.
        const centred = -(Math.abs(x - map.width / 2) + Math.abs(y - map.height / 2)) / 100;
        const score = open + centred;
        if (!best || score > best.score) best = { score, x: x * 16 + 8, y: y * 16 + 16 };
      }
    }
    return best || { x: 24, y: 24 };
  }

  update() {
    if (this.pixelTest || !this.player) return;

    const left = this.cursors.left.isDown || this.wasd.A.isDown;
    const right = this.cursors.right.isDown || this.wasd.D.isDown;
    const up = this.cursors.up.isDown || this.wasd.W.isDown;
    const down = this.cursors.down.isDown || this.wasd.S.isDown;
    const keyed = left || right || up || down;

    // Enter / Space / E toggles sitting. Sitting art is side-on only, so Character snaps the
    // facing to right or left for us.
    const JustDown = Phaser.Input.Keyboard.JustDown;
    const toggleSit = Object.values(this.sitKeys).some((k) => JustDown(k));
    if (toggleSit) {
      if (this.player.seated) this.player.stand();
      else { this.path = []; this.player.sit(this.player.facing); }
      return;
    }
    // Walking away from a seat stands you up, so you never get stuck sitting.
    if (this.player.seated) {
      if (!keyed) return;
      this.player.stand();
    }

    if (keyed) {
      this.path = []; // any key press cancels a click-to-move path
      this.player.setIntent((right ? 1 : 0) - (left ? 1 : 0), (down ? 1 : 0) - (up ? 1 : 0));
    } else if (this.path.length) {
      // Steer toward the next waypoint's centre using the same intent API as the keyboard.
      const next = this.path[0];
      const tx = next.x * 16 + 8, ty = next.y * 16 + 16;
      const dx = tx - this.player.x, dy = ty - this.player.y;
      if (Math.hypot(dx, dy) < 2) this.path.shift();
      else this.player.setIntent(dx, dy);
    } else {
      this.player.setIntent(0, 0);
    }

    this.player.update();
  }
}
