# Row Cutter — Context & Handoff

This document describes a feature being built in the Next.js project at
`C:\Users\Owner\psafdb-web`. Hand this to another AI/developer as full context.

---

## 1. Goal

The project (`psafdb-web`) imports football/soccer **match-result screenshots** from
a game and extracts per-player stats using AI (GPT-4o vision). The existing AI
extraction **mixes up players' stats** — it misaligns a stat value to the wrong
player row when given a whole screenshot.

**The fix being built:** an automated, *fully client-side* "row cutter" that, given
a match-result screenshot, **slices the player-stats panel into one image strip per
player** (each starter, plus any substitutes). The idea is that feeding the AI one
clean strip per player (later step, not built yet) eliminates cross-row contamination.

**Hard requirements from the user:**
- **100% automatic. ZERO human intervention.** No drag-to-adjust, no manual lineup
  box. It must "just work" on any screenshot.
- Must work across **wildly varying UI themes** ("any colour is possible") and
  image sizes/zoom levels.
- **6 starters always** (the game is 6v6). **0–3 substitutes.**
- Subs must be **classified/labelled as subs** (separate from starters).
- The column-header info and the **team-name footer** must be excluded.

Current phase: **cutting tool + visual preview only. No AI wired in yet.**

---

## 2. Where things live

| Path | Purpose |
|---|---|
| `src/lib/imageRowSplitter.ts` | **The core algorithm.** Pure-ish client-side canvas code: image dataURL → detected row strips. This is the file that keeps getting iterated. |
| `src/app/admin/cut-test/page.tsx` | Standalone visual test page (`/admin/cut-test`). Upload/paste screenshots OR click "Load all 15 test images"; shows overlay (detected cut lines) + each cropped strip. |
| `src/app/api/admin/test-images/route.ts` | Serves the 15 test images from disk as base64 so the batch tester can load them in one click. Reads `images/result-test-images/`. |
| `src/app/admin/import/page.tsx` | Main admin import UI (huge file ~3800 lines). Has a "TEST VERSION" match-import section with a `✂️ Open Row Cutter` link to `/admin/cut-test`. |
| `src/app/api/admin/extract-match-test/route.ts` | The TEST AI-extraction endpoint (GPT-4o). NOT yet using the cutter — future integration point. |
| `images/result-test-images/test1..15` | 15 sample screenshots that must ALL pass. (test8, test9 are `.jpg`; rest `.png`.) |

---

## 3. Environment constraints (IMPORTANT)

- The assistant working on this **cannot execute code** in its sandbox
  (the Linux VM fails with `HYPERVISOR_VIRT_DISABLED`). All iteration has been
  **"blind"** — reasoning from user screenshots, not from running the algorithm.
- This is why a **batch tester** was built: open `/admin/cut-test`, click
  **"Load all 15 test images"**, and review all 15 overlays/strips at once.
- The user runs their own `npm run dev`; the assistant only edits files.

---

## 4. What the algorithm does (current state of `imageRowSplitter.ts`)

Entry point: `splitMatchImage(dataUrl, opts) → { panels, overlayDataUrl, ... }`.
Each panel has `rows: RowStrip[]`, where `RowStrip` has `{ y0, y1, dataUrl, isSub, label }`.

Pipeline:

1. **Per-scanline signals.** Draw image to canvas, read pixels. For each horizontal
   scanline `y` compute:
   - `act[y]` = text/edge density (mean absolute horizontal luminance gradient) —
     high where there's text, low in gaps and blurry background.
   - `lumRow[y]` = mean brightness.
   - `satRow[y]` = count of saturated pixels (for badge/theme detection).
   Smoothed versions `actS`, `lumS`.

2. **Region detection.** `ui[y] = actS[y] > actThr OR lumS[y] > brightThr`
   (bright OR busy-with-text → it's UI, not the blurry stadium background).
   Thin gaps are bridged so a panel doesn't fragment per-row. `findBands` →
   contiguous regions. The **tallest region = the lineup** (`lineup`).

3. **Separator bar (a).** The lineup is separated from subs by the **widest
   text-free gap** (the bright separator bar has padding above/below; its
   low-activity span is thicker than any inter-row gap). Found as the thickest
   run of `actS[y] < actLo`. Gives `barTop/barEnd`, and a rough pitch
   `rowHbar = (barBottom - lineup.y0) / 6`.

4. **Rating-badge anchors (b).** `detectBadgeCenters(...)` finds the y-centre of
   each player's **rating shield**:
   - Decides theme: if the lineup region is highly saturated → **coloured panel**;
     else **light/neutral panel**.
   - Light panel: a badge pixel = any saturated pixel.
   - Coloured panel: the whole row is saturated, so a badge pixel = saturated
     **and hue differs from the panel's dominant hue** (the green/red/blue shield
     stands out from e.g. a cyan/tan fill).
   - Per scanline counts badge pixels; runs above a threshold = badge bands.
     Runs from the same shield are **merged** (a shield's middle scanlines, where
     its number sits, dip below threshold and split it). **Merge distance is
     scaled to `rowHbar` (`rowHbar * 0.35`)** so small shields are rejoined but
     adjacent rows' shields are not.

5. **Pitch + phase (the key part).**
   - If `centers.length >= 3`: **row pitch = MEDIAN of consecutive badge gaps.**
     Median is immune both to *small* outlier gaps (a coloured subtitle/captain
     tag detected just below a shield) and *large* ones (a missing grey "-" rating
     leaves a 2× gap).
   - **Top anchor:** `effectiveTop = min(lineup.y0, firstBadge - rowH/2)` — if a
     badge sits above the region top (region missed the top rows), trust the badge.
     `row1guess = effectiveTop + rowH/2`.
   - **Phase:** MEDIAN residual of starter badges (slots 0..5) → `topCenter`.
   - Starter bands = 6 rows of height `rowH` from `topCenter`.
   - If `< 3` badges → fallback: even-split the lineup region (top → separator) by 6.

6. **Subs (shared).** Scan **text activity** below `subStart`. A real player row has
   stat numbers spanning the FULL width; the team-name footer only has content on
   the LEFT, so each candidate must pass `hasRightContent()` (content in the right
   60–100% of the width) → footer excluded. Runs are snapped onto the row-pitch
   grid (so label/value sub-lines of one row stay together while adjacent subs stay
   separate). **Subs are capped at 3.**

7. **Crop + label.** Full-width crops per band. Starters labelled `1..6`, subs
   labelled `Sub 1..`. Overlay image drawn with rose lines (starters) / yellow
   lines (subs) for the preview.

`opts.forcedRowCount` exists to force a starter count, surfaced as a "Rows per
panel" dropdown — but the user wants AUTO to always work, so this is just a manual
override of last resort.

---

## 5. The 15 test images (must ALL pass)

| # | Theme | Subs | Notes |
|---|---|---|---|
| test1 | white/light | 0 | small shields, footer "alfa romeo" |
| test2 | white/light | 1 (hermes) | **grey GK**, grey CM; separator; footer Juventus FC |
| test3 | dark | 1 | footer Sevilla FC |
| test4 | white/light | 1 (Ata) | **grey GK**, grey LW; footer DENİZLİSPOR |
| test5 | red (coloured) | 1 (nuk) | footer Spanish Hotspurs |
| test6 | dark | 1 (JimJim) | full match-summary view (blurry bg, title bar) |
| test7 | white/light | 0 | full match-summary view, footer SenmurWFC |
| test8 | tan/yellow (coloured) | 0 | footer Hamburger SC — **this one regressed earlier** |
| test9 | white/light | 1 | green GK; footer Santiago United |
| test10 | green (coloured) | 0 | match-summary; footer Žalgiris |
| test11 | tan (coloured) | 0 | match-summary; footer Shadow United |
| test12 | white/light | 0 | **CROPPED lineup only** (no separator/footer); all 6 colour badges; RW has a **red "Ranked Top 25" subtitle** that was being mis-read as a badge |
| test13 | blue (coloured) | 1 | footer "Join" |
| test14 | orange/tan (coloured) | 1 | match-summary; footer Notts County |
| test15 | blue (coloured) | **3** (Lzezppy, Knuffel, K2x5xy4) | match-summary; footer RB WARSZAWA |

Common to all: exactly **6 starters**; footer = team name on the LEFT; most have a
bright separator bar between starters and subs.

---

## 6. History — what was tried and why it changed

The algorithm was rewritten several times as new screenshots broke previous logic:

1. **v1 — coloured-panel detection.** Found the saturated green/tan panel, split
   rows by detecting dividers. Worked for coloured themes only.
2. **Row-count problems.** Divider counting over-segmented (counted text dips as
   rows) → switched to autocorrelation pitch → that picked half-row harmonics
   (2 lines per cell) → too few rows. Added a prior toward 6.
3. **White theme broke everything.** A light/white panel has no saturation and no
   activity gaps between rows → nothing detected. Rebuilt to be **theme-agnostic**
   (activity + brightness), keying on text not colour.
4. **Header/sub handling.** Switched to bounding the lineup with the separator bar
   and dividing by 6; subs detected separately below.
5. **Bar detection fragile.** "Bright + textless" matched white rows' gaps → fixed
   by using the **thickest text-free gap** (brightness-independent).
6. **Badge anchoring added** for precise alignment when the GK has a colour rating;
   **grey-GK** cases fall back / are handled by anchoring the top on the region or
   topmost badge.
7. **Pitch robustness.** Min-gap pitch failed when badges weren't adjacent (cyan,
   2 badges 3 rows apart) and when a subtitle created a tiny gap → settled on
   **median badge gap**.
8. **Shield splitting.** Small shields (cropped test12) split around their number,
   collapsing the pitch. Lowering the global threshold fixed test12 but **regressed
   the tan panel (test8)**. Reverted; instead **scale the shield-merge distance to
   the row height** so it only affects small shields. This is the "safe-proof,
   only-when-needed" approach the user explicitly asked for.

**Recurrent failure mode:** a fix for one screenshot regresses another, because
the assistant cannot run the code to verify. The batch tester (section 3) exists to
break this loop.

---

## 7. Current status / open question

- The latest state should (in theory) handle all themes, grey GKs, cropped images,
  subtitles, and 0–3 subs. **It has NOT been verified by running** — the last user
  screenshot before this handoff showed the tan panel (test8) had regressed from a
  global-threshold change, which was then reverted in favour of the row-height-scaled
  merge distance.
- **Immediate next step:** run `/admin/cut-test` → "Load all 15 test images", review,
  and confirm which of the 15 still mis-cut. Most likely remaining risk areas:
  - test8/test11 (coloured panels) alignment after the revert.
  - test12 (cropped, shield-split + subtitle) — does the median pitch + scaled merge
    actually yield 6 clean rows and 0 subs?
  - test15 (3 subs) — are all 3 detected, footer excluded, none merged?
  - grey-GK (test2, test4) — is row 1 (GK) included and not shifted?
- A genuinely robust path, if blind iteration keeps failing, is to **refactor the
  pixel math into a pure `computeBands(pixels, W, H)` function** and write a Node
  test harness (e.g. with `sharp`/`pngjs`) that runs it on the 15 images and asserts
  "6 starter bands of near-equal height + N sub bands", so it can be verified
  automatically instead of by eye. (Blocked here only because this machine can't run
  the sandbox; a normal dev machine can.)

---

## 8. Key acceptance criteria for "passing"

For each of the 15 images, the cutter should output:
- Exactly **6 starter strips**, each tightly framing one player row (no bleed of the
  adjacent row's name/subtitle, GK first).
- The correct number of **sub strips (0–3)**, labelled as subs, each framing one sub.
- **No footer/team-name strip**, no phantom/duplicate rows.
- Fully automatic (no forced row count).
