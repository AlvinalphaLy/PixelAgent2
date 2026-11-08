'use strict';
/*
 * Minimal Aseprite (.ase/.aseprite) reader — enough to pull per-layer RGBA pixel data.
 * Spec: https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md
 */

const fs = require('fs');
const zlib = require('zlib');

const CHUNK_LAYER = 0x2004;
const CHUNK_CEL = 0x2005;

function parse(file) {
  const b = fs.readFileSync(file);
  const magic = b.readUInt16LE(4);
  if (magic !== 0xa5e0) throw new Error(`not an aseprite file (magic 0x${magic.toString(16)})`);

  const doc = {
    frames: b.readUInt16LE(6),
    width: b.readUInt16LE(8),
    height: b.readUInt16LE(10),
    depth: b.readUInt16LE(12),        // 32 = RGBA, 16 = grayscale, 8 = indexed
    transparentIndex: b.readUInt8(28),
    colors: b.readUInt16LE(32),
    gridX: b.readInt16LE(36),
    gridY: b.readInt16LE(38),
    gridW: b.readUInt16LE(40),
    gridH: b.readUInt16LE(42),
    layers: [],
    cels: [],                          // { frame, layerIndex, x, y, w, h, pixels }
  };

  let off = 128;
  for (let f = 0; f < doc.frames; f++) {
    const frameBytes = b.readUInt32LE(off);
    const frameMagic = b.readUInt16LE(off + 4);
    if (frameMagic !== 0xf1fa) throw new Error(`bad frame magic at frame ${f}`);
    const oldCount = b.readUInt16LE(off + 6);
    const newCount = b.readUInt32LE(off + 12);
    const nChunks = newCount !== 0 ? newCount : oldCount;

    let p = off + 16;
    for (let c = 0; c < nChunks; c++) {
      const size = b.readUInt32LE(p);
      const type = b.readUInt16LE(p + 4);
      const data = b.subarray(p + 6, p + size);

      if (type === CHUNK_LAYER) {
        const flags = data.readUInt16LE(0);
        const layerType = data.readUInt16LE(2);
        const childLevel = data.readUInt16LE(4);
        const blend = data.readUInt16LE(10);
        const opacity = data.readUInt8(12);
        const nameLen = data.readUInt16LE(16);
        const name = data.subarray(18, 18 + nameLen).toString('utf8');
        doc.layers.push({
          index: doc.layers.length, name, flags, layerType, childLevel, blend, opacity,
          visible: (flags & 1) !== 0,
        });
      } else if (type === CHUNK_CEL) {
        const layerIndex = data.readUInt16LE(0);
        const x = data.readInt16LE(2);
        const y = data.readInt16LE(4);
        const opacity = data.readUInt8(6);
        const celType = data.readUInt16LE(7);

        if (celType === 0 || celType === 2) {
          const w = data.readUInt16LE(16);
          const h = data.readUInt16LE(18);
          const raw = data.subarray(20);
          const pixels = celType === 2 ? zlib.inflateSync(raw) : raw;
          doc.cels.push({ frame: f, layerIndex, x, y, w, h, opacity, pixels });
        } else if (celType === 1) {
          doc.cels.push({ frame: f, layerIndex, x, y, opacity, link: data.readUInt16LE(16) });
        }
      }
      p += size;
    }
    off += frameBytes;
  }
  return doc;
}

/**
 * Flatten one layer of one frame into a full-canvas BGRA buffer matching the
 * byte order used by dump_rgba.ps1, so both pipelines are directly comparable.
 */
function layerToBGRA(doc, layerIndex, frame = 0) {
  const out = Buffer.alloc(doc.width * doc.height * 4, 0);
  const cel = doc.cels.find((c) => c.frame === frame && c.layerIndex === layerIndex && c.pixels);
  if (!cel) return out;
  if (doc.depth !== 32) throw new Error(`only 32bpp supported, got ${doc.depth}`);

  for (let row = 0; row < cel.h; row++) {
    const cy = cel.y + row;
    if (cy < 0 || cy >= doc.height) continue;
    for (let col = 0; col < cel.w; col++) {
      const cx = cel.x + col;
      if (cx < 0 || cx >= doc.width) continue;
      const s = (row * cel.w + col) * 4;   // aseprite stores R,G,B,A
      const d = (cy * doc.width + cx) * 4; // we emit B,G,R,A
      out[d] = cel.pixels[s + 2];
      out[d + 1] = cel.pixels[s + 1];
      out[d + 2] = cel.pixels[s];
      out[d + 3] = cel.pixels[s + 3];
    }
  }
  return out;
}

module.exports = { parse, layerToBGRA };

if (require.main === module) {
  const doc = parse(process.argv[2]);
  console.log(`canvas   : ${doc.width} x ${doc.height}`);
  console.log(`frames   : ${doc.frames}`);
  console.log(`depth    : ${doc.depth}bpp`);
  console.log(`grid     : ${doc.gridW} x ${doc.gridH} @ (${doc.gridX},${doc.gridY})`);
  console.log(`layers   : ${doc.layers.length}`);
  for (const l of doc.layers) {
    const cels = doc.cels.filter((c) => c.layerIndex === l.index);
    const f0 = cels.find((c) => c.frame === 0);
    console.log(
      `  [${String(l.index).padStart(2)}] ${l.visible ? 'V' : '-'} ` +
      `lvl${l.childLevel} type${l.layerType} op${l.opacity} ` +
      `"${l.name}" cels=${cels.length}` +
      (f0 && f0.w ? ` frame0=${f0.w}x${f0.h}@(${f0.x},${f0.y})` : '')
    );
  }
}
