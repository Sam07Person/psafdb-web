-- ─────────────────────────────────────────────────────────────────────────────
-- Let a performance be skipped during calibration.
--
-- Some stat lines aren't worth judging: a sub who played ten minutes, a game
-- with obviously broken data. Skipping records that decision so the row never
-- comes back round in a later batch, without pretending it was given a rating.
--
-- A skipped row has skipped = true and final = NULL. A judged row has
-- skipped = false and a final. The check constraint enforces exactly one.
--
-- Run after 002_rating_judgments.sql.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.rating_judgments
  add column if not exists skipped      boolean not null default false,
  add column if not exists skip_reason  text;

-- `final` was NOT NULL; a skipped row has no rating to record.
alter table public.rating_judgments
  alter column final drop not null;

-- Exactly one of "skipped" or "has a final rating".
alter table public.rating_judgments
  drop constraint if exists rating_judgments_skipped_xor_final;
alter table public.rating_judgments
  add constraint rating_judgments_skipped_xor_final
  check ((skipped and final is null) or (not skipped and final is not null));

create index if not exists rating_judgments_skipped_idx
  on public.rating_judgments (skipped) where skipped;

comment on column public.rating_judgments.skipped is
  'Deliberately not judged (sub, junk data, etc). Excluded from the calibration fit and never re-queued.';
