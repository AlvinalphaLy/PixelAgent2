// Map is chosen by query string. Default is office_v2, the pixel-perfect reproduction;
// ?map=office_play is the sparser but fully-navigable layout. Tileset list and camera mode
// both come from the map's own generated files, so no hardcoded copy can drift.
const PARAMS = new URLSearchParams(location.search);
const MAP_KEY = PARAMS.get('map') || 'office_v2';
const PIXEL_TEST = PARAMS.has('pixeltest');

fetch(`assets/maps/${MAP_KEY}.manifest.json`)
  .then((r) => r.json())
  .then((manifest) => {
    window.game = new Phaser.Game({
      type: Phaser.AUTO,
      // Pixel-test mode sizes the canvas to the map exactly, so the output can be diffed
      // against the reference with no scaling or letterboxing.
      width: PIXEL_TEST ? 256 : 800,
      height: PIXEL_TEST ? 272 : 640,
      parent: document.body,
      backgroundColor: PIXEL_TEST ? '#00000000' : '#2b2b3d',
      transparent: PIXEL_TEST,
      pixelArt: true,
      roundPixels: true,
      physics: { default: 'arcade', arcade: { debug: false } },
      scene: [new GameScene(manifest, MAP_KEY)],
    });
  });
