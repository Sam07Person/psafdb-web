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
  /** Collect internal signals for debugging/testing (DOM-free path only). */
  debug?: boolean;
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

export type Band = { y0: number; y1: number };

export type BandResult = {
  W: number;
  H: number;
  starterBands: Band[];
  subBands: Band[];
  allBands: Band[];
  splitAt: number;
  autoDetected: boolean;
  debug?: Record<string, unknown>;
};

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
  const { allBands, splitAt, autoDetected } = computeBands(data, W, H, opts);
  return buildResult(img, W, H, allBands, splitAt, data, step, opts, autoDetected);
}

/**
 * Pure, DOM-free core: maps raw RGBA pixels to starter/sub row bands. Shared by
 * the browser entry point (`splitMatchImage`) and the Node test harness, so the
 * exact pixel math can be verified automatically against the 15 fixtures.
 */
export function computeBands(
  data: Uint8ClampedArray | Uint8Array,
  W: number,
  H: number,
  opts: SplitOptions = {}
): BandResult {
  const dbg: Record<string, unknown> = {};
  const step = Math.max(1, Math.floor(Math.min(W, H) / 600));

  // --- 1. per-scanline text/edge activity. This is the only signal we key on:
  //        every player row carries full-width text (a name + a row of stat
  //        numbers) regardless of the colour theme, grey vs colour ratings, etc.
  //        Brightness/saturation vary wildly across themes and proved unreliable.
  const act: number[] = new Array(H).fill(0);
  for (let y = 0; y < H; y++) {
    let edge = 0, n = 0, prev = -1;
    for (let x = 0; x < W; x += step) {
      const i = (y * W + x) * 4;
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (prev >= 0) edge += Math.abs(l - prev);
      prev = l;
      n++;
    }
    act[y] = n > 1 ? edge / (n - 1) : 0;
  }
  const actS = smooth(act, Math.max(1, Math.floor(H / 400)));

  const bgAct = percentile(actS, 30);
  const maxAct = Math.max(...actS);
  const actThr = bgAct + 0.16 * (maxAct - bgAct); // "is there text on this line?"
  const actLo = bgAct + 0.08 * (maxAct - bgAct);  // "is this an empty gap?"
  const subThr = bgAct + 0.09 * (maxAct - bgAct); // subs can be fainter than starters

  const forced = opts.forcedRowCount && opts.forcedRowCount > 0 ? opts.forcedRowCount : 0;
  const autoDetected = forced === 0;
  const count = forced || 6;
  const subBands: Band[] = [];

  // --- 2. text rows → blocks. Find the active runs (lines carrying text), then
  //        merge runs separated by less than an adaptive threshold into blocks.
  //        The threshold sits BETWEEN the small, even inter-row gaps and the
  //        larger gaps that frame the lineup (the header/title above, the
  //        starter/sub separator bar, and the footer below). So the 6 starters
  //        coalesce into ONE block, while a title bar, the subs, and the footer
  //        become separate blocks. ---
  const minRun = Math.max(2, Math.floor(H * 0.004));
  const runs: Band[] = [];
  {
    let rs = -1;
    for (let y = 0; y <= H; y++) {
      const on = y < H && actS[y] > actThr;
      if (on) { if (rs === -1) rs = y; }
      else if (rs !== -1) { if (y - rs >= minRun) runs.push({ y0: rs, y1: y - 1 }); rs = -1; }
    }
  }

  if (runs.length === 0) {
    const bands = evenSplit(0, H - 1, count);
    return { W, H, starterBands: bands, subBands: [], allBands: bands, splitAt: count, autoDetected, debug: opts.debug ? dbg : undefined };
  }

  const median = (xs: number[]): number => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const merge = (src: Band[], thr: number): Band[] => {
    const out: Band[] = [{ ...src[0] }];
    for (let i = 1; i < src.length; i++) {
      if (src[i].y0 - out[out.length - 1].y1 - 1 <= thr) out[out.length - 1].y1 = src[i].y1;
      else out.push({ ...src[i] });
    }
    return out;
  };

  // (a) merge the within-row name/stat sub-lines into one "row". The within-row
  //     gap is smaller than a text line is tall, whereas the inter-row gap is
  //     comparable to or larger than it — so a threshold tied to the median run
  //     height separates the two regardless of image size / zoom.
  const medRunH = median(runs.map((r) => r.y1 - r.y0 + 1));
  const rowMergeThr = Math.max(2, Math.round(medRunH * 0.9));
  const rowsMerged = merge(runs, rowMergeThr);

  // (b) row pitch via AUTOCORRELATION of the activity profile over the active
  //     span. Player rows recur at one uniform pitch, so the activity signal
  //     correlates most strongly with itself when shifted by that pitch. This
  //     is immune to (i) rows merging into one block, (ii) empty positions
  //     doubling a gap, and (iii) the starter/sub separator — none of which
  //     change the underlying period. The lag range brackets the plausible
  //     pitch (a stat table shows ~10-25 rows per screen height) and excludes
  //     the half-row harmonic from the label/value sub-lines.
  //     The lag range must contain the true pitch for any crop. Its WIDTH is set
  //     by the active span (the pitch is span / number-of-rows, and there are
  //     between ~5 and ~26 rows of content in a screenshot), while the LOWER
  //     bound also respects one text line (medRunH) so the within-row
  //     label/value sub-line spacing cannot win. Within that window the
  //     autocorrelation peaks at the fundamental row period.
  const yA = runs[0].y0;
  const yB = runs[runs.length - 1].y1;
  const span = Math.max(1, yB - yA);
  let actSum = 0;
  for (let y = yA; y <= yB; y++) actSum += actS[y];
  const actMean = yB > yA ? actSum / (yB - yA + 1) : 0;
  const lagLo = Math.max(5, Math.round(medRunH * 1.0), Math.round(span / 26));
  const lagHi = Math.max(lagLo + 2, Math.round(span / 4.5));
  const corr: number[] = [];
  let bestCorr = -Infinity;
  for (let lag = lagLo; lag <= lagHi; lag++) {
    let c = 0, m = 0;
    for (let y = yA; y + lag <= yB; y++) {
      c += (actS[y] - actMean) * (actS[y + lag] - actMean);
      m++;
    }
    c = m > 0 ? c / m : 0;
    corr[lag] = c;
    if (c > bestCorr) bestCorr = c;
  }
  // Harmonic suppression: the global peak may sit on a 2×/3× harmonic when the
  // lineup has few or irregular rows (an empty position breaks the period). The
  // true pitch is the SMALLEST lag that is both a local maximum and within 80%
  // of the global peak — a genuine submultiple (P vs 2P) still correlates that
  // strongly, whereas the within-row sub-line spacing peaks far lower (<0.6).
  let rowHEst = lagLo;
  for (let lag = lagLo; lag <= lagHi; lag++) {
    const localMax =
      corr[lag] >= (corr[lag - 1] ?? -Infinity) && corr[lag] >= (corr[lag + 1] ?? -Infinity);
    if (localMax && corr[lag] >= 0.8 * bestCorr) { rowHEst = lag; break; }
  }
  dbg.corr = corr;

  // (c) merge rows into blocks: bridge the inter-row gaps (well under a pitch)
  //     but split at the framing gaps (the separator bar, the header above and
  //     the footer below all leave a gap of roughly a pitch or more).
  const blockMergeThr = Math.max(rowMergeThr + 1, Math.round(rowHEst * 0.6));
  const blocks = merge(rowsMerged, blockMergeThr);

  // the lineup = the tallest block (6 starters span more than a title row, a
  // sub cluster or the footer).
  let lineupIdx = 0;
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].y1 - blocks[i].y0 > blocks[lineupIdx].y1 - blocks[lineupIdx].y0) lineupIdx = i;
  }
  const lineupBlock = blocks[lineupIdx];

  const starterTop = lineupBlock.y0;
  const starterBot = lineupBlock.y1;
  let subStart = H;
  Object.assign(dbg, { blocks, lineupIdx, medRunH, rowMergeThr, rowHEst, blockMergeThr });

  // --- 4. fit a comb of EXACTLY 6 evenly-spaced rows. The PITCH is the robust
  //        median row spacing (rowHEst), NOT the block height / 6: the lineup
  //        block can hold 6 starters PLUS up to 3 filled subs (one tall block
  //        when the separator bar is thin), or be split by an EMPTY position
  //        (e.g. an unfilled RB/LW that carries no text) — in both cases the
  //        median spacing still equals the true pitch. Row 1 is anchored near
  //        the TOP of the lineup, and scoring:
  //          • rewards activity (text) inside the 6 row windows,
  //          • penalises activity at the 5 inter-row boundaries (valleys),
  //          • penalises activity in the phantom slot ABOVE row 1 most heavily
  //            (the starters are the TOP 6 rows, so the GK must be row 1 even
  //            when 3 subs sit contiguously below it).
  //        Empty positions simply contribute no reward; the even grid still
  //        frames them, and the median pitch keeps the grid aligned. ---
  const pre = new Array(H + 1).fill(0);
  for (let y = 0; y < H; y++) pre[y + 1] = pre[y] + actS[y];
  const rsum = (a: number, b: number) => {
    const lo = Math.max(0, Math.min(H, a));
    const hi = Math.max(0, Math.min(H, b + 1));
    return hi > lo ? pre[hi] - pre[lo] : 0;
  };
  const density = (center: number, half: number) =>
    rsum(Math.round(center - half), Math.round(center + half)) / (2 * Math.round(half) + 1);

  const pivot = rowHEst > 2 ? rowHEst : (starterBot - starterTop) / count;
  const pLo = Math.max(3, Math.floor(pivot * 0.82));
  const pHi = Math.max(pLo + 1, Math.ceil(pivot * 1.22));
  let best = { score: -Infinity, c0: starterTop + pivot / 2, P: pivot };
  for (let P = pLo; P <= pHi; P++) {
    const rw = Math.max(1, Math.round(P * 0.34)); // row-window half-width
    const bw = Math.max(1, Math.round(P * 0.12)); // boundary-band half-width
    // row 1 centre is searched across the whole active span: the 6 full-width
    // stat rows are the only place a 6-row comb earns high reward (a title bar
    // is one row, the match-summary name list is left-side / faint), and the
    // heavy phantom-ABOVE penalty pins row 1 to the GK — the top of that
    // cluster — even when 3 subs sit contiguously below.
    const c0min = Math.round(yA - P * 0.6);
    const c0max = Math.round(yB - (count - 1) * P + P * 0.6);
    for (let c0 = c0min; c0 <= c0max; c0++) {
      let reward = 0, pen = 0;
      for (let k = 0; k < count; k++) reward += density(c0 + k * P, rw);
      for (let k = 0; k < count - 1; k++) pen += density(c0 + (k + 0.5) * P, bw);
      const phantomAbove = density(c0 - P, rw);
      const phantomBelow = density(c0 + count * P, rw);
      const score =
        reward / count -
        1.3 * (pen / (count - 1)) -
        1.3 * phantomAbove -
        0.3 * phantomBelow;
      if (score > best.score) best = { score, c0, P };
    }
  }

  const rowH = best.P;
  const topCenter = best.c0;
  const starterBands: Band[] = [];
  for (let k = 0; k < count; k++) {
    const cc = topCenter + rowH * k;
    starterBands.push({ y0: Math.round(cc - rowH / 2), y1: Math.round(cc + rowH / 2) - 1 });
  }
  // subs live just below row 6, before the (far) footer. Bound the search to a
  // few row-heights below the lineup so the team-name footer is excluded by
  // distance (and again, below, by its lack of right-hand content).
  subStart = Math.round(topCenter + (count - 0.5) * rowH);
  const subEnd = Math.min(H, Math.round(topCenter + (count - 0.5) * rowH + rowH * 4.5));
  Object.assign(dbg, { starterTop, starterBot, pivot, pLo, pHi, subEnd });

  // ---- subs (shared): one row-height crop centred on each sub player's text ----
  // Text activity (not brightness) ignores the textless separator bar. A real
  // player row has stat numbers spanning the FULL width, so requiring content on
  // the right drops the footer (team name + crest, left side only). Runs are
  // snapped to the row-pitch grid so a row's label/value lines stay together
  // while adjacent subs stay apart.
  if (rowH > 0 && subStart < H) {
    // A real substitute row carries stat numbers across the FULL width; the
    // team-name footer only has content on the LEFT. So a band passes only if
    // its RIGHT 40% holds content. The scan widens to a full row height around
    // the (possibly thin/faint) active run so a low-contrast sub is still seen.
    const hasRightContent = (a: number, b: number): boolean => {
      const cc = (a + b) / 2;
      const y0 = Math.max(0, Math.round(cc - rowH * 0.45));
      const y1 = Math.min(H - 1, Math.round(cc + rowH * 0.45));
      const x0 = Math.floor(W * 0.6);
      let hits = 0, tot = 0;
      for (let y = y0; y <= y1; y++) {
        let prev = -1;
        for (let x = x0; x < W; x += step) {
          const i = (y * W + x) * 4;
          const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          if (prev >= 0 && Math.abs(l - prev) > 16) hits++;
          prev = l;
          tot++;
        }
      }
      return tot > 0 && hits / tot > 0.02;
    };

    const subRuns: Array<[number, number]> = [];
    let bs = -1;
    for (let y = Math.max(0, subStart); y <= subEnd; y++) {
      const on = y < subEnd && actS[y] > subThr;
      if (on) { if (bs === -1) bs = y; }
      else if (bs !== -1) { subRuns.push([bs, y - 1]); bs = -1; }
    }
    // Only FILLED substitutes count: a real sub row carries stat numbers across
    // the full width. Empty "Sub N" / "Join" placeholder slots (no stats) and
    // the team-name footer (left side only) both lack right-hand content and are
    // correctly excluded. We also drop (a) sub-pixel slivers and (b) any run
    // hugging row 6's bottom edge — that is the separator line, not a sub slot.
    const minSubH = Math.max(minRun, Math.round(rowH * 0.1));
    const subEdge = subStart + rowH * 0.2;
    const valid = subRuns.filter(
      ([a, b]) => b - a + 1 >= minSubH && (a + b) / 2 >= subEdge && hasRightContent(a, b),
    );
    dbg.subRuns = subRuns;
    dbg.validSubRuns = valid;

    if (valid.length) {
      const subOrigin = (valid[0][0] + valid[0][1]) / 2;
      const slots = new Map<number, number[]>();
      for (const [a, b] of valid) {
        const cc = (a + b) / 2;
        const slot = Math.round((cc - subOrigin) / rowH);
        (slots.get(slot) ?? slots.set(slot, []).get(slot)!).push(cc);
      }
      for (const slot of [...slots.keys()].sort((x, y) => x - y)) {
        const cs = slots.get(slot)!;
        const center = cs.reduce((p, q) => p + q, 0) / cs.length;
        subBands.push({
          y0: Math.max(0, Math.round(center - rowH / 2)),
          y1: Math.min(H - 1, Math.round(center + rowH / 2)),
        });
      }
    }
  }

  // a team can field at most 3 substitutes
  const cappedSubs = subBands.slice(0, 3);
  const allBands = [...starterBands, ...cappedSubs];
  const splitAt = starterBands.length;
  Object.assign(dbg, { rowH, subStart, subBands: subBands.slice() });
  return { W, H, starterBands, subBands: cappedSubs, allBands, splitAt, autoDetected, debug: opts.debug ? dbg : undefined };
}

// (removed: rating-badge shield anchoring — colour/hue heuristics were fragile
// across themes and on grey ratings; the activity-based comb fit replaces it.)

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
