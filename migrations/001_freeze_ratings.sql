-- ─────────────────────────────────────────────────────────────────────────────
-- Freeze player match ratings.
--
-- Until now every rating was recomputed from raw stats on each page render,
-- which means any change to the formula silently rewrote all history.
-- These columns snapshot a rating at the moment it is first calculated so that
-- future formula changes only ever affect matches that have not been rated yet.
--
-- Semantics (important):
--   rating_version IS NULL  -> never processed; compute live with current formula
--   rating_version IS NOT NULL -> FROZEN. Use `rating` as-is and never recompute.
--   rating IS NULL AND rating_version IS NOT NULL -> deliberately unrated
--                                (e.g. game score of 0), and stays unrated.
--
-- Run this in the Supabase SQL editor, then run scripts/backfill-ratings.mjs.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.match_player_stats
  add column if not exists rating           smallint,
  add column if not exists rating_version   smallint,
  add column if not exists rating_breakdown jsonb;

comment on column public.match_player_stats.rating is
  'Frozen 0-100 match rating. NULL with a non-null rating_version means the match was deliberately excluded from rating.';
comment on column public.match_player_stats.rating_version is
  'Formula version that produced `rating`. NULL means not yet rated. Non-null means frozen - never recompute.';
comment on column public.match_player_stats.rating_breakdown is
  'Frozen sub-rating breakdown (scores + weights) so the UI expand panel always agrees with the frozen rating.';

-- Only rows still awaiting a freeze are ever scanned by the backfill.
create index if not exists match_player_stats_unrated_idx
  on public.match_player_stats (match_id)
  where rating_version is null;

-- Guard: once a rating is frozen it must not silently change. Any update that
-- tries to alter a frozen rating is rejected outright rather than quietly
-- accepted, so a buggy backfill re-run can't rewrite history.
create or replace function public.prevent_frozen_rating_change()
returns trigger
language plpgsql
as $$
begin
  if old.rating_version is not null
     and (new.rating is distinct from old.rating
          or new.rating_version is distinct from old.rating_version) then
    raise exception
      'match_player_stats(%,%) rating is frozen at version % and cannot be changed (attempted % -> %). Clear rating_version first if this is deliberate.',
      old.match_id, old.player_id, old.rating_version, old.rating, new.rating;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_frozen_rating_change on public.match_player_stats;
create trigger trg_prevent_frozen_rating_change
  before update on public.match_player_stats
  for each row execute function public.prevent_frozen_rating_change();
