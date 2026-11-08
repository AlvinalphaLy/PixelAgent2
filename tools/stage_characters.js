'use strict';
/*
 * Copies the character sheets we use out of the LimeZu free pack into
 * public/assets/characters/ with clean names.
 *
 * Why stage rather than load in place: the pack folder name contains a space ("Modern
 * tiles_Free"), which is awkward in URLs, and keeping the raw pack pristine means we can
 * always re-derive. Same convention build_map.js uses for tilesets.
 *
 * Verified sheet layout (measured from the files, see docs):
 *   frame size 16x32, direction order right, up, left, down
 *   idle 4 frames (1/dir) · idle_anim, run, sit, sit2 24 frames (6/dir) · sit3 12 (3/dir)
 */

const fs = require('fs');
const path = require('path');

const SRC = 'public/assets/tilesets/Modern tiles_Free/Characters_free';
const DEST = 'public/assets/characters';
const CHARACTERS = ['Adam', 'Alex', 'Amelia', 'Bob'];
// `phone` is deliberately excluded: 9 frames does not divide by 4 directions, so its layout
// is unverified. Verify it before adding.
const SHEETS = ['idle', 'idle_anim', 'run', 'sit', 'sit2', 'sit3'];

fs.mkdirSync(DEST, { recursive: true });

const manifest = [];
let copied = 0;
for (const name of CHARACTERS) {
  for (const sheet of SHEETS) {
    const src = path.join(SRC, `${name}_${sheet}_16x16.png`);
    if (!fs.existsSync(src)) {
      console.warn(`  missing: ${src}`);
      continue;
    }
    const file = `${name}_${sheet}.png`;
    fs.copyFileSync(src, path.join(DEST, file));
    copied++;
  }
  manifest.push(name);
}

fs.writeFileSync(path.join(DEST, 'characters.json'), JSON.stringify({
  frameWidth: 16,
  frameHeight: 32,
  directions: ['right', 'up', 'left', 'down'],
  characters: manifest,
  sheets: {
    idle: { framesPerDir: 1 },
    idle_anim: { framesPerDir: 6, rate: 6 },
    run: { framesPerDir: 6, rate: 10 },
    sit: { framesPerDir: 6, rate: 6 },
    sit2: { framesPerDir: 6, rate: 6 },
    sit3: { framesPerDir: 3, rate: 6 },
  },
}, null, 1));

console.log(`staged ${copied} sheets for ${manifest.length} characters -> ${DEST}`);
console.log(`characters: ${manifest.join(', ')}`);
