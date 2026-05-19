-- Loom demo source: manufacturing data
-- A plausible plant operations schema with deviations, runs, equipment,
-- operators, and quality checks. Volume kept modest (~2000 rows total)
-- so profiling is instant during the demo.

DROP TABLE IF EXISTS quality_checks CASCADE;
DROP TABLE IF EXISTS deviations CASCADE;
DROP TABLE IF EXISTS production_runs CASCADE;
DROP TABLE IF EXISTS equipment CASCADE;
DROP TABLE IF EXISTS operators CASCADE;

CREATE TABLE operators (
  operator_id        serial PRIMARY KEY,
  full_name          text NOT NULL,
  shift              text NOT NULL CHECK (shift IN ('day','swing','night')),
  certified_lines    text[] NOT NULL,
  hired_at           date NOT NULL
);

CREATE TABLE equipment (
  equipment_id            serial PRIMARY KEY,
  line_id                 text NOT NULL,
  name                    text NOT NULL,
  manufacturer            text NOT NULL,
  installed_at            date NOT NULL,
  last_maintenance_at     timestamptz,
  next_maintenance_due    timestamptz
);

CREATE TABLE production_runs (
  run_id           bigserial PRIMARY KEY,
  line_id          text NOT NULL,
  batch_id         text NOT NULL,
  product_sku      text NOT NULL,
  operator_id      int REFERENCES operators(operator_id),
  started_at       timestamptz NOT NULL,
  ended_at         timestamptz,
  units_target     int NOT NULL,
  units_produced   int NOT NULL,
  status           text NOT NULL CHECK (status IN ('completed','aborted','in_progress','test'))
);

CREATE TABLE deviations (
  deviation_id     bigserial PRIMARY KEY,
  run_id           bigint REFERENCES production_runs(run_id),
  equipment_id     int REFERENCES equipment(equipment_id),
  observed_at      timestamptz NOT NULL,
  category         text NOT NULL CHECK (category IN ('temperature','pressure','contamination','alignment','vibration','other')),
  severity         text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  expected_value   numeric,
  actual_value     numeric,
  unit             text,
  notes            text,
  resolved_at      timestamptz
);

CREATE TABLE quality_checks (
  check_id        bigserial PRIMARY KEY,
  run_id          bigint NOT NULL REFERENCES production_runs(run_id),
  checked_at      timestamptz NOT NULL,
  parameter       text NOT NULL,
  value           numeric NOT NULL,
  lower_spec      numeric,
  upper_spec      numeric,
  in_spec         boolean NOT NULL
);

-- Operators
INSERT INTO operators (full_name, shift, certified_lines, hired_at) VALUES
  ('Maria Alvarez',  'day',   ARRAY['LINE-A','LINE-B'],          '2022-03-14'),
  ('Devon Park',     'day',   ARRAY['LINE-A','LINE-C','LINE-D'], '2021-08-02'),
  ('Priya Shah',     'swing', ARRAY['LINE-B','LINE-C'],          '2023-01-19'),
  ('Tomasz Nowak',   'swing', ARRAY['LINE-A','LINE-D'],          '2020-11-30'),
  ('Aiko Tanaka',    'night', ARRAY['LINE-C','LINE-D'],          '2024-02-05'),
  ('Brendan Kelly',  'night', ARRAY['LINE-A','LINE-B','LINE-D'], '2019-06-21'),
  ('Naomi Carter',   'day',   ARRAY['LINE-B'],                   '2025-04-11'),
  ('Hassan Idris',   'swing', ARRAY['LINE-C','LINE-D'],          '2022-09-08');

-- Equipment
INSERT INTO equipment (line_id, name, manufacturer, installed_at, last_maintenance_at, next_maintenance_due) VALUES
  ('LINE-A','Filler-A1','Krones AG','2019-05-12','2026-04-22 06:00+00','2026-06-22 06:00+00'),
  ('LINE-A','Capper-A2','Sidel','2019-05-12','2026-04-15 06:00+00','2026-07-15 06:00+00'),
  ('LINE-A','Labeler-A3','Krones AG','2020-02-04','2026-03-30 06:00+00','2026-05-30 06:00+00'),
  ('LINE-B','Filler-B1','Tetra Pak','2018-09-30','2026-04-28 06:00+00','2026-07-28 06:00+00'),
  ('LINE-B','Capper-B2','Tetra Pak','2018-09-30','2026-02-19 06:00+00','2026-05-19 06:00+00'),
  ('LINE-C','Extruder-C1','Coperion','2021-07-15','2026-04-10 06:00+00','2026-06-10 06:00+00'),
  ('LINE-C','Cooler-C2','Buhler','2021-07-15','2026-04-12 06:00+00','2026-06-12 06:00+00'),
  ('LINE-D','Mixer-D1','GEA','2017-11-22','2026-03-25 06:00+00','2026-05-25 06:00+00'),
  ('LINE-D','Filler-D2','GEA','2017-11-22','2026-04-05 06:00+00','2026-06-05 06:00+00'),
  ('LINE-D','Palletizer-D3','Sidel','2022-04-18','2026-04-20 06:00+00','2026-07-20 06:00+00');

-- Generate ~600 production runs across the last 60 days
DO $$
DECLARE
  i int;
  line text;
  lines text[] := ARRAY['LINE-A','LINE-B','LINE-C','LINE-D'];
  skus text[] := ARRAY['SKU-1001','SKU-1002','SKU-1003','SKU-2010','SKU-2011','SKU-3050'];
  shift_offsets int[] := ARRAY[6,14,22];  -- hour of day for day/swing/night
  start_ts timestamptz;
  end_ts   timestamptz;
  target int;
  produced int;
  status_pick text;
  op_id int;
  run_id_var bigint;
  num_devs int;
  d int;
  num_checks int;
  c int;
  param_pick text;
  param_value numeric;
  ls numeric;
  us numeric;
  in_spec_flag boolean;
  dev_category text;
  dev_severity text;
  expected_v numeric;
  actual_v numeric;
  unit_v text;
  eq_id int;
BEGIN
  FOR i IN 1..600 LOOP
    line := lines[1 + (i % 4)];
    start_ts := (now() - (random() * interval '60 days'))::timestamptz;
    -- Snap to a shift start hour for realism
    start_ts := date_trunc('day', start_ts) + (shift_offsets[1 + (i % 3)] || ' hours')::interval + (random()*interval '30 minutes');
    end_ts := start_ts + (random()*interval '6 hours' + interval '90 minutes');
    target := 800 + (random()*400)::int;
    -- Most runs hit ~95-100% of target, some fall short, a few are aborted/test
    IF random() < 0.05 THEN
      status_pick := 'aborted';
      produced := (target * (0.1 + random()*0.4))::int;
      end_ts := start_ts + (random()*interval '90 minutes' + interval '20 minutes');
    ELSIF random() < 0.02 THEN
      status_pick := 'test';
      produced := (target * (0.5 + random()*0.5))::int;
    ELSE
      status_pick := 'completed';
      produced := (target * (0.92 + random()*0.10))::int;
    END IF;

    op_id := 1 + (random()*7)::int;

    INSERT INTO production_runs (line_id, batch_id, product_sku, operator_id, started_at, ended_at, units_target, units_produced, status)
    VALUES (line, 'B-' || to_char(start_ts,'YYYYMMDD') || '-' || lpad(i::text,4,'0'), skus[1 + (i % 6)], op_id, start_ts, end_ts, target, produced, status_pick)
    RETURNING run_id INTO run_id_var;

    -- 0-4 deviations per run, more for aborted runs
    IF status_pick = 'aborted' THEN
      num_devs := 1 + (random()*3)::int;
    ELSE
      num_devs := (random()*2)::int;
    END IF;

    FOR d IN 1..num_devs LOOP
      dev_category := (ARRAY['temperature','pressure','contamination','alignment','vibration','other'])[1 + floor(random()*6)::int];
      dev_severity := (ARRAY['low','low','low','medium','medium','high','critical'])[1 + floor(random()*7)::int];
      -- Pick equipment matching the line
      SELECT equipment_id INTO eq_id FROM equipment WHERE line_id = line ORDER BY random() LIMIT 1;
      IF dev_category = 'temperature' THEN
        expected_v := 72.0; actual_v := 72.0 + (random()*12 - 4); unit_v := 'C';
      ELSIF dev_category = 'pressure' THEN
        expected_v := 2.4; actual_v := 2.4 + (random()*0.8 - 0.3); unit_v := 'bar';
      ELSIF dev_category = 'alignment' THEN
        expected_v := 0.0; actual_v := round((random()*2.0 - 1.0)::numeric, 3); unit_v := 'mm';
      ELSIF dev_category = 'vibration' THEN
        expected_v := 0.5; actual_v := 0.5 + (random()*1.2); unit_v := 'mm/s';
      ELSE
        expected_v := NULL; actual_v := NULL; unit_v := NULL;
      END IF;

      INSERT INTO deviations (run_id, equipment_id, observed_at, category, severity, expected_value, actual_value, unit, notes, resolved_at)
      VALUES (
        run_id_var,
        eq_id,
        start_ts + (random()*(end_ts-start_ts)),
        dev_category,
        dev_severity,
        expected_v,
        actual_v,
        unit_v,
        CASE WHEN random() < 0.3 THEN 'auto-flagged by SPC' WHEN random() < 0.5 THEN 'operator note: investigating' ELSE NULL END,
        CASE WHEN dev_severity IN ('critical','high') AND random() < 0.4 THEN NULL ELSE end_ts + (random()*interval '2 hours') END
      );
    END LOOP;

    -- 2-6 quality checks per run
    num_checks := 2 + (random()*4)::int;
    FOR c IN 1..num_checks LOOP
      param_pick := (ARRAY['fill_volume_ml','cap_torque_nm','label_offset_mm','net_weight_g','viscosity_cp'])[1 + floor(random()*5)::int];
      IF param_pick = 'fill_volume_ml' THEN
        ls := 495; us := 505; param_value := 500 + (random()*8 - 4);
      ELSIF param_pick = 'cap_torque_nm' THEN
        ls := 1.2; us := 1.8; param_value := 1.5 + (random()*0.5 - 0.25);
      ELSIF param_pick = 'label_offset_mm' THEN
        ls := -1.0; us := 1.0; param_value := round((random()*2.4 - 1.2)::numeric, 3);
      ELSIF param_pick = 'net_weight_g' THEN
        ls := 248; us := 252; param_value := 250 + (random()*4 - 2);
      ELSE
        ls := 800; us := 1200; param_value := 1000 + (random()*500 - 250);
      END IF;
      in_spec_flag := (param_value BETWEEN ls AND us);
      INSERT INTO quality_checks (run_id, checked_at, parameter, value, lower_spec, upper_spec, in_spec)
      VALUES (run_id_var, start_ts + (random()*(end_ts-start_ts)), param_pick, param_value, ls, us, in_spec_flag);
    END LOOP;
  END LOOP;
END
$$;

-- Sanity totals
SELECT 'runs' AS table_name, count(*) FROM production_runs
UNION ALL SELECT 'deviations', count(*) FROM deviations
UNION ALL SELECT 'quality_checks', count(*) FROM quality_checks
UNION ALL SELECT 'equipment', count(*) FROM equipment
UNION ALL SELECT 'operators', count(*) FROM operators;
