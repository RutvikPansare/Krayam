-- Krayam — Feature 10: manual quote entry + unit normalization.
--
-- Table-driven conversions (no hardcoded ratios), non-destructive normalization
-- (raw AND normalized prices stored, in paise), and submitter identity for the
-- audit trail.

-- ── Unit definitions: each unit's size in its dimension's base unit ──
-- Conversion ratio between two same-dimension units is derived from to_base:
--   normalized_per_to = raw_per_from × (to.to_base / from.to_base)
-- Cross-dimension conversions are impossible → the engine throws.
-- ambiguous units (BOX, SET) have no fixed size → flagged for clarification
-- unless an explicit size is supplied at entry.
create table if not exists unit_conversions (
  unit       text primary key,
  dimension  text not null,            -- 'count' | 'mass' | 'length' | 'volume'
  to_base    numeric,                  -- size in base units; null when ambiguous
  ambiguous  boolean not null default false,
  label      text
);

insert into unit_conversions (unit, dimension, to_base, ambiguous, label) values
  -- count (base = piece)
  ('piece',  'count', 1,   false, 'PC (piece)'),
  ('nos',    'count', 1,   false, 'NOS'),
  ('pair',   'count', 2,   false, 'PAIR'),
  ('dozen',  'count', 12,  false, 'DZ (dozen)'),
  ('gross',  'count', 144, false, 'GROSS'),
  -- Known-size packs offered in the UI (UNIT_OPTIONS); fixed size ⇒ not ambiguous.
  ('box10',  'count', 10,  false, 'BOX of 10'),
  ('box50',  'count', 50,  false, 'BOX of 50'),
  ('box100', 'count', 100, false, 'BOX of 100'),
  -- Generic packs with no fixed size ⇒ ambiguous unless a size is supplied.
  ('box',    'count', null, true, 'BOX (size varies)'),
  ('set',    'count', null, true, 'SET (size varies)'),
  -- mass (base = gram)
  ('gm',     'mass', 1,    false, 'GM (gram)'),
  ('kg',     'mass', 1000, false, 'KG (kilogram)'),
  -- length (base = centimetre)
  ('cm',     'length', 1,   false, 'CM'),
  ('metre',  'length', 100, false, 'MTR (metre)'),
  -- volume (base = millilitre)
  ('ml',     'volume', 1,    false, 'ML'),
  ('litre',  'volume', 1000, false, 'LTR (litre)')
on conflict (unit) do nothing;

alter table unit_conversions enable row level security;
create policy "auth read unit_conversions" on unit_conversions for select to authenticated using (true);

-- ── quote_items: non-destructive paise storage (raw + normalized) ──
alter table quote_items add column if not exists raw_price_paise        bigint;
alter table quote_items add column if not exists raw_unit               text;
alter table quote_items add column if not exists normalized_price_paise bigint;   -- per RFQ base unit
alter table quote_items add column if not exists normalized_unit        text;     -- the locked RFQ unit
alter table quote_items add column if not exists conversion_factor      numeric;  -- to.to_base / from.to_base
alter table quote_items add column if not exists needs_clarification    boolean not null default false;

-- ── quotes: who entered it (officer for manual; null/vendor for portal) ──
alter table quotes add column if not exists submitted_by text;
