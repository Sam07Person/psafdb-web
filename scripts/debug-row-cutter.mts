// Dumps internal signals from computeBands for one or more fixtures.
// Run: node --experimental-strip-types scripts/debug-row-cutter.mts test5 test12 ...

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { computeBands } from "../src/lib/imageRowSplitter.ts";

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

async function findFile(key: string): Promise<string> {
  const entries = await fs.readdir(IMG_DIR);
  const f = entries.find((e) => e.replace(/\.(png|jpe?g)$/i, "") === key);
  if (!f) throw new Error(`no fixture ${key}`);
  return path.join(IMG_DIR, f);
}

async function main() {
  const keys = process.argv.slice(2);
  for (const key of keys) {
    const { data, width, height } = await decode(await findFile(key));
    const res = computeBands(data, width, height, { debug: true });
    const d = res.debug as any;
    console.log(`\n=== ${key}  ${width}x${height} ===`);
    console.log(`blocks:`, (d.blocks || []).map((b: any) => `${b.y0}-${b.y1}(${b.y1 - b.y0})`).join(" "), `lineupIdx=${d.lineupIdx}`);
    console.log(`medRunH=${d.medRunH} rowMergeThr=${d.rowMergeThr} rowHEst=${(d.rowHEst||0).toFixed(1)} blockMergeThr=${d.blockMergeThr}`);
    if (d.corr) {
      const c = d.corr as number[];
      const lags = c.map((_, i) => i).filter((i) => c[i] !== undefined);
      const mx = Math.max(...lags.map((i) => c[i]));
      console.log("corr:", lags.filter((l) => l % 2 === 0).map((l) => `${l}:${(c[l] / mx).toFixed(2)}`).join(" "));
    }
    console.log(`starterTop=${d.starterTop} starterBot=${d.starterBot} pivot=${(d.pivot||0).toFixed(1)} pLo=${d.pLo} pHi=${d.pHi}`);
    console.log(`rowH=${(d.rowH||0).toFixed(1)} subStart=${d.subStart} subEnd=${d.subEnd}`);
    console.log(`subRuns:`, (d.subRuns || []).map((r: any) => `${r[0]}-${r[1]}`).join(" "));
    console.log(`validSubRuns:`, (d.validSubRuns || []).map((r: any) => `${r[0]}-${r[1]}`).join(" "));
    console.log(`-> starters:`, res.starterBands.map((b) => `${b.y0}-${b.y1}`).join(" "));
    console.log(`-> subs:`, res.subBands.map((b) => `${b.y0}-${b.y1}`).join(" ") || "-");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
