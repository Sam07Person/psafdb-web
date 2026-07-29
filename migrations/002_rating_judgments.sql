-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-judged ratings, used to calibrate the rating formula.
--
-- Each row is one human verdict on one real performance: what the sub-ratings
-- and the overall mark SHOULD have been. The formula is then tuned to reproduce
-- these, and they double as a regression suite so a later change can't quietly
-- undo the calibration.
--
-- Run after 001_freeze_ratings.sql.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.rating_judgments (
  match_id    uuid        not null,
  player_id   uuid        not null,
  role        text        not null,           -- GK / DEF / MID / FWD at time of judging
  position    text,                           -- exact position played
  attacking   smallint,
  defending   smallint,
  passing     smallint,
  consistency smallint,
  gk          smallint,
  final       smallint    not null,
  notes       text,
  judged_at   timestamptz not null default now(),

  primary key (match_id, player_id),

  constraint rating_judgments_final_range       check (final       between 0 and 100),
  constraint rating_judgments_attacking_range   check (attacking   is null or attacking   between 0 and 100),
  constraint rating_judgments_defending_range   check (defending   is null or defending   between 0 and 100),
  constraint rating_judgments_passing_range     check (passing     is null or passing     between 0 and 100),
  constraint rating_judgments_consistency_range check (consistency is null or consistency between 0 and 100),
  constraint rating_judgments_gk_range          check (gk          is null or gk          between 0 and 100)
);

create index if not exists rating_judgments_role_idx on public.rating_judgments (role);

comment on table public.rating_judgments is
  'Human-judged reference ratings. The formula is fitted to these; they are never used to display a player rating directly.';
