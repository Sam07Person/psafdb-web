-- ─────────────────────────────────────────────────────────────────────────────
-- Break the goalkeeping judgement into its real components.
--
-- A single "goalkeeping 79%" verdict hides which part of keeping was misjudged.
-- The rating breakdown already splits it into goals conceded, saves, catches and
-- save efficiency, so calibration records the same four.
--
-- Shares of the final rating: GC 30%, saves 30%, catches 19% (= the 0.79 GK
-- weight). Save efficiency is a ±12 bonus, judged as a save percentage.
--
-- The generic `gk` column is kept for judgements made before this split.
--
-- Run after 003_rating_judgment_skips.sql.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.rating_judgments
  add column if not exists gk_gc         smallint,
  add column if not exists gk_saves      smallint,
  add column if not exists gk_catches    smallint,
  add column if not exists gk_efficiency smallint;   -- judged save %, 0-100

alter table public.rating_judgments
  drop constraint if exists rating_judgments_gk_gc_range,
  drop constraint if exists rating_judgments_gk_saves_range,
  drop constraint if exists rating_judgments_gk_catches_range,
  drop constraint if exists rating_judgments_gk_efficiency_range;

alter table public.rating_judgments
  add constraint rating_judgments_gk_gc_range         check (gk_gc         is null or gk_gc         between 0 and 150),
  add constraint rating_judgments_gk_saves_range      check (gk_saves      is null or gk_saves      between 0 and 150),
  add constraint rating_judgments_gk_catches_range    check (gk_catches    is null or gk_catches    between 0 and 150),
  add constraint rating_judgments_gk_efficiency_range check (gk_efficiency is null or gk_efficiency between 0 and 100);

comment on column public.rating_judgments.gk_efficiency is
  'Judged save percentage (0-100). Converted to a ±12 bonus, matching saveEfficiencyBonus() in lib/ratings.ts.';
