// Renders the detected starter/sub bands onto each fixture so the cuts can be
// inspected visually. Starter boundaries = red, sub boundaries = yellow.
// Run: node --experimental-strip-types scripts/overlay-row-cutter.mts test4 test14

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { computeBands, type Band } from "../src/lib/imageRowSplitter.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMG_DIR = path.join(__dirname, "..", "images", "result-test-images");
const OUT_DIR = path.join(__dirname, "out");

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

function hline(png: PNG, y: number, W: number, r: number, g: number, b: number, thick = 2) {
  for (let t = -thick; t <= thick; t++) {
    const yy = y + t;
    if (yy < 0 || yy >= png.height) continue;
    for (let x = 0; x < W; x++) {
      const i = (yy * W + x) * 4;
      png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
    }
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  for (const key of process.argv.slice(2)) {
    const { data, width: W, height: H } = await decode(await findFile(key));
    const res = computeBands(data, W, H);
    const png = new PNG({ width: W, height: H });
    png.data.set(data);
    const draw = (bands: Band[], r: number, g: number, b: number) => {
      for (const band of bands) { hline(png, band.y0, W, r, g, b); hline(png, band.y1, W, r, g, b); }
    };
    draw(res.starterBands, 244, 63, 94);   // rose = starters
    draw(res.subBands, 250, 204, 21);       // yellow = subs
    const out = path.join(OUT_DIR, `${key}.png`);
    await fs.writeFile(out, PNG.sync.write(png));
    console.log(`${key}: starters=${res.starterBands.length} subs=${res.subBands.length} -> ${out}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
