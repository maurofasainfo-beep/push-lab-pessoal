import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const iconDir = resolve(root, "apps/web/public/icons");

function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[index] = value >>> 0;
    }
    crc32.table = table;
  }

  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function png(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function drawIcon(size) {
  const buffer = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  const center = size / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const cornerDistance = Math.hypot(Math.max(Math.abs(x - center) - center + radius, 0), Math.max(Math.abs(y - center) - center + radius, 0));
      const insideRoundedSquare = cornerDistance <= radius;
      if (!insideRoundedSquare) {
        buffer[index + 3] = 0;
        continue;
      }

      buffer[index] = 23;
      buffer[index + 1] = 37;
      buffer[index + 2] = 84;
      buffer[index + 3] = 255;

      const bellCenterY = size * 0.49;
      const bell = Math.hypot((x - center) / (size * 0.23), (y - bellCenterY) / (size * 0.22)) < 1;
      if (bell && y < size * 0.68) {
        buffer[index] = 239;
        buffer[index + 1] = 246;
        buffer[index + 2] = 255;
      }

      const clapper = Math.hypot((x - center) / (size * 0.09), (y - size * 0.73) / (size * 0.07)) < 1;
      if (clapper) {
        buffer[index] = 191;
        buffer[index + 1] = 219;
        buffer[index + 2] = 254;
      }

      const badge = Math.hypot(x - size * 0.69, y - size * 0.31) < size * 0.08;
      if (badge) {
        buffer[index] = 34;
        buffer[index + 1] = 197;
        buffer[index + 2] = 94;
      }
    }
  }
  return buffer;
}

function writeIcon(file, size) {
  mkdirSync(dirname(file), { recursive: true });
  const image = png(size, size, drawIcon(size));
  writeFileSync(file, image);
  return createHash("sha256").update(image).digest("hex");
}

for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180]
]) {
  const hash = writeIcon(resolve(iconDir, name), size);
  console.log(`${name} ${hash}`);
}
