// Génère les icônes PNG (pokéball stylisée) sans dépendance : node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

function crc(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); }
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const cx = size / 2, R = size * 0.34, ss = 3;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const px = x + (sx + .5) / ss - cx, py = y + (sy + .5) / ss - cx, d = Math.hypot(px, py);
        let col = [15 + 10 * (y / size), 18 + 12 * (y / size), 34 + 30 * (y / size)];   // fond dégradé
        if (d < R) {
          col = py < -R * 0.06 ? [235, 64, 64] : [245, 245, 250];
          if (Math.abs(py) < R * 0.09) col = [25, 25, 35];
          if (d < R * 0.26) col = [25, 25, 35];
          if (d < R * 0.17) col = [255, 203, 5];
        } else if (d < R * 1.06) col = [25, 25, 35];
        r += col[0]; g += col[1]; b += col[2];
      }
      const o = y * (size * 4 + 1) + 1 + x * 4, n = ss * ss;
      raw[o] = r / n; raw[o + 1] = g / n; raw[o + 2] = b / n; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const [name, s] of [['icon-192', 192], ['icon-512', 512], ['apple-touch-icon', 180]]) writeFileSync(`icons/${name}.png`, png(s));
