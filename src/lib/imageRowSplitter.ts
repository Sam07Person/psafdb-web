// ============================================================
// imageRowSplitter — automated, size-agnostic cutting tool for
// match-result screenshots.
//
// Given a screenshot data URL, it:
//   1. Detects the coloured team panel(s) (e.g. green / tan blocks)
//      regardless of zoom / resolution.
//   2. Splits each panel into individual horizontal player-row
//      strips so each player's stats can be processed in isolation.
//   3. Returns the crops + a debug overlay for previewing the cuts.
//
// Pure client-side (uses <canvas>). No AI, no network.
// ============================================================

export type RowStrip = {
  /** 0-based index of the row within its panel */
  index: number;
  /** y-range (in original image pixels) of this row */
  y0: number;
  y1: number;
  /** cropped strip as a PNG data URL */
  dataUrl: string;
  width: number;
  height: number;
};

export type DetectedPanel = {
  /** 0-based index of the panel within the image (left→right, top→bottom) */
  index: number;
  /** bounding box of the panel in original image pixels */
  box: { x: number; y: number; w: number; h: number };
  /** dominant panel colour, for debugging */
  color: { r: number; g: number; b: number };
  /** whether row boundaries were auto-detected (true) or evenly divided (false) */
  autoDetected: boolean;
  rows: RowStrip[];
};

export type SplitResult = {
  /** original image dimensions */
  width: number;
  height: number;
  panels: DetectedPanel[];
  /** original image with detected boxes + cut lines drawn on top (PNG data URL) */
  overlayDataUrl: string;
};

export type SplitOptions = {
  /**
   * Force a specific number of rows per panel instead of auto-detecting.
   * Useful as a reliable fallback when auto-detection mis-counts.
   */
  forcedRowCount?: number;
  /** Extra vertical padding (px, scaled to image) added to each crop. Default 2. */
  rowPadding?: number;
};

// ---------- small colour helpers ----------

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const v = max;
  const s = max === 0 ? 0 : (max - min) / max;
  let h = 0;
  const d = max - min;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, v];
}

function isVivid(r: number, g: number, b: number): boolean {
  const [, s, v] = rgbToHsv(r, g, b);
  // saturated and bright enough — excludes the blurry desaturated
  // background and the near-black centre/sub panels.
  return s >= 0.28 && v >= 0.3;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// ---------- generic 1-D run / smoothing helpers ----------

function smooth(arr: number[], radius: number): number[] {
  if (radius <= 0) return arr.slice();
  const out = new Array(arr.length).fill(0);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0, n = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j >= 0 && j < arr.length) { sum += arr[j]; n++; }
    }
    out[i] = sum / n;
  }
  return out;
}

/** Contiguous runs of indices where value > threshold and run length >= minLen. */
function findRuns(values: number[], threshold: number, minLen: number): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > threshold) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      if (i - start >= minLen) runs.push([start, i - 1]);
      start = -1;
    }
  }
  if (start !== -1 && values.length - start >= minLen) runs.push([start, values.length - 1]);
  return runs;
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

  // sampling step keeps it fast on large images while staying size-agnostic
  const step = Math.max(1, Math.floor(Math.min(W, H) / 500));
  const px = (x: number, y: number) => {
    const i = (y * W + x) * 4;
    return [data[i], data[i + 1], data[i + 2]] as const;
  };

  // --- 1. vertical bands: rows of the image that are mostly "vivid" ---
  const rowVivid: number[] = new Array(H).fill(0);
  for (let y = 0; y < H; y++) {
    let vivid = 0, total = 0;
    for (let x = 0; x < W; x += step) {
      const [r, g, b] = px(x, y);
      if (isVivid(r, g, b)) vivid++;
      total++;
    }
    rowVivid[y] = total ? vivid / total : 0;
  }
  const rowVividS = smooth(rowVivid, Math.max(1, Math.floor(H / 300)));
  // bands must be at least ~4% of image height to count as a panel
  const yBands = findRuns(rowVividS, 0.4, Math.max(4, Math.floor(H * 0.04)));

  const padding = opts.rowPadding ?? Math.max(1, Math.round(H * 0.002));
  const panels: DetectedPanel[] = [];
  let panelIdx = 0;

  for (const [yTop, yBottom] of yBands) {
    // --- 2. within a vertical band, find horizontal extent(s) of panel(s) ---
    const colVivid: number[] = new Array(W).fill(0);
    for (let x = 0; x < W; x++) {
      let vivid = 0, total = 0;
      for (let y = yTop; y <= yBottom; y += step) {
        const [r, g, b] = px(x, y);
        if (isVivid(r, g, b)) vivid++;
        total++;
      }
      colVivid[x] = total ? vivid / total : 0;
    }
    const colVividS = smooth(colVivid, Math.max(1, Math.floor(W / 300)));
    const xRuns = findRuns(colVividS, 0.5, Math.max(8, Math.floor(W * 0.05)));

    for (const [xLeft, xRight] of xRuns) {
      const box = { x: xLeft, y: yTop, w: xRight - xLeft + 1, h: yBottom - yTop + 1 };

      // dominant panel colour = average of vivid pixels in box
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let y = box.y; y < box.y + box.h; y += step) {
        for (let x = box.x; x < box.x + box.w; x += step) {
          const [r, g, b] = px(x, y);
          if (isVivid(r, g, b)) { sr += r; sg += g; sb += b; n++; }
        }
      }
      const color = n
        ? { r: Math.round(sr / n), g: Math.round(sg / n), b: Math.round(sb / n) }
        : { r: 0, g: 0, b: 0 };

      // --- 3. split the panel into player rows ---
      const { boundaries, autoDetected } = detectRowBoundaries(
        px, box, color, step, opts.forcedRowCount
      );

      // --- 4. crop each row ---
      const rows: RowStrip[] = [];
      for (let i = 0; i < boundaries.length - 1; i++) {
        const ry0 = Math.max(box.y, boundaries[i] - padding);
        const ry1 = Math.min(box.y + box.h, boundaries[i + 1] + padding);
        const rh = ry1 - ry0;
        if (rh <= 2) continue;
        const c = document.createElement("canvas");
        c.width = box.w;
        c.height = rh;
        const cctx = c.getContext("2d")!;
        cctx.drawImage(img, box.x, ry0, box.w, rh, 0, 0, box.w, rh);
        rows.push({
          index: rows.length,
          y0: ry0,
          y1: ry1,
          dataUrl: c.toDataURL("image/png"),
          width: box.w,
          height: rh,
        });
      }

      panels.push({ index: panelIdx++, box, color, autoDetected, rows });
    }
  }

  const overlayDataUrl = drawOverlay(img, W, H, panels);
  return { width: W, height: H, panels, overlayDataUrl };
}

/**
 * Find horizontal cut lines inside a panel.
 * Strategy: compute, per scan-line, how "pure" the panel colour is.
 * Player-row interiors are dominated by the base colour → high purity.
 * The thin dividers between rows are darker → dips (local minima).
 * If the detected minima are sane and roughly evenly spaced we use them,
 * otherwise (or when forcedRowCount is given) we fall back to even division.
 */
function detectRowBoundaries(
  px: (x: number, y: number) => readonly [number, number, number],
  box: { x: number; y: number; w: number; h: number },
  color: { r: number; g: number; b: number },
  step: number,
  forcedRowCount?: number
): { boundaries: number[]; autoDetected: boolean } {
  const top = box.y;
  const bottom = box.y + box.h - 1;

  if (forcedRowCount && forcedRowCount > 0) {
    return { boundaries: evenDivide(top, bottom, forcedRowCount), autoDetected: false };
  }

  // purity per scan-line: fraction of pixels close to the base colour
  const purity: number[] = new Array(box.h).fill(0);
  const TOL = 60; // RGB euclidean-ish tolerance
  for (let y = 0; y < box.h; y++) {
    let close = 0, total = 0;
    for (let x = box.x; x < box.x + box.w; x += step) {
      const [r, g, b] = px(x, top + y);
      const dr = r - color.r, dg = g - color.g, db = b - color.b;
      if (Math.sqrt(dr * dr + dg * dg + db * db) < TOL) close++;
      total++;
    }
    purity[y] = total ? close / total : 0;
  }
  const sm = smooth(purity, Math.max(1, Math.floor(box.h / 150)));

  // Rows are a uniform height, so instead of counting every dip in the signal
  // (text / badges create false dividers → over-segmentation) we find the one
  // dominant row period via autocorrelation and derive the count from it.
  const n = sm.length;
  const mean = sm.reduce((a, b) => a + b, 0) / n;
  const s = sm.map((v) => v - mean);
  const denom = s.reduce((a, b) => a + b * b, 0) || 1;

  const lagMin = Math.max(5, Math.floor(box.h / 12)); // allow up to ~12 rows
  const lagMax = Math.max(lagMin + 1, Math.floor(box.h / 3)); // down to ~3 rows
  const scores: number[] = new Array(lagMax + 1).fill(-Infinity);
  let globalMax = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) sum += s[i] * s[i + lag];
    scores[lag] = sum / denom;
    if (scores[lag] > globalMax) globalMax = scores[lag];
  }

  // Weak / no periodicity → safe even split.
  if (globalMax < 0.08) {
    return { boundaries: evenDivide(top, bottom, 6), autoDetected: false };
  }

  // Each cell stacks a label line above a value line, so the strongest peak can
  // be a half-row harmonic (→ too many strips). Prefer the LONGEST period that
  // still scores near the max and is a local peak: this collapses harmonics back
  // to the true per-player row height.
  let bestLag = 0;
  for (let lag = lagMax; lag >= lagMin; lag--) {
    if (scores[lag] < 0.72 * globalMax) continue;
    const lo = scores[lag - 1] ?? -Infinity;
    const hi = scores[lag + 1] ?? -Infinity;
    if (scores[lag] >= lo && scores[lag] >= hi) { bestLag = lag; break; }
  }
  if (bestLag === 0) {
    // no qualifying peak — fall back to the global argmax
    for (let lag = lagMin; lag <= lagMax; lag++) {
      if (scores[lag] === globalMax) { bestLag = lag; break; }
    }
  }

  const count = Math.min(11, Math.max(3, Math.round(box.h / bestLag)));

  // Space the cuts evenly by the detected count, then snap each interior line
  // onto the nearest real divider (local minimum of the purity signal) so cuts
  // land between rows rather than through text.
  const minima = findLocalMinima(sm, Math.max(2, Math.floor(bestLag / 4)));
  const snapWin = bestLag * 0.3;
  const boundaries: number[] = [top];
  for (let i = 1; i < count; i++) {
    const even = Math.round((box.h * i) / count);
    let snap = even;
    let bestDist = snapWin + 1;
    for (const m of minima) {
      const d = Math.abs(m - even);
      if (d <= snapWin && d < bestDist) { bestDist = d; snap = m; }
    }
    boundaries.push(top + snap);
  }
  boundaries.push(bottom);

  // guarantee strictly increasing boundaries
  for (let i = 1; i < boundaries.length; i++) {
    if (boundaries[i] <= boundaries[i - 1]) boundaries[i] = boundaries[i - 1] + 1;
  }

  return { boundaries, autoDetected: true };
}

/** Local minima of a 1-D signal, de-duplicated within `win` of each other. */
function findLocalMinima(sig: number[], win: number): number[] {
  const out: number[] = [];
  for (let i = win; i < sig.length - win; i++) {
    let isMin = true;
    for (let k = -win; k <= win; k++) {
      if (sig[i + k] < sig[i]) { isMin = false; break; }
    }
    if (!isMin) continue;
    if (out.length && i - out[out.length - 1] <= win) {
      if (sig[i] < sig[out[out.length - 1]]) out[out.length - 1] = i;
    } else {
      out.push(i);
    }
  }
  return out;
}

function evenDivide(top: number, bottom: number, count: number): number[] {
  const out: number[] = [];
  const h = bottom - top;
  for (let i = 0; i <= count; i++) out.push(Math.round(top + (h * i) / count));
  return out;
}

function drawOverlay(
  img: HTMLImageElement,
  W: number,
  H: number,
  panels: DetectedPanel[]
): string {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const lw = Math.max(1, Math.round(Math.min(W, H) / 400));

  for (const p of panels) {
    ctx.strokeStyle = "rgba(56,189,248,0.95)"; // panel box (sky)
    ctx.lineWidth = lw * 2;
    ctx.strokeRect(p.box.x, p.box.y, p.box.w, p.box.h);

    ctx.strokeStyle = "rgba(244,63,94,0.95)"; // cut lines (rose)
    ctx.lineWidth = lw;
    for (const row of p.rows) {
      ctx.beginPath();
      ctx.moveTo(p.box.x, row.y1);
      ctx.lineTo(p.box.x + p.box.w, row.y1);
      ctx.stroke();
    }
  }
  return c.toDataURL("image/png");
}
