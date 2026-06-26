// Prints an ASCII per-scanline profile (activity, luminance, saturation) so the
// vertical structure of a fixture can be inspected when designing the detector.
// Run: node --experimental-strip-types scripts/profile-row-cutter.mts test5

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMG_DIR = path.join(__dirname, "..", "images", "result-test-images");

async function decode(file: string) {
  const buf = await fs.readFile(file);
  if (/\.png$/i.test(file)) {
    const png = PNG.sync.read(buf);
    return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
  }
  const raw = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  return { data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height };
}

async function findFile(key: string) {
  const entries = await fs.readdir(IMG_DIR);
  const f = entries.find((e) => e.replace(/\.(png|jpe?g)$/i, "") === key)!;
  return path.join(IMG_DIR, f);
}

function bar(v: number, max: number, width: number) {
  const n = Math.round((v / (max || 1)) * width);
  return "#".repeat(Math.max(0, Math.min(width, n)));
}

async function main() {
  const key = process.argv[2];
  const { data, width: W, height: H } = await decode(await findFile(key));
  const step = Math.max(1, Math.floor(Math.min(W, H) / 600));
  const act: number[] = [], lum: number[] = [], sat: number[] = [];
  const sampledPerRow = Math.ceil(W / step);
  for (let y = 0; y < H; y++) {
    let edge = 0, lsum = 0, s = 0, n = 0, prev = -1;
    for (let x = 0; x < W; x += step) {
      const i = (y * W + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      if (prev >= 0) edge += Math.abs(l - prev);
      prev = l; lsum += l;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx > 100 && (mx - mn) / mx > 0.45) s++;
      n++;
    }
    act.push(n > 1 ? edge / (n - 1) : 0);
    lum.push(n ? lsum / n : 0);
    sat.push(s / sampledPerRow);
  }
  const maxA = Math.max(...act);
  // bucket to ~90 rows
  const buckets = 90;
  console.log(`${key} ${W}x${H}  (act|lum|sat per ~${(H / buckets).toFixed(1)}px)`);
  for (let bk = 0; bk < buckets; bk++) {
    const y0 = Math.floor((bk * H) / buckets);
    const y1 = Math.floor(((bk + 1) * H) / buckets);
    let a = 0, l = 0, s = 0, c = 0;
    for (let y = y0; y < y1; y++) { a += act[y]; l += lum[y]; s += sat[y]; c++; }
    a /= c; l /= c; s /= c;
    const yMid = Math.round((y0 + y1) / 2);
    console.log(
      `${String(yMid).padStart(4)} |${bar(a, maxA, 30).padEnd(30)}| ${bar(l, 255, 10).padEnd(10)} ${s > 0.15 ? "SAT" : ""}`
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
