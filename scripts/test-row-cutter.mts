// Node test harness for the row cutter. Decodes the 15 fixture screenshots to
// raw RGBA and runs the pure `computeBands` core, asserting the acceptance
// criteria (exactly 6 near-equal starter bands + the expected number of subs).
//
// Run: node --experimental-strip-types scripts/test-row-cutter.mts

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { computeBands, type Band } from "../src/lib/imageRowSplitter.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const IMG_DIR = path.join(ROOT, "images", "result-test-images");

// expected FILLED substitute count per fixture (starters are always 6). Empty
// "Sub N" placeholder slots (e.g. test13's "Join") do not count.
const EXPECTED_SUBS: Record<string, number> = {
  test1: 0, test2: 1, test3: 1, test4: 1, test5: 1,
  test6: 1, test7: 0, test8: 0, test9: 1, test10: 0,
  test11: 0, test12: 0, test13: 0, test14: 1, test15: 3,
  // newer fixtures: test16 (2 filled subs + empty Sub3), test17 (Sub2 filled
  // only), test18 (3 filled subs), test19 (empty RB position, no subs),
  // test20 (empty LW position, no subs).
  test16: 2, test17: 1, test18: 3, test19: 0, test20: 0,
};

type Decoded = { data: Uint8ClampedArray; width: number; height: number };

async function decode(file: string): Promise<Decoded> {
  const buf = await fs.readFile(file);
  if (/\.png$/i.test(file)) {
    const png = PNG.sync.read(buf);
    return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
  }
  const raw = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  return { data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height };
}

function bandH(b: Band): number {
  return b.y1 - b.y0 + 1;
}

// per-scanline text activity (same signal the detector uses) for alignment checks
function activity(data: Uint8ClampedArray, W: number, H: number): number[] {
  const step = Math.max(1, Math.floor(Math.min(W, H) / 600));
  const act: number[] = new Array(H).fill(0);
  for (let y = 0; y < H; y++) {
    let edge = 0, n = 0, prev = -1;
    for (let x = 0; x < W; x += step) {
      const i = (y * W + x) * 4;
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (prev >= 0) edge += Math.abs(l - prev);
      prev = l; n++;
    }
    act[y] = n > 1 ? edge / (n - 1) : 0;
  }
  return act;
}

function rowDensity(act: number[], center: number, half: number): number {
  let s = 0, n = 0;
  for (let y = Math.round(center - half); y <= Math.round(center + half); y++) {
    if (y >= 0 && y < act.length) { s += act[y]; n++; }
  }
  return n ? s / n : 0;
}

function stats(bands: Band[]): { min: number; max: number; mean: number; cv: number } {
  const hs = bands.map(bandH);
  const mean = hs.reduce((a, b) => a + b, 0) / hs.length;
  const variance = hs.reduce((a, b) => a + (b - mean) ** 2, 0) / hs.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  return { min: Math.min(...hs), max: Math.max(...hs), mean, cv };
}

async function main() {
  const entries = (await fs.readdir(IMG_DIR))
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .sort((a, b) => (parseInt(a.replace(/\D/g, "")) || 0) - (parseInt(b.replace(/\D/g, "")) || 0));

  let passed = 0;
  const failures: string[] = [];

  for (const name of entries) {
    const key = name.replace(/\.(png|jpe?g)$/i, "");
    const expSubs = EXPECTED_SUBS[key];
    const { data, width, height } = await decode(path.join(IMG_DIR, name));
    const res = computeBands(data, width, height);

    const nStart = res.starterBands.length;
    const nSub = res.subBands.length;
    const st = stats(res.starterBands);

    const problems: string[] = [];
    if (nStart !== 6) problems.push(`starters=${nStart} (want 6)`);
    if (expSubs !== undefined && nSub !== expSubs) problems.push(`subs=${nSub} (want ${expSubs})`);
    // starter bands should be near-equal in height (no row swallowing a neighbour)
    if (nStart === 6 && st.cv > 0.18) problems.push(`uneven starters cv=${st.cv.toFixed(2)}`);
    // bands must be ordered, positive, non-overlapping
    for (let i = 0; i < res.allBands.length; i++) {
      const b = res.allBands[i];
      if (b.y1 <= b.y0) problems.push(`band ${i} non-positive`);
      if (i > 0 && b.y0 < res.allBands[i - 1].y0) problems.push(`band ${i} out of order`);
    }

    // alignment: the row slot just ABOVE the first starter must be comparatively
    // empty. If the grid were shifted down (dropping the GK), that slot would
    // still hold the GK's text — this catches the "GK missed" failure mode.
    let aboveDensity = 0, medRowDensity = 0;
    if (nStart === 6) {
      const act = activity(data, width, height);
      const centers = res.starterBands.map((b) => (b.y0 + b.y1) / 2);
      const pitch = centers[1] - centers[0];
      const half = pitch * 0.32;
      const rowDs = centers.map((c) => rowDensity(act, c, half)).sort((a, b) => a - b);
      medRowDensity = rowDs[Math.floor(rowDs.length / 2)];
      aboveDensity = rowDensity(act, centers[0] - pitch, half);
      if (aboveDensity > 0.65 * medRowDensity) {
        problems.push(`row above GK not empty (${aboveDensity.toFixed(1)} vs row ${medRowDensity.toFixed(1)}) — likely dropped top row`);
      }
    }

    const ok = problems.length === 0;
    if (ok) passed++;
    else failures.push(key);

    const tag = ok ? "PASS" : "FAIL";
    const sb = res.starterBands.map((b) => `${b.y0}-${b.y1}`).join(" ");
    const subStr = res.subBands.map((b) => `${b.y0}-${b.y1}`).join(" ") || "-";
    console.log(
      `[${tag}] ${key.padEnd(7)} ${width}x${height}  starters=${nStart} subs=${nSub}` +
        `  cv=${st.cv.toFixed(2)} hMean=${st.mean.toFixed(0)}` +
        (ok ? "" : `  << ${problems.join("; ")}`)
    );
    if (!ok) {
      console.log(`        starter y: ${sb}`);
      console.log(`        sub y:     ${subStr}`);
    }
  }

  console.log(`\n${passed}/${entries.length} images passed.`);
  if (failures.length) {
    console.log(`Failing: ${failures.join(", ")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
