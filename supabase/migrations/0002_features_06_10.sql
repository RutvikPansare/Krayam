-- Krayam — Features 06–10
-- Materials master (duplicate detection, stock check, dedup audit),
-- purchase orders (PO generation + SAP push).

create extension if not exists pg_trgm;

-- ── Materials master (Feature 07/08/09) ─────────────────────────
-- Mirrors SAP MAKT/MARD. Seeded locally; in production synced nightly
-- from SAP OData or imported once from an SE16 Excel export.
create table if not exists materials (
  id            uuid primary key default gen_random_uuid(),
  material_code text not null unique,
  description   text not null,
  unit          text not null default 'piece',
  unit_price    numeric not null default 0,   -- moving avg price, INR
  stock         jsonb not null default '{}',  -- {"Pune Plant": 6, "Bhiwandi WH": 0}
  category      text,
  created_at    timestamptz not null default now()
);

create index if not exists materials_desc_trgm on materials using gin (description gin_trgm_ops);

alter table materials enable row level security;
create policy "auth read materials" on materials for select to authenticated using (true);

-- Fuzzy search RPC (called with service role from the API).
-- Trigram similarity handles misspellings, abbreviations, partial text.
create or replace function search_materials(q text, max_results int default 8)
returns table (
  material_code text,
  description   text,
  unit          text,
  unit_price    numeric,
  stock         jsonb,
  score         real
)
language sql stable as $$
  select m.material_code, m.description, m.unit, m.unit_price, m.stock,
         greatest(similarity(m.description, q), word_similarity(q, m.description)) as score
  from materials m
  where m.description % q
     or word_similarity(q, m.description) > 0.25
     or m.description ilike '%' || q || '%'
     or m.material_code ilike '%' || q || '%'
  order by score desc
  limit max_results;
$$;

-- ── Purchase Orders (Feature 06) ────────────────────────────────
create sequence if not exists po_number_seq start 7001;

create table if not exists purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  po_number     text not null unique default ('PO-' || nextval('po_number_seq')),
  pr_id         uuid references purchase_requests(id) on delete set null,
  rfq_id        uuid references rfqs(id) on delete set null,
  quote_id      uuid references quotes(id) on delete set null,
  vendor_id     uuid references vendors(id) on delete set null,
  vendor_name   text not null,
  total_amount  numeric not null default 0,
  payment_terms text,
  delivery_days integer,
  status        text not null default 'created' check (status in ('created','sap_pushed','sent','cancelled')),
  sap_po_number text,
  sap_mode      text,
  sap_error     text,
  stock_note    text,    -- audit trail from the pre-PO stock check (Feature 09)
  created_at    timestamptz not null default now()
);

create table if not exists po_items (
  id            uuid primary key default gen_random_uuid(),
  po_id         uuid not null references purchase_orders(id) on delete cascade,
  item_name     text not null,
  material_code text,
  quantity      numeric not null,
  unit          text not null default 'piece',
  unit_price    numeric not null,   -- normalized per base unit, INR
  line_total    numeric not null
);

alter table purchase_orders enable row level security;
alter table po_items        enable row level security;
create policy "auth read pos"      on purchase_orders for select to authenticated using (true);
create policy "auth read po items" on po_items        for select to authenticated using (true);

-- ── Seed materials — realistic plant data with planted duplicates ──
-- Duplicate clusters are intentional: the dedup audit (Feature 08) must find them.
insert into materials (material_code, description, unit, unit_price, stock, category) values
-- Bearings (cluster: 6205)
('MAT-10001', 'Bearing 6205',                    'piece', 185,  '{"Pune Plant": 6, "Bhiwandi WH": 0}',  'bearings'),
('MAT-10002', 'SKF Brg 6205ZZ',                  'piece', 210,  '{"Pune Plant": 0, "Bhiwandi WH": 12}', 'bearings'),
('MAT-10003', 'Ball Bearing 6205',               'piece', 192,  '{"Nashik Stores": 4}',                 'bearings'),
-- Bearings (cluster: 6304)
('MAT-10004', 'Ball Bearing 6304 2RS',           'piece', 240,  '{"Pune Plant": 8}',                    'bearings'),
('MAT-10005', 'Brg 6304-2RS FAG',                'piece', 255,  '{"Bhiwandi WH": 3}',                   'bearings'),
('MAT-10006', 'Roller Bearing 22210 SKF',        'piece', 1450, '{"Pune Plant": 2}',                    'bearings'),
('MAT-10007', 'Taper Roller Bearing 30205',      'piece', 380,  '{"Pune Plant": 5, "Nashik Stores": 2}','bearings'),
('MAT-10008', 'Pillow Block Bearing UCP 205',    'piece', 520,  '{"Bhiwandi WH": 6}',                   'bearings'),
('MAT-10009', 'Pillow Block Brg UCP205 NTN',     'piece', 540,  '{"Pune Plant": 1}',                    'bearings'),
('MAT-10010', 'Needle Bearing HK 1612',          'piece', 165,  '{"Pune Plant": 10}',                   'bearings'),
-- Belts (cluster: B-68)
('MAT-10011', 'V Belt B-68',                     'piece', 310,  '{"Pune Plant": 4}',                    'belts'),
('MAT-10012', 'V-Belt B68 Fenner',               'piece', 325,  '{"Bhiwandi WH": 7}',                   'belts'),
('MAT-10013', 'Vee Belt B 68 Dunlop',            'piece', 298,  '{"Nashik Stores": 3}',                 'belts'),
('MAT-10014', 'V Belt A-42',                     'piece', 195,  '{"Pune Plant": 9}',                    'belts'),
('MAT-10015', 'Timing Belt 8M-1440-30',          'piece', 1850, '{"Pune Plant": 1}',                    'belts'),
('MAT-10016', 'Conveyor Belt 600mm EP200 3ply',  'metre', 1450, '{"Bhiwandi WH": 40}',                  'belts'),
('MAT-10017', 'Flat Belt 75mm x 5mm',            'metre', 420,  '{"Pune Plant": 25}',                   'belts'),
-- Fasteners (cluster: M12x50 bolt)
('MAT-10018', 'Hex Bolt M12x50 GI',              'piece', 12,   '{"Pune Plant": 450}',                  'fasteners'),
('MAT-10019', 'Bolt Hex M12 x 50 Galvanised',    'piece', 13,   '{"Bhiwandi WH": 200}',                 'fasteners'),
('MAT-10020', 'M12x50 Hex Head Bolt 8.8',        'piece', 14,   '{"Nashik Stores": 600}',               'fasteners'),
('MAT-10021', 'Hex Nut M12 GI',                  'piece', 4,    '{"Pune Plant": 1200}',                 'fasteners'),
('MAT-10022', 'Spring Washer M12',               'piece', 1.5,  '{"Pune Plant": 3000}',                 'fasteners'),
('MAT-10023', 'Allen Bolt M8x25 SS304',          'piece', 9,    '{"Bhiwandi WH": 800}',                 'fasteners'),
('MAT-10024', 'Allen Cap Screw M8 x 25 SS 304',  'piece', 9.5,  '{"Pune Plant": 350}',                  'fasteners'),
('MAT-10025', 'Anchor Fastener M10x80',          'piece', 22,   '{"Pune Plant": 150}',                  'fasteners'),
('MAT-10026', 'Stud Bolt M16x100 with 2 Nuts',   'piece', 38,   '{"Nashik Stores": 90}',                'fasteners'),
-- Electrical (cluster: 32A MCB)
('MAT-10027', 'MCB 32A Single Pole C Curve',     'piece', 240,  '{"Pune Plant": 14}',                   'electrical'),
('MAT-10028', 'MCB SP 32 Amp Legrand',           'piece', 265,  '{"Bhiwandi WH": 6}',                   'electrical'),
('MAT-10029', 'Contactor 3TF 32A Siemens',       'piece', 1850, '{"Pune Plant": 3}',                    'electrical'),
('MAT-10030', 'Relay Overload 9-13A',            'piece', 980,  '{"Pune Plant": 4}',                    'electrical'),
('MAT-10031', 'Cable 4 core 2.5sqmm Copper',     'metre', 95,   '{"Bhiwandi WH": 500}',                 'electrical'),
('MAT-10032', 'Cable Copper 2.5 sq mm 4C Polycab','metre', 99,  '{"Pune Plant": 250}',                  'electrical'),
('MAT-10033', 'LED Flood Light 100W IP65',       'piece', 1450, '{"Pune Plant": 8}',                    'electrical'),
('MAT-10034', 'LED Floodlight 100 Watt Philips', 'piece', 1690, '{"Nashik Stores": 2}',                 'electrical'),
('MAT-10035', 'Limit Switch Roller Lever',       'piece', 420,  '{"Pune Plant": 11}',                   'electrical'),
('MAT-10036', 'Proximity Sensor M18 NPN NO',     'piece', 850,  '{"Pune Plant": 7}',                    'electrical'),
('MAT-10037', 'Prox Sensor M18 NPN Omron',       'piece', 1150, '{"Bhiwandi WH": 2}',                   'electrical'),
('MAT-10038', 'VFD 5.5kW 3 Phase Delta',         'piece', 28500,'{"Pune Plant": 1}',                    'electrical'),
-- Seals & gaskets (cluster: oil seal 35x52x7)
('MAT-10039', 'Oil Seal 35x52x7 NBR',            'piece', 45,   '{"Pune Plant": 60}',                   'seals'),
('MAT-10040', 'Oilseal 35 x 52 x 7 Nitrile',     'piece', 48,   '{"Bhiwandi WH": 25}',                  'seals'),
('MAT-10041', 'O Ring 50mm ID Viton',            'piece', 28,   '{"Pune Plant": 120}',                  'seals'),
('MAT-10042', 'Gasket Sheet 3mm CAF 1x1m',       'piece', 850,  '{"Nashik Stores": 5}',                 'seals'),
('MAT-10043', 'Mechanical Seal 25mm Single Spring','piece', 1250,'{"Pune Plant": 4}',                   'seals'),
-- Pneumatics & hydraulics
('MAT-10044', 'Pneumatic Cylinder 50x200 Festo', 'piece', 4850, '{"Pune Plant": 2}',                    'pneumatics'),
('MAT-10045', 'Solenoid Valve 5/2 1/4 inch 24VDC','piece', 1680,'{"Pune Plant": 5}',                    'pneumatics'),
('MAT-10046', 'PU Tube 8mm Blue',                'metre', 38,   '{"Bhiwandi WH": 300}',                 'pneumatics'),
('MAT-10047', 'Hydraulic Hose 1/2 inch R2',      'metre', 320,  '{"Pune Plant": 45}',                   'hydraulics'),
('MAT-10048', 'Hyd Hose R2 12mm 2 wire braid',   'metre', 335,  '{"Nashik Stores": 20}',                'hydraulics'),
('MAT-10049', 'Hydraulic Oil 68 Servo 210L',     'piece', 38500,'{"Bhiwandi WH": 3}',                   'lubricants'),
-- Lubricants (cluster: EP2 grease)
('MAT-10050', 'Grease EP2 Lithium 18kg',         'piece', 4200, '{"Pune Plant": 6}',                    'lubricants'),
('MAT-10051', 'EP-2 Grease Lithium Base 18 kg Bharat','piece', 4350,'{"Bhiwandi WH": 2}',               'lubricants'),
('MAT-10052', 'Gear Oil EP90 20L',               'piece', 5800, '{"Pune Plant": 4}',                    'lubricants'),
('MAT-10053', 'Coolant Cutting Oil 20L',         'piece', 3200, '{"Nashik Stores": 8}',                 'lubricants'),
-- Tools & consumables
('MAT-10054', 'Welding Electrode 7018 3.15mm 5kg','piece', 780, '{"Pune Plant": 20}',                   'consumables'),
('MAT-10055', 'Welding Rod E7018 3.15 mm Ador',  'piece', 810,  '{"Bhiwandi WH": 12}',                  'consumables'),
('MAT-10056', 'Cutting Wheel 14 inch',           'piece', 95,   '{"Pune Plant": 80}',                   'consumables'),
('MAT-10057', 'Grinding Wheel 7 inch DC',        'piece', 65,   '{"Pune Plant": 100}',                  'consumables'),
('MAT-10058', 'Drill Bit HSS 12mm',              'piece', 145,  '{"Nashik Stores": 30}',                'tools'),
('MAT-10059', 'End Mill Carbide 10mm 4 Flute',   'piece', 1250, '{"Pune Plant": 6}',                    'tools'),
('MAT-10060', 'Hacksaw Blade 12 inch Bi-metal',  'piece', 28,   '{"Pune Plant": 200}',                  'tools'),
-- Plumbing & fabrication
('MAT-10061', 'GI Pipe 2 inch Class B 6m',       'piece', 1850, '{"Bhiwandi WH": 30}',                  'plumbing'),
('MAT-10062', 'Ball Valve 1 inch SS304',         'piece', 680,  '{"Pune Plant": 12}',                   'plumbing'),
('MAT-10063', 'Ball Valve 1in SS 304 Audco',     'piece', 720,  '{"Nashik Stores": 4}',                 'plumbing'),
('MAT-10064', 'MS Plate 10mm 1250x2500',         'piece', 14500,'{"Bhiwandi WH": 8}',                   'fabrication'),
('MAT-10065', 'MS Angle 50x50x6 6m',             'piece', 1320, '{"Bhiwandi WH": 45}',                  'fabrication'),
('MAT-10066', 'SS Sheet 304 2mm 4x8ft',          'piece', 9800, '{"Pune Plant": 5}',                    'fabrication'),
-- Filters (cluster: air filter)
('MAT-10067', 'Air Filter Element Compressor',   'piece', 850,  '{"Pune Plant": 9}',                    'filters'),
('MAT-10068', 'Compressor Air Filter Elment',    'piece', 880,  '{"Bhiwandi WH": 3}',                   'filters'),
('MAT-10069', 'Hydraulic Return Filter 10 Micron','piece', 1450,'{"Pune Plant": 4}',                    'filters'),
('MAT-10070', 'Water Filter Cartridge 20 inch',  'piece', 320,  '{"Nashik Stores": 15}',                'filters'),
-- Motors & pumps
('MAT-10071', 'Induction Motor 5HP 1440RPM Foot','piece', 18500,'{"Pune Plant": 2}',                    'motors'),
('MAT-10072', 'Motor 5 HP 4 Pole Crompton B3',   'piece', 19200,'{"Bhiwandi WH": 1}',                   'motors'),
('MAT-10073', 'Centrifugal Pump 3HP Monoblock',  'piece', 12800,'{"Pune Plant": 1}',                    'pumps'),
('MAT-10074', 'Coupling Love Joy L100',          'piece', 980,  '{"Pune Plant": 6}',                    'mechanical'),
('MAT-10075', 'Lovejoy Coupling L-100 with Spider','piece', 1020,'{"Nashik Stores": 2}',                'mechanical'),
-- Chains & sprockets
('MAT-10076', 'Roller Chain 12B Simplex 5m',     'piece', 2850, '{"Pune Plant": 3}',                    'mechanical'),
('MAT-10077', 'Chain Roller 12B-1 5 mtr Diamond','piece', 2950, '{"Bhiwandi WH": 1}',                   'mechanical'),
('MAT-10078', 'Sprocket 12B 17 Teeth',           'piece', 680,  '{"Pune Plant": 4}',                    'mechanical'),
('MAT-10079', 'Gear Box Worm 50:1 Size 110',     'piece', 8900, '{"Pune Plant": 1}',                    'mechanical'),
('MAT-10080', 'Safety Helmet ISI Yellow',        'piece', 180,  '{"Pune Plant": 50}',                   'safety')
on conflict (material_code) do nothing;
