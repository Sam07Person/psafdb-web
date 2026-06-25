// ============================================================
// imageRowSplitter — theme-agnostic cutting tool for match-result
// screenshots.
//
// Works on ANY colour scheme (green / tan / white / dark) because it
// does NOT key on a specific panel colour. Pipeline:
//   1. Per-scanline signals: text/edge activity, brightness, saturation.
//   2. Bound the UI region(s): a scanline belongs to the UI if it is
//      bright (light panels) OR busy with text (any panel). This isolates
//      the lineup block and any sub boxes from the blurry background.
//   3. The tallest region = starting lineup; boxes below it = substitutes.
//   4. Trim the column-header strip off the lineup using the first row's
//      rating badge (the first saturated content from the top).
//   5. Even-divide the lineup into the player count (default 6 = 6v6),
//      and cut each sub box. Subs are tagged separately.
//
// Pure client-side (uses <canvas>). No AI, no network.
// ============================================================

export type RowStrip = {
  index: number;
  y0: number;
  y1: number;
  dataUrl: string;
  width: number;
  height: number;
  isSub: boolean;
  label: string; // "1".."6" or "Sub 1"
};

export type DetectedPanel = {
  index: number;
  box: { x: number; y: number; w: number; h: number };
  color: { r: number; g: number; b: number };
  autoDetected: boolean;
  rows: RowStrip[];
};

export type SplitResult = {
  width: number;
  height: number;
  panels: DetectedPanel[];
  overlayDataUrl: string;
};

export type SplitOptions = {
  /** Force a fixed number of STARTER rows instead of auto-detecting. */
  forcedRowCount?: number;
  /** Extra vertical padding (px) added to each crop. */
  rowPadding?: number;
};

// ---------- helpers ----------

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function smooth(arr: number[], radius: number): number[] {
  if (radius <= 0) return arr.slice();
  const out = new Array(arr.length).fill(0);
  for (let i = 0; i < arr.length; i++) {
    let s = 0, n = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j >= 0 && j < arr.length) { s += arr[j]; n++; }
    }
    out[i] = s / n;
  }
  return out;
}

function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * s.length)));
  return s[idx];
}

type Band = { y0: number; y1: number };

function findBands(flags: boolean[], minLen: number): Band[] {
  const bands: Band[] = [];
  let start = -1;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i]) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      if (i - start >= minLen) bands.push({ y0: start, y1: i - 1 });
      start = -1;
    }
  }
  if (start !== -1 && flags.length - start >= minLen) bands.push({ y0: start, y1: flags.length - 1 });
  return bands;
}

function evenSplit(top: number, bottom: number, count: number): Band[] {
  const out: Band[] = [];
  const h = bottom - top;
  for (let i = 0; i < count; i++) {
    out.push({
      y0: Math.round(top + (h * i) / count),
      y1: Math.round(top + (h * (i + 1)) / count) - 1,
    });
  }
  return out;
}

// ---------- core ----------

export async function splitMatchImage(
  dataUrl: string,
  opts: SplitOptions = {}
): Promise<SplitResult> {
  const img = await loadImage(dataUrl);
  const W = img.naturalWidth;
  const H = img.naturalHeight;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, W, H);

  const step = Math.max(1, Math.floor(Math.min(W, H) / 600));

  // --- 1. per-scanline signals ---
  const act: number[] = new Array(H).fill(0);     // text/edge density
  const lumRow: number[] = new Array(H).fill(0);  // mean brightness
  const satRow: number[] = new Array(H).fill(0);  // # saturated pixels (badges/fills)
  for (let y = 0; y < H; y++) {
    let edge = 0, lsum = 0, sat = 0, n = 0;
    let prev = -1;
    for (let x = 0; x < W; x += step) {
      const i = (y * W + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      if (prev >= 0) edge += Math.abs(l - prev);
      prev = l;
      lsum += l;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const s = max === 0 ? 0 : (max - min) / max;
      if (s > 0.45 && max > 100) sat++;
      n++;
    }
    act[y] = n > 1 ? edge / (n - 1) : 0;
    lumRow[y] = n ? lsum / n : 0;
    satRow[y] = sat;
  }
  const actS = smooth(act, Math.max(1, Math.floor(H / 400)));
  const lumS = smooth(lumRow, Math.max(1, Math.floor(H / 400)));

  // --- 2. bound UI region(s): bright OR busy with text ---
  const bgAct = percentile(actS, 30);
  const maxAct = Math.max(...actS);
  const actThr = bgAct + 0.16 * (maxAct - bgAct);
  const bgLum = percentile(lumS, 30);
  const maxLum = Math.max(...lumS);
  const brightThr = bgLum + 0.45 * (maxLum - bgLum);

  const ui: boolean[] = new Array(H);
  for (let y = 0; y < H; y++) ui[y] = actS[y] > actThr || lumS[y] > brightThr;

  // Bridge thin internal gaps (row dividers dip below threshold) so a single
  // panel doesn't fragment into one region per row. The large gap between the
  // lineup and the sub boxes is wider than this and stays intact.
  const closeLen = Math.max(2, Math.floor(H * 0.03));
  let gapStart = -1;
  for (let y = 0; y < H; y++) {
    if (!ui[y]) {
      if (gapStart === -1) gapStart = y;
    } else if (gapStart !== -1) {
      if (gapStart > 0 && y - gapStart <= closeLen) {
        for (let k = gapStart; k < y; k++) ui[k] = true;
      }
      gapStart = -1;
    }
  }

  const regions = findBands(ui, Math.max(2, Math.floor(H * 0.012)));

  if (regions.length === 0) {
    // nothing found — fall back to an even 6-way split of the whole image
    return buildResult(img, W, H, evenSplit(0, H - 1, opts.forcedRowCount || 6), opts.forcedRowCount || 6, data, step, opts);
  }

  // tallest region = main lineup container
  let lineup = regions[0];
  for (const r of regions) if (r.y1 - r.y0 > lineup.y1 - lineup.y0) lineup = r;

  // --- 3. detect theme: a saturated colour fill vs a light/neutral panel ---
  const sampledPerRow = Math.ceil(W / step);
  let satSum = 0, cnt = 0;
  for (let y = lineup.y0; y <= lineup.y1; y++) { satSum += satRow[y]; cnt++; }
  const colored = cnt > 0 && satSum / cnt / sampledPerRow > 0.2;

  const forced = opts.forcedRowCount && opts.forcedRowCount > 0 ? opts.forcedRowCount : 0;
  const autoDetected = forced === 0;
  let starterBands: Band[] = [];
  const subBands: Band[] = [];

  if (colored) {
    // ---- COLORED panel: the whole region is the lineup; even-divide it ----
    // Trim a header strip if the first saturated row is well below the top.
    const provRowH = (lineup.y1 - lineup.y0 + 1) / (forced || 6);
    let firstSat = lineup.y0;
    for (let y = lineup.y0; y <= lineup.y1; y++) if (satRow[y] >= 2) { firstSat = y; break; }
    if (firstSat - lineup.y0 > provRowH * 0.55) {
      lineup = { y0: Math.max(lineup.y0, Math.round(firstSat - provRowH * 0.45)), y1: lineup.y1 };
    }
    const count = forced || chooseCount(actS, lineup.y0, lineup.y1);
    starterBands = evenSplit(lineup.y0, lineup.y1, count);
    const estRowH = (lineup.y1 - lineup.y0 + 1) / count;
    for (const sr of regions.filter((r) => r.y0 > lineup.y1)) {
      const h = sr.y1 - sr.y0 + 1;
      if (h < estRowH * 0.5) continue;
      subBands.push(...evenSplit(sr.y0, sr.y1, Math.max(1, Math.round(h / estRowH))));
    }
  } else {
    // ---- LIGHT panel: anchor rows on the per-player rating badges ----
    // Each player row has one saturated rating shield; the header has none and
    // sub boxes are separated from the lineup by extra spacing. Anchoring on the
    // badges gives the true row pitch and cleanly separates starters from subs.
    const satThr = Math.max(6, Math.floor(W * 0.006));
    const runs: Array<[number, number]> = [];
    let rs = -1;
    for (let y = 0; y < H; y++) {
      if (ui[y] && satRow[y] > satThr) { if (rs === -1) rs = y; }
      else if (rs !== -1) { runs.push([rs, y - 1]); rs = -1; }
    }
    if (rs !== -1) runs.push([rs, H - 1]);

    // Merge runs belonging to the SAME badge (a shield can dip below threshold
    // for a scan-line, splitting into two runs → doubled centers → tiny rowH).
    // The gap inside a badge is tiny; the gap to the next row's badge is ~rowH.
    const mergeDist = Math.max(4, Math.floor(H * 0.025));
    const merged: Array<[number, number]> = [];
    for (const r of runs) {
      const last = merged[merged.length - 1];
      if (last && r[0] - last[1] <= mergeDist) last[1] = r[1];
      else merged.push([r[0], r[1]]);
    }
    const minRun = Math.max(2, Math.floor(H * 0.006));
    const centers = merged
      .filter(([a, b]) => b - a + 1 >= minRun)
      .map(([a, b]) => (a + b) / 2);

    if (centers.length >= 3) {
      const gaps: number[] = [];
      for (let i = 1; i < centers.length; i++) gaps.push(centers[i] - centers[i - 1]);
      const minGap = Math.min(...gaps);
      const small = gaps.filter((g) => g <= minGap * 1.4);
      const rowH = small.length ? small.reduce((a, b) => a + b, 0) / small.length : minGap;
      const count = forced || 6;
      const starterTop = Math.max(0, Math.round(centers[0] - rowH / 2));
      const starterBottom = Math.min(H - 1, Math.round(starterTop + rowH * count));
      starterBands = evenSplit(starterTop, starterBottom, count);
      for (const c of centers) {
        if (c >= starterBottom - rowH * 0.3) {
          subBands.push({
            y0: Math.max(0, Math.round(c - rowH / 2)),
            y1: Math.min(H - 1, Math.round(c + rowH / 2)),
          });
        }
      }
    } else {
      starterBands = evenSplit(lineup.y0, lineup.y1, forced || 6);
    }
  }

  const allBands = [...starterBands, ...subBands];
  const splitAt = starterBands.length;
  return buildResult(img, W, H, allBands, splitAt, data, step, opts, autoDetected);
}

/** Pick the starter count by how well evenly-spaced cuts fall on activity gaps
 *  (low-activity valleys between rows), with a gentle prior toward 6 (6v6). */
function chooseCount(actS: number[], top: number, bottom: number): number {
  const h = bottom - top;
  if (h <= 4) return 6;
  const PRIOR = 6;
  const score = (C: number): number => {
    let sum = 0;
    for (let i = 1; i < C; i++) {
      const y = Math.round(top + (h * i) / C);
      sum += actS[Math.min(actS.length - 1, Math.max(0, y))];
    }
    const meanActAtCuts = sum / (C - 1);
    return meanActAtCuts * (1 + 0.05 * Math.abs(C - PRIOR));
  };
  let best = PRIOR, bestScore = score(PRIOR);
  for (let C = 4; C <= 8; C++) {
    const s = score(C);
    if (s < bestScore) { bestScore = s; best = C; }
  }
  return best;
}

function buildResult(
  img: HTMLImageElement,
  W: number,
  H: number,
  bands: Band[],
  splitAt: number,
  data: Uint8ClampedArray,
  step: number,
  opts: SplitOptions,
  autoDetected = true
): SplitResult {
  const padding = opts.rowPadding ?? Math.max(1, Math.round(H * 0.0015));
  const rows: RowStrip[] = [];
  let starterNo = 0, subNo = 0;
  bands.forEach((b, i) => {
    const isSub = i >= splitAt;
    const ry0 = Math.max(0, b.y0 - padding);
    const ry1 = Math.min(H, b.y1 + padding);
    const rh = ry1 - ry0;
    if (rh <= 2) return;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = rh;
    const cctx = c.getContext("2d")!;
    cctx.drawImage(img, 0, ry0, W, rh, 0, 0, W, rh);
    rows.push({
      index: rows.length,
      y0: ry0,
      y1: ry1,
      dataUrl: c.toDataURL("image/png"),
      width: W,
      height: rh,
      isSub,
      label: isSub ? `Sub ${++subNo}` : `${++starterNo}`,
    });
  });

  const panels: DetectedPanel[] = [];
  if (rows.length > 0) {
    const top = rows[0].y0;
    const bottom = rows[rows.length - 1].y1;
    panels.push({
      index: 0,
      box: { x: 0, y: top, w: W, h: bottom - top },
      color: avgColor(data, W, top, bottom, step),
      autoDetected,
      rows,
    });
  }

  const overlayDataUrl = drawOverlay(img, W, H, rows);
  return { width: W, height: H, panels, overlayDataUrl };
}

function avgColor(
  data: Uint8ClampedArray,
  W: number,
  top: number,
  bottom: number,
  step: number
): { r: number; g: number; b: number } {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = top; y <= bottom; y += step) {
    for (let x = 0; x < W; x += step) {
      const i = (y * W + x) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  }
  return n ? { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) } : { r: 0, g: 0, b: 0 };
}

function drawOverlay(img: HTMLImageElement, W: number, H: number, rows: RowStrip[]): string {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const lw = Math.max(1, Math.round(Math.min(W, H) / 400));
  for (const row of rows) {
    ctx.strokeStyle = row.isSub ? "rgba(250,204,21,0.95)" : "rgba(244,63,94,0.95)";
    ctx.lineWidth = lw;
    ctx.strokeRect(1, row.y0, W - 2, row.y1 - row.y0);
  }
  return c.toDataURL("image/png");
}
