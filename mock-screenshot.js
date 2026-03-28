/**
 * mock-screenshot.js - VILA Mock Screenshot Generator
 *
 * Generates a valid PNG file as a placeholder screenshot.
 * Use as: default_screenshot_command = "node mock-screenshot.js yymmdd_hhmmss.png"
 *
 * The filename argument may include a full path or just a filename.
 * If just a filename, saves to the current working directory.
 *
 * No external dependencies — PNG is built from raw bytes using Node's zlib.
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── Output path ───────────────────────────────────────────────────────────────

const arg = process.argv[2] || 'mock_screenshot.png';
const outputPath = path.isAbsolute(arg) ? arg : path.join(process.cwd(), arg);

// ── PNG generator ─────────────────────────────────────────────────────────────

const W = 480, H = 270; // 16:9 mock screen

function makeCRCTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
}
const CRC_TABLE = makeCRCTable();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF];
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const tb  = Buffer.from(type, 'ascii');
  const lb  = Buffer.alloc(4); lb.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])));
  return Buffer.concat([lb, tb, data, crc]);
}

// Build 480×270 image: dark background + lighter center panel + "MOCK" label area
const rows = [];
for (let y = 0; y < H; y++) {
  const row = Buffer.alloc(1 + W * 3);
  row[0] = 0; // filter: None
  for (let x = 0; x < W; x++) {
    // Dark background: #080a10 region, lighter panel in center
    const inPanel = x > 60 && x < W - 60 && y > 50 && y < H - 50;
    const isHeader = y >= 50 && y <= 70 && x > 60 && x < W - 60;
    const isBorder = (x === 60 || x === W - 61 || y === 50 || y === H - 51) && inPanel;

    let r, g, b;
    if (isHeader) {
      // Teal header strip simulating app header
      r = 0x0f; g = 0x3a; b = 0x4c;
    } else if (isBorder) {
      r = 0x1e; g = 0x24; b = 0x33;
    } else if (inPanel) {
      // Panel area: slightly lighter dark (#0f1219)
      r = 0x0f; g = 0x12; b = 0x19;
      // Add grid-like row alternation
      if ((y - 70) % 20 < 1) { r = 0x14; g = 0x18; b = 0x20; }
    } else {
      // Outer background (#080a10)
      r = 0x08; g = 0x0a; b = 0x10;
    }
    // Add a subtle gradient tint to the whole image
    r = Math.min(255, r + Math.floor(x / W * 8));
    b = Math.min(255, b + Math.floor(y / H * 10));

    row[1 + x * 3] = r;
    row[2 + x * 3] = g;
    row[3 + x * 3] = b;
  }
  rows.push(row);
}

// Draw a simple "MOCK" watermark: 4 bright pixels in each letter position (low-res)
// Place it center-bottom of the panel area
const textY = H - 55;
const markPixels = [
  // M
  [0,0],[0,1],[0,2],[0,3],[0,4],[1,1],[2,0],[3,1],[4,0],[4,1],[4,2],[4,3],[4,4],
  // O (offset x+=6)
  [6,0],[6,1],[6,2],[6,3],[6,4],[7,0],[7,4],[8,0],[8,4],[9,0],[9,1],[9,2],[9,3],[9,4],
  // C (offset x+=12)
  [12,0],[12,1],[12,2],[12,3],[12,4],[13,0],[13,4],[14,0],[14,4],
  // K (offset x+=18)
  [18,0],[18,1],[18,2],[18,3],[18,4],[19,2],[20,1],[20,3],[21,0],[21,4],[22,0],[22,4],
];
const textStartX = Math.floor(W / 2) - 40;

for (const [dx, dy] of markPixels) {
  const px = textStartX + dx * 3;
  const py = textY + dy * 3;
  for (let sy = 0; sy < 2; sy++) {
    for (let sx = 0; sx < 2; sx++) {
      const row = rows[py + sy];
      if (!row) continue;
      const off = 1 + (px + sx) * 3;
      if (off + 2 >= row.length) continue;
      row[off]     = 0x20; // R
      row[off + 1] = 0x70; // G (teal-ish)
      row[off + 2] = 0x9a; // B
    }
  }
}

const rawData    = Buffer.concat(rows);
const compressed = zlib.deflateSync(rawData, { level: 6 });

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const png = Buffer.concat([
  sig,
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', compressed),
  pngChunk('IEND', Buffer.alloc(0)),
]);

// ── Write & Report ────────────────────────────────────────────────────────────

fs.writeFileSync(outputPath, png);
process.stdout.write(`[MOCK] Screenshot saved: ${outputPath} (${W}x${H} px, ${png.length} bytes)\n`);
