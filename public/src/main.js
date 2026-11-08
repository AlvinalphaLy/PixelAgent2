// Map is chosen by query string. Default is office_v3: Office_Design_1 joined to the left of
// Office_Design_2. ?map=office_v2 is Design 2 alone; ?map=office_play is the sparser but
// fully-navigable layout. Tileset list, map size and camera mode all come from the map's own
// generated files, so no hardcoded copy can drift.
const PARAMS = new URLSearchParams(location.search);
const MAP_KEY = PARAMS.get('map') || 'office_v3';
const PIXEL_TEST = PARAMS.has('pixeltest');

Promise.all([
  fetch(`assets/maps/${MAP_KEY}.manifest.json`).then((r) => r.json()),
  fetch(`assets/maps/${MAP_KEY}.json`).then((r) => r.json()),
]).then(([manifest, mapJson]) => {
  window.game = new Phaser.Game({
    type: Phaser.AUTO,
    // Pixel-test mode sizes the canvas to the map exactly, so the output can be diffed
    // against the reference with no scaling or letterboxing.
    width: PIXEL_TEST ? mapJson.width * mapJson.tilewidth : 800,
    height: PIXEL_TEST ? mapJson.height * mapJson.tileheight : 640,
    parent: document.body,
    backgroundColor: PIXEL_TEST ? '#00000000' : '#2b2b3d',
    transparent: PIXEL_TEST,
    pixelArt: true,
    roundPixels: true,
    physics: { default: 'arcade', arcade: { debug: false } },
    scene: [new GameScene(manifest, MAP_KEY, mapJson)],
  });
});
