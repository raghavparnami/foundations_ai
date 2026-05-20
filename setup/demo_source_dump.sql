--
-- PostgreSQL database dump
--

\restrict yA7vm1Co60HWvKbtg8t82QaCazqZgHnGOh0hAr72LKsYg3WT4nEecQg7w3dPKoS

-- Dumped from database version 16.13 (Debian 16.13-1.pgdg12+1)
-- Dumped by pg_dump version 16.13 (Debian 16.13-1.pgdg12+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: loom_views; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS loom_views;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: deviations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deviations (
    deviation_id bigint NOT NULL,
    run_id bigint,
    equipment_id integer,
    observed_at timestamp with time zone NOT NULL,
    category text NOT NULL,
    severity text NOT NULL,
    expected_value numeric,
    actual_value numeric,
    unit text,
    notes text,
    resolved_at timestamp with time zone,
    root_cause_code text,
    CONSTRAINT deviations_category_check CHECK ((category = ANY (ARRAY['temperature'::text, 'pressure'::text, 'contamination'::text, 'alignment'::text, 'vibration'::text, 'other'::text]))),
    CONSTRAINT deviations_severity_check CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text])))
);


--
-- Name: v_critical_deviations_last_30d; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_critical_deviations_last_30d AS
 SELECT count(*) AS critical_deviations_last_30_days
   FROM public.deviations d
  WHERE ((severity = 'critical'::text) AND (observed_at >= (CURRENT_DATE - '30 days'::interval)));


--
-- Name: production_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_runs (
    run_id bigint NOT NULL,
    line_id text NOT NULL,
    batch_id text NOT NULL,
    product_sku text NOT NULL,
    operator_id integer,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    units_target integer NOT NULL,
    units_produced integer NOT NULL,
    status text NOT NULL,
    notes text,
    CONSTRAINT production_runs_status_check CHECK ((status = ANY (ARRAY['completed'::text, 'aborted'::text, 'in_progress'::text, 'test'::text])))
);


--
-- Name: v_deviation_rate_by_line_30d; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_deviation_rate_by_line_30d AS
 SELECT pr.line_id,
    count(*) AS total_deviations,
    count(*) FILTER (WHERE (d.actual_value <> d.expected_value)) AS deviations_with_mismatch,
    ((count(*) FILTER (WHERE (d.actual_value <> d.expected_value)))::double precision / (NULLIF(count(*), 0))::double precision) AS deviation_rate
   FROM (public.deviations d
     JOIN public.production_runs pr ON ((d.run_id = pr.run_id)))
  WHERE (d.observed_at >= (CURRENT_DATE - '30 days'::interval))
  GROUP BY pr.line_id
  ORDER BY ((count(*) FILTER (WHERE (d.actual_value <> d.expected_value)))::double precision / (NULLIF(count(*), 0))::double precision) DESC;


--
-- Name: v_deviation_rate_by_line_30d_current; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_deviation_rate_by_line_30d_current AS
 WITH deviation_data AS (
         SELECT pr.line_id,
            d.observed_at,
            d.expected_value,
            d.actual_value,
                CASE
                    WHEN (d.actual_value <> d.expected_value) THEN 1
                    ELSE 0
                END AS is_mismatch
           FROM (public.deviations d
             JOIN public.production_runs pr ON ((d.run_id = pr.run_id)))
          WHERE (d.observed_at >= (CURRENT_DATE - '30 days'::interval))
        )
 SELECT line_id,
    count(*) AS total_deviations,
    sum(is_mismatch) AS deviations_with_mismatch,
    ((sum(is_mismatch))::double precision / (NULLIF(count(*), 0))::double precision) AS deviation_rate
   FROM deviation_data
  GROUP BY line_id
  ORDER BY ((sum(is_mismatch))::double precision / (NULLIF(count(*), 0))::double precision) DESC;


--
-- Name: v_deviation_trend_daily_current_month; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_deviation_trend_daily_current_month AS
 SELECT date_trunc('day'::text, observed_at) AS day,
    count(*) AS total_deviations,
    count(*) FILTER (WHERE (actual_value <> expected_value)) AS mismatched_values,
    ((count(*) FILTER (WHERE (actual_value <> expected_value)))::double precision / (NULLIF(count(*), 0))::double precision) AS deviation_rate,
    round(((((count(*) FILTER (WHERE (actual_value <> expected_value)))::double precision / (NULLIF(count(*), 0))::double precision) * (100)::double precision))::numeric, 1) AS deviation_rate_percent
   FROM public.deviations
  WHERE ((observed_at >= date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone)) AND (observed_at < (date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone) + '1 mon'::interval)))
  GROUP BY (date_trunc('day'::text, observed_at))
  ORDER BY (date_trunc('day'::text, observed_at));


--
-- Name: v_deviations_0de189; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_deviations_0de189 AS
 SELECT pr.line_id,
    count(*) AS total_deviations,
    count(*) FILTER (WHERE (d.actual_value <> d.expected_value)) AS deviations_with_mismatch,
    ((count(*) FILTER (WHERE (d.actual_value <> d.expected_value)))::double precision / (NULLIF(count(*), 0))::double precision) AS deviation_rate
   FROM (public.deviations d
     JOIN public.production_runs pr ON ((d.run_id = pr.run_id)))
  WHERE (d.observed_at >= (now() - '30 days'::interval))
  GROUP BY pr.line_id
  ORDER BY ((count(*) FILTER (WHERE (d.actual_value <> d.expected_value)))::double precision / (NULLIF(count(*), 0))::double precision) DESC;


--
-- Name: v_deviations_101b51; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_deviations_101b51 AS
 SELECT pr.operator_id,
    count(d.deviation_id) AS total_deviations,
    count(d.deviation_id) FILTER (WHERE (d.actual_value <> d.expected_value)) AS mismatch_deviations,
    ((count(d.deviation_id) FILTER (WHERE (d.actual_value <> d.expected_value)))::double precision / (NULLIF(count(d.deviation_id), 0))::double precision) AS mismatch_rate,
    count(DISTINCT pr.run_id) AS total_runs,
    ((count(d.deviation_id))::double precision / (NULLIF(count(DISTINCT pr.run_id), 0))::double precision) AS deviations_per_run
   FROM (public.deviations d
     JOIN public.production_runs pr ON ((d.run_id = pr.run_id)))
  WHERE ((d.observed_at >= (now() - '30 days'::interval)) AND (pr.line_id = 'LINE-B'::text))
  GROUP BY pr.operator_id
  ORDER BY ((count(d.deviation_id) FILTER (WHERE (d.actual_value <> d.expected_value)))::double precision / (NULLIF(count(d.deviation_id), 0))::double precision) DESC;


--
-- Name: v_deviations_13770b; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_deviations_13770b AS
 SELECT date_trunc('day'::text, observed_at) AS day,
    count(*) AS total_deviations,
    count(*) FILTER (WHERE (actual_value <> expected_value)) AS mismatched_values,
    ((count(*) FILTER (WHERE (actual_value <> expected_value)))::double precision / (NULLIF(count(*), 0))::double precision) AS deviation_rate
   FROM public.deviations
  WHERE ((observed_at >= '2026-05-01 00:00:00+00'::timestamp with time zone) AND (observed_at < '2026-06-01 00:00:00+00'::timestamp with time zone))
  GROUP BY (date_trunc('day'::text, observed_at))
  ORDER BY (date_trunc('day'::text, observed_at));


--
-- Name: v_deviations_438794; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_deviations_438794 AS
 WITH monthly_stats AS (
         SELECT count(*) AS total_deviations,
            count(*) FILTER (WHERE (deviations.actual_value <> deviations.expected_value)) AS mismatched_values,
            ((count(*) FILTER (WHERE (deviations.actual_value <> deviations.expected_value)))::double precision / (NULLIF(count(*), 0))::double precision) AS overall_deviation_rate,
            avg(
                CASE
                    WHEN (deviations.actual_value <> deviations.expected_value) THEN 1.0
                    ELSE 0.0
                END) AS avg_deviation_rate,
            min(deviations.observed_at) AS first_deviation,
            max(deviations.observed_at) AS last_deviation
           FROM public.deviations
          WHERE ((deviations.observed_at >= '2026-05-01 00:00:00+00'::timestamp with time zone) AND (deviations.observed_at < '2026-06-01 00:00:00+00'::timestamp with time zone))
        )
 SELECT total_deviations,
    mismatched_values,
    round(((overall_deviation_rate * (100)::double precision))::numeric, 1) AS overall_deviation_rate_percent,
    round((avg_deviation_rate * (100)::numeric), 1) AS avg_deviation_rate_percent,
    first_deviation,
    last_deviation,
    (EXTRACT(day FROM (last_deviation - first_deviation)) + (1)::numeric) AS days_with_data
   FROM monthly_stats;


--
-- Name: v_deviations_46ea9c; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_deviations_46ea9c AS
 SELECT pr.line_id,
    count(d.deviation_id) AS total_deviations,
    count(d.deviation_id) FILTER (WHERE (d.actual_value <> d.expected_value)) AS deviations_with_mismatch,
    ((count(d.deviation_id) FILTER (WHERE (d.actual_value <> d.expected_value)))::double precision / (NULLIF(count(d.deviation_id), 0))::double precision) AS deviation_rate
   FROM (public.deviations d
     JOIN public.production_runs pr ON ((d.run_id = pr.run_id)))
  WHERE (d.observed_at >= (CURRENT_DATE - '30 days'::interval))
  GROUP BY pr.line_id
  ORDER BY ((count(d.deviation_id) FILTER (WHERE (d.actual_value <> d.expected_value)))::double precision / (NULLIF(count(d.deviation_id), 0))::double precision) DESC;


--
-- Name: equipment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipment (
    equipment_id integer NOT NULL,
    line_id text NOT NULL,
    name text NOT NULL,
    manufacturer text NOT NULL,
    installed_at date NOT NULL,
    last_maintenance_at timestamp with time zone,
    next_maintenance_due timestamp with time zone
);


--
-- Name: v_deviations_54ac49; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_deviations_54ac49 AS
 SELECT e.name,
    d.severity,
    count(*) AS deviation_count,
    count(*) FILTER (WHERE (d.actual_value <> d.expected_value)) AS mismatch_count,
    ((count(*) FILTER (WHERE (d.actual_value <> d.expected_value)))::double precision / (NULLIF(count(*), 0))::double precision) AS mismatch_rate
   FROM (public.deviations d
     JOIN public.equipment e ON ((d.equipment_id = e.equipment_id)))
  WHERE ((d.observed_at >= (now() - '30 days'::interval)) AND (e.line_id = 'LINE-B'::text))
  GROUP BY e.name, d.severity
  ORDER BY e.name, (count(*)) DESC;


--
-- Name: v_deviations_61c4f3; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_deviations_61c4f3 AS
 SELECT category,
    severity,
    count(*) AS deviation_count,
    avg(
        CASE
            WHEN (resolved_at IS NULL) THEN 1
            ELSE 0
        END) AS unresolved_rate
   FROM public.deviations d
  GROUP BY category, severity
  ORDER BY (count(*)) DESC;


--
-- Name: v_deviations_8c28a8; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_deviations_8c28a8 AS
 SELECT pr.line_id,
    d.category,
    count(*) AS deviation_count,
    count(*) FILTER (WHERE (d.actual_value <> d.expected_value)) AS mismatch_count,
    ((count(*) FILTER (WHERE (d.actual_value <> d.expected_value)))::double precision / (NULLIF(count(*), 0))::double precision) AS mismatch_rate
   FROM (public.deviations d
     JOIN public.production_runs pr ON ((d.run_id = pr.run_id)))
  WHERE (d.observed_at >= (now() - '30 days'::interval))
  GROUP BY pr.line_id, d.category
  ORDER BY pr.line_id, (count(*)) DESC;


--
-- Name: v_deviations_b95d25; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_deviations_b95d25 AS
 SELECT d.category,
    d.severity,
    count(*) AS deviation_count,
    avg(abs((d.actual_value - d.expected_value))) AS avg_deviation_magnitude,
    min((d.actual_value - d.expected_value)) AS min_deviation,
    max((d.actual_value - d.expected_value)) AS max_deviation
   FROM (public.deviations d
     JOIN public.equipment e ON ((d.equipment_id = e.equipment_id)))
  WHERE ((d.observed_at >= (now() - '30 days'::interval)) AND (e.line_id = 'LINE-B'::text) AND (d.actual_value IS NOT NULL) AND (d.expected_value IS NOT NULL) AND (d.actual_value <> d.expected_value))
  GROUP BY d.category, d.severity
  ORDER BY (count(*)) DESC;


--
-- Name: v_deviations_ce8507; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_deviations_ce8507 AS
 SELECT d.equipment_id,
    count(*) AS total_deviations,
    count(*) FILTER (WHERE (d.actual_value <> d.expected_value)) AS mismatch_deviations,
    ((count(*) FILTER (WHERE (d.actual_value <> d.expected_value)))::double precision / (NULLIF(count(*), 0))::double precision) AS mismatch_rate,
    string_agg(DISTINCT d.category, ', '::text ORDER BY d.category) AS categories,
    string_agg(DISTINCT d.severity, ', '::text ORDER BY d.severity) AS severities
   FROM (public.deviations d
     JOIN public.production_runs pr ON ((d.run_id = pr.run_id)))
  WHERE ((d.observed_at >= (now() - '30 days'::interval)) AND (pr.line_id = 'LINE-B'::text))
  GROUP BY d.equipment_id
  ORDER BY (count(*)) DESC;


--
-- Name: v_deviations_d766a7; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_deviations_d766a7 AS
 SELECT count(*) AS critical_deviations_last_30_days
   FROM public.deviations d
  WHERE ((severity = 'critical'::text) AND (observed_at >= (CURRENT_DATE - '30 days'::interval)));


--
-- Name: v_deviations_e268da; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_deviations_e268da AS
 SELECT date(d.observed_at) AS deviation_date,
    count(*) AS total_deviations,
    count(*) FILTER (WHERE (d.actual_value <> d.expected_value)) AS mismatch_deviations,
    ((count(*) FILTER (WHERE (d.actual_value <> d.expected_value)))::double precision / (NULLIF(count(*), 0))::double precision) AS mismatch_rate,
    e.name AS equipment_name
   FROM (public.deviations d
     JOIN public.equipment e ON ((d.equipment_id = e.equipment_id)))
  WHERE ((d.observed_at >= (now() - '30 days'::interval)) AND (e.line_id = 'LINE-B'::text))
  GROUP BY (date(d.observed_at)), e.name
  ORDER BY (date(d.observed_at)) DESC, (count(*)) DESC;


--
-- Name: v_equipment_9e6d45; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_equipment_9e6d45 AS
 SELECT e.line_id,
    e.name,
    e.manufacturer,
    count(d.deviation_id) AS total_deviations,
    count(d.deviation_id) FILTER (WHERE (d.actual_value <> d.expected_value)) AS mismatch_deviations,
    ((count(d.deviation_id) FILTER (WHERE (d.actual_value <> d.expected_value)))::double precision / (NULLIF(count(d.deviation_id), 0))::double precision) AS mismatch_rate
   FROM (public.equipment e
     LEFT JOIN public.deviations d ON (((e.equipment_id = d.equipment_id) AND (d.observed_at >= (now() - '30 days'::interval)))))
  GROUP BY e.line_id, e.name, e.manufacturer
  ORDER BY ((count(d.deviation_id) FILTER (WHERE (d.actual_value <> d.expected_value)))::double precision / (NULLIF(count(d.deviation_id), 0))::double precision) DESC NULLS LAST, (count(d.deviation_id)) DESC;


--
-- Name: v_equipment_by_line; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_equipment_by_line AS
 SELECT equipment_id,
    line_id,
    name,
    manufacturer,
    installed_at,
    last_maintenance_at,
    next_maintenance_due
   FROM public.equipment
  ORDER BY line_id, equipment_id;


--
-- Name: v_equipment_deviation_analysis_30d; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_equipment_deviation_analysis_30d AS
 SELECT e.line_id,
    e.name,
    e.manufacturer,
    e.installed_at,
    e.last_maintenance_at,
    e.next_maintenance_due,
    count(d.deviation_id) AS total_deviations,
    count(d.deviation_id) FILTER (WHERE (d.actual_value <> d.expected_value)) AS mismatch_deviations,
    ((count(d.deviation_id) FILTER (WHERE (d.actual_value <> d.expected_value)))::double precision / (NULLIF(count(d.deviation_id), 0))::double precision) AS mismatch_rate,
    string_agg(DISTINCT d.category, ', '::text ORDER BY d.category) AS categories,
    string_agg(DISTINCT d.severity, ', '::text ORDER BY d.severity) AS severities
   FROM (public.equipment e
     LEFT JOIN public.deviations d ON (((e.equipment_id = d.equipment_id) AND (d.observed_at >= (now() - '30 days'::interval)))))
  GROUP BY e.equipment_id, e.name, e.manufacturer, e.installed_at, e.last_maintenance_at, e.next_maintenance_due, e.line_id
  ORDER BY ((count(d.deviation_id) FILTER (WHERE (d.actual_value <> d.expected_value)))::double precision / (NULLIF(count(d.deviation_id), 0))::double precision) DESC NULLS LAST, (count(d.deviation_id)) DESC;


--
-- Name: v_equipment_deviation_severity_90d; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_equipment_deviation_severity_90d AS
 SELECT e.equipment_id,
    e.name,
    e.line_id,
    d.severity,
    count(d.deviation_id) AS deviation_count
   FROM (public.deviations d
     JOIN public.equipment e ON ((d.equipment_id = e.equipment_id)))
  WHERE (d.observed_at >= (now() - '90 days'::interval))
  GROUP BY e.equipment_id, e.name, e.line_id, d.severity;


--
-- Name: v_equipment_deviation_summary_30d; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_equipment_deviation_summary_30d AS
 SELECT e.equipment_id,
    e.name,
    e.line_id,
    e.manufacturer,
    count(d.deviation_id) AS total_deviations,
    sum(
        CASE
            WHEN (d.severity = ANY (ARRAY['critical'::text, 'high'::text])) THEN 1
            ELSE 0
        END) AS high_severity_count,
    min(d.observed_at) AS first_deviation_date,
    max(d.observed_at) AS last_deviation_date,
    sum(
        CASE
            WHEN (d.resolved_at IS NULL) THEN 1
            ELSE 0
        END) AS unresolved_count
   FROM (public.equipment e
     LEFT JOIN public.deviations d ON (((e.equipment_id = d.equipment_id) AND (d.observed_at >= (now() - '30 days'::interval)))))
  GROUP BY e.equipment_id, e.name, e.line_id, e.manufacturer
  ORDER BY (count(d.deviation_id)) DESC NULLS LAST;


--
-- Name: v_equipment_e45131; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_equipment_e45131 AS
 SELECT e.equipment_id,
    e.name,
    e.manufacturer,
    e.installed_at,
    e.last_maintenance_at,
    e.next_maintenance_due,
    count(d.deviation_id) AS total_deviations,
    count(d.deviation_id) FILTER (WHERE (d.actual_value <> d.expected_value)) AS mismatch_deviations,
    ((count(d.deviation_id) FILTER (WHERE (d.actual_value <> d.expected_value)))::double precision / (NULLIF(count(d.deviation_id), 0))::double precision) AS mismatch_rate
   FROM (public.equipment e
     LEFT JOIN public.deviations d ON (((e.equipment_id = d.equipment_id) AND (d.observed_at >= (now() - '30 days'::interval)))))
  WHERE (e.line_id = 'LINE-B'::text)
  GROUP BY e.equipment_id, e.name, e.manufacturer, e.installed_at, e.last_maintenance_at, e.next_maintenance_due
  ORDER BY (count(d.deviation_id)) DESC NULLS LAST;


--
-- Name: v_equipment_failure_rates_by_line_90d; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_equipment_failure_rates_by_line_90d AS
 SELECT e.line_id,
    e.equipment_id,
    e.name,
    count(d.deviation_id) AS total_deviations,
    sum(
        CASE
            WHEN (d.severity = 'critical'::text) THEN 1
            ELSE 0
        END) AS critical_count,
    sum(
        CASE
            WHEN (d.severity = 'high'::text) THEN 1
            ELSE 0
        END) AS high_count,
    round((((count(d.deviation_id))::numeric * 100.0) / (count(pr.run_id))::numeric), 2) AS deviation_rate_percent
   FROM ((public.equipment e
     JOIN public.deviations d ON ((e.equipment_id = d.equipment_id)))
     JOIN public.production_runs pr ON ((d.run_id = pr.run_id)))
  WHERE (d.observed_at >= (now() - '90 days'::interval))
  GROUP BY e.line_id, e.equipment_id, e.name
  ORDER BY (count(d.deviation_id)) DESC;


--
-- Name: v_failed_production_runs_30d; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_failed_production_runs_30d AS
 SELECT run_id,
    line_id,
    batch_id,
    product_sku,
    operator_id,
    started_at,
    ended_at,
    units_target,
    units_produced,
    round((((units_produced)::numeric / (units_target)::numeric) * (100)::numeric), 2) AS efficiency_percent,
        CASE
            WHEN ((units_produced)::numeric < (0.9 * (units_target)::numeric)) THEN 'failed'::text
            ELSE 'successful'::text
        END AS run_status
   FROM public.production_runs
  WHERE ((started_at >= (CURRENT_DATE - '30 days'::interval)) AND (status = 'completed'::text))
  ORDER BY started_at DESC;


--
-- Name: v_line_a_equipment_status; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_line_a_equipment_status AS
 SELECT equipment_id,
    name AS machine_name,
    manufacturer,
    installed_at,
    last_maintenance_at,
    next_maintenance_due,
        CASE
            WHEN (next_maintenance_due <= (CURRENT_DATE + '30 days'::interval)) THEN 'Maintenance due soon'::text
            ELSE 'Maintenance up to date'::text
        END AS maintenance_status,
    ( SELECT max(pr.started_at) AS max
           FROM public.production_runs pr
          WHERE (pr.line_id = e.line_id)) AS last_production_run_on_line,
    ( SELECT count(*) AS count
           FROM public.production_runs pr
          WHERE (pr.line_id = e.line_id)) AS total_runs_on_line
   FROM public.equipment e
  WHERE (line_id = 'LINE-A'::text)
  ORDER BY name;


--
-- Name: v_line_performance_last_30d; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_line_performance_last_30d AS
 WITH recent_runs AS (
         SELECT production_runs.run_id,
            production_runs.line_id,
            production_runs.batch_id,
            production_runs.product_sku,
            production_runs.operator_id,
            production_runs.started_at,
            production_runs.ended_at,
            production_runs.units_target,
            production_runs.units_produced,
            production_runs.status,
            production_runs.notes
           FROM public.production_runs
          WHERE ((production_runs.started_at >= (now() - '30 days'::interval)) AND (production_runs.status = 'completed'::text))
        )
 SELECT line_id,
    count(run_id) AS total_runs,
    sum(units_produced) AS units_produced,
    sum(units_target) AS units_target,
    round((((sum(units_produced))::numeric * 100.0) / (NULLIF(sum(units_target), 0))::numeric), 2) AS target_achievement_pct,
    avg((EXTRACT(epoch FROM (ended_at - started_at)) / 60.0)) AS avg_run_duration_minutes
   FROM recent_runs
  GROUP BY line_id
  ORDER BY line_id;


--
-- Name: operators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operators (
    operator_id integer NOT NULL,
    full_name text NOT NULL,
    shift text NOT NULL,
    certified_lines text[] NOT NULL,
    hired_at date NOT NULL,
    CONSTRAINT operators_shift_check CHECK ((shift = ANY (ARRAY['day'::text, 'swing'::text, 'night'::text])))
);


--
-- Name: v_operator_certified_line_summary; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_operator_certified_line_summary AS
 SELECT o.operator_id,
    o.full_name,
    o.shift,
    o.certified_lines,
    count(pr.run_id) AS recent_run_count,
    sum(pr.units_produced) AS recent_units_produced
   FROM (public.operators o
     LEFT JOIN public.production_runs pr ON (((o.operator_id = pr.operator_id) AND (pr.started_at >= (now() - '30 days'::interval)) AND (pr.status = 'completed'::text))))
  GROUP BY o.operator_id, o.full_name, o.shift, o.certified_lines
  ORDER BY (count(pr.run_id)) DESC;


--
-- Name: v_operator_deviation_performance_60d; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_operator_deviation_performance_60d AS
 SELECT o.operator_id,
    o.full_name,
    o.shift,
    count(pr.run_id) AS completed_runs,
    count(d.deviation_id) AS deviation_count,
    ((count(d.deviation_id))::numeric / (count(pr.run_id))::numeric) AS deviations_per_run
   FROM ((public.production_runs pr
     JOIN public.operators o ON ((pr.operator_id = o.operator_id)))
     LEFT JOIN public.deviations d ON ((pr.run_id = d.run_id)))
  WHERE ((pr.started_at >= (now() - '60 days'::interval)) AND (pr.status = 'completed'::text))
  GROUP BY o.operator_id, o.full_name, o.shift;


--
-- Name: v_operator_performance_metrics_90d; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_operator_performance_metrics_90d AS
 SELECT o.operator_id,
    o.full_name,
    o.shift,
    count(DISTINCT pr.run_id) AS run_count,
    sum(pr.units_produced) AS total_units_produced,
    count(d.deviation_id) AS deviation_count,
    round((((count(d.deviation_id))::numeric * 100.0) / (count(DISTINCT pr.run_id))::numeric), 2) AS deviation_rate_percent
   FROM ((public.operators o
     JOIN public.production_runs pr ON ((o.operator_id = pr.operator_id)))
     LEFT JOIN public.deviations d ON ((pr.run_id = d.run_id)))
  WHERE (pr.started_at >= (now() - '90 days'::interval))
  GROUP BY o.operator_id, o.full_name, o.shift
  ORDER BY (sum(pr.units_produced)) DESC, (round((((count(d.deviation_id))::numeric * 100.0) / (count(DISTINCT pr.run_id))::numeric), 2));


--
-- Name: quality_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quality_checks (
    check_id bigint NOT NULL,
    run_id bigint NOT NULL,
    checked_at timestamp with time zone NOT NULL,
    parameter text NOT NULL,
    value numeric NOT NULL,
    lower_spec numeric,
    upper_spec numeric,
    in_spec boolean NOT NULL
);


--
-- Name: v_operators_d6cbb6; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_operators_d6cbb6 AS
 SELECT 'operators'::text AS table_name,
    count(*) AS count
   FROM public.operators
  WHERE (operators.full_name ~~* '%naruto%'::text)
UNION ALL
 SELECT 'deviations'::text AS table_name,
    count(*) AS count
   FROM public.deviations
  WHERE ((deviations.category ~~* '%naruto%'::text) OR (deviations.notes ~~* '%naruto%'::text))
UNION ALL
 SELECT 'production_runs'::text AS table_name,
    count(*) AS count
   FROM public.production_runs
  WHERE ((production_runs.product_sku ~~* '%naruto%'::text) OR (production_runs.line_id ~~* '%naruto%'::text))
UNION ALL
 SELECT 'equipment'::text AS table_name,
    count(*) AS count
   FROM public.equipment
  WHERE ((equipment.name ~~* '%naruto%'::text) OR (equipment.manufacturer ~~* '%naruto%'::text) OR (equipment.line_id ~~* '%naruto%'::text))
UNION ALL
 SELECT 'quality_checks'::text AS table_name,
    count(*) AS count
   FROM public.quality_checks
  WHERE (quality_checks.parameter ~~* '%naruto%'::text);


--
-- Name: v_production_runs_2df221; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_production_runs_2df221 AS
 SELECT count(*) AS failed_runs_count
   FROM public.production_runs
  WHERE ((started_at >= (CURRENT_DATE - '30 days'::interval)) AND (status = 'completed'::text) AND ((units_produced)::numeric < (0.9 * (units_target)::numeric)));


--
-- Name: v_production_runs_36c23c; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_production_runs_36c23c AS
 WITH production_summary AS (
         SELECT pr.product_sku,
            pr.line_id,
            count(DISTINCT pr.run_id) AS total_runs,
            sum(pr.units_produced) AS total_units,
            avg(((pr.units_produced)::double precision / (NULLIF(pr.units_target, 0))::double precision)) AS avg_efficiency,
            count(DISTINCT
                CASE
                    WHEN (d.category = 'contamination'::text) THEN d.deviation_id
                    ELSE NULL::bigint
                END) AS contamination_deviations,
            count(DISTINCT d.deviation_id) AS total_deviations
           FROM (public.production_runs pr
             LEFT JOIN public.deviations d ON ((pr.run_id = d.run_id)))
          WHERE (pr.status = 'completed'::text)
          GROUP BY pr.product_sku, pr.line_id
        )
 SELECT product_sku,
    line_id,
    total_runs,
    total_units,
    avg_efficiency,
    contamination_deviations,
    total_deviations,
        CASE
            WHEN (total_runs > 0) THEN ((contamination_deviations)::numeric / (total_runs)::numeric)
            ELSE (0)::numeric
        END AS contamination_rate
   FROM production_summary
  ORDER BY total_units DESC;


--
-- Name: v_production_runs_3918fe; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_production_runs_3918fe AS
 SELECT count(*) AS total_completed_runs,
    count(
        CASE
            WHEN ((units_produced)::numeric < (0.9 * (units_target)::numeric)) THEN 1
            ELSE NULL::integer
        END) AS failed_runs,
    count(
        CASE
            WHEN ((units_produced)::numeric >= (0.9 * (units_target)::numeric)) THEN 1
            ELSE NULL::integer
        END) AS successful_runs,
    round(avg((((units_produced)::numeric / (units_target)::numeric) * (100)::numeric)), 2) AS avg_efficiency_percent,
    min((((units_produced)::numeric / (units_target)::numeric) * (100)::numeric)) AS min_efficiency_percent,
    max((((units_produced)::numeric / (units_target)::numeric) * (100)::numeric)) AS max_efficiency_percent
   FROM public.production_runs
  WHERE ((started_at >= (CURRENT_DATE - '30 days'::interval)) AND (status = 'completed'::text));


--
-- Name: v_production_runs_56fb81; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_production_runs_56fb81 AS
 SELECT DISTINCT product_sku,
    count(*) AS run_count
   FROM public.production_runs
  GROUP BY product_sku
  ORDER BY (count(*)) DESC;


--
-- Name: v_production_runs_64686f; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_production_runs_64686f AS
 SELECT min(date(started_at)) AS earliest_date,
    max(date(started_at)) AS latest_date,
    count(*) AS total_runs
   FROM public.production_runs
  WHERE (line_id = 'LINE-A'::text);


--
-- Name: v_production_runs_b7db96; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_production_runs_b7db96 AS
 SELECT pr.product_sku,
    d.category,
    count(DISTINCT d.deviation_id) AS contamination_deviations,
    count(DISTINCT pr.run_id) AS total_runs,
    round(((count(DISTINCT d.deviation_id))::numeric / (count(DISTINCT pr.run_id))::numeric), 3) AS deviation_rate
   FROM (public.production_runs pr
     LEFT JOIN public.deviations d ON (((pr.run_id = d.run_id) AND (d.category = 'contamination'::text))))
  WHERE (pr.status = 'completed'::text)
  GROUP BY pr.product_sku, d.category
  ORDER BY (count(DISTINCT d.deviation_id)) DESC;


--
-- Name: v_production_runs_e8695f; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_production_runs_e8695f AS
 SELECT status,
    count(*) AS total_runs,
    count(
        CASE
            WHEN ((units_produced)::numeric < (0.9 * (units_target)::numeric)) THEN 1
            ELSE NULL::integer
        END) AS failed_by_90pct_rule,
    round(((100.0 * (count(
        CASE
            WHEN ((units_produced)::numeric < (0.9 * (units_target)::numeric)) THEN 1
            ELSE NULL::integer
        END))::numeric) / (count(*))::numeric), 1) AS failure_rate_pct
   FROM public.production_runs
  WHERE (status = ANY (ARRAY['completed'::text, 'aborted'::text]))
  GROUP BY status
  ORDER BY status;


--
-- Name: v_production_runs_f9eee5; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_production_runs_f9eee5 AS
 SELECT equipment_id,
    name AS machine_name,
    manufacturer,
    installed_at,
    last_maintenance_at,
    next_maintenance_due,
        CASE
            WHEN (next_maintenance_due <= (CURRENT_DATE + '30 days'::interval)) THEN 'Maintenance due soon'::text
            ELSE 'Maintenance up to date'::text
        END AS maintenance_status,
    ( SELECT max(pr.started_at) AS max
           FROM public.production_runs pr
          WHERE (pr.line_id = e.line_id)) AS last_production_run_on_line,
    ( SELECT count(*) AS count
           FROM public.production_runs pr
          WHERE (pr.line_id = e.line_id)) AS total_runs_on_line
   FROM public.equipment e
  WHERE (line_id = 'LINE-A'::text)
  ORDER BY name;


--
-- Name: v_production_runs_fe0280; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_production_runs_fe0280 AS
 SELECT product_sku,
    line_id,
    count(DISTINCT run_id) AS run_count,
    sum(units_produced) AS total_units_produced,
    avg(((units_produced)::double precision / (NULLIF(units_target, 0))::double precision)) AS efficiency_rate
   FROM public.production_runs pr
  WHERE (status = 'completed'::text)
  GROUP BY product_sku, line_id
  ORDER BY (sum(units_produced)) DESC;


--
-- Name: v_quality_check_failure_rate_30d; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_quality_check_failure_rate_30d AS
 SELECT parameter,
    count(check_id) AS total_checks,
    sum(
        CASE
            WHEN (in_spec = false) THEN 1
            ELSE 0
        END) AS failed_checks,
    ((sum(
        CASE
            WHEN (in_spec = false) THEN 1
            ELSE 0
        END))::numeric / (count(check_id))::numeric) AS failure_rate
   FROM public.quality_checks qc
  WHERE (checked_at >= (now() - '30 days'::interval))
  GROUP BY parameter;


--
-- Name: v_quality_failure_rates_30d; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_quality_failure_rates_30d AS
 SELECT q.parameter,
    pr.line_id,
    count(*) AS total_checks,
    sum(
        CASE
            WHEN (q.in_spec = false) THEN 1
            ELSE 0
        END) AS failed_checks,
    round((((sum(
        CASE
            WHEN (q.in_spec = false) THEN 1
            ELSE 0
        END))::numeric * 100.0) / (count(*))::numeric), 2) AS failure_rate_percent
   FROM (public.quality_checks q
     JOIN public.production_runs pr ON ((q.run_id = pr.run_id)))
  WHERE (q.checked_at >= (now() - '30 days'::interval))
  GROUP BY q.parameter, pr.line_id
  ORDER BY (round((((sum(
        CASE
            WHEN (q.in_spec = false) THEN 1
            ELSE 0
        END))::numeric * 100.0) / (count(*))::numeric), 2)) DESC, (count(*)) DESC;


--
-- Name: v_quality_summary_weekly; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_quality_summary_weekly AS
 SELECT date_trunc('week'::text, checked_at) AS week_start,
    parameter,
    count(check_id) AS total_checks,
    sum(
        CASE
            WHEN in_spec THEN 1
            ELSE 0
        END) AS in_spec_count,
    round((((sum(
        CASE
            WHEN in_spec THEN 1
            ELSE 0
        END))::numeric * 100.0) / (count(check_id))::numeric), 2) AS in_spec_rate_pct,
    sum(
        CASE
            WHEN (in_spec = false) THEN 1
            ELSE 0
        END) AS out_of_spec_count
   FROM public.quality_checks q
  WHERE (checked_at >= (now() - '90 days'::interval))
  GROUP BY (date_trunc('week'::text, checked_at)), parameter
  ORDER BY (date_trunc('week'::text, checked_at)) DESC, parameter;


--
-- Name: v_run_with_deviation_metrics_30d; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_run_with_deviation_metrics_30d AS
 SELECT pr.run_id,
    pr.line_id,
    pr.batch_id,
    pr.product_sku,
    pr.started_at,
    pr.ended_at,
    pr.units_target,
    pr.units_produced,
    count(DISTINCT d.deviation_id) AS deviation_count,
    sum(
        CASE
            WHEN ((d.resolved_at IS NULL) AND (d.deviation_id IS NOT NULL)) THEN 1
            ELSE 0
        END) AS open_deviation_count,
    count(q.check_id) AS quality_check_count,
    sum(
        CASE
            WHEN (q.in_spec = false) THEN 1
            ELSE 0
        END) AS quality_failure_count
   FROM ((public.production_runs pr
     LEFT JOIN public.deviations d ON ((pr.run_id = d.run_id)))
     LEFT JOIN public.quality_checks q ON ((pr.run_id = q.run_id)))
  WHERE (pr.started_at >= (now() - '30 days'::interval))
  GROUP BY pr.run_id, pr.line_id, pr.batch_id, pr.product_sku, pr.started_at, pr.ended_at, pr.units_target, pr.units_produced
  ORDER BY pr.started_at DESC;


--
-- Name: v_weekly_deviation_summary_30d; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_weekly_deviation_summary_30d AS
 WITH deviations_with_week AS (
         SELECT d.deviation_id,
            d.run_id,
            d.equipment_id,
            d.observed_at,
            d.category,
            d.severity,
            d.expected_value,
            d.actual_value,
            d.unit,
            d.notes,
            d.resolved_at,
            d.root_cause_code,
            date_trunc('week'::text, d.observed_at) AS week_start,
            (EXTRACT(epoch FROM (d.resolved_at - d.observed_at)) / (3600)::numeric) AS hours_to_resolve
           FROM public.deviations d
          WHERE (d.observed_at >= (now() - '30 days'::interval))
        )
 SELECT week_start,
    category,
    severity,
    count(*) AS deviation_count,
    avg(hours_to_resolve) FILTER (WHERE (resolved_at IS NOT NULL)) AS avg_hours_to_resolve
   FROM deviations_with_week
  GROUP BY week_start, category, severity
  ORDER BY week_start DESC, (count(*)) DESC;


--
-- Name: v_weekly_production_efficiency; Type: VIEW; Schema: loom_views; Owner: -
--

CREATE VIEW loom_views.v_weekly_production_efficiency AS
 SELECT date_trunc('week'::text, started_at) AS week_start,
    line_id,
    count(run_id) AS run_count,
    sum(units_produced) AS total_units,
    avg(((units_produced)::numeric / (units_target)::numeric)) AS efficiency_rate
   FROM public.production_runs pr
  WHERE ((started_at >= (now() - '84 days'::interval)) AND (status = 'completed'::text))
  GROUP BY (date_trunc('week'::text, started_at)), line_id;


--
-- Name: deviations_deviation_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.deviations_deviation_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: deviations_deviation_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.deviations_deviation_id_seq OWNED BY public.deviations.deviation_id;


--
-- Name: equipment_equipment_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.equipment_equipment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: equipment_equipment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.equipment_equipment_id_seq OWNED BY public.equipment.equipment_id;


--
-- Name: operators_operator_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.operators_operator_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: operators_operator_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.operators_operator_id_seq OWNED BY public.operators.operator_id;


--
-- Name: production_runs_run_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.production_runs_run_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: production_runs_run_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.production_runs_run_id_seq OWNED BY public.production_runs.run_id;


--
-- Name: quality_checks_check_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quality_checks_check_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quality_checks_check_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.quality_checks_check_id_seq OWNED BY public.quality_checks.check_id;


--
-- Name: deviations deviation_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deviations ALTER COLUMN deviation_id SET DEFAULT nextval('public.deviations_deviation_id_seq'::regclass);


--
-- Name: equipment equipment_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment ALTER COLUMN equipment_id SET DEFAULT nextval('public.equipment_equipment_id_seq'::regclass);


--
-- Name: operators operator_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operators ALTER COLUMN operator_id SET DEFAULT nextval('public.operators_operator_id_seq'::regclass);


--
-- Name: production_runs run_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_runs ALTER COLUMN run_id SET DEFAULT nextval('public.production_runs_run_id_seq'::regclass);


--
-- Name: quality_checks check_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quality_checks ALTER COLUMN check_id SET DEFAULT nextval('public.quality_checks_check_id_seq'::regclass);


--
-- Data for Name: deviations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.deviations (deviation_id, run_id, equipment_id, observed_at, category, severity, expected_value, actual_value, unit, notes, resolved_at, root_cause_code) FROM stdin;
1	1	5	2026-04-08 18:08:20.232702+00	contamination	low	\N	\N	\N	operator note: investigating	2026-04-08 22:15:00.536129+00	\N
2	2	6	2026-03-18 23:15:25.754338+00	contamination	medium	\N	\N	\N	auto-flagged by SPC	2026-03-19 04:49:01.369574+00	\N
3	2	6	2026-03-18 23:28:57.640573+00	contamination	critical	\N	\N	\N	\N	2026-03-19 05:22:06.699327+00	\N
4	4	3	2026-04-19 15:13:56.334863+00	temperature	low	72.0	77.8874210168372	C	auto-flagged by SPC	2026-04-19 18:04:50.911443+00	\N
5	4	1	2026-04-19 16:08:18.168995+00	vibration	low	0.5	1.55232127312967	mm/s	operator note: investigating	2026-04-19 16:46:52.666593+00	\N
6	5	4	2026-04-09 00:44:24.641309+00	other	high	\N	\N	\N	auto-flagged by SPC	\N	\N
7	7	9	2026-04-07 14:16:29.607509+00	contamination	medium	\N	\N	\N	\N	2026-04-07 21:08:45.358352+00	\N
8	8	3	2026-04-10 22:29:28.844734+00	vibration	medium	0.5	1.08926119322612	mm/s	auto-flagged by SPC	2026-04-11 00:59:05.004375+00	\N
9	8	1	2026-04-10 23:19:20.649374+00	contamination	medium	\N	\N	\N	operator note: investigating	2026-04-11 01:46:22.639768+00	\N
10	9	5	2026-05-08 08:06:25.123675+00	pressure	low	2.4	2.15906103880741	bar	\N	2026-05-08 10:23:39.921315+00	\N
11	9	5	2026-05-08 09:14:09.391302+00	temperature	medium	72.0	77.9333086121994	C	operator note: investigating	2026-05-08 10:56:03.646417+00	\N
12	12	1	2026-04-23 06:51:39.291199+00	vibration	medium	0.5	1.63441647597335	mm/s	auto-flagged by SPC	2026-04-23 11:21:30.018685+00	\N
13	12	1	2026-04-23 07:24:03.626978+00	alignment	medium	0.0	0.650	mm	\N	2026-04-23 11:31:16.070099+00	\N
14	13	4	2026-04-29 17:23:52.855724+00	temperature	low	72.0	75.4565421852082	C	\N	2026-04-29 18:40:00.510241+00	\N
15	13	4	2026-04-29 18:19:28.034614+00	alignment	high	0.0	0.630	mm	\N	\N	\N
16	14	6	2026-05-13 23:34:13.264272+00	vibration	low	0.5	0.879185643895513	mm/s	\N	2026-05-14 06:25:56.069012+00	\N
17	14	7	2026-05-13 23:11:54.829659+00	pressure	low	2.4	2.54756424022422	bar	operator note: investigating	2026-05-14 06:59:09.118292+00	\N
18	15	10	2026-05-11 07:23:51.212193+00	vibration	low	0.5	0.555504971244734	mm/s	auto-flagged by SPC	2026-05-11 11:13:26.967264+00	\N
19	16	1	2026-04-01 19:22:51.325209+00	pressure	medium	2.4	2.2645094732866	bar	auto-flagged by SPC	2026-04-01 21:14:11.123977+00	\N
20	16	3	2026-04-01 15:23:17.161946+00	other	low	\N	\N	\N	operator note: investigating	2026-04-01 22:23:47.197644+00	\N
21	17	4	2026-04-25 00:01:43.49783+00	contamination	high	\N	\N	\N	operator note: investigating	\N	\N
22	17	5	2026-04-24 23:38:57.097312+00	vibration	low	0.5	1.46941111310436	mm/s	\N	2026-04-25 01:00:12.579876+00	\N
23	18	6	2026-05-08 08:22:21.456041+00	pressure	low	2.4	2.20514782918933	bar	operator note: investigating	2026-05-08 10:36:35.631302+00	\N
24	19	9	2026-05-03 17:22:36.634644+00	pressure	low	2.4	2.49977246495549	bar	operator note: investigating	2026-05-03 22:08:18.485948+00	\N
25	20	3	2026-05-05 00:12:56.051145+00	temperature	medium	72.0	73.2929552911224	C	\N	2026-05-05 06:02:04.695489+00	\N
26	22	6	2026-03-19 15:15:35.16208+00	alignment	low	0.0	0.314	mm	auto-flagged by SPC	2026-03-19 21:47:27.202372+00	\N
27	23	8	2026-04-08 00:20:20.448243+00	pressure	low	2.4	2.54529394414519	bar	\N	2026-04-08 02:39:32.736976+00	\N
28	25	4	2026-05-06 17:27:56.605451+00	contamination	critical	\N	\N	\N	operator note: investigating	2026-05-06 22:14:54.898951+00	\N
29	26	6	2026-04-21 00:14:14.174871+00	alignment	low	0.0	-0.255	mm	auto-flagged by SPC	2026-04-21 05:52:52.015629+00	\N
30	28	1	2026-03-20 17:59:01.503913+00	vibration	low	0.5	1.03725225054236	mm/s	operator note: investigating	2026-03-20 23:27:26.981814+00	\N
31	29	5	2026-04-30 22:32:29.711896+00	alignment	critical	0.0	0.061	mm	\N	\N	\N
32	31	8	2026-04-13 18:15:34.128363+00	vibration	critical	0.5	1.31812615733727	mm/s	\N	2026-04-13 22:15:14.97617+00	\N
33	32	1	2026-05-06 22:59:58.854964+00	temperature	critical	72.0	69.7434207213695	C	operator note: investigating	2026-05-07 01:09:59.303211+00	\N
34	33	5	2026-03-18 06:52:24.201949+00	vibration	medium	0.5	0.690018621146045	mm/s	operator note: investigating	2026-03-18 08:54:25.758107+00	\N
35	34	6	2026-04-13 16:54:28.386399+00	vibration	low	0.5	0.982873431150018	mm/s	auto-flagged by SPC	2026-04-13 17:37:09.430112+00	\N
36	35	8	2026-04-17 03:10:38.725262+00	temperature	low	72.0	76.8088229866284	C	auto-flagged by SPC	2026-04-17 05:46:53.500345+00	\N
37	36	1	2026-04-26 06:39:40.657704+00	temperature	medium	72.0	69.3089277113348	C	\N	2026-04-26 10:14:42.643677+00	\N
38	37	5	2026-04-28 16:25:18.218011+00	other	low	\N	\N	\N	\N	2026-04-28 19:14:36.677187+00	\N
39	37	4	2026-04-28 16:01:47.712689+00	contamination	low	\N	\N	\N	\N	2026-04-28 18:18:57.954434+00	\N
40	39	8	2026-05-02 09:10:06.261149+00	vibration	high	0.5	0.854344258404933	mm/s	\N	\N	\N
41	40	2	2026-05-10 14:07:47.911312+00	temperature	medium	72.0	71.3914514259393	C	operator note: investigating	2026-05-10 22:08:40.375349+00	\N
42	42	7	2026-03-27 10:41:11.359798+00	pressure	medium	2.4	2.43055165387215	bar	\N	2026-03-27 13:02:04.468369+00	\N
43	42	6	2026-03-27 09:54:16.116023+00	temperature	low	72.0	79.4377654026175	C	operator note: investigating	2026-03-27 13:32:36.267402+00	\N
44	45	4	2026-04-07 06:32:01.109361+00	vibration	high	0.5	1.31972870452687	mm/s	\N	2026-04-07 09:23:11.699541+00	\N
45	45	4	2026-04-07 06:58:25.070726+00	vibration	medium	0.5	1.58119153799566	mm/s	\N	2026-04-07 09:03:16.658495+00	\N
46	46	6	2026-04-16 16:43:33.78315+00	vibration	low	0.5	1.47347141538369	mm/s	auto-flagged by SPC	2026-04-16 21:15:35.237553+00	\N
47	47	10	2026-04-29 01:13:36.828406+00	temperature	low	72.0	79.3429650589452	C	\N	2026-04-29 02:37:18.976861+00	\N
48	48	3	2026-05-06 06:02:00.643435+00	alignment	critical	0.0	-0.129	mm	operator note: investigating	2026-05-06 13:32:31.528337+00	\N
49	48	1	2026-05-06 09:48:15.876571+00	vibration	low	0.5	1.06030947999668	mm/s	operator note: investigating	2026-05-06 13:20:06.055533+00	\N
50	49	5	2026-05-11 14:45:43.224735+00	temperature	medium	72.0	74.6456085938462	C	auto-flagged by SPC	2026-05-11 17:39:59.48734+00	\N
51	50	7	2026-04-29 22:21:35.804871+00	pressure	high	2.4	2.82962927279421	bar	operator note: investigating	\N	\N
52	50	7	2026-04-29 23:35:00.822233+00	temperature	high	72.0	71.1936086670979	C	operator note: investigating	2026-04-30 01:00:44.109031+00	\N
53	51	10	2026-03-22 06:46:24.46452+00	temperature	critical	72.0	72.2353340939682	C	\N	2026-03-22 09:23:07.502822+00	\N
54	53	5	2026-03-26 23:12:54.880813+00	vibration	low	0.5	1.29594734167712	mm/s	auto-flagged by SPC	2026-03-27 03:00:11.787157+00	\N
55	53	5	2026-03-26 23:25:33.404575+00	pressure	medium	2.4	2.44355544517407	bar	operator note: investigating	2026-03-27 02:35:54.38851+00	\N
56	56	3	2026-04-15 00:29:06.203845+00	contamination	low	\N	\N	\N	\N	2026-04-15 05:03:06.008528+00	\N
57	57	5	2026-04-19 06:17:46.513399+00	vibration	medium	0.5	0.872464432922091	mm/s	operator note: investigating	2026-04-19 07:43:08.208085+00	\N
58	58	7	2026-04-13 15:08:44.737516+00	temperature	medium	72.0	77.8872819869398	C	\N	2026-04-13 21:14:30.552222+00	\N
59	58	7	2026-04-13 14:29:33.010571+00	temperature	low	72.0	77.3914833136988	C	auto-flagged by SPC	2026-04-13 20:52:34.872217+00	\N
60	60	1	2026-04-29 06:35:53.021189+00	alignment	high	0.0	0.129	mm	\N	\N	\N
61	60	2	2026-04-29 06:42:25.291494+00	temperature	low	72.0	77.2706526130578	C	operator note: investigating	2026-04-29 08:16:07.6708+00	\N
62	60	2	2026-04-29 06:30:48.467696+00	contamination	medium	\N	\N	\N	\N	2026-04-29 08:04:04.894521+00	\N
63	60	2	2026-04-29 06:28:25.637913+00	alignment	high	0.0	0.971	mm	operator note: investigating	\N	\N
64	61	5	2026-03-30 15:33:13.022722+00	vibration	critical	0.5	1.25923766658932	mm/s	auto-flagged by SPC	2026-03-30 20:01:50.529505+00	\N
65	62	6	2026-04-28 03:03:36.872496+00	alignment	low	0.0	-0.854	mm	operator note: investigating	2026-04-28 03:32:42.309621+00	\N
66	62	7	2026-04-28 00:37:49.577489+00	temperature	medium	72.0	70.120508278351	C	\N	2026-04-28 03:29:52.315802+00	\N
67	64	3	2026-04-06 14:31:21.40722+00	temperature	low	72.0	74.3558339100905	C	operator note: investigating	2026-04-06 15:30:08.062662+00	\N
68	64	1	2026-04-06 14:29:53.07313+00	other	medium	\N	\N	\N	auto-flagged by SPC	2026-04-06 16:16:04.759287+00	\N
69	64	2	2026-04-06 14:20:59.169823+00	temperature	low	72.0	79.9332544014993	C	operator note: investigating	2026-04-06 15:13:55.897011+00	\N
70	64	1	2026-04-06 14:24:11.739725+00	alignment	low	0.0	-0.776	mm	\N	2026-04-06 15:11:37.772242+00	\N
71	65	4	2026-04-08 01:30:24.047453+00	temperature	low	72.0	76.5579171944628	C	\N	2026-04-08 04:08:11.694295+00	\N
72	66	6	2026-03-25 09:44:27.809141+00	other	low	\N	\N	\N	\N	2026-03-25 12:57:27.756469+00	\N
73	67	8	2026-05-10 15:39:23.093811+00	alignment	high	0.0	-0.176	mm	operator note: investigating	2026-05-10 20:14:05.881388+00	\N
74	67	10	2026-05-10 14:50:58.344301+00	vibration	medium	0.5	1.17389362631562	mm/s	\N	2026-05-10 20:11:14.735657+00	\N
75	68	2	2026-04-24 22:12:07.970688+00	vibration	low	0.5	0.983963053330616	mm/s	auto-flagged by SPC	2026-04-25 00:09:10.390334+00	\N
76	68	1	2026-04-24 22:14:36.785133+00	alignment	low	0.0	-0.586	mm	auto-flagged by SPC	2026-04-24 23:52:12.376459+00	\N
77	68	3	2026-04-24 22:33:43.863185+00	other	low	\N	\N	\N	operator note: investigating	2026-04-25 00:06:16.684487+00	\N
78	68	1	2026-04-24 22:33:53.853537+00	other	low	\N	\N	\N	operator note: investigating	2026-04-24 23:35:05.980334+00	\N
79	69	4	2026-05-08 09:30:05.761375+00	pressure	critical	2.4	2.89679058334798	bar	operator note: investigating	2026-05-08 13:10:52.620191+00	\N
80	70	7	2026-04-07 20:50:06.422335+00	other	low	\N	\N	\N	operator note: investigating	2026-04-07 22:57:51.918051+00	\N
81	70	6	2026-04-07 20:41:28.411017+00	pressure	high	2.4	2.25425626082052	bar	operator note: investigating	2026-04-07 21:34:25.828224+00	\N
82	71	10	2026-05-16 22:29:15.442806+00	contamination	low	\N	\N	\N	\N	2026-05-17 00:43:50.012292+00	\N
83	71	9	2026-05-16 23:26:00.900142+00	contamination	medium	\N	\N	\N	auto-flagged by SPC	2026-05-17 01:52:55.993945+00	\N
84	72	3	2026-05-02 07:58:19.625608+00	other	critical	\N	\N	\N	\N	2026-05-02 08:49:18.225743+00	\N
85	72	3	2026-05-02 07:57:46.845735+00	vibration	low	0.5	1.4278207383077	mm/s	auto-flagged by SPC	2026-05-02 09:46:50.906405+00	\N
86	73	5	2026-03-27 20:14:22.094669+00	temperature	low	72.0	77.9400450363799	C	\N	2026-03-27 21:05:34.657069+00	\N
87	73	5	2026-03-27 19:01:20.282363+00	temperature	medium	72.0	77.6587646684397	C	\N	2026-03-27 22:13:11.117664+00	\N
88	74	6	2026-03-20 00:45:21.859204+00	temperature	medium	72.0	68.0805113031582	C	\N	2026-03-20 04:42:32.568755+00	\N
89	75	9	2026-05-11 12:10:36.457581+00	other	medium	\N	\N	\N	auto-flagged by SPC	2026-05-11 15:26:56.868405+00	\N
90	76	1	2026-05-05 16:29:12.953971+00	vibration	low	0.5	1.60878450714547	mm/s	operator note: investigating	2026-05-05 22:31:15.35542+00	\N
91	77	4	2026-04-14 23:32:48.358995+00	vibration	low	0.5	0.727661827887788	mm/s	\N	2026-04-15 07:12:22.256238+00	\N
92	77	4	2026-04-15 01:30:56.05906+00	temperature	critical	72.0	71.2753489354108	C	auto-flagged by SPC	2026-04-15 06:56:10.959592+00	\N
93	78	6	2026-03-24 08:04:59.023025+00	pressure	medium	2.4	2.59085120408619	bar	auto-flagged by SPC	2026-03-24 08:15:22.939147+00	\N
94	78	6	2026-03-24 08:04:17.166584+00	alignment	low	0.0	-0.902	mm	auto-flagged by SPC	2026-03-24 09:45:55.197851+00	\N
95	80	3	2026-05-09 02:15:30.018488+00	other	low	\N	\N	\N	operator note: investigating	2026-05-09 04:17:04.185335+00	\N
96	81	5	2026-05-11 07:25:11.075395+00	vibration	high	0.5	1.14653494983027	mm/s	auto-flagged by SPC	\N	\N
97	85	4	2026-04-03 18:25:24.248215+00	temperature	low	72.0	76.1504844996891	C	operator note: investigating	2026-04-03 20:49:59.12986+00	\N
98	86	6	2026-05-15 02:42:16.318337+00	temperature	high	72.0	70.2176326076459	C	operator note: investigating	2026-05-15 07:12:06.53092+00	\N
99	87	8	2026-04-06 12:26:05.380503+00	alignment	medium	0.0	-0.770	mm	\N	2026-04-06 13:45:24.587153+00	\N
100	91	10	2026-05-05 16:29:50.221808+00	other	low	\N	\N	\N	\N	2026-05-05 17:36:19.159881+00	\N
101	92	3	2026-03-18 23:02:29.686335+00	pressure	high	2.4	2.43860433233691	bar	operator note: investigating	\N	\N
102	92	3	2026-03-18 23:32:06.258831+00	temperature	low	72.0	79.6865209696008	C	auto-flagged by SPC	2026-03-19 00:14:29.789298+00	\N
103	92	3	2026-03-18 22:47:58.506655+00	alignment	low	0.0	0.771	mm	\N	2026-03-19 00:59:45.449083+00	\N
104	93	5	2026-03-21 10:36:04.817084+00	pressure	high	2.4	2.71931559666774	bar	operator note: investigating	\N	\N
105	94	6	2026-05-03 15:15:57.746206+00	pressure	low	2.4	2.31165013473899	bar	\N	2026-05-03 19:35:36.675478+00	\N
106	95	10	2026-03-26 04:03:27.50502+00	pressure	medium	2.4	2.84879831608557	bar	operator note: investigating	2026-03-26 05:32:12.293814+00	\N
107	95	10	2026-03-26 02:32:00.01263+00	contamination	low	\N	\N	\N	auto-flagged by SPC	2026-03-26 06:35:36.456003+00	\N
108	96	3	2026-05-09 06:59:36.991683+00	alignment	medium	0.0	-0.456	mm	operator note: investigating	2026-05-09 13:48:03.286677+00	\N
109	96	1	2026-05-09 09:22:46.226378+00	pressure	low	2.4	2.57798113790578	bar	operator note: investigating	2026-05-09 13:04:23.530469+00	\N
110	97	5	2026-05-03 14:59:16.488771+00	temperature	critical	72.0	76.5191755130883	C	auto-flagged by SPC	2026-05-03 15:43:27.119679+00	\N
111	97	5	2026-05-03 14:35:31.127112+00	alignment	low	0.0	-0.088	mm	operator note: investigating	2026-05-03 16:03:48.550583+00	\N
112	97	5	2026-05-03 14:10:01.161132+00	pressure	medium	2.4	2.69541643004784	bar	operator note: investigating	2026-05-03 15:47:15.104565+00	\N
113	97	4	2026-05-03 14:46:31.231228+00	other	low	\N	\N	\N	auto-flagged by SPC	2026-05-03 16:17:19.454986+00	\N
114	98	6	2026-04-01 01:47:18.349446+00	contamination	low	\N	\N	\N	operator note: investigating	2026-04-01 05:02:55.314871+00	\N
115	98	6	2026-04-01 02:25:50.126395+00	pressure	critical	2.4	2.78296356601115	bar	\N	\N	\N
116	99	8	2026-04-13 07:59:31.070275+00	pressure	low	2.4	2.83125619486146	bar	\N	2026-04-13 15:30:43.078889+00	\N
117	99	10	2026-04-13 08:38:38.610424+00	other	critical	\N	\N	\N	operator note: investigating	\N	\N
118	104	2	2026-04-29 01:45:38.492053+00	pressure	low	2.4	2.80652391497424	bar	auto-flagged by SPC	2026-04-29 03:26:27.789802+00	\N
119	104	2	2026-04-29 03:03:06.901774+00	other	critical	\N	\N	\N	\N	\N	\N
120	105	5	2026-04-07 10:19:00.315923+00	temperature	low	72.0	73.6597645006278	C	\N	2026-04-07 11:25:51.432313+00	\N
121	107	10	2026-04-25 23:21:16.310143+00	other	low	\N	\N	\N	auto-flagged by SPC	2026-04-26 01:58:40.984932+00	\N
122	108	3	2026-04-11 07:55:51.352244+00	pressure	low	2.4	2.51120528048916	bar	auto-flagged by SPC	2026-04-11 14:33:21.284581+00	\N
123	109	5	2026-04-05 17:40:55.776727+00	contamination	high	\N	\N	\N	auto-flagged by SPC	2026-04-05 18:08:09.296681+00	\N
124	109	5	2026-04-05 15:02:25.726726+00	other	high	\N	\N	\N	operator note: investigating	2026-04-05 18:57:00.938992+00	\N
125	110	7	2026-04-13 01:02:26.829513+00	alignment	low	0.0	0.179	mm	operator note: investigating	2026-04-13 04:59:47.534701+00	\N
126	111	10	2026-04-23 08:51:07.614985+00	temperature	high	72.0	78.3144259693007	C	auto-flagged by SPC	2026-04-23 14:23:04.079531+00	\N
127	112	2	2026-04-18 21:11:51.445681+00	temperature	low	72.0	68.9743335679687	C	auto-flagged by SPC	2026-04-18 21:52:52.978929+00	\N
128	114	6	2026-04-10 06:37:45.9446+00	temperature	medium	72.0	77.4645171110513	C	\N	2026-04-10 08:25:55.568209+00	\N
129	115	8	2026-03-31 18:37:19.561272+00	contamination	high	\N	\N	\N	auto-flagged by SPC	\N	\N
130	116	2	2026-03-23 22:38:51.490632+00	pressure	critical	2.4	2.42489783370224	bar	\N	\N	\N
131	118	6	2026-05-10 19:58:56.905516+00	alignment	medium	0.0	-0.301	mm	\N	2026-05-10 21:28:24.949768+00	\N
132	118	6	2026-05-10 17:49:20.032942+00	pressure	medium	2.4	2.34426807503905	bar	operator note: investigating	2026-05-10 21:52:20.518585+00	\N
133	121	5	2026-03-27 17:16:17.542597+00	other	medium	\N	\N	\N	operator note: investigating	2026-03-27 18:52:35.066741+00	\N
134	123	10	2026-04-07 06:43:03.248067+00	vibration	low	0.5	0.680923355919103	mm/s	auto-flagged by SPC	2026-04-07 15:15:28.489309+00	\N
135	123	10	2026-04-07 10:24:23.171243+00	alignment	critical	0.0	0.989	mm	operator note: investigating	\N	\N
136	124	3	2026-04-12 16:27:14.430157+00	alignment	high	0.0	0.693	mm	operator note: investigating	\N	\N
137	125	4	2026-05-14 23:22:55.159261+00	temperature	critical	72.0	70.2268621033873	C	auto-flagged by SPC	\N	\N
138	126	7	2026-04-19 06:47:39.524883+00	pressure	critical	2.4	2.26844359623573	bar	operator note: investigating	2026-04-19 14:27:40.725033+00	\N
139	128	3	2026-04-15 22:46:20.498562+00	pressure	high	2.4	2.58476982468715	bar	auto-flagged by SPC	2026-04-16 00:56:06.256398+00	\N
140	128	1	2026-04-15 22:57:56.227307+00	temperature	high	72.0	79.3404595576655	C	\N	2026-04-16 01:02:56.287272+00	\N
141	129	5	2026-04-23 08:44:24.940448+00	contamination	high	\N	\N	\N	operator note: investigating	\N	\N
142	129	4	2026-04-23 07:01:08.581122+00	temperature	low	72.0	79.2760671438729	C	auto-flagged by SPC	2026-04-23 11:51:56.451577+00	\N
143	130	7	2026-04-17 15:56:51.307272+00	temperature	low	72.0	79.4659233890687	C	\N	2026-04-17 19:16:33.557298+00	\N
144	131	10	2026-04-02 23:57:32.12918+00	contamination	low	\N	\N	\N	\N	2026-04-03 04:14:00.501208+00	\N
145	132	3	2026-03-17 08:54:23.603261+00	contamination	critical	\N	\N	\N	operator note: investigating	2026-03-17 11:05:20.844928+00	\N
146	133	4	2026-05-07 18:14:59.465619+00	pressure	medium	2.4	2.65676933719268	bar	auto-flagged by SPC	2026-05-07 19:37:01.036067+00	\N
147	134	6	2026-05-01 22:36:43.727931+00	contamination	high	\N	\N	\N	\N	\N	\N
148	135	8	2026-04-21 08:34:01.728967+00	vibration	high	0.5	1.6273451519661	mm/s	auto-flagged by SPC	2026-04-21 14:47:55.179581+00	\N
149	135	10	2026-04-21 09:29:02.185887+00	temperature	low	72.0	69.2048089903593	C	\N	2026-04-21 14:17:55.716762+00	\N
150	137	5	2026-05-01 00:42:39.455074+00	contamination	medium	\N	\N	\N	\N	2026-05-01 04:22:54.433708+00	\N
151	138	7	2026-05-03 09:03:17.685441+00	alignment	low	0.0	-0.234	mm	auto-flagged by SPC	2026-05-03 10:04:55.575581+00	\N
152	138	6	2026-05-03 08:41:29.483241+00	contamination	low	\N	\N	\N	\N	2026-05-03 11:04:50.565477+00	\N
153	139	10	2026-04-06 18:27:29.049345+00	contamination	medium	\N	\N	\N	\N	2026-04-06 19:36:25.061255+00	\N
154	139	8	2026-04-06 18:02:13.967889+00	contamination	low	\N	\N	\N	\N	2026-04-06 20:12:06.893386+00	\N
155	142	6	2026-03-18 17:12:11.59199+00	other	high	\N	\N	\N	auto-flagged by SPC	\N	\N
156	143	8	2026-05-06 02:30:17.306541+00	contamination	medium	\N	\N	\N	operator note: investigating	2026-05-06 04:16:27.908216+00	\N
157	144	1	2026-04-30 06:48:00.767519+00	temperature	high	72.0	68.1440252526452	C	auto-flagged by SPC	\N	\N
158	144	3	2026-04-30 08:57:06.561996+00	other	critical	\N	\N	\N	operator note: investigating	2026-04-30 10:01:32.466005+00	\N
159	145	5	2026-04-14 14:55:12.060696+00	contamination	medium	\N	\N	\N	operator note: investigating	2026-04-14 20:18:23.71287+00	\N
160	146	7	2026-05-02 23:16:15.539684+00	contamination	critical	\N	\N	\N	\N	\N	\N
161	147	8	2026-03-26 06:27:12.930686+00	alignment	medium	0.0	0.465	mm	operator note: investigating	2026-03-26 10:36:47.179797+00	\N
162	147	10	2026-03-26 06:10:44.922698+00	alignment	low	0.0	0.583	mm	operator note: investigating	2026-03-26 11:04:20.895769+00	\N
163	148	2	2026-03-24 16:34:29.521528+00	pressure	low	2.4	2.35781955643175	bar	operator note: investigating	2026-03-24 19:44:58.209189+00	\N
164	149	5	2026-04-26 01:59:11.334775+00	pressure	high	2.4	2.5653952833459	bar	operator note: investigating	\N	\N
165	150	6	2026-04-28 09:29:31.797192+00	other	critical	\N	\N	\N	operator note: investigating	\N	\N
166	150	7	2026-04-28 07:30:32.142438+00	vibration	critical	0.5	1.5926830307206	mm/s	\N	2026-04-28 12:43:53.48779+00	\N
167	151	9	2026-04-26 17:00:17.857954+00	temperature	low	72.0	78.5542091333378	C	auto-flagged by SPC	2026-04-26 17:43:35.458387+00	\N
168	152	1	2026-05-09 23:42:21.291037+00	temperature	medium	72.0	74.4618824434206	C	auto-flagged by SPC	2026-05-10 01:30:08.129468+00	\N
169	153	4	2026-05-06 06:22:28.424156+00	pressure	low	2.4	2.50518973595541	bar	operator note: investigating	2026-05-06 07:16:17.262718+00	\N
170	153	5	2026-05-06 06:31:44.080864+00	other	high	\N	\N	\N	\N	2026-05-06 07:04:34.244219+00	\N
171	153	4	2026-05-06 06:21:34.376979+00	vibration	medium	0.5	1.54010310275269	mm/s	auto-flagged by SPC	2026-05-06 06:54:15.80814+00	\N
172	155	10	2026-04-14 00:50:08.704796+00	alignment	medium	0.0	0.674	mm	\N	2026-04-14 03:26:46.44678+00	\N
173	155	8	2026-04-13 23:22:42.57253+00	temperature	low	72.0	76.3997564571969	C	auto-flagged by SPC	2026-04-14 03:41:58.410676+00	\N
174	156	1	2026-04-30 11:17:08.376864+00	contamination	medium	\N	\N	\N	auto-flagged by SPC	2026-04-30 11:54:24.214211+00	\N
175	156	1	2026-04-30 06:29:25.769094+00	contamination	low	\N	\N	\N	operator note: investigating	2026-04-30 11:47:46.159277+00	\N
176	157	4	2026-05-10 16:12:51.781942+00	pressure	medium	2.4	2.29557145278295	bar	auto-flagged by SPC	2026-05-10 21:12:19.364918+00	\N
177	157	5	2026-05-10 15:59:46.265253+00	pressure	medium	2.4	2.56370957609925	bar	\N	2026-05-10 20:55:11.518931+00	\N
178	158	7	2026-05-15 00:59:49.868373+00	contamination	low	\N	\N	\N	operator note: investigating	2026-05-15 01:57:29.569245+00	\N
179	158	7	2026-05-15 00:08:41.79447+00	vibration	low	0.5	0.98097360980991	mm/s	operator note: investigating	2026-05-15 02:28:21.250675+00	\N
180	160	2	2026-05-01 15:00:41.529422+00	temperature	high	72.0	77.5219425950853	C	operator note: investigating	2026-05-01 20:51:53.615123+00	\N
181	161	5	2026-04-24 22:32:52.295354+00	pressure	medium	2.4	2.25943519909703	bar	operator note: investigating	2026-04-25 04:21:41.06953+00	\N
182	164	3	2026-04-19 02:21:52.91178+00	alignment	high	0.0	0.977	mm	auto-flagged by SPC	\N	\N
183	165	4	2026-05-13 13:02:55.33858+00	pressure	low	2.4	2.44569881896486	bar	operator note: investigating	2026-05-13 14:30:31.403571+00	\N
184	167	8	2026-04-02 23:07:48.163822+00	other	low	\N	\N	\N	operator note: investigating	2026-04-03 01:03:23.869754+00	\N
185	167	9	2026-04-02 22:29:05.354503+00	pressure	high	2.4	2.23857104331865	bar	auto-flagged by SPC	\N	\N
186	168	2	2026-03-25 09:23:27.394042+00	temperature	low	72.0	74.1762555869654	C	auto-flagged by SPC	2026-03-25 14:34:56.013157+00	\N
187	169	4	2026-04-02 14:32:59.296509+00	pressure	low	2.4	2.51581947035705	bar	\N	2026-04-02 15:49:16.255902+00	\N
188	171	9	2026-03-21 06:20:34.386333+00	contamination	medium	\N	\N	\N	auto-flagged by SPC	2026-03-21 08:55:05.313829+00	\N
189	172	2	2026-04-13 17:32:54.646414+00	alignment	low	0.0	0.813	mm	auto-flagged by SPC	2026-04-13 19:15:28.303025+00	\N
190	172	2	2026-04-13 15:34:58.781322+00	pressure	low	2.4	2.53168728939765	bar	operator note: investigating	2026-04-13 18:20:58.899393+00	\N
191	173	5	2026-05-04 22:53:10.580478+00	alignment	critical	0.0	0.134	mm	\N	2026-05-05 03:58:03.211748+00	\N
192	173	4	2026-05-05 01:44:18.027192+00	other	low	\N	\N	\N	\N	2026-05-05 04:12:05.095352+00	\N
193	174	6	2026-04-17 06:27:24.375693+00	pressure	medium	2.4	2.40371982732806	bar	\N	2026-04-17 07:22:39.553836+00	\N
194	175	10	2026-03-19 15:43:59.694572+00	temperature	medium	72.0	71.6838201440882	C	\N	2026-03-19 19:50:15.802567+00	\N
195	175	9	2026-03-19 15:54:47.9225+00	contamination	low	\N	\N	\N	operator note: investigating	2026-03-19 19:03:34.38649+00	\N
196	176	3	2026-05-14 04:04:30.947301+00	other	low	\N	\N	\N	operator note: investigating	2026-05-14 04:57:03.150752+00	\N
197	176	3	2026-05-14 03:02:53.690236+00	alignment	critical	0.0	-0.138	mm	operator note: investigating	2026-05-14 04:53:23.397439+00	\N
198	177	4	2026-04-11 13:25:48.251382+00	contamination	medium	\N	\N	\N	\N	2026-04-11 13:43:14.135327+00	\N
199	178	7	2026-05-09 14:17:29.136591+00	contamination	medium	\N	\N	\N	operator note: investigating	2026-05-09 21:50:42.617713+00	\N
200	179	8	2026-03-19 22:48:48.117868+00	vibration	high	0.5	0.986482834557495	mm/s	\N	\N	\N
201	180	3	2026-03-31 09:49:31.066242+00	temperature	low	72.0	70.1482453674491	C	auto-flagged by SPC	2026-03-31 10:58:35.273512+00	\N
202	180	3	2026-03-31 09:44:43.736522+00	pressure	high	2.4	2.42186099366234	bar	auto-flagged by SPC	2026-03-31 10:44:14.629053+00	\N
203	181	4	2026-04-11 16:34:25.843665+00	pressure	low	2.4	2.74493749596293	bar	auto-flagged by SPC	2026-04-11 20:55:15.267793+00	\N
204	182	7	2026-04-23 23:26:30.762551+00	temperature	high	72.0	68.3640409027441	C	\N	2026-04-24 02:50:13.92268+00	\N
205	184	1	2026-04-23 15:13:34.193775+00	contamination	low	\N	\N	\N	operator note: investigating	2026-04-23 17:08:07.154912+00	\N
206	184	1	2026-04-23 15:47:38.020908+00	temperature	low	72.0	79.3942988480353	C	\N	2026-04-23 17:12:06.967051+00	\N
207	185	4	2026-03-27 00:18:42.060757+00	other	low	\N	\N	\N	\N	2026-03-27 03:50:22.19023+00	\N
208	186	7	2026-03-18 07:42:44.478405+00	temperature	low	72.0	74.0558416692967	C	operator note: investigating	2026-03-18 10:40:04.107022+00	\N
209	187	9	2026-03-26 17:02:02.2577+00	contamination	medium	\N	\N	\N	\N	2026-03-26 18:01:41.830124+00	\N
210	187	9	2026-03-26 16:20:44.396544+00	other	critical	\N	\N	\N	operator note: investigating	\N	\N
211	188	3	2026-04-17 00:32:46.486272+00	other	medium	\N	\N	\N	operator note: investigating	2026-04-17 06:25:57.049152+00	\N
212	188	1	2026-04-17 02:14:24.495636+00	temperature	high	72.0	77.89206052475	C	operator note: investigating	2026-04-17 07:25:04.700788+00	\N
213	189	5	2026-05-15 09:10:05.394533+00	contamination	low	\N	\N	\N	\N	2026-05-15 10:51:54.955452+00	\N
214	190	7	2026-04-28 17:13:41.777391+00	vibration	low	0.5	1.04648816511649	mm/s	auto-flagged by SPC	2026-04-28 18:47:24.67633+00	\N
215	191	9	2026-04-28 22:13:31.678241+00	other	high	\N	\N	\N	operator note: investigating	\N	\N
216	192	1	2026-04-09 08:53:41.724543+00	alignment	high	0.0	0.586	mm	operator note: investigating	2026-04-09 10:43:21.526398+00	\N
217	193	5	2026-05-06 16:15:35.146176+00	contamination	medium	\N	\N	\N	operator note: investigating	2026-05-06 20:09:02.52292+00	\N
218	194	7	2026-05-11 22:54:42.49482+00	other	low	\N	\N	\N	\N	2026-05-12 02:45:32.332309+00	\N
219	195	8	2026-05-04 07:07:34.049785+00	alignment	low	0.0	0.564	mm	auto-flagged by SPC	2026-05-04 09:39:30.207726+00	\N
220	195	8	2026-05-04 07:24:07.248647+00	other	medium	\N	\N	\N	auto-flagged by SPC	2026-05-04 09:48:19.872618+00	\N
221	197	5	2026-04-30 00:21:46.833674+00	alignment	low	0.0	-0.023	mm	operator note: investigating	2026-04-30 06:04:07.034803+00	\N
222	199	8	2026-04-30 15:22:24.213848+00	contamination	low	\N	\N	\N	auto-flagged by SPC	2026-04-30 19:32:04.083282+00	\N
223	202	6	2026-05-12 16:19:21.939405+00	vibration	low	0.5	0.692764502665056	mm/s	operator note: investigating	2026-05-12 19:49:21.020385+00	\N
224	203	8	2026-05-16 00:12:52.507165+00	temperature	medium	72.0	78.0587894233417	C	\N	2026-05-16 05:03:28.718402+00	\N
225	203	9	2026-05-15 22:25:53.711271+00	vibration	low	0.5	1.20944741754294	mm/s	operator note: investigating	2026-05-16 05:09:52.686885+00	\N
226	205	4	2026-05-02 14:34:37.773886+00	pressure	medium	2.4	2.69681223638628	bar	\N	2026-05-02 20:15:25.50349+00	\N
227	205	4	2026-05-02 19:26:22.159129+00	contamination	low	\N	\N	\N	auto-flagged by SPC	2026-05-02 21:10:10.459265+00	\N
228	206	7	2026-03-21 23:28:36.446503+00	alignment	low	0.0	0.464	mm	operator note: investigating	2026-03-22 04:15:25.781266+00	\N
229	208	2	2026-04-30 15:49:51.36157+00	other	low	\N	\N	\N	operator note: investigating	2026-04-30 17:40:25.85343+00	\N
230	210	7	2026-04-01 06:43:08.417323+00	alignment	critical	0.0	-0.871	mm	\N	\N	\N
231	211	9	2026-04-29 17:50:04.062377+00	other	low	\N	\N	\N	operator note: investigating	2026-04-29 19:53:34.664334+00	\N
232	212	3	2026-03-25 02:04:19.603487+00	other	medium	\N	\N	\N	\N	2026-03-25 03:49:00.537302+00	\N
233	213	5	2026-04-20 08:45:27.529958+00	vibration	high	0.5	1.69456808672751	mm/s	operator note: investigating	2026-04-20 10:41:40.347575+00	\N
234	216	1	2026-04-20 06:54:43.255157+00	temperature	low	72.0	74.9779323999587	C	auto-flagged by SPC	2026-04-20 10:19:45.344+00	\N
235	216	2	2026-04-20 09:19:51.701868+00	temperature	high	72.0	79.8141495377179	C	\N	\N	\N
236	217	4	2026-04-28 16:30:23.095284+00	pressure	medium	2.4	2.85726321588835	bar	\N	2026-04-28 18:28:52.422949+00	\N
237	217	4	2026-04-28 15:08:11.490818+00	temperature	low	72.0	70.8385939572342	C	operator note: investigating	2026-04-28 19:54:38.569741+00	\N
238	218	7	2026-04-17 00:21:21.332808+00	vibration	medium	0.5	0.584193020464027	mm/s	auto-flagged by SPC	2026-04-17 05:49:49.557479+00	\N
239	218	7	2026-04-17 03:50:17.089177+00	temperature	low	72.0	76.3215306702589	C	operator note: investigating	2026-04-17 05:04:38.963677+00	\N
240	220	1	2026-04-09 15:29:44.060212+00	temperature	medium	72.0	71.253531293976	C	\N	2026-04-09 21:02:50.654352+00	\N
241	223	9	2026-05-04 15:09:22.518731+00	temperature	medium	72.0	79.276620673806	C	operator note: investigating	2026-05-04 17:44:05.663153+00	\N
242	225	5	2026-03-17 07:10:17.194588+00	other	low	\N	\N	\N	operator note: investigating	2026-03-17 08:34:43.457133+00	\N
243	225	5	2026-03-17 07:03:36.449537+00	alignment	medium	0.0	-0.036	mm	operator note: investigating	2026-03-17 08:46:06.566621+00	\N
244	227	9	2026-04-02 00:35:51.123244+00	contamination	low	\N	\N	\N	auto-flagged by SPC	2026-04-02 03:05:48.549397+00	\N
245	227	10	2026-04-01 23:15:40.611786+00	pressure	low	2.4	2.79950788400002	bar	auto-flagged by SPC	2026-04-02 02:33:10.829543+00	\N
246	229	4	2026-04-03 14:27:41.587054+00	alignment	critical	0.0	-0.918	mm	\N	2026-04-03 19:05:25.052671+00	\N
247	230	6	2026-03-20 00:32:24.726104+00	other	critical	\N	\N	\N	auto-flagged by SPC	\N	\N
248	231	10	2026-04-15 10:05:54.27279+00	alignment	medium	0.0	0.520	mm	\N	2026-04-15 12:13:37.964174+00	\N
249	232	3	2026-05-02 17:18:56.546751+00	vibration	low	0.5	0.645197253374897	mm/s	\N	2026-05-02 23:05:56.634199+00	\N
250	232	3	2026-05-02 16:38:49.344494+00	contamination	low	\N	\N	\N	auto-flagged by SPC	2026-05-02 21:29:31.236651+00	\N
251	233	4	2026-04-09 23:09:15.82741+00	alignment	medium	0.0	-0.534	mm	operator note: investigating	2026-04-10 04:13:40.379296+00	\N
252	234	7	2026-04-27 08:06:51.813049+00	vibration	low	0.5	1.69969903857531	mm/s	auto-flagged by SPC	2026-04-27 10:53:37.437332+00	\N
253	235	8	2026-03-23 14:44:34.376504+00	alignment	medium	0.0	-0.978	mm	auto-flagged by SPC	2026-03-23 17:57:19.68971+00	\N
254	235	8	2026-03-23 16:15:00.269938+00	vibration	critical	0.5	0.913892648423936	mm/s	operator note: investigating	2026-03-23 18:40:32.236724+00	\N
255	237	5	2026-05-12 10:05:38.48081+00	pressure	low	2.4	2.10578996629527	bar	auto-flagged by SPC	2026-05-12 12:23:21.721217+00	\N
256	238	7	2026-03-27 14:26:54.362864+00	contamination	low	\N	\N	\N	\N	2026-03-27 22:33:07.395475+00	\N
257	240	3	2026-04-23 09:41:44.775375+00	pressure	critical	2.4	2.81146061067662	bar	operator note: investigating	2026-04-23 14:20:45.522792+00	\N
258	242	6	2026-04-09 03:36:54.711421+00	vibration	critical	0.5	1.32630054026991	mm/s	operator note: investigating	\N	\N
259	243	10	2026-03-21 08:18:13.025604+00	pressure	medium	2.4	2.42290793755673	bar	\N	2026-03-21 10:14:00.790129+00	\N
260	244	1	2026-04-06 14:38:38.46169+00	alignment	critical	0.0	-0.394	mm	auto-flagged by SPC	\N	\N
261	245	5	2026-04-27 02:41:17.394488+00	pressure	low	2.4	2.87447686596491	bar	auto-flagged by SPC	2026-04-27 06:42:44.231886+00	\N
262	246	7	2026-04-29 07:31:13.128715+00	pressure	critical	2.4	2.60089293277333	bar	auto-flagged by SPC	2026-04-29 09:25:18.785515+00	\N
263	246	7	2026-04-29 06:30:08.298032+00	other	medium	\N	\N	\N	operator note: investigating	2026-04-29 08:57:27.21811+00	\N
264	247	10	2026-04-11 16:05:26.892672+00	contamination	medium	\N	\N	\N	operator note: investigating	2026-04-11 17:03:05.547048+00	\N
265	249	5	2026-05-07 07:04:41.802178+00	pressure	low	2.4	2.31550461288132	bar	\N	2026-05-07 12:27:07.611479+00	\N
266	250	6	2026-04-30 14:53:39.112463+00	vibration	high	0.5	1.20183068045506	mm/s	operator note: investigating	\N	\N
465	431	9	2026-05-07 00:24:38.910029+00	temperature	medium	72.0	69.2872178428287	C	auto-flagged by SPC	2026-05-07 04:11:04.261865+00	\N
267	251	8	2026-04-09 00:32:21.842115+00	vibration	medium	0.5	1.45604123881919	mm/s	operator note: investigating	2026-04-09 04:05:08.775166+00	\N
268	252	2	2026-03-26 06:27:23.745431+00	alignment	low	0.0	0.516	mm	\N	2026-03-26 09:52:44.246583+00	\N
269	253	4	2026-05-08 14:58:25.22936+00	pressure	low	2.4	2.44617733862075	bar	auto-flagged by SPC	2026-05-08 20:05:06.099612+00	\N
270	256	2	2026-04-13 17:19:53.712465+00	pressure	low	2.4	2.80816054833392	bar	\N	2026-04-13 21:22:50.467273+00	\N
271	257	4	2026-04-10 22:39:54.073807+00	pressure	high	2.4	2.73130243560784	bar	auto-flagged by SPC	\N	\N
272	258	6	2026-04-19 07:08:08.658062+00	pressure	medium	2.4	2.41421784872484	bar	\N	2026-04-19 11:14:34.202688+00	\N
273	258	6	2026-04-19 08:04:59.503868+00	alignment	medium	0.0	0.407	mm	\N	2026-04-19 11:05:19.930292+00	\N
274	259	10	2026-05-02 17:59:02.256898+00	pressure	low	2.4	2.35781894861774	bar	\N	2026-05-02 20:05:57.691642+00	\N
275	260	2	2026-03-29 00:40:21.379481+00	alignment	critical	0.0	-0.027	mm	\N	2026-03-29 02:01:30.793811+00	\N
276	261	5	2026-05-14 10:43:05.316215+00	temperature	medium	72.0	75.789055405344	C	auto-flagged by SPC	2026-05-14 15:09:51.070557+00	\N
277	261	5	2026-05-14 09:58:15.521544+00	temperature	low	72.0	71.6173161330171	C	\N	2026-05-14 14:45:43.410824+00	\N
278	262	6	2026-05-02 19:24:46.998244+00	vibration	critical	0.5	0.766788088847312	mm/s	auto-flagged by SPC	2026-05-02 22:25:34.304484+00	\N
279	263	8	2026-04-26 23:27:10.879639+00	pressure	low	2.4	2.36393918851631	bar	auto-flagged by SPC	2026-04-27 03:04:25.876687+00	\N
280	264	2	2026-03-24 07:26:29.334243+00	temperature	low	72.0	78.6657751979521	C	operator note: investigating	2026-03-24 15:30:21.407844+00	\N
281	264	1	2026-03-24 08:28:42.62404+00	contamination	low	\N	\N	\N	operator note: investigating	2026-03-24 14:31:16.088927+00	\N
282	265	5	2026-04-11 14:41:15.26649+00	alignment	low	0.0	0.410	mm	\N	2026-04-11 17:28:32.93249+00	\N
283	267	9	2026-04-04 06:25:57.870019+00	contamination	medium	\N	\N	\N	operator note: investigating	2026-04-04 07:57:11.268207+00	\N
284	268	3	2026-03-19 15:46:26.406689+00	other	low	\N	\N	\N	\N	2026-03-19 16:55:48.376938+00	\N
285	268	3	2026-03-19 14:57:05.891231+00	alignment	high	0.0	0.474	mm	operator note: investigating	2026-03-19 17:35:56.414982+00	\N
286	268	1	2026-03-19 15:21:05.117018+00	temperature	low	72.0	68.3750834017559	C	auto-flagged by SPC	2026-03-19 17:27:47.90295+00	\N
287	269	5	2026-04-27 23:27:15.724001+00	alignment	critical	0.0	-0.925	mm	auto-flagged by SPC	2026-04-28 05:34:12.745239+00	\N
288	269	4	2026-04-28 00:55:23.175813+00	temperature	medium	72.0	69.2743290221065	C	auto-flagged by SPC	2026-04-28 05:38:23.073922+00	\N
289	270	7	2026-04-29 09:02:56.045615+00	alignment	critical	0.0	0.911	mm	auto-flagged by SPC	2026-04-29 14:55:28.576237+00	\N
290	270	7	2026-04-29 10:54:31.941739+00	contamination	low	\N	\N	\N	operator note: investigating	2026-04-29 13:48:08.819805+00	\N
291	271	8	2026-05-10 19:54:34.510785+00	alignment	low	0.0	0.881	mm	operator note: investigating	2026-05-10 23:29:02.863414+00	\N
292	271	8	2026-05-10 18:41:32.41598+00	vibration	low	0.5	1.67720942034929	mm/s	\N	2026-05-10 22:02:47.159933+00	\N
293	272	3	2026-04-29 23:16:58.489051+00	contamination	low	\N	\N	\N	operator note: investigating	2026-04-30 04:20:54.271121+00	\N
294	272	1	2026-04-29 22:24:52.533468+00	temperature	medium	72.0	73.1690140570765	C	operator note: investigating	2026-04-30 04:23:38.470278+00	\N
295	273	5	2026-04-24 09:30:00.702671+00	temperature	medium	72.0	74.6419846009091	C	\N	2026-04-24 10:45:50.006652+00	\N
296	273	4	2026-04-24 07:16:13.825899+00	vibration	medium	0.5	1.59176080991615	mm/s	auto-flagged by SPC	2026-04-24 11:35:27.086308+00	\N
297	274	7	2026-03-25 15:57:43.503135+00	vibration	medium	0.5	0.762449575109973	mm/s	\N	2026-03-25 20:27:17.084305+00	\N
298	275	8	2026-05-10 02:06:32.720283+00	temperature	critical	72.0	70.2545326573877	C	operator note: investigating	2026-05-10 04:40:21.331188+00	\N
299	277	4	2026-03-20 20:52:19.714678+00	alignment	medium	0.0	0.205	mm	\N	2026-03-20 21:06:45.410911+00	\N
300	278	6	2026-03-21 23:46:42.627411+00	alignment	medium	0.0	0.790	mm	operator note: investigating	2026-03-22 01:47:40.211313+00	\N
301	279	10	2026-03-25 07:51:48.686598+00	contamination	low	\N	\N	\N	auto-flagged by SPC	2026-03-25 09:29:10.140666+00	\N
302	280	2	2026-04-20 14:30:32.192106+00	contamination	low	\N	\N	\N	auto-flagged by SPC	2026-04-20 17:50:01.820604+00	\N
303	281	5	2026-04-01 04:21:38.030876+00	vibration	low	0.5	0.976976784568675	mm/s	operator note: investigating	2026-04-01 06:46:05.598081+00	\N
304	281	4	2026-03-31 23:45:26.683159+00	contamination	low	\N	\N	\N	\N	2026-04-01 05:11:38.881287+00	\N
305	284	1	2026-04-23 22:33:34.922553+00	alignment	low	0.0	0.895	mm	\N	2026-04-24 01:43:45.328147+00	\N
306	285	4	2026-04-07 07:11:44.202631+00	alignment	medium	0.0	-0.293	mm	auto-flagged by SPC	2026-04-07 10:44:01.386431+00	\N
307	287	9	2026-03-28 23:48:28.524366+00	pressure	high	2.4	2.75491202665227	bar	operator note: investigating	\N	\N
308	287	9	2026-03-29 01:10:47.589236+00	temperature	medium	72.0	78.6950601998469	C	\N	2026-03-29 02:27:52.178344+00	\N
309	290	6	2026-05-15 23:44:00.498724+00	other	low	\N	\N	\N	\N	2026-05-16 02:56:18.05163+00	\N
310	290	6	2026-05-15 22:45:17.609771+00	vibration	low	0.5	0.617343966582723	mm/s	operator note: investigating	2026-05-16 02:41:28.339986+00	\N
311	293	4	2026-03-24 23:23:14.306745+00	contamination	low	\N	\N	\N	\N	2026-03-25 02:11:02.906865+00	\N
312	293	4	2026-03-24 22:54:21.301239+00	alignment	medium	0.0	-0.752	mm	\N	2026-03-25 01:17:09.766406+00	\N
313	294	7	2026-04-05 06:12:57.859828+00	vibration	critical	0.5	1.55198242240817	mm/s	\N	\N	\N
314	296	3	2026-05-07 23:33:37.431135+00	pressure	low	2.4	2.89311971191097	bar	\N	2026-05-08 01:45:03.866963+00	\N
315	297	5	2026-04-13 06:30:03.197986+00	contamination	low	\N	\N	\N	operator note: investigating	2026-04-13 12:56:55.416289+00	\N
316	298	6	2026-04-02 18:04:59.462941+00	contamination	medium	\N	\N	\N	operator note: investigating	2026-04-02 22:22:14.69695+00	\N
317	299	10	2026-05-08 02:06:10.525809+00	temperature	critical	72.0	68.3528044941013	C	operator note: investigating	2026-05-08 04:19:20.356996+00	\N
318	299	10	2026-05-07 23:00:08.831535+00	other	low	\N	\N	\N	auto-flagged by SPC	2026-05-08 05:06:30.57472+00	\N
319	300	1	2026-03-19 07:23:36.985543+00	temperature	high	72.0	74.1432111809573	C	operator note: investigating	2026-03-19 10:53:44.068538+00	\N
320	302	7	2026-03-27 23:30:36.487019+00	pressure	low	2.4	2.89009022150346	bar	auto-flagged by SPC	2026-03-28 04:52:53.991962+00	\N
321	303	8	2026-03-20 11:01:32.624775+00	pressure	medium	2.4	2.35823065255165	bar	operator note: investigating	2026-03-20 13:26:51.754949+00	\N
322	304	2	2026-05-13 14:55:28.492375+00	alignment	critical	0.0	-0.626	mm	operator note: investigating	2026-05-13 17:09:03.418169+00	\N
323	305	4	2026-04-16 03:16:35.87758+00	pressure	high	2.4	2.3698050452375	bar	operator note: investigating	2026-04-16 05:51:08.227561+00	\N
324	306	6	2026-04-11 10:55:03.631555+00	other	critical	\N	\N	\N	\N	2026-04-11 11:57:50.841185+00	\N
325	306	7	2026-04-11 06:36:18.961988+00	vibration	low	0.5	1.27031256887516	mm/s	operator note: investigating	2026-04-11 12:11:51.202218+00	\N
326	307	9	2026-04-15 14:14:15.37153+00	contamination	medium	\N	\N	\N	auto-flagged by SPC	2026-04-15 22:45:16.113809+00	\N
327	307	9	2026-04-15 21:18:39.378608+00	temperature	high	72.0	78.7805232913942	C	auto-flagged by SPC	\N	\N
328	309	4	2026-04-28 11:20:17.020987+00	contamination	medium	\N	\N	\N	\N	2026-04-28 12:05:59.431844+00	\N
329	310	7	2026-04-12 14:58:29.160092+00	alignment	low	0.0	0.236	mm	\N	2026-04-12 18:19:33.041289+00	\N
330	311	9	2026-03-18 22:34:26.876081+00	vibration	medium	0.5	0.67539597834354	mm/s	operator note: investigating	2026-03-19 00:53:11.125397+00	\N
331	311	9	2026-03-18 22:29:15.917974+00	other	medium	\N	\N	\N	auto-flagged by SPC	2026-03-18 23:19:22.537686+00	\N
332	311	10	2026-03-18 22:16:01.80324+00	pressure	low	2.4	2.3966362920877	bar	\N	2026-03-18 23:43:51.551905+00	\N
533	497	5	2026-05-11 22:53:09.31552+00	contamination	critical	\N	\N	\N	\N	\N	\N
333	312	2	2026-03-19 09:13:24.327319+00	temperature	low	72.0	74.2719398988017	C	operator note: investigating	2026-03-19 12:22:13.960024+00	\N
334	313	4	2026-03-23 15:47:45.669389+00	other	critical	\N	\N	\N	operator note: investigating	2026-03-23 19:54:38.174468+00	\N
335	314	7	2026-03-30 00:13:28.173738+00	pressure	low	2.4	2.35676451940493	bar	operator note: investigating	2026-03-30 03:53:17.018561+00	\N
336	315	10	2026-05-08 06:47:22.046325+00	pressure	medium	2.4	2.69653867199499	bar	\N	2026-05-08 12:22:42.580899+00	\N
337	316	1	2026-05-11 20:51:10.047593+00	vibration	low	0.5	1.38536005984005	mm/s	operator note: investigating	2026-05-11 22:32:11.35419+00	\N
338	316	2	2026-05-11 18:49:00.648857+00	contamination	medium	\N	\N	\N	\N	2026-05-11 23:17:48.273415+00	\N
339	317	5	2026-05-17 00:16:25.758518+00	other	low	\N	\N	\N	operator note: investigating	2026-05-17 05:44:31.960704+00	\N
340	318	6	2026-05-10 08:38:09.174389+00	pressure	critical	2.4	2.66925592236672	bar	operator note: investigating	2026-05-10 11:32:33.557058+00	\N
341	319	9	2026-04-19 15:48:07.271239+00	vibration	low	0.5	1.60959888512244	mm/s	\N	2026-04-19 17:16:43.171543+00	\N
342	320	2	2026-03-20 00:38:32.545808+00	vibration	medium	0.5	1.12146302483557	mm/s	\N	2026-03-20 01:38:52.270054+00	\N
343	321	5	2026-03-26 06:38:00.703006+00	alignment	low	0.0	-0.355	mm	auto-flagged by SPC	2026-03-26 15:12:32.590031+00	\N
344	322	6	2026-03-17 16:01:41.654724+00	pressure	low	2.4	2.28921225758957	bar	operator note: investigating	2026-03-17 17:47:59.58175+00	\N
345	323	10	2026-04-10 23:49:37.819711+00	vibration	critical	0.5	0.564001106490147	mm/s	operator note: investigating	\N	\N
346	323	9	2026-04-10 22:35:53.246082+00	other	medium	\N	\N	\N	operator note: investigating	2026-04-11 05:11:25.279325+00	\N
347	325	4	2026-05-16 17:31:30.64051+00	vibration	low	0.5	1.1688348193135	mm/s	auto-flagged by SPC	2026-05-16 21:32:05.457283+00	\N
348	325	5	2026-05-16 14:33:16.103927+00	pressure	medium	2.4	2.10445390449453	bar	operator note: investigating	2026-05-16 21:01:42.844399+00	\N
349	326	6	2026-05-10 23:20:37.630018+00	pressure	medium	2.4	2.52526266721976	bar	operator note: investigating	2026-05-11 01:56:23.73652+00	\N
350	327	9	2026-03-18 06:08:26.875196+00	pressure	medium	2.4	2.59029359851912	bar	auto-flagged by SPC	2026-03-18 10:14:30.813384+00	\N
351	327	10	2026-03-18 07:49:38.901403+00	other	medium	\N	\N	\N	\N	2026-03-18 09:58:46.93985+00	\N
352	329	4	2026-04-08 23:22:27.169476+00	alignment	medium	0.0	0.736	mm	auto-flagged by SPC	2026-04-09 04:09:01.381127+00	\N
353	329	4	2026-04-09 00:21:00.710248+00	vibration	low	0.5	1.48432143422397	mm/s	auto-flagged by SPC	2026-04-09 04:46:53.327025+00	\N
354	331	8	2026-03-27 17:07:12.191268+00	alignment	low	0.0	0.515	mm	operator note: investigating	2026-03-27 18:16:53.478652+00	\N
355	331	8	2026-03-27 16:44:28.929068+00	vibration	medium	0.5	0.978654141692943	mm/s	\N	2026-03-27 18:40:51.599642+00	\N
356	332	1	2026-03-28 22:50:13.860146+00	temperature	medium	72.0	74.1578951353064	C	\N	2026-03-28 23:49:35.642355+00	\N
357	332	1	2026-03-28 22:54:26.82815+00	pressure	critical	2.4	2.81168306006037	bar	auto-flagged by SPC	2026-03-29 00:01:15.167667+00	\N
358	333	5	2026-04-24 06:18:57.480285+00	contamination	medium	\N	\N	\N	\N	2026-04-24 10:31:49.665262+00	\N
359	334	7	2026-04-09 14:09:57.502028+00	other	critical	\N	\N	\N	auto-flagged by SPC	2026-04-09 17:30:02.041969+00	\N
360	337	4	2026-04-02 17:17:41.859002+00	pressure	low	2.4	2.25929533513544	bar	auto-flagged by SPC	2026-04-02 19:47:18.003562+00	\N
361	340	3	2026-05-04 17:14:19.290802+00	other	low	\N	\N	\N	\N	2026-05-04 21:38:32.018492+00	\N
362	342	7	2026-05-09 06:16:46.102929+00	other	low	\N	\N	\N	\N	2026-05-09 09:19:04.054394+00	\N
363	343	8	2026-05-12 14:53:11.053961+00	temperature	low	72.0	73.473455540147	C	operator note: investigating	2026-05-12 17:24:19.862176+00	\N
364	343	10	2026-05-12 14:03:40.518792+00	pressure	high	2.4	2.26666899520571	bar	auto-flagged by SPC	2026-05-12 16:38:07.878673+00	\N
365	344	3	2026-04-03 03:13:31.746081+00	alignment	low	0.0	-0.439	mm	operator note: investigating	2026-04-03 04:30:58.363975+00	\N
366	344	2	2026-04-03 01:32:53.226511+00	alignment	critical	0.0	-0.357	mm	operator note: investigating	2026-04-03 03:46:06.226438+00	\N
367	345	5	2026-05-01 08:39:51.108249+00	other	low	\N	\N	\N	\N	2026-05-01 12:55:45.61474+00	\N
368	346	6	2026-03-26 18:20:52.037623+00	temperature	medium	72.0	76.5689732216927	C	operator note: investigating	2026-03-26 19:05:45.131217+00	\N
369	347	9	2026-05-14 01:53:38.022693+00	pressure	critical	2.4	2.86295942556889	bar	operator note: investigating	\N	\N
370	348	2	2026-04-19 07:16:25.495979+00	temperature	critical	72.0	77.3686017708226	C	auto-flagged by SPC	\N	\N
371	349	5	2026-03-30 19:25:52.046009+00	contamination	low	\N	\N	\N	auto-flagged by SPC	2026-03-30 22:09:55.860861+00	\N
372	349	5	2026-03-30 16:44:55.641404+00	other	low	\N	\N	\N	\N	2026-03-30 22:57:03.900371+00	\N
373	350	7	2026-04-10 02:53:23.803951+00	alignment	medium	0.0	-0.963	mm	auto-flagged by SPC	2026-04-10 05:33:21.704667+00	\N
374	351	8	2026-03-25 08:00:27.492524+00	alignment	medium	0.0	0.464	mm	auto-flagged by SPC	2026-03-25 12:04:53.874436+00	\N
375	352	3	2026-03-20 15:08:23.185614+00	contamination	low	\N	\N	\N	auto-flagged by SPC	2026-03-20 19:10:36.73117+00	\N
376	352	3	2026-03-20 14:46:41.31291+00	alignment	high	0.0	0.882	mm	auto-flagged by SPC	2026-03-20 19:22:23.460543+00	\N
377	354	7	2026-04-16 08:30:11.227521+00	alignment	low	0.0	-0.887	mm	operator note: investigating	2026-04-16 12:07:23.04896+00	\N
378	354	7	2026-04-16 10:02:07.385186+00	vibration	low	0.5	1.18258140850133	mm/s	auto-flagged by SPC	2026-04-16 11:14:17.588084+00	\N
379	355	8	2026-04-18 20:25:11.07741+00	temperature	low	72.0	78.625583616274	C	auto-flagged by SPC	2026-04-18 21:37:57.804884+00	\N
380	355	8	2026-04-18 16:25:54.904315+00	alignment	low	0.0	-0.412	mm	auto-flagged by SPC	2026-04-18 21:01:12.298132+00	\N
381	356	2	2026-04-29 22:51:59.530621+00	pressure	low	2.4	2.45604087287806	bar	auto-flagged by SPC	2026-04-30 01:06:48.463938+00	\N
382	357	5	2026-04-29 09:13:01.986514+00	alignment	medium	0.0	0.487	mm	auto-flagged by SPC	2026-04-29 10:47:30.783078+00	\N
383	357	5	2026-04-29 09:24:15.568136+00	vibration	low	0.5	1.29926584325518	mm/s	\N	2026-04-29 10:07:41.277584+00	\N
384	358	6	2026-04-04 17:23:15.661717+00	temperature	critical	72.0	70.423723082784	C	operator note: investigating	\N	\N
385	358	7	2026-04-04 18:21:14.932353+00	other	medium	\N	\N	\N	auto-flagged by SPC	2026-04-04 21:17:56.055854+00	\N
386	359	10	2026-05-05 03:14:53.442967+00	pressure	low	2.4	2.60772944771935	bar	\N	2026-05-05 07:09:21.529563+00	\N
387	359	8	2026-05-05 01:49:28.784779+00	alignment	medium	0.0	-0.004	mm	auto-flagged by SPC	2026-05-05 05:42:27.586172+00	\N
388	361	4	2026-04-23 17:29:22.068128+00	temperature	medium	72.0	75.9454141741707	C	\N	2026-04-23 20:00:00.425722+00	\N
389	361	5	2026-04-23 15:41:14.092761+00	pressure	low	2.4	2.30074459653648	bar	auto-flagged by SPC	2026-04-23 19:27:11.603063+00	\N
390	362	7	2026-05-15 23:41:50.619286+00	pressure	high	2.4	2.63752570952862	bar	\N	2026-05-16 00:38:06.003332+00	\N
391	363	9	2026-03-18 08:37:05.170783+00	alignment	high	0.0	-0.009	mm	operator note: investigating	2026-03-18 14:23:35.979886+00	\N
392	363	10	2026-03-18 12:10:02.469547+00	vibration	medium	0.5	0.903576938323304	mm/s	auto-flagged by SPC	2026-03-18 13:13:58.30698+00	\N
393	364	2	2026-03-22 15:57:02.017476+00	alignment	low	0.0	0.505	mm	\N	2026-03-22 18:19:43.773074+00	\N
394	364	2	2026-03-22 15:15:29.926645+00	alignment	low	0.0	-0.359	mm	operator note: investigating	2026-03-22 18:41:14.155279+00	\N
395	365	4	2026-05-12 00:09:50.573835+00	temperature	low	72.0	72.8766510200915	C	auto-flagged by SPC	2026-05-12 03:21:16.698649+00	\N
396	366	6	2026-03-26 07:04:40.386577+00	temperature	low	72.0	70.1899134013032	C	\N	2026-03-26 08:22:45.448751+00	\N
397	366	6	2026-03-26 06:38:45.620997+00	vibration	medium	0.5	0.944452405506592	mm/s	operator note: investigating	2026-03-26 07:42:02.506671+00	\N
398	367	8	2026-04-13 14:24:19.060739+00	temperature	medium	72.0	72.3828675066956	C	operator note: investigating	2026-04-13 22:57:18.26488+00	\N
399	369	5	2026-04-15 07:45:32.263073+00	vibration	medium	0.5	1.54080885516831	mm/s	operator note: investigating	2026-04-15 09:54:40.18639+00	\N
400	369	5	2026-04-15 06:43:16.550323+00	alignment	high	0.0	-0.842	mm	\N	\N	\N
401	370	7	2026-03-24 16:21:45.155001+00	contamination	high	\N	\N	\N	auto-flagged by SPC	\N	\N
402	370	6	2026-03-24 15:04:02.327102+00	other	low	\N	\N	\N	auto-flagged by SPC	2026-03-24 21:39:51.85426+00	\N
403	371	8	2026-03-29 02:32:58.471855+00	vibration	low	0.5	0.979842003684068	mm/s	\N	2026-03-29 03:19:03.106488+00	\N
404	371	8	2026-03-29 02:17:09.962149+00	pressure	medium	2.4	2.22808871997192	bar	auto-flagged by SPC	2026-03-29 03:08:15.467741+00	\N
405	372	3	2026-04-08 06:51:13.745296+00	pressure	low	2.4	2.65301741573749	bar	\N	2026-04-08 09:20:56.662888+00	\N
406	373	5	2026-04-29 17:36:00.005392+00	alignment	low	0.0	0.604	mm	\N	2026-04-29 19:44:29.584967+00	\N
407	373	5	2026-04-29 18:02:09.067881+00	vibration	critical	0.5	0.515517514988127	mm/s	auto-flagged by SPC	2026-04-29 21:23:29.21334+00	\N
408	374	7	2026-04-03 22:40:50.5934+00	pressure	medium	2.4	2.71108829403905	bar	\N	2026-04-04 00:45:44.946257+00	\N
409	375	9	2026-05-03 06:35:02.486201+00	temperature	medium	72.0	74.6510300829968	C	operator note: investigating	2026-05-03 11:20:33.260038+00	\N
410	376	3	2026-05-04 15:13:36.450555+00	alignment	medium	0.0	-0.771	mm	operator note: investigating	2026-05-04 16:06:16.408623+00	\N
411	377	5	2026-05-06 22:45:28.303094+00	temperature	medium	72.0	74.8019461121896	C	operator note: investigating	2026-05-07 06:49:14.253667+00	\N
412	378	7	2026-03-21 07:56:32.811811+00	temperature	low	72.0	77.7005590882424	C	\N	2026-03-21 10:13:28.453959+00	\N
413	379	10	2026-03-19 16:20:07.963375+00	contamination	medium	\N	\N	\N	\N	2026-03-19 19:33:22.643879+00	\N
414	379	10	2026-03-19 15:56:41.975059+00	temperature	low	72.0	78.0894235695286	C	operator note: investigating	2026-03-19 19:11:05.654999+00	\N
415	380	3	2026-03-23 02:52:19.880403+00	contamination	low	\N	\N	\N	\N	2026-03-23 03:56:54.439141+00	\N
416	382	6	2026-05-08 19:05:48.113159+00	alignment	low	0.0	-0.433	mm	\N	2026-05-08 21:59:49.821259+00	\N
417	384	1	2026-05-16 06:40:57.610463+00	other	medium	\N	\N	\N	operator note: investigating	2026-05-16 11:28:52.675922+00	\N
418	384	3	2026-05-16 08:54:04.983146+00	other	low	\N	\N	\N	\N	2026-05-16 11:11:23.643251+00	\N
419	385	5	2026-03-17 15:43:28.859619+00	vibration	low	0.5	0.575177837687439	mm/s	\N	2026-03-17 19:07:57.567111+00	\N
420	386	7	2026-04-29 00:07:28.727058+00	other	high	\N	\N	\N	operator note: investigating	2026-04-29 00:50:45.964763+00	\N
421	386	6	2026-04-29 00:07:34.669992+00	contamination	medium	\N	\N	\N	operator note: investigating	2026-04-29 02:04:21.187841+00	\N
422	387	8	2026-04-16 12:23:08.512725+00	alignment	low	0.0	-0.842	mm	auto-flagged by SPC	2026-04-16 14:06:27.800813+00	\N
423	388	3	2026-04-10 15:49:54.420411+00	alignment	low	0.0	-0.074	mm	operator note: investigating	2026-04-10 22:11:15.963105+00	\N
424	389	5	2026-03-23 00:09:06.53988+00	temperature	low	72.0	70.2891856567616	C	operator note: investigating	2026-03-23 01:19:10.744648+00	\N
425	390	7	2026-05-04 11:14:53.089829+00	alignment	low	0.0	-0.112	mm	operator note: investigating	2026-05-04 13:29:38.254061+00	\N
426	391	9	2026-04-30 20:09:22.910367+00	contamination	low	\N	\N	\N	\N	2026-04-30 21:22:35.167683+00	\N
427	391	10	2026-04-30 14:16:14.917248+00	contamination	medium	\N	\N	\N	operator note: investigating	2026-04-30 21:05:31.237604+00	\N
428	392	1	2026-05-03 22:10:19.064365+00	vibration	medium	0.5	1.51539834781325	mm/s	\N	2026-05-04 01:16:11.307938+00	\N
429	393	4	2026-04-05 06:25:52.211208+00	pressure	high	2.4	2.24740514381626	bar	auto-flagged by SPC	\N	\N
430	395	9	2026-04-23 00:00:52.396617+00	vibration	critical	0.5	0.93536574806172	mm/s	operator note: investigating	2026-04-23 02:48:10.14975+00	\N
431	398	7	2026-04-28 23:09:33.945+00	pressure	medium	2.4	2.33884833694645	bar	operator note: investigating	2026-04-29 06:56:04.908378+00	\N
432	400	2	2026-03-28 16:12:25.597494+00	pressure	medium	2.4	2.62719881486026	bar	operator note: investigating	2026-03-28 19:46:40.74564+00	\N
433	401	5	2026-03-27 23:51:26.233844+00	contamination	low	\N	\N	\N	auto-flagged by SPC	2026-03-28 01:10:00.58529+00	\N
434	402	7	2026-04-23 06:28:00.630938+00	pressure	low	2.4	2.84932293995711	bar	\N	2026-04-23 14:36:26.793317+00	\N
435	402	7	2026-04-23 11:38:21.210796+00	contamination	medium	\N	\N	\N	\N	2026-04-23 14:19:55.231436+00	\N
436	403	10	2026-03-23 15:45:40.248698+00	vibration	critical	0.5	0.640938746805672	mm/s	operator note: investigating	\N	\N
437	404	1	2026-04-26 23:46:08.970848+00	alignment	low	0.0	0.989	mm	auto-flagged by SPC	2026-04-27 00:27:09.972006+00	\N
438	408	1	2026-03-29 06:32:11.015401+00	alignment	low	0.0	0.829	mm	operator note: investigating	2026-03-29 09:16:28.954233+00	\N
439	409	4	2026-04-30 14:38:24.991966+00	vibration	medium	0.5	1.27432946741966	mm/s	operator note: investigating	2026-04-30 18:56:04.917599+00	\N
440	409	5	2026-04-30 15:46:50.864908+00	vibration	low	0.5	1.11505650449781	mm/s	operator note: investigating	2026-04-30 19:20:20.145868+00	\N
441	411	10	2026-04-24 06:39:14.675723+00	vibration	medium	0.5	0.635728005422369	mm/s	operator note: investigating	2026-04-24 10:46:28.364876+00	\N
442	412	3	2026-04-06 17:56:32.499552+00	pressure	low	2.4	2.5373599296267	bar	operator note: investigating	2026-04-06 21:52:40.417853+00	\N
443	413	5	2026-03-25 22:42:17.576613+00	pressure	medium	2.4	2.72364160145149	bar	\N	2026-03-26 00:10:38.407819+00	\N
444	413	5	2026-03-25 22:54:39.508262+00	alignment	low	0.0	0.459	mm	auto-flagged by SPC	2026-03-26 00:23:46.502169+00	\N
445	414	6	2026-04-19 06:26:19.716864+00	temperature	high	72.0	71.2259404228189	C	auto-flagged by SPC	2026-04-19 08:11:04.016141+00	\N
446	414	6	2026-04-19 06:39:35.703267+00	temperature	high	72.0	77.1905291691107	C	operator note: investigating	2026-04-19 07:52:10.008899+00	\N
447	414	6	2026-04-19 06:31:18.370075+00	contamination	high	\N	\N	\N	operator note: investigating	2026-04-19 07:38:19.502405+00	\N
448	416	3	2026-03-29 01:43:57.193516+00	pressure	low	2.4	2.88785970707649	bar	auto-flagged by SPC	2026-03-29 05:00:04.651645+00	\N
449	416	3	2026-03-28 23:24:34.923907+00	alignment	medium	0.0	-0.663	mm	\N	2026-03-29 05:00:20.989305+00	\N
450	417	4	2026-04-28 06:43:36.815758+00	contamination	high	\N	\N	\N	operator note: investigating	2026-04-28 11:03:52.634095+00	\N
451	417	5	2026-04-28 07:53:08.846372+00	pressure	low	2.4	2.75974448790467	bar	\N	2026-04-28 10:23:04.741743+00	\N
452	419	8	2026-04-27 23:47:00.456024+00	temperature	low	72.0	78.3424709132724	C	\N	2026-04-27 23:59:05.705766+00	\N
453	419	10	2026-04-27 23:03:57.114363+00	contamination	low	\N	\N	\N	\N	2026-04-28 01:40:39.308912+00	\N
454	421	5	2026-05-02 17:06:28.497414+00	temperature	medium	72.0	77.4115047115481	C	auto-flagged by SPC	2026-05-02 21:15:45.501667+00	\N
455	421	5	2026-05-02 15:04:39.005249+00	temperature	critical	72.0	78.3318758548275	C	operator note: investigating	2026-05-02 20:50:20.387816+00	\N
456	423	9	2026-04-20 09:10:30.861124+00	contamination	medium	\N	\N	\N	operator note: investigating	2026-04-20 14:43:17.619211+00	\N
457	423	10	2026-04-20 13:01:20.578809+00	vibration	medium	0.5	0.781775625947506	mm/s	operator note: investigating	2026-04-20 13:20:03.034643+00	\N
458	424	3	2026-03-20 15:47:50.740554+00	pressure	low	2.4	2.4334731615011	bar	auto-flagged by SPC	2026-03-20 17:23:52.417942+00	\N
459	424	3	2026-03-20 16:16:14.673816+00	pressure	low	2.4	2.23921080154643	bar	operator note: investigating	2026-03-20 17:25:46.354754+00	\N
460	426	6	2026-04-20 06:42:33.195946+00	alignment	low	0.0	0.529	mm	auto-flagged by SPC	2026-04-20 09:09:48.092799+00	\N
461	428	3	2026-03-30 02:01:44.835095+00	alignment	high	0.0	-0.117	mm	\N	2026-03-30 04:53:29.327027+00	\N
462	429	4	2026-05-13 11:50:25.737244+00	alignment	low	0.0	0.437	mm	\N	2026-05-13 13:27:25.14801+00	\N
463	430	6	2026-04-30 14:27:37.488327+00	contamination	critical	\N	\N	\N	\N	2026-04-30 17:22:48.440028+00	\N
464	431	9	2026-05-06 23:42:06.196055+00	pressure	high	2.4	2.66717957963946	bar	operator note: investigating	\N	\N
466	432	3	2026-03-21 08:03:42.71713+00	alignment	critical	0.0	0.537	mm	auto-flagged by SPC	2026-03-21 10:32:11.939426+00	\N
467	433	5	2026-05-06 14:41:44.500692+00	pressure	low	2.4	2.58739174189978	bar	operator note: investigating	2026-05-06 17:50:09.744872+00	\N
468	433	4	2026-05-06 14:54:04.354784+00	pressure	low	2.4	2.65684377283246	bar	auto-flagged by SPC	2026-05-06 18:26:08.526035+00	\N
469	434	7	2026-04-21 04:10:04.08009+00	alignment	high	0.0	-0.869	mm	\N	\N	\N
470	435	10	2026-05-03 06:39:43.802106+00	contamination	high	\N	\N	\N	\N	2026-05-03 09:09:20.289372+00	\N
471	435	8	2026-05-03 06:35:36.304907+00	temperature	high	72.0	79.9138389430024	C	operator note: investigating	2026-05-03 08:49:53.176714+00	\N
472	436	3	2026-04-05 17:06:29.405433+00	other	critical	\N	\N	\N	auto-flagged by SPC	2026-04-05 19:57:37.870531+00	\N
473	437	4	2026-04-19 00:59:12.050918+00	temperature	low	72.0	77.1852467751648	C	operator note: investigating	2026-04-19 02:24:25.071804+00	\N
474	438	6	2026-04-18 09:33:27.667408+00	pressure	medium	2.4	2.70921162446703	bar	auto-flagged by SPC	2026-04-18 10:49:24.950284+00	\N
475	439	9	2026-04-17 15:28:46.951936+00	vibration	low	0.5	0.755641466941864	mm/s	operator note: investigating	2026-04-17 21:01:27.189496+00	\N
476	439	9	2026-04-17 15:42:19.01247+00	alignment	low	0.0	-0.908	mm	\N	2026-04-17 22:37:11.124159+00	\N
477	440	3	2026-05-15 23:50:23.221603+00	pressure	high	2.4	2.51121853630036	bar	operator note: investigating	2026-05-16 01:00:22.725215+00	\N
478	441	5	2026-04-14 07:36:36.202781+00	other	critical	\N	\N	\N	\N	\N	\N
479	443	9	2026-04-08 01:59:03.75986+00	vibration	low	0.5	1.63681622264856	mm/s	operator note: investigating	2026-04-08 03:45:27.900568+00	\N
480	445	4	2026-04-17 16:15:27.501037+00	pressure	medium	2.4	2.53113223943801	bar	operator note: investigating	2026-04-17 20:35:58.251044+00	\N
481	446	6	2026-05-13 00:41:57.584989+00	alignment	low	0.0	0.340	mm	\N	2026-05-13 02:10:40.834949+00	\N
482	449	4	2026-05-08 22:34:27.938975+00	pressure	critical	2.4	2.83589211755285	bar	\N	2026-05-08 22:48:12.006987+00	\N
483	449	4	2026-05-08 22:25:29.933035+00	other	low	\N	\N	\N	operator note: investigating	2026-05-08 22:54:23.423989+00	\N
484	449	5	2026-05-08 22:24:17.707951+00	pressure	low	2.4	2.3539798523092	bar	\N	2026-05-08 23:11:52.168439+00	\N
485	450	7	2026-05-15 06:47:02.392594+00	pressure	low	2.4	2.13080561193132	bar	operator note: investigating	2026-05-15 09:57:33.846128+00	\N
486	451	8	2026-04-15 16:41:02.256319+00	alignment	medium	0.0	0.363	mm	auto-flagged by SPC	2026-04-15 17:48:48.069517+00	\N
487	452	1	2026-05-05 01:19:40.017352+00	contamination	medium	\N	\N	\N	operator note: investigating	2026-05-05 04:00:37.530887+00	\N
488	453	5	2026-04-17 08:08:29.938085+00	pressure	critical	2.4	2.4104877722547	bar	auto-flagged by SPC	2026-04-17 13:26:17.935383+00	\N
489	456	2	2026-04-28 07:17:24.450677+00	pressure	high	2.4	2.69715392287404	bar	operator note: investigating	\N	\N
490	457	4	2026-04-12 14:58:04.008306+00	pressure	low	2.4	2.2453289586374	bar	\N	2026-04-12 17:31:13.394467+00	\N
491	458	7	2026-04-05 01:08:57.801714+00	other	high	\N	\N	\N	auto-flagged by SPC	2026-04-05 03:06:04.009582+00	\N
492	458	6	2026-04-05 00:34:21.550596+00	pressure	medium	2.4	2.53232985335994	bar	auto-flagged by SPC	2026-04-05 02:45:46.307067+00	\N
493	459	9	2026-04-30 06:55:46.566699+00	alignment	critical	0.0	-0.829	mm	\N	2026-04-30 13:27:36.425433+00	\N
494	459	8	2026-04-30 11:52:16.525817+00	pressure	critical	2.4	2.81392354249126	bar	operator note: investigating	2026-04-30 13:21:35.391923+00	\N
495	461	4	2026-04-09 22:58:27.074931+00	temperature	low	72.0	78.2731122399634	C	auto-flagged by SPC	2026-04-10 00:09:29.677253+00	\N
496	461	5	2026-04-09 22:56:51.076447+00	temperature	low	72.0	68.5166738838491	C	\N	2026-04-10 00:56:43.938781+00	\N
497	462	6	2026-05-01 06:07:20.533382+00	contamination	low	\N	\N	\N	auto-flagged by SPC	2026-05-01 13:16:21.264337+00	\N
498	464	2	2026-04-09 23:25:15.798412+00	alignment	low	0.0	0.727	mm	\N	2026-04-10 01:53:56.220197+00	\N
499	464	3	2026-04-10 00:48:10.675318+00	pressure	low	2.4	2.82322362029225	bar	operator note: investigating	2026-04-10 01:45:43.360662+00	\N
500	465	4	2026-03-27 07:08:38.293386+00	pressure	high	2.4	2.14140254644891	bar	operator note: investigating	\N	\N
501	469	5	2026-05-03 15:15:37.474793+00	pressure	medium	2.4	2.48716258880043	bar	auto-flagged by SPC	2026-05-03 17:15:28.272281+00	\N
502	470	7	2026-03-22 22:53:57.212204+00	contamination	medium	\N	\N	\N	\N	2026-03-22 23:22:32.344171+00	\N
503	470	7	2026-03-22 22:52:08.025929+00	alignment	medium	0.0	-0.408	mm	auto-flagged by SPC	2026-03-22 23:14:16.83983+00	\N
504	470	6	2026-03-22 22:28:53.197566+00	contamination	medium	\N	\N	\N	operator note: investigating	2026-03-23 00:01:10.762493+00	\N
505	472	3	2026-04-17 15:52:46.764714+00	temperature	high	72.0	75.9392247512405	C	auto-flagged by SPC	\N	\N
506	474	7	2026-04-02 09:16:40.086632+00	temperature	low	72.0	77.865986804032	C	auto-flagged by SPC	2026-04-02 12:10:29.396655+00	\N
507	474	6	2026-04-02 10:12:43.512511+00	vibration	high	0.5	1.64232278536463	mm/s	\N	2026-04-02 10:55:13.274672+00	\N
508	476	2	2026-04-06 23:08:41.276749+00	other	medium	\N	\N	\N	\N	2026-04-07 02:38:51.203672+00	\N
509	477	4	2026-03-29 08:20:56.61094+00	contamination	medium	\N	\N	\N	auto-flagged by SPC	2026-03-29 13:49:14.881376+00	\N
510	478	7	2026-03-28 14:45:26.462856+00	alignment	low	0.0	0.536	mm	auto-flagged by SPC	2026-03-28 16:54:18.13358+00	\N
511	478	6	2026-03-28 14:36:03.10917+00	pressure	low	2.4	2.88811276850272	bar	\N	2026-03-28 15:11:12.97126+00	\N
512	479	10	2026-04-22 04:11:31.192639+00	other	low	\N	\N	\N	auto-flagged by SPC	2026-04-22 04:57:02.632663+00	\N
513	481	4	2026-04-30 18:03:06.334135+00	vibration	medium	0.5	1.44439788288001	mm/s	operator note: investigating	2026-04-30 20:17:00.365619+00	\N
514	482	6	2026-05-13 00:03:24.81407+00	other	critical	\N	\N	\N	\N	2026-05-13 03:27:33.96566+00	\N
515	484	2	2026-04-11 16:58:14.558324+00	other	low	\N	\N	\N	\N	2026-04-11 20:25:02.27677+00	\N
516	484	3	2026-04-11 15:58:14.104741+00	vibration	low	0.5	1.34876581147784	mm/s	auto-flagged by SPC	2026-04-11 21:10:06.425541+00	\N
517	485	5	2026-03-19 23:43:33.884626+00	other	low	\N	\N	\N	auto-flagged by SPC	2026-03-20 05:08:43.781135+00	\N
518	485	4	2026-03-20 01:48:27.477367+00	temperature	low	72.0	75.681465163249	C	\N	2026-03-20 05:40:21.309643+00	\N
519	486	6	2026-03-23 09:26:32.439948+00	other	high	\N	\N	\N	auto-flagged by SPC	\N	\N
520	487	10	2026-03-27 14:03:29.767517+00	vibration	low	0.5	1.38377417378916	mm/s	\N	2026-03-27 18:17:36.889861+00	\N
521	488	2	2026-04-08 22:30:48.942176+00	alignment	high	0.0	0.081	mm	auto-flagged by SPC	2026-04-09 02:13:36.805866+00	\N
522	489	4	2026-03-17 06:28:04.182167+00	pressure	low	2.4	2.8660480976783	bar	\N	2026-03-17 10:38:44.60047+00	\N
523	490	6	2026-03-19 18:07:04.74195+00	pressure	critical	2.4	2.78038866911748	bar	auto-flagged by SPC	\N	\N
524	491	8	2026-04-06 01:42:02.779381+00	other	critical	\N	\N	\N	auto-flagged by SPC	\N	\N
525	492	2	2026-04-13 06:46:22.166663+00	alignment	high	0.0	0.606	mm	auto-flagged by SPC	\N	\N
526	493	5	2026-04-15 14:27:07.408488+00	temperature	high	72.0	70.0413482821663	C	auto-flagged by SPC	2026-04-15 21:42:34.137559+00	\N
527	493	4	2026-04-15 16:38:04.48146+00	temperature	low	72.0	72.4075544869737	C	operator note: investigating	2026-04-15 22:05:05.581597+00	\N
528	494	6	2026-05-09 02:05:31.893949+00	vibration	medium	0.5	0.523245340388456	mm/s	operator note: investigating	2026-05-09 03:08:34.848927+00	\N
529	496	3	2026-04-29 15:55:43.043738+00	temperature	medium	72.0	77.5654261177137	C	\N	2026-04-29 22:55:24.863913+00	\N
530	497	4	2026-05-11 22:34:10.89435+00	vibration	medium	0.5	1.05860553690576	mm/s	\N	2026-05-12 00:44:06.86682+00	\N
531	497	4	2026-05-11 22:39:40.374043+00	pressure	medium	2.4	2.46532105346302	bar	operator note: investigating	2026-05-11 23:52:39.775498+00	\N
532	497	5	2026-05-11 22:41:02.76505+00	pressure	medium	2.4	2.47787521099348	bar	auto-flagged by SPC	2026-05-12 00:29:07.789021+00	\N
534	498	6	2026-04-29 07:26:57.738177+00	temperature	low	72.0	70.8615584011129	C	operator note: investigating	2026-04-29 08:22:58.628024+00	\N
535	499	8	2026-04-29 16:40:48.014258+00	contamination	medium	\N	\N	\N	\N	2026-04-29 22:30:14.346063+00	\N
536	500	2	2026-04-09 23:28:19.781194+00	alignment	low	0.0	-0.647	mm	\N	2026-04-10 00:16:44.589232+00	\N
537	501	5	2026-04-25 08:09:52.310584+00	temperature	high	72.0	73.1131823564994	C	operator note: investigating	2026-04-25 12:21:58.493979+00	\N
538	503	9	2026-04-20 00:23:01.823352+00	temperature	low	72.0	74.68785247888	C	operator note: investigating	2026-04-20 04:09:20.206025+00	\N
539	504	1	2026-05-03 11:42:04.53057+00	vibration	high	0.5	1.10920275659835	mm/s	operator note: investigating	2026-05-03 15:01:59.835973+00	\N
540	505	4	2026-04-08 18:42:58.107037+00	pressure	low	2.4	2.61923980186945	bar	auto-flagged by SPC	2026-04-08 19:26:49.733464+00	\N
541	506	6	2026-04-07 23:19:48.588363+00	other	medium	\N	\N	\N	\N	2026-04-08 01:55:48.40075+00	\N
542	507	8	2026-03-20 07:07:45.969559+00	vibration	low	0.5	1.5634076490009	mm/s	\N	2026-03-20 09:56:50.452484+00	\N
543	508	1	2026-04-12 14:36:10.710182+00	alignment	medium	0.0	0.157	mm	operator note: investigating	2026-04-12 20:06:27.250293+00	\N
544	509	5	2026-03-31 00:55:21.19106+00	vibration	low	0.5	0.500753184817978	mm/s	auto-flagged by SPC	2026-03-31 02:45:38.116905+00	\N
545	509	4	2026-03-30 23:04:15.509947+00	contamination	low	\N	\N	\N	operator note: investigating	2026-03-31 03:07:58.681082+00	\N
546	510	6	2026-03-26 07:35:47.870286+00	temperature	low	72.0	70.2853950730276	C	auto-flagged by SPC	2026-03-26 11:39:19.80114+00	\N
547	511	10	2026-03-23 16:10:24.089388+00	vibration	medium	0.5	1.61745703041938	mm/s	operator note: investigating	2026-03-23 17:57:16.900029+00	\N
548	512	3	2026-05-10 23:13:30.136584+00	pressure	medium	2.4	2.17857897733045	bar	\N	2026-05-11 03:58:04.27781+00	\N
549	513	5	2026-04-26 09:23:31.551653+00	temperature	low	72.0	68.9079984542964	C	operator note: investigating	2026-04-26 10:05:21.382446+00	\N
550	514	7	2026-04-19 19:34:20.503681+00	other	low	\N	\N	\N	auto-flagged by SPC	2026-04-19 21:47:13.331845+00	\N
551	515	9	2026-04-22 00:20:16.267078+00	temperature	low	72.0	75.3886135254303	C	\N	2026-04-22 01:37:59.3257+00	\N
552	515	8	2026-04-22 00:24:44.276749+00	other	low	\N	\N	\N	operator note: investigating	2026-04-22 00:39:51.604691+00	\N
553	516	1	2026-05-04 07:41:31.686819+00	temperature	high	72.0	69.893760647658	C	auto-flagged by SPC	2026-05-04 12:19:07.790545+00	\N
554	518	6	2026-04-27 22:30:58.774363+00	contamination	medium	\N	\N	\N	\N	2026-04-28 04:05:07.884788+00	\N
555	518	6	2026-04-27 22:54:52.530283+00	pressure	medium	2.4	2.87090411206654	bar	auto-flagged by SPC	2026-04-28 02:54:20.965387+00	\N
556	519	9	2026-03-18 09:06:19.12321+00	contamination	low	\N	\N	\N	auto-flagged by SPC	2026-03-18 13:08:34.590378+00	\N
557	520	2	2026-04-10 15:47:10.446394+00	alignment	low	0.0	-0.483	mm	auto-flagged by SPC	2026-04-10 18:29:45.833905+00	\N
558	521	5	2026-03-24 23:56:42.353111+00	pressure	medium	2.4	2.51496857509676	bar	operator note: investigating	2026-03-25 03:30:49.814172+00	\N
559	522	6	2026-05-02 06:30:36.119443+00	contamination	critical	\N	\N	\N	\N	2026-05-02 07:29:41.69224+00	\N
560	522	6	2026-05-02 06:42:00.150963+00	vibration	low	0.5	1.52566500041143	mm/s	\N	2026-05-02 07:23:54.29529+00	\N
561	522	7	2026-05-02 06:28:46.848962+00	pressure	medium	2.4	2.52707033521378	bar	operator note: investigating	2026-05-02 07:04:51.765156+00	\N
562	524	3	2026-05-09 22:59:03.546359+00	alignment	medium	0.0	0.683	mm	operator note: investigating	2026-05-10 02:52:57.198004+00	\N
563	525	4	2026-04-03 08:35:36.272218+00	alignment	medium	0.0	-0.960	mm	auto-flagged by SPC	2026-04-03 12:33:49.369786+00	\N
564	525	5	2026-04-03 09:20:18.470279+00	alignment	critical	0.0	0.171	mm	\N	2026-04-03 13:01:05.074594+00	\N
565	527	10	2026-03-28 02:36:08.58851+00	pressure	high	2.4	2.19655686974623	bar	auto-flagged by SPC	\N	\N
566	528	3	2026-05-13 06:10:05.816037+00	vibration	low	0.5	1.36784968893869	mm/s	auto-flagged by SPC	2026-05-13 13:18:52.835804+00	\N
567	529	5	2026-04-13 17:31:18.989139+00	other	critical	\N	\N	\N	auto-flagged by SPC	2026-04-13 19:03:46.155278+00	\N
568	529	4	2026-04-13 17:30:02.816747+00	other	medium	\N	\N	\N	\N	2026-04-13 20:29:12.780513+00	\N
569	530	6	2026-05-10 01:18:47.977357+00	vibration	low	0.5	1.11168620075103	mm/s	operator note: investigating	2026-05-10 01:59:02.301944+00	\N
570	530	6	2026-05-10 00:35:21.289981+00	temperature	medium	72.0	73.7533098088603	C	operator note: investigating	2026-05-10 02:40:42.375073+00	\N
571	531	10	2026-05-05 09:50:44.466446+00	other	medium	\N	\N	\N	\N	2026-05-05 14:27:54.904272+00	\N
572	532	2	2026-05-12 14:17:23.897709+00	other	low	\N	\N	\N	auto-flagged by SPC	2026-05-12 20:43:47.205356+00	\N
573	533	5	2026-04-09 22:48:46.487422+00	other	critical	\N	\N	\N	auto-flagged by SPC	\N	\N
574	533	4	2026-04-10 00:03:00.139008+00	vibration	low	0.5	1.50654607399255	mm/s	auto-flagged by SPC	2026-04-10 06:01:47.534242+00	\N
575	534	7	2026-03-17 10:19:59.432743+00	temperature	high	72.0	69.6360693254788	C	\N	\N	\N
576	534	7	2026-03-17 13:13:25.574754+00	other	medium	\N	\N	\N	\N	2026-03-17 14:09:34.901274+00	\N
577	535	9	2026-05-11 17:49:25.240449+00	other	low	\N	\N	\N	operator note: investigating	2026-05-11 21:03:36.122233+00	\N
578	536	3	2026-04-12 00:32:28.469966+00	contamination	critical	\N	\N	\N	\N	2026-04-12 05:12:31.234321+00	\N
579	538	7	2026-04-03 14:45:01.537574+00	contamination	low	\N	\N	\N	operator note: investigating	2026-04-03 16:40:50.047008+00	\N
580	538	7	2026-04-03 16:15:50.505502+00	alignment	high	0.0	-0.230	mm	operator note: investigating	2026-04-03 18:12:53.082837+00	\N
581	539	8	2026-03-18 22:55:02.982664+00	other	low	\N	\N	\N	\N	2026-03-19 03:56:42.480356+00	\N
582	539	10	2026-03-19 00:50:33.734676+00	pressure	medium	2.4	2.20889328762528	bar	operator note: investigating	2026-03-19 05:00:50.763987+00	\N
583	540	3	2026-05-02 10:46:21.766808+00	alignment	medium	0.0	0.378	mm	auto-flagged by SPC	2026-05-02 14:34:54.193446+00	\N
584	541	5	2026-05-01 15:44:52.426585+00	other	high	\N	\N	\N	\N	2026-05-01 21:18:43.006151+00	\N
585	541	5	2026-05-01 19:36:41.580888+00	contamination	low	\N	\N	\N	auto-flagged by SPC	2026-05-01 21:05:00.788539+00	\N
586	542	7	2026-03-21 23:06:52.707519+00	contamination	low	\N	\N	\N	\N	2026-03-22 03:31:13.994256+00	\N
587	543	10	2026-04-11 07:03:19.122501+00	vibration	critical	0.5	0.604677902797628	mm/s	\N	2026-04-11 09:26:45.136416+00	\N
588	544	3	2026-05-05 15:51:37.927152+00	temperature	medium	72.0	72.2922158177151	C	operator note: investigating	2026-05-05 16:11:10.433326+00	\N
589	547	8	2026-03-20 16:41:55.007923+00	temperature	low	72.0	76.690911875254	C	\N	2026-03-20 22:36:45.323416+00	\N
590	547	10	2026-03-20 17:08:08.956114+00	pressure	high	2.4	2.78388958139926	bar	operator note: investigating	\N	\N
591	548	1	2026-04-13 22:47:26.513141+00	contamination	medium	\N	\N	\N	operator note: investigating	2026-04-14 05:31:24.573278+00	\N
592	549	4	2026-05-01 10:11:30.829004+00	vibration	medium	0.5	1.1004734607013	mm/s	operator note: investigating	2026-05-01 12:48:11.759762+00	\N
593	550	6	2026-04-26 15:56:58.661218+00	pressure	low	2.4	2.19883652703037	bar	\N	2026-04-26 20:03:04.497689+00	\N
594	551	8	2026-05-17 01:01:29.736832+00	pressure	low	2.4	2.58250293360747	bar	auto-flagged by SPC	2026-05-17 05:12:20.681923+00	\N
595	551	9	2026-05-17 03:06:44.566646+00	alignment	low	0.0	0.365	mm	operator note: investigating	2026-05-17 06:10:27.894513+00	\N
596	552	1	2026-03-24 08:41:36.129158+00	alignment	medium	0.0	-0.809	mm	operator note: investigating	2026-03-24 11:04:08.772269+00	\N
597	554	7	2026-03-21 01:43:09.040095+00	pressure	high	2.4	2.77804052538616	bar	auto-flagged by SPC	2026-03-21 04:25:48.234463+00	\N
598	555	9	2026-03-19 07:37:59.028186+00	alignment	medium	0.0	-0.749	mm	\N	2026-03-19 09:16:56.450533+00	\N
599	557	4	2026-03-22 02:02:59.549688+00	contamination	low	\N	\N	\N	\N	2026-03-22 06:17:30.698056+00	\N
600	558	6	2026-04-26 10:32:13.504192+00	temperature	low	72.0	72.7699707610327	C	\N	2026-04-26 11:57:32.576751+00	\N
601	559	10	2026-04-18 14:27:47.583742+00	alignment	critical	0.0	0.846	mm	\N	\N	\N
602	559	10	2026-04-18 16:02:19.412432+00	other	high	\N	\N	\N	operator note: investigating	2026-04-18 22:32:25.909946+00	\N
603	560	3	2026-03-23 01:20:05.55815+00	pressure	low	2.4	2.42935268616591	bar	operator note: investigating	2026-03-23 02:46:56.970551+00	\N
604	561	4	2026-03-23 08:16:19.591149+00	other	medium	\N	\N	\N	\N	2026-03-23 10:21:59.030065+00	\N
605	563	9	2026-03-22 00:03:38.603602+00	temperature	critical	72.0	79.8690266236922	C	auto-flagged by SPC	\N	\N
606	566	6	2026-04-20 01:35:48.669147+00	contamination	low	\N	\N	\N	auto-flagged by SPC	2026-04-20 03:47:18.685861+00	\N
607	567	8	2026-05-06 07:06:09.470567+00	pressure	medium	2.4	2.80317468136925	bar	\N	2026-05-06 13:48:15.709717+00	\N
608	568	3	2026-05-04 15:28:34.156128+00	temperature	critical	72.0	78.3656403292521	C	auto-flagged by SPC	2026-05-04 20:17:06.10252+00	\N
609	568	3	2026-05-04 17:41:48.475757+00	alignment	low	0.0	-0.445	mm	\N	2026-05-04 19:45:26.765959+00	\N
610	569	4	2026-03-23 03:36:28.658189+00	pressure	low	2.4	2.37734027870996	bar	auto-flagged by SPC	2026-03-23 05:55:44.188197+00	\N
611	572	1	2026-05-06 02:24:32.562631+00	contamination	low	\N	\N	\N	auto-flagged by SPC	2026-05-06 06:22:56.534493+00	\N
612	574	6	2026-05-02 16:21:20.525722+00	alignment	critical	0.0	-0.827	mm	\N	2026-05-02 19:28:26.04785+00	\N
613	575	8	2026-05-14 23:46:11.997625+00	temperature	low	72.0	75.3704457730579	C	operator note: investigating	2026-05-15 00:45:37.832782+00	\N
614	577	4	2026-04-24 14:53:56.416615+00	vibration	low	0.5	1.04431767030073	mm/s	\N	2026-04-24 15:51:53.221315+00	\N
615	579	10	2026-04-23 09:17:31.958192+00	other	low	\N	\N	\N	auto-flagged by SPC	2026-04-23 14:51:34.727019+00	\N
616	579	9	2026-04-23 13:22:47.846811+00	pressure	medium	2.4	2.10900127493937	bar	auto-flagged by SPC	2026-04-23 14:52:16.571678+00	\N
617	580	1	2026-04-12 15:19:47.731166+00	other	critical	\N	\N	\N	\N	2026-04-12 17:18:15.452253+00	\N
618	580	1	2026-04-12 16:04:48.058333+00	other	low	\N	\N	\N	\N	2026-04-12 16:46:18.118113+00	\N
619	582	6	2026-04-02 09:35:32.069594+00	other	low	\N	\N	\N	auto-flagged by SPC	2026-04-02 12:18:42.637079+00	\N
620	582	6	2026-04-02 08:15:58.77919+00	pressure	high	2.4	2.4289756150629	bar	auto-flagged by SPC	\N	\N
621	583	9	2026-04-08 14:39:08.175193+00	vibration	medium	0.5	1.17272710773737	mm/s	auto-flagged by SPC	2026-04-08 16:33:53.387857+00	\N
622	583	10	2026-04-08 14:17:05.256818+00	temperature	medium	72.0	75.5496255166826	C	operator note: investigating	2026-04-08 15:35:03.933634+00	\N
623	583	8	2026-04-08 14:39:00.320059+00	vibration	low	0.5	1.54977603799824	mm/s	operator note: investigating	2026-04-08 16:39:06.461103+00	\N
624	583	10	2026-04-08 14:31:33.447981+00	other	high	\N	\N	\N	auto-flagged by SPC	2026-04-08 15:08:38.617696+00	\N
625	584	2	2026-04-06 00:25:04.028182+00	alignment	critical	0.0	-0.773	mm	operator note: investigating	2026-04-06 01:26:31.91458+00	\N
626	585	5	2026-05-03 07:54:20.486965+00	temperature	medium	72.0	72.3875244125122	C	operator note: investigating	2026-05-03 08:52:58.934162+00	\N
627	585	4	2026-05-03 07:08:01.644225+00	other	medium	\N	\N	\N	\N	2026-05-03 08:51:54.774305+00	\N
628	586	7	2026-04-22 14:50:38.383285+00	temperature	low	72.0	78.0586403587604	C	operator note: investigating	2026-04-22 18:42:58.437561+00	\N
629	586	6	2026-04-22 16:10:10.778152+00	contamination	low	\N	\N	\N	operator note: investigating	2026-04-22 17:46:36.788646+00	\N
630	587	10	2026-05-02 22:07:39.387026+00	contamination	medium	\N	\N	\N	operator note: investigating	2026-05-03 03:25:35.35523+00	\N
631	588	3	2026-04-01 06:54:09.921855+00	other	medium	\N	\N	\N	operator note: investigating	2026-04-01 09:28:25.290704+00	\N
632	588	2	2026-04-01 07:38:34.05757+00	contamination	high	\N	\N	\N	auto-flagged by SPC	2026-04-01 07:50:09.090158+00	\N
633	591	10	2026-04-17 08:55:21.560027+00	vibration	critical	0.5	1.05352151804423	mm/s	auto-flagged by SPC	2026-04-17 11:30:07.153863+00	\N
634	592	2	2026-05-02 15:51:44.700943+00	other	low	\N	\N	\N	operator note: investigating	2026-05-02 19:01:11.499334+00	\N
635	592	2	2026-05-02 14:50:40.323585+00	vibration	medium	0.5	1.25101942548943	mm/s	auto-flagged by SPC	2026-05-02 18:37:17.10279+00	\N
636	593	4	2026-04-16 23:28:40.360285+00	temperature	medium	72.0	73.3501847112219	C	\N	2026-04-17 01:24:21.956593+00	\N
637	593	5	2026-04-16 23:29:00.780077+00	temperature	low	72.0	68.7981057800507	C	\N	2026-04-17 00:55:50.033631+00	\N
638	594	7	2026-04-09 11:00:16.692276+00	contamination	low	\N	\N	\N	\N	2026-04-09 13:03:23.650576+00	\N
639	597	4	2026-04-21 10:18:13.356542+00	temperature	high	72.0	72.4912665439792	C	\N	2026-04-21 11:16:11.116706+00	\N
640	598	6	2026-04-16 16:38:27.442669+00	temperature	medium	72.0	74.2102519387926	C	operator note: investigating	2026-04-16 18:24:09.971314+00	\N
641	599	9	2026-03-30 22:46:47.039571+00	alignment	low	0.0	0.707	mm	\N	2026-03-31 01:04:46.028141+00	\N
642	600	1	2026-03-30 12:10:34.663856+00	other	low	\N	\N	\N	\N	2026-03-30 14:40:03.160992+00	\N
643	600	3	2026-03-30 10:59:52.828943+00	other	low	\N	\N	\N	operator note: investigating	2026-03-30 13:59:06.420476+00	\N
\.


--
-- Data for Name: equipment; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.equipment (equipment_id, line_id, name, manufacturer, installed_at, last_maintenance_at, next_maintenance_due) FROM stdin;
1	LINE-A	Filler-A1	Krones AG	2019-05-12	2026-04-22 06:00:00+00	2026-06-22 06:00:00+00
2	LINE-A	Capper-A2	Sidel	2019-05-12	2026-04-15 06:00:00+00	2026-07-15 06:00:00+00
3	LINE-A	Labeler-A3	Krones AG	2020-02-04	2026-03-30 06:00:00+00	2026-05-30 06:00:00+00
4	LINE-B	Filler-B1	Tetra Pak	2018-09-30	2026-04-28 06:00:00+00	2026-07-28 06:00:00+00
5	LINE-B	Capper-B2	Tetra Pak	2018-09-30	2026-02-19 06:00:00+00	2026-05-19 06:00:00+00
6	LINE-C	Extruder-C1	Coperion	2021-07-15	2026-04-10 06:00:00+00	2026-06-10 06:00:00+00
7	LINE-C	Cooler-C2	Buhler	2021-07-15	2026-04-12 06:00:00+00	2026-06-12 06:00:00+00
8	LINE-D	Mixer-D1	GEA	2017-11-22	2026-03-25 06:00:00+00	2026-05-25 06:00:00+00
9	LINE-D	Filler-D2	GEA	2017-11-22	2026-04-05 06:00:00+00	2026-06-05 06:00:00+00
10	LINE-D	Palletizer-D3	Sidel	2022-04-18	2026-04-20 06:00:00+00	2026-07-20 06:00:00+00
\.


--
-- Data for Name: operators; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.operators (operator_id, full_name, shift, certified_lines, hired_at) FROM stdin;
1	Maria Alvarez	day	{LINE-A,LINE-B}	2022-03-14
2	Devon Park	day	{LINE-A,LINE-C,LINE-D}	2021-08-02
3	Priya Shah	swing	{LINE-B,LINE-C}	2023-01-19
4	Tomasz Nowak	swing	{LINE-A,LINE-D}	2020-11-30
5	Aiko Tanaka	night	{LINE-C,LINE-D}	2024-02-05
6	Brendan Kelly	night	{LINE-A,LINE-B,LINE-D}	2019-06-21
7	Naomi Carter	day	{LINE-B}	2025-04-11
8	Hassan Idris	swing	{LINE-C,LINE-D}	2022-09-08
\.


--
-- Data for Name: production_runs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.production_runs (run_id, line_id, batch_id, product_sku, operator_id, started_at, ended_at, units_target, units_produced, status, notes) FROM stdin;
1	LINE-B	B-20260408-0001	SKU-1002	7	2026-04-08 14:22:40.177802+00	2026-04-08 21:08:43.314199+00	969	956	completed	\N
2	LINE-C	B-20260318-0002	SKU-1003	2	2026-03-18 22:09:05.813548+00	2026-03-19 04:48:16.486676+00	916	876	completed	\N
3	LINE-D	B-20260514-0003	SKU-2010	2	2026-05-14 06:01:18.794739+00	2026-05-14 13:22:34.842285+00	985	987	completed	\N
4	LINE-A	B-20260419-0004	SKU-2011	7	2026-04-19 14:28:22.99129+00	2026-04-19 16:25:27.32478+00	921	937	completed	\N
5	LINE-B	B-20260408-0005	SKU-3050	3	2026-04-08 22:26:04.333158+00	2026-04-09 01:06:10.818307+00	1071	1047	completed	\N
6	LINE-C	B-20260418-0006	SKU-1001	4	2026-04-18 06:05:34.589185+00	2026-04-18 10:24:40.536907+00	1049	1001	completed	\N
7	LINE-D	B-20260407-0007	SKU-1002	3	2026-04-07 14:02:11.832207+00	2026-04-07 20:55:06.063149+00	909	903	completed	\N
8	LINE-A	B-20260410-0008	SKU-1003	8	2026-04-10 22:15:34.982771+00	2026-04-10 23:48:50.511103+00	1062	521	aborted	\N
9	LINE-B	B-20260508-0009	SKU-2010	2	2026-05-08 06:00:12.332788+00	2026-05-08 09:20:01.492178+00	804	776	completed	\N
10	LINE-C	B-20260324-0010	SKU-2011	7	2026-03-24 14:24:32.856721+00	2026-03-24 20:54:25.927945+00	947	886	completed	\N
11	LINE-D	B-20260412-0011	SKU-3050	1	2026-04-12 22:08:10.38226+00	2026-04-13 01:34:59.645763+00	1181	1123	completed	\N
12	LINE-A	B-20260423-0012	SKU-1001	3	2026-04-23 06:28:14.940843+00	2026-04-23 10:01:43.781251+00	827	776	completed	\N
13	LINE-B	B-20260429-0013	SKU-1002	7	2026-04-29 14:16:07.861061+00	2026-04-29 18:22:44.207958+00	1000	970	completed	\N
14	LINE-C	B-20260513-0014	SKU-1003	1	2026-05-13 22:26:28.298352+00	2026-05-14 05:24:07.339528+00	1164	1123	completed	\N
15	LINE-D	B-20260511-0015	SKU-2010	5	2026-05-11 06:15:14.585523+00	2026-05-11 10:38:46.022949+00	890	830	completed	\N
16	LINE-A	B-20260401-0016	SKU-2011	3	2026-04-01 14:21:55.211627+00	2026-04-01 20:53:48.544506+00	828	748	test	\N
17	LINE-B	B-20260424-0017	SKU-3050	4	2026-04-24 22:24:55.436743+00	2026-04-25 00:25:55.991767+00	1115	1111	completed	\N
18	LINE-C	B-20260508-0018	SKU-1001	3	2026-05-08 06:07:18.717143+00	2026-05-08 09:00:24.858907+00	1081	1100	completed	\N
19	LINE-D	B-20260503-0019	SKU-1002	4	2026-05-03 14:15:25.861255+00	2026-05-03 21:21:51.97913+00	1046	1027	completed	\N
20	LINE-A	B-20260504-0020	SKU-1003	8	2026-05-04 22:20:25.2537+00	2026-05-05 05:16:46.087006+00	957	944	completed	\N
21	LINE-B	B-20260331-0021	SKU-2010	7	2026-03-31 06:23:39.505344+00	2026-03-31 10:23:03.434358+00	1190	1129	completed	\N
22	LINE-C	B-20260319-0022	SKU-2011	3	2026-03-19 14:12:44.046682+00	2026-03-19 20:38:11.435851+00	1129	1070	completed	\N
23	LINE-D	B-20260407-0023	SKU-3050	4	2026-04-07 22:07:22.771077+00	2026-04-08 02:01:00.213178+00	919	907	completed	\N
24	LINE-A	B-20260427-0024	SKU-1001	1	2026-04-27 06:12:34.346127+00	2026-04-27 10:01:12.850066+00	1157	1142	completed	\N
25	LINE-B	B-20260506-0025	SKU-1002	6	2026-05-06 14:16:29.963761+00	2026-05-06 20:19:43.133057+00	993	947	completed	\N
26	LINE-C	B-20260420-0026	SKU-1003	4	2026-04-20 22:14:18.56173+00	2026-04-21 04:04:09.166893+00	858	836	completed	\N
27	LINE-D	B-20260512-0027	SKU-2010	4	2026-05-12 06:19:42.413689+00	2026-05-12 12:56:03.420236+00	866	821	completed	\N
28	LINE-A	B-20260320-0028	SKU-2011	8	2026-03-20 14:21:18.425265+00	2026-03-20 21:47:27.182888+00	1009	1014	completed	\N
29	LINE-B	B-20260430-0029	SKU-3050	5	2026-04-30 22:05:41.657072+00	2026-04-30 23:58:08.795952+00	1073	1056	completed	\N
30	LINE-C	B-20260427-0030	SKU-1001	7	2026-04-27 06:02:55.658859+00	2026-04-27 07:54:10.807133+00	1001	987	completed	\N
31	LINE-D	B-20260413-0031	SKU-1002	5	2026-04-13 14:15:57.597254+00	2026-04-13 20:19:57.084971+00	1164	1147	completed	\N
32	LINE-A	B-20260506-0032	SKU-1003	4	2026-05-06 22:08:39.524737+00	2026-05-06 23:47:23.112073+00	1023	985	completed	\N
33	LINE-B	B-20260318-0033	SKU-2010	3	2026-03-18 06:01:22.412479+00	2026-03-18 08:52:49.26135+00	1152	1153	completed	\N
34	LINE-C	B-20260413-0034	SKU-2011	1	2026-04-13 14:04:41.24251+00	2026-04-13 17:22:09.275181+00	1197	1187	completed	\N
35	LINE-D	B-20260416-0035	SKU-3050	1	2026-04-16 22:03:42.186554+00	2026-04-17 04:18:14.735828+00	918	868	completed	\N
36	LINE-A	B-20260426-0036	SKU-1001	3	2026-04-26 06:03:01.233084+00	2026-04-26 09:04:23.975635+00	953	969	completed	\N
37	LINE-B	B-20260428-0037	SKU-1002	5	2026-04-28 14:06:51.926596+00	2026-04-28 18:09:58.402464+00	1099	1094	completed	\N
38	LINE-C	B-20260317-0038	SKU-1003	4	2026-03-17 22:11:18.036222+00	2026-03-18 01:51:08.851098+00	859	876	completed	\N
39	LINE-D	B-20260502-0039	SKU-2010	6	2026-05-02 06:19:00.101202+00	2026-05-02 11:26:08.590595+00	995	1007	completed	\N
40	LINE-A	B-20260510-0040	SKU-2011	6	2026-05-10 14:04:54.397433+00	2026-05-10 20:45:53.956403+00	881	841	completed	\N
41	LINE-B	B-20260328-0041	SKU-3050	5	2026-03-28 22:14:51.922644+00	2026-03-29 03:42:26.754026+00	1033	1020	completed	\N
42	LINE-C	B-20260327-0042	SKU-1001	4	2026-03-27 06:26:02.869387+00	2026-03-27 12:08:43.682288+00	810	763	completed	\N
43	LINE-D	B-20260511-0043	SKU-1002	6	2026-05-11 14:12:28.16802+00	2026-05-11 21:36:32.594054+00	1035	993	completed	\N
44	LINE-A	B-20260511-0044	SKU-1003	6	2026-05-11 22:28:10.309394+00	2026-05-12 02:11:00.656719+00	1072	996	completed	\N
45	LINE-B	B-20260407-0045	SKU-2010	3	2026-04-07 06:18:42.513659+00	2026-04-07 07:39:05.810676+00	932	348	aborted	\N
46	LINE-C	B-20260416-0046	SKU-2011	7	2026-04-16 14:24:59.09616+00	2026-04-16 19:46:53.669072+00	865	846	completed	\N
47	LINE-D	B-20260428-0047	SKU-3050	6	2026-04-28 22:13:38.657287+00	2026-04-29 01:29:12.541608+00	965	937	completed	\N
48	LINE-A	B-20260506-0048	SKU-1001	4	2026-05-06 06:00:59.469951+00	2026-05-06 12:18:18.162496+00	914	894	completed	\N
49	LINE-B	B-20260511-0049	SKU-1002	5	2026-05-11 14:04:23.793125+00	2026-05-11 15:59:21.963246+00	1020	957	completed	\N
50	LINE-C	B-20260429-0050	SKU-1003	3	2026-04-29 22:11:15.794195+00	2026-04-30 00:03:40.930646+00	1161	1099	completed	\N
51	LINE-D	B-20260322-0051	SKU-2010	2	2026-03-22 06:01:09.017322+00	2026-03-22 09:16:59.645946+00	862	820	completed	\N
52	LINE-A	B-20260428-0052	SKU-2011	2	2026-04-28 14:28:16.180044+00	2026-04-28 20:31:41.336175+00	1032	972	completed	\N
53	LINE-B	B-20260326-0053	SKU-3050	5	2026-03-26 22:21:39.603206+00	2026-03-27 01:07:49.645507+00	995	994	completed	\N
54	LINE-C	B-20260320-0054	SKU-1001	5	2026-03-20 06:00:50.926248+00	2026-03-20 11:48:12.217553+00	956	964	completed	\N
55	LINE-D	B-20260424-0055	SKU-1002	5	2026-04-24 14:09:31.518692+00	2026-04-24 20:25:35.176287+00	805	779	completed	\N
56	LINE-A	B-20260414-0056	SKU-1003	2	2026-04-14 22:06:42.850959+00	2026-04-15 03:46:23.999443+00	1008	975	completed	\N
57	LINE-B	B-20260419-0057	SKU-2010	2	2026-04-19 06:10:29.864613+00	2026-04-19 07:40:54.71687+00	1041	1001	completed	\N
58	LINE-C	B-20260413-0058	SKU-2011	5	2026-04-13 14:14:16.687185+00	2026-04-13 19:40:20.688285+00	802	796	completed	\N
59	LINE-D	B-20260430-0059	SKU-3050	4	2026-04-30 22:16:20.539907+00	2026-05-01 05:11:00.859774+00	1114	1076	completed	\N
60	LINE-A	B-20260429-0060	SKU-1001	6	2026-04-29 06:27:19.324304+00	2026-04-29 07:10:17.440668+00	975	447	aborted	\N
61	LINE-B	B-20260330-0061	SKU-1002	3	2026-03-30 14:20:43.789028+00	2026-03-30 19:03:57.602353+00	833	773	completed	\N
62	LINE-C	B-20260427-0062	SKU-1003	3	2026-04-27 22:28:16.680976+00	2026-04-28 03:05:17.52379+00	824	796	completed	\N
63	LINE-D	B-20260412-0063	SKU-2010	4	2026-04-12 06:20:51.165441+00	2026-04-12 10:35:36.860335+00	1186	1101	completed	\N
64	LINE-A	B-20260406-0064	SKU-2011	5	2026-04-06 14:15:32.842634+00	2026-04-06 14:36:37.26029+00	1098	448	aborted	\N
65	LINE-B	B-20260407-0065	SKU-3050	3	2026-04-07 22:17:10.544458+00	2026-04-08 02:21:49.814701+00	992	989	completed	\N
66	LINE-C	B-20260325-0066	SKU-1001	6	2026-03-25 06:26:39.200196+00	2026-03-25 11:39:21.538272+00	857	846	completed	\N
67	LINE-D	B-20260510-0067	SKU-1002	8	2026-05-10 14:06:00.827956+00	2026-05-10 18:58:13.847156+00	1092	1042	completed	\N
68	LINE-A	B-20260424-0068	SKU-1003	2	2026-04-24 22:09:51.098719+00	2026-04-24 22:43:34.006611+00	939	438	aborted	\N
69	LINE-B	B-20260508-0069	SKU-2010	6	2026-05-08 06:00:13.426272+00	2026-05-08 11:37:07.664381+00	883	882	completed	\N
70	LINE-C	B-20260407-0070	SKU-2011	1	2026-04-07 14:14:07.925302+00	2026-04-07 21:08:19.990798+00	1153	1106	completed	\N
71	LINE-D	B-20260516-0071	SKU-3050	7	2026-05-16 22:18:17.883701+00	2026-05-17 00:22:29.425894+00	1035	981	completed	\N
72	LINE-A	B-20260502-0072	SKU-1001	8	2026-05-02 06:17:24.485704+00	2026-05-02 08:18:16.701142+00	824	782	completed	\N
73	LINE-B	B-20260327-0073	SKU-1002	8	2026-03-27 14:24:17.792477+00	2026-03-27 20:48:46.732223+00	1008	978	completed	\N
74	LINE-C	B-20260319-0074	SKU-1003	5	2026-03-19 22:23:41.470595+00	2026-03-20 03:06:49.506225+00	819	808	completed	\N
75	LINE-D	B-20260511-0075	SKU-2010	5	2026-05-11 06:25:32.954894+00	2026-05-11 13:52:06.350253+00	1055	998	completed	\N
76	LINE-A	B-20260505-0076	SKU-2011	4	2026-05-05 14:02:53.820129+00	2026-05-05 20:34:58.706861+00	804	791	completed	\N
77	LINE-B	B-20260414-0077	SKU-3050	4	2026-04-14 22:05:21.010153+00	2026-04-15 05:30:14.380278+00	1106	1088	completed	\N
78	LINE-C	B-20260324-0078	SKU-1001	5	2026-03-24 06:26:31.709623+00	2026-03-24 08:10:11.581151+00	1044	987	completed	\N
79	LINE-D	B-20260410-0079	SKU-1002	6	2026-04-10 14:00:22.205288+00	2026-04-10 19:41:55.167554+00	1021	956	completed	\N
80	LINE-A	B-20260508-0080	SKU-1003	5	2026-05-08 22:01:47.973384+00	2026-05-09 02:38:02.065276+00	990	920	completed	\N
81	LINE-B	B-20260511-0081	SKU-2010	6	2026-05-11 06:22:24.953433+00	2026-05-11 08:38:01.028721+00	1144	1054	completed	\N
82	LINE-C	B-20260509-0082	SKU-2011	5	2026-05-09 14:24:45.74656+00	2026-05-09 18:15:36.512351+00	858	843	completed	\N
83	LINE-D	B-20260327-0083	SKU-3050	3	2026-03-27 22:12:18.462446+00	2026-03-28 01:23:11.130822+00	846	832	completed	\N
84	LINE-A	B-20260320-0084	SKU-1001	6	2026-03-20 06:26:24.703614+00	2026-03-20 12:51:01.762542+00	888	901	completed	\N
85	LINE-B	B-20260403-0085	SKU-1002	5	2026-04-03 14:07:22.800893+00	2026-04-03 20:12:17.680296+00	908	839	completed	\N
86	LINE-C	B-20260514-0086	SKU-1003	8	2026-05-14 22:27:21.936689+00	2026-05-15 05:22:53.597692+00	896	854	completed	\N
87	LINE-D	B-20260406-0087	SKU-2010	6	2026-04-06 06:16:49.667419+00	2026-04-06 13:19:45.892676+00	863	847	completed	\N
88	LINE-A	B-20260322-0088	SKU-2011	3	2026-03-22 14:02:14.341766+00	2026-03-22 19:53:00.011052+00	1070	1071	completed	\N
89	LINE-B	B-20260328-0089	SKU-3050	7	2026-03-28 22:08:07.718342+00	2026-03-28 23:52:49.014417+00	1154	1089	completed	\N
90	LINE-C	B-20260426-0090	SKU-1001	7	2026-04-26 06:12:48.87901+00	2026-04-26 11:46:53.540716+00	1016	953	completed	\N
91	LINE-D	B-20260505-0091	SKU-1002	1	2026-05-05 14:08:16.97016+00	2026-05-05 17:08:21.098936+00	1200	1192	completed	\N
92	LINE-A	B-20260318-0092	SKU-1003	4	2026-03-18 22:07:41.502446+00	2026-03-18 23:42:07.874329+00	1095	386	aborted	\N
93	LINE-B	B-20260321-0093	SKU-2010	8	2026-03-21 06:28:36.413286+00	2026-03-21 10:40:34.924418+00	1001	970	completed	\N
94	LINE-C	B-20260503-0094	SKU-2011	1	2026-05-03 14:22:58.396014+00	2026-05-03 17:58:05.105105+00	875	891	completed	\N
95	LINE-D	B-20260325-0095	SKU-3050	4	2026-03-25 22:02:30.266903+00	2026-03-26 04:50:57.938439+00	1172	1180	completed	\N
96	LINE-A	B-20260509-0096	SKU-1001	6	2026-05-09 06:24:21.350104+00	2026-05-09 11:53:03.884077+00	1059	1068	completed	\N
97	LINE-B	B-20260503-0097	SKU-1002	7	2026-05-03 14:04:00.47996+00	2026-05-03 15:00:24.98612+00	1005	132	aborted	\N
98	LINE-C	B-20260331-0098	SKU-1003	8	2026-03-31 22:03:15.383195+00	2026-04-01 03:31:16.792847+00	1170	1083	completed	\N
99	LINE-D	B-20260413-0099	SKU-2010	3	2026-04-13 06:18:59.301917+00	2026-04-13 13:31:55.393267+00	1012	990	completed	\N
100	LINE-A	B-20260421-0100	SKU-2011	5	2026-04-21 14:05:17.914342+00	2026-04-21 19:13:46.033283+00	1166	1166	completed	\N
101	LINE-B	B-20260501-0101	SKU-3050	7	2026-05-01 22:24:54.307408+00	2026-05-02 01:22:09.428919+00	933	902	completed	\N
102	LINE-C	B-20260513-0102	SKU-1001	3	2026-05-13 06:22:20.492343+00	2026-05-13 10:39:45.037291+00	977	918	completed	\N
103	LINE-D	B-20260322-0103	SKU-1002	4	2026-03-22 14:12:34.453391+00	2026-03-22 19:23:19.350685+00	844	817	completed	\N
104	LINE-A	B-20260428-0104	SKU-1003	4	2026-04-28 22:13:56.132673+00	2026-04-29 03:13:24.354866+00	836	793	completed	\N
105	LINE-B	B-20260407-0105	SKU-2010	2	2026-04-07 06:09:59.343645+00	2026-04-07 10:56:03.39759+00	824	787	completed	\N
106	LINE-C	B-20260321-0106	SKU-2011	2	2026-03-21 14:15:19.711291+00	2026-03-21 19:11:02.046163+00	992	1004	completed	\N
107	LINE-D	B-20260425-0107	SKU-3050	4	2026-04-25 22:22:54.094733+00	2026-04-26 00:00:05.668586+00	1101	1079	completed	\N
108	LINE-A	B-20260411-0108	SKU-1001	3	2026-04-11 06:05:36.959672+00	2026-04-11 13:03:37.787693+00	1080	1075	completed	\N
109	LINE-B	B-20260405-0109	SKU-1002	6	2026-04-05 14:01:59.678062+00	2026-04-05 18:03:43.455451+00	1030	1014	completed	\N
110	LINE-C	B-20260412-0110	SKU-1003	5	2026-04-12 22:29:16.37653+00	2026-04-13 03:47:03.418577+00	1080	1051	completed	\N
111	LINE-D	B-20260423-0111	SKU-2010	6	2026-04-23 06:08:21.952486+00	2026-04-23 12:44:54.787788+00	1159	1086	completed	\N
112	LINE-A	B-20260418-0112	SKU-2011	3	2026-04-18 14:11:29.689287+00	2026-04-18 21:14:50.742458+00	1102	1091	completed	\N
113	LINE-B	B-20260417-0113	SKU-3050	5	2026-04-17 22:26:09.205196+00	2026-04-18 00:07:25.301155+00	835	849	completed	\N
114	LINE-C	B-20260410-0114	SKU-1001	3	2026-04-10 06:16:56.004826+00	2026-04-10 08:10:46.673171+00	911	888	completed	\N
115	LINE-D	B-20260331-0115	SKU-1002	4	2026-03-31 14:09:31.362068+00	2026-03-31 19:02:38.033719+00	1080	1010	completed	\N
116	LINE-A	B-20260323-0116	SKU-1003	4	2026-03-23 22:29:58.989276+00	2026-03-24 00:23:21.2333+00	1093	1083	completed	\N
117	LINE-B	B-20260501-0117	SKU-2010	7	2026-05-01 06:10:44.157426+00	2026-05-01 09:34:33.710101+00	1098	1071	completed	\N
118	LINE-C	B-20260510-0118	SKU-2011	2	2026-05-10 14:19:06.60274+00	2026-05-10 21:07:46.012092+00	1054	986	completed	\N
119	LINE-D	B-20260509-0119	SKU-3050	4	2026-05-09 22:13:26.56214+00	2026-05-10 03:27:29.113094+00	1118	1047	completed	\N
120	LINE-A	B-20260409-0120	SKU-1001	5	2026-04-09 06:10:21.21034+00	2026-04-09 11:26:49.135207+00	1076	1085	completed	\N
121	LINE-B	B-20260327-0121	SKU-1002	3	2026-03-27 14:02:38.653953+00	2026-03-27 18:49:27.233783+00	1019	951	completed	\N
122	LINE-C	B-20260506-0122	SKU-1003	4	2026-05-06 22:05:06.754293+00	2026-05-07 00:15:47.756973+00	1152	1063	completed	\N
123	LINE-D	B-20260407-0123	SKU-2010	7	2026-04-07 06:02:21.80511+00	2026-04-07 13:18:58.133282+00	1007	1011	completed	\N
124	LINE-A	B-20260412-0124	SKU-2011	7	2026-04-12 14:06:38.764372+00	2026-04-12 19:50:54.067765+00	979	935	completed	\N
125	LINE-B	B-20260514-0125	SKU-3050	6	2026-05-14 22:13:59.675564+00	2026-05-15 03:39:16.089894+00	982	914	completed	\N
126	LINE-C	B-20260419-0126	SKU-1001	2	2026-04-19 06:11:52.435428+00	2026-04-19 13:02:37.325465+00	971	919	completed	\N
127	LINE-D	B-20260513-0127	SKU-1002	5	2026-05-13 14:09:19.756012+00	2026-05-13 15:58:15.962613+00	1140	1092	completed	\N
128	LINE-A	B-20260415-0128	SKU-1003	7	2026-04-15 22:28:14.74036+00	2026-04-15 23:14:08.493162+00	984	457	aborted	\N
129	LINE-B	B-20260423-0129	SKU-2010	5	2026-04-23 06:03:13.916136+00	2026-04-23 10:28:54.838482+00	902	917	completed	\N
130	LINE-C	B-20260417-0130	SKU-2011	7	2026-04-17 14:10:55.421768+00	2026-04-17 19:08:10.929375+00	828	803	completed	\N
131	LINE-D	B-20260402-0131	SKU-3050	3	2026-04-02 22:04:59.143152+00	2026-04-03 02:28:55.097869+00	1142	1121	completed	\N
132	LINE-A	B-20260317-0132	SKU-1001	1	2026-03-17 06:18:51.040857+00	2026-03-17 10:10:40.824891+00	1091	1113	completed	\N
133	LINE-B	B-20260507-0133	SKU-1002	2	2026-05-07 14:24:51.401283+00	2026-05-07 19:28:17.256807+00	1176	1177	completed	\N
134	LINE-C	B-20260501-0134	SKU-1003	2	2026-05-01 22:29:09.188451+00	2026-05-02 01:17:05.468693+00	1190	1189	completed	\N
135	LINE-D	B-20260421-0135	SKU-2010	3	2026-04-21 06:19:40.840055+00	2026-04-21 13:48:24.445402+00	1122	1130	completed	\N
136	LINE-A	B-20260405-0136	SKU-2011	1	2026-04-05 14:08:01.548264+00	2026-04-05 17:35:53.571619+00	1076	1035	completed	\N
137	LINE-B	B-20260430-0137	SKU-3050	2	2026-04-30 22:02:19.065569+00	2026-05-01 02:32:15.880232+00	1063	985	completed	\N
138	LINE-C	B-20260503-0138	SKU-1001	7	2026-05-03 06:29:56.535739+00	2026-05-03 09:56:48.946614+00	921	861	completed	\N
139	LINE-D	B-20260406-0139	SKU-1002	6	2026-04-06 14:14:45.118445+00	2026-04-06 19:22:11.98401+00	959	940	completed	\N
140	LINE-A	B-20260512-0140	SKU-1003	2	2026-05-12 22:27:29.026636+00	2026-05-13 05:05:17.708409+00	848	860	completed	\N
141	LINE-B	B-20260509-0141	SKU-2010	2	2026-05-09 06:18:06.141598+00	2026-05-09 11:06:20.234255+00	1174	1184	completed	\N
142	LINE-C	B-20260318-0142	SKU-2011	5	2026-03-18 14:28:34.844628+00	2026-03-18 20:38:01.383833+00	971	908	completed	\N
143	LINE-D	B-20260505-0143	SKU-3050	5	2026-05-05 22:29:14.69037+00	2026-05-06 02:47:26.185741+00	861	815	completed	\N
144	LINE-A	B-20260430-0144	SKU-1001	4	2026-04-30 06:29:00.221263+00	2026-04-30 08:57:41.711819+00	1119	1037	completed	\N
145	LINE-B	B-20260414-0145	SKU-1002	6	2026-04-14 14:15:58.14327+00	2026-04-14 18:47:46.383979+00	901	914	completed	\N
146	LINE-C	B-20260502-0146	SKU-1003	4	2026-05-02 22:14:11.983521+00	2026-05-03 00:45:00.636902+00	845	804	completed	\N
147	LINE-D	B-20260326-0147	SKU-2010	3	2026-03-26 06:01:07.519247+00	2026-03-26 09:20:51.524525+00	819	814	completed	\N
148	LINE-A	B-20260324-0148	SKU-2011	7	2026-03-24 14:09:35.974547+00	2026-03-24 18:47:31.83604+00	953	944	test	\N
149	LINE-B	B-20260425-0149	SKU-3050	3	2026-04-25 22:20:25.610629+00	2026-04-26 03:35:19.011714+00	1086	1082	completed	\N
150	LINE-C	B-20260428-0150	SKU-1001	2	2026-04-28 06:16:30.600346+00	2026-04-28 10:48:47.969812+00	1051	1020	completed	\N
151	LINE-D	B-20260426-0151	SKU-1002	3	2026-04-26 14:00:38.893016+00	2026-04-26 17:41:24.202029+00	1065	1071	completed	\N
152	LINE-A	B-20260509-0152	SKU-1003	4	2026-05-09 22:14:52.328426+00	2026-05-10 01:20:25.178616+00	1017	1011	completed	\N
153	LINE-B	B-20260506-0153	SKU-2010	6	2026-05-06 06:09:22.686538+00	2026-05-06 06:39:13.930854+00	856	298	aborted	\N
154	LINE-C	B-20260406-0154	SKU-2011	3	2026-04-06 14:23:17.591766+00	2026-04-06 18:09:33.351272+00	941	957	completed	\N
155	LINE-D	B-20260413-0155	SKU-3050	3	2026-04-13 22:10:02.204785+00	2026-04-14 01:56:38.040088+00	909	923	completed	\N
156	LINE-A	B-20260430-0156	SKU-1001	5	2026-04-30 06:22:35.570521+00	2026-04-30 11:18:55.340343+00	1040	1042	completed	\N
157	LINE-B	B-20260510-0157	SKU-1002	7	2026-05-10 14:09:22.774869+00	2026-05-10 19:25:53.526828+00	1152	1157	completed	\N
158	LINE-C	B-20260514-0158	SKU-1003	4	2026-05-14 22:11:03.466209+00	2026-05-15 01:39:12.547491+00	1092	1076	completed	\N
159	LINE-D	B-20260426-0159	SKU-2010	7	2026-04-26 06:16:22.459795+00	2026-04-26 13:14:17.655783+00	1037	1020	completed	\N
160	LINE-A	B-20260501-0160	SKU-2011	3	2026-05-01 14:20:40.777771+00	2026-05-01 19:22:50.408934+00	887	903	completed	\N
161	LINE-B	B-20260424-0161	SKU-3050	2	2026-04-24 22:18:29.137697+00	2026-04-25 03:38:57.121526+00	1074	1066	completed	\N
162	LINE-C	B-20260417-0162	SKU-1001	6	2026-04-17 06:04:52.862513+00	2026-04-17 13:27:01.497681+00	829	786	completed	\N
163	LINE-D	B-20260503-0163	SKU-1002	2	2026-05-03 14:28:07.296141+00	2026-05-03 21:19:30.271981+00	1050	1068	completed	\N
164	LINE-A	B-20260418-0164	SKU-1003	4	2026-04-18 22:00:05.658997+00	2026-04-19 03:55:42.329903+00	899	854	completed	\N
165	LINE-B	B-20260513-0165	SKU-2010	2	2026-05-13 06:19:30.001653+00	2026-05-13 13:07:25.40587+00	983	973	completed	\N
166	LINE-C	B-20260418-0166	SKU-2011	4	2026-04-18 14:08:32.367377+00	2026-04-18 21:13:21.328347+00	896	836	completed	\N
167	LINE-D	B-20260402-0167	SKU-3050	4	2026-04-02 22:19:32.484132+00	2026-04-02 23:42:44.420008+00	1047	414	aborted	\N
168	LINE-A	B-20260325-0168	SKU-1001	2	2026-03-25 06:24:26.054726+00	2026-03-25 13:20:26.751253+00	954	965	completed	\N
169	LINE-B	B-20260402-0169	SKU-1002	6	2026-04-02 14:09:08.209023+00	2026-04-02 15:42:37.820588+00	837	821	completed	\N
170	LINE-C	B-20260422-0170	SKU-1003	2	2026-04-22 22:29:14.039881+00	2026-04-23 01:46:31.005579+00	870	886	completed	\N
171	LINE-D	B-20260321-0171	SKU-2010	3	2026-03-21 06:09:27.145828+00	2026-03-21 08:10:10.956476+00	1084	1004	completed	\N
172	LINE-A	B-20260413-0172	SKU-2011	2	2026-04-13 14:08:50.124547+00	2026-04-13 17:54:37.44051+00	905	842	completed	\N
173	LINE-B	B-20260504-0173	SKU-3050	1	2026-05-04 22:06:14.808932+00	2026-05-05 02:13:18.733412+00	864	802	completed	\N
174	LINE-C	B-20260417-0174	SKU-1001	5	2026-04-17 06:10:43.435207+00	2026-04-17 07:11:16.108289+00	1016	383	aborted	\N
175	LINE-D	B-20260319-0175	SKU-1002	4	2026-03-19 14:18:33.540313+00	2026-03-19 18:36:55.100042+00	1178	700	test	\N
176	LINE-A	B-20260513-0176	SKU-1003	7	2026-05-13 22:02:43.867238+00	2026-05-14 04:20:34.432965+00	1106	1074	completed	\N
177	LINE-B	B-20260411-0177	SKU-2010	6	2026-04-11 06:09:37.779479+00	2026-04-11 13:34:00.676412+00	1054	972	completed	\N
178	LINE-C	B-20260509-0178	SKU-2011	5	2026-05-09 14:01:47.646527+00	2026-05-09 21:03:24.755222+00	1183	1116	completed	\N
179	LINE-D	B-20260319-0179	SKU-3050	6	2026-03-19 22:18:38.500444+00	2026-03-20 01:47:34.489592+00	890	835	completed	\N
180	LINE-A	B-20260331-0180	SKU-1001	2	2026-03-31 06:29:31.235787+00	2026-03-31 09:56:56.037433+00	1081	1093	completed	\N
181	LINE-B	B-20260411-0181	SKU-1002	7	2026-04-11 14:14:24.575218+00	2026-04-11 20:35:22.416319+00	1014	998	completed	\N
182	LINE-C	B-20260423-0182	SKU-1003	7	2026-04-23 22:09:37.176502+00	2026-04-24 00:51:01.133747+00	818	760	completed	\N
183	LINE-D	B-20260405-0183	SKU-2010	4	2026-04-05 06:23:23.43493+00	2026-04-05 11:57:40.201741+00	901	857	completed	\N
184	LINE-A	B-20260423-0184	SKU-2011	5	2026-04-23 14:10:22.63322+00	2026-04-23 16:39:40.772652+00	1161	1159	completed	\N
185	LINE-B	B-20260326-0185	SKU-3050	4	2026-03-26 22:18:24.526985+00	2026-03-27 03:24:44.023803+00	1169	1192	completed	\N
186	LINE-C	B-20260318-0186	SKU-1001	5	2026-03-18 06:28:02.008376+00	2026-03-18 08:50:57.971563+00	985	948	completed	\N
187	LINE-D	B-20260326-0187	SKU-1002	3	2026-03-26 14:20:14.344448+00	2026-03-26 17:31:48.016378+00	1156	1105	completed	\N
188	LINE-A	B-20260416-0188	SKU-1003	4	2026-04-16 22:29:12.599316+00	2026-04-17 05:39:14.688896+00	995	996	completed	\N
189	LINE-B	B-20260515-0189	SKU-2010	7	2026-05-15 06:08:54.668903+00	2026-05-15 09:51:24.006708+00	1039	1010	completed	\N
190	LINE-C	B-20260428-0190	SKU-2011	7	2026-04-28 14:11:38.154704+00	2026-04-28 17:53:06.65615+00	1128	1108	completed	\N
191	LINE-D	B-20260428-0191	SKU-3050	5	2026-04-28 22:09:42.627497+00	2026-04-29 01:52:50.714266+00	825	792	completed	\N
192	LINE-A	B-20260409-0192	SKU-1001	5	2026-04-09 06:19:51.433149+00	2026-04-09 09:13:55.283117+00	949	925	completed	\N
193	LINE-B	B-20260506-0193	SKU-1002	4	2026-05-06 14:05:26.993209+00	2026-05-06 18:31:18.51884+00	1070	1001	completed	\N
194	LINE-C	B-20260511-0194	SKU-1003	5	2026-05-11 22:29:47.864707+00	2026-05-12 01:20:09.540586+00	1069	1004	completed	\N
195	LINE-D	B-20260504-0195	SKU-2010	3	2026-05-04 06:15:52.596837+00	2026-05-04 08:25:17.606333+00	847	804	completed	\N
196	LINE-A	B-20260322-0196	SKU-2011	6	2026-03-22 14:10:25.97953+00	2026-03-22 16:31:36.248982+00	1072	1025	completed	\N
197	LINE-B	B-20260429-0197	SKU-3050	4	2026-04-29 22:07:08.539217+00	2026-04-30 04:25:44.933517+00	1199	1171	completed	\N
198	LINE-C	B-20260503-0198	SKU-1001	4	2026-05-03 06:19:36.522039+00	2026-05-03 08:15:46.249643+00	1067	1012	completed	\N
199	LINE-D	B-20260430-0199	SKU-1002	2	2026-04-30 14:02:05.450841+00	2026-04-30 17:55:43.424317+00	936	889	completed	\N
200	LINE-A	B-20260402-0200	SKU-1003	4	2026-04-02 22:08:31.218861+00	2026-04-03 05:04:31.224628+00	842	780	completed	\N
201	LINE-B	B-20260418-0201	SKU-2010	7	2026-04-18 06:03:54.659927+00	2026-04-18 08:27:44.948228+00	1146	1092	completed	\N
202	LINE-C	B-20260512-0202	SKU-2011	6	2026-05-12 14:14:27.217283+00	2026-05-12 18:31:43.577654+00	972	970	completed	\N
203	LINE-D	B-20260515-0203	SKU-3050	6	2026-05-15 22:15:10.761656+00	2026-05-16 03:35:42.077264+00	1139	1160	completed	\N
204	LINE-A	B-20260322-0204	SKU-1001	7	2026-03-22 06:23:20.979961+00	2026-03-22 12:22:57.697646+00	1192	1158	completed	\N
205	LINE-B	B-20260502-0205	SKU-1002	6	2026-05-02 14:09:42.741238+00	2026-05-02 19:29:33.19972+00	855	801	completed	\N
206	LINE-C	B-20260321-0206	SKU-1003	5	2026-03-21 22:11:03.969248+00	2026-03-22 03:32:14.743274+00	906	902	completed	\N
207	LINE-D	B-20260326-0207	SKU-2010	8	2026-03-26 06:02:30.304951+00	2026-03-26 07:43:34.195972+00	901	880	completed	\N
208	LINE-A	B-20260430-0208	SKU-2011	7	2026-04-30 14:16:18.779532+00	2026-04-30 16:10:42.621506+00	972	910	completed	\N
209	LINE-B	B-20260506-0209	SKU-3050	4	2026-05-06 22:12:58.117748+00	2026-05-07 01:56:20.16831+00	1118	1085	completed	\N
210	LINE-C	B-20260401-0210	SKU-1001	6	2026-04-01 06:18:31.273469+00	2026-04-01 11:58:59.799076+00	864	846	completed	\N
211	LINE-D	B-20260429-0211	SKU-1002	6	2026-04-29 14:24:09.062926+00	2026-04-29 18:38:31.51731+00	1192	1216	completed	\N
212	LINE-A	B-20260324-0212	SKU-1003	5	2026-03-24 22:08:16.167501+00	2026-03-25 02:35:17.422612+00	1164	1172	completed	\N
213	LINE-B	B-20260420-0213	SKU-2010	2	2026-04-20 06:11:13.447898+00	2026-04-20 09:13:14.528995+00	1066	1049	completed	\N
214	LINE-C	B-20260510-0214	SKU-2011	6	2026-05-10 14:25:34.353591+00	2026-05-10 21:32:10.125277+00	1157	1098	completed	\N
215	LINE-D	B-20260512-0215	SKU-3050	4	2026-05-12 22:11:52.527731+00	2026-05-13 04:08:27.331228+00	883	864	completed	\N
216	LINE-A	B-20260420-0216	SKU-1001	1	2026-04-20 06:18:14.943309+00	2026-04-20 10:01:03.590498+00	998	923	completed	\N
217	LINE-B	B-20260428-0217	SKU-1002	2	2026-04-28 14:12:43.911352+00	2026-04-28 18:16:19.361372+00	1038	1019	completed	\N
218	LINE-C	B-20260416-0218	SKU-1003	2	2026-04-16 22:01:19.981348+00	2026-04-17 05:01:55.323203+00	1056	1011	completed	\N
219	LINE-D	B-20260408-0219	SKU-2010	6	2026-04-08 06:05:50.343074+00	2026-04-08 10:44:35.351576+00	869	866	completed	\N
220	LINE-A	B-20260409-0220	SKU-2011	5	2026-04-09 14:11:50.22628+00	2026-04-09 19:24:51.903779+00	1156	1174	completed	\N
221	LINE-B	B-20260410-0221	SKU-3050	6	2026-04-10 22:27:57.879736+00	2026-04-11 02:33:13.214354+00	805	799	completed	\N
222	LINE-C	B-20260325-0222	SKU-1001	4	2026-03-25 06:08:33.217846+00	2026-03-25 11:13:22.876568+00	939	937	completed	\N
223	LINE-D	B-20260504-0223	SKU-1002	2	2026-05-04 14:29:56.950162+00	2026-05-04 16:00:38.769549+00	939	891	completed	\N
224	LINE-A	B-20260413-0224	SKU-1003	2	2026-04-13 22:11:52.066208+00	2026-04-13 23:47:40.313265+00	847	861	completed	\N
225	LINE-B	B-20260317-0225	SKU-2010	2	2026-03-17 06:18:14.500713+00	2026-03-17 08:10:22.279864+00	1081	1056	completed	\N
226	LINE-C	B-20260330-0226	SKU-2011	7	2026-03-30 14:02:52.07973+00	2026-03-30 20:31:20.06929+00	967	960	completed	\N
227	LINE-D	B-20260401-0227	SKU-3050	2	2026-04-01 22:14:00.209357+00	2026-04-02 01:42:10.841241+00	1079	1046	completed	\N
228	LINE-A	B-20260408-0228	SKU-1001	6	2026-04-08 06:13:53.519887+00	2026-04-08 12:02:27.46467+00	830	832	completed	\N
229	LINE-B	B-20260403-0229	SKU-1002	2	2026-04-03 14:02:40.816106+00	2026-04-03 17:11:40.056278+00	835	798	completed	\N
230	LINE-C	B-20260319-0230	SKU-1003	8	2026-03-19 22:01:31.381174+00	2026-03-20 02:18:52.616507+00	834	492	test	\N
231	LINE-D	B-20260415-0231	SKU-2010	1	2026-04-15 06:12:16.046688+00	2026-04-15 11:06:58.307754+00	1112	1103	completed	\N
232	LINE-A	B-20260502-0232	SKU-2011	6	2026-05-02 14:23:32.56415+00	2026-05-02 21:19:04.354599+00	1071	1001	completed	\N
233	LINE-B	B-20260409-0233	SKU-3050	7	2026-04-09 22:12:02.669651+00	2026-04-10 03:02:56.674359+00	1057	996	completed	\N
234	LINE-C	B-20260427-0234	SKU-1001	4	2026-04-27 06:03:10.291898+00	2026-04-27 10:39:17.895904+00	1027	1019	completed	\N
235	LINE-D	B-20260323-0235	SKU-1002	6	2026-03-23 14:25:44.65881+00	2026-03-23 17:01:55.299463+00	969	912	completed	\N
236	LINE-A	B-20260510-0236	SKU-1003	3	2026-05-10 22:01:23.864141+00	2026-05-11 04:24:51.573885+00	1029	1036	completed	\N
237	LINE-B	B-20260512-0237	SKU-2010	7	2026-05-12 06:11:35.809995+00	2026-05-12 10:25:19.314613+00	998	956	completed	\N
238	LINE-C	B-20260327-0238	SKU-2011	1	2026-03-27 14:11:50.506681+00	2026-03-27 21:23:01.812816+00	1085	1031	completed	\N
239	LINE-D	B-20260419-0239	SKU-3050	6	2026-04-19 22:15:00.876847+00	2026-04-19 23:56:10.206005+00	828	831	completed	\N
240	LINE-A	B-20260423-0240	SKU-1001	3	2026-04-23 06:24:30.406696+00	2026-04-23 13:53:12.797221+00	915	885	completed	\N
241	LINE-B	B-20260324-0241	SKU-1002	4	2026-03-24 14:04:50.506541+00	2026-03-24 20:55:33.78844+00	929	684	test	\N
242	LINE-C	B-20260408-0242	SKU-1003	5	2026-04-08 22:20:28.896171+00	2026-04-09 04:32:00.466218+00	881	814	completed	\N
243	LINE-D	B-20260321-0243	SKU-2010	6	2026-03-21 06:01:40.248431+00	2026-03-21 08:41:21.311824+00	913	890	completed	\N
244	LINE-A	B-20260406-0244	SKU-2011	6	2026-04-06 14:28:38.317167+00	2026-04-06 18:36:29.848474+00	816	812	completed	\N
245	LINE-B	B-20260426-0245	SKU-3050	7	2026-04-26 22:18:51.063673+00	2026-04-27 05:27:06.539052+00	1183	1149	completed	\N
246	LINE-C	B-20260429-0246	SKU-1001	3	2026-04-29 06:22:53.987445+00	2026-04-29 07:48:43.010901+00	1021	509	aborted	\N
247	LINE-D	B-20260411-0247	SKU-1002	7	2026-04-11 14:16:07.584233+00	2026-04-11 16:42:40.880561+00	1065	984	completed	\N
248	LINE-A	B-20260424-0248	SKU-1003	6	2026-04-24 22:14:12.416103+00	2026-04-25 04:25:15.663191+00	1065	1086	completed	\N
249	LINE-B	B-20260507-0249	SKU-2010	2	2026-05-07 06:05:07.165464+00	2026-05-07 11:42:44.262391+00	1056	1010	completed	\N
250	LINE-C	B-20260430-0250	SKU-2011	5	2026-04-30 14:13:12.157032+00	2026-04-30 16:15:26.613283+00	835	793	completed	\N
251	LINE-D	B-20260408-0251	SKU-3050	7	2026-04-08 22:28:58.904368+00	2026-04-09 03:42:15.982615+00	1177	1121	completed	\N
252	LINE-A	B-20260326-0252	SKU-1001	5	2026-03-26 06:16:08.245514+00	2026-03-26 09:32:32.570791+00	1196	1205	completed	\N
253	LINE-B	B-20260508-0253	SKU-1002	6	2026-05-08 14:05:32.85147+00	2026-05-08 18:46:08.217468+00	1161	1135	completed	\N
254	LINE-C	B-20260426-0254	SKU-1003	6	2026-04-26 22:06:28.696054+00	2026-04-27 03:00:57.468137+00	1062	1049	completed	\N
255	LINE-D	B-20260425-0255	SKU-2010	6	2026-04-25 06:16:49.67741+00	2026-04-25 12:44:16.58664+00	940	874	completed	\N
256	LINE-A	B-20260413-0256	SKU-2011	5	2026-04-13 14:16:14.903788+00	2026-04-13 21:10:39.4626+00	854	787	completed	\N
257	LINE-B	B-20260410-0257	SKU-3050	5	2026-04-10 22:12:19.233533+00	2026-04-10 23:33:09.120148+00	1046	147	aborted	\N
258	LINE-C	B-20260419-0258	SKU-1001	2	2026-04-19 06:19:56.164525+00	2026-04-19 10:50:29.746232+00	1029	1005	completed	\N
259	LINE-D	B-20260502-0259	SKU-1002	7	2026-05-02 14:07:28.563738+00	2026-05-02 19:22:27.121653+00	823	772	completed	\N
260	LINE-A	B-20260328-0260	SKU-1003	2	2026-03-28 22:02:03.801606+00	2026-03-29 01:51:37.228283+00	891	864	completed	\N
261	LINE-B	B-20260514-0261	SKU-2010	2	2026-05-14 06:12:55.481912+00	2026-05-14 13:16:35.441696+00	821	821	completed	\N
262	LINE-C	B-20260502-0262	SKU-2011	6	2026-05-02 14:05:41.847225+00	2026-05-02 21:26:35.463658+00	1060	1065	completed	\N
263	LINE-D	B-20260426-0263	SKU-3050	8	2026-04-26 22:19:20.354289+00	2026-04-27 01:16:57.642539+00	952	895	completed	\N
264	LINE-A	B-20260324-0264	SKU-1001	6	2026-03-24 06:29:14.425093+00	2026-03-24 13:31:14.262349+00	1088	1057	completed	\N
265	LINE-B	B-20260411-0265	SKU-1002	4	2026-04-11 14:29:35.29201+00	2026-04-11 16:04:11.779879+00	813	368	aborted	\N
266	LINE-C	B-20260409-0266	SKU-1003	6	2026-04-09 22:21:10.966174+00	2026-04-10 04:28:05.114935+00	1039	992	completed	\N
267	LINE-D	B-20260404-0267	SKU-2010	7	2026-04-04 06:02:46.199326+00	2026-04-04 07:49:28.600363+00	1059	1057	completed	\N
268	LINE-A	B-20260319-0268	SKU-2011	6	2026-03-19 14:26:47.380649+00	2026-03-19 16:08:12.29412+00	900	436	aborted	\N
269	LINE-B	B-20260427-0269	SKU-3050	5	2026-04-27 22:14:40.345871+00	2026-04-28 04:37:54.767114+00	934	911	completed	\N
270	LINE-C	B-20260429-0270	SKU-1001	5	2026-04-29 06:07:23.394505+00	2026-04-29 12:55:55.843855+00	1006	1000	completed	\N
271	LINE-D	B-20260510-0271	SKU-1002	2	2026-05-10 14:28:23.167535+00	2026-05-10 21:41:17.191124+00	998	922	completed	\N
272	LINE-A	B-20260429-0272	SKU-1003	6	2026-04-29 22:24:48.471676+00	2026-04-30 02:41:57.316364+00	1154	1068	completed	\N
273	LINE-B	B-20260424-0273	SKU-2010	4	2026-04-24 06:28:02.12735+00	2026-04-24 10:29:55.262132+00	1037	1016	completed	\N
274	LINE-C	B-20260325-0274	SKU-2011	2	2026-03-25 14:09:33.318563+00	2026-03-25 18:42:24.838822+00	1035	994	completed	\N
275	LINE-D	B-20260509-0275	SKU-3050	5	2026-05-09 22:26:22.254724+00	2026-05-10 03:59:56.199108+00	1071	1040	completed	\N
276	LINE-A	B-20260421-0276	SKU-1001	5	2026-04-21 06:20:33.245542+00	2026-04-21 13:10:01.800613+00	812	792	completed	\N
277	LINE-B	B-20260320-0277	SKU-1002	3	2026-03-20 14:19:23.353624+00	2026-03-20 20:53:24.5293+00	886	860	completed	\N
278	LINE-C	B-20260321-0278	SKU-1003	1	2026-03-21 22:29:18.696872+00	2026-03-22 01:22:36.292497+00	1119	1105	completed	\N
279	LINE-D	B-20260325-0279	SKU-2010	4	2026-03-25 06:09:58.144551+00	2026-03-25 08:53:27.194156+00	1004	948	completed	\N
280	LINE-A	B-20260420-0280	SKU-2011	7	2026-04-20 14:28:32.312467+00	2026-04-20 16:09:14.182641+00	822	427	test	\N
281	LINE-B	B-20260331-0281	SKU-3050	3	2026-03-31 22:20:08.202543+00	2026-04-01 04:50:19.355152+00	1094	1037	completed	\N
282	LINE-C	B-20260504-0282	SKU-1001	4	2026-05-04 06:26:35.457181+00	2026-05-04 13:45:57.032025+00	957	910	completed	\N
283	LINE-D	B-20260428-0283	SKU-1002	1	2026-04-28 14:26:33.590817+00	2026-04-28 18:21:50.638043+00	965	964	completed	\N
284	LINE-A	B-20260423-0284	SKU-1003	3	2026-04-23 22:17:36.827308+00	2026-04-23 23:59:28.575618+00	927	899	completed	\N
285	LINE-B	B-20260407-0285	SKU-2010	3	2026-04-07 06:16:25.606696+00	2026-04-07 08:59:42.908932+00	852	856	completed	\N
286	LINE-C	B-20260408-0286	SKU-2011	7	2026-04-08 14:15:48.320994+00	2026-04-08 17:26:21.674191+00	1034	1045	completed	\N
287	LINE-D	B-20260328-0287	SKU-3050	7	2026-03-28 22:09:59.16784+00	2026-03-29 02:10:20.480099+00	973	976	completed	\N
288	LINE-A	B-20260512-0288	SKU-1001	2	2026-05-12 06:00:24.28872+00	2026-05-12 08:58:42.797689+00	985	972	completed	\N
289	LINE-B	B-20260508-0289	SKU-1002	2	2026-05-08 14:27:18.931221+00	2026-05-08 19:33:41.353711+00	943	888	completed	\N
290	LINE-C	B-20260515-0290	SKU-1003	5	2026-05-15 22:14:00.310631+00	2026-05-16 01:54:04.314097+00	1139	1069	completed	\N
291	LINE-D	B-20260427-0291	SKU-2010	1	2026-04-27 06:05:37.985462+00	2026-04-27 07:42:47.889505+00	1035	1003	completed	\N
292	LINE-A	B-20260407-0292	SKU-2011	3	2026-04-07 14:06:05.977191+00	2026-04-07 17:55:04.0958+00	942	533	test	\N
293	LINE-B	B-20260324-0293	SKU-3050	4	2026-03-24 22:19:37.586936+00	2026-03-25 01:11:06.098497+00	953	915	completed	\N
294	LINE-C	B-20260405-0294	SKU-1001	3	2026-04-05 06:05:11.615682+00	2026-04-05 13:32:08.326798+00	1091	1019	completed	\N
295	LINE-D	B-20260320-0295	SKU-1002	6	2026-03-20 14:03:53.841364+00	2026-03-20 20:09:05.383216+00	1037	997	completed	\N
296	LINE-A	B-20260507-0296	SKU-1003	5	2026-05-07 22:14:45.139056+00	2026-05-08 01:06:13.372196+00	1110	1044	completed	\N
297	LINE-B	B-20260413-0297	SKU-2010	7	2026-04-13 06:09:44.480776+00	2026-04-13 12:52:53.701563+00	1163	1147	completed	\N
298	LINE-C	B-20260402-0298	SKU-2011	5	2026-04-02 14:28:44.143+00	2026-04-02 20:27:51.092764+00	978	961	completed	\N
299	LINE-D	B-20260507-0299	SKU-3050	3	2026-05-07 22:23:01.075457+00	2026-05-08 04:11:56.760681+00	895	851	completed	\N
300	LINE-A	B-20260319-0300	SKU-1001	4	2026-03-19 06:19:11.983118+00	2026-03-19 10:38:44.655168+00	806	749	completed	\N
301	LINE-B	B-20260504-0301	SKU-1002	4	2026-05-04 14:08:29.40418+00	2026-05-04 16:50:44.935549+00	1016	966	completed	\N
302	LINE-C	B-20260327-0302	SKU-1003	7	2026-03-27 22:01:36.000451+00	2026-03-28 04:12:24.851269+00	1110	1103	completed	\N
303	LINE-D	B-20260320-0303	SKU-2010	6	2026-03-20 06:28:24.904495+00	2026-03-20 12:52:16.933448+00	860	846	completed	\N
304	LINE-A	B-20260513-0304	SKU-2011	4	2026-05-13 14:20:33.210389+00	2026-05-13 16:29:17.999149+00	1186	1198	completed	\N
305	LINE-B	B-20260415-0305	SKU-3050	7	2026-04-15 22:29:25.531606+00	2026-04-16 03:53:27.797384+00	802	742	completed	\N
306	LINE-C	B-20260411-0306	SKU-1001	2	2026-04-11 06:11:11.991551+00	2026-04-11 11:16:08.633683+00	853	791	completed	\N
307	LINE-D	B-20260415-0307	SKU-1002	1	2026-04-15 14:00:38.256307+00	2026-04-15 21:26:24.805377+00	915	915	completed	\N
308	LINE-A	B-20260427-0308	SKU-1003	8	2026-04-27 22:18:48.187116+00	2026-04-28 02:47:47.849601+00	862	848	completed	\N
309	LINE-B	B-20260428-0309	SKU-2010	5	2026-04-28 06:08:00.770754+00	2026-04-28 11:35:57.912964+00	893	898	completed	\N
310	LINE-C	B-20260412-0310	SKU-2011	5	2026-04-12 14:13:56.544043+00	2026-04-12 16:53:13.081502+00	919	865	completed	\N
311	LINE-D	B-20260318-0311	SKU-3050	7	2026-03-18 22:14:45.987809+00	2026-03-18 23:08:01.252901+00	834	160	aborted	\N
312	LINE-A	B-20260319-0312	SKU-1001	1	2026-03-19 06:18:46.032791+00	2026-03-19 11:26:27.468038+00	1183	1205	completed	\N
313	LINE-B	B-20260323-0313	SKU-1002	7	2026-03-23 14:07:08.618713+00	2026-03-23 18:47:16.744585+00	1148	1070	completed	\N
314	LINE-C	B-20260329-0314	SKU-1003	4	2026-03-29 22:09:38.429589+00	2026-03-30 03:13:58.800763+00	1177	1086	completed	\N
315	LINE-D	B-20260508-0315	SKU-2010	7	2026-05-08 06:20:20.11794+00	2026-05-08 10:25:44.082748+00	934	867	completed	\N
316	LINE-A	B-20260511-0316	SKU-2011	1	2026-05-11 14:25:52.254401+00	2026-05-11 21:25:27.593219+00	839	796	completed	\N
317	LINE-B	B-20260516-0317	SKU-3050	8	2026-05-16 22:15:40.515625+00	2026-05-17 03:58:40.075097+00	1138	1137	completed	\N
318	LINE-C	B-20260510-0318	SKU-1001	6	2026-05-10 06:28:05.878636+00	2026-05-10 10:12:11.208597+00	843	823	completed	\N
319	LINE-D	B-20260419-0319	SKU-1002	3	2026-04-19 14:06:33.522546+00	2026-04-19 16:36:24.642007+00	925	921	completed	\N
320	LINE-A	B-20260319-0320	SKU-1003	4	2026-03-19 22:15:34.376636+00	2026-03-20 01:21:09.056266+00	939	931	completed	\N
321	LINE-B	B-20260326-0321	SKU-2010	5	2026-03-26 06:04:43.150964+00	2026-03-26 13:22:16.520495+00	806	651	test	\N
322	LINE-C	B-20260317-0322	SKU-2011	2	2026-03-17 14:05:00.395408+00	2026-03-17 16:16:21.142168+00	911	911	completed	\N
323	LINE-D	B-20260410-0323	SKU-3050	6	2026-04-10 22:25:07.463465+00	2026-04-11 05:06:56.577161+00	1071	767	test	\N
324	LINE-A	B-20260514-0324	SKU-1001	1	2026-05-14 06:21:26.345735+00	2026-05-14 10:10:57.341317+00	926	876	completed	\N
325	LINE-B	B-20260516-0325	SKU-1002	7	2026-05-16 14:26:01.623282+00	2026-05-16 19:56:32.411635+00	879	709	test	\N
326	LINE-C	B-20260510-0326	SKU-1003	3	2026-05-10 22:13:53.249679+00	2026-05-11 00:17:38.872596+00	1113	1133	completed	\N
327	LINE-D	B-20260318-0327	SKU-2010	5	2026-03-18 06:00:00.298691+00	2026-03-18 08:56:06.540076+00	1104	1094	completed	\N
328	LINE-A	B-20260401-0328	SKU-2011	1	2026-04-01 14:02:36.720735+00	2026-04-01 15:50:45.02954+00	825	762	completed	\N
329	LINE-B	B-20260408-0329	SKU-3050	6	2026-04-08 22:09:52.195807+00	2026-04-09 03:28:02.481278+00	1175	1166	completed	\N
330	LINE-C	B-20260420-0330	SKU-1001	1	2026-04-20 06:25:01.157566+00	2026-04-20 11:43:22.971593+00	1058	994	completed	\N
331	LINE-D	B-20260327-0331	SKU-1002	2	2026-03-27 14:19:01.502296+00	2026-03-27 17:53:19.262846+00	802	790	completed	\N
332	LINE-A	B-20260328-0332	SKU-1003	3	2026-03-28 22:07:21.524464+00	2026-03-28 23:09:30.505681+00	985	420	aborted	\N
333	LINE-B	B-20260424-0333	SKU-2010	2	2026-04-24 06:03:52.161357+00	2026-04-24 08:48:35.931143+00	920	902	completed	\N
334	LINE-C	B-20260409-0334	SKU-2011	6	2026-04-09 14:02:21.423854+00	2026-04-09 17:03:21.273362+00	1132	1073	completed	\N
335	LINE-D	B-20260408-0335	SKU-3050	3	2026-04-08 22:00:40.155341+00	2026-04-09 01:36:57.387695+00	961	962	completed	\N
336	LINE-A	B-20260514-0336	SKU-1001	7	2026-05-14 06:18:31.716434+00	2026-05-14 12:23:21.599947+00	837	849	completed	\N
337	LINE-B	B-20260402-0337	SKU-1002	3	2026-04-02 14:07:28.639072+00	2026-04-02 18:20:52.769338+00	1122	1093	completed	\N
338	LINE-C	B-20260515-0338	SKU-1003	8	2026-05-15 22:03:41.997377+00	2026-05-15 23:46:05.922735+00	873	877	completed	\N
339	LINE-D	B-20260327-0339	SKU-2010	7	2026-03-27 06:02:59.73374+00	2026-03-27 08:24:11.761612+00	1193	1181	completed	\N
340	LINE-A	B-20260504-0340	SKU-2011	7	2026-05-04 14:02:43.702786+00	2026-05-04 21:14:54.055338+00	972	908	completed	\N
341	LINE-B	B-20260425-0341	SKU-3050	1	2026-04-25 22:02:31.406728+00	2026-04-26 01:21:18.750283+00	843	813	completed	\N
342	LINE-C	B-20260509-0342	SKU-1001	6	2026-05-09 06:04:22.268694+00	2026-05-09 09:00:45.039114+00	1173	1117	completed	\N
343	LINE-D	B-20260512-0343	SKU-1002	6	2026-05-12 14:00:47.545707+00	2026-05-12 15:36:56.146993+00	1151	121	aborted	\N
344	LINE-A	B-20260402-0344	SKU-1003	7	2026-04-02 22:14:16.434394+00	2026-04-03 03:27:00.851451+00	871	860	completed	\N
345	LINE-B	B-20260501-0345	SKU-2010	5	2026-05-01 06:22:17.702032+00	2026-05-01 11:59:54.573596+00	1066	1062	completed	\N
346	LINE-C	B-20260326-0346	SKU-2011	5	2026-03-26 14:12:56.914496+00	2026-03-26 18:36:05.640411+00	848	854	completed	\N
347	LINE-D	B-20260513-0347	SKU-3050	7	2026-05-13 22:05:13.882569+00	2026-05-14 03:54:35.770883+00	1070	1009	completed	\N
348	LINE-A	B-20260419-0348	SKU-1001	5	2026-04-19 06:02:14.587649+00	2026-04-19 09:16:56.740782+00	1147	1119	completed	\N
349	LINE-B	B-20260330-0349	SKU-1002	3	2026-03-30 14:16:24.553118+00	2026-03-30 21:33:35.498443+00	840	841	completed	\N
350	LINE-C	B-20260409-0350	SKU-1003	3	2026-04-09 22:19:13.890194+00	2026-04-10 03:51:57.778583+00	840	782	completed	\N
351	LINE-D	B-20260325-0351	SKU-2010	4	2026-03-25 06:25:32.405014+00	2026-03-25 11:20:41.079833+00	1032	960	completed	\N
352	LINE-A	B-20260320-0352	SKU-2011	4	2026-03-20 14:22:50.658154+00	2026-03-20 18:21:34.325074+00	841	792	completed	\N
353	LINE-B	B-20260330-0353	SKU-3050	4	2026-03-30 22:16:06.145433+00	2026-03-31 00:11:05.291056+00	1004	990	completed	\N
354	LINE-C	B-20260416-0354	SKU-1001	4	2026-04-16 06:22:56.994659+00	2026-04-16 10:46:21.255708+00	1004	1014	completed	\N
355	LINE-D	B-20260418-0355	SKU-1002	3	2026-04-18 14:01:26.304084+00	2026-04-18 20:58:02.47504+00	1027	1030	completed	\N
356	LINE-A	B-20260429-0356	SKU-1003	7	2026-04-29 22:29:52.564351+00	2026-04-30 00:19:01.370367+00	1074	1077	completed	\N
357	LINE-B	B-20260429-0357	SKU-2010	2	2026-04-29 06:19:21.503706+00	2026-04-29 09:50:40.975424+00	1109	1113	completed	\N
358	LINE-C	B-20260404-0358	SKU-2011	6	2026-04-04 14:25:37.761124+00	2026-04-04 19:33:46.467977+00	878	824	completed	\N
359	LINE-D	B-20260504-0359	SKU-3050	7	2026-05-04 22:28:54.86504+00	2026-05-05 05:39:23.806514+00	1168	1173	completed	\N
360	LINE-A	B-20260404-0360	SKU-1001	2	2026-04-04 06:08:28.370626+00	2026-04-04 09:17:24.905857+00	1003	992	completed	\N
361	LINE-B	B-20260423-0361	SKU-1002	7	2026-04-23 14:26:23.375812+00	2026-04-23 18:19:52.294321+00	839	826	completed	\N
362	LINE-C	B-20260515-0362	SKU-1003	6	2026-05-15 22:08:38.758944+00	2026-05-15 23:45:00.44475+00	921	876	completed	\N
363	LINE-D	B-20260318-0363	SKU-2010	3	2026-03-18 06:04:25.909418+00	2026-03-18 12:34:05.564195+00	1188	1176	completed	\N
364	LINE-A	B-20260322-0364	SKU-2011	5	2026-03-22 14:21:27.378474+00	2026-03-22 16:43:45.343351+00	965	934	completed	\N
365	LINE-B	B-20260511-0365	SKU-3050	6	2026-05-11 22:21:23.012769+00	2026-05-12 02:16:31.510087+00	999	946	completed	\N
366	LINE-C	B-20260326-0366	SKU-1001	7	2026-03-26 06:07:08.944579+00	2026-03-26 07:31:14.032022+00	1196	378	aborted	\N
367	LINE-D	B-20260413-0367	SKU-1002	8	2026-04-13 14:01:15.01173+00	2026-04-13 21:28:37.14293+00	873	839	completed	\N
368	LINE-A	B-20260323-0368	SKU-1003	4	2026-03-23 22:17:20.307917+00	2026-03-24 00:02:51.263579+00	929	875	completed	\N
369	LINE-B	B-20260415-0369	SKU-2010	4	2026-04-15 06:00:34.731958+00	2026-04-15 08:26:57.524767+00	803	785	completed	\N
370	LINE-C	B-20260324-0370	SKU-2011	3	2026-03-24 14:25:51.568594+00	2026-03-24 20:54:08.929344+00	995	1003	completed	\N
371	LINE-D	B-20260328-0371	SKU-3050	7	2026-03-28 22:09:52.126989+00	2026-03-29 02:38:03.660882+00	1120	1091	completed	\N
372	LINE-A	B-20260408-0372	SKU-1001	5	2026-04-08 06:05:13.004225+00	2026-04-08 09:05:02.451341+00	916	868	completed	\N
373	LINE-B	B-20260429-0373	SKU-1002	5	2026-04-29 14:25:24.086852+00	2026-04-29 19:40:15.329135+00	983	977	completed	\N
374	LINE-C	B-20260403-0374	SKU-1003	8	2026-04-03 22:28:37.448967+00	2026-04-04 00:45:09.226954+00	1015	1028	completed	\N
375	LINE-D	B-20260503-0375	SKU-2010	5	2026-05-03 06:21:08.314318+00	2026-05-03 10:40:29.037908+00	812	756	completed	\N
376	LINE-A	B-20260504-0376	SKU-2011	3	2026-05-04 14:23:22.24862+00	2026-05-04 15:20:02.264087+00	919	141	aborted	\N
377	LINE-B	B-20260506-0377	SKU-3050	3	2026-05-06 22:26:31.10462+00	2026-05-07 04:55:43.376747+00	1132	1132	completed	\N
378	LINE-C	B-20260321-0378	SKU-1001	2	2026-03-21 06:29:06.019303+00	2026-03-21 10:02:03.194861+00	846	860	completed	\N
379	LINE-D	B-20260319-0379	SKU-1002	4	2026-03-19 14:17:45.714752+00	2026-03-19 18:20:12.845718+00	826	761	completed	\N
380	LINE-A	B-20260322-0380	SKU-1003	1	2026-03-22 22:12:12.693169+00	2026-03-23 03:03:16.334279+00	1151	1136	completed	\N
381	LINE-B	B-20260410-0381	SKU-2010	3	2026-04-10 06:08:54.808435+00	2026-04-10 13:37:11.063399+00	1008	983	completed	\N
382	LINE-C	B-20260508-0382	SKU-2011	1	2026-05-08 14:19:51.362718+00	2026-05-08 20:35:52.371423+00	830	846	completed	\N
383	LINE-D	B-20260419-0383	SKU-3050	2	2026-04-19 22:21:40.165457+00	2026-04-20 03:32:55.585892+00	992	985	completed	\N
384	LINE-A	B-20260516-0384	SKU-1001	6	2026-05-16 06:29:08.078732+00	2026-05-16 10:43:07.087891+00	1128	1076	completed	\N
385	LINE-B	B-20260317-0385	SKU-1002	6	2026-03-17 14:07:37.407412+00	2026-03-17 17:14:34.594268+00	841	857	completed	\N
386	LINE-C	B-20260428-0386	SKU-1003	4	2026-04-28 22:26:19.589469+00	2026-04-29 00:22:27.08753+00	1101	1074	completed	\N
387	LINE-D	B-20260416-0387	SKU-2010	3	2026-04-16 06:06:19.261615+00	2026-04-16 12:39:57.633347+00	1149	1145	completed	\N
388	LINE-A	B-20260410-0388	SKU-2011	5	2026-04-10 14:03:21.607238+00	2026-04-10 21:26:51.631314+00	841	839	completed	\N
389	LINE-B	B-20260322-0389	SKU-3050	5	2026-03-22 22:14:05.782625+00	2026-03-23 00:18:22.363825+00	1156	1099	completed	\N
390	LINE-C	B-20260504-0390	SKU-1001	4	2026-05-04 06:29:15.60957+00	2026-05-04 12:23:14.293603+00	1016	1029	completed	\N
391	LINE-D	B-20260430-0391	SKU-1002	4	2026-04-30 14:00:17.977867+00	2026-04-30 20:17:53.38146+00	819	777	completed	\N
392	LINE-A	B-20260503-0392	SKU-1003	6	2026-05-03 22:03:00.498353+00	2026-05-04 00:17:45.842612+00	1128	1129	completed	\N
393	LINE-B	B-20260405-0393	SKU-2010	4	2026-04-05 06:18:20.836729+00	2026-04-05 07:55:18.082666+00	993	955	completed	\N
394	LINE-C	B-20260429-0394	SKU-2011	4	2026-04-29 14:24:58.912577+00	2026-04-29 19:37:52.6436+00	929	934	completed	\N
395	LINE-D	B-20260422-0395	SKU-3050	2	2026-04-22 22:24:18.86204+00	2026-04-23 02:47:41.636681+00	980	943	completed	\N
396	LINE-A	B-20260329-0396	SKU-1001	2	2026-03-29 06:10:03.882114+00	2026-03-29 11:14:57.036042+00	1123	1039	completed	\N
397	LINE-B	B-20260319-0397	SKU-1002	1	2026-03-19 14:03:55.007218+00	2026-03-19 18:50:42.086146+00	1065	985	completed	\N
398	LINE-C	B-20260428-0398	SKU-1003	2	2026-04-28 22:18:49.310357+00	2026-04-29 05:08:44.129006+00	1030	970	completed	\N
399	LINE-D	B-20260331-0399	SKU-2010	7	2026-03-31 06:22:26.229362+00	2026-03-31 12:50:19.266668+00	861	818	completed	\N
400	LINE-A	B-20260328-0400	SKU-2011	3	2026-03-28 14:22:37.415158+00	2026-03-28 18:23:16.251847+00	958	916	completed	\N
401	LINE-B	B-20260327-0401	SKU-3050	2	2026-03-27 22:02:38.441402+00	2026-03-28 00:37:45.896071+00	1019	963	completed	\N
402	LINE-C	B-20260423-0402	SKU-1001	2	2026-04-23 06:21:09.785052+00	2026-04-23 13:23:43.851809+00	1066	1001	completed	\N
403	LINE-D	B-20260323-0403	SKU-1002	2	2026-03-23 14:10:31.208437+00	2026-03-23 18:38:39.553152+00	953	941	completed	\N
404	LINE-A	B-20260426-0404	SKU-1003	3	2026-04-26 22:28:43.081365+00	2026-04-26 23:59:09.467964+00	948	911	completed	\N
405	LINE-B	B-20260422-0405	SKU-2010	2	2026-04-22 06:27:48.429528+00	2026-04-22 11:48:22.176581+00	840	813	completed	\N
406	LINE-C	B-20260408-0406	SKU-2011	3	2026-04-08 14:03:24.352418+00	2026-04-08 17:49:06.760094+00	840	835	completed	\N
407	LINE-D	B-20260419-0407	SKU-3050	3	2026-04-19 22:28:59.923897+00	2026-04-20 01:03:00.305037+00	1064	989	completed	\N
408	LINE-A	B-20260329-0408	SKU-1001	8	2026-03-29 06:15:51.582209+00	2026-03-29 07:21:04.994955+00	1071	383	aborted	\N
409	LINE-B	B-20260430-0409	SKU-1002	4	2026-04-30 14:20:30.284728+00	2026-04-30 18:24:33.064543+00	1129	1048	completed	\N
410	LINE-C	B-20260410-0410	SKU-1003	7	2026-04-10 22:29:24.461469+00	2026-04-11 00:50:11.624767+00	1060	1013	completed	\N
411	LINE-D	B-20260424-0411	SKU-2010	8	2026-04-24 06:07:58.212465+00	2026-04-24 09:23:39.822124+00	1097	1033	completed	\N
412	LINE-A	B-20260406-0412	SKU-2011	7	2026-04-06 14:10:19.654434+00	2026-04-06 21:29:27.696349+00	883	872	completed	\N
413	LINE-B	B-20260325-0413	SKU-3050	7	2026-03-25 22:09:58.686374+00	2026-03-25 23:21:51.793865+00	890	352	aborted	\N
414	LINE-C	B-20260419-0414	SKU-1001	5	2026-04-19 06:15:05.839537+00	2026-04-19 06:51:30.41198+00	1001	392	aborted	\N
415	LINE-D	B-20260408-0415	SKU-1002	4	2026-04-08 14:14:41.592992+00	2026-04-08 20:36:07.674313+00	910	898	completed	\N
416	LINE-A	B-20260328-0416	SKU-1003	5	2026-03-28 22:17:45.566705+00	2026-03-29 03:50:18.286197+00	1104	1097	completed	\N
417	LINE-B	B-20260428-0417	SKU-2010	3	2026-04-28 06:16:11.418845+00	2026-04-28 09:58:26.526185+00	804	765	completed	\N
418	LINE-C	B-20260319-0418	SKU-2011	3	2026-03-19 14:15:05.880005+00	2026-03-19 17:31:43.375675+00	1069	995	completed	\N
419	LINE-D	B-20260427-0419	SKU-3050	5	2026-04-27 22:10:35.994593+00	2026-04-27 23:48:52.526758+00	955	917	completed	\N
420	LINE-A	B-20260409-0420	SKU-1001	2	2026-04-09 06:16:23.633393+00	2026-04-09 13:05:22.31152+00	909	919	completed	\N
421	LINE-B	B-20260502-0421	SKU-1002	3	2026-05-02 14:11:06.408749+00	2026-05-02 19:24:53.625835+00	1126	1061	completed	\N
422	LINE-C	B-20260501-0422	SKU-1003	5	2026-05-01 22:27:36.912107+00	2026-05-02 04:09:07.728006+00	1163	1129	completed	\N
423	LINE-D	B-20260420-0423	SKU-2010	8	2026-04-20 06:08:19.208064+00	2026-04-20 13:07:28.128815+00	1013	993	completed	\N
424	LINE-A	B-20260320-0424	SKU-2011	3	2026-03-20 14:13:13.942057+00	2026-03-20 17:04:46.373416+00	1112	1118	completed	\N
425	LINE-B	B-20260416-0425	SKU-3050	1	2026-04-16 22:24:30.028507+00	2026-04-17 03:40:21.428636+00	960	958	completed	\N
426	LINE-C	B-20260420-0426	SKU-1001	6	2026-04-20 06:20:24.277702+00	2026-04-20 08:50:53.412402+00	844	839	completed	\N
427	LINE-D	B-20260414-0427	SKU-1002	4	2026-04-14 14:10:09.882037+00	2026-04-14 16:09:55.295271+00	839	774	completed	\N
428	LINE-A	B-20260329-0428	SKU-1003	8	2026-03-29 22:17:52.404274+00	2026-03-30 03:00:21.220842+00	996	995	completed	\N
429	LINE-B	B-20260513-0429	SKU-2010	2	2026-05-13 06:11:10.947733+00	2026-05-13 12:05:27.982427+00	800	773	completed	\N
430	LINE-C	B-20260430-0430	SKU-2011	8	2026-04-30 14:05:30.568939+00	2026-04-30 15:41:00.020077+00	1075	1025	completed	\N
431	LINE-D	B-20260506-0431	SKU-3050	5	2026-05-06 22:10:01.070502+00	2026-05-07 02:15:13.891637+00	934	949	completed	\N
432	LINE-A	B-20260321-0432	SKU-1001	2	2026-03-21 06:01:34.871619+00	2026-03-21 08:47:34.980904+00	809	806	completed	\N
433	LINE-B	B-20260506-0433	SKU-1002	5	2026-05-06 14:16:31.02608+00	2026-05-06 17:46:22.920917+00	931	858	completed	\N
434	LINE-C	B-20260420-0434	SKU-1003	2	2026-04-20 22:29:12.886155+00	2026-04-21 05:08:19.27585+00	809	803	completed	\N
435	LINE-D	B-20260503-0435	SKU-2010	5	2026-05-03 06:07:42.464031+00	2026-05-03 07:58:17.720822+00	834	800	completed	\N
436	LINE-A	B-20260405-0436	SKU-2011	2	2026-04-05 14:09:10.879937+00	2026-04-05 19:04:08.496945+00	1043	996	completed	\N
437	LINE-B	B-20260418-0437	SKU-3050	5	2026-04-18 22:18:11.286071+00	2026-04-19 01:03:57.227156+00	925	901	completed	\N
438	LINE-C	B-20260418-0438	SKU-1001	2	2026-04-18 06:16:41.848546+00	2026-04-18 09:59:22.097603+00	811	764	completed	\N
439	LINE-D	B-20260417-0439	SKU-1002	7	2026-04-17 14:14:34.622376+00	2026-04-17 20:37:14.364038+00	996	943	completed	\N
440	LINE-A	B-20260515-0440	SKU-1003	6	2026-05-15 22:23:07.946733+00	2026-05-15 23:53:29.566131+00	1144	1140	completed	\N
441	LINE-B	B-20260414-0441	SKU-2010	4	2026-04-14 06:23:00.700771+00	2026-04-14 10:54:58.983796+00	819	826	completed	\N
442	LINE-C	B-20260418-0442	SKU-2011	5	2026-04-18 14:19:13.766536+00	2026-04-18 16:05:58.066724+00	1175	750	test	\N
443	LINE-D	B-20260407-0443	SKU-3050	3	2026-04-07 22:06:35.939882+00	2026-04-08 03:25:43.193103+00	1056	1060	completed	\N
444	LINE-A	B-20260427-0444	SKU-1001	6	2026-04-27 06:19:08.938069+00	2026-04-27 11:49:27.959326+00	802	806	completed	\N
445	LINE-B	B-20260417-0445	SKU-1002	3	2026-04-17 14:04:33.15032+00	2026-04-17 19:47:21.48185+00	1151	1116	completed	\N
446	LINE-C	B-20260512-0446	SKU-1003	7	2026-05-12 22:10:19.577982+00	2026-05-13 01:31:56.242502+00	941	904	completed	\N
447	LINE-D	B-20260513-0447	SKU-2010	3	2026-05-13 06:22:24.110029+00	2026-05-13 09:42:02.011993+00	868	849	completed	\N
448	LINE-A	B-20260403-0448	SKU-2011	2	2026-04-03 14:22:15.882138+00	2026-04-03 17:22:31.866835+00	877	834	completed	\N
449	LINE-B	B-20260508-0449	SKU-3050	7	2026-05-08 22:11:56.448017+00	2026-05-08 22:40:06.909641+00	1161	327	aborted	\N
450	LINE-C	B-20260515-0450	SKU-1001	3	2026-05-15 06:21:36.902011+00	2026-05-15 08:55:02.059026+00	1006	927	completed	\N
451	LINE-D	B-20260415-0451	SKU-1002	1	2026-04-15 14:24:02.671635+00	2026-04-15 17:09:45.846547+00	926	511	test	\N
452	LINE-A	B-20260504-0452	SKU-1003	3	2026-05-04 22:07:29.55269+00	2026-05-05 02:58:28.350552+00	996	933	completed	\N
453	LINE-B	B-20260417-0453	SKU-2010	2	2026-04-17 06:21:17.855858+00	2026-04-17 12:00:23.042064+00	944	902	completed	\N
454	LINE-C	B-20260329-0454	SKU-2011	3	2026-03-29 14:02:14.471547+00	2026-03-29 21:29:51.766615+00	1177	950	test	\N
455	LINE-D	B-20260416-0455	SKU-3050	7	2026-04-16 22:24:29.632517+00	2026-04-17 00:46:22.100295+00	1014	1029	completed	\N
456	LINE-A	B-20260428-0456	SKU-1001	5	2026-04-28 06:27:53.293221+00	2026-04-28 12:24:58.067282+00	1034	957	completed	\N
457	LINE-B	B-20260412-0457	SKU-1002	7	2026-04-12 14:14:03.314009+00	2026-04-12 16:21:58.873354+00	978	952	completed	\N
458	LINE-C	B-20260404-0458	SKU-1003	4	2026-04-04 22:02:39.165277+00	2026-04-05 01:36:40.866056+00	976	917	completed	\N
459	LINE-D	B-20260430-0459	SKU-2010	7	2026-04-30 06:15:56.035044+00	2026-04-30 13:18:01.711686+00	816	773	completed	\N
460	LINE-A	B-20260513-0460	SKU-2011	7	2026-05-13 14:11:12.221275+00	2026-05-13 16:54:44.492085+00	1142	602	test	\N
461	LINE-B	B-20260409-0461	SKU-3050	3	2026-04-09 22:28:54.54436+00	2026-04-09 23:00:25.583401+00	1113	460	aborted	\N
462	LINE-C	B-20260501-0462	SKU-1001	5	2026-05-01 06:01:04.5254+00	2026-05-01 12:02:43.216285+00	1074	1091	completed	\N
463	LINE-D	B-20260502-0463	SKU-1002	3	2026-05-02 14:14:56.510306+00	2026-05-02 18:36:52.590153+00	1020	963	completed	\N
464	LINE-A	B-20260409-0464	SKU-1003	6	2026-04-09 22:00:35.98473+00	2026-04-10 01:23:21.315421+00	908	864	completed	\N
465	LINE-B	B-20260327-0465	SKU-2010	3	2026-03-27 06:27:46.564675+00	2026-03-27 11:36:58.079533+00	852	868	completed	\N
466	LINE-C	B-20260502-0466	SKU-2011	3	2026-05-02 14:17:18.51906+00	2026-05-02 20:55:51.770743+00	1027	1013	completed	\N
467	LINE-D	B-20260319-0467	SKU-3050	3	2026-03-19 22:02:53.239022+00	2026-03-20 04:48:56.322151+00	1051	1057	completed	\N
468	LINE-A	B-20260421-0468	SKU-1001	3	2026-04-21 06:04:52.379503+00	2026-04-21 12:51:40.240486+00	863	831	completed	\N
469	LINE-B	B-20260503-0469	SKU-1002	4	2026-05-03 14:01:56.157727+00	2026-05-03 15:16:51.147434+00	1017	216	aborted	\N
470	LINE-C	B-20260322-0470	SKU-1003	7	2026-03-22 22:03:24.42668+00	2026-03-22 22:58:03.619134+00	1149	189	aborted	\N
471	LINE-D	B-20260402-0471	SKU-2010	5	2026-04-02 06:27:27.883378+00	2026-04-02 09:53:48.842055+00	1033	1025	completed	\N
472	LINE-A	B-20260417-0472	SKU-2011	4	2026-04-17 14:26:09.071245+00	2026-04-17 16:02:56.145212+00	1040	1043	completed	\N
473	LINE-B	B-20260420-0473	SKU-3050	4	2026-04-20 22:01:48.054548+00	2026-04-20 23:58:08.584333+00	932	932	completed	\N
474	LINE-C	B-20260402-0474	SKU-1001	5	2026-04-02 06:07:30.553672+00	2026-04-02 10:31:55.333508+00	1138	1080	completed	\N
475	LINE-D	B-20260515-0475	SKU-1002	3	2026-05-15 14:13:00.161779+00	2026-05-15 17:38:55.002289+00	957	899	completed	\N
476	LINE-A	B-20260406-0476	SKU-1003	5	2026-04-06 22:15:37.023753+00	2026-04-07 00:43:33.747118+00	850	826	completed	\N
477	LINE-B	B-20260329-0477	SKU-2010	5	2026-03-29 06:02:35.880721+00	2026-03-29 12:30:12.527055+00	1147	1168	completed	\N
478	LINE-C	B-20260328-0478	SKU-2011	7	2026-03-28 14:25:17.377195+00	2026-03-28 14:56:11.634866+00	818	213	aborted	\N
479	LINE-D	B-20260421-0479	SKU-3050	2	2026-04-21 22:07:32.305664+00	2026-04-22 04:55:21.4728+00	1007	999	completed	\N
480	LINE-A	B-20260427-0480	SKU-1001	7	2026-04-27 06:27:52.324759+00	2026-04-27 11:06:06.381782+00	837	829	completed	\N
481	LINE-B	B-20260430-0481	SKU-1002	5	2026-04-30 14:29:02.599673+00	2026-04-30 18:45:04.491384+00	896	825	completed	\N
482	LINE-C	B-20260512-0482	SKU-1003	2	2026-05-12 22:25:21.678903+00	2026-05-13 02:27:41.028811+00	865	817	completed	\N
483	LINE-D	B-20260407-0483	SKU-2010	6	2026-04-07 06:07:23.168858+00	2026-04-07 08:50:16.150098+00	1119	1078	completed	\N
484	LINE-A	B-20260411-0484	SKU-2011	4	2026-04-11 14:15:37.770972+00	2026-04-11 19:50:02.266974+00	1094	1065	completed	\N
485	LINE-B	B-20260319-0485	SKU-3050	3	2026-03-19 22:18:11.754255+00	2026-03-20 04:02:37.354249+00	1045	985	completed	\N
486	LINE-C	B-20260323-0486	SKU-1001	7	2026-03-23 06:28:50.462158+00	2026-03-23 11:45:05.751654+00	933	902	completed	\N
487	LINE-D	B-20260327-0487	SKU-1002	1	2026-03-27 14:01:45.180805+00	2026-03-27 17:12:33.414331+00	1005	963	completed	\N
488	LINE-A	B-20260408-0488	SKU-1003	7	2026-04-08 22:25:05.472169+00	2026-04-09 00:26:51.109178+00	1052	1003	completed	\N
489	LINE-B	B-20260317-0489	SKU-2010	5	2026-03-17 06:13:39.522938+00	2026-03-17 10:18:55.393795+00	1079	1004	completed	\N
490	LINE-C	B-20260319-0490	SKU-2011	7	2026-03-19 14:12:45.717496+00	2026-03-19 18:56:01.766766+00	940	895	completed	\N
491	LINE-D	B-20260405-0491	SKU-3050	2	2026-04-05 22:13:07.422274+00	2026-04-06 02:18:55.47541+00	1159	1164	completed	\N
492	LINE-A	B-20260413-0492	SKU-1001	4	2026-04-13 06:23:31.188395+00	2026-04-13 08:13:43.14216+00	944	943	completed	\N
493	LINE-B	B-20260415-0493	SKU-1002	3	2026-04-15 14:21:16.899558+00	2026-04-15 20:26:10.013017+00	929	883	completed	\N
494	LINE-C	B-20260508-0494	SKU-1003	4	2026-05-08 22:25:35.000681+00	2026-05-09 02:12:58.054279+00	809	812	completed	\N
495	LINE-D	B-20260319-0495	SKU-2010	4	2026-03-19 06:20:59.288701+00	2026-03-19 08:11:34.37242+00	843	777	completed	\N
496	LINE-A	B-20260429-0496	SKU-2011	5	2026-04-29 14:27:23.76642+00	2026-04-29 21:40:45.275211+00	828	789	completed	\N
497	LINE-B	B-20260511-0497	SKU-3050	7	2026-05-11 22:16:51.03421+00	2026-05-11 23:45:01.810544+00	839	243	aborted	\N
498	LINE-C	B-20260429-0498	SKU-1001	6	2026-04-29 06:08:08.558009+00	2026-04-29 07:47:20.59668+00	1116	1088	completed	\N
499	LINE-D	B-20260429-0499	SKU-1002	1	2026-04-29 14:15:06.27953+00	2026-04-29 20:31:57.606877+00	1112	1109	completed	\N
500	LINE-A	B-20260409-0500	SKU-1003	5	2026-04-09 22:06:47.700171+00	2026-04-09 23:58:02.901484+00	878	892	completed	\N
501	LINE-B	B-20260425-0501	SKU-2010	3	2026-04-25 06:19:05.357923+00	2026-04-25 10:26:26.803454+00	1192	1142	completed	\N
502	LINE-C	B-20260430-0502	SKU-2011	6	2026-04-30 14:21:35.386176+00	2026-04-30 21:29:35.885204+00	934	932	completed	\N
503	LINE-D	B-20260419-0503	SKU-3050	1	2026-04-19 22:09:03.646106+00	2026-04-20 02:16:41.653755+00	827	840	completed	\N
504	LINE-A	B-20260503-0504	SKU-1001	3	2026-05-03 06:08:06.426415+00	2026-05-03 13:17:41.945937+00	977	977	completed	\N
505	LINE-B	B-20260408-0505	SKU-1002	1	2026-04-08 14:10:58.356132+00	2026-04-08 18:59:08.843984+00	1020	975	completed	\N
506	LINE-C	B-20260407-0506	SKU-1003	1	2026-04-07 22:18:00.792066+00	2026-04-08 00:09:20.403332+00	1125	1071	completed	\N
507	LINE-D	B-20260320-0507	SKU-2010	2	2026-03-20 06:19:31.455444+00	2026-03-20 08:02:59.843762+00	1130	1152	completed	\N
508	LINE-A	B-20260412-0508	SKU-2011	7	2026-04-12 14:15:03.561942+00	2026-04-12 19:18:51.695237+00	1144	1053	completed	\N
509	LINE-B	B-20260330-0509	SKU-3050	2	2026-03-30 22:20:06.771479+00	2026-03-31 01:31:49.552359+00	880	887	completed	\N
510	LINE-C	B-20260326-0510	SKU-1001	3	2026-03-26 06:21:56.497684+00	2026-03-26 10:13:42.747217+00	942	931	completed	\N
511	LINE-D	B-20260323-0511	SKU-1002	1	2026-03-23 14:10:59.338298+00	2026-03-23 16:12:33.650888+00	908	904	completed	\N
512	LINE-A	B-20260510-0512	SKU-1003	3	2026-05-10 22:15:40.953085+00	2026-05-11 02:37:51.617181+00	1006	999	completed	\N
513	LINE-B	B-20260426-0513	SKU-2010	2	2026-04-26 06:23:35.744976+00	2026-04-26 09:54:44.207275+00	902	853	completed	\N
514	LINE-C	B-20260419-0514	SKU-2011	5	2026-04-19 14:22:47.392882+00	2026-04-19 21:04:26.159471+00	889	831	completed	\N
515	LINE-D	B-20260421-0515	SKU-3050	7	2026-04-21 22:21:35.558212+00	2026-04-22 00:33:28.790327+00	891	873	completed	\N
516	LINE-A	B-20260504-0516	SKU-1001	3	2026-05-04 06:26:57.120667+00	2026-05-04 12:13:04.44648+00	1078	1078	completed	\N
517	LINE-B	B-20260419-0517	SKU-1002	3	2026-04-19 14:17:20.747181+00	2026-04-19 19:00:28.755385+00	1092	1039	completed	\N
518	LINE-C	B-20260427-0518	SKU-1003	7	2026-04-27 22:06:07.863928+00	2026-04-28 02:44:06.073022+00	1032	1044	completed	\N
519	LINE-D	B-20260318-0519	SKU-2010	5	2026-03-18 06:00:29.29423+00	2026-03-18 11:25:26.763233+00	965	924	completed	\N
520	LINE-A	B-20260410-0520	SKU-2011	6	2026-04-10 14:02:50.439024+00	2026-04-10 18:08:17.620338+00	927	868	completed	\N
521	LINE-B	B-20260324-0521	SKU-3050	8	2026-03-24 22:11:34.458452+00	2026-03-25 02:38:32.345323+00	879	826	completed	\N
522	LINE-C	B-20260502-0522	SKU-1001	6	2026-05-02 06:22:24.170901+00	2026-05-02 06:53:19.18585+00	1033	118	aborted	\N
523	LINE-D	B-20260512-0523	SKU-1002	7	2026-05-12 14:09:41.867547+00	2026-05-12 17:21:38.66679+00	848	831	completed	\N
524	LINE-A	B-20260509-0524	SKU-1003	7	2026-05-09 22:21:01.75784+00	2026-05-10 01:02:39.146804+00	860	865	completed	\N
525	LINE-B	B-20260403-0525	SKU-2010	5	2026-04-03 06:27:32.186974+00	2026-04-03 11:55:34.094036+00	993	983	completed	\N
526	LINE-C	B-20260508-0526	SKU-2011	3	2026-05-08 14:08:49.146254+00	2026-05-08 16:41:25.213945+00	1150	1146	completed	\N
527	LINE-D	B-20260327-0527	SKU-3050	1	2026-03-27 22:15:13.307863+00	2026-03-28 03:23:58.708451+00	956	910	completed	\N
528	LINE-A	B-20260513-0528	SKU-1001	6	2026-05-13 06:02:12.50152+00	2026-05-13 12:04:05.823512+00	880	837	completed	\N
529	LINE-B	B-20260413-0529	SKU-1002	2	2026-04-13 14:29:52.635764+00	2026-04-13 18:45:41.782293+00	1151	1147	completed	\N
530	LINE-C	B-20260509-0530	SKU-1003	2	2026-05-09 22:19:19.497091+00	2026-05-10 01:37:51.847393+00	1180	1203	completed	\N
531	LINE-D	B-20260505-0531	SKU-2010	5	2026-05-05 06:28:46.402463+00	2026-05-05 12:41:44.39206+00	1039	958	completed	\N
532	LINE-A	B-20260512-0532	SKU-2011	4	2026-05-12 14:15:41.883486+00	2026-05-12 20:29:14.068743+00	1137	1140	completed	\N
533	LINE-B	B-20260409-0533	SKU-3050	7	2026-04-09 22:15:28.73978+00	2026-04-10 04:20:38.559048+00	1010	984	completed	\N
534	LINE-C	B-20260317-0534	SKU-1001	3	2026-03-17 06:04:58.968922+00	2026-03-17 13:21:03.578883+00	1109	1074	completed	\N
535	LINE-D	B-20260511-0535	SKU-1002	7	2026-05-11 14:15:59.723564+00	2026-05-11 19:29:58.928245+00	861	797	completed	\N
536	LINE-A	B-20260411-0536	SKU-1003	8	2026-04-11 22:15:03.772118+00	2026-04-12 04:24:25.85239+00	1101	1083	completed	\N
537	LINE-B	B-20260424-0537	SKU-2010	5	2026-04-24 06:14:04.958788+00	2026-04-24 09:15:10.497049+00	947	947	completed	\N
538	LINE-C	B-20260403-0538	SKU-2011	5	2026-04-03 14:12:35.165854+00	2026-04-03 16:23:09.146097+00	1095	1039	completed	\N
539	LINE-D	B-20260318-0539	SKU-3050	5	2026-03-18 22:29:05.708136+00	2026-03-19 03:26:58.842677+00	920	896	completed	\N
540	LINE-A	B-20260502-0540	SKU-1001	6	2026-05-02 06:22:32.66871+00	2026-05-02 13:43:08.841194+00	1095	1063	completed	\N
541	LINE-B	B-20260501-0541	SKU-1002	7	2026-05-01 14:22:45.685277+00	2026-05-01 20:24:16.804818+00	1164	1177	completed	\N
542	LINE-C	B-20260321-0542	SKU-1003	6	2026-03-21 22:05:35.013002+00	2026-03-22 02:29:59.321841+00	853	813	completed	\N
543	LINE-D	B-20260411-0543	SKU-2010	4	2026-04-11 06:06:04.871463+00	2026-04-11 07:40:06.607562+00	1123	1143	completed	\N
544	LINE-A	B-20260505-0544	SKU-2011	3	2026-05-05 14:10:27.717006+00	2026-05-05 16:04:20.685664+00	851	811	completed	\N
545	LINE-B	B-20260331-0545	SKU-3050	4	2026-03-31 22:22:42.17593+00	2026-04-01 02:51:42.337728+00	1084	1052	completed	\N
546	LINE-C	B-20260419-0546	SKU-1001	2	2026-04-19 06:25:00.576167+00	2026-04-19 13:33:57.165591+00	800	747	completed	\N
547	LINE-D	B-20260320-0547	SKU-1002	2	2026-03-20 14:02:15.002595+00	2026-03-20 21:10:42.326713+00	982	909	completed	\N
548	LINE-A	B-20260413-0548	SKU-1003	7	2026-04-13 22:14:56.197708+00	2026-04-14 03:38:06.315862+00	1148	1113	completed	\N
549	LINE-B	B-20260501-0549	SKU-2010	5	2026-05-01 06:17:47.16365+00	2026-05-01 12:30:33.058391+00	836	845	completed	\N
550	LINE-C	B-20260426-0550	SKU-2011	1	2026-04-26 14:01:41.238691+00	2026-04-26 19:00:45.535129+00	1175	1120	completed	\N
551	LINE-D	B-20260516-0551	SKU-3050	6	2026-05-16 22:00:04.89367+00	2026-05-17 04:44:42.439514+00	980	904	completed	\N
552	LINE-A	B-20260324-0552	SKU-1001	5	2026-03-24 06:05:06.182133+00	2026-03-24 09:52:42.604614+00	943	945	completed	\N
553	LINE-B	B-20260418-0553	SKU-1002	6	2026-04-18 14:16:44.282644+00	2026-04-18 16:58:56.022299+00	802	745	completed	\N
554	LINE-C	B-20260320-0554	SKU-1003	2	2026-03-20 22:02:25.832262+00	2026-03-21 02:30:51.422431+00	915	912	completed	\N
555	LINE-D	B-20260319-0555	SKU-2010	4	2026-03-19 06:22:25.778256+00	2026-03-19 08:26:38.466977+00	1190	1154	completed	\N
556	LINE-A	B-20260424-0556	SKU-2011	6	2026-04-24 14:24:46.904458+00	2026-04-24 16:10:25.998347+00	1197	1124	completed	\N
557	LINE-B	B-20260321-0557	SKU-3050	5	2026-03-21 22:23:01.662402+00	2026-03-22 04:39:13.871228+00	961	918	completed	\N
558	LINE-C	B-20260426-0558	SKU-1001	3	2026-04-26 06:22:23.00535+00	2026-04-26 11:39:17.620559+00	1081	1070	completed	\N
559	LINE-D	B-20260418-0559	SKU-1002	5	2026-04-18 14:27:21.193148+00	2026-04-18 21:34:47.337507+00	1107	1038	completed	\N
560	LINE-A	B-20260322-0560	SKU-1003	6	2026-03-22 22:02:31.389218+00	2026-03-23 02:15:46.203277+00	1137	1152	completed	\N
561	LINE-B	B-20260323-0561	SKU-2010	7	2026-03-23 06:27:09.450846+00	2026-03-23 08:59:56.421371+00	1009	953	completed	\N
562	LINE-C	B-20260502-0562	SKU-2011	6	2026-05-02 14:05:21.428742+00	2026-05-02 20:04:25.647809+00	941	884	completed	\N
563	LINE-D	B-20260321-0563	SKU-3050	4	2026-03-21 22:01:28.309941+00	2026-03-22 01:15:37.154853+00	875	875	completed	\N
564	LINE-A	B-20260424-0564	SKU-1001	8	2026-04-24 06:11:51.359082+00	2026-04-24 10:55:20.498911+00	818	823	completed	\N
565	LINE-B	B-20260425-0565	SKU-1002	7	2026-04-25 14:13:42.643014+00	2026-04-25 17:34:53.008048+00	1078	1074	completed	\N
566	LINE-C	B-20260419-0566	SKU-1003	5	2026-04-19 22:28:44.546415+00	2026-04-20 03:31:09.923564+00	944	890	completed	\N
567	LINE-D	B-20260506-0567	SKU-2010	2	2026-05-06 06:18:47.721138+00	2026-05-06 12:49:20.101913+00	986	965	completed	\N
568	LINE-A	B-20260504-0568	SKU-2011	7	2026-05-04 14:13:13.861758+00	2026-05-04 19:40:06.405868+00	993	993	completed	\N
569	LINE-B	B-20260322-0569	SKU-3050	1	2026-03-22 22:21:32.020207+00	2026-03-23 04:41:42.733409+00	810	811	completed	\N
570	LINE-C	B-20260508-0570	SKU-1001	5	2026-05-08 06:27:43.953266+00	2026-05-08 10:32:49.230533+00	984	939	completed	\N
571	LINE-D	B-20260419-0571	SKU-1002	6	2026-04-19 14:15:16.546763+00	2026-04-19 19:27:53.874084+00	1109	1058	completed	\N
572	LINE-A	B-20260505-0572	SKU-1003	6	2026-05-05 22:09:00.61574+00	2026-05-06 04:50:49.279325+00	1063	1080	completed	\N
573	LINE-B	B-20260417-0573	SKU-2010	6	2026-04-17 06:07:30.521138+00	2026-04-17 09:44:55.764425+00	933	877	completed	\N
574	LINE-C	B-20260502-0574	SKU-2011	5	2026-05-02 14:10:48.691806+00	2026-05-02 18:06:52.05399+00	873	809	completed	\N
575	LINE-D	B-20260514-0575	SKU-3050	8	2026-05-14 22:27:32.750813+00	2026-05-15 00:10:08.966181+00	1092	1088	completed	\N
576	LINE-A	B-20260327-0576	SKU-1001	4	2026-03-27 06:10:14.296958+00	2026-03-27 09:52:03.745236+00	950	953	completed	\N
577	LINE-B	B-20260424-0577	SKU-1002	5	2026-04-24 14:15:08.115821+00	2026-04-24 14:55:45.773027+00	818	219	aborted	\N
578	LINE-C	B-20260331-0578	SKU-1003	4	2026-03-31 22:10:02.822239+00	2026-04-01 00:52:10.25064+00	1060	1020	completed	\N
579	LINE-D	B-20260423-0579	SKU-2010	7	2026-04-23 06:22:19.184453+00	2026-04-23 13:26:28.476422+00	880	861	completed	\N
580	LINE-A	B-20260412-0580	SKU-2011	2	2026-04-12 14:09:25.20472+00	2026-04-12 16:20:31.034534+00	1157	1158	completed	\N
581	LINE-B	B-20260511-0581	SKU-3050	3	2026-05-11 22:29:13.260561+00	2026-05-12 00:37:08.933048+00	954	971	completed	\N
582	LINE-C	B-20260402-0582	SKU-1001	8	2026-04-02 06:19:59.880717+00	2026-04-02 12:13:57.132251+00	811	766	completed	\N
583	LINE-D	B-20260408-0583	SKU-1002	2	2026-04-08 14:01:41.4123+00	2026-04-08 15:03:34.30892+00	859	89	aborted	\N
584	LINE-A	B-20260405-0584	SKU-1003	7	2026-04-05 22:21:58.310702+00	2026-04-06 01:10:52.214238+00	862	843	completed	\N
585	LINE-B	B-20260503-0585	SKU-2010	2	2026-05-03 06:26:25.551569+00	2026-05-03 08:38:19.127339+00	1062	987	completed	\N
586	LINE-C	B-20260422-0586	SKU-2011	4	2026-04-22 14:05:30.063589+00	2026-04-22 16:53:26.229432+00	857	870	completed	\N
587	LINE-D	B-20260502-0587	SKU-3050	6	2026-05-02 22:03:20.348094+00	2026-05-03 02:40:35.404417+00	1150	718	test	\N
588	LINE-A	B-20260401-0588	SKU-1001	8	2026-04-01 06:01:48.344167+00	2026-04-01 07:40:46.515342+00	952	918	completed	\N
589	LINE-B	B-20260322-0589	SKU-1002	6	2026-03-22 14:12:06.345595+00	2026-03-22 20:15:55.148869+00	1117	1057	completed	\N
590	LINE-C	B-20260428-0590	SKU-1003	7	2026-04-28 22:13:23.515762+00	2026-04-29 02:30:57.148254+00	1043	990	completed	\N
591	LINE-D	B-20260417-0591	SKU-2010	8	2026-04-17 06:16:21.350849+00	2026-04-17 10:07:07.40895+00	879	844	completed	\N
592	LINE-A	B-20260502-0592	SKU-2011	1	2026-05-02 14:21:22.018457+00	2026-05-02 17:44:37.686622+00	1136	1119	completed	\N
593	LINE-B	B-20260416-0593	SKU-3050	7	2026-04-16 22:12:50.050637+00	2026-04-17 00:18:18.544098+00	1044	969	completed	\N
594	LINE-C	B-20260409-0594	SKU-1001	4	2026-04-09 06:12:14.030609+00	2026-04-09 12:16:36.346506+00	1171	1165	completed	\N
595	LINE-D	B-20260417-0595	SKU-1002	3	2026-04-17 14:03:08.236692+00	2026-04-17 19:46:14.075019+00	1114	1040	completed	\N
596	LINE-A	B-20260416-0596	SKU-1003	5	2026-04-16 22:07:02.464481+00	2026-04-17 01:59:10.355409+00	1002	1005	completed	\N
597	LINE-B	B-20260421-0597	SKU-2010	4	2026-04-21 06:17:01.020705+00	2026-04-21 11:01:37.845256+00	1042	1018	completed	\N
598	LINE-C	B-20260416-0598	SKU-2011	2	2026-04-16 14:27:46.5594+00	2026-04-16 16:56:05.131171+00	973	967	completed	\N
599	LINE-D	B-20260330-0599	SKU-3050	7	2026-03-30 22:15:32.674811+00	2026-03-30 23:53:19.495614+00	1133	1099	completed	\N
600	LINE-A	B-20260330-0600	SKU-1001	3	2026-03-30 06:22:02.646472+00	2026-03-30 12:44:34.585288+00	1096	1091	completed	\N
\.


--
-- Data for Name: quality_checks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.quality_checks (check_id, run_id, checked_at, parameter, value, lower_spec, upper_spec, in_spec) FROM stdin;
1	1	2026-04-08 20:15:01.771904+00	cap_torque_nm	1.43664455724417	1.2	1.8	t
2	1	2026-04-08 19:23:38.832474+00	fill_volume_ml	499.824616323897	495	505	t
3	1	2026-04-08 16:18:01.61563+00	label_offset_mm	-0.794	-1.0	1.0	t
4	1	2026-04-08 17:04:58.310257+00	net_weight_g	249.075514582062	248	252	t
5	1	2026-04-08 14:45:38.879369+00	net_weight_g	248.615097688295	248	252	t
6	1	2026-04-08 15:10:08.78441+00	net_weight_g	250.102743460818	248	252	t
7	2	2026-03-19 02:23:31.733189+00	fill_volume_ml	503.919338005791	495	505	t
8	2	2026-03-19 02:19:14.601151+00	fill_volume_ml	501.642109947456	495	505	t
9	3	2026-05-14 07:49:20.884264+00	cap_torque_nm	1.38339304890337	1.2	1.8	t
10	3	2026-05-14 12:05:28.952642+00	net_weight_g	250.996797407784	248	252	t
11	3	2026-05-14 13:17:52.848736+00	viscosity_cp	934.523109311088	800	1200	t
12	3	2026-05-14 10:42:31.70458+00	cap_torque_nm	1.43085419311518	1.2	1.8	t
13	3	2026-05-14 10:25:32.643324+00	label_offset_mm	0.873	-1.0	1.0	t
14	3	2026-05-14 06:12:18.207429+00	viscosity_cp	966.994816038	800	1200	t
15	4	2026-04-19 15:33:07.954934+00	fill_volume_ml	500.57815977516	495	505	t
16	4	2026-04-19 16:02:41.082707+00	fill_volume_ml	499.120979797451	495	505	t
17	4	2026-04-19 15:10:30.055839+00	viscosity_cp	1022.95626522558	800	1200	t
18	4	2026-04-19 15:11:29.246406+00	cap_torque_nm	1.37870122349344	1.2	1.8	t
19	5	2026-04-08 23:49:47.967838+00	net_weight_g	251.553917414571	248	252	t
20	5	2026-04-08 22:53:11.596711+00	label_offset_mm	-0.685	-1.0	1.0	t
21	5	2026-04-08 23:18:48.42588+00	net_weight_g	251.823230096904	248	252	t
22	5	2026-04-08 22:38:33.96161+00	viscosity_cp	1226.58400446961	800	1200	f
23	6	2026-04-18 08:53:12.778065+00	label_offset_mm	0.991	-1.0	1.0	t
24	6	2026-04-18 09:54:12.611263+00	cap_torque_nm	1.26301220740358	1.2	1.8	t
25	6	2026-04-18 08:09:14.618329+00	label_offset_mm	-0.330	-1.0	1.0	t
26	7	2026-04-07 17:13:06.070989+00	label_offset_mm	-0.524	-1.0	1.0	t
27	7	2026-04-07 16:31:46.931506+00	fill_volume_ml	499.256621040259	495	505	t
28	7	2026-04-07 20:34:35.218933+00	cap_torque_nm	1.52059572537537	1.2	1.8	t
29	8	2026-04-10 23:38:34.626596+00	fill_volume_ml	500.768371194651	495	505	t
30	8	2026-04-10 22:18:20.023394+00	fill_volume_ml	502.762894574721	495	505	t
31	8	2026-04-10 22:33:35.489141+00	cap_torque_nm	1.46141823121279	1.2	1.8	t
32	8	2026-04-10 23:24:28.695367+00	label_offset_mm	-1.036	-1.0	1.0	f
33	8	2026-04-10 23:10:31.464898+00	cap_torque_nm	1.27352037228136	1.2	1.8	t
34	8	2026-04-10 23:12:18.876018+00	viscosity_cp	1176.23791829441	800	1200	t
35	9	2026-05-08 07:59:42.247309+00	net_weight_g	251.609964011506	248	252	t
36	9	2026-05-08 08:03:48.345847+00	cap_torque_nm	1.36576270451336	1.2	1.8	t
37	9	2026-05-08 06:19:20.003331+00	fill_volume_ml	496.7465337414	495	505	t
38	9	2026-05-08 07:32:45.495054+00	cap_torque_nm	1.30192750871258	1.2	1.8	t
39	10	2026-03-24 20:25:35.724902+00	fill_volume_ml	498.6571621636	495	505	t
40	10	2026-03-24 18:34:36.638242+00	label_offset_mm	-1.065	-1.0	1.0	f
41	10	2026-03-24 15:07:35.290279+00	fill_volume_ml	499.968830905749	495	505	t
42	10	2026-03-24 17:41:44.006877+00	cap_torque_nm	1.48472893992414	1.2	1.8	t
43	10	2026-03-24 18:16:12.875444+00	net_weight_g	249.316428886418	248	252	t
44	11	2026-04-12 23:01:37.794413+00	net_weight_g	248.705182499207	248	252	t
45	11	2026-04-12 22:55:36.049216+00	cap_torque_nm	1.61980093359931	1.2	1.8	t
46	11	2026-04-13 00:43:20.500055+00	label_offset_mm	-1.132	-1.0	1.0	f
47	12	2026-04-23 07:35:01.205019+00	label_offset_mm	-0.589	-1.0	1.0	t
48	12	2026-04-23 07:58:49.557387+00	viscosity_cp	832.638722191866	800	1200	t
49	12	2026-04-23 08:17:06.718721+00	label_offset_mm	-0.103	-1.0	1.0	t
50	12	2026-04-23 07:49:12.314459+00	label_offset_mm	-0.105	-1.0	1.0	t
51	13	2026-04-29 17:50:46.225343+00	net_weight_g	248.877354066153	248	252	t
52	13	2026-04-29 16:40:36.629191+00	fill_volume_ml	500.290070128229	495	505	t
53	13	2026-04-29 16:36:04.136017+00	label_offset_mm	0.316	-1.0	1.0	t
54	14	2026-05-14 03:12:02.955781+00	cap_torque_nm	1.35937017590365	1.2	1.8	t
55	14	2026-05-14 05:14:38.65359+00	viscosity_cp	1205.79236550362	800	1200	f
56	14	2026-05-13 23:06:45.454918+00	viscosity_cp	1088.84486063084	800	1200	t
57	15	2026-05-11 08:41:37.042154+00	label_offset_mm	-0.252	-1.0	1.0	t
58	15	2026-05-11 08:20:48.04047+00	fill_volume_ml	496.644849281411	495	505	t
59	15	2026-05-11 07:56:42.001732+00	label_offset_mm	0.487	-1.0	1.0	t
60	16	2026-04-01 17:26:30.386491+00	label_offset_mm	0.118	-1.0	1.0	t
61	16	2026-04-01 20:13:52.17458+00	label_offset_mm	-0.251	-1.0	1.0	t
62	16	2026-04-01 18:18:52.109682+00	label_offset_mm	-0.360	-1.0	1.0	t
63	16	2026-04-01 15:57:29.332805+00	cap_torque_nm	1.34883144097536	1.2	1.8	t
64	17	2026-04-25 00:08:26.186532+00	fill_volume_ml	498.497760707882	495	505	t
65	17	2026-04-24 23:20:02.673741+00	net_weight_g	250.539829400319	248	252	t
66	17	2026-04-24 23:32:09.356116+00	net_weight_g	251.507410291052	248	252	t
67	17	2026-04-24 23:13:24.264176+00	label_offset_mm	-0.381	-1.0	1.0	t
68	18	2026-05-08 08:43:19.014043+00	cap_torque_nm	1.62798603625531	1.2	1.8	t
69	18	2026-05-08 06:54:55.895117+00	label_offset_mm	-0.172	-1.0	1.0	t
70	18	2026-05-08 07:30:10.886746+00	fill_volume_ml	502.94585306331	495	505	t
71	18	2026-05-08 06:31:51.717673+00	cap_torque_nm	1.4557086271468	1.2	1.8	t
72	18	2026-05-08 06:42:10.184418+00	label_offset_mm	-0.390	-1.0	1.0	t
73	18	2026-05-08 07:10:46.073085+00	net_weight_g	251.222400734141	248	252	t
74	19	2026-05-03 19:42:30.864977+00	fill_volume_ml	497.626036901943	495	505	t
75	19	2026-05-03 15:20:58.425545+00	net_weight_g	249.052886905276	248	252	t
76	19	2026-05-03 18:33:19.238252+00	fill_volume_ml	500.516660360261	495	505	t
77	19	2026-05-03 17:35:02.66275+00	net_weight_g	251.643315472943	248	252	t
78	19	2026-05-03 17:18:58.46582+00	viscosity_cp	911.843593706508	800	1200	t
79	20	2026-05-05 03:37:28.876354+00	fill_volume_ml	503.333030662222	495	505	t
80	20	2026-05-05 04:53:44.696657+00	net_weight_g	249.431566911591	248	252	t
81	20	2026-05-05 04:23:17.09691+00	cap_torque_nm	1.27381834358652	1.2	1.8	t
82	20	2026-05-04 23:28:48.297754+00	cap_torque_nm	1.52117869368132	1.2	1.8	t
83	21	2026-03-31 07:55:03.499791+00	label_offset_mm	-1.187	-1.0	1.0	f
84	21	2026-03-31 08:12:01.798479+00	fill_volume_ml	499.184905002225	495	505	t
85	22	2026-03-19 16:47:14.6931+00	viscosity_cp	1214.50722931841	800	1200	f
86	22	2026-03-19 20:33:39.018812+00	label_offset_mm	0.068	-1.0	1.0	t
87	22	2026-03-19 16:40:35.435787+00	net_weight_g	249.189488057552	248	252	t
88	22	2026-03-19 17:58:30.05862+00	net_weight_g	248.118604345946	248	252	t
89	23	2026-04-07 22:52:54.68546+00	net_weight_g	249.082875648744	248	252	t
90	23	2026-04-07 22:33:01.194996+00	fill_volume_ml	500.194926619984	495	505	t
91	23	2026-04-07 22:20:14.686766+00	cap_torque_nm	1.30739229126905	1.2	1.8	t
92	23	2026-04-07 23:58:31.099073+00	label_offset_mm	-0.311	-1.0	1.0	t
93	24	2026-04-27 09:07:31.173129+00	net_weight_g	250.797647799742	248	252	t
94	24	2026-04-27 08:25:29.833149+00	cap_torque_nm	1.56303318721316	1.2	1.8	t
95	24	2026-04-27 07:53:12.886157+00	fill_volume_ml	501.54178099789	495	505	t
96	24	2026-04-27 06:46:16.092758+00	fill_volume_ml	501.983917600792	495	505	t
97	25	2026-05-06 14:52:07.929602+00	label_offset_mm	-0.891	-1.0	1.0	t
98	25	2026-05-06 15:20:04.768814+00	label_offset_mm	-0.796	-1.0	1.0	t
99	26	2026-04-21 04:00:35.249716+00	viscosity_cp	1067.04400270476	800	1200	t
100	26	2026-04-21 01:27:10.444481+00	cap_torque_nm	1.52252571718225	1.2	1.8	t
101	26	2026-04-21 03:03:51.104859+00	viscosity_cp	1244.1265041808	800	1200	f
102	26	2026-04-20 23:36:39.122541+00	label_offset_mm	-0.173	-1.0	1.0	t
103	26	2026-04-21 02:08:08.467157+00	net_weight_g	249.203469826124	248	252	t
104	27	2026-05-12 08:31:57.193961+00	label_offset_mm	0.609	-1.0	1.0	t
105	27	2026-05-12 09:08:14.397854+00	label_offset_mm	0.827	-1.0	1.0	t
106	27	2026-05-12 12:31:58.347351+00	viscosity_cp	917.016345321647	800	1200	t
107	28	2026-03-20 15:09:51.142376+00	viscosity_cp	870.56473523535	800	1200	t
108	28	2026-03-20 15:08:48.118728+00	viscosity_cp	1095.23363274564	800	1200	t
109	29	2026-04-30 23:13:51.160292+00	viscosity_cp	1008.36601270171	800	1200	t
110	29	2026-04-30 22:58:25.207521+00	cap_torque_nm	1.64142835205896	1.2	1.8	t
111	29	2026-04-30 23:04:03.353751+00	label_offset_mm	0.555	-1.0	1.0	t
112	30	2026-04-27 06:59:41.632073+00	viscosity_cp	1031.77157036265	800	1200	t
113	30	2026-04-27 06:17:08.890688+00	label_offset_mm	0.702	-1.0	1.0	t
114	30	2026-04-27 06:17:02.888194+00	viscosity_cp	1197.47972293515	800	1200	t
115	30	2026-04-27 07:48:50.436417+00	viscosity_cp	801.508943311437	800	1200	t
116	30	2026-04-27 07:19:50.109324+00	cap_torque_nm	1.51663689536246	1.2	1.8	t
117	31	2026-04-13 16:03:55.504256+00	cap_torque_nm	1.46702139292114	1.2	1.8	t
118	31	2026-04-13 16:55:04.349958+00	net_weight_g	250.370044435641	248	252	t
119	31	2026-04-13 16:55:06.53976+00	fill_volume_ml	498.922925252347	495	505	t
120	32	2026-05-06 22:25:58.51383+00	viscosity_cp	1072.03300510759	800	1200	t
121	32	2026-05-06 22:12:33.774442+00	fill_volume_ml	498.244890497435	495	505	t
122	32	2026-05-06 22:09:44.356304+00	cap_torque_nm	1.73728234208472	1.2	1.8	t
123	32	2026-05-06 22:30:43.400982+00	cap_torque_nm	1.27930779881889	1.2	1.8	t
124	32	2026-05-06 23:25:13.735203+00	net_weight_g	249.447423769936	248	252	t
125	32	2026-05-06 22:45:39.857902+00	cap_torque_nm	1.39309167213419	1.2	1.8	t
126	33	2026-03-18 08:03:50.828602+00	label_offset_mm	0.490	-1.0	1.0	t
127	33	2026-03-18 08:50:24.048094+00	cap_torque_nm	1.6218931664039	1.2	1.8	t
128	33	2026-03-18 08:22:06.732581+00	cap_torque_nm	1.40884321967005	1.2	1.8	t
129	33	2026-03-18 06:44:12.297564+00	cap_torque_nm	1.65327472532394	1.2	1.8	t
130	34	2026-04-13 14:18:33.134062+00	fill_volume_ml	498.793653627728	495	505	t
131	34	2026-04-13 14:21:55.737253+00	viscosity_cp	1173.90001176542	800	1200	t
132	34	2026-04-13 16:56:06.446091+00	fill_volume_ml	500.01053081008	495	505	t
133	34	2026-04-13 14:13:38.01704+00	viscosity_cp	906.903081481556	800	1200	t
134	34	2026-04-13 16:52:33.097283+00	viscosity_cp	1188.64886971023	800	1200	t
135	34	2026-04-13 16:03:28.851635+00	net_weight_g	251.96797293992	248	252	t
136	35	2026-04-16 23:26:17.039828+00	net_weight_g	251.902316336539	248	252	t
137	35	2026-04-17 00:58:50.631357+00	label_offset_mm	-0.003	-1.0	1.0	t
138	35	2026-04-17 01:40:41.876148+00	label_offset_mm	-1.099	-1.0	1.0	f
139	35	2026-04-17 02:28:21.368322+00	viscosity_cp	1001.63565438917	800	1200	t
140	36	2026-04-26 07:55:40.282909+00	net_weight_g	249.223966366115	248	252	t
141	36	2026-04-26 08:28:37.528513+00	cap_torque_nm	1.62970180810225	1.2	1.8	t
142	37	2026-04-28 17:05:07.965017+00	net_weight_g	250.683490425294	248	252	t
143	37	2026-04-28 14:42:30.745265+00	fill_volume_ml	501.341366179926	495	505	t
144	37	2026-04-28 15:58:27.63301+00	label_offset_mm	0.768	-1.0	1.0	t
145	38	2026-03-18 01:01:10.557717+00	cap_torque_nm	1.53049598969766	1.2	1.8	t
146	38	2026-03-17 22:35:16.006389+00	label_offset_mm	-0.713	-1.0	1.0	t
147	38	2026-03-18 00:01:36.037951+00	net_weight_g	248.322769586771	248	252	t
148	38	2026-03-18 00:37:32.693064+00	fill_volume_ml	496.780415881753	495	505	t
149	38	2026-03-17 22:57:23.472635+00	fill_volume_ml	502.310768861372	495	505	t
150	39	2026-05-02 11:03:28.760567+00	net_weight_g	250.119372458884	248	252	t
151	39	2026-05-02 10:26:59.991085+00	fill_volume_ml	503.851521537852	495	505	t
152	39	2026-05-02 08:56:16.918477+00	label_offset_mm	0.420	-1.0	1.0	t
153	39	2026-05-02 08:53:06.499047+00	viscosity_cp	1099.53548529337	800	1200	t
154	40	2026-05-10 20:04:51.144349+00	cap_torque_nm	1.50985474589341	1.2	1.8	t
155	40	2026-05-10 18:14:36.245116+00	viscosity_cp	1093.36427409706	800	1200	t
156	40	2026-05-10 17:00:55.443445+00	viscosity_cp	997.327682303094	800	1200	t
157	41	2026-03-29 00:01:15.955213+00	cap_torque_nm	1.40617573530873	1.2	1.8	t
158	41	2026-03-29 00:59:12.941203+00	label_offset_mm	0.809	-1.0	1.0	t
159	41	2026-03-28 22:27:33.620633+00	viscosity_cp	855.885432467403	800	1200	t
160	41	2026-03-29 03:01:33.259469+00	cap_torque_nm	1.27491297788806	1.2	1.8	t
161	42	2026-03-27 06:31:06.970692+00	viscosity_cp	876.66968500385	800	1200	t
162	42	2026-03-27 08:11:35.514445+00	viscosity_cp	878.053716522988	800	1200	t
163	42	2026-03-27 11:16:16.525243+00	viscosity_cp	1009.62385883217	800	1200	t
164	42	2026-03-27 08:05:21.455493+00	viscosity_cp	1034.5500963793	800	1200	t
165	42	2026-03-27 08:01:41.281424+00	fill_volume_ml	500.232396677263	495	505	t
166	42	2026-03-27 10:43:49.6462+00	label_offset_mm	-1.007	-1.0	1.0	f
167	43	2026-05-11 15:20:57.163034+00	viscosity_cp	1190.91040080559	800	1200	t
168	43	2026-05-11 17:18:28.98922+00	net_weight_g	249.914653653143	248	252	t
169	43	2026-05-11 19:48:35.678675+00	label_offset_mm	-0.362	-1.0	1.0	t
170	43	2026-05-11 19:08:19.274528+00	label_offset_mm	-0.476	-1.0	1.0	t
171	43	2026-05-11 18:53:29.646118+00	label_offset_mm	0.054	-1.0	1.0	t
172	43	2026-05-11 19:16:46.017931+00	net_weight_g	249.038655724346	248	252	t
173	44	2026-05-11 23:28:26.593075+00	fill_volume_ml	497.408377785177	495	505	t
174	44	2026-05-11 22:39:42.755264+00	fill_volume_ml	502.602404665184	495	505	t
175	44	2026-05-12 00:05:04.468655+00	net_weight_g	250.882980711948	248	252	t
176	44	2026-05-11 22:55:44.258891+00	net_weight_g	251.507667213938	248	252	t
177	45	2026-04-07 06:40:37.230122+00	label_offset_mm	1.155	-1.0	1.0	f
178	45	2026-04-07 06:56:57.965679+00	label_offset_mm	0.594	-1.0	1.0	t
179	45	2026-04-07 07:12:36.798536+00	label_offset_mm	-0.644	-1.0	1.0	t
180	46	2026-04-16 14:33:36.444486+00	cap_torque_nm	1.37359803715153	1.2	1.8	t
181	46	2026-04-16 19:05:16.235971+00	fill_volume_ml	496.634764621606	495	505	t
182	46	2026-04-16 14:51:47.72323+00	cap_torque_nm	1.25045665567111	1.2	1.8	t
183	46	2026-04-16 18:59:51.147082+00	net_weight_g	251.600093483622	248	252	t
184	47	2026-04-28 22:47:27.514773+00	net_weight_g	248.83859322472	248	252	t
185	47	2026-04-28 23:00:58.50695+00	fill_volume_ml	503.463973132176	495	505	t
186	47	2026-04-29 00:34:12.89378+00	cap_torque_nm	1.37527811620937	1.2	1.8	t
187	47	2026-04-28 22:21:09.167674+00	viscosity_cp	1196.59425825947	800	1200	t
188	47	2026-04-28 23:22:03.413198+00	viscosity_cp	1078.51489527315	800	1200	t
189	48	2026-05-06 10:03:43.488164+00	cap_torque_nm	1.43793479818904	1.2	1.8	t
190	48	2026-05-06 09:00:59.879736+00	fill_volume_ml	496.502925516984	495	505	t
191	48	2026-05-06 06:19:48.891782+00	cap_torque_nm	1.52890200764917	1.2	1.8	t
192	49	2026-05-11 15:20:18.989945+00	cap_torque_nm	1.52261720556336	1.2	1.8	t
193	49	2026-05-11 14:23:51.746073+00	cap_torque_nm	1.62857426296902	1.2	1.8	t
194	50	2026-04-29 23:27:46.797974+00	label_offset_mm	-0.108	-1.0	1.0	t
195	50	2026-04-29 23:58:42.902789+00	viscosity_cp	1225.59968283212	800	1200	f
196	50	2026-04-29 22:51:48.155585+00	viscosity_cp	967.398669067103	800	1200	t
197	51	2026-03-22 07:04:12.744616+00	net_weight_g	248.090875011727	248	252	t
198	51	2026-03-22 08:44:09.779312+00	cap_torque_nm	1.46116246706822	1.2	1.8	t
199	51	2026-03-22 07:08:27.811189+00	fill_volume_ml	498.163997429774	495	505	t
200	51	2026-03-22 06:39:09.321209+00	net_weight_g	249.162628549715	248	252	t
201	51	2026-03-22 08:29:46.394593+00	fill_volume_ml	502.837989577842	495	505	t
202	51	2026-03-22 08:28:09.370536+00	net_weight_g	250.451287703932	248	252	t
203	52	2026-04-28 16:43:42.891052+00	label_offset_mm	-0.981	-1.0	1.0	t
204	52	2026-04-28 16:20:01.166865+00	cap_torque_nm	1.66843232790704	1.2	1.8	t
205	52	2026-04-28 17:23:58.037223+00	cap_torque_nm	1.33417040209624	1.2	1.8	t
206	53	2026-03-27 00:30:25.531048+00	fill_volume_ml	503.624165180749	495	505	t
207	53	2026-03-27 00:34:58.354251+00	viscosity_cp	993.92910078417	800	1200	t
208	53	2026-03-26 23:01:32.870273+00	net_weight_g	250.774643948437	248	252	t
209	53	2026-03-26 22:44:58.990795+00	label_offset_mm	0.238	-1.0	1.0	t
210	53	2026-03-27 00:13:10.366907+00	fill_volume_ml	501.204422241667	495	505	t
211	54	2026-03-20 07:42:11.411004+00	viscosity_cp	899.826795845824	800	1200	t
212	54	2026-03-20 11:03:29.201275+00	label_offset_mm	0.580	-1.0	1.0	t
213	54	2026-03-20 10:35:22.529794+00	net_weight_g	251.95556206863	248	252	t
214	54	2026-03-20 10:33:52.978788+00	label_offset_mm	-0.940	-1.0	1.0	t
215	55	2026-04-24 17:44:37.144334+00	cap_torque_nm	1.3260988424655	1.2	1.8	t
216	55	2026-04-24 16:26:24.075373+00	label_offset_mm	-0.331	-1.0	1.0	t
217	55	2026-04-24 17:41:40.699348+00	cap_torque_nm	1.60625179714727	1.2	1.8	t
218	55	2026-04-24 14:17:41.558138+00	net_weight_g	250.675359353834	248	252	t
219	56	2026-04-15 02:52:08.837538+00	label_offset_mm	-0.184	-1.0	1.0	t
220	56	2026-04-15 01:13:05.371051+00	viscosity_cp	1063.24866598068	800	1200	t
221	56	2026-04-15 01:06:28.858169+00	viscosity_cp	1065.17939473723	800	1200	t
222	56	2026-04-14 23:09:11.261995+00	net_weight_g	251.689557407054	248	252	t
223	56	2026-04-15 03:43:45.325447+00	fill_volume_ml	500.898887218581	495	505	t
224	57	2026-04-19 06:31:24.512214+00	cap_torque_nm	1.70594988425324	1.2	1.8	t
225	57	2026-04-19 07:11:50.193433+00	fill_volume_ml	496.008809464709	495	505	t
226	57	2026-04-19 07:11:29.239056+00	cap_torque_nm	1.29048117253019	1.2	1.8	t
227	58	2026-04-13 16:29:54.473734+00	viscosity_cp	993.270446749061	800	1200	t
228	58	2026-04-13 17:02:59.178245+00	cap_torque_nm	1.61795138332766	1.2	1.8	t
229	58	2026-04-13 18:15:34.765596+00	viscosity_cp	910.042862326485	800	1200	t
230	59	2026-05-01 02:40:57.143512+00	fill_volume_ml	496.397148403496	495	505	t
231	59	2026-05-01 02:08:26.203818+00	net_weight_g	251.507664869102	248	252	t
232	59	2026-04-30 22:38:51.44466+00	net_weight_g	251.641307663519	248	252	t
233	59	2026-05-01 03:02:02.759581+00	net_weight_g	251.114721758301	248	252	t
234	60	2026-04-29 07:03:10.823727+00	label_offset_mm	-1.118	-1.0	1.0	f
235	60	2026-04-29 07:08:40.635367+00	cap_torque_nm	1.29191865939467	1.2	1.8	t
236	60	2026-04-29 06:47:39.499883+00	label_offset_mm	-0.219	-1.0	1.0	t
237	60	2026-04-29 06:58:42.609679+00	fill_volume_ml	500.860974668304	495	505	t
238	60	2026-04-29 06:43:34.533675+00	viscosity_cp	1170.14477924198	800	1200	t
239	60	2026-04-29 06:46:43.117798+00	label_offset_mm	0.125	-1.0	1.0	t
240	61	2026-03-30 18:40:02.448344+00	label_offset_mm	-1.179	-1.0	1.0	f
241	61	2026-03-30 15:04:05.228233+00	fill_volume_ml	501.949784898085	495	505	t
242	61	2026-03-30 17:16:08.261511+00	fill_volume_ml	503.568917480566	495	505	t
243	61	2026-03-30 18:39:16.549972+00	viscosity_cp	880.389623555023	800	1200	t
244	61	2026-03-30 16:43:21.653606+00	label_offset_mm	-0.279	-1.0	1.0	t
245	61	2026-03-30 15:44:04.771483+00	fill_volume_ml	499.776395546818	495	505	t
246	62	2026-04-28 01:26:38.337397+00	label_offset_mm	1.193	-1.0	1.0	f
247	62	2026-04-28 02:29:45.291635+00	net_weight_g	250.065775831273	248	252	t
248	62	2026-04-28 00:43:06.190627+00	fill_volume_ml	500.104059546464	495	505	t
249	63	2026-04-12 06:57:34.653779+00	fill_volume_ml	498.493470568581	495	505	t
250	63	2026-04-12 09:44:23.277396+00	viscosity_cp	1224.95852919443	800	1200	f
251	63	2026-04-12 08:02:45.499269+00	net_weight_g	249.615011902431	248	252	t
252	63	2026-04-12 06:32:56.206352+00	net_weight_g	249.253970309287	248	252	t
253	64	2026-04-06 14:36:32.613294+00	viscosity_cp	1149.35338429734	800	1200	t
254	64	2026-04-06 14:31:30.184998+00	fill_volume_ml	496.511638994412	495	505	t
255	64	2026-04-06 14:17:18.21934+00	net_weight_g	251.104998770516	248	252	t
256	64	2026-04-06 14:16:40.765775+00	net_weight_g	249.746924058959	248	252	t
257	64	2026-04-06 14:20:57.808677+00	fill_volume_ml	498.953688899949	495	505	t
258	65	2026-04-07 23:55:19.190005+00	fill_volume_ml	502.333766503217	495	505	t
259	65	2026-04-07 22:51:35.164549+00	cap_torque_nm	1.52487771498111	1.2	1.8	t
260	66	2026-03-25 06:31:27.056545+00	label_offset_mm	0.947	-1.0	1.0	t
261	66	2026-03-25 08:20:15.025812+00	label_offset_mm	0.947	-1.0	1.0	t
262	66	2026-03-25 10:58:31.792714+00	label_offset_mm	0.940	-1.0	1.0	t
263	67	2026-05-10 14:50:15.564978+00	cap_torque_nm	1.56340691366554	1.2	1.8	t
264	67	2026-05-10 18:51:12.953094+00	label_offset_mm	-0.276	-1.0	1.0	t
265	67	2026-05-10 16:41:39.90259+00	viscosity_cp	980.98830403883	800	1200	t
266	67	2026-05-10 14:47:18.642761+00	net_weight_g	250.894501620661	248	252	t
267	67	2026-05-10 14:49:52.93784+00	cap_torque_nm	1.66280546464917	1.2	1.8	t
268	67	2026-05-10 16:06:53.232417+00	label_offset_mm	0.816	-1.0	1.0	t
269	68	2026-04-24 22:30:47.707382+00	net_weight_g	251.069784046543	248	252	t
270	68	2026-04-24 22:36:38.673637+00	cap_torque_nm	1.48548945930569	1.2	1.8	t
271	69	2026-05-08 08:19:27.557277+00	fill_volume_ml	497.219569387643	495	505	t
272	69	2026-05-08 10:56:34.092939+00	net_weight_g	250.125001040766	248	252	t
273	69	2026-05-08 06:27:33.879788+00	net_weight_g	249.483236764644	248	252	t
274	69	2026-05-08 11:09:17.719186+00	net_weight_g	251.172790239414	248	252	t
275	69	2026-05-08 06:40:58.37486+00	fill_volume_ml	502.325648595659	495	505	t
276	70	2026-04-07 19:52:50.471058+00	viscosity_cp	865.555826319158	800	1200	t
277	70	2026-04-07 16:13:49.774459+00	label_offset_mm	0.398	-1.0	1.0	t
278	70	2026-04-07 15:59:07.304522+00	viscosity_cp	1172.7077902193	800	1200	t
279	71	2026-05-16 23:02:25.553828+00	cap_torque_nm	1.59189878742516	1.2	1.8	t
280	71	2026-05-17 00:12:43.114685+00	cap_torque_nm	1.72930890658505	1.2	1.8	t
281	71	2026-05-16 22:58:08.077826+00	label_offset_mm	0.463	-1.0	1.0	t
282	71	2026-05-16 22:56:33.487681+00	label_offset_mm	-0.149	-1.0	1.0	t
283	71	2026-05-16 22:30:27.702569+00	fill_volume_ml	497.161649437975	495	505	t
284	71	2026-05-16 22:53:53.713319+00	fill_volume_ml	496.015022196079	495	505	t
285	72	2026-05-02 07:41:44.794371+00	viscosity_cp	1164.16003716086	800	1200	t
286	72	2026-05-02 06:57:32.124968+00	label_offset_mm	0.854	-1.0	1.0	t
287	72	2026-05-02 06:23:30.99775+00	viscosity_cp	938.219416898887	800	1200	t
288	72	2026-05-02 07:49:23.214393+00	viscosity_cp	1125.26767505279	800	1200	t
289	73	2026-03-27 19:13:03.466276+00	net_weight_g	250.881650647816	248	252	t
290	73	2026-03-27 14:26:49.524309+00	cap_torque_nm	1.34433286094153	1.2	1.8	t
291	73	2026-03-27 18:45:58.173202+00	viscosity_cp	754.336522095825	800	1200	f
292	73	2026-03-27 18:56:32.514367+00	cap_torque_nm	1.59073055516691	1.2	1.8	t
293	73	2026-03-27 17:55:15.14789+00	fill_volume_ml	501.102842416873	495	505	t
294	73	2026-03-27 14:37:08.74217+00	viscosity_cp	944.862952161577	800	1200	t
295	74	2026-03-19 22:48:24.767773+00	label_offset_mm	1.190	-1.0	1.0	f
296	74	2026-03-20 00:39:38.003008+00	label_offset_mm	0.150	-1.0	1.0	t
297	74	2026-03-20 00:10:44.574697+00	cap_torque_nm	1.66852031925975	1.2	1.8	t
298	74	2026-03-20 02:01:31.28541+00	net_weight_g	248.550791515427	248	252	t
299	75	2026-05-11 06:30:21.904273+00	viscosity_cp	875.364006299819	800	1200	t
300	75	2026-05-11 11:43:52.597161+00	label_offset_mm	1.021	-1.0	1.0	f
301	75	2026-05-11 13:18:10.371933+00	cap_torque_nm	1.56843707348796	1.2	1.8	t
302	75	2026-05-11 06:49:08.644026+00	label_offset_mm	-0.576	-1.0	1.0	t
303	75	2026-05-11 06:55:41.613868+00	net_weight_g	250.013956607762	248	252	t
304	75	2026-05-11 08:28:59.907558+00	viscosity_cp	1166.94236643264	800	1200	t
305	76	2026-05-05 19:57:18.674894+00	cap_torque_nm	1.41392712932997	1.2	1.8	t
306	76	2026-05-05 14:38:05.897842+00	label_offset_mm	0.646	-1.0	1.0	t
307	76	2026-05-05 15:56:49.629153+00	cap_torque_nm	1.48931593184051	1.2	1.8	t
308	76	2026-05-05 17:03:46.050915+00	net_weight_g	249.385299878428	248	252	t
309	77	2026-04-15 05:29:00.408499+00	label_offset_mm	1.009	-1.0	1.0	f
310	77	2026-04-15 02:41:01.05043+00	fill_volume_ml	502.032683684703	495	505	t
311	77	2026-04-14 22:31:31.826496+00	viscosity_cp	995.607063137356	800	1200	t
312	77	2026-04-15 05:20:21.104421+00	viscosity_cp	1042.42463423621	800	1200	t
313	77	2026-04-15 02:36:08.427707+00	viscosity_cp	894.574559977502	800	1200	t
314	78	2026-03-24 06:40:39.835917+00	label_offset_mm	1.085	-1.0	1.0	f
315	78	2026-03-24 07:56:29.324475+00	viscosity_cp	917.798614918408	800	1200	t
316	78	2026-03-24 07:36:46.560988+00	label_offset_mm	0.026	-1.0	1.0	t
317	79	2026-04-10 17:25:50.172663+00	net_weight_g	249.835416578826	248	252	t
318	79	2026-04-10 15:09:15.467228+00	fill_volume_ml	497.82612369179	495	505	t
319	79	2026-04-10 18:12:16.700884+00	cap_torque_nm	1.33660119755684	1.2	1.8	t
320	79	2026-04-10 15:47:37.685139+00	label_offset_mm	-0.446	-1.0	1.0	t
321	80	2026-05-08 22:17:52.77259+00	net_weight_g	251.145465291522	248	252	t
322	80	2026-05-09 00:19:04.037729+00	net_weight_g	250.277354779707	248	252	t
323	80	2026-05-09 01:22:15.823651+00	viscosity_cp	1076.7320551671	800	1200	t
324	80	2026-05-09 00:52:04.955863+00	net_weight_g	248.397234957994	248	252	t
325	81	2026-05-11 07:24:41.428019+00	net_weight_g	251.867883456262	248	252	t
326	81	2026-05-11 07:30:00.852687+00	fill_volume_ml	500.42780174036	495	505	t
327	81	2026-05-11 08:32:53.192964+00	viscosity_cp	808.699807929887	800	1200	t
328	82	2026-05-09 15:21:51.760837+00	cap_torque_nm	1.61216499157681	1.2	1.8	t
329	82	2026-05-09 14:51:25.15332+00	label_offset_mm	-0.554	-1.0	1.0	t
330	82	2026-05-09 15:46:57.751658+00	net_weight_g	250.026607551484	248	252	t
331	83	2026-03-27 22:56:11.500551+00	fill_volume_ml	496.318302786096	495	505	t
332	83	2026-03-27 23:16:52.593419+00	fill_volume_ml	500.22406050755	495	505	t
333	83	2026-03-27 22:16:40.023097+00	label_offset_mm	0.859	-1.0	1.0	t
334	83	2026-03-27 22:22:40.811388+00	label_offset_mm	-0.109	-1.0	1.0	t
335	84	2026-03-20 08:34:05.088468+00	label_offset_mm	0.741	-1.0	1.0	t
336	84	2026-03-20 07:31:42.85311+00	net_weight_g	250.875622723128	248	252	t
337	84	2026-03-20 07:29:13.119844+00	net_weight_g	248.580169064961	248	252	t
338	84	2026-03-20 11:28:02.451215+00	fill_volume_ml	502.207525977098	495	505	t
339	85	2026-04-03 14:14:43.167019+00	fill_volume_ml	502.52452257894	495	505	t
340	85	2026-04-03 19:45:50.611157+00	fill_volume_ml	501.773084424196	495	505	t
341	85	2026-04-03 20:11:28.568397+00	fill_volume_ml	498.843851411482	495	505	t
342	85	2026-04-03 18:27:24.318534+00	label_offset_mm	-0.685	-1.0	1.0	t
343	85	2026-04-03 17:08:06.852412+00	label_offset_mm	0.999	-1.0	1.0	t
344	86	2026-05-14 22:56:33.902316+00	fill_volume_ml	496.685477336264	495	505	t
345	86	2026-05-14 23:04:32.721946+00	cap_torque_nm	1.72368578655949	1.2	1.8	t
346	86	2026-05-15 03:46:34.851617+00	label_offset_mm	-0.002	-1.0	1.0	t
347	86	2026-05-15 03:29:36.865848+00	viscosity_cp	920.595675690761	800	1200	t
348	86	2026-05-15 02:51:29.762869+00	viscosity_cp	1042.91091839839	800	1200	t
349	86	2026-05-14 22:53:20.519224+00	cap_torque_nm	1.50340456451961	1.2	1.8	t
350	87	2026-04-06 12:16:20.036266+00	cap_torque_nm	1.30042145130414	1.2	1.8	t
351	87	2026-04-06 10:46:00.795938+00	fill_volume_ml	503.209850920343	495	505	t
352	87	2026-04-06 11:32:26.84248+00	cap_torque_nm	1.55610696615656	1.2	1.8	t
353	87	2026-04-06 12:30:59.328285+00	net_weight_g	250.148310305116	248	252	t
354	87	2026-04-06 09:05:19.109634+00	cap_torque_nm	1.31013800196824	1.2	1.8	t
355	88	2026-03-22 19:46:59.003999+00	fill_volume_ml	502.753895825766	495	505	t
356	88	2026-03-22 16:40:45.445618+00	net_weight_g	249.553792083107	248	252	t
357	88	2026-03-22 15:10:12.323128+00	viscosity_cp	1118.15356701731	800	1200	t
358	88	2026-03-22 14:43:27.549998+00	viscosity_cp	1218.41195731826	800	1200	f
359	88	2026-03-22 14:25:24.075006+00	cap_torque_nm	1.33394706647722	1.2	1.8	t
360	89	2026-03-28 22:59:23.552038+00	net_weight_g	250.246567008112	248	252	t
361	89	2026-03-28 23:42:48.25969+00	net_weight_g	249.375720464723	248	252	t
362	89	2026-03-28 22:48:45.560471+00	label_offset_mm	-1.178	-1.0	1.0	f
363	89	2026-03-28 22:57:00.392513+00	viscosity_cp	1152.75101683296	800	1200	t
364	89	2026-03-28 22:11:34.631639+00	net_weight_g	251.98245718936	248	252	t
365	90	2026-04-26 07:08:55.36082+00	viscosity_cp	1028.55112963305	800	1200	t
366	90	2026-04-26 09:18:36.198346+00	net_weight_g	251.920845415141	248	252	t
367	90	2026-04-26 11:32:40.962118+00	fill_volume_ml	503.445282274593	495	505	t
368	91	2026-05-05 15:39:15.705798+00	label_offset_mm	-0.710	-1.0	1.0	t
369	91	2026-05-05 16:40:50.032528+00	label_offset_mm	-1.109	-1.0	1.0	f
370	92	2026-03-18 22:21:40.295862+00	cap_torque_nm	1.3439629559258	1.2	1.8	t
371	92	2026-03-18 22:40:44.320252+00	viscosity_cp	758.483495742905	800	1200	f
372	92	2026-03-18 22:10:33.894641+00	net_weight_g	251.004682856832	248	252	t
373	93	2026-03-21 06:54:08.829407+00	net_weight_g	248.604812406785	248	252	t
374	93	2026-03-21 09:36:50.227953+00	label_offset_mm	1.191	-1.0	1.0	f
375	93	2026-03-21 10:22:14.156463+00	cap_torque_nm	1.58930715474202	1.2	1.8	t
376	93	2026-03-21 08:57:46.798081+00	viscosity_cp	1029.7372368543	800	1200	t
377	94	2026-05-03 15:47:15.22036+00	viscosity_cp	897.132932287799	800	1200	t
378	94	2026-05-03 16:05:49.136109+00	viscosity_cp	1148.65096394082	800	1200	t
379	95	2026-03-26 03:15:16.538257+00	fill_volume_ml	498.79998112102	495	505	t
380	95	2026-03-25 23:11:19.964424+00	cap_torque_nm	1.4053715229834	1.2	1.8	t
381	95	2026-03-25 22:32:27.436943+00	viscosity_cp	1101.40011692398	800	1200	t
382	95	2026-03-26 02:57:02.807534+00	net_weight_g	250.634418106917	248	252	t
383	95	2026-03-26 04:17:39.316205+00	net_weight_g	248.427971434602	248	252	t
384	96	2026-05-09 09:44:29.720367+00	cap_torque_nm	1.69762336643802	1.2	1.8	t
385	96	2026-05-09 10:50:10.847279+00	net_weight_g	249.989043329243	248	252	t
386	97	2026-05-03 14:44:02.515608+00	label_offset_mm	-0.459	-1.0	1.0	t
387	97	2026-05-03 14:08:02.538165+00	cap_torque_nm	1.41081817772333	1.2	1.8	t
388	97	2026-05-03 14:48:27.618627+00	net_weight_g	248.065739704438	248	252	t
389	97	2026-05-03 14:59:40.877718+00	fill_volume_ml	503.010797031095	495	505	t
390	97	2026-05-03 14:20:02.11766+00	net_weight_g	248.11469547739	248	252	t
391	98	2026-03-31 23:51:58.516185+00	net_weight_g	251.689906987273	248	252	t
392	98	2026-03-31 23:59:18.694154+00	viscosity_cp	875.039862100649	800	1200	t
393	98	2026-03-31 23:22:24.986945+00	viscosity_cp	1224.92988441029	800	1200	f
394	99	2026-04-13 12:37:28.963418+00	cap_torque_nm	1.63465891880866	1.2	1.8	t
395	99	2026-04-13 07:17:38.506313+00	net_weight_g	249.467733134196	248	252	t
396	100	2026-04-21 17:21:52.943697+00	cap_torque_nm	1.51585035973801	1.2	1.8	t
397	100	2026-04-21 14:42:31.786879+00	viscosity_cp	887.136958847393	800	1200	t
398	101	2026-05-02 01:15:12.4231+00	net_weight_g	249.258049948226	248	252	t
399	101	2026-05-02 01:16:53.763554+00	label_offset_mm	0.339	-1.0	1.0	t
400	102	2026-05-13 09:08:13.461762+00	label_offset_mm	-0.030	-1.0	1.0	t
401	102	2026-05-13 10:31:15.95929+00	fill_volume_ml	502.249163996466	495	505	t
402	102	2026-05-13 08:19:58.682744+00	fill_volume_ml	499.386532876939	495	505	t
403	102	2026-05-13 07:26:24.389373+00	fill_volume_ml	498.438668486043	495	505	t
404	103	2026-03-22 17:16:39.308945+00	cap_torque_nm	1.34019725335961	1.2	1.8	t
405	103	2026-03-22 17:12:12.082733+00	label_offset_mm	0.258	-1.0	1.0	t
406	103	2026-03-22 15:06:59.163271+00	viscosity_cp	882.927000428544	800	1200	t
407	103	2026-03-22 18:47:06.006583+00	label_offset_mm	-0.508	-1.0	1.0	t
408	104	2026-04-29 00:59:39.269826+00	label_offset_mm	-0.572	-1.0	1.0	t
409	104	2026-04-29 03:08:34.74684+00	net_weight_g	249.640215964944	248	252	t
410	104	2026-04-29 02:27:04.529949+00	viscosity_cp	1248.94774559552	800	1200	f
411	104	2026-04-29 00:07:08.256215+00	label_offset_mm	1.106	-1.0	1.0	f
412	104	2026-04-29 01:32:31.674577+00	net_weight_g	249.755821655706	248	252	t
413	105	2026-04-07 08:09:55.751483+00	net_weight_g	249.851503140816	248	252	t
414	105	2026-04-07 07:54:42.732741+00	label_offset_mm	0.979	-1.0	1.0	t
415	105	2026-04-07 09:06:33.692048+00	fill_volume_ml	497.371253612194	495	505	t
416	105	2026-04-07 07:11:18.256136+00	viscosity_cp	776.568362741829	800	1200	f
417	105	2026-04-07 10:45:49.994769+00	net_weight_g	251.617207918145	248	252	t
418	106	2026-03-21 18:38:30.415822+00	net_weight_g	250.315010177601	248	252	t
419	106	2026-03-21 16:58:44.905602+00	fill_volume_ml	502.155613861726	495	505	t
420	106	2026-03-21 14:27:23.495785+00	cap_torque_nm	1.69844206518104	1.2	1.8	t
421	106	2026-03-21 17:37:49.242976+00	viscosity_cp	1184.64318936468	800	1200	t
422	107	2026-04-25 23:20:53.540923+00	viscosity_cp	1213.73499702919	800	1200	f
423	107	2026-04-25 23:13:51.567405+00	fill_volume_ml	499.564782287807	495	505	t
424	107	2026-04-25 23:10:59.535414+00	fill_volume_ml	501.571488560606	495	505	t
425	107	2026-04-25 23:23:34.348515+00	fill_volume_ml	496.17138177017	495	505	t
426	107	2026-04-25 22:44:22.581479+00	label_offset_mm	-0.601	-1.0	1.0	t
427	108	2026-04-11 07:37:54.366201+00	viscosity_cp	1163.93441024921	800	1200	t
428	108	2026-04-11 09:07:29.514812+00	fill_volume_ml	500.857543160876	495	505	t
429	108	2026-04-11 07:59:14.015391+00	net_weight_g	250.626690908754	248	252	t
430	108	2026-04-11 07:46:20.930451+00	fill_volume_ml	500.42034936039	495	505	t
431	109	2026-04-05 17:11:45.898541+00	label_offset_mm	-1.119	-1.0	1.0	f
432	109	2026-04-05 16:50:52.497188+00	cap_torque_nm	1.54922862140903	1.2	1.8	t
433	110	2026-04-12 23:48:06.891764+00	label_offset_mm	-0.650	-1.0	1.0	t
434	110	2026-04-13 01:04:32.460403+00	cap_torque_nm	1.70334324782761	1.2	1.8	t
435	110	2026-04-12 23:18:54.581166+00	cap_torque_nm	1.36341021459674	1.2	1.8	t
436	111	2026-04-23 08:31:44.655812+00	viscosity_cp	1158.5825307998	800	1200	t
437	111	2026-04-23 08:01:43.877845+00	net_weight_g	251.3129003575	248	252	t
438	111	2026-04-23 08:08:47.559639+00	label_offset_mm	-0.926	-1.0	1.0	t
439	111	2026-04-23 09:13:12.180854+00	cap_torque_nm	1.59265326141794	1.2	1.8	t
440	111	2026-04-23 12:42:37.507229+00	net_weight_g	250.498968354599	248	252	t
441	112	2026-04-18 16:31:32.820713+00	viscosity_cp	1163.82706737898	800	1200	t
442	112	2026-04-18 17:06:21.117926+00	fill_volume_ml	503.306465685112	495	505	t
443	112	2026-04-18 15:16:30.663897+00	viscosity_cp	1242.68052763321	800	1200	f
444	112	2026-04-18 16:14:12.311707+00	net_weight_g	251.880584340574	248	252	t
445	113	2026-04-17 22:43:47.930793+00	cap_torque_nm	1.68901100404044	1.2	1.8	t
446	113	2026-04-17 23:08:31.789431+00	cap_torque_nm	1.34124819927162	1.2	1.8	t
447	113	2026-04-17 22:52:58.370217+00	fill_volume_ml	498.957188254755	495	505	t
448	113	2026-04-17 23:37:11.630542+00	net_weight_g	248.965416257249	248	252	t
449	113	2026-04-17 23:16:12.120576+00	net_weight_g	250.134586417158	248	252	t
450	113	2026-04-17 22:34:40.47407+00	label_offset_mm	1.011	-1.0	1.0	f
451	114	2026-04-10 06:45:54.614133+00	net_weight_g	251.434562253657	248	252	t
452	114	2026-04-10 07:19:27.814972+00	viscosity_cp	931.210553190211	800	1200	t
453	114	2026-04-10 07:11:02.814427+00	viscosity_cp	868.784140250514	800	1200	t
454	114	2026-04-10 07:08:57.754023+00	net_weight_g	248.085370851473	248	252	t
455	114	2026-04-10 07:54:09.011898+00	fill_volume_ml	500.197724338853	495	505	t
456	114	2026-04-10 06:56:46.912576+00	net_weight_g	249.76601650202	248	252	t
457	115	2026-03-31 17:14:25.113203+00	cap_torque_nm	1.57968712911825	1.2	1.8	t
458	115	2026-03-31 16:57:32.798093+00	label_offset_mm	-0.096	-1.0	1.0	t
459	115	2026-03-31 17:10:42.108044+00	viscosity_cp	998.083311247353	800	1200	t
460	115	2026-03-31 17:28:46.11332+00	label_offset_mm	0.582	-1.0	1.0	t
461	115	2026-03-31 16:27:57.680332+00	cap_torque_nm	1.29219836443467	1.2	1.8	t
462	115	2026-03-31 18:45:18.947861+00	label_offset_mm	0.686	-1.0	1.0	t
463	116	2026-03-23 23:19:07.062202+00	label_offset_mm	1.127	-1.0	1.0	f
464	116	2026-03-23 22:54:13.838393+00	label_offset_mm	-0.019	-1.0	1.0	t
465	116	2026-03-23 23:19:41.113037+00	label_offset_mm	0.154	-1.0	1.0	t
466	117	2026-05-01 09:25:28.949139+00	net_weight_g	251.053890050239	248	252	t
467	117	2026-05-01 08:45:38.310446+00	fill_volume_ml	497.473564802347	495	505	t
468	118	2026-05-10 15:37:18.017465+00	label_offset_mm	0.079	-1.0	1.0	t
469	118	2026-05-10 14:40:56.069106+00	label_offset_mm	-0.205	-1.0	1.0	t
470	118	2026-05-10 16:28:40.040015+00	cap_torque_nm	1.29985890138849	1.2	1.8	t
471	118	2026-05-10 16:19:47.691254+00	label_offset_mm	-0.153	-1.0	1.0	t
472	118	2026-05-10 21:01:08.725522+00	cap_torque_nm	1.57442133168047	1.2	1.8	t
473	118	2026-05-10 17:18:22.166973+00	cap_torque_nm	1.66884287148508	1.2	1.8	t
474	119	2026-05-10 01:29:58.071414+00	fill_volume_ml	503.477038624528	495	505	t
475	119	2026-05-10 03:14:35.720297+00	net_weight_g	249.830234139777	248	252	t
476	119	2026-05-10 01:34:02.68885+00	viscosity_cp	1014.94379759265	800	1200	t
477	119	2026-05-09 23:07:08.026629+00	cap_torque_nm	1.59829490770061	1.2	1.8	t
478	119	2026-05-09 23:12:00.802201+00	cap_torque_nm	1.68347670429983	1.2	1.8	t
479	120	2026-04-09 10:44:23.662732+00	net_weight_g	250.358897472621	248	252	t
480	120	2026-04-09 10:39:29.154916+00	fill_volume_ml	496.49538707455	495	505	t
481	120	2026-04-09 10:37:55.744705+00	fill_volume_ml	497.646114637027	495	505	t
482	120	2026-04-09 06:30:41.708859+00	label_offset_mm	-0.178	-1.0	1.0	t
483	120	2026-04-09 06:40:26.305364+00	cap_torque_nm	1.62572340537163	1.2	1.8	t
484	121	2026-03-27 17:53:21.314383+00	net_weight_g	250.09056691765	248	252	t
485	121	2026-03-27 18:27:18.555277+00	label_offset_mm	-0.370	-1.0	1.0	t
486	121	2026-03-27 14:37:36.930847+00	net_weight_g	250.987711272237	248	252	t
487	121	2026-03-27 18:02:24.700062+00	cap_torque_nm	1.73727874480024	1.2	1.8	t
488	122	2026-05-06 22:40:38.259153+00	fill_volume_ml	501.258714356511	495	505	t
489	122	2026-05-06 22:58:21.303329+00	net_weight_g	248.019340671202	248	252	t
490	122	2026-05-06 22:32:20.062658+00	label_offset_mm	0.398	-1.0	1.0	t
491	122	2026-05-06 23:28:49.087571+00	label_offset_mm	-0.970	-1.0	1.0	t
492	122	2026-05-06 23:02:37.214991+00	fill_volume_ml	498.658224840586	495	505	t
493	123	2026-04-07 06:18:27.848844+00	viscosity_cp	797.356366840623	800	1200	f
494	123	2026-04-07 06:13:42.499276+00	cap_torque_nm	1.3188450662326	1.2	1.8	t
495	123	2026-04-07 12:59:57.944198+00	label_offset_mm	0.229	-1.0	1.0	t
496	124	2026-04-12 18:57:35.360646+00	net_weight_g	250.302780194909	248	252	t
497	124	2026-04-12 14:14:47.654996+00	fill_volume_ml	499.339340494277	495	505	t
498	124	2026-04-12 14:14:39.905714+00	label_offset_mm	-1.089	-1.0	1.0	f
499	124	2026-04-12 18:25:15.206095+00	cap_torque_nm	1.70371794636413	1.2	1.8	t
500	124	2026-04-12 16:03:58.261965+00	cap_torque_nm	1.71547794317378	1.2	1.8	t
501	125	2026-05-15 00:10:59.996213+00	viscosity_cp	1113.95899264187	800	1200	t
502	125	2026-05-15 02:34:31.067347+00	net_weight_g	249.588768496073	248	252	t
503	125	2026-05-14 23:25:26.59035+00	viscosity_cp	932.722922637487	800	1200	t
504	126	2026-04-19 12:46:21.244049+00	label_offset_mm	0.603	-1.0	1.0	t
505	126	2026-04-19 10:40:04.668282+00	net_weight_g	248.911213182415	248	252	t
506	126	2026-04-19 07:33:27.369834+00	net_weight_g	251.737562672539	248	252	t
507	126	2026-04-19 10:28:30.313321+00	fill_volume_ml	502.354712985457	495	505	t
508	126	2026-04-19 07:02:52.970277+00	viscosity_cp	1081.82319187842	800	1200	t
509	126	2026-04-19 07:12:58.03154+00	viscosity_cp	1151.93446340296	800	1200	t
510	127	2026-05-13 14:59:21.445159+00	fill_volume_ml	503.873367997098	495	505	t
511	127	2026-05-13 15:33:19.109931+00	net_weight_g	251.746977258891	248	252	t
512	127	2026-05-13 14:35:32.406447+00	label_offset_mm	-0.747	-1.0	1.0	t
513	128	2026-04-15 22:59:20.16389+00	cap_torque_nm	1.3752869759946	1.2	1.8	t
514	128	2026-04-15 22:29:22.557403+00	cap_torque_nm	1.49338488958632	1.2	1.8	t
515	128	2026-04-15 23:02:03.869257+00	fill_volume_ml	496.613971292901	495	505	t
516	128	2026-04-15 22:55:09.917497+00	net_weight_g	251.107274607038	248	252	t
517	129	2026-04-23 07:43:43.388246+00	viscosity_cp	1086.80007042758	800	1200	t
518	129	2026-04-23 07:27:37.179101+00	viscosity_cp	905.985281620331	800	1200	t
519	129	2026-04-23 06:31:36.309398+00	label_offset_mm	-1.168	-1.0	1.0	f
520	129	2026-04-23 06:16:34.982229+00	net_weight_g	249.400980833707	248	252	t
521	129	2026-04-23 06:22:01.62137+00	net_weight_g	250.041101281451	248	252	t
522	129	2026-04-23 08:00:43.708906+00	cap_torque_nm	1.26473909455825	1.2	1.8	t
523	130	2026-04-17 14:34:24.902087+00	cap_torque_nm	1.57870183122212	1.2	1.8	t
524	130	2026-04-17 17:26:42.64825+00	cap_torque_nm	1.53726874623583	1.2	1.8	t
525	130	2026-04-17 17:11:43.997574+00	viscosity_cp	1217.45059287667	800	1200	f
526	130	2026-04-17 16:46:07.68028+00	viscosity_cp	822.274576899571	800	1200	t
527	130	2026-04-17 14:36:03.891202+00	net_weight_g	250.821276017153	248	252	t
528	130	2026-04-17 18:17:01.729143+00	fill_volume_ml	502.466615848063	495	505	t
529	131	2026-04-03 01:01:11.640401+00	cap_torque_nm	1.60173177980632	1.2	1.8	t
530	131	2026-04-02 23:04:52.666119+00	viscosity_cp	867.105732802932	800	1200	t
531	131	2026-04-03 00:20:54.259436+00	label_offset_mm	0.197	-1.0	1.0	t
532	132	2026-03-17 08:10:34.906404+00	viscosity_cp	1075.95989911601	800	1200	t
533	132	2026-03-17 09:54:39.967579+00	net_weight_g	250.005406087343	248	252	t
534	132	2026-03-17 09:18:59.092801+00	fill_volume_ml	503.854379460425	495	505	t
535	132	2026-03-17 07:23:38.918437+00	viscosity_cp	932.401950608509	800	1200	t
536	132	2026-03-17 07:48:26.726762+00	net_weight_g	248.522152868993	248	252	t
537	133	2026-05-07 15:58:14.434995+00	cap_torque_nm	1.70053734223911	1.2	1.8	t
538	133	2026-05-07 18:11:54.467624+00	viscosity_cp	1238.59678368868	800	1200	f
539	133	2026-05-07 17:24:14.95184+00	fill_volume_ml	497.320553888812	495	505	t
540	134	2026-05-02 01:10:30.152978+00	viscosity_cp	1117.56058932744	800	1200	t
541	134	2026-05-01 23:28:40.006772+00	viscosity_cp	770.287229701569	800	1200	f
542	134	2026-05-02 00:52:32.198205+00	cap_torque_nm	1.71828255390644	1.2	1.8	t
543	134	2026-05-02 00:39:53.545663+00	fill_volume_ml	502.508398685709	495	505	t
544	135	2026-04-21 12:26:19.632429+00	fill_volume_ml	497.606275525379	495	505	t
545	135	2026-04-21 11:25:52.589761+00	fill_volume_ml	499.443045233409	495	505	t
546	135	2026-04-21 12:19:57.632233+00	cap_torque_nm	1.53444844613004	1.2	1.8	t
547	135	2026-04-21 09:57:59.889091+00	label_offset_mm	-0.090	-1.0	1.0	t
548	136	2026-04-05 16:52:38.964969+00	fill_volume_ml	496.911266701634	495	505	t
549	136	2026-04-05 15:45:34.459658+00	viscosity_cp	1167.10644698289	800	1200	t
550	136	2026-04-05 14:17:26.335049+00	net_weight_g	249.917892197501	248	252	t
551	136	2026-04-05 16:05:17.431942+00	label_offset_mm	0.991	-1.0	1.0	t
552	137	2026-04-30 23:12:56.50403+00	viscosity_cp	1012.9157163621	800	1200	t
553	137	2026-04-30 22:11:49.788395+00	label_offset_mm	0.042	-1.0	1.0	t
554	137	2026-04-30 23:22:48.928121+00	viscosity_cp	843.296398738342	800	1200	t
555	137	2026-05-01 00:25:30.371952+00	cap_torque_nm	1.43012110791323	1.2	1.8	t
556	138	2026-05-03 09:41:22.154304+00	label_offset_mm	0.468	-1.0	1.0	t
557	138	2026-05-03 08:56:55.087741+00	cap_torque_nm	1.61490008167009	1.2	1.8	t
558	138	2026-05-03 07:54:28.882338+00	net_weight_g	249.880226475766	248	252	t
559	139	2026-04-06 17:58:36.152845+00	label_offset_mm	-0.935	-1.0	1.0	t
560	139	2026-04-06 15:39:02.45919+00	cap_torque_nm	1.62679623216382	1.2	1.8	t
561	139	2026-04-06 17:05:15.990024+00	label_offset_mm	0.103	-1.0	1.0	t
562	139	2026-04-06 17:42:32.671167+00	viscosity_cp	844.259645729337	800	1200	t
563	139	2026-04-06 18:47:35.790225+00	cap_torque_nm	1.6872641973318	1.2	1.8	t
564	140	2026-05-12 23:35:26.149376+00	viscosity_cp	1025.69420834455	800	1200	t
565	140	2026-05-13 02:59:33.144722+00	label_offset_mm	0.976	-1.0	1.0	t
566	140	2026-05-13 04:36:28.876246+00	label_offset_mm	-1.008	-1.0	1.0	f
567	141	2026-05-09 08:41:32.970507+00	viscosity_cp	932.805447108278	800	1200	t
568	141	2026-05-09 11:05:38.162294+00	label_offset_mm	0.464	-1.0	1.0	t
569	141	2026-05-09 10:53:43.694397+00	viscosity_cp	1222.0695633168	800	1200	f
570	142	2026-03-18 19:08:27.335218+00	viscosity_cp	798.152813001126	800	1200	f
571	142	2026-03-18 16:44:13.664023+00	fill_volume_ml	500.367532408013	495	505	t
572	142	2026-03-18 15:15:46.177195+00	label_offset_mm	-0.305	-1.0	1.0	t
573	142	2026-03-18 15:34:41.151617+00	fill_volume_ml	503.272227494634	495	505	t
574	142	2026-03-18 19:19:49.510269+00	fill_volume_ml	503.68397972896	495	505	t
575	143	2026-05-05 23:22:48.683195+00	label_offset_mm	-0.734	-1.0	1.0	t
576	143	2026-05-05 23:19:16.362601+00	net_weight_g	249.014718138416	248	252	t
577	143	2026-05-06 02:01:27.834709+00	fill_volume_ml	499.285165483324	495	505	t
578	143	2026-05-06 00:13:54.453607+00	viscosity_cp	1010.33686493819	800	1200	t
579	143	2026-05-05 23:02:17.990039+00	label_offset_mm	-0.696	-1.0	1.0	t
580	143	2026-05-05 23:44:19.72992+00	viscosity_cp	1224.19192668835	800	1200	f
581	144	2026-04-30 07:43:26.79035+00	viscosity_cp	988.506074923596	800	1200	t
582	144	2026-04-30 07:25:15.164336+00	fill_volume_ml	500.015678730337	495	505	t
583	144	2026-04-30 08:16:50.066899+00	viscosity_cp	967.111808035523	800	1200	t
584	144	2026-04-30 07:01:00.297248+00	cap_torque_nm	1.33335347505967	1.2	1.8	t
585	144	2026-04-30 07:15:44.174621+00	viscosity_cp	1031.36293892112	800	1200	t
586	145	2026-04-14 15:17:57.639288+00	viscosity_cp	1022.69457437405	800	1200	t
587	145	2026-04-14 17:31:12.549947+00	viscosity_cp	817.197818597979	800	1200	t
588	145	2026-04-14 14:36:10.04005+00	cap_torque_nm	1.40884988479481	1.2	1.8	t
589	145	2026-04-14 16:31:06.82513+00	cap_torque_nm	1.64996774618586	1.2	1.8	t
590	146	2026-05-02 23:20:44.756124+00	cap_torque_nm	1.50126492183433	1.2	1.8	t
591	146	2026-05-02 23:56:56.412647+00	net_weight_g	250.671258184091	248	252	t
592	146	2026-05-02 22:50:16.696743+00	net_weight_g	249.790717587673	248	252	t
593	146	2026-05-02 22:19:11.685384+00	viscosity_cp	1219.01022923195	800	1200	f
594	147	2026-03-26 06:50:51.099397+00	viscosity_cp	1130.07401205649	800	1200	t
595	147	2026-03-26 07:08:59.691764+00	net_weight_g	250.134545200927	248	252	t
596	147	2026-03-26 07:52:17.656027+00	fill_volume_ml	497.633059430519	495	505	t
597	147	2026-03-26 07:49:04.016937+00	net_weight_g	251.898920829062	248	252	t
598	147	2026-03-26 09:17:28.055332+00	viscosity_cp	975.411013942824	800	1200	t
599	148	2026-03-24 18:36:38.046382+00	label_offset_mm	0.575	-1.0	1.0	t
600	148	2026-03-24 14:45:01.301127+00	viscosity_cp	1173.78736034729	800	1200	t
601	148	2026-03-24 16:15:04.747172+00	label_offset_mm	-0.590	-1.0	1.0	t
602	148	2026-03-24 18:38:48.224072+00	cap_torque_nm	1.62072473298927	1.2	1.8	t
603	149	2026-04-26 03:16:48.57217+00	cap_torque_nm	1.53598341085834	1.2	1.8	t
604	149	2026-04-25 23:28:32.751762+00	cap_torque_nm	1.62505789082879	1.2	1.8	t
605	149	2026-04-26 01:02:04.927987+00	fill_volume_ml	496.099362381615	495	505	t
606	150	2026-04-28 07:07:18.829634+00	net_weight_g	251.600945050652	248	252	t
607	150	2026-04-28 07:37:41.613628+00	fill_volume_ml	502.508115662653	495	505	t
608	150	2026-04-28 09:04:02.182942+00	fill_volume_ml	496.090175134394	495	505	t
609	150	2026-04-28 08:36:17.386325+00	viscosity_cp	1192.42382587815	800	1200	t
610	150	2026-04-28 07:17:57.513653+00	net_weight_g	249.426077546131	248	252	t
611	151	2026-04-26 14:20:22.989709+00	cap_torque_nm	1.59170104304639	1.2	1.8	t
612	151	2026-04-26 15:38:24.479587+00	viscosity_cp	1172.60921318251	800	1200	t
613	151	2026-04-26 16:03:40.01707+00	net_weight_g	250.254965995385	248	252	t
614	151	2026-04-26 14:07:37.509041+00	viscosity_cp	1037.74090335432	800	1200	t
615	152	2026-05-09 23:26:58.489299+00	fill_volume_ml	501.024098173619	495	505	t
616	152	2026-05-10 00:12:56.207464+00	fill_volume_ml	497.302980377692	495	505	t
617	152	2026-05-09 23:12:04.442069+00	fill_volume_ml	496.95811596587	495	505	t
618	153	2026-05-06 06:11:52.99232+00	fill_volume_ml	498.439156037615	495	505	t
619	153	2026-05-06 06:34:45.232896+00	viscosity_cp	1210.37645925387	800	1200	f
620	153	2026-05-06 06:37:49.682725+00	net_weight_g	250.982396485777	248	252	t
621	154	2026-04-06 15:29:19.471455+00	viscosity_cp	1049.63075728757	800	1200	t
622	154	2026-04-06 14:41:58.771415+00	label_offset_mm	0.067	-1.0	1.0	t
623	154	2026-04-06 15:12:30.37389+00	fill_volume_ml	500.554057848907	495	505	t
624	154	2026-04-06 15:17:07.800152+00	viscosity_cp	868.117652464062	800	1200	t
625	154	2026-04-06 15:33:29.950161+00	fill_volume_ml	496.951931672268	495	505	t
626	154	2026-04-06 14:57:22.408709+00	net_weight_g	251.59679432094	248	252	t
627	155	2026-04-13 23:26:44.579768+00	label_offset_mm	-1.045	-1.0	1.0	f
628	155	2026-04-14 01:41:42.389563+00	net_weight_g	251.780502962441	248	252	t
629	155	2026-04-14 00:47:27.447123+00	label_offset_mm	-1.181	-1.0	1.0	f
630	156	2026-04-30 08:49:54.844198+00	fill_volume_ml	503.970490117427	495	505	t
631	156	2026-04-30 10:07:15.980724+00	viscosity_cp	955.330025451605	800	1200	t
632	156	2026-04-30 06:29:19.31201+00	viscosity_cp	782.254301912695	800	1200	f
633	157	2026-05-10 17:00:03.281714+00	viscosity_cp	1158.1972902107	800	1200	t
634	157	2026-05-10 15:59:38.3486+00	viscosity_cp	751.011654941244	800	1200	f
635	157	2026-05-10 16:15:08.807208+00	label_offset_mm	0.907	-1.0	1.0	t
636	157	2026-05-10 19:02:30.500567+00	label_offset_mm	0.562	-1.0	1.0	t
637	157	2026-05-10 16:21:51.200276+00	fill_volume_ml	499.023240765751	495	505	t
638	158	2026-05-15 01:25:49.236731+00	fill_volume_ml	503.078803998205	495	505	t
639	158	2026-05-14 23:40:52.802531+00	fill_volume_ml	502.414441226669	495	505	t
640	158	2026-05-15 00:58:52.569321+00	label_offset_mm	0.310	-1.0	1.0	t
641	159	2026-04-26 06:40:56.225335+00	fill_volume_ml	499.766986099568	495	505	t
642	159	2026-04-26 08:28:14.238689+00	fill_volume_ml	501.59495163374	495	505	t
643	159	2026-04-26 12:55:02.988669+00	label_offset_mm	-0.594	-1.0	1.0	t
644	160	2026-05-01 18:06:49.78367+00	cap_torque_nm	1.66524121235227	1.2	1.8	t
645	160	2026-05-01 18:38:08.058647+00	label_offset_mm	-0.008	-1.0	1.0	t
646	160	2026-05-01 16:52:29.629204+00	fill_volume_ml	503.506621623102	495	505	t
647	160	2026-05-01 14:57:13.989296+00	net_weight_g	249.380291428985	248	252	t
648	160	2026-05-01 14:22:03.179485+00	net_weight_g	248.964814157321	248	252	t
649	161	2026-04-25 02:08:15.599724+00	cap_torque_nm	1.6615522101935	1.2	1.8	t
650	161	2026-04-25 03:27:23.274821+00	label_offset_mm	-1.025	-1.0	1.0	f
651	161	2026-04-24 23:05:34.020818+00	net_weight_g	249.216758876209	248	252	t
652	161	2026-04-24 23:09:30.870519+00	net_weight_g	248.460730984839	248	252	t
653	161	2026-04-24 23:55:28.271525+00	cap_torque_nm	1.56427825493243	1.2	1.8	t
654	162	2026-04-17 11:58:46.327592+00	label_offset_mm	-0.501	-1.0	1.0	t
655	162	2026-04-17 10:02:19.58419+00	cap_torque_nm	1.71853650559341	1.2	1.8	t
656	162	2026-04-17 09:10:47.618632+00	net_weight_g	248.142168047167	248	252	t
657	162	2026-04-17 07:33:52.665122+00	viscosity_cp	1216.4690573673	800	1200	f
658	162	2026-04-17 11:53:55.258939+00	viscosity_cp	793.840394569039	800	1200	f
659	162	2026-04-17 10:03:48.515935+00	cap_torque_nm	1.27618914272946	1.2	1.8	t
660	163	2026-05-03 21:04:02.800078+00	label_offset_mm	0.377	-1.0	1.0	t
661	163	2026-05-03 18:33:16.259195+00	label_offset_mm	0.978	-1.0	1.0	t
662	163	2026-05-03 17:04:51.113572+00	net_weight_g	251.333354582055	248	252	t
663	163	2026-05-03 19:17:55.626602+00	label_offset_mm	1.018	-1.0	1.0	f
664	163	2026-05-03 16:16:06.801404+00	viscosity_cp	850.341918811176	800	1200	t
665	164	2026-04-19 01:43:53.809184+00	fill_volume_ml	497.412168975877	495	505	t
666	164	2026-04-19 00:51:21.342613+00	cap_torque_nm	1.35213216109559	1.2	1.8	t
667	164	2026-04-18 23:16:52.149143+00	cap_torque_nm	1.66709506260612	1.2	1.8	t
668	164	2026-04-18 23:07:48.812332+00	label_offset_mm	1.104	-1.0	1.0	f
669	165	2026-05-13 07:44:44.489145+00	label_offset_mm	0.313	-1.0	1.0	t
670	165	2026-05-13 08:02:34.134164+00	net_weight_g	251.326904728023	248	252	t
671	165	2026-05-13 12:50:58.616726+00	net_weight_g	251.39115729012	248	252	t
672	165	2026-05-13 11:35:20.407223+00	label_offset_mm	0.256	-1.0	1.0	t
673	166	2026-04-18 14:09:29.950244+00	viscosity_cp	821.420548629569	800	1200	t
674	166	2026-04-18 17:06:44.148777+00	net_weight_g	250.668090543442	248	252	t
675	166	2026-04-18 16:34:01.982168+00	fill_volume_ml	501.065335192039	495	505	t
676	166	2026-04-18 16:30:36.764032+00	fill_volume_ml	499.032873382388	495	505	t
677	166	2026-04-18 17:17:37.923931+00	label_offset_mm	-0.744	-1.0	1.0	t
678	167	2026-04-02 22:37:44.120336+00	net_weight_g	251.405133612374	248	252	t
679	167	2026-04-02 22:44:12.160667+00	viscosity_cp	927.354906366847	800	1200	t
680	167	2026-04-02 23:36:07.9863+00	net_weight_g	251.684472816788	248	252	t
681	167	2026-04-02 23:39:27.526387+00	label_offset_mm	-0.109	-1.0	1.0	t
682	168	2026-03-25 08:48:45.624284+00	fill_volume_ml	497.072843920504	495	505	t
683	168	2026-03-25 13:01:15.94049+00	cap_torque_nm	1.62924938193757	1.2	1.8	t
684	168	2026-03-25 08:37:53.480024+00	cap_torque_nm	1.74484730798532	1.2	1.8	t
685	168	2026-03-25 07:30:35.923459+00	net_weight_g	250.687325703283	248	252	t
686	169	2026-04-02 14:19:13.599255+00	fill_volume_ml	500.654010748492	495	505	t
687	169	2026-04-02 15:02:08.468749+00	viscosity_cp	809.407576196143	800	1200	t
688	169	2026-04-02 15:17:53.932219+00	label_offset_mm	-1.180	-1.0	1.0	f
689	170	2026-04-22 23:12:42.8833+00	viscosity_cp	781.417107270092	800	1200	f
690	170	2026-04-22 22:34:50.830649+00	cap_torque_nm	1.58160712570837	1.2	1.8	t
691	171	2026-03-21 07:43:49.697803+00	cap_torque_nm	1.42325957645657	1.2	1.8	t
692	171	2026-03-21 06:14:29.876998+00	label_offset_mm	-0.577	-1.0	1.0	t
693	172	2026-04-13 14:13:54.683713+00	fill_volume_ml	496.273336344049	495	505	t
694	172	2026-04-13 16:54:41.574933+00	fill_volume_ml	502.949945229591	495	505	t
695	172	2026-04-13 14:57:58.472412+00	net_weight_g	248.153936661095	248	252	t
696	172	2026-04-13 15:46:37.334639+00	fill_volume_ml	498.158455061133	495	505	t
697	172	2026-04-13 14:50:30.321788+00	cap_torque_nm	1.57945389438901	1.2	1.8	t
698	172	2026-04-13 15:07:28.752432+00	label_offset_mm	-0.234	-1.0	1.0	t
699	173	2026-05-05 01:53:04.530339+00	viscosity_cp	1171.87523517025	800	1200	t
700	173	2026-05-05 02:11:08.279302+00	label_offset_mm	-0.636	-1.0	1.0	t
701	173	2026-05-04 23:20:50.098562+00	label_offset_mm	-0.309	-1.0	1.0	t
702	173	2026-05-04 22:48:23.099452+00	label_offset_mm	-0.313	-1.0	1.0	t
703	174	2026-04-17 06:50:33.334255+00	viscosity_cp	750.109825649848	800	1200	f
704	174	2026-04-17 07:06:52.167735+00	fill_volume_ml	499.712724716977	495	505	t
705	174	2026-04-17 06:20:04.44579+00	cap_torque_nm	1.68827651706529	1.2	1.8	t
706	174	2026-04-17 06:23:15.023384+00	label_offset_mm	1.010	-1.0	1.0	f
707	174	2026-04-17 06:42:08.036364+00	net_weight_g	251.959931483863	248	252	t
708	175	2026-03-19 15:47:57.04412+00	label_offset_mm	-0.763	-1.0	1.0	t
709	175	2026-03-19 15:40:35.969488+00	net_weight_g	251.032736551814	248	252	t
710	175	2026-03-19 14:28:07.948867+00	viscosity_cp	958.248563344008	800	1200	t
711	176	2026-05-14 04:10:26.347683+00	fill_volume_ml	497.228630114519	495	505	t
712	176	2026-05-13 23:31:54.783314+00	net_weight_g	250.257221949842	248	252	t
713	176	2026-05-14 01:24:26.033126+00	label_offset_mm	-0.464	-1.0	1.0	t
714	176	2026-05-14 03:23:49.513084+00	net_weight_g	249.111709184087	248	252	t
715	177	2026-04-11 08:37:55.312685+00	label_offset_mm	-0.385	-1.0	1.0	t
716	177	2026-04-11 09:46:05.371315+00	label_offset_mm	-0.134	-1.0	1.0	t
717	177	2026-04-11 13:24:27.842639+00	viscosity_cp	813.532188957286	800	1200	t
718	177	2026-04-11 08:23:43.579012+00	label_offset_mm	-0.377	-1.0	1.0	t
719	177	2026-04-11 12:35:30.045855+00	viscosity_cp	1115.71689155023	800	1200	t
720	178	2026-05-09 15:25:28.599184+00	cap_torque_nm	1.4881712648129	1.2	1.8	t
721	178	2026-05-09 20:18:07.995609+00	fill_volume_ml	502.94662155723	495	505	t
722	178	2026-05-09 17:28:33.52778+00	viscosity_cp	986.506730451847	800	1200	t
723	178	2026-05-09 19:34:32.403435+00	viscosity_cp	1123.01593595843	800	1200	t
724	179	2026-03-19 23:57:49.481581+00	cap_torque_nm	1.3085614335361	1.2	1.8	t
725	179	2026-03-20 01:45:17.890002+00	cap_torque_nm	1.46863756197294	1.2	1.8	t
726	180	2026-03-31 09:37:02.845609+00	fill_volume_ml	500.247361383363	495	505	t
727	180	2026-03-31 08:00:12.165737+00	fill_volume_ml	498.933889597003	495	505	t
728	180	2026-03-31 09:24:55.343147+00	fill_volume_ml	503.069204696622	495	505	t
729	180	2026-03-31 06:56:43.980317+00	label_offset_mm	0.745	-1.0	1.0	t
730	181	2026-04-11 20:20:17.760609+00	net_weight_g	248.692162902957	248	252	t
731	181	2026-04-11 15:00:00.89389+00	label_offset_mm	-0.012	-1.0	1.0	t
732	181	2026-04-11 17:49:24.380586+00	net_weight_g	249.848271394845	248	252	t
733	181	2026-04-11 14:27:42.76522+00	net_weight_g	248.594447600443	248	252	t
734	182	2026-04-24 00:47:13.934232+00	label_offset_mm	-1.096	-1.0	1.0	f
735	182	2026-04-23 23:14:39.384002+00	fill_volume_ml	498.811259496298	495	505	t
736	182	2026-04-23 23:04:25.392098+00	fill_volume_ml	502.169592770711	495	505	t
737	182	2026-04-23 22:16:39.421394+00	cap_torque_nm	1.39522159089487	1.2	1.8	t
738	183	2026-04-05 10:21:33.791343+00	label_offset_mm	0.129	-1.0	1.0	t
739	183	2026-04-05 08:29:48.391691+00	net_weight_g	251.565814919357	248	252	t
740	183	2026-04-05 09:48:45.647454+00	cap_torque_nm	1.27264323507869	1.2	1.8	t
741	184	2026-04-23 14:55:02.28574+00	net_weight_g	249.630066526927	248	252	t
742	184	2026-04-23 15:10:07.189642+00	fill_volume_ml	502.588931164897	495	505	t
743	184	2026-04-23 14:41:22.293706+00	label_offset_mm	1.157	-1.0	1.0	f
744	184	2026-04-23 16:35:42.174153+00	fill_volume_ml	497.813244158346	495	505	t
745	184	2026-04-23 14:45:30.287623+00	viscosity_cp	1204.34740402877	800	1200	f
746	184	2026-04-23 14:35:01.038539+00	viscosity_cp	1118.52502371947	800	1200	t
747	185	2026-03-27 02:59:57.37065+00	viscosity_cp	1093.67498260404	800	1200	t
748	185	2026-03-27 00:46:34.881497+00	cap_torque_nm	1.44309661143966	1.2	1.8	t
749	185	2026-03-27 00:01:03.898461+00	label_offset_mm	0.985	-1.0	1.0	t
750	185	2026-03-27 01:22:24.467187+00	fill_volume_ml	499.632380215928	495	505	t
751	185	2026-03-27 02:21:19.270744+00	viscosity_cp	847.628960022008	800	1200	t
752	185	2026-03-27 01:57:09.92555+00	cap_torque_nm	1.52488821268166	1.2	1.8	t
753	186	2026-03-18 08:14:07.607991+00	viscosity_cp	840.178215071077	800	1200	t
754	186	2026-03-18 07:27:21.020536+00	fill_volume_ml	497.081359811441	495	505	t
755	186	2026-03-18 08:05:12.791575+00	fill_volume_ml	497.993459417816	495	505	t
756	187	2026-03-26 17:28:04.234624+00	label_offset_mm	0.255	-1.0	1.0	t
757	187	2026-03-26 14:34:22.636795+00	cap_torque_nm	1.25343182323677	1.2	1.8	t
758	187	2026-03-26 15:27:27.172772+00	cap_torque_nm	1.71182978895067	1.2	1.8	t
759	187	2026-03-26 17:20:10.927757+00	viscosity_cp	1108.64048662809	800	1200	t
760	188	2026-04-17 00:36:32.766881+00	label_offset_mm	0.869	-1.0	1.0	t
761	188	2026-04-17 02:08:27.842948+00	net_weight_g	249.088977752435	248	252	t
762	188	2026-04-16 22:44:56.424669+00	label_offset_mm	-0.703	-1.0	1.0	t
763	189	2026-05-15 09:41:52.566261+00	cap_torque_nm	1.34106087181681	1.2	1.8	t
764	189	2026-05-15 08:16:31.579841+00	cap_torque_nm	1.42583574440017	1.2	1.8	t
765	189	2026-05-15 06:48:20.433123+00	fill_volume_ml	499.637523865776	495	505	t
766	189	2026-05-15 07:45:46.899042+00	fill_volume_ml	499.470223409679	495	505	t
767	190	2026-04-28 15:30:59.392527+00	label_offset_mm	-0.723	-1.0	1.0	t
768	190	2026-04-28 17:23:59.22188+00	viscosity_cp	1132.07958879243	800	1200	t
769	190	2026-04-28 16:32:52.213341+00	label_offset_mm	1.084	-1.0	1.0	f
770	190	2026-04-28 14:34:22.525805+00	viscosity_cp	856.630166004671	800	1200	t
771	190	2026-04-28 17:23:09.879381+00	viscosity_cp	1148.12585019003	800	1200	t
772	190	2026-04-28 17:39:49.391287+00	viscosity_cp	755.885415765668	800	1200	f
773	191	2026-04-29 01:41:20.97794+00	viscosity_cp	889.598457530862	800	1200	t
774	191	2026-04-29 01:12:09.62281+00	viscosity_cp	1122.76967092522	800	1200	t
775	191	2026-04-29 01:03:08.834312+00	fill_volume_ml	502.164190994106	495	505	t
776	191	2026-04-28 22:20:50.758832+00	label_offset_mm	0.282	-1.0	1.0	t
777	191	2026-04-28 23:58:14.823159+00	label_offset_mm	-0.028	-1.0	1.0	t
778	192	2026-04-09 07:25:01.843557+00	fill_volume_ml	501.748262500263	495	505	t
779	192	2026-04-09 08:17:04.988492+00	viscosity_cp	916.907965098788	800	1200	t
780	192	2026-04-09 07:27:04.260963+00	fill_volume_ml	496.691283225859	495	505	t
781	192	2026-04-09 08:11:31.53656+00	cap_torque_nm	1.63336682067072	1.2	1.8	t
782	193	2026-05-06 14:50:32.64343+00	viscosity_cp	1014.59749452954	800	1200	t
783	193	2026-05-06 15:22:03.736196+00	net_weight_g	250.9822104577	248	252	t
784	193	2026-05-06 15:23:03.05613+00	viscosity_cp	930.534525471419	800	1200	t
785	193	2026-05-06 15:53:11.915799+00	viscosity_cp	1042.51968525698	800	1200	t
786	194	2026-05-12 01:01:51.462841+00	cap_torque_nm	1.29816602974311	1.2	1.8	t
787	194	2026-05-11 23:45:36.20728+00	label_offset_mm	-0.837	-1.0	1.0	t
788	194	2026-05-12 00:00:20.450037+00	fill_volume_ml	499.097006370002	495	505	t
789	194	2026-05-12 00:58:24.192177+00	cap_torque_nm	1.68992196676226	1.2	1.8	t
790	194	2026-05-11 22:55:06.457959+00	fill_volume_ml	503.355796846767	495	505	t
791	194	2026-05-11 22:39:09.62684+00	cap_torque_nm	1.5732806757974	1.2	1.8	t
792	195	2026-05-04 06:46:52.850142+00	viscosity_cp	1082.09987950145	800	1200	t
793	195	2026-05-04 06:58:08.998956+00	viscosity_cp	898.968968789405	800	1200	t
794	195	2026-05-04 07:51:45.478234+00	net_weight_g	248.529143824632	248	252	t
795	196	2026-03-22 16:17:53.992652+00	fill_volume_ml	499.136531375065	495	505	t
796	196	2026-03-22 16:26:15.612846+00	net_weight_g	249.94628990948	248	252	t
797	197	2026-04-30 00:14:52.314081+00	label_offset_mm	0.393	-1.0	1.0	t
798	197	2026-04-29 23:16:20.689904+00	cap_torque_nm	1.45417819599492	1.2	1.8	t
799	197	2026-04-30 03:14:49.493093+00	fill_volume_ml	501.108151859368	495	505	t
800	197	2026-04-29 22:52:34.799626+00	viscosity_cp	958.534479294984	800	1200	t
801	197	2026-04-30 02:14:52.977008+00	fill_volume_ml	498.017241856144	495	505	t
802	197	2026-04-30 01:51:03.099256+00	label_offset_mm	0.517	-1.0	1.0	t
803	198	2026-05-03 06:40:51.017962+00	fill_volume_ml	497.003470435929	495	505	t
804	198	2026-05-03 07:41:22.202658+00	fill_volume_ml	501.403300058004	495	505	t
805	198	2026-05-03 06:46:55.35772+00	fill_volume_ml	503.538237374366	495	505	t
806	198	2026-05-03 07:45:39.346885+00	cap_torque_nm	1.62983177206339	1.2	1.8	t
807	198	2026-05-03 07:55:51.441782+00	label_offset_mm	-0.807	-1.0	1.0	t
808	199	2026-04-30 17:27:07.633578+00	viscosity_cp	1109.28429661673	800	1200	t
809	199	2026-04-30 14:07:14.838925+00	viscosity_cp	1157.61112797595	800	1200	t
810	199	2026-04-30 15:58:16.757032+00	viscosity_cp	1207.47168563333	800	1200	f
811	200	2026-04-03 02:16:15.62917+00	label_offset_mm	-0.584	-1.0	1.0	t
812	200	2026-04-02 22:49:14.680379+00	fill_volume_ml	497.416950046327	495	505	t
813	200	2026-04-02 23:57:40.436905+00	label_offset_mm	0.613	-1.0	1.0	t
814	200	2026-04-03 03:51:39.504895+00	label_offset_mm	-0.324	-1.0	1.0	t
815	201	2026-04-18 07:37:33.415435+00	fill_volume_ml	503.132303358191	495	505	t
816	201	2026-04-18 08:10:17.391203+00	label_offset_mm	-0.910	-1.0	1.0	t
817	201	2026-04-18 07:33:39.946895+00	net_weight_g	249.811119622507	248	252	t
818	202	2026-05-12 16:24:27.617671+00	viscosity_cp	1248.20883065164	800	1200	f
819	202	2026-05-12 15:05:54.920988+00	viscosity_cp	1130.53840246415	800	1200	t
820	202	2026-05-12 18:28:03.746266+00	fill_volume_ml	503.586416964022	495	505	t
821	202	2026-05-12 16:21:06.258507+00	cap_torque_nm	1.62622277734504	1.2	1.8	t
822	203	2026-05-16 00:06:24.221717+00	viscosity_cp	819.194226280604	800	1200	t
823	203	2026-05-16 03:35:30.624813+00	viscosity_cp	1157.13969935903	800	1200	t
824	203	2026-05-15 23:00:11.102874+00	net_weight_g	250.683513577036	248	252	t
825	203	2026-05-16 02:13:09.652369+00	fill_volume_ml	500.343425531584	495	505	t
826	203	2026-05-16 01:58:08.180764+00	fill_volume_ml	498.689656949082	495	505	t
827	203	2026-05-16 00:13:00.093204+00	fill_volume_ml	499.112647705161	495	505	t
828	204	2026-03-22 06:26:51.086374+00	net_weight_g	251.967409611873	248	252	t
829	204	2026-03-22 08:40:19.12912+00	cap_torque_nm	1.70119623268416	1.2	1.8	t
830	204	2026-03-22 11:11:58.929896+00	label_offset_mm	0.312	-1.0	1.0	t
831	204	2026-03-22 12:21:42.889293+00	cap_torque_nm	1.45097874318111	1.2	1.8	t
832	205	2026-05-02 16:59:42.231574+00	fill_volume_ml	497.353004263594	495	505	t
833	205	2026-05-02 14:51:32.695239+00	label_offset_mm	-0.825	-1.0	1.0	t
834	205	2026-05-02 18:21:20.565299+00	fill_volume_ml	501.883508162132	495	505	t
835	205	2026-05-02 14:47:20.231294+00	viscosity_cp	1068.38205455509	800	1200	t
836	206	2026-03-22 03:17:33.299195+00	fill_volume_ml	500.722813371779	495	505	t
837	206	2026-03-22 02:37:49.846295+00	fill_volume_ml	501.365543112995	495	505	t
838	207	2026-03-26 07:22:28.348747+00	label_offset_mm	-1.049	-1.0	1.0	f
839	207	2026-03-26 06:11:39.546949+00	net_weight_g	248.91847863686	248	252	t
840	207	2026-03-26 06:09:20.063052+00	net_weight_g	249.118424203909	248	252	t
841	207	2026-03-26 06:27:33.794202+00	fill_volume_ml	502.106007514208	495	505	t
842	208	2026-04-30 14:58:26.149918+00	cap_torque_nm	1.62958276789423	1.2	1.8	t
843	208	2026-04-30 15:51:23.11105+00	viscosity_cp	1182.06104421852	800	1200	t
844	208	2026-04-30 14:59:28.989847+00	fill_volume_ml	501.682319850013	495	505	t
845	208	2026-04-30 16:10:33.449626+00	cap_torque_nm	1.39150425725366	1.2	1.8	t
846	209	2026-05-07 01:52:33.58606+00	fill_volume_ml	497.023992155698	495	505	t
847	209	2026-05-07 00:53:25.038247+00	viscosity_cp	890.850744521339	800	1200	t
848	209	2026-05-07 00:58:56.380415+00	label_offset_mm	0.907	-1.0	1.0	t
849	210	2026-04-01 08:35:37.425866+00	label_offset_mm	0.405	-1.0	1.0	t
850	210	2026-04-01 06:44:26.881783+00	cap_torque_nm	1.39963647739612	1.2	1.8	t
851	210	2026-04-01 07:48:52.786424+00	fill_volume_ml	497.321024865635	495	505	t
852	210	2026-04-01 10:42:34.707465+00	net_weight_g	250.37724729538	248	252	t
853	211	2026-04-29 17:17:55.226439+00	cap_torque_nm	1.66023973723947	1.2	1.8	t
854	211	2026-04-29 14:50:12.292216+00	fill_volume_ml	500.490834495357	495	505	t
855	211	2026-04-29 16:33:25.88819+00	net_weight_g	250.764113024565	248	252	t
856	211	2026-04-29 16:46:24.037121+00	viscosity_cp	1239.97117508821	800	1200	f
857	212	2026-03-25 00:17:12.650492+00	net_weight_g	251.847815375311	248	252	t
858	212	2026-03-25 01:16:29.679679+00	cap_torque_nm	1.72636973227107	1.2	1.8	t
859	212	2026-03-25 00:29:53.032617+00	viscosity_cp	879.182184308699	800	1200	t
860	212	2026-03-24 23:12:34.243846+00	fill_volume_ml	499.246163091829	495	505	t
861	212	2026-03-25 02:31:58.857484+00	cap_torque_nm	1.70514274772972	1.2	1.8	t
862	213	2026-04-20 07:15:07.115885+00	label_offset_mm	-0.245	-1.0	1.0	t
863	213	2026-04-20 08:43:05.137026+00	label_offset_mm	0.935	-1.0	1.0	t
864	213	2026-04-20 08:39:25.7588+00	net_weight_g	248.386902066846	248	252	t
865	213	2026-04-20 08:05:48.808857+00	fill_volume_ml	498.45703383331	495	505	t
866	213	2026-04-20 07:20:21.968522+00	net_weight_g	251.028409534035	248	252	t
867	214	2026-05-10 15:24:37.594596+00	cap_torque_nm	1.41897900919883	1.2	1.8	t
868	214	2026-05-10 16:13:59.59853+00	cap_torque_nm	1.63929619802921	1.2	1.8	t
869	214	2026-05-10 20:26:00.360608+00	label_offset_mm	0.720	-1.0	1.0	t
870	215	2026-05-13 03:49:15.130921+00	net_weight_g	250.50438001105	248	252	t
871	215	2026-05-12 23:21:45.444397+00	fill_volume_ml	503.351816244654	495	505	t
872	215	2026-05-13 03:14:35.216152+00	fill_volume_ml	500.429607615844	495	505	t
873	215	2026-05-12 22:25:28.208249+00	cap_torque_nm	1.65217509422421	1.2	1.8	t
874	215	2026-05-13 02:10:53.672895+00	cap_torque_nm	1.55132994286656	1.2	1.8	t
875	216	2026-04-20 07:20:22.303892+00	net_weight_g	251.416948689337	248	252	t
876	216	2026-04-20 09:59:09.451791+00	net_weight_g	250.305538921876	248	252	t
877	216	2026-04-20 06:19:07.822823+00	fill_volume_ml	500.377258538374	495	505	t
878	216	2026-04-20 06:49:42.889747+00	label_offset_mm	-0.112	-1.0	1.0	t
879	217	2026-04-28 14:14:48.453762+00	fill_volume_ml	497.979449500317	495	505	t
880	217	2026-04-28 18:15:59.120629+00	net_weight_g	248.044119726008	248	252	t
881	217	2026-04-28 15:50:49.126156+00	cap_torque_nm	1.27722186965286	1.2	1.8	t
882	217	2026-04-28 15:38:18.956614+00	net_weight_g	249.458833156522	248	252	t
883	217	2026-04-28 14:31:56.434308+00	net_weight_g	249.289432526909	248	252	t
884	218	2026-04-17 02:04:34.657444+00	viscosity_cp	816.793705536699	800	1200	t
885	218	2026-04-17 00:51:12.018455+00	fill_volume_ml	503.482563900613	495	505	t
886	218	2026-04-16 22:18:19.45444+00	fill_volume_ml	500.185892291116	495	505	t
887	218	2026-04-16 22:37:24.875176+00	viscosity_cp	1107.71543884245	800	1200	t
888	218	2026-04-16 22:25:54.052365+00	cap_torque_nm	1.58682017179499	1.2	1.8	t
889	218	2026-04-17 04:04:39.287299+00	cap_torque_nm	1.6688374601416	1.2	1.8	t
890	219	2026-04-08 09:10:18.135779+00	net_weight_g	249.540205292807	248	252	t
891	219	2026-04-08 10:11:30.399823+00	viscosity_cp	978.060803766309	800	1200	t
892	219	2026-04-08 08:31:29.318736+00	fill_volume_ml	503.64007015082	495	505	t
893	219	2026-04-08 07:20:09.094763+00	viscosity_cp	1150.26559552934	800	1200	t
894	219	2026-04-08 08:13:05.298724+00	net_weight_g	248.161338218871	248	252	t
895	220	2026-04-09 17:44:06.315076+00	net_weight_g	251.37690286441	248	252	t
896	220	2026-04-09 17:18:45.121018+00	label_offset_mm	-0.955	-1.0	1.0	t
897	220	2026-04-09 16:53:24.707372+00	fill_volume_ml	499.723159607874	495	505	t
898	220	2026-04-09 14:13:19.867753+00	net_weight_g	251.698195876591	248	252	t
899	220	2026-04-09 16:29:19.192496+00	cap_torque_nm	1.6295620573319	1.2	1.8	t
900	221	2026-04-11 01:39:32.331674+00	cap_torque_nm	1.74806781212148	1.2	1.8	t
901	221	2026-04-11 00:22:48.808855+00	cap_torque_nm	1.46560304073806	1.2	1.8	t
902	221	2026-04-10 23:09:15.425802+00	fill_volume_ml	499.84087153067	495	505	t
903	221	2026-04-10 22:56:42.080765+00	label_offset_mm	0.586	-1.0	1.0	t
904	222	2026-03-25 09:23:47.945278+00	net_weight_g	248.002721631061	248	252	t
905	222	2026-03-25 08:56:23.152977+00	viscosity_cp	888.97196908242	800	1200	t
906	222	2026-03-25 10:21:17.893752+00	cap_torque_nm	1.72776001575757	1.2	1.8	t
907	222	2026-03-25 08:25:19.524847+00	label_offset_mm	0.405	-1.0	1.0	t
908	223	2026-05-04 14:51:17.641507+00	label_offset_mm	-0.233	-1.0	1.0	t
909	223	2026-05-04 14:30:20.101934+00	fill_volume_ml	496.27985259041	495	505	t
910	223	2026-05-04 14:33:29.964607+00	fill_volume_ml	499.50255406642	495	505	t
911	223	2026-05-04 15:11:56.930343+00	viscosity_cp	939.167010088271	800	1200	t
912	223	2026-05-04 15:44:05.651566+00	label_offset_mm	-0.597	-1.0	1.0	t
913	224	2026-04-13 22:51:55.271622+00	fill_volume_ml	501.307089423205	495	505	t
914	224	2026-04-13 23:05:37.958898+00	cap_torque_nm	1.5033431982823	1.2	1.8	t
915	224	2026-04-13 23:20:46.652615+00	viscosity_cp	877.454364133539	800	1200	t
916	224	2026-04-13 22:17:40.288333+00	cap_torque_nm	1.56782097801478	1.2	1.8	t
917	224	2026-04-13 22:34:34.2064+00	label_offset_mm	0.937	-1.0	1.0	t
918	224	2026-04-13 22:30:11.576686+00	viscosity_cp	1136.24820360142	800	1200	t
919	225	2026-03-17 06:24:18.232369+00	label_offset_mm	0.897	-1.0	1.0	t
920	225	2026-03-17 08:05:43.807426+00	net_weight_g	250.377746495805	248	252	t
921	225	2026-03-17 06:55:26.637674+00	label_offset_mm	-0.969	-1.0	1.0	t
922	226	2026-03-30 15:08:16.757776+00	cap_torque_nm	1.49299538925462	1.2	1.8	t
923	226	2026-03-30 20:29:45.358532+00	fill_volume_ml	499.791218531652	495	505	t
924	226	2026-03-30 15:23:22.189604+00	net_weight_g	248.610326436094	248	252	t
925	226	2026-03-30 19:15:12.001001+00	cap_torque_nm	1.38093661070887	1.2	1.8	t
926	226	2026-03-30 19:33:00.145215+00	fill_volume_ml	501.570761628362	495	505	t
927	226	2026-03-30 16:04:22.900933+00	viscosity_cp	1043.86054145733	800	1200	t
928	227	2026-04-02 00:53:12.210139+00	cap_torque_nm	1.60755308819025	1.2	1.8	t
929	227	2026-04-02 01:35:36.124654+00	fill_volume_ml	498.372842058341	495	505	t
930	227	2026-04-01 23:08:27.908259+00	cap_torque_nm	1.68502648504643	1.2	1.8	t
931	228	2026-04-08 07:07:50.944959+00	cap_torque_nm	1.39244357856328	1.2	1.8	t
932	228	2026-04-08 07:12:09.116361+00	fill_volume_ml	496.02252123045	495	505	t
933	228	2026-04-08 11:42:00.290308+00	label_offset_mm	0.101	-1.0	1.0	t
934	228	2026-04-08 06:26:21.94215+00	cap_torque_nm	1.44557828596515	1.2	1.8	t
935	228	2026-04-08 10:41:37.83816+00	label_offset_mm	-1.110	-1.0	1.0	f
936	229	2026-04-03 15:01:46.835419+00	fill_volume_ml	499.917323965202	495	505	t
937	229	2026-04-03 16:52:42.059305+00	fill_volume_ml	497.725773343503	495	505	t
938	230	2026-03-19 22:13:19.287915+00	cap_torque_nm	1.6190736566298	1.2	1.8	t
939	230	2026-03-19 22:31:04.874835+00	net_weight_g	249.988668699111	248	252	t
940	230	2026-03-20 00:08:52.880326+00	viscosity_cp	976.193346657353	800	1200	t
941	230	2026-03-20 00:57:13.378424+00	cap_torque_nm	1.69263846742173	1.2	1.8	t
942	230	2026-03-20 00:46:39.681543+00	viscosity_cp	949.463910466412	800	1200	t
943	231	2026-04-15 07:36:48.779318+00	label_offset_mm	-0.076	-1.0	1.0	t
944	231	2026-04-15 10:50:13.653049+00	label_offset_mm	0.696	-1.0	1.0	t
945	231	2026-04-15 10:03:48.625584+00	cap_torque_nm	1.25812107230901	1.2	1.8	t
946	232	2026-05-02 17:44:12.989407+00	cap_torque_nm	1.32959585422276	1.2	1.8	t
947	232	2026-05-02 18:39:11.109535+00	net_weight_g	250.413820184334	248	252	t
948	232	2026-05-02 15:44:11.374667+00	net_weight_g	251.963314707852	248	252	t
949	233	2026-04-10 00:19:24.401167+00	net_weight_g	248.519405831821	248	252	t
950	233	2026-04-10 02:38:00.542314+00	fill_volume_ml	503.200978288878	495	505	t
951	233	2026-04-10 01:20:04.389355+00	net_weight_g	249.816203004249	248	252	t
952	233	2026-04-09 23:12:54.263228+00	fill_volume_ml	500.057723845161	495	505	t
953	233	2026-04-09 22:41:15.770733+00	label_offset_mm	-0.884	-1.0	1.0	t
954	234	2026-04-27 09:17:20.128618+00	cap_torque_nm	1.60931521909977	1.2	1.8	t
955	234	2026-04-27 06:54:34.428468+00	label_offset_mm	0.700	-1.0	1.0	t
956	234	2026-04-27 09:33:42.078762+00	net_weight_g	250.254017964361	248	252	t
957	234	2026-04-27 07:39:51.453742+00	net_weight_g	251.719332004064	248	252	t
958	234	2026-04-27 07:40:10.115746+00	label_offset_mm	0.025	-1.0	1.0	t
959	234	2026-04-27 09:12:01.444706+00	cap_torque_nm	1.27691737828738	1.2	1.8	t
960	235	2026-03-23 16:35:43.36943+00	fill_volume_ml	496.003056211363	495	505	t
961	235	2026-03-23 15:17:14.351179+00	label_offset_mm	-0.196	-1.0	1.0	t
962	235	2026-03-23 15:38:59.289813+00	viscosity_cp	1050.64395794291	800	1200	t
963	235	2026-03-23 15:02:29.497955+00	viscosity_cp	1014.14792697184	800	1200	t
964	235	2026-03-23 16:41:23.524288+00	viscosity_cp	1123.61448167197	800	1200	t
965	235	2026-03-23 15:37:21.488111+00	viscosity_cp	900.001856533074	800	1200	t
966	236	2026-05-11 00:55:57.817752+00	cap_torque_nm	1.29299551012983	1.2	1.8	t
967	236	2026-05-11 00:25:44.535516+00	cap_torque_nm	1.41720911593283	1.2	1.8	t
968	236	2026-05-10 23:42:39.491297+00	label_offset_mm	0.539	-1.0	1.0	t
969	236	2026-05-11 03:53:03.303884+00	cap_torque_nm	1.52829322106654	1.2	1.8	t
970	237	2026-05-12 09:25:34.954573+00	cap_torque_nm	1.61198461740242	1.2	1.8	t
971	237	2026-05-12 08:13:08.648918+00	net_weight_g	250.188704864315	248	252	t
972	238	2026-03-27 17:54:43.993271+00	cap_torque_nm	1.37484923823034	1.2	1.8	t
973	238	2026-03-27 17:20:32.436556+00	cap_torque_nm	1.31903785674523	1.2	1.8	t
974	238	2026-03-27 15:26:47.289273+00	viscosity_cp	873.638895426392	800	1200	t
975	238	2026-03-27 21:15:04.77064+00	net_weight_g	250.641439195764	248	252	t
976	238	2026-03-27 15:56:57.381222+00	viscosity_cp	1209.80379769632	800	1200	f
977	239	2026-04-19 22:43:39.960466+00	fill_volume_ml	499.346318647088	495	505	t
978	239	2026-04-19 23:13:57.618493+00	cap_torque_nm	1.60633146286998	1.2	1.8	t
979	239	2026-04-19 22:31:56.871458+00	label_offset_mm	-0.041	-1.0	1.0	t
980	239	2026-04-19 22:44:19.632928+00	label_offset_mm	-1.121	-1.0	1.0	f
981	239	2026-04-19 23:49:58.457316+00	viscosity_cp	1023.6265096825	800	1200	t
982	240	2026-04-23 09:11:30.770383+00	label_offset_mm	0.733	-1.0	1.0	t
983	240	2026-04-23 10:36:01.044731+00	label_offset_mm	-0.548	-1.0	1.0	t
984	241	2026-03-24 15:28:47.492867+00	fill_volume_ml	497.187838134014	495	505	t
985	241	2026-03-24 16:09:20.00388+00	net_weight_g	248.648127214524	248	252	t
986	241	2026-03-24 14:25:06.372418+00	viscosity_cp	1095.24876277666	800	1200	t
987	241	2026-03-24 17:37:35.260504+00	net_weight_g	251.47826410508	248	252	t
988	242	2026-04-09 00:47:50.312349+00	fill_volume_ml	500.981702719682	495	505	t
989	242	2026-04-08 22:45:46.039429+00	viscosity_cp	792.372459019294	800	1200	f
990	242	2026-04-09 03:20:51.427697+00	label_offset_mm	-0.445	-1.0	1.0	t
991	242	2026-04-09 00:10:38.701844+00	cap_torque_nm	1.36758954638589	1.2	1.8	t
992	243	2026-03-21 06:48:08.130714+00	fill_volume_ml	499.700853176701	495	505	t
993	243	2026-03-21 08:06:36.277675+00	label_offset_mm	-0.538	-1.0	1.0	t
994	243	2026-03-21 07:18:52.400504+00	viscosity_cp	1177.78095202961	800	1200	t
995	243	2026-03-21 07:41:05.630748+00	label_offset_mm	-0.668	-1.0	1.0	t
996	243	2026-03-21 06:08:14.954376+00	cap_torque_nm	1.74795262238645	1.2	1.8	t
997	244	2026-04-06 15:39:39.379126+00	cap_torque_nm	1.73746313212098	1.2	1.8	t
998	244	2026-04-06 18:03:44.038436+00	net_weight_g	248.972678038062	248	252	t
999	244	2026-04-06 16:51:39.536831+00	fill_volume_ml	497.439590638683	495	505	t
1000	244	2026-04-06 17:50:04.257173+00	fill_volume_ml	500.385015205401	495	505	t
1001	244	2026-04-06 17:52:05.950264+00	viscosity_cp	776.920488633603	800	1200	f
1002	244	2026-04-06 15:21:04.142486+00	label_offset_mm	-0.521	-1.0	1.0	t
1003	245	2026-04-27 03:21:59.185817+00	viscosity_cp	1008.59939122318	800	1200	t
1004	245	2026-04-27 00:03:18.254363+00	fill_volume_ml	503.244547256489	495	505	t
1005	245	2026-04-26 23:04:23.688594+00	fill_volume_ml	496.140210336403	495	505	t
1006	246	2026-04-29 07:27:36.989727+00	cap_torque_nm	1.56807189153886	1.2	1.8	t
1007	246	2026-04-29 07:13:07.519747+00	label_offset_mm	-0.416	-1.0	1.0	t
1008	246	2026-04-29 07:01:55.189344+00	label_offset_mm	-0.925	-1.0	1.0	t
1009	247	2026-04-11 15:53:57.322746+00	cap_torque_nm	1.35772956410228	1.2	1.8	t
1010	247	2026-04-11 16:15:39.956982+00	label_offset_mm	1.134	-1.0	1.0	f
1011	247	2026-04-11 15:29:20.34394+00	viscosity_cp	768.470230540451	800	1200	f
1012	247	2026-04-11 14:46:28.069046+00	net_weight_g	248.085607573215	248	252	t
1013	247	2026-04-11 15:27:15.743094+00	fill_volume_ml	501.039709044233	495	505	t
1014	247	2026-04-11 16:33:14.956203+00	viscosity_cp	848.464470014196	800	1200	t
1015	248	2026-04-25 01:17:06.075295+00	cap_torque_nm	1.53812586160256	1.2	1.8	t
1016	248	2026-04-25 02:50:32.167022+00	cap_torque_nm	1.59026199719714	1.2	1.8	t
1017	248	2026-04-25 00:53:00.660229+00	net_weight_g	248.277027892516	248	252	t
1018	249	2026-05-07 11:06:03.549931+00	label_offset_mm	0.002	-1.0	1.0	t
1019	249	2026-05-07 11:34:19.143698+00	cap_torque_nm	1.56537907151909	1.2	1.8	t
1020	249	2026-05-07 10:48:07.375938+00	label_offset_mm	-0.286	-1.0	1.0	t
1021	249	2026-05-07 07:37:00.997676+00	fill_volume_ml	501.87706660988	495	505	t
1022	250	2026-04-30 16:13:04.384325+00	fill_volume_ml	498.413426465109	495	505	t
1023	250	2026-04-30 15:17:29.605641+00	label_offset_mm	0.282	-1.0	1.0	t
1024	250	2026-04-30 15:08:35.264263+00	net_weight_g	251.428719783022	248	252	t
1025	250	2026-04-30 16:06:04.605189+00	net_weight_g	250.054852334938	248	252	t
1026	250	2026-04-30 14:19:15.799548+00	cap_torque_nm	1.46637555643171	1.2	1.8	t
1027	251	2026-04-09 00:24:09.316705+00	fill_volume_ml	503.206693699574	495	505	t
1028	251	2026-04-08 23:39:54.223752+00	viscosity_cp	1216.68628974211	800	1200	f
1029	251	2026-04-08 23:42:34.433678+00	label_offset_mm	-1.174	-1.0	1.0	f
1030	251	2026-04-08 22:36:27.645234+00	fill_volume_ml	501.977309473853	495	505	t
1031	251	2026-04-09 00:09:03.326601+00	cap_torque_nm	1.5483610773674	1.2	1.8	t
1032	252	2026-03-26 06:38:34.6729+00	cap_torque_nm	1.31812255762783	1.2	1.8	t
1033	252	2026-03-26 08:46:16.602994+00	cap_torque_nm	1.50562110001691	1.2	1.8	t
1034	252	2026-03-26 07:37:53.97533+00	fill_volume_ml	502.341964421751	495	505	t
1035	252	2026-03-26 09:21:09.447519+00	viscosity_cp	1234.80016467359	800	1200	f
1036	252	2026-03-26 09:22:14.351693+00	label_offset_mm	0.750	-1.0	1.0	t
1037	253	2026-05-08 18:26:17.824139+00	net_weight_g	248.493568334622	248	252	t
1038	253	2026-05-08 15:18:14.247611+00	viscosity_cp	801.046375911956	800	1200	t
1039	253	2026-05-08 17:00:34.95396+00	label_offset_mm	0.688	-1.0	1.0	t
1040	254	2026-04-26 23:06:36.927085+00	viscosity_cp	1047.46267298634	800	1200	t
1041	254	2026-04-26 23:50:32.23927+00	viscosity_cp	1123.9970088304	800	1200	t
1042	254	2026-04-27 01:51:32.485086+00	viscosity_cp	893.223287347079	800	1200	t
1043	254	2026-04-27 01:58:38.840833+00	fill_volume_ml	500.9872214414	495	505	t
1044	254	2026-04-27 01:23:39.603078+00	viscosity_cp	778.382078780992	800	1200	f
1045	255	2026-04-25 08:24:31.670565+00	net_weight_g	251.123358888169	248	252	t
1046	255	2026-04-25 10:28:44.115716+00	cap_torque_nm	1.49750211621073	1.2	1.8	t
1047	255	2026-04-25 09:25:25.779795+00	fill_volume_ml	496.364170879097	495	505	t
1048	255	2026-04-25 06:44:12.517488+00	cap_torque_nm	1.42768956310301	1.2	1.8	t
1049	256	2026-04-13 19:14:36.804786+00	net_weight_g	250.265625275645	248	252	t
1050	256	2026-04-13 19:10:39.180842+00	label_offset_mm	0.926	-1.0	1.0	t
1051	256	2026-04-13 18:41:49.636877+00	net_weight_g	251.994637912254	248	252	t
1052	256	2026-04-13 17:19:40.115696+00	label_offset_mm	-0.952	-1.0	1.0	t
1053	256	2026-04-13 19:09:55.966864+00	viscosity_cp	1209.52822847128	800	1200	f
1054	256	2026-04-13 18:03:15.751351+00	label_offset_mm	0.683	-1.0	1.0	t
1055	257	2026-04-10 22:13:24.397735+00	fill_volume_ml	497.388295389572	495	505	t
1056	257	2026-04-10 22:12:47.906974+00	fill_volume_ml	503.504101456978	495	505	t
1057	257	2026-04-10 23:27:57.503055+00	net_weight_g	249.670888355535	248	252	t
1058	257	2026-04-10 22:20:37.076741+00	net_weight_g	251.243677014877	248	252	t
1059	258	2026-04-19 07:54:01.084407+00	net_weight_g	249.202891497031	248	252	t
1060	258	2026-04-19 09:22:11.044946+00	net_weight_g	249.259772919118	248	252	t
1061	258	2026-04-19 10:26:07.335234+00	net_weight_g	251.406045077914	248	252	t
1062	258	2026-04-19 08:19:48.670012+00	label_offset_mm	0.002	-1.0	1.0	t
1063	258	2026-04-19 10:40:58.539149+00	net_weight_g	251.801705679259	248	252	t
1064	259	2026-05-02 15:26:43.296131+00	fill_volume_ml	496.765414179933	495	505	t
1065	259	2026-05-02 15:58:14.37449+00	viscosity_cp	1215.17383115874	800	1200	f
1066	259	2026-05-02 15:11:32.3535+00	net_weight_g	251.954851396778	248	252	t
1067	259	2026-05-02 16:01:36.379246+00	fill_volume_ml	497.796812685601	495	505	t
1068	260	2026-03-28 23:39:54.143407+00	net_weight_g	248.730448880811	248	252	t
1069	260	2026-03-28 22:26:55.934726+00	net_weight_g	250.681122428465	248	252	t
1070	260	2026-03-28 22:13:49.109491+00	label_offset_mm	-0.724	-1.0	1.0	t
1071	260	2026-03-29 00:15:28.066384+00	viscosity_cp	755.5569074777	800	1200	f
1072	260	2026-03-28 23:34:54.417234+00	net_weight_g	250.964316144448	248	252	t
1073	261	2026-05-14 07:39:57.096847+00	cap_torque_nm	1.37581985385501	1.2	1.8	t
1074	261	2026-05-14 08:57:08.62332+00	viscosity_cp	1181.62822213939	800	1200	t
1075	261	2026-05-14 12:31:48.448776+00	viscosity_cp	1087.847363836	800	1200	t
1076	262	2026-05-02 15:25:13.671546+00	net_weight_g	250.590041565516	248	252	t
1077	262	2026-05-02 20:06:17.069986+00	net_weight_g	250.894412992859	248	252	t
1078	262	2026-05-02 20:48:47.462379+00	label_offset_mm	-0.733	-1.0	1.0	t
1079	263	2026-04-26 23:26:30.261889+00	cap_torque_nm	1.57231887867395	1.2	1.8	t
1080	263	2026-04-27 00:55:36.19141+00	viscosity_cp	1009.8686508905	800	1200	t
1081	263	2026-04-26 22:32:40.214314+00	viscosity_cp	1193.69869796144	800	1200	t
1082	263	2026-04-27 00:00:52.651841+00	fill_volume_ml	498.98723600255	495	505	t
1083	263	2026-04-27 00:23:36.237637+00	viscosity_cp	1204.84059569376	800	1200	f
1084	263	2026-04-27 00:27:25.810984+00	fill_volume_ml	498.498599611565	495	505	t
1085	264	2026-03-24 11:05:01.975608+00	net_weight_g	249.188586491468	248	252	t
1086	264	2026-03-24 08:45:25.68861+00	cap_torque_nm	1.62399041931271	1.2	1.8	t
1087	264	2026-03-24 12:49:59.859989+00	net_weight_g	249.710862636482	248	252	t
1088	264	2026-03-24 12:42:52.322387+00	fill_volume_ml	498.457291281982	495	505	t
1089	265	2026-04-11 15:36:26.759917+00	fill_volume_ml	499.628822994176	495	505	t
1090	265	2026-04-11 16:02:13.132394+00	cap_torque_nm	1.67856889548412	1.2	1.8	t
1091	265	2026-04-11 15:25:11.216632+00	viscosity_cp	799.126827125076	800	1200	f
1092	265	2026-04-11 15:41:28.428511+00	viscosity_cp	1036.68264276849	800	1200	t
1093	265	2026-04-11 14:41:53.149756+00	label_offset_mm	-0.881	-1.0	1.0	t
1094	266	2026-04-09 23:48:12.76954+00	cap_torque_nm	1.4147540253302	1.2	1.8	t
1095	266	2026-04-10 01:00:18.722487+00	viscosity_cp	809.316580167238	800	1200	t
1096	267	2026-04-04 07:20:09.818042+00	fill_volume_ml	498.798496600943	495	505	t
1097	267	2026-04-04 07:32:36.37431+00	viscosity_cp	1168.53738746299	800	1200	t
1098	268	2026-03-19 14:40:25.632883+00	fill_volume_ml	498.959964031505	495	505	t
1099	268	2026-03-19 16:05:07.545316+00	viscosity_cp	1233.6621191385	800	1200	f
1100	268	2026-03-19 15:30:55.16066+00	net_weight_g	248.569366141381	248	252	t
1101	268	2026-03-19 15:36:25.14151+00	label_offset_mm	1.083	-1.0	1.0	f
1102	268	2026-03-19 16:07:41.492678+00	label_offset_mm	-0.805	-1.0	1.0	t
1103	269	2026-04-27 23:07:56.666684+00	viscosity_cp	1035.94958743728	800	1200	t
1104	269	2026-04-27 23:43:22.916655+00	cap_torque_nm	1.74742992926847	1.2	1.8	t
1105	270	2026-04-29 09:12:34.671212+00	label_offset_mm	-0.679	-1.0	1.0	t
1106	270	2026-04-29 07:59:47.434605+00	net_weight_g	250.684626534619	248	252	t
1107	270	2026-04-29 10:10:18.056994+00	cap_torque_nm	1.39823773532627	1.2	1.8	t
1108	271	2026-05-10 17:30:28.754716+00	fill_volume_ml	499.093041822136	495	505	t
1109	271	2026-05-10 18:33:38.637934+00	label_offset_mm	0.282	-1.0	1.0	t
1110	272	2026-04-30 00:23:37.603732+00	net_weight_g	250.121711922943	248	252	t
1111	272	2026-04-30 02:40:48.848453+00	cap_torque_nm	1.47688769037245	1.2	1.8	t
1112	272	2026-04-30 00:28:32.329117+00	viscosity_cp	1062.37811900938	800	1200	t
1113	273	2026-04-24 10:29:04.42357+00	net_weight_g	249.249625664143	248	252	t
1114	273	2026-04-24 06:32:05.07567+00	viscosity_cp	859.147858451245	800	1200	t
1115	273	2026-04-24 07:09:24.054106+00	fill_volume_ml	500.171336778839	495	505	t
1116	274	2026-03-25 14:22:07.901435+00	net_weight_g	249.995283368566	248	252	t
1117	274	2026-03-25 17:09:27.682638+00	cap_torque_nm	1.31210675213898	1.2	1.8	t
1118	274	2026-03-25 14:53:17.528349+00	viscosity_cp	1236.80816435114	800	1200	f
1119	275	2026-05-10 01:20:10.522637+00	net_weight_g	249.760055012346	248	252	t
1120	275	2026-05-09 23:26:57.056308+00	viscosity_cp	1106.98061327283	800	1200	t
1121	275	2026-05-09 23:08:09.831334+00	net_weight_g	250.615726075374	248	252	t
1122	275	2026-05-10 01:12:43.633248+00	cap_torque_nm	1.40007626756451	1.2	1.8	t
1123	275	2026-05-09 22:54:35.336763+00	label_offset_mm	-0.830	-1.0	1.0	t
1124	276	2026-04-21 10:32:18.213743+00	label_offset_mm	-0.848	-1.0	1.0	t
1125	276	2026-04-21 07:04:14.823466+00	viscosity_cp	1204.18161219436	800	1200	f
1126	277	2026-03-20 20:14:18.90329+00	net_weight_g	249.85945150938	248	252	t
1127	277	2026-03-20 18:21:28.58641+00	viscosity_cp	1239.28195334945	800	1200	f
1128	277	2026-03-20 16:46:17.743359+00	fill_volume_ml	503.362713579339	495	505	t
1129	277	2026-03-20 18:30:08.556167+00	cap_torque_nm	1.34976737540935	1.2	1.8	t
1130	278	2026-03-22 00:47:17.142062+00	viscosity_cp	1092.70008086911	800	1200	t
1131	278	2026-03-21 23:03:35.739669+00	label_offset_mm	-0.729	-1.0	1.0	t
1132	278	2026-03-21 23:15:08.708856+00	net_weight_g	250.823337631036	248	252	t
1133	278	2026-03-21 22:56:32.344163+00	cap_torque_nm	1.69631842759832	1.2	1.8	t
1134	278	2026-03-21 23:09:55.073708+00	fill_volume_ml	501.44162968416	495	505	t
1135	279	2026-03-25 06:13:36.005864+00	fill_volume_ml	497.026167729744	495	505	t
1136	279	2026-03-25 06:48:09.387079+00	viscosity_cp	1088.92208900112	800	1200	t
1137	279	2026-03-25 06:33:59.125565+00	cap_torque_nm	1.50639815597001	1.2	1.8	t
1138	279	2026-03-25 06:55:48.422281+00	net_weight_g	250.255696379933	248	252	t
1139	279	2026-03-25 08:38:20.939223+00	fill_volume_ml	502.364498748022	495	505	t
1140	279	2026-03-25 08:05:10.386099+00	net_weight_g	250.657978336879	248	252	t
1141	280	2026-04-20 15:37:16.692575+00	label_offset_mm	0.775	-1.0	1.0	t
1142	280	2026-04-20 15:19:26.141825+00	cap_torque_nm	1.48686391114989	1.2	1.8	t
1143	280	2026-04-20 15:44:36.318879+00	net_weight_g	249.986523758776	248	252	t
1144	280	2026-04-20 15:29:37.546795+00	viscosity_cp	1008.48578438764	800	1200	t
1145	280	2026-04-20 16:01:18.492642+00	viscosity_cp	775.105198873765	800	1200	f
1146	281	2026-04-01 03:04:41.064114+00	cap_torque_nm	1.31820395677112	1.2	1.8	t
1147	281	2026-04-01 02:31:42.282992+00	viscosity_cp	1025.18816044151	800	1200	t
1148	281	2026-04-01 01:15:06.534419+00	viscosity_cp	1012.11148048304	800	1200	t
1149	281	2026-04-01 01:29:27.446236+00	label_offset_mm	-0.498	-1.0	1.0	t
1150	282	2026-05-04 07:39:48.693947+00	fill_volume_ml	498.568621808166	495	505	t
1151	282	2026-05-04 08:25:17.947258+00	net_weight_g	248.309097517043	248	252	t
1152	282	2026-05-04 08:01:54.92401+00	fill_volume_ml	499.849507520912	495	505	t
1153	282	2026-05-04 09:52:04.477992+00	label_offset_mm	-0.667	-1.0	1.0	t
1154	283	2026-04-28 15:02:42.047234+00	fill_volume_ml	496.904322224913	495	505	t
1155	283	2026-04-28 18:15:20.732138+00	cap_torque_nm	1.44604023965679	1.2	1.8	t
1156	283	2026-04-28 18:19:34.043785+00	label_offset_mm	0.914	-1.0	1.0	t
1157	284	2026-04-23 23:01:05.513553+00	fill_volume_ml	501.280959153728	495	505	t
1158	284	2026-04-23 22:23:22.086345+00	net_weight_g	250.35605228128	248	252	t
1159	284	2026-04-23 23:51:32.523599+00	label_offset_mm	0.748	-1.0	1.0	t
1160	284	2026-04-23 22:18:55.87928+00	net_weight_g	249.805976994851	248	252	t
1161	284	2026-04-23 22:28:17.368584+00	net_weight_g	250.203116635468	248	252	t
1162	284	2026-04-23 22:46:26.735215+00	fill_volume_ml	500.231501827223	495	505	t
1163	285	2026-04-07 08:42:11.105658+00	viscosity_cp	769.588934897815	800	1200	f
1164	285	2026-04-07 07:10:44.561628+00	viscosity_cp	1230.57744706232	800	1200	f
1165	285	2026-04-07 06:52:54.405428+00	viscosity_cp	1151.41186324846	800	1200	t
1166	286	2026-04-08 17:07:38.770947+00	net_weight_g	249.285300269951	248	252	t
1167	286	2026-04-08 17:08:36.620764+00	cap_torque_nm	1.36762167772535	1.2	1.8	t
1168	287	2026-03-29 00:50:52.910473+00	viscosity_cp	935.937031290349	800	1200	t
1169	287	2026-03-29 00:46:24.134814+00	cap_torque_nm	1.29238742276237	1.2	1.8	t
1170	287	2026-03-28 23:31:08.19446+00	cap_torque_nm	1.57104805623971	1.2	1.8	t
1171	287	2026-03-29 00:36:36.717555+00	fill_volume_ml	500.426716662556	495	505	t
1172	287	2026-03-28 23:27:30.725409+00	viscosity_cp	1046.87643670711	800	1200	t
1173	288	2026-05-12 06:07:38.074005+00	net_weight_g	248.388731066121	248	252	t
1174	288	2026-05-12 06:12:50.146376+00	net_weight_g	249.616090706584	248	252	t
1175	288	2026-05-12 07:22:49.488778+00	label_offset_mm	1.168	-1.0	1.0	f
1176	289	2026-05-08 14:41:56.538236+00	cap_torque_nm	1.6063480793362	1.2	1.8	t
1177	289	2026-05-08 19:20:13.948224+00	cap_torque_nm	1.611823447475	1.2	1.8	t
1178	289	2026-05-08 16:12:28.691248+00	label_offset_mm	0.391	-1.0	1.0	t
1179	289	2026-05-08 14:31:11.69546+00	fill_volume_ml	502.953034373369	495	505	t
1180	290	2026-05-16 00:52:31.193381+00	viscosity_cp	1209.73462333726	800	1200	f
1181	290	2026-05-15 22:50:42.629976+00	viscosity_cp	807.175208475026	800	1200	t
1182	290	2026-05-15 23:12:51.79599+00	net_weight_g	251.819826669532	248	252	t
1183	291	2026-04-27 06:16:46.383286+00	fill_volume_ml	501.465620859653	495	505	t
1184	291	2026-04-27 06:25:39.814829+00	net_weight_g	251.496693224588	248	252	t
1185	292	2026-04-07 15:57:44.92714+00	label_offset_mm	1.085	-1.0	1.0	f
1186	292	2026-04-07 16:50:34.61488+00	net_weight_g	251.797369532884	248	252	t
1187	292	2026-04-07 15:57:47.043662+00	viscosity_cp	761.615777359991	800	1200	f
1188	292	2026-04-07 16:29:59.887853+00	label_offset_mm	-0.869	-1.0	1.0	t
1189	292	2026-04-07 16:56:20.87346+00	label_offset_mm	-0.614	-1.0	1.0	t
1190	292	2026-04-07 14:10:55.070597+00	fill_volume_ml	502.953506510438	495	505	t
1191	293	2026-03-25 00:48:01.356496+00	viscosity_cp	1011.20911696245	800	1200	t
1192	293	2026-03-24 23:45:23.717307+00	fill_volume_ml	496.471791022257	495	505	t
1193	293	2026-03-24 23:28:30.347018+00	viscosity_cp	1066.0415867615	800	1200	t
1194	293	2026-03-25 00:10:09.560792+00	fill_volume_ml	497.153594625244	495	505	t
1195	293	2026-03-24 23:24:11.407979+00	net_weight_g	248.906547514611	248	252	t
1196	293	2026-03-25 00:41:29.786334+00	cap_torque_nm	1.45710489615968	1.2	1.8	t
1197	294	2026-04-05 07:12:37.912817+00	net_weight_g	250.221339056398	248	252	t
1198	294	2026-04-05 06:51:15.23102+00	net_weight_g	251.178400119806	248	252	t
1199	294	2026-04-05 09:25:17.675324+00	label_offset_mm	-0.692	-1.0	1.0	t
1200	295	2026-03-20 14:26:11.869593+00	label_offset_mm	0.930	-1.0	1.0	t
1201	295	2026-03-20 16:06:14.054033+00	viscosity_cp	990.231508006903	800	1200	t
1202	295	2026-03-20 15:23:00.734426+00	net_weight_g	248.326297537797	248	252	t
1203	295	2026-03-20 18:40:59.359298+00	net_weight_g	250.146709032809	248	252	t
1204	296	2026-05-07 23:13:42.584431+00	label_offset_mm	0.218	-1.0	1.0	t
1205	296	2026-05-08 00:48:19.25213+00	cap_torque_nm	1.35141672513954	1.2	1.8	t
1206	296	2026-05-08 00:17:13.571925+00	cap_torque_nm	1.3043378332859	1.2	1.8	t
1207	296	2026-05-07 22:47:35.647997+00	label_offset_mm	0.688	-1.0	1.0	t
1208	296	2026-05-07 23:03:54.73674+00	fill_volume_ml	503.884059750313	495	505	t
1209	297	2026-04-13 12:16:46.021959+00	cap_torque_nm	1.25143794498602	1.2	1.8	t
1210	297	2026-04-13 07:41:04.067323+00	cap_torque_nm	1.31141594012395	1.2	1.8	t
1211	298	2026-04-02 16:02:48.214128+00	cap_torque_nm	1.58567242951842	1.2	1.8	t
1212	298	2026-04-02 16:09:41.95684+00	net_weight_g	251.766619173169	248	252	t
1213	298	2026-04-02 16:36:30.045301+00	cap_torque_nm	1.37650831325081	1.2	1.8	t
1214	298	2026-04-02 15:32:18.26203+00	net_weight_g	250.248868566966	248	252	t
1215	298	2026-04-02 19:51:27.166152+00	net_weight_g	248.770891332023	248	252	t
1216	298	2026-04-02 16:04:48.081256+00	net_weight_g	251.176225311576	248	252	t
1217	299	2026-05-07 22:59:31.892568+00	label_offset_mm	0.678	-1.0	1.0	t
1218	299	2026-05-08 02:10:49.984326+00	fill_volume_ml	498.361566056939	495	505	t
1219	299	2026-05-08 01:20:15.274574+00	label_offset_mm	-0.820	-1.0	1.0	t
1220	300	2026-03-19 09:29:05.697304+00	viscosity_cp	822.536638527873	800	1200	t
1221	300	2026-03-19 09:19:18.78804+00	fill_volume_ml	503.445931322867	495	505	t
1222	300	2026-03-19 10:24:57.585705+00	fill_volume_ml	500.302749299157	495	505	t
1223	300	2026-03-19 10:20:01.392082+00	fill_volume_ml	502.199806360801	495	505	t
1224	301	2026-05-04 16:01:32.231168+00	fill_volume_ml	502.690475995453	495	505	t
1225	301	2026-05-04 16:34:37.640167+00	label_offset_mm	-0.751	-1.0	1.0	t
1226	301	2026-05-04 16:12:35.477032+00	label_offset_mm	0.980	-1.0	1.0	t
1227	302	2026-03-28 01:59:15.006933+00	cap_torque_nm	1.34461267855181	1.2	1.8	t
1228	302	2026-03-28 04:08:47.23669+00	label_offset_mm	0.077	-1.0	1.0	t
1229	302	2026-03-28 03:31:04.274207+00	net_weight_g	249.312137821954	248	252	t
1230	302	2026-03-28 02:14:07.98477+00	viscosity_cp	1135.1807910686	800	1200	t
1231	302	2026-03-28 04:04:35.404826+00	fill_volume_ml	498.684173687386	495	505	t
1232	303	2026-03-20 10:44:30.709077+00	viscosity_cp	1078.48397155407	800	1200	t
1233	303	2026-03-20 11:21:26.550154+00	viscosity_cp	1050.44463179238	800	1200	t
1234	303	2026-03-20 09:32:42.198489+00	label_offset_mm	0.064	-1.0	1.0	t
1235	303	2026-03-20 11:36:19.179518+00	fill_volume_ml	496.601440152322	495	505	t
1236	304	2026-05-13 14:26:18.829553+00	viscosity_cp	1229.96534126594	800	1200	f
1237	304	2026-05-13 15:09:29.609689+00	net_weight_g	248.11501517336	248	252	t
1238	304	2026-05-13 15:33:53.238319+00	fill_volume_ml	498.22193709403	495	505	t
1239	304	2026-05-13 15:03:34.964861+00	fill_volume_ml	497.686148379433	495	505	t
1240	304	2026-05-13 15:42:11.486596+00	fill_volume_ml	497.719272610279	495	505	t
1241	305	2026-04-16 02:46:43.898565+00	cap_torque_nm	1.73663847121536	1.2	1.8	t
1242	305	2026-04-16 03:27:20.527558+00	net_weight_g	248.87679762164	248	252	t
1243	305	2026-04-16 00:59:05.567626+00	label_offset_mm	0.035	-1.0	1.0	t
1244	306	2026-04-11 11:11:42.693509+00	net_weight_g	250.231176495205	248	252	t
1245	306	2026-04-11 09:24:32.726718+00	fill_volume_ml	500.941181380809	495	505	t
1246	306	2026-04-11 11:05:51.768782+00	cap_torque_nm	1.58083284583278	1.2	1.8	t
1247	306	2026-04-11 08:47:28.290067+00	cap_torque_nm	1.52267998428024	1.2	1.8	t
1248	306	2026-04-11 11:14:25.169509+00	fill_volume_ml	502.621173224294	495	505	t
1249	306	2026-04-11 11:00:29.226794+00	net_weight_g	248.429858183085	248	252	t
1250	307	2026-04-15 16:34:44.621311+00	net_weight_g	251.54417560599	248	252	t
1251	307	2026-04-15 16:32:08.070666+00	fill_volume_ml	501.692769910502	495	505	t
1252	307	2026-04-15 20:49:15.479424+00	label_offset_mm	-0.146	-1.0	1.0	t
1253	308	2026-04-27 22:46:06.581345+00	label_offset_mm	-0.297	-1.0	1.0	t
1254	308	2026-04-28 02:22:38.125965+00	cap_torque_nm	1.695606518158	1.2	1.8	t
1255	309	2026-04-28 06:57:23.750173+00	viscosity_cp	952.400491008167	800	1200	t
1256	309	2026-04-28 07:03:43.969993+00	viscosity_cp	1242.29881328822	800	1200	f
1257	309	2026-04-28 07:33:20.149671+00	net_weight_g	249.629513039039	248	252	t
1258	309	2026-04-28 07:28:07.423524+00	fill_volume_ml	500.986388443027	495	505	t
1259	309	2026-04-28 07:13:08.4554+00	viscosity_cp	971.586398002632	800	1200	t
1260	309	2026-04-28 11:34:43.976965+00	label_offset_mm	-0.773	-1.0	1.0	t
1261	310	2026-04-12 15:37:17.780385+00	viscosity_cp	1008.88943910753	800	1200	t
1262	310	2026-04-12 14:54:46.438275+00	cap_torque_nm	1.72129855106329	1.2	1.8	t
1263	310	2026-04-12 14:58:39.21005+00	label_offset_mm	-0.543	-1.0	1.0	t
1264	310	2026-04-12 16:50:32.869302+00	fill_volume_ml	500.709729208299	495	505	t
1265	310	2026-04-12 14:15:50.97544+00	fill_volume_ml	498.356714620196	495	505	t
1266	311	2026-03-18 22:57:46.193667+00	viscosity_cp	1185.70638933494	800	1200	t
1267	311	2026-03-18 22:24:01.269897+00	viscosity_cp	963.568202909532	800	1200	t
1268	311	2026-03-18 22:15:17.292476+00	viscosity_cp	1015.07761959238	800	1200	t
1269	311	2026-03-18 22:21:17.874109+00	cap_torque_nm	1.53353667753523	1.2	1.8	t
1270	312	2026-03-19 11:11:32.329242+00	viscosity_cp	1080.14486793321	800	1200	t
1271	312	2026-03-19 07:57:37.698102+00	label_offset_mm	0.662	-1.0	1.0	t
1272	312	2026-03-19 08:23:07.442033+00	fill_volume_ml	503.911014232944	495	505	t
1273	312	2026-03-19 10:42:53.707311+00	label_offset_mm	1.065	-1.0	1.0	f
1274	312	2026-03-19 07:38:03.203547+00	net_weight_g	249.516019538198	248	252	t
1275	313	2026-03-23 17:42:03.714699+00	label_offset_mm	0.667	-1.0	1.0	t
1276	313	2026-03-23 17:01:57.312356+00	cap_torque_nm	1.68141772654473	1.2	1.8	t
1277	313	2026-03-23 17:39:25.261503+00	cap_torque_nm	1.64432463206253	1.2	1.8	t
1278	313	2026-03-23 18:43:48.533746+00	label_offset_mm	0.594	-1.0	1.0	t
1279	314	2026-03-29 23:56:41.32413+00	viscosity_cp	804.244880547649	800	1200	t
1280	314	2026-03-29 22:36:22.45544+00	cap_torque_nm	1.64592883238401	1.2	1.8	t
1281	314	2026-03-30 01:42:34.613709+00	net_weight_g	249.08655532207	248	252	t
1282	314	2026-03-29 23:54:41.509455+00	fill_volume_ml	503.233387043326	495	505	t
1283	315	2026-05-08 08:40:56.788148+00	cap_torque_nm	1.42204208388598	1.2	1.8	t
1284	315	2026-05-08 09:05:23.062833+00	net_weight_g	249.066220433705	248	252	t
1285	315	2026-05-08 06:29:27.123736+00	net_weight_g	248.649860323274	248	252	t
1286	315	2026-05-08 06:40:55.919134+00	net_weight_g	248.66545073974	248	252	t
1287	315	2026-05-08 07:21:52.297838+00	label_offset_mm	1.034	-1.0	1.0	f
1288	315	2026-05-08 06:25:24.211136+00	net_weight_g	251.08329095927	248	252	t
1289	316	2026-05-11 16:47:31.297215+00	cap_torque_nm	1.49505632461406	1.2	1.8	t
1290	316	2026-05-11 16:34:48.045653+00	viscosity_cp	961.161163788746	800	1200	t
1291	316	2026-05-11 15:46:11.562359+00	cap_torque_nm	1.26246663661151	1.2	1.8	t
1292	316	2026-05-11 17:11:57.744786+00	viscosity_cp	1161.08063403265	800	1200	t
1293	316	2026-05-11 18:52:28.557454+00	fill_volume_ml	499.589528626507	495	505	t
1294	316	2026-05-11 18:16:41.245817+00	viscosity_cp	920.836764978794	800	1200	t
1295	317	2026-05-17 03:26:02.997694+00	net_weight_g	251.395053579235	248	252	t
1296	317	2026-05-17 00:51:00.490665+00	fill_volume_ml	500.179299045789	495	505	t
1297	317	2026-05-17 01:25:53.647174+00	label_offset_mm	-0.836	-1.0	1.0	t
1298	317	2026-05-17 00:33:39.565685+00	label_offset_mm	0.692	-1.0	1.0	t
1299	317	2026-05-16 23:49:17.203135+00	label_offset_mm	-0.778	-1.0	1.0	t
1300	318	2026-05-10 07:38:38.196733+00	fill_volume_ml	502.460098754789	495	505	t
1301	318	2026-05-10 08:32:48.861346+00	net_weight_g	249.562367893608	248	252	t
1302	319	2026-04-19 15:50:31.855756+00	label_offset_mm	-1.177	-1.0	1.0	f
1303	319	2026-04-19 14:26:24.374426+00	cap_torque_nm	1.67640430748137	1.2	1.8	t
1304	319	2026-04-19 15:42:22.908191+00	cap_torque_nm	1.4387214025194	1.2	1.8	t
1305	319	2026-04-19 14:58:33.790469+00	cap_torque_nm	1.43705880573444	1.2	1.8	t
1306	320	2026-03-19 23:22:58.375801+00	net_weight_g	249.065743598716	248	252	t
1307	320	2026-03-19 23:42:42.614258+00	cap_torque_nm	1.42105370595379	1.2	1.8	t
1308	320	2026-03-19 23:08:47.772777+00	net_weight_g	251.719083785906	248	252	t
1309	320	2026-03-20 00:59:39.730915+00	cap_torque_nm	1.55965702743081	1.2	1.8	t
1310	320	2026-03-20 00:02:52.252315+00	label_offset_mm	-0.073	-1.0	1.0	t
1311	320	2026-03-19 23:50:25.779691+00	label_offset_mm	-0.749	-1.0	1.0	t
1312	321	2026-03-26 07:29:22.215034+00	viscosity_cp	1102.39790390945	800	1200	t
1313	321	2026-03-26 07:24:58.06099+00	net_weight_g	248.162674927407	248	252	t
1314	321	2026-03-26 10:28:23.010349+00	cap_torque_nm	1.72384999450664	1.2	1.8	t
1315	321	2026-03-26 13:20:28.96898+00	fill_volume_ml	498.621652855059	495	505	t
1316	321	2026-03-26 09:18:18.338817+00	net_weight_g	248.56901730989	248	252	t
1317	322	2026-03-17 15:55:51.357602+00	fill_volume_ml	498.349594240711	495	505	t
1318	322	2026-03-17 14:35:58.550343+00	fill_volume_ml	503.951949374782	495	505	t
1319	322	2026-03-17 15:04:31.613862+00	net_weight_g	250.454593168004	248	252	t
1320	322	2026-03-17 15:58:00.048756+00	net_weight_g	249.281837355037	248	252	t
1321	323	2026-04-11 02:48:25.563547+00	cap_torque_nm	1.69701167646204	1.2	1.8	t
1322	323	2026-04-11 00:57:32.111602+00	cap_torque_nm	1.52190656383447	1.2	1.8	t
1323	324	2026-05-14 06:33:20.652065+00	label_offset_mm	0.667	-1.0	1.0	t
1324	324	2026-05-14 08:31:39.293975+00	label_offset_mm	0.905	-1.0	1.0	t
1325	324	2026-05-14 07:29:53.608481+00	cap_torque_nm	1.64499107483979	1.2	1.8	t
1326	324	2026-05-14 07:52:39.641906+00	cap_torque_nm	1.45295525320929	1.2	1.8	t
1327	324	2026-05-14 09:33:33.540793+00	label_offset_mm	0.610	-1.0	1.0	t
1328	324	2026-05-14 09:55:47.920355+00	viscosity_cp	767.595309642715	800	1200	f
1329	325	2026-05-16 16:22:01.667508+00	viscosity_cp	909.26098434719	800	1200	t
1330	325	2026-05-16 18:10:51.342826+00	net_weight_g	249.565968042757	248	252	t
1331	325	2026-05-16 15:08:05.785509+00	viscosity_cp	1028.77787719167	800	1200	t
1332	325	2026-05-16 17:23:20.959906+00	cap_torque_nm	1.44595682095462	1.2	1.8	t
1333	325	2026-05-16 15:32:08.17236+00	fill_volume_ml	499.087033873001	495	505	t
1334	326	2026-05-10 23:35:18.568222+00	fill_volume_ml	498.594388951376	495	505	t
1335	326	2026-05-10 22:22:23.702447+00	viscosity_cp	823.492556104905	800	1200	t
1336	326	2026-05-11 00:16:42.924033+00	cap_torque_nm	1.61768860075282	1.2	1.8	t
1337	327	2026-03-18 08:09:18.2889+00	cap_torque_nm	1.34629122674171	1.2	1.8	t
1338	327	2026-03-18 06:13:08.620972+00	cap_torque_nm	1.36758125817035	1.2	1.8	t
1339	328	2026-04-01 14:04:52.268634+00	net_weight_g	248.691227943724	248	252	t
1340	328	2026-04-01 14:12:49.998986+00	net_weight_g	249.980793405649	248	252	t
1341	328	2026-04-01 14:33:59.009723+00	net_weight_g	251.721155439303	248	252	t
1342	328	2026-04-01 14:07:44.102821+00	net_weight_g	250.084314897294	248	252	t
1343	328	2026-04-01 14:47:29.779746+00	net_weight_g	248.503406626845	248	252	t
1344	328	2026-04-01 14:14:25.036886+00	cap_torque_nm	1.60348298671548	1.2	1.8	t
1345	329	2026-04-08 23:51:51.071709+00	net_weight_g	249.195685796814	248	252	t
1346	329	2026-04-08 22:31:18.899298+00	fill_volume_ml	501.057426686519	495	505	t
1347	329	2026-04-08 23:56:03.275975+00	fill_volume_ml	496.469062014386	495	505	t
1348	329	2026-04-09 02:09:29.234898+00	cap_torque_nm	1.36240008971293	1.2	1.8	t
1349	330	2026-04-20 07:29:35.336274+00	viscosity_cp	848.593037431331	800	1200	t
1350	330	2026-04-20 11:22:22.073003+00	net_weight_g	248.608931939481	248	252	t
1351	331	2026-03-27 16:33:02.372959+00	viscosity_cp	1146.56772353755	800	1200	t
1352	331	2026-03-27 16:07:34.511228+00	viscosity_cp	858.176219421892	800	1200	t
1353	331	2026-03-27 14:49:44.926127+00	label_offset_mm	0.367	-1.0	1.0	t
1354	331	2026-03-27 17:16:22.819698+00	cap_torque_nm	1.4364060724565	1.2	1.8	t
1355	331	2026-03-27 14:23:58.796269+00	net_weight_g	251.584654892339	248	252	t
1356	331	2026-03-27 15:25:22.208604+00	cap_torque_nm	1.59318754069652	1.2	1.8	t
1357	332	2026-03-28 22:39:49.707401+00	fill_volume_ml	501.519908265073	495	505	t
1358	332	2026-03-28 22:42:14.952206+00	viscosity_cp	1210.29723042091	800	1200	f
1359	332	2026-03-28 23:05:30.637577+00	net_weight_g	251.205924891561	248	252	t
1360	332	2026-03-28 22:21:03.901243+00	net_weight_g	251.948032347118	248	252	t
1361	332	2026-03-28 22:30:27.295467+00	viscosity_cp	998.629125099094	800	1200	t
1362	333	2026-04-24 07:50:30.709002+00	net_weight_g	250.128407353377	248	252	t
1363	333	2026-04-24 07:08:17.507244+00	fill_volume_ml	496.930694818837	495	505	t
1364	334	2026-04-09 14:10:25.813367+00	fill_volume_ml	499.492007359796	495	505	t
1365	334	2026-04-09 15:50:31.382738+00	net_weight_g	248.803386680409	248	252	t
1366	334	2026-04-09 16:36:32.041825+00	label_offset_mm	-0.776	-1.0	1.0	t
1367	334	2026-04-09 15:20:00.851037+00	fill_volume_ml	496.982674870417	495	505	t
1368	334	2026-04-09 14:30:44.850165+00	net_weight_g	251.258367565781	248	252	t
1369	335	2026-04-09 00:56:34.616716+00	viscosity_cp	900.807898331774	800	1200	t
1370	335	2026-04-09 01:12:03.457642+00	viscosity_cp	1056.30883926231	800	1200	t
1371	335	2026-04-09 01:06:23.746037+00	viscosity_cp	1177.0910273918	800	1200	t
1372	335	2026-04-08 22:21:10.356074+00	viscosity_cp	1075.14579725488	800	1200	t
1373	336	2026-05-14 12:00:51.775619+00	net_weight_g	248.469396254676	248	252	t
1374	336	2026-05-14 11:38:04.127969+00	label_offset_mm	0.502	-1.0	1.0	t
1375	336	2026-05-14 07:48:35.270079+00	fill_volume_ml	502.725416911321	495	505	t
1376	337	2026-04-02 14:24:46.994703+00	viscosity_cp	1166.85082744852	800	1200	t
1377	337	2026-04-02 15:12:34.486434+00	fill_volume_ml	498.976199191787	495	505	t
1378	337	2026-04-02 15:37:27.526518+00	net_weight_g	248.286045523758	248	252	t
1379	337	2026-04-02 18:17:26.572843+00	label_offset_mm	0.294	-1.0	1.0	t
1380	338	2026-05-15 22:45:02.05773+00	viscosity_cp	865.566825562895	800	1200	t
1381	338	2026-05-15 23:39:25.982414+00	net_weight_g	250.951663192107	248	252	t
1382	338	2026-05-15 22:16:40.89647+00	label_offset_mm	1.066	-1.0	1.0	f
1383	339	2026-03-27 07:07:46.600764+00	viscosity_cp	776.506787172966	800	1200	f
1384	339	2026-03-27 08:22:40.592838+00	viscosity_cp	1015.91043393633	800	1200	t
1385	340	2026-05-04 15:59:47.936355+00	cap_torque_nm	1.71881058256923	1.2	1.8	t
1386	340	2026-05-04 19:16:11.568071+00	label_offset_mm	0.765	-1.0	1.0	t
1387	340	2026-05-04 19:39:11.714986+00	viscosity_cp	1187.62835064504	800	1200	t
1388	341	2026-04-26 00:34:17.085425+00	label_offset_mm	0.525	-1.0	1.0	t
1389	341	2026-04-25 23:11:23.579526+00	label_offset_mm	-0.592	-1.0	1.0	t
1390	342	2026-05-09 08:33:54.653263+00	viscosity_cp	906.07463302669	800	1200	t
1391	342	2026-05-09 07:16:36.560636+00	net_weight_g	251.294218256081	248	252	t
1392	342	2026-05-09 08:46:19.299497+00	net_weight_g	248.099499257835	248	252	t
1393	342	2026-05-09 08:03:48.435352+00	viscosity_cp	1161.99546432213	800	1200	t
1394	342	2026-05-09 06:40:10.791451+00	fill_volume_ml	500.006498042126	495	505	t
1395	342	2026-05-09 06:07:26.164891+00	fill_volume_ml	496.513080439232	495	505	t
1396	343	2026-05-12 14:32:20.015835+00	viscosity_cp	918.875346571497	800	1200	t
1397	343	2026-05-12 14:01:16.320792+00	fill_volume_ml	498.091556023898	495	505	t
1398	343	2026-05-12 14:01:02.899071+00	fill_volume_ml	501.983618015811	495	505	t
1399	343	2026-05-12 14:51:24.437586+00	cap_torque_nm	1.56378432165203	1.2	1.8	t
1400	343	2026-05-12 15:24:19.724205+00	viscosity_cp	790.397698038443	800	1200	f
1401	344	2026-04-02 23:33:39.204601+00	cap_torque_nm	1.511489911906	1.2	1.8	t
1402	344	2026-04-03 01:22:02.572205+00	viscosity_cp	1204.54335593992	800	1200	f
1403	344	2026-04-03 02:58:43.797468+00	fill_volume_ml	498.146572463519	495	505	t
1404	344	2026-04-03 00:17:29.932475+00	viscosity_cp	1214.98607621675	800	1200	f
1405	344	2026-04-02 22:32:38.421252+00	fill_volume_ml	498.793174190878	495	505	t
1406	344	2026-04-03 03:08:13.24069+00	viscosity_cp	983.472347622643	800	1200	t
1407	345	2026-05-01 07:04:36.788934+00	viscosity_cp	1170.04606395555	800	1200	t
1408	345	2026-05-01 10:26:42.598844+00	viscosity_cp	1080.29421646744	800	1200	t
1409	345	2026-05-01 10:23:36.958987+00	cap_torque_nm	1.72340839556987	1.2	1.8	t
1410	345	2026-05-01 07:48:35.968851+00	net_weight_g	250.887683911881	248	252	t
1411	346	2026-03-26 14:55:41.917677+00	label_offset_mm	0.292	-1.0	1.0	t
1412	346	2026-03-26 16:39:47.732852+00	label_offset_mm	0.132	-1.0	1.0	t
1413	347	2026-05-14 00:44:04.864411+00	fill_volume_ml	501.258076388768	495	505	t
1414	347	2026-05-13 23:13:34.101811+00	fill_volume_ml	499.963818385769	495	505	t
1415	347	2026-05-14 02:30:46.023763+00	fill_volume_ml	498.962994883605	495	505	t
1416	347	2026-05-13 22:45:16.821793+00	net_weight_g	251.516926792734	248	252	t
1417	347	2026-05-14 01:44:50.731313+00	cap_torque_nm	1.4651486886024	1.2	1.8	t
1418	347	2026-05-14 01:23:03.045901+00	net_weight_g	248.166842591323	248	252	t
1419	348	2026-04-19 08:42:53.906029+00	net_weight_g	251.337695056119	248	252	t
1420	348	2026-04-19 07:28:04.118218+00	net_weight_g	251.81461099362	248	252	t
1421	348	2026-04-19 09:12:15.752505+00	label_offset_mm	-0.601	-1.0	1.0	t
1422	349	2026-03-30 19:10:29.71477+00	viscosity_cp	935.479217726131	800	1200	t
1423	349	2026-03-30 19:30:41.617929+00	cap_torque_nm	1.73490641224644	1.2	1.8	t
1424	349	2026-03-30 18:01:51.00006+00	fill_volume_ml	500.896946630151	495	505	t
1425	350	2026-04-09 23:29:49.348837+00	fill_volume_ml	503.51335935201	495	505	t
1426	350	2026-04-10 03:01:12.928547+00	net_weight_g	249.748639473925	248	252	t
1427	350	2026-04-10 00:42:11.70548+00	fill_volume_ml	501.344925286257	495	505	t
1428	350	2026-04-10 03:38:03.457733+00	viscosity_cp	931.411236151491	800	1200	t
1429	350	2026-04-10 02:22:57.908926+00	viscosity_cp	973.932957808287	800	1200	t
1430	350	2026-04-10 01:19:03.595236+00	viscosity_cp	1033.04983873381	800	1200	t
1431	351	2026-03-25 06:46:14.963285+00	label_offset_mm	1.174	-1.0	1.0	f
1432	351	2026-03-25 09:42:50.092495+00	net_weight_g	248.648215677862	248	252	t
1433	351	2026-03-25 10:47:55.920045+00	net_weight_g	250.368107255227	248	252	t
1434	352	2026-03-20 17:44:46.147564+00	viscosity_cp	871.57881489889	800	1200	t
1435	352	2026-03-20 16:59:46.788505+00	fill_volume_ml	497.374437927705	495	505	t
1436	353	2026-03-30 22:38:44.249076+00	fill_volume_ml	498.765467778479	495	505	t
1437	353	2026-03-30 22:38:14.655724+00	label_offset_mm	-0.792	-1.0	1.0	t
1438	353	2026-03-30 23:44:37.257298+00	viscosity_cp	1206.27989701465	800	1200	f
1439	353	2026-03-30 22:46:29.744911+00	net_weight_g	249.140385332887	248	252	t
1440	354	2026-04-16 07:22:51.809383+00	label_offset_mm	-1.084	-1.0	1.0	f
1441	354	2026-04-16 08:54:29.583611+00	label_offset_mm	-0.537	-1.0	1.0	t
1442	354	2026-04-16 07:27:06.037775+00	cap_torque_nm	1.64786459237354	1.2	1.8	t
1443	354	2026-04-16 06:28:32.191925+00	net_weight_g	249.576153824098	248	252	t
1444	354	2026-04-16 09:54:03.7018+00	fill_volume_ml	500.603366863235	495	505	t
1445	355	2026-04-18 15:06:59.075645+00	cap_torque_nm	1.70218627893484	1.2	1.8	t
1446	355	2026-04-18 19:45:45.154379+00	label_offset_mm	0.260	-1.0	1.0	t
1447	355	2026-04-18 16:56:22.835807+00	viscosity_cp	796.06177400413	800	1200	f
1448	356	2026-04-29 23:37:07.942305+00	label_offset_mm	-0.098	-1.0	1.0	t
1449	356	2026-04-29 23:51:34.85603+00	label_offset_mm	0.413	-1.0	1.0	t
1450	356	2026-04-29 23:27:50.921348+00	net_weight_g	251.880996102635	248	252	t
1451	356	2026-04-29 23:39:48.931545+00	fill_volume_ml	502.764270167008	495	505	t
1452	356	2026-04-29 22:33:14.340628+00	label_offset_mm	0.495	-1.0	1.0	t
1453	357	2026-04-29 08:32:29.420708+00	label_offset_mm	-0.481	-1.0	1.0	t
1454	357	2026-04-29 06:34:07.115323+00	label_offset_mm	-0.806	-1.0	1.0	t
1455	357	2026-04-29 07:50:43.394146+00	cap_torque_nm	1.54189810446144	1.2	1.8	t
1456	357	2026-04-29 06:49:30.405228+00	cap_torque_nm	1.405657077156	1.2	1.8	t
1457	358	2026-04-04 14:41:46.914435+00	fill_volume_ml	496.499419845943	495	505	t
1458	358	2026-04-04 14:45:33.268052+00	net_weight_g	251.031903077008	248	252	t
1459	358	2026-04-04 16:51:45.825113+00	fill_volume_ml	500.86658671761	495	505	t
1460	359	2026-05-05 02:41:50.01846+00	net_weight_g	250.893320347317	248	252	t
1461	359	2026-05-05 02:59:27.196983+00	label_offset_mm	0.160	-1.0	1.0	t
1462	359	2026-05-04 23:08:12.163104+00	label_offset_mm	-0.484	-1.0	1.0	t
1463	360	2026-04-04 06:15:37.789985+00	viscosity_cp	762.579250880268	800	1200	f
1464	360	2026-04-04 07:34:10.752931+00	fill_volume_ml	496.190541351779	495	505	t
1465	360	2026-04-04 06:17:01.464595+00	net_weight_g	249.389280836828	248	252	t
1466	361	2026-04-23 15:26:21.287632+00	viscosity_cp	1022.5166898545	800	1200	t
1467	361	2026-04-23 18:04:10.024373+00	fill_volume_ml	497.400421677445	495	505	t
1468	361	2026-04-23 17:53:12.480297+00	net_weight_g	249.143000775968	248	252	t
1469	361	2026-04-23 17:21:17.062964+00	cap_torque_nm	1.55103955063389	1.2	1.8	t
1470	361	2026-04-23 16:31:44.557847+00	fill_volume_ml	497.237963904359	495	505	t
1471	362	2026-05-15 23:28:35.252524+00	label_offset_mm	0.397	-1.0	1.0	t
1472	362	2026-05-15 23:00:40.821193+00	viscosity_cp	874.057298977142	800	1200	t
1473	362	2026-05-15 23:24:15.803959+00	label_offset_mm	-0.804	-1.0	1.0	t
1474	362	2026-05-15 23:14:53.62205+00	label_offset_mm	0.028	-1.0	1.0	t
1475	363	2026-03-18 09:01:16.858855+00	fill_volume_ml	502.231658027262	495	505	t
1476	363	2026-03-18 07:23:17.214913+00	label_offset_mm	0.009	-1.0	1.0	t
1477	363	2026-03-18 11:47:06.411605+00	fill_volume_ml	501.439458468435	495	505	t
1478	363	2026-03-18 09:19:10.873271+00	net_weight_g	248.447248269022	248	252	t
1479	363	2026-03-18 06:04:38.446825+00	net_weight_g	251.515666015624	248	252	t
1480	363	2026-03-18 11:43:59.841647+00	cap_torque_nm	1.33649768713296	1.2	1.8	t
1481	364	2026-03-22 15:22:35.674849+00	cap_torque_nm	1.44932985844742	1.2	1.8	t
1482	364	2026-03-22 16:30:43.315173+00	fill_volume_ml	501.049572931009	495	505	t
1483	364	2026-03-22 16:20:01.301328+00	viscosity_cp	1204.44423515618	800	1200	f
1484	365	2026-05-11 23:57:50.537153+00	viscosity_cp	1116.93523675667	800	1200	t
1485	365	2026-05-11 22:35:11.741924+00	viscosity_cp	1139.8045915859	800	1200	t
1486	365	2026-05-12 01:35:43.569923+00	fill_volume_ml	501.884327688207	495	505	t
1487	365	2026-05-12 01:56:14.391638+00	viscosity_cp	1034.63144308466	800	1200	t
1488	366	2026-03-26 06:34:18.527549+00	viscosity_cp	877.451971898976	800	1200	t
1489	366	2026-03-26 06:52:46.350792+00	viscosity_cp	1061.92823001911	800	1200	t
1490	367	2026-04-13 14:49:14.485953+00	net_weight_g	251.939340510505	248	252	t
1491	367	2026-04-13 20:24:47.432428+00	net_weight_g	250.08311839291	248	252	t
1492	367	2026-04-13 20:04:49.39011+00	net_weight_g	251.043858356945	248	252	t
1493	367	2026-04-13 21:07:46.694392+00	label_offset_mm	0.818	-1.0	1.0	t
1494	367	2026-04-13 15:07:28.250259+00	net_weight_g	251.120178893191	248	252	t
1495	368	2026-03-23 23:06:55.277965+00	net_weight_g	250.706101084462	248	252	t
1496	368	2026-03-23 23:02:54.127261+00	cap_torque_nm	1.69241090750952	1.2	1.8	t
1497	368	2026-03-23 23:35:41.368877+00	fill_volume_ml	498.655834080767	495	505	t
1498	369	2026-04-15 08:11:09.544381+00	viscosity_cp	842.994519834084	800	1200	t
1499	369	2026-04-15 06:43:03.416413+00	label_offset_mm	0.209	-1.0	1.0	t
1500	369	2026-04-15 07:48:27.675808+00	cap_torque_nm	1.65947269748255	1.2	1.8	t
1501	369	2026-04-15 08:00:31.108936+00	cap_torque_nm	1.32700673784404	1.2	1.8	t
1502	369	2026-04-15 06:03:11.11172+00	net_weight_g	248.996959273896	248	252	t
1503	370	2026-03-24 18:43:21.11913+00	cap_torque_nm	1.51692053576721	1.2	1.8	t
1504	370	2026-03-24 18:13:05.485413+00	net_weight_g	250.181001547308	248	252	t
1505	370	2026-03-24 14:28:15.98905+00	fill_volume_ml	503.884778502992	495	505	t
1506	370	2026-03-24 19:48:15.117637+00	viscosity_cp	887.790806152606	800	1200	t
1507	371	2026-03-28 22:44:11.999214+00	fill_volume_ml	499.696365996125	495	505	t
1508	371	2026-03-29 00:34:46.770785+00	net_weight_g	251.986889900327	248	252	t
1509	371	2026-03-28 22:42:05.029984+00	net_weight_g	248.95649903132	248	252	t
1510	371	2026-03-29 01:25:04.468884+00	fill_volume_ml	502.028750956959	495	505	t
1511	371	2026-03-29 00:33:55.36341+00	fill_volume_ml	497.263959732303	495	505	t
1512	372	2026-04-08 08:13:37.30617+00	label_offset_mm	0.438	-1.0	1.0	t
1513	372	2026-04-08 06:31:34.281407+00	viscosity_cp	905.356479773245	800	1200	t
1514	372	2026-04-08 09:02:02.34305+00	viscosity_cp	1216.32725798106	800	1200	f
1515	372	2026-04-08 06:23:09.535053+00	cap_torque_nm	1.60542421271763	1.2	1.8	t
1516	372	2026-04-08 08:37:43.76405+00	label_offset_mm	0.302	-1.0	1.0	t
1517	373	2026-04-29 16:48:35.183894+00	label_offset_mm	-0.372	-1.0	1.0	t
1518	373	2026-04-29 18:00:01.377278+00	label_offset_mm	-0.410	-1.0	1.0	t
1519	373	2026-04-29 14:46:54.186838+00	label_offset_mm	1.081	-1.0	1.0	f
1520	373	2026-04-29 16:18:08.715176+00	viscosity_cp	1204.43173593963	800	1200	f
1521	373	2026-04-29 16:11:37.610672+00	fill_volume_ml	503.88682210492	495	505	t
1522	374	2026-04-03 23:02:05.50401+00	label_offset_mm	0.025	-1.0	1.0	t
1523	374	2026-04-04 00:31:52.951107+00	fill_volume_ml	497.706044457058	495	505	t
1524	374	2026-04-03 23:37:49.711407+00	label_offset_mm	-0.155	-1.0	1.0	t
1525	374	2026-04-04 00:28:31.634714+00	viscosity_cp	1050.04487612412	800	1200	t
1526	374	2026-04-03 23:16:54.939912+00	label_offset_mm	-0.172	-1.0	1.0	t
1527	375	2026-05-03 08:11:33.797182+00	viscosity_cp	913.683890108032	800	1200	t
1528	375	2026-05-03 09:50:21.68409+00	cap_torque_nm	1.53812596424778	1.2	1.8	t
1529	375	2026-05-03 09:29:54.553543+00	fill_volume_ml	498.273932263725	495	505	t
1530	376	2026-05-04 14:34:03.865957+00	fill_volume_ml	498.710285190011	495	505	t
1531	376	2026-05-04 15:14:01.590306+00	cap_torque_nm	1.74151436375234	1.2	1.8	t
1532	377	2026-05-07 03:08:31.576421+00	label_offset_mm	0.801	-1.0	1.0	t
1533	377	2026-05-06 23:29:50.616584+00	fill_volume_ml	497.31670908182	495	505	t
1534	378	2026-03-21 09:30:55.466765+00	net_weight_g	251.511958562166	248	252	t
1535	378	2026-03-21 08:01:34.008471+00	label_offset_mm	-1.156	-1.0	1.0	f
1536	378	2026-03-21 07:48:08.730418+00	cap_torque_nm	1.68057011600963	1.2	1.8	t
1537	378	2026-03-21 09:33:03.283466+00	fill_volume_ml	500.848825928035	495	505	t
1538	378	2026-03-21 09:28:46.353865+00	viscosity_cp	828.169188952269	800	1200	t
1539	379	2026-03-19 14:29:38.551267+00	net_weight_g	250.993221860937	248	252	t
1540	379	2026-03-19 16:34:02.53613+00	viscosity_cp	989.809384350684	800	1200	t
1541	379	2026-03-19 14:46:49.178296+00	net_weight_g	248.324056170711	248	252	t
1542	380	2026-03-22 22:12:48.069237+00	net_weight_g	251.371381907973	248	252	t
1543	380	2026-03-23 02:50:50.092388+00	viscosity_cp	1096.45389809797	800	1200	t
1544	380	2026-03-23 00:15:52.237116+00	net_weight_g	251.898713763019	248	252	t
1545	381	2026-04-10 10:39:47.912261+00	viscosity_cp	813.572214547334	800	1200	t
1546	381	2026-04-10 08:29:21.970102+00	label_offset_mm	0.798	-1.0	1.0	t
1547	381	2026-04-10 13:10:51.440089+00	cap_torque_nm	1.52078911576316	1.2	1.8	t
1548	382	2026-05-08 16:55:13.838688+00	net_weight_g	249.997395862644	248	252	t
1549	382	2026-05-08 20:01:32.405406+00	net_weight_g	249.437903537696	248	252	t
1550	382	2026-05-08 19:28:08.769054+00	label_offset_mm	0.173	-1.0	1.0	t
1551	382	2026-05-08 15:01:54.229078+00	fill_volume_ml	499.092948548429	495	505	t
1552	382	2026-05-08 15:53:21.399977+00	label_offset_mm	0.746	-1.0	1.0	t
1553	382	2026-05-08 18:06:23.685208+00	label_offset_mm	-1.161	-1.0	1.0	f
1554	383	2026-04-19 23:48:19.717977+00	fill_volume_ml	502.100463762526	495	505	t
1555	383	2026-04-19 22:55:19.895834+00	viscosity_cp	877.189425030912	800	1200	t
1556	384	2026-05-16 08:52:07.958452+00	viscosity_cp	844.602365155035	800	1200	t
1557	384	2026-05-16 10:38:50.125961+00	label_offset_mm	-0.381	-1.0	1.0	t
1558	384	2026-05-16 08:46:48.122169+00	cap_torque_nm	1.51507416715684	1.2	1.8	t
1559	384	2026-05-16 09:25:10.702507+00	net_weight_g	251.823800688156	248	252	t
1560	385	2026-03-17 16:48:34.323188+00	cap_torque_nm	1.53974890923741	1.2	1.8	t
1561	385	2026-03-17 14:56:57.679464+00	fill_volume_ml	498.553647469568	495	505	t
1562	385	2026-03-17 14:36:37.916974+00	cap_torque_nm	1.57821508543423	1.2	1.8	t
1563	386	2026-04-28 23:36:18.728078+00	viscosity_cp	1137.25358957739	800	1200	t
1564	386	2026-04-28 22:39:19.949603+00	viscosity_cp	993.39255268017	800	1200	t
1565	387	2026-04-16 11:30:42.844486+00	fill_volume_ml	502.919202435802	495	505	t
1566	387	2026-04-16 08:43:39.962386+00	viscosity_cp	863.637944509153	800	1200	t
1567	387	2026-04-16 11:27:49.705258+00	label_offset_mm	-0.918	-1.0	1.0	t
1568	387	2026-04-16 06:43:52.059088+00	net_weight_g	249.222280398389	248	252	t
1569	388	2026-04-10 14:19:00.047227+00	viscosity_cp	1127.6662935021	800	1200	t
1570	388	2026-04-10 19:14:40.343483+00	cap_torque_nm	1.39101954399078	1.2	1.8	t
1571	388	2026-04-10 17:26:57.059999+00	label_offset_mm	0.912	-1.0	1.0	t
1572	389	2026-03-22 22:55:22.949286+00	cap_torque_nm	1.34421799985838	1.2	1.8	t
1573	389	2026-03-22 22:22:33.065727+00	fill_volume_ml	496.279847200913	495	505	t
1574	389	2026-03-22 23:47:07.968299+00	viscosity_cp	1042.93906189326	800	1200	t
1575	389	2026-03-22 23:20:38.324092+00	cap_torque_nm	1.60286766702855	1.2	1.8	t
1576	390	2026-05-04 07:47:19.865275+00	net_weight_g	248.711744107282	248	252	t
1577	390	2026-05-04 11:06:11.734438+00	label_offset_mm	-0.831	-1.0	1.0	t
1578	390	2026-05-04 12:00:42.703068+00	cap_torque_nm	1.47307910260107	1.2	1.8	t
1579	390	2026-05-04 12:11:33.257727+00	cap_torque_nm	1.53374024014073	1.2	1.8	t
1580	391	2026-04-30 17:54:34.434753+00	net_weight_g	249.040075688209	248	252	t
1581	391	2026-04-30 15:58:28.339699+00	fill_volume_ml	497.519610086599	495	505	t
1582	391	2026-04-30 20:00:38.748761+00	fill_volume_ml	497.166663884459	495	505	t
1583	391	2026-04-30 16:47:58.757656+00	label_offset_mm	-1.148	-1.0	1.0	f
1584	391	2026-04-30 19:12:00.808474+00	viscosity_cp	1107.90603038979	800	1200	t
1585	392	2026-05-03 23:20:45.176718+00	fill_volume_ml	498.410379564483	495	505	t
1586	392	2026-05-03 23:17:53.979109+00	net_weight_g	251.063525400125	248	252	t
1587	392	2026-05-03 23:06:37.643696+00	label_offset_mm	0.933	-1.0	1.0	t
1588	393	2026-04-05 07:27:59.20477+00	viscosity_cp	985.74789316987	800	1200	t
1589	393	2026-04-05 06:32:19.263107+00	cap_torque_nm	1.49449547946815	1.2	1.8	t
1590	393	2026-04-05 06:55:25.961471+00	viscosity_cp	1047.71659424681	800	1200	t
1591	394	2026-04-29 19:29:47.822706+00	net_weight_g	248.544247727413	248	252	t
1592	394	2026-04-29 15:18:54.169724+00	label_offset_mm	-0.492	-1.0	1.0	t
1593	394	2026-04-29 19:20:04.557238+00	viscosity_cp	1012.10467597214	800	1200	t
1594	394	2026-04-29 15:53:25.777346+00	net_weight_g	251.777347702957	248	252	t
1595	394	2026-04-29 15:44:32.55152+00	net_weight_g	251.915330107153	248	252	t
1596	394	2026-04-29 15:47:10.062698+00	viscosity_cp	1187.11494760902	800	1200	t
1597	395	2026-04-22 23:50:39.587469+00	fill_volume_ml	499.424199982354	495	505	t
1598	395	2026-04-22 22:27:17.546428+00	fill_volume_ml	499.188700708397	495	505	t
1599	395	2026-04-23 00:29:43.902211+00	net_weight_g	251.517185731863	248	252	t
1600	395	2026-04-22 23:40:23.185447+00	net_weight_g	251.685969361131	248	252	t
1601	396	2026-03-29 07:27:39.128747+00	viscosity_cp	1077.07777978187	800	1200	t
1602	396	2026-03-29 08:34:27.310612+00	cap_torque_nm	1.61266278742254	1.2	1.8	t
1603	397	2026-03-19 15:46:45.39796+00	fill_volume_ml	503.641101070554	495	505	t
1604	397	2026-03-19 14:16:18.32019+00	cap_torque_nm	1.43198584615867	1.2	1.8	t
1605	397	2026-03-19 17:36:10.766109+00	viscosity_cp	999.458403498982	800	1200	t
1606	397	2026-03-19 16:36:54.397037+00	fill_volume_ml	502.188312345943	495	505	t
1607	397	2026-03-19 14:29:12.820829+00	viscosity_cp	934.978806972882	800	1200	t
1608	398	2026-04-29 04:02:15.764093+00	viscosity_cp	928.394750465413	800	1200	t
1609	398	2026-04-28 23:13:53.21548+00	net_weight_g	248.380553552816	248	252	t
1610	398	2026-04-29 04:19:24.554912+00	fill_volume_ml	498.794957003297	495	505	t
1611	398	2026-04-28 23:03:55.662796+00	label_offset_mm	1.078	-1.0	1.0	f
1612	399	2026-03-31 10:01:18.747788+00	cap_torque_nm	1.33457364259503	1.2	1.8	t
1613	399	2026-03-31 08:15:12.431509+00	label_offset_mm	0.284	-1.0	1.0	t
1614	399	2026-03-31 09:03:03.66646+00	cap_torque_nm	1.71155043331565	1.2	1.8	t
1615	399	2026-03-31 12:28:38.231951+00	cap_torque_nm	1.40968234375288	1.2	1.8	t
1616	400	2026-03-28 16:19:23.550466+00	label_offset_mm	-1.017	-1.0	1.0	f
1617	400	2026-03-28 17:19:46.580936+00	cap_torque_nm	1.30252433549907	1.2	1.8	t
1618	400	2026-03-28 17:09:03.670771+00	label_offset_mm	0.995	-1.0	1.0	t
1619	401	2026-03-27 22:04:45.429397+00	net_weight_g	249.346322961758	248	252	t
1620	401	2026-03-28 00:32:12.549614+00	label_offset_mm	0.368	-1.0	1.0	t
1621	401	2026-03-27 23:15:22.060633+00	net_weight_g	248.359519278063	248	252	t
1622	401	2026-03-27 22:51:08.044954+00	label_offset_mm	-0.991	-1.0	1.0	t
1623	402	2026-04-23 07:42:50.700154+00	net_weight_g	249.324634256706	248	252	t
1624	402	2026-04-23 07:42:49.837771+00	fill_volume_ml	503.672988223978	495	505	t
1625	402	2026-04-23 07:21:34.735471+00	fill_volume_ml	500.003087779202	495	505	t
1626	402	2026-04-23 09:47:32.772188+00	label_offset_mm	-0.656	-1.0	1.0	t
1627	402	2026-04-23 10:38:55.208214+00	cap_torque_nm	1.6710223843232	1.2	1.8	t
1628	402	2026-04-23 11:41:07.030023+00	cap_torque_nm	1.57324156387781	1.2	1.8	t
1629	403	2026-03-23 15:24:12.007626+00	cap_torque_nm	1.66227580467896	1.2	1.8	t
1630	403	2026-03-23 16:00:56.94031+00	viscosity_cp	801.041806736966	800	1200	t
1631	403	2026-03-23 18:17:18.348734+00	viscosity_cp	873.270367485086	800	1200	t
1632	403	2026-03-23 16:12:45.990702+00	net_weight_g	248.112238763556	248	252	t
1633	403	2026-03-23 16:45:35.912299+00	fill_volume_ml	497.431018132296	495	505	t
1634	403	2026-03-23 16:15:36.956103+00	fill_volume_ml	496.711177142894	495	505	t
1635	404	2026-04-26 23:53:37.397876+00	net_weight_g	250.420371734114	248	252	t
1636	404	2026-04-26 22:56:35.835809+00	fill_volume_ml	500.591263607561	495	505	t
1637	404	2026-04-26 22:36:25.60452+00	net_weight_g	249.767285915042	248	252	t
1638	404	2026-04-26 22:48:29.148642+00	cap_torque_nm	1.45388378376311	1.2	1.8	t
1639	405	2026-04-22 06:44:58.192876+00	viscosity_cp	924.652441568786	800	1200	t
1640	405	2026-04-22 06:30:57.142088+00	cap_torque_nm	1.46043827026551	1.2	1.8	t
1641	405	2026-04-22 07:54:50.445239+00	viscosity_cp	1025.81805304951	800	1200	t
1642	405	2026-04-22 07:52:34.223445+00	viscosity_cp	1042.80971610687	800	1200	t
1643	405	2026-04-22 08:06:21.618466+00	fill_volume_ml	500.158086221149	495	505	t
1644	405	2026-04-22 07:46:36.766626+00	label_offset_mm	-1.092	-1.0	1.0	f
1645	406	2026-04-08 17:00:21.128622+00	viscosity_cp	963.277988045344	800	1200	t
1646	406	2026-04-08 16:29:52.14824+00	fill_volume_ml	500.987055130595	495	505	t
1647	406	2026-04-08 15:50:09.962584+00	viscosity_cp	864.43201321103	800	1200	t
1648	406	2026-04-08 16:28:41.96078+00	cap_torque_nm	1.60658517347228	1.2	1.8	t
1649	406	2026-04-08 15:54:55.949221+00	fill_volume_ml	497.93431902458	495	505	t
1650	407	2026-04-19 23:18:55.40675+00	fill_volume_ml	496.153962277892	495	505	t
1651	407	2026-04-20 00:05:20.927268+00	fill_volume_ml	501.155160273145	495	505	t
1652	407	2026-04-20 00:06:42.631124+00	label_offset_mm	-0.688	-1.0	1.0	t
1653	408	2026-03-29 06:37:54.727772+00	net_weight_g	248.734205007953	248	252	t
1654	408	2026-03-29 06:33:16.131064+00	label_offset_mm	0.194	-1.0	1.0	t
1655	409	2026-04-30 17:16:36.764857+00	net_weight_g	250.975874422492	248	252	t
1656	409	2026-04-30 16:48:15.316803+00	cap_torque_nm	1.73627735169564	1.2	1.8	t
1657	409	2026-04-30 16:50:06.573551+00	net_weight_g	251.762559550829	248	252	t
1658	409	2026-04-30 15:00:27.89312+00	cap_torque_nm	1.50695445711922	1.2	1.8	t
1659	409	2026-04-30 16:34:52.368855+00	net_weight_g	248.451714944155	248	252	t
1660	410	2026-04-11 00:04:55.419859+00	viscosity_cp	853.536608228958	800	1200	t
1661	410	2026-04-10 23:41:59.317588+00	label_offset_mm	0.763	-1.0	1.0	t
1662	410	2026-04-10 23:28:50.513146+00	fill_volume_ml	500.582065367854	495	505	t
1663	410	2026-04-11 00:14:29.377333+00	fill_volume_ml	500.842090079968	495	505	t
1664	411	2026-04-24 08:00:18.933527+00	label_offset_mm	-1.061	-1.0	1.0	f
1665	411	2026-04-24 07:00:39.897612+00	cap_torque_nm	1.49680745263186	1.2	1.8	t
1666	411	2026-04-24 08:25:44.023417+00	net_weight_g	249.078103605543	248	252	t
1667	411	2026-04-24 07:05:04.361246+00	net_weight_g	250.332978076936	248	252	t
1668	412	2026-04-06 18:55:11.30561+00	viscosity_cp	795.545256538882	800	1200	f
1669	412	2026-04-06 15:40:55.522799+00	net_weight_g	248.715442296472	248	252	t
1670	412	2026-04-06 14:38:07.551433+00	fill_volume_ml	501.13384088945	495	505	t
1671	412	2026-04-06 17:22:54.659475+00	cap_torque_nm	1.26832987931131	1.2	1.8	t
1672	412	2026-04-06 20:11:07.032485+00	viscosity_cp	1088.79409506307	800	1200	t
1673	413	2026-03-25 22:47:08.140247+00	net_weight_g	248.698048028849	248	252	t
1674	413	2026-03-25 23:10:14.71857+00	fill_volume_ml	502.847611253232	495	505	t
1675	413	2026-03-25 22:38:03.283431+00	label_offset_mm	-0.483	-1.0	1.0	t
1676	413	2026-03-25 23:08:40.678905+00	fill_volume_ml	497.043435861226	495	505	t
1677	414	2026-04-19 06:29:07.577908+00	label_offset_mm	-0.973	-1.0	1.0	t
1678	414	2026-04-19 06:16:13.612322+00	label_offset_mm	-0.935	-1.0	1.0	t
1679	414	2026-04-19 06:46:06.365973+00	cap_torque_nm	1.36621238004857	1.2	1.8	t
1680	414	2026-04-19 06:38:31.317335+00	cap_torque_nm	1.32468715423159	1.2	1.8	t
1681	414	2026-04-19 06:46:18.052285+00	viscosity_cp	885.124806241079	800	1200	t
1682	414	2026-04-19 06:31:49.302788+00	label_offset_mm	-0.988	-1.0	1.0	t
1683	415	2026-04-08 19:34:27.4166+00	net_weight_g	251.300738917727	248	252	t
1684	415	2026-04-08 20:30:21.564718+00	fill_volume_ml	496.709095289272	495	505	t
1685	415	2026-04-08 18:37:36.907623+00	fill_volume_ml	498.3213799518	495	505	t
1686	416	2026-03-28 23:35:43.908166+00	viscosity_cp	767.6083681828	800	1200	f
1687	416	2026-03-29 00:08:31.259437+00	label_offset_mm	0.348	-1.0	1.0	t
1688	416	2026-03-29 01:33:48.809564+00	label_offset_mm	1.173	-1.0	1.0	f
1689	416	2026-03-29 02:34:45.312054+00	cap_torque_nm	1.6951838774798	1.2	1.8	t
1690	416	2026-03-29 02:13:56.108447+00	fill_volume_ml	499.930846724512	495	505	t
1691	416	2026-03-29 02:49:51.922484+00	label_offset_mm	-0.450	-1.0	1.0	t
1692	417	2026-04-28 09:17:05.402713+00	viscosity_cp	1108.71740694292	800	1200	t
1693	417	2026-04-28 08:24:06.738665+00	viscosity_cp	1088.46637075393	800	1200	t
1694	417	2026-04-28 06:32:57.567769+00	fill_volume_ml	501.203900190329	495	505	t
1695	417	2026-04-28 07:22:58.260429+00	cap_torque_nm	1.31750413911987	1.2	1.8	t
1696	418	2026-03-19 14:40:28.92801+00	net_weight_g	249.114462769901	248	252	t
1697	418	2026-03-19 16:53:45.212561+00	net_weight_g	249.159852352255	248	252	t
1698	418	2026-03-19 15:42:30.45963+00	fill_volume_ml	498.892713319983	495	505	t
1699	419	2026-04-27 23:01:10.401885+00	cap_torque_nm	1.66338149322555	1.2	1.8	t
1700	419	2026-04-27 23:47:28.585062+00	cap_torque_nm	1.41234341585581	1.2	1.8	t
1701	419	2026-04-27 22:41:41.208729+00	label_offset_mm	-0.747	-1.0	1.0	t
1702	419	2026-04-27 23:42:58.965822+00	viscosity_cp	810.543680657907	800	1200	t
1703	419	2026-04-27 23:46:47.096995+00	viscosity_cp	1058.79828379641	800	1200	t
1704	419	2026-04-27 22:31:40.078739+00	net_weight_g	248.547525043721	248	252	t
1705	420	2026-04-09 10:45:57.787178+00	cap_torque_nm	1.45436202427505	1.2	1.8	t
1706	420	2026-04-09 11:51:24.514738+00	net_weight_g	249.002115663484	248	252	t
1707	420	2026-04-09 08:35:46.545093+00	fill_volume_ml	501.318869700324	495	505	t
1708	420	2026-04-09 11:03:32.491235+00	fill_volume_ml	498.662217172816	495	505	t
1709	420	2026-04-09 12:59:04.951703+00	viscosity_cp	1178.98630743729	800	1200	t
1710	420	2026-04-09 07:55:07.678197+00	viscosity_cp	1114.74567993232	800	1200	t
1711	421	2026-05-02 16:21:49.247196+00	cap_torque_nm	1.65389835168437	1.2	1.8	t
1712	421	2026-05-02 15:28:03.521132+00	fill_volume_ml	501.396060217041	495	505	t
1713	421	2026-05-02 18:40:12.66889+00	label_offset_mm	-0.405	-1.0	1.0	t
1714	421	2026-05-02 15:40:00.863305+00	viscosity_cp	827.448163816437	800	1200	t
1715	421	2026-05-02 17:34:47.496693+00	label_offset_mm	-0.387	-1.0	1.0	t
1716	422	2026-05-02 00:50:28.458074+00	net_weight_g	251.368935626988	248	252	t
1717	422	2026-05-02 00:20:45.794199+00	label_offset_mm	0.593	-1.0	1.0	t
1718	422	2026-05-02 02:26:18.591008+00	net_weight_g	250.649766053872	248	252	t
1719	423	2026-04-20 12:05:34.922406+00	cap_torque_nm	1.47367856131717	1.2	1.8	t
1720	423	2026-04-20 10:22:06.135926+00	net_weight_g	250.028619729624	248	252	t
1721	423	2026-04-20 11:20:22.242235+00	viscosity_cp	774.613102925102	800	1200	f
1722	423	2026-04-20 10:29:15.374764+00	net_weight_g	250.681467408716	248	252	t
1723	424	2026-03-20 16:33:36.609142+00	viscosity_cp	840.784476079535	800	1200	t
1724	424	2026-03-20 14:48:35.675828+00	viscosity_cp	788.236696266499	800	1200	f
1725	424	2026-03-20 15:34:02.82237+00	cap_torque_nm	1.72390684023273	1.2	1.8	t
1726	424	2026-03-20 14:31:10.340072+00	cap_torque_nm	1.70742223788494	1.2	1.8	t
1727	425	2026-04-16 23:44:18.185661+00	fill_volume_ml	503.715929146573	495	505	t
1728	425	2026-04-17 02:50:30.444147+00	label_offset_mm	-0.278	-1.0	1.0	t
1729	426	2026-04-20 08:31:23.28718+00	net_weight_g	250.607724091685	248	252	t
1730	426	2026-04-20 06:46:25.453512+00	viscosity_cp	1102.53868705016	800	1200	t
1731	427	2026-04-14 15:06:32.239967+00	fill_volume_ml	503.51019499636	495	505	t
1732	427	2026-04-14 15:01:56.828179+00	fill_volume_ml	500.798822020223	495	505	t
1733	427	2026-04-14 15:32:21.669101+00	fill_volume_ml	498.432969626249	495	505	t
1734	428	2026-03-30 01:05:23.689726+00	cap_torque_nm	1.43361494169577	1.2	1.8	t
1735	428	2026-03-30 00:53:11.671651+00	net_weight_g	249.009109591004	248	252	t
1736	428	2026-03-29 23:36:36.131579+00	fill_volume_ml	502.614590279436	495	505	t
1737	428	2026-03-30 00:38:23.704998+00	viscosity_cp	1064.22690378516	800	1200	t
1738	429	2026-05-13 11:28:09.500024+00	net_weight_g	251.983159654353	248	252	t
1739	429	2026-05-13 09:43:04.711451+00	label_offset_mm	-0.834	-1.0	1.0	t
1740	429	2026-05-13 08:28:54.723108+00	fill_volume_ml	498.63294435539	495	505	t
1741	429	2026-05-13 10:15:33.422854+00	fill_volume_ml	498.804811240152	495	505	t
1742	429	2026-05-13 09:40:54.822069+00	net_weight_g	251.769611476006	248	252	t
1743	430	2026-04-30 15:06:58.522958+00	fill_volume_ml	499.569753118181	495	505	t
1744	430	2026-04-30 14:32:36.325263+00	net_weight_g	248.786538461944	248	252	t
1745	430	2026-04-30 14:38:21.905198+00	net_weight_g	251.467848181133	248	252	t
1746	430	2026-04-30 15:31:14.825703+00	fill_volume_ml	502.464849842502	495	505	t
1747	431	2026-05-06 23:03:10.24469+00	net_weight_g	248.051770448541	248	252	t
1748	431	2026-05-06 22:23:22.400481+00	net_weight_g	248.985894105645	248	252	t
1749	431	2026-05-06 23:20:55.642685+00	label_offset_mm	0.201	-1.0	1.0	t
1750	431	2026-05-07 01:10:00.348732+00	viscosity_cp	888.454395995529	800	1200	t
1751	432	2026-03-21 07:06:36.135117+00	viscosity_cp	845.890196886644	800	1200	t
1752	432	2026-03-21 06:31:51.948915+00	fill_volume_ml	503.422333682188	495	505	t
1753	433	2026-05-06 16:36:03.712957+00	label_offset_mm	0.568	-1.0	1.0	t
1754	433	2026-05-06 16:00:59.479464+00	fill_volume_ml	498.402566558375	495	505	t
1755	434	2026-04-21 03:13:43.340553+00	net_weight_g	251.349670232155	248	252	t
1756	434	2026-04-21 00:06:38.357652+00	viscosity_cp	1088.87642994851	800	1200	t
1757	434	2026-04-21 03:16:22.889101+00	fill_volume_ml	498.485443849458	495	505	t
1758	434	2026-04-21 03:41:21.336633+00	label_offset_mm	-0.076	-1.0	1.0	t
1759	435	2026-05-03 07:26:47.575498+00	label_offset_mm	0.785	-1.0	1.0	t
1760	435	2026-05-03 07:32:38.167112+00	viscosity_cp	1222.34229995072	800	1200	f
1761	435	2026-05-03 07:57:56.318762+00	net_weight_g	250.666220424808	248	252	t
1762	436	2026-04-05 14:44:04.010423+00	cap_torque_nm	1.26082727425342	1.2	1.8	t
1763	436	2026-04-05 18:53:22.296023+00	viscosity_cp	819.384064740557	800	1200	t
1764	436	2026-04-05 17:55:32.227449+00	viscosity_cp	1139.79464880766	800	1200	t
1765	437	2026-04-18 23:00:30.417644+00	viscosity_cp	997.494493516886	800	1200	t
1766	437	2026-04-18 23:53:43.579911+00	cap_torque_nm	1.6613236586044	1.2	1.8	t
1767	437	2026-04-19 00:48:08.508032+00	fill_volume_ml	501.617188680035	495	505	t
1768	437	2026-04-19 00:10:19.032058+00	fill_volume_ml	501.826404499599	495	505	t
1769	438	2026-04-18 07:14:35.02948+00	label_offset_mm	-0.097	-1.0	1.0	t
1770	438	2026-04-18 07:06:32.410797+00	fill_volume_ml	501.265997006758	495	505	t
1771	438	2026-04-18 07:23:37.164327+00	net_weight_g	249.677234624683	248	252	t
1772	438	2026-04-18 08:51:00.881894+00	net_weight_g	248.817436914416	248	252	t
1773	438	2026-04-18 09:39:09.737645+00	viscosity_cp	941.676119150531	800	1200	t
1774	438	2026-04-18 08:18:18.208246+00	viscosity_cp	1209.79335407788	800	1200	f
1775	439	2026-04-17 17:11:15.908986+00	viscosity_cp	1008.58982413119	800	1200	t
1776	439	2026-04-17 15:07:27.156161+00	fill_volume_ml	501.385098212865	495	505	t
1777	439	2026-04-17 20:15:16.237955+00	viscosity_cp	1221.95437350854	800	1200	f
1778	439	2026-04-17 15:01:02.742754+00	viscosity_cp	929.145620512735	800	1200	t
1779	439	2026-04-17 14:20:07.968344+00	viscosity_cp	835.514008108244	800	1200	t
1780	440	2026-05-15 22:41:47.063991+00	net_weight_g	250.470893886803	248	252	t
1781	440	2026-05-15 23:47:02.288297+00	net_weight_g	251.722038795543	248	252	t
1782	440	2026-05-15 23:42:55.353164+00	net_weight_g	251.545615030044	248	252	t
1783	440	2026-05-15 23:30:21.887166+00	fill_volume_ml	498.128204298156	495	505	t
1784	441	2026-04-14 09:02:57.401906+00	viscosity_cp	1189.00260998596	800	1200	t
1785	441	2026-04-14 08:09:30.362827+00	cap_torque_nm	1.3322023360011	1.2	1.8	t
1786	441	2026-04-14 06:55:41.78702+00	viscosity_cp	932.923748500577	800	1200	t
1787	442	2026-04-18 15:04:58.223578+00	fill_volume_ml	498.838659001307	495	505	t
1788	442	2026-04-18 14:55:00.922061+00	net_weight_g	249.514376291368	248	252	t
1789	442	2026-04-18 15:36:56.038183+00	net_weight_g	250.78306452544	248	252	t
1790	442	2026-04-18 14:30:50.376317+00	viscosity_cp	1004.39174301107	800	1200	t
1791	443	2026-04-08 00:33:17.298491+00	fill_volume_ml	502.131267647525	495	505	t
1792	443	2026-04-08 01:29:51.917725+00	viscosity_cp	792.584009014034	800	1200	f
1793	443	2026-04-08 03:09:44.315337+00	viscosity_cp	817.589260525473	800	1200	t
1794	443	2026-04-07 23:52:39.598631+00	label_offset_mm	0.204	-1.0	1.0	t
1795	444	2026-04-27 11:12:28.759362+00	cap_torque_nm	1.60366714948884	1.2	1.8	t
1796	444	2026-04-27 10:27:22.483299+00	fill_volume_ml	503.310613418814	495	505	t
1797	444	2026-04-27 09:29:51.962796+00	cap_torque_nm	1.3874861441432	1.2	1.8	t
1798	444	2026-04-27 07:02:20.115286+00	fill_volume_ml	499.763903127963	495	505	t
1799	445	2026-04-17 18:08:03.141027+00	fill_volume_ml	496.458806892644	495	505	t
1800	445	2026-04-17 15:14:27.138107+00	fill_volume_ml	500.422496557628	495	505	t
1801	445	2026-04-17 18:45:45.479521+00	cap_torque_nm	1.58512530158045	1.2	1.8	t
1802	446	2026-05-13 00:09:40.887693+00	viscosity_cp	920.033592847148	800	1200	t
1803	446	2026-05-13 01:22:38.364251+00	cap_torque_nm	1.31199274789667	1.2	1.8	t
1804	446	2026-05-12 22:41:48.830733+00	viscosity_cp	1133.99726989907	800	1200	t
1805	446	2026-05-12 22:12:21.844819+00	cap_torque_nm	1.47974956306128	1.2	1.8	t
1806	447	2026-05-13 08:33:42.241159+00	cap_torque_nm	1.60790253061296	1.2	1.8	t
1807	447	2026-05-13 07:28:33.654353+00	net_weight_g	251.662749290205	248	252	t
1808	447	2026-05-13 07:52:00.060805+00	net_weight_g	249.521430073246	248	252	t
1809	447	2026-05-13 09:16:16.701912+00	label_offset_mm	0.834	-1.0	1.0	t
1810	447	2026-05-13 07:27:20.109756+00	label_offset_mm	0.624	-1.0	1.0	t
1811	448	2026-04-03 15:49:23.2225+00	fill_volume_ml	502.90871078418	495	505	t
1812	448	2026-04-03 14:47:04.958407+00	fill_volume_ml	500.423313140533	495	505	t
1813	449	2026-05-08 22:13:39.714399+00	cap_torque_nm	1.41983933081786	1.2	1.8	t
1814	449	2026-05-08 22:17:00.707201+00	cap_torque_nm	1.61414110166267	1.2	1.8	t
1815	449	2026-05-08 22:36:36.90756+00	viscosity_cp	1037.6902447409	800	1200	t
1816	449	2026-05-08 22:39:51.467143+00	viscosity_cp	843.05762565806	800	1200	t
1817	449	2026-05-08 22:25:42.560227+00	viscosity_cp	1023.3075821075	800	1200	t
1818	450	2026-05-15 08:17:35.167043+00	net_weight_g	249.664497668235	248	252	t
1819	450	2026-05-15 06:51:09.952937+00	cap_torque_nm	1.56954173209724	1.2	1.8	t
1820	450	2026-05-15 07:12:41.25266+00	viscosity_cp	977.798721946105	800	1200	t
1821	451	2026-04-15 15:10:36.03592+00	cap_torque_nm	1.27087296532227	1.2	1.8	t
1822	451	2026-04-15 15:05:01.125821+00	cap_torque_nm	1.71677861032442	1.2	1.8	t
1823	451	2026-04-15 15:35:16.48919+00	viscosity_cp	1075.5432737418	800	1200	t
1824	452	2026-05-04 23:27:21.51429+00	label_offset_mm	-0.124	-1.0	1.0	t
1825	452	2026-05-05 00:58:14.813131+00	fill_volume_ml	497.4168559148	495	505	t
1826	452	2026-05-05 01:44:50.628372+00	fill_volume_ml	496.744029015338	495	505	t
1827	452	2026-05-04 23:00:49.700702+00	label_offset_mm	-0.361	-1.0	1.0	t
1828	453	2026-04-17 10:59:53.48493+00	label_offset_mm	0.353	-1.0	1.0	t
1829	453	2026-04-17 10:01:49.905938+00	viscosity_cp	1140.56026138374	800	1200	t
1830	453	2026-04-17 09:07:02.923452+00	viscosity_cp	798.127069262753	800	1200	f
1831	453	2026-04-17 07:11:02.613496+00	viscosity_cp	763.934316013107	800	1200	f
1832	454	2026-03-29 16:08:03.410513+00	cap_torque_nm	1.42585554546516	1.2	1.8	t
1833	454	2026-03-29 17:17:15.460603+00	cap_torque_nm	1.4735065667658	1.2	1.8	t
1834	454	2026-03-29 20:16:31.938278+00	label_offset_mm	0.157	-1.0	1.0	t
1835	454	2026-03-29 16:14:18.268096+00	fill_volume_ml	500.25097290255	495	505	t
1836	454	2026-03-29 17:36:50.384694+00	label_offset_mm	1.103	-1.0	1.0	f
1837	455	2026-04-16 23:21:24.15196+00	fill_volume_ml	501.706802024166	495	505	t
1838	455	2026-04-16 22:58:12.875105+00	net_weight_g	249.257718802827	248	252	t
1839	455	2026-04-16 23:18:54.807641+00	cap_torque_nm	1.54438809745356	1.2	1.8	t
1840	455	2026-04-16 23:44:26.100008+00	label_offset_mm	0.301	-1.0	1.0	t
1841	456	2026-04-28 06:42:04.684322+00	fill_volume_ml	502.918810871342	495	505	t
1842	456	2026-04-28 06:54:03.833588+00	fill_volume_ml	500.814429720759	495	505	t
1843	456	2026-04-28 08:42:46.786853+00	label_offset_mm	-0.905	-1.0	1.0	t
1844	456	2026-04-28 10:30:02.410731+00	viscosity_cp	1222.04559217934	800	1200	f
1845	456	2026-04-28 06:59:34.067416+00	label_offset_mm	-0.605	-1.0	1.0	t
1846	457	2026-04-12 14:44:28.162128+00	cap_torque_nm	1.64099279892848	1.2	1.8	t
1847	457	2026-04-12 15:07:16.794577+00	label_offset_mm	0.689	-1.0	1.0	t
1848	458	2026-04-04 23:43:56.058089+00	cap_torque_nm	1.6470090114812	1.2	1.8	t
1849	458	2026-04-04 22:26:29.807959+00	cap_torque_nm	1.37694872716549	1.2	1.8	t
1850	458	2026-04-05 00:46:41.496914+00	fill_volume_ml	500.972033932889	495	505	t
1851	458	2026-04-04 23:57:40.550376+00	net_weight_g	248.212425915534	248	252	t
1852	459	2026-04-30 09:58:21.82436+00	viscosity_cp	974.494580497922	800	1200	t
1853	459	2026-04-30 07:28:56.89667+00	viscosity_cp	946.243184131604	800	1200	t
1854	459	2026-04-30 08:21:18.027626+00	fill_volume_ml	498.170982748103	495	505	t
1855	459	2026-04-30 06:24:58.042086+00	label_offset_mm	-1.143	-1.0	1.0	f
1856	460	2026-05-13 14:32:26.47049+00	viscosity_cp	830.407388470047	800	1200	t
1857	460	2026-05-13 15:59:04.787316+00	viscosity_cp	1097.44218581462	800	1200	t
1858	460	2026-05-13 14:56:09.486305+00	label_offset_mm	1.188	-1.0	1.0	f
1859	460	2026-05-13 16:11:29.687079+00	fill_volume_ml	501.335506339318	495	505	t
1860	460	2026-05-13 14:52:56.029011+00	cap_torque_nm	1.55051563114998	1.2	1.8	t
1861	461	2026-04-09 22:45:02.512378+00	fill_volume_ml	499.695794260044	495	505	t
1862	461	2026-04-09 23:00:03.971257+00	label_offset_mm	-0.952	-1.0	1.0	t
1863	462	2026-05-01 08:30:05.00618+00	net_weight_g	251.959035128554	248	252	t
1864	462	2026-05-01 10:28:17.1145+00	fill_volume_ml	496.121735312538	495	505	t
1865	462	2026-05-01 06:48:01.613548+00	label_offset_mm	-0.458	-1.0	1.0	t
1866	462	2026-05-01 10:58:33.227515+00	fill_volume_ml	498.955129232298	495	505	t
1867	462	2026-05-01 11:05:10.377211+00	fill_volume_ml	503.590250631202	495	505	t
1868	463	2026-05-02 17:31:37.564988+00	fill_volume_ml	500.097168363473	495	505	t
1869	463	2026-05-02 16:45:56.281689+00	fill_volume_ml	497.570380083086	495	505	t
1870	463	2026-05-02 16:12:34.405894+00	label_offset_mm	1.068	-1.0	1.0	f
1871	463	2026-05-02 17:04:11.18208+00	viscosity_cp	1089.00742958262	800	1200	t
1872	463	2026-05-02 14:37:53.907255+00	label_offset_mm	-0.240	-1.0	1.0	t
1873	464	2026-04-09 22:25:37.750726+00	cap_torque_nm	1.32313270077416	1.2	1.8	t
1874	464	2026-04-10 00:11:23.225089+00	fill_volume_ml	503.06983712955	495	505	t
1875	464	2026-04-10 00:24:50.871015+00	viscosity_cp	1016.0099209621	800	1200	t
1876	465	2026-03-27 08:23:33.13677+00	net_weight_g	250.937012808785	248	252	t
1877	465	2026-03-27 10:05:05.471139+00	net_weight_g	251.983828276596	248	252	t
1878	465	2026-03-27 11:09:07.114773+00	viscosity_cp	754.34090785589	800	1200	f
1879	465	2026-03-27 10:52:12.585715+00	cap_torque_nm	1.27353471987297	1.2	1.8	t
1880	466	2026-05-02 17:57:19.210847+00	fill_volume_ml	501.468557454984	495	505	t
1881	466	2026-05-02 19:15:02.925034+00	viscosity_cp	1133.8809574811	800	1200	t
1882	466	2026-05-02 18:06:23.739106+00	net_weight_g	249.436537411165	248	252	t
1883	466	2026-05-02 17:51:05.005468+00	fill_volume_ml	500.943807863809	495	505	t
1884	466	2026-05-02 17:46:28.164369+00	fill_volume_ml	503.803468623488	495	505	t
1885	466	2026-05-02 17:27:44.00233+00	viscosity_cp	964.633552889511	800	1200	t
1886	467	2026-03-20 02:06:52.252658+00	fill_volume_ml	497.586290157313	495	505	t
1887	467	2026-03-20 02:35:24.956236+00	label_offset_mm	-0.797	-1.0	1.0	t
1888	467	2026-03-20 03:25:49.459284+00	cap_torque_nm	1.67041495879387	1.2	1.8	t
1889	468	2026-04-21 07:13:20.776896+00	label_offset_mm	0.532	-1.0	1.0	t
1890	468	2026-04-21 09:43:21.202251+00	label_offset_mm	0.598	-1.0	1.0	t
1891	468	2026-04-21 11:57:16.477865+00	net_weight_g	248.584809581594	248	252	t
1892	469	2026-05-03 15:13:56.669448+00	fill_volume_ml	501.445907021508	495	505	t
1893	469	2026-05-03 14:21:04.503076+00	cap_torque_nm	1.36785659850824	1.2	1.8	t
1894	469	2026-05-03 14:06:29.977233+00	fill_volume_ml	500.881795425305	495	505	t
1895	469	2026-05-03 15:05:11.523351+00	cap_torque_nm	1.63253656026203	1.2	1.8	t
1896	470	2026-03-22 22:12:37.700723+00	label_offset_mm	0.141	-1.0	1.0	t
1897	470	2026-03-22 22:13:43.618236+00	net_weight_g	248.857489674226	248	252	t
1898	471	2026-04-02 06:30:51.12092+00	label_offset_mm	-0.876	-1.0	1.0	t
1899	471	2026-04-02 08:05:31.289105+00	net_weight_g	248.986398795452	248	252	t
1900	471	2026-04-02 08:56:19.172374+00	cap_torque_nm	1.45385440667637	1.2	1.8	t
1901	472	2026-04-17 15:51:38.040741+00	cap_torque_nm	1.52752575354401	1.2	1.8	t
1902	472	2026-04-17 15:20:01.077762+00	viscosity_cp	957.501352805188	800	1200	t
1903	472	2026-04-17 14:41:13.265059+00	fill_volume_ml	502.786144398982	495	505	t
1904	473	2026-04-20 23:48:28.491774+00	label_offset_mm	0.036	-1.0	1.0	t
1905	473	2026-04-20 22:37:41.082851+00	viscosity_cp	1033.13813129028	800	1200	t
1906	473	2026-04-20 23:49:34.785816+00	fill_volume_ml	502.997688000338	495	505	t
1907	473	2026-04-20 22:04:53.91408+00	fill_volume_ml	500.133960674849	495	505	t
1908	473	2026-04-20 23:18:03.302555+00	viscosity_cp	867.515303770507	800	1200	t
1909	474	2026-04-02 10:16:27.064696+00	label_offset_mm	0.237	-1.0	1.0	t
1910	474	2026-04-02 07:29:54.592297+00	label_offset_mm	0.225	-1.0	1.0	t
1911	474	2026-04-02 06:10:34.291085+00	cap_torque_nm	1.32239514762358	1.2	1.8	t
1912	474	2026-04-02 06:48:17.984649+00	net_weight_g	251.49843424303	248	252	t
1913	474	2026-04-02 08:05:14.95391+00	label_offset_mm	0.646	-1.0	1.0	t
1914	475	2026-05-15 16:09:46.886324+00	fill_volume_ml	501.415059690136	495	505	t
1915	475	2026-05-15 17:07:33.682681+00	cap_torque_nm	1.34363901775362	1.2	1.8	t
1916	476	2026-04-06 23:35:06.626754+00	viscosity_cp	1021.15619518001	800	1200	t
1917	476	2026-04-06 23:08:23.818098+00	net_weight_g	249.936444194108	248	252	t
1918	476	2026-04-07 00:30:30.375444+00	viscosity_cp	1188.65995983125	800	1200	t
1919	476	2026-04-06 22:43:12.185623+00	label_offset_mm	-0.968	-1.0	1.0	t
1920	476	2026-04-06 23:07:15.996501+00	label_offset_mm	-1.127	-1.0	1.0	f
1921	476	2026-04-06 23:30:51.887652+00	label_offset_mm	-0.780	-1.0	1.0	t
1922	477	2026-03-29 12:10:35.520035+00	label_offset_mm	0.250	-1.0	1.0	t
1923	477	2026-03-29 12:28:12.844405+00	label_offset_mm	0.495	-1.0	1.0	t
1924	477	2026-03-29 08:01:30.81977+00	net_weight_g	251.698628184759	248	252	t
1925	477	2026-03-29 12:11:36.055466+00	label_offset_mm	-0.143	-1.0	1.0	t
1926	477	2026-03-29 10:38:03.000832+00	viscosity_cp	1138.93651523497	800	1200	t
1927	478	2026-03-28 14:27:35.573948+00	viscosity_cp	1195.13707199398	800	1200	t
1928	478	2026-03-28 14:28:46.249258+00	label_offset_mm	1.046	-1.0	1.0	f
1929	479	2026-04-22 04:43:59.740116+00	viscosity_cp	940.933268488084	800	1200	t
1930	479	2026-04-21 23:04:14.880486+00	net_weight_g	250.112946136289	248	252	t
1931	479	2026-04-22 00:18:02.191704+00	cap_torque_nm	1.43717796150977	1.2	1.8	t
1932	480	2026-04-27 09:42:19.247655+00	fill_volume_ml	496.390406265184	495	505	t
1933	480	2026-04-27 10:40:57.4569+00	net_weight_g	251.01848181022	248	252	t
1934	481	2026-04-30 18:17:57.762872+00	viscosity_cp	1094.80807429174	800	1200	t
1935	481	2026-04-30 15:38:59.566993+00	viscosity_cp	1038.07520946701	800	1200	t
1936	482	2026-05-12 22:56:50.286514+00	net_weight_g	250.903135797809	248	252	t
1937	482	2026-05-13 02:04:50.326756+00	label_offset_mm	-0.536	-1.0	1.0	t
1938	483	2026-04-07 06:39:16.339117+00	fill_volume_ml	498.903949770486	495	505	t
1939	483	2026-04-07 06:44:15.609114+00	cap_torque_nm	1.69528806587362	1.2	1.8	t
1940	483	2026-04-07 07:01:22.842307+00	viscosity_cp	918.600014727675	800	1200	t
1941	483	2026-04-07 06:38:02.960424+00	fill_volume_ml	499.694667386433	495	505	t
1942	484	2026-04-11 19:33:05.019913+00	viscosity_cp	1091.23552715269	800	1200	t
1943	484	2026-04-11 18:04:40.221035+00	viscosity_cp	1110.28913694426	800	1200	t
1944	484	2026-04-11 18:35:52.625658+00	net_weight_g	248.082582569352	248	252	t
1945	484	2026-04-11 15:58:14.776921+00	cap_torque_nm	1.67181173061996	1.2	1.8	t
1946	485	2026-03-20 00:26:47.324174+00	net_weight_g	249.04254359471	248	252	t
1947	485	2026-03-20 03:07:11.82873+00	label_offset_mm	-0.323	-1.0	1.0	t
1948	485	2026-03-20 01:40:40.286037+00	fill_volume_ml	497.619630044878	495	505	t
1949	485	2026-03-20 02:19:08.982016+00	cap_torque_nm	1.6386447899586	1.2	1.8	t
1950	486	2026-03-23 10:19:02.968319+00	viscosity_cp	1038.84728017321	800	1200	t
1951	486	2026-03-23 06:38:13.75786+00	viscosity_cp	1216.90008218811	800	1200	f
1952	486	2026-03-23 08:32:53.986731+00	label_offset_mm	-0.685	-1.0	1.0	t
1953	486	2026-03-23 09:44:14.307076+00	net_weight_g	251.225238358075	248	252	t
1954	486	2026-03-23 06:38:13.453258+00	cap_torque_nm	1.43511642124931	1.2	1.8	t
1955	487	2026-03-27 16:05:19.994431+00	viscosity_cp	1144.83187645891	800	1200	t
1956	487	2026-03-27 16:32:22.859341+00	fill_volume_ml	496.091594244444	495	505	t
1957	487	2026-03-27 16:32:36.203475+00	label_offset_mm	-0.492	-1.0	1.0	t
1958	488	2026-04-08 23:13:50.585338+00	fill_volume_ml	501.477322995749	495	505	t
1959	488	2026-04-08 22:29:31.515976+00	viscosity_cp	1058.89352077235	800	1200	t
1960	488	2026-04-09 00:15:12.411513+00	net_weight_g	248.16975201701	248	252	t
1961	488	2026-04-08 23:19:31.754983+00	fill_volume_ml	500.107528752046	495	505	t
1962	488	2026-04-08 23:55:37.900708+00	net_weight_g	249.344326680327	248	252	t
1963	489	2026-03-17 07:14:01.427334+00	label_offset_mm	-1.106	-1.0	1.0	f
1964	489	2026-03-17 07:47:58.09618+00	net_weight_g	249.862871005614	248	252	t
1965	490	2026-03-19 15:34:22.864625+00	label_offset_mm	-1.031	-1.0	1.0	f
1966	490	2026-03-19 14:46:28.741978+00	fill_volume_ml	499.521608264541	495	505	t
1967	490	2026-03-19 17:23:11.548226+00	fill_volume_ml	501.916936037475	495	505	t
1968	490	2026-03-19 18:02:42.794983+00	cap_torque_nm	1.42824297566864	1.2	1.8	t
1969	490	2026-03-19 15:21:44.652505+00	fill_volume_ml	499.7673917257	495	505	t
1970	491	2026-04-05 23:46:10.389639+00	fill_volume_ml	501.812477704032	495	505	t
1971	491	2026-04-06 02:15:31.792298+00	cap_torque_nm	1.55116611861036	1.2	1.8	t
1972	491	2026-04-06 00:19:18.385262+00	fill_volume_ml	502.077311533314	495	505	t
1973	491	2026-04-05 23:18:15.078616+00	fill_volume_ml	502.674090221635	495	505	t
1974	492	2026-04-13 06:45:32.179101+00	cap_torque_nm	1.63244009507302	1.2	1.8	t
1975	492	2026-04-13 07:43:18.82063+00	label_offset_mm	0.052	-1.0	1.0	t
1976	492	2026-04-13 06:36:04.142489+00	cap_torque_nm	1.50479545653016	1.2	1.8	t
1977	492	2026-04-13 07:26:03.731576+00	cap_torque_nm	1.52501519138029	1.2	1.8	t
1978	492	2026-04-13 06:59:36.665678+00	viscosity_cp	889.059145780958	800	1200	t
1979	493	2026-04-15 16:50:24.036906+00	cap_torque_nm	1.34807388933581	1.2	1.8	t
1980	493	2026-04-15 20:12:40.128625+00	viscosity_cp	968.004892070356	800	1200	t
1981	493	2026-04-15 18:04:20.259715+00	cap_torque_nm	1.35523480859235	1.2	1.8	t
1982	493	2026-04-15 19:02:31.399046+00	viscosity_cp	989.100467709922	800	1200	t
1983	493	2026-04-15 18:26:26.861099+00	viscosity_cp	1063.06628964906	800	1200	t
1984	493	2026-04-15 19:51:50.511016+00	label_offset_mm	-0.326	-1.0	1.0	t
1985	494	2026-05-09 01:24:33.959774+00	fill_volume_ml	496.456434331108	495	505	t
1986	494	2026-05-09 01:58:10.973096+00	net_weight_g	250.321596909951	248	252	t
1987	494	2026-05-09 01:00:04.072737+00	net_weight_g	251.373353200145	248	252	t
1988	494	2026-05-08 23:48:46.51301+00	label_offset_mm	0.684	-1.0	1.0	t
1989	494	2026-05-09 00:45:45.78999+00	viscosity_cp	765.514082438399	800	1200	f
1990	494	2026-05-08 22:35:59.5581+00	fill_volume_ml	502.910954333508	495	505	t
1991	495	2026-03-19 06:55:50.329681+00	cap_torque_nm	1.71278169213277	1.2	1.8	t
1992	495	2026-03-19 07:07:28.415429+00	label_offset_mm	0.751	-1.0	1.0	t
1993	495	2026-03-19 07:46:56.746972+00	cap_torque_nm	1.31151093179569	1.2	1.8	t
1994	495	2026-03-19 07:31:19.858118+00	cap_torque_nm	1.6885545580794	1.2	1.8	t
1995	495	2026-03-19 07:23:16.128257+00	cap_torque_nm	1.35810968903891	1.2	1.8	t
1996	495	2026-03-19 08:02:48.305282+00	cap_torque_nm	1.32551311965159	1.2	1.8	t
1997	496	2026-04-29 18:08:04.515973+00	viscosity_cp	1220.60144001525	800	1200	f
1998	496	2026-04-29 20:26:47.32604+00	cap_torque_nm	1.69518436160172	1.2	1.8	t
1999	496	2026-04-29 16:07:26.175308+00	fill_volume_ml	501.205631270941	495	505	t
2000	496	2026-04-29 18:09:53.233135+00	fill_volume_ml	497.87579986608	495	505	t
2001	496	2026-04-29 18:30:49.441335+00	label_offset_mm	1.099	-1.0	1.0	f
2002	496	2026-04-29 20:39:46.160011+00	label_offset_mm	0.623	-1.0	1.0	t
2003	497	2026-05-11 22:32:08.294734+00	label_offset_mm	-0.323	-1.0	1.0	t
2004	497	2026-05-11 22:54:04.879053+00	cap_torque_nm	1.65926046193043	1.2	1.8	t
2005	498	2026-04-29 06:21:07.728472+00	cap_torque_nm	1.33580347258631	1.2	1.8	t
2006	498	2026-04-29 06:43:27.980321+00	viscosity_cp	1174.70515096689	800	1200	t
2007	498	2026-04-29 06:40:01.552043+00	net_weight_g	249.855322048865	248	252	t
2008	499	2026-04-29 19:31:15.197061+00	fill_volume_ml	503.390142760758	495	505	t
2009	499	2026-04-29 17:54:06.202794+00	net_weight_g	249.622575055033	248	252	t
2010	500	2026-04-09 22:46:00.157142+00	cap_torque_nm	1.58748636383613	1.2	1.8	t
2011	500	2026-04-09 23:56:55.238307+00	net_weight_g	249.036007422457	248	252	t
2012	500	2026-04-09 22:55:10.975321+00	net_weight_g	251.111511235002	248	252	t
2013	500	2026-04-09 22:23:51.60522+00	label_offset_mm	-0.469	-1.0	1.0	t
2014	500	2026-04-09 23:18:58.294613+00	cap_torque_nm	1.63455479836113	1.2	1.8	t
2015	500	2026-04-09 23:56:56.128603+00	fill_volume_ml	501.662619922161	495	505	t
2016	501	2026-04-25 08:29:04.31676+00	fill_volume_ml	502.548191626229	495	505	t
2017	501	2026-04-25 08:38:11.126034+00	fill_volume_ml	500.160948243415	495	505	t
2018	501	2026-04-25 07:41:13.785159+00	fill_volume_ml	497.477716729152	495	505	t
2019	502	2026-04-30 17:38:03.788511+00	fill_volume_ml	499.736012706926	495	505	t
2020	502	2026-04-30 20:18:48.480308+00	viscosity_cp	770.737690589983	800	1200	f
2021	502	2026-04-30 21:17:13.775069+00	label_offset_mm	0.669	-1.0	1.0	t
2022	502	2026-04-30 14:26:05.103848+00	cap_torque_nm	1.71874363099452	1.2	1.8	t
2023	503	2026-04-20 01:00:40.674298+00	net_weight_g	250.227020226401	248	252	t
2024	503	2026-04-19 22:38:00.902+00	fill_volume_ml	498.92715686663	495	505	t
2025	503	2026-04-19 22:15:18.09245+00	label_offset_mm	-0.039	-1.0	1.0	t
2026	503	2026-04-20 02:00:16.526933+00	label_offset_mm	-0.928	-1.0	1.0	t
2027	504	2026-05-03 06:13:59.250124+00	label_offset_mm	0.497	-1.0	1.0	t
2028	504	2026-05-03 10:12:20.152898+00	cap_torque_nm	1.34104915481109	1.2	1.8	t
2029	504	2026-05-03 07:28:10.192937+00	label_offset_mm	-1.054	-1.0	1.0	f
2030	504	2026-05-03 11:24:41.336274+00	viscosity_cp	1134.25158814193	800	1200	t
2031	504	2026-05-03 12:48:25.373027+00	viscosity_cp	1235.01170003085	800	1200	f
2032	505	2026-04-08 17:56:44.406939+00	cap_torque_nm	1.63126723290138	1.2	1.8	t
2033	505	2026-04-08 17:31:17.301142+00	label_offset_mm	0.842	-1.0	1.0	t
2034	505	2026-04-08 15:40:36.946112+00	cap_torque_nm	1.44802969299821	1.2	1.8	t
2035	506	2026-04-07 23:07:38.480871+00	cap_torque_nm	1.35365320899701	1.2	1.8	t
2036	506	2026-04-08 00:08:45.860446+00	viscosity_cp	858.203569502707	800	1200	t
2037	506	2026-04-07 23:06:58.691055+00	fill_volume_ml	502.812890164862	495	505	t
2038	507	2026-03-20 07:13:17.301056+00	net_weight_g	251.458885125194	248	252	t
2039	507	2026-03-20 06:53:08.614378+00	fill_volume_ml	497.096684615496	495	505	t
2040	508	2026-04-12 14:30:01.311744+00	label_offset_mm	-0.220	-1.0	1.0	t
2041	508	2026-04-12 18:55:47.703493+00	viscosity_cp	1142.29152829866	800	1200	t
2042	509	2026-03-30 23:14:18.828169+00	label_offset_mm	-0.585	-1.0	1.0	t
2043	509	2026-03-31 00:21:21.285301+00	fill_volume_ml	496.487781942001	495	505	t
2044	509	2026-03-30 23:36:23.595886+00	fill_volume_ml	498.377790683292	495	505	t
2045	509	2026-03-30 23:10:54.735016+00	label_offset_mm	0.442	-1.0	1.0	t
2046	509	2026-03-31 00:54:21.916823+00	net_weight_g	249.562374198093	248	252	t
2047	509	2026-03-30 22:23:12.237411+00	cap_torque_nm	1.62130452872302	1.2	1.8	t
2048	510	2026-03-26 09:48:02.753195+00	fill_volume_ml	502.312857876866	495	505	t
2049	510	2026-03-26 06:39:42.696494+00	label_offset_mm	-0.899	-1.0	1.0	t
2050	510	2026-03-26 07:56:31.810519+00	label_offset_mm	0.550	-1.0	1.0	t
2051	511	2026-03-23 15:31:50.488323+00	viscosity_cp	1000.24768636848	800	1200	t
2052	511	2026-03-23 14:14:21.412884+00	label_offset_mm	0.750	-1.0	1.0	t
2053	512	2026-05-11 02:16:09.758801+00	label_offset_mm	0.895	-1.0	1.0	t
2054	512	2026-05-11 00:30:39.905172+00	cap_torque_nm	1.31461569701699	1.2	1.8	t
2055	512	2026-05-11 01:36:29.328682+00	cap_torque_nm	1.41534461454648	1.2	1.8	t
2056	512	2026-05-11 00:22:42.832769+00	net_weight_g	251.834138400272	248	252	t
2057	512	2026-05-11 01:48:55.995992+00	cap_torque_nm	1.35961048032958	1.2	1.8	t
2058	512	2026-05-10 23:17:23.229622+00	label_offset_mm	-0.270	-1.0	1.0	t
2059	513	2026-04-26 09:52:29.615272+00	net_weight_g	250.015805038506	248	252	t
2060	513	2026-04-26 08:41:49.699363+00	label_offset_mm	-0.057	-1.0	1.0	t
2061	513	2026-04-26 08:14:09.516815+00	viscosity_cp	934.607372451841	800	1200	t
2062	513	2026-04-26 09:44:01.198224+00	cap_torque_nm	1.47956170346931	1.2	1.8	t
2063	513	2026-04-26 07:52:16.632933+00	cap_torque_nm	1.69039159534781	1.2	1.8	t
2064	513	2026-04-26 09:49:56.107944+00	viscosity_cp	847.571058546391	800	1200	t
2065	514	2026-04-19 15:27:31.064983+00	cap_torque_nm	1.58610451954732	1.2	1.8	t
2066	514	2026-04-19 17:46:11.232943+00	viscosity_cp	1077.56219117767	800	1200	t
2067	515	2026-04-21 23:14:30.194265+00	cap_torque_nm	1.74946583924955	1.2	1.8	t
2068	515	2026-04-21 22:34:56.502861+00	net_weight_g	250.846906143835	248	252	t
2069	515	2026-04-21 23:01:06.73434+00	viscosity_cp	754.269751817993	800	1200	f
2070	515	2026-04-22 00:15:05.749201+00	viscosity_cp	1188.28252568801	800	1200	t
2071	516	2026-05-04 11:36:57.942425+00	cap_torque_nm	1.63464947915404	1.2	1.8	t
2072	516	2026-05-04 08:25:37.940759+00	label_offset_mm	-0.007	-1.0	1.0	t
2073	516	2026-05-04 07:59:31.139577+00	label_offset_mm	0.423	-1.0	1.0	t
2074	516	2026-05-04 10:52:22.958806+00	fill_volume_ml	496.84500193858	495	505	t
2075	517	2026-04-19 16:12:22.001364+00	viscosity_cp	1115.90810879721	800	1200	t
2076	517	2026-04-19 17:46:35.178702+00	viscosity_cp	763.867400445697	800	1200	f
2077	517	2026-04-19 15:22:46.514907+00	viscosity_cp	758.603317700246	800	1200	f
2078	518	2026-04-28 02:16:52.070242+00	viscosity_cp	885.300981339651	800	1200	t
2079	518	2026-04-28 00:26:19.015436+00	viscosity_cp	1205.24452496508	800	1200	f
2080	519	2026-03-18 10:48:14.556473+00	cap_torque_nm	1.67784037269456	1.2	1.8	t
2081	519	2026-03-18 07:00:47.731141+00	viscosity_cp	796.721915530921	800	1200	f
2082	519	2026-03-18 10:28:50.592687+00	viscosity_cp	1148.21676295581	800	1200	t
2083	519	2026-03-18 10:17:54.968562+00	fill_volume_ml	498.076843818195	495	505	t
2084	520	2026-04-10 14:49:04.289684+00	cap_torque_nm	1.57476300733647	1.2	1.8	t
2085	520	2026-04-10 17:05:49.493622+00	label_offset_mm	0.379	-1.0	1.0	t
2086	520	2026-04-10 15:26:35.462281+00	label_offset_mm	0.997	-1.0	1.0	t
2087	521	2026-03-25 01:11:11.761697+00	fill_volume_ml	502.269809533067	495	505	t
2088	521	2026-03-25 00:25:34.753175+00	viscosity_cp	863.992243790335	800	1200	t
2089	521	2026-03-24 23:55:36.595347+00	fill_volume_ml	501.496639859178	495	505	t
2090	521	2026-03-25 00:49:05.623824+00	viscosity_cp	968.530468822604	800	1200	t
2091	521	2026-03-25 00:30:54.860052+00	label_offset_mm	0.825	-1.0	1.0	t
2092	522	2026-05-02 06:23:08.331122+00	net_weight_g	248.184983814265	248	252	t
2093	522	2026-05-02 06:36:56.51018+00	label_offset_mm	0.975	-1.0	1.0	t
2094	522	2026-05-02 06:37:00.962136+00	net_weight_g	249.381154792368	248	252	t
2095	523	2026-05-12 15:41:05.595982+00	viscosity_cp	812.842161062466	800	1200	t
2096	523	2026-05-12 17:12:42.297377+00	label_offset_mm	0.922	-1.0	1.0	t
2097	524	2026-05-10 00:39:07.249835+00	net_weight_g	251.849123749331	248	252	t
2098	524	2026-05-10 00:13:35.557326+00	fill_volume_ml	499.938703710673	495	505	t
2099	524	2026-05-10 00:35:51.895601+00	fill_volume_ml	496.17352013046	495	505	t
2100	524	2026-05-10 00:14:33.119592+00	label_offset_mm	-0.753	-1.0	1.0	t
2101	524	2026-05-09 23:23:55.784267+00	fill_volume_ml	501.466079459441	495	505	t
2102	524	2026-05-09 23:34:19.274727+00	cap_torque_nm	1.64077960263869	1.2	1.8	t
2103	525	2026-04-03 09:02:39.068615+00	net_weight_g	248.132462291947	248	252	t
2104	525	2026-04-03 09:37:11.323535+00	net_weight_g	250.742936325687	248	252	t
2105	525	2026-04-03 08:54:18.832934+00	label_offset_mm	-1.079	-1.0	1.0	f
2106	526	2026-05-08 14:11:50.004537+00	label_offset_mm	-0.737	-1.0	1.0	t
2107	526	2026-05-08 14:21:13.543599+00	viscosity_cp	916.474268643302	800	1200	t
2108	526	2026-05-08 15:21:25.142508+00	label_offset_mm	-1.073	-1.0	1.0	f
2109	526	2026-05-08 15:37:53.4575+00	net_weight_g	248.877100722563	248	252	t
2110	526	2026-05-08 16:34:04.264885+00	fill_volume_ml	501.865070602622	495	505	t
2111	527	2026-03-27 22:21:40.209832+00	fill_volume_ml	496.797609011368	495	505	t
2112	527	2026-03-28 01:24:05.990395+00	net_weight_g	250.039347482501	248	252	t
2113	527	2026-03-28 03:00:56.156955+00	cap_torque_nm	1.3292794342952	1.2	1.8	t
2114	527	2026-03-28 00:27:14.670593+00	label_offset_mm	0.811	-1.0	1.0	t
2115	528	2026-05-13 09:07:27.523645+00	fill_volume_ml	501.273695107241	495	505	t
2116	528	2026-05-13 08:21:37.532447+00	net_weight_g	250.991890694345	248	252	t
2117	528	2026-05-13 07:44:30.261223+00	net_weight_g	248.220482129161	248	252	t
2118	528	2026-05-13 06:06:45.626383+00	viscosity_cp	794.90077626106	800	1200	f
2119	528	2026-05-13 11:38:47.744191+00	viscosity_cp	960.662407214455	800	1200	t
2120	528	2026-05-13 10:29:26.445603+00	viscosity_cp	1124.00108452963	800	1200	t
2121	529	2026-04-13 18:14:13.655894+00	fill_volume_ml	496.846282135641	495	505	t
2122	529	2026-04-13 17:24:14.361163+00	fill_volume_ml	502.452077994316	495	505	t
2123	529	2026-04-13 18:25:56.637113+00	net_weight_g	250.777804664579	248	252	t
2124	529	2026-04-13 18:29:06.483847+00	cap_torque_nm	1.51887916351373	1.2	1.8	t
2125	529	2026-04-13 16:56:34.289023+00	label_offset_mm	-0.279	-1.0	1.0	t
2126	529	2026-04-13 16:59:14.704984+00	viscosity_cp	827.588992605867	800	1200	t
2127	530	2026-05-10 00:19:58.397479+00	label_offset_mm	0.229	-1.0	1.0	t
2128	530	2026-05-10 00:22:18.508152+00	net_weight_g	249.585790557173	248	252	t
2129	530	2026-05-09 22:24:48.496884+00	net_weight_g	250.59175621342	248	252	t
2130	530	2026-05-09 22:19:30.72005+00	fill_volume_ml	503.147453951105	495	505	t
2131	531	2026-05-05 09:26:00.212252+00	label_offset_mm	-1.117	-1.0	1.0	f
2132	531	2026-05-05 08:41:28.652955+00	net_weight_g	251.083348726825	248	252	t
2133	532	2026-05-12 19:09:00.904789+00	label_offset_mm	1.057	-1.0	1.0	f
2134	532	2026-05-12 15:33:33.855369+00	cap_torque_nm	1.64904421861328	1.2	1.8	t
2135	532	2026-05-12 18:05:37.758451+00	fill_volume_ml	502.551242823202	495	505	t
2136	532	2026-05-12 16:25:05.911083+00	viscosity_cp	1149.8890593617	800	1200	t
2137	533	2026-04-09 23:27:19.43525+00	net_weight_g	250.628242745864	248	252	t
2138	533	2026-04-09 23:48:49.290457+00	cap_torque_nm	1.4440820267341	1.2	1.8	t
2139	533	2026-04-09 23:43:18.934954+00	net_weight_g	250.158307861091	248	252	t
2140	533	2026-04-10 02:22:55.326216+00	fill_volume_ml	497.201484881092	495	505	t
2141	533	2026-04-10 02:31:29.440439+00	viscosity_cp	1245.99087078031	800	1200	f
2142	534	2026-03-17 09:32:46.044165+00	label_offset_mm	-0.797	-1.0	1.0	t
2143	534	2026-03-17 07:06:37.373914+00	label_offset_mm	0.292	-1.0	1.0	t
2144	534	2026-03-17 06:49:04.577471+00	cap_torque_nm	1.31084615725662	1.2	1.8	t
2145	534	2026-03-17 12:25:26.2393+00	net_weight_g	249.32328263696	248	252	t
2146	534	2026-03-17 08:07:32.075661+00	label_offset_mm	-0.377	-1.0	1.0	t
2147	535	2026-05-11 14:18:29.091592+00	fill_volume_ml	497.464543307163	495	505	t
2148	535	2026-05-11 18:26:57.579996+00	net_weight_g	248.640334156833	248	252	t
2149	535	2026-05-11 16:42:06.233016+00	viscosity_cp	990.415015617271	800	1200	t
2150	535	2026-05-11 18:23:13.338686+00	label_offset_mm	-0.038	-1.0	1.0	t
2151	535	2026-05-11 16:34:29.458466+00	fill_volume_ml	498.319081325581	495	505	t
2152	536	2026-04-12 04:15:43.539802+00	net_weight_g	249.182154607998	248	252	t
2153	536	2026-04-11 23:41:30.178374+00	fill_volume_ml	498.194575359832	495	505	t
2154	536	2026-04-12 00:34:48.463863+00	cap_torque_nm	1.46157484018397	1.2	1.8	t
2155	537	2026-04-24 09:13:03.365642+00	net_weight_g	251.065234811392	248	252	t
2156	537	2026-04-24 07:39:30.662023+00	label_offset_mm	-0.613	-1.0	1.0	t
2157	537	2026-04-24 06:30:38.368555+00	cap_torque_nm	1.34952327494453	1.2	1.8	t
2158	537	2026-04-24 06:50:03.435758+00	fill_volume_ml	500.073277985239	495	505	t
2159	537	2026-04-24 08:10:25.27801+00	fill_volume_ml	496.491928180545	495	505	t
2160	537	2026-04-24 08:04:28.98672+00	viscosity_cp	1071.99331322252	800	1200	t
2161	538	2026-04-03 14:38:08.020379+00	viscosity_cp	1141.94420280047	800	1200	t
2162	538	2026-04-03 16:05:58.979985+00	fill_volume_ml	503.256027929379	495	505	t
2163	538	2026-04-03 15:00:27.113217+00	net_weight_g	249.711169829914	248	252	t
2164	538	2026-04-03 16:20:36.627466+00	label_offset_mm	-1.054	-1.0	1.0	f
2165	538	2026-04-03 15:42:58.457273+00	cap_torque_nm	1.40550026741136	1.2	1.8	t
2166	538	2026-04-03 15:27:53.008008+00	viscosity_cp	843.293262446326	800	1200	t
2167	539	2026-03-19 02:58:42.70528+00	viscosity_cp	906.71013111943	800	1200	t
2168	539	2026-03-19 00:34:34.911665+00	label_offset_mm	-0.899	-1.0	1.0	t
2169	539	2026-03-18 23:55:27.96309+00	viscosity_cp	1045.8073290568	800	1200	t
2170	539	2026-03-19 02:36:51.050588+00	cap_torque_nm	1.52078717990504	1.2	1.8	t
2171	539	2026-03-19 00:46:19.194906+00	label_offset_mm	0.929	-1.0	1.0	t
2172	539	2026-03-19 00:52:49.731577+00	cap_torque_nm	1.42122160051729	1.2	1.8	t
2173	540	2026-05-02 11:47:16.535332+00	net_weight_g	248.388328413563	248	252	t
2174	540	2026-05-02 07:47:24.689606+00	cap_torque_nm	1.74512173506344	1.2	1.8	t
2175	540	2026-05-02 09:49:43.066869+00	net_weight_g	250.268480275925	248	252	t
2176	541	2026-05-01 20:17:10.899359+00	label_offset_mm	0.511	-1.0	1.0	t
2177	541	2026-05-01 18:28:17.202812+00	cap_torque_nm	1.38972445619927	1.2	1.8	t
2178	541	2026-05-01 20:14:08.011763+00	cap_torque_nm	1.50328086294373	1.2	1.8	t
2179	541	2026-05-01 17:23:54.646372+00	label_offset_mm	-0.567	-1.0	1.0	t
2180	541	2026-05-01 16:34:09.924279+00	net_weight_g	251.505646089993	248	252	t
2181	542	2026-03-21 23:59:33.995288+00	viscosity_cp	1127.89760944762	800	1200	t
2182	542	2026-03-21 22:37:33.408569+00	label_offset_mm	1.171	-1.0	1.0	f
2183	542	2026-03-22 02:10:46.618249+00	label_offset_mm	-0.264	-1.0	1.0	t
2184	543	2026-04-11 07:24:36.772147+00	fill_volume_ml	501.458853871257	495	505	t
2185	543	2026-04-11 06:30:09.912002+00	net_weight_g	249.466618004492	248	252	t
2186	543	2026-04-11 06:27:35.680693+00	net_weight_g	251.617012169333	248	252	t
2187	543	2026-04-11 06:34:07.078691+00	cap_torque_nm	1.57037040231083	1.2	1.8	t
2188	544	2026-05-05 15:49:39.205167+00	cap_torque_nm	1.29880935214594	1.2	1.8	t
2189	544	2026-05-05 15:55:15.055225+00	net_weight_g	251.975876666187	248	252	t
2190	544	2026-05-05 16:00:23.590113+00	label_offset_mm	-1.136	-1.0	1.0	f
2191	544	2026-05-05 14:57:14.681725+00	net_weight_g	250.116390306852	248	252	t
2192	545	2026-03-31 22:52:47.593048+00	fill_volume_ml	498.56347330584	495	505	t
2193	545	2026-04-01 01:23:26.235887+00	net_weight_g	249.76544769515	248	252	t
2194	545	2026-03-31 23:11:23.001913+00	fill_volume_ml	498.089454241083	495	505	t
2195	545	2026-03-31 23:03:14.449297+00	label_offset_mm	1.061	-1.0	1.0	f
2196	545	2026-04-01 01:10:43.025092+00	cap_torque_nm	1.44822287499649	1.2	1.8	t
2197	546	2026-04-19 06:55:42.387331+00	viscosity_cp	986.14024625989	800	1200	t
2198	546	2026-04-19 06:54:03.191622+00	label_offset_mm	-0.296	-1.0	1.0	t
2199	546	2026-04-19 09:19:48.677916+00	viscosity_cp	952.966028849199	800	1200	t
2200	546	2026-04-19 12:42:42.251215+00	net_weight_g	251.64962122768	248	252	t
2201	546	2026-04-19 07:21:49.964741+00	fill_volume_ml	496.858225371822	495	505	t
2202	546	2026-04-19 12:40:12.697419+00	cap_torque_nm	1.68051924099064	1.2	1.8	t
2203	547	2026-03-20 18:56:27.408191+00	fill_volume_ml	497.943005744831	495	505	t
2204	547	2026-03-20 15:19:39.121199+00	label_offset_mm	1.062	-1.0	1.0	f
2205	547	2026-03-20 14:48:37.409988+00	cap_torque_nm	1.30905706004408	1.2	1.8	t
2206	547	2026-03-20 19:01:59.747705+00	viscosity_cp	1100.99018538889	800	1200	t
2207	547	2026-03-20 19:19:43.107147+00	net_weight_g	248.108801560618	248	252	t
2208	548	2026-04-14 03:01:57.800629+00	viscosity_cp	929.141533875711	800	1200	t
2209	548	2026-04-13 22:32:44.249031+00	label_offset_mm	-0.494	-1.0	1.0	t
2210	548	2026-04-14 00:54:55.222658+00	cap_torque_nm	1.55790218263351	1.2	1.8	t
2211	548	2026-04-14 00:23:57.495288+00	label_offset_mm	-0.336	-1.0	1.0	t
2212	548	2026-04-14 00:18:01.830519+00	cap_torque_nm	1.682636730764	1.2	1.8	t
2213	548	2026-04-14 01:29:31.562125+00	net_weight_g	249.902892536691	248	252	t
2214	549	2026-05-01 10:15:09.14615+00	fill_volume_ml	496.814860055727	495	505	t
2215	549	2026-05-01 06:55:57.86055+00	cap_torque_nm	1.57803887384267	1.2	1.8	t
2216	549	2026-05-01 10:22:48.011793+00	viscosity_cp	914.706491189053	800	1200	t
2217	549	2026-05-01 07:00:34.786735+00	viscosity_cp	1011.77724068504	800	1200	t
2218	550	2026-04-26 16:31:40.775012+00	viscosity_cp	1136.19918875489	800	1200	t
2219	550	2026-04-26 17:03:54.297932+00	viscosity_cp	1173.90287885075	800	1200	t
2220	551	2026-05-17 04:15:47.797577+00	viscosity_cp	903.828726687409	800	1200	t
2221	551	2026-05-17 00:45:22.169126+00	viscosity_cp	1207.41427381322	800	1200	f
2222	551	2026-05-17 04:30:01.42472+00	fill_volume_ml	501.241003826802	495	505	t
2223	551	2026-05-17 00:10:28.670102+00	net_weight_g	249.375597102777	248	252	t
2224	552	2026-03-24 09:43:41.345912+00	fill_volume_ml	497.260952897478	495	505	t
2225	552	2026-03-24 08:00:47.241762+00	label_offset_mm	0.579	-1.0	1.0	t
2226	552	2026-03-24 06:48:23.780375+00	fill_volume_ml	498.659413469862	495	505	t
2227	552	2026-03-24 08:44:41.826637+00	viscosity_cp	839.635722088223	800	1200	t
2228	552	2026-03-24 08:31:33.375222+00	cap_torque_nm	1.72011388594389	1.2	1.8	t
2229	552	2026-03-24 08:14:44.222737+00	net_weight_g	248.679032809476	248	252	t
2230	553	2026-04-18 14:31:24.280121+00	fill_volume_ml	499.920367134372	495	505	t
2231	553	2026-04-18 15:33:28.284636+00	label_offset_mm	0.253	-1.0	1.0	t
2232	553	2026-04-18 14:23:09.167825+00	label_offset_mm	0.491	-1.0	1.0	t
2233	554	2026-03-21 01:21:09.76082+00	label_offset_mm	-0.299	-1.0	1.0	t
2234	554	2026-03-20 22:58:28.2948+00	viscosity_cp	1095.82835989834	800	1200	t
2235	554	2026-03-21 02:18:37.658145+00	cap_torque_nm	1.52180555964481	1.2	1.8	t
2236	554	2026-03-21 01:06:53.505302+00	fill_volume_ml	500.335802970338	495	505	t
2237	555	2026-03-19 08:16:37.325128+00	fill_volume_ml	502.511078836421	495	505	t
2238	555	2026-03-19 08:03:34.763773+00	viscosity_cp	986.755709691346	800	1200	t
2239	555	2026-03-19 06:36:02.675451+00	cap_torque_nm	1.59952469168639	1.2	1.8	t
2240	555	2026-03-19 08:02:07.504803+00	viscosity_cp	866.762372121844	800	1200	t
2241	555	2026-03-19 06:55:24.227516+00	viscosity_cp	808.31213289576	800	1200	t
2242	556	2026-04-24 14:54:03.21553+00	fill_volume_ml	501.650562473809	495	505	t
2243	556	2026-04-24 14:41:56.351296+00	cap_torque_nm	1.70014162574638	1.2	1.8	t
2244	556	2026-04-24 15:31:03.03051+00	viscosity_cp	770.989545164891	800	1200	f
2245	557	2026-03-22 02:44:25.212336+00	label_offset_mm	1.069	-1.0	1.0	f
2246	557	2026-03-22 01:27:21.734496+00	label_offset_mm	0.790	-1.0	1.0	t
2247	557	2026-03-22 03:07:45.668675+00	fill_volume_ml	502.104817507142	495	505	t
2248	557	2026-03-21 22:33:44.329437+00	cap_torque_nm	1.29788078340205	1.2	1.8	t
2249	557	2026-03-22 00:03:08.649102+00	fill_volume_ml	501.277351893659	495	505	t
2250	558	2026-04-26 08:38:16.80545+00	net_weight_g	250.449405978754	248	252	t
2251	558	2026-04-26 07:53:10.51646+00	cap_torque_nm	1.38379057717422	1.2	1.8	t
2252	558	2026-04-26 10:04:40.62385+00	fill_volume_ml	497.995328525324	495	505	t
2253	559	2026-04-18 16:46:52.566006+00	viscosity_cp	1216.62574507418	800	1200	f
2254	559	2026-04-18 15:36:48.629335+00	fill_volume_ml	497.043634820329	495	505	t
2255	559	2026-04-18 17:53:47.759908+00	fill_volume_ml	496.772958588056	495	505	t
2256	559	2026-04-18 16:06:28.578714+00	cap_torque_nm	1.59913473897803	1.2	1.8	t
2257	559	2026-04-18 17:25:15.79742+00	net_weight_g	248.472619135547	248	252	t
2258	559	2026-04-18 16:58:57.218609+00	viscosity_cp	1219.88717017735	800	1200	f
2259	560	2026-03-23 00:42:02.413804+00	net_weight_g	248.988553892337	248	252	t
2260	560	2026-03-23 01:46:50.9675+00	net_weight_g	249.94952761582	248	252	t
2261	560	2026-03-22 22:09:30.766234+00	net_weight_g	248.306199692707	248	252	t
2262	560	2026-03-23 00:53:44.445872+00	label_offset_mm	0.806	-1.0	1.0	t
2263	560	2026-03-23 01:20:35.306754+00	label_offset_mm	0.275	-1.0	1.0	t
2264	561	2026-03-23 08:20:11.701284+00	label_offset_mm	-0.961	-1.0	1.0	t
2265	561	2026-03-23 08:02:50.917212+00	fill_volume_ml	497.93110842026	495	505	t
2266	561	2026-03-23 07:20:34.390022+00	viscosity_cp	819.558491810677	800	1200	t
2267	562	2026-05-02 18:35:10.607951+00	net_weight_g	249.307509167647	248	252	t
2268	562	2026-05-02 14:53:15.190447+00	label_offset_mm	-1.133	-1.0	1.0	f
2269	562	2026-05-02 16:10:46.116093+00	viscosity_cp	818.132041090314	800	1200	t
2270	562	2026-05-02 17:54:50.913296+00	fill_volume_ml	502.390293921034	495	505	t
2271	562	2026-05-02 14:41:42.387313+00	cap_torque_nm	1.61739060081679	1.2	1.8	t
2272	562	2026-05-02 15:12:45.082047+00	label_offset_mm	1.184	-1.0	1.0	f
2273	563	2026-03-22 00:42:55.104237+00	net_weight_g	250.373116454772	248	252	t
2274	563	2026-03-22 00:28:26.370096+00	fill_volume_ml	503.529760030208	495	505	t
2275	563	2026-03-22 00:04:31.855999+00	label_offset_mm	-1.141	-1.0	1.0	f
2276	563	2026-03-22 00:03:25.955116+00	viscosity_cp	773.488181658501	800	1200	f
2277	564	2026-04-24 06:45:37.066429+00	net_weight_g	250.257676195677	248	252	t
2278	564	2026-04-24 06:42:24.233298+00	viscosity_cp	894.880515492791	800	1200	t
2279	564	2026-04-24 09:29:47.206036+00	net_weight_g	248.331699401841	248	252	t
2280	564	2026-04-24 09:49:37.407077+00	fill_volume_ml	499.902214025944	495	505	t
2281	564	2026-04-24 08:07:08.173801+00	cap_torque_nm	1.4511652365276	1.2	1.8	t
2282	565	2026-04-25 14:40:15.504577+00	net_weight_g	249.552685461445	248	252	t
2283	565	2026-04-25 15:52:15.439443+00	fill_volume_ml	498.018593916341	495	505	t
2284	565	2026-04-25 14:43:58.54462+00	viscosity_cp	1034.24797430237	800	1200	t
2285	565	2026-04-25 16:46:29.460048+00	net_weight_g	250.477065145721	248	252	t
2286	565	2026-04-25 14:51:10.843218+00	viscosity_cp	1093.5321440661	800	1200	t
2287	566	2026-04-20 03:12:39.532534+00	cap_torque_nm	1.42089550133234	1.2	1.8	t
2288	566	2026-04-20 01:00:04.516304+00	net_weight_g	249.405464530701	248	252	t
2289	566	2026-04-19 22:43:29.201479+00	viscosity_cp	809.490694371247	800	1200	t
2290	567	2026-05-06 06:33:55.30627+00	label_offset_mm	-0.900	-1.0	1.0	t
2291	567	2026-05-06 08:20:49.792097+00	viscosity_cp	777.57840355625	800	1200	f
2292	567	2026-05-06 10:19:01.459406+00	net_weight_g	250.03501457344	248	252	t
2293	567	2026-05-06 11:34:48.992178+00	label_offset_mm	-0.123	-1.0	1.0	t
2294	567	2026-05-06 06:34:29.925762+00	cap_torque_nm	1.7453222031645	1.2	1.8	t
2295	567	2026-05-06 07:42:23.627727+00	net_weight_g	249.694584525982	248	252	t
2296	568	2026-05-04 19:37:39.116892+00	net_weight_g	250.697905138158	248	252	t
2297	568	2026-05-04 18:12:22.346318+00	viscosity_cp	1130.55210704548	800	1200	t
2298	568	2026-05-04 19:05:16.37491+00	cap_torque_nm	1.28802655805712	1.2	1.8	t
2299	568	2026-05-04 14:59:56.74576+00	viscosity_cp	1242.53193557558	800	1200	f
2300	569	2026-03-23 03:24:07.80916+00	viscosity_cp	938.896602577323	800	1200	t
2301	569	2026-03-23 02:47:43.062005+00	net_weight_g	251.60461685804	248	252	t
2302	569	2026-03-22 23:35:53.377046+00	net_weight_g	250.577886885198	248	252	t
2303	569	2026-03-23 02:52:36.798514+00	label_offset_mm	1.099	-1.0	1.0	f
2304	569	2026-03-23 01:45:39.871811+00	net_weight_g	248.411147821936	248	252	t
2305	570	2026-05-08 09:50:44.805726+00	cap_torque_nm	1.32948175869762	1.2	1.8	t
2306	570	2026-05-08 10:26:49.481392+00	fill_volume_ml	497.352762972791	495	505	t
2307	570	2026-05-08 08:26:45.441351+00	viscosity_cp	779.186899092819	800	1200	f
2308	570	2026-05-08 10:19:00.033674+00	label_offset_mm	0.244	-1.0	1.0	t
2309	570	2026-05-08 07:17:33.487492+00	label_offset_mm	0.187	-1.0	1.0	t
2310	570	2026-05-08 08:42:44.541733+00	label_offset_mm	0.782	-1.0	1.0	t
2311	571	2026-04-19 18:50:13.561312+00	net_weight_g	249.202983800864	248	252	t
2312	571	2026-04-19 18:30:18.682539+00	label_offset_mm	-0.783	-1.0	1.0	t
2313	571	2026-04-19 19:13:51.476714+00	viscosity_cp	766.026719103508	800	1200	f
2314	571	2026-04-19 19:18:40.618302+00	cap_torque_nm	1.56872823091534	1.2	1.8	t
2315	571	2026-04-19 16:26:09.601503+00	fill_volume_ml	496.753387457595	495	505	t
2316	572	2026-05-05 22:59:43.838626+00	fill_volume_ml	497.182663715372	495	505	t
2317	572	2026-05-05 23:55:54.591429+00	net_weight_g	250.915208277363	248	252	t
2318	572	2026-05-06 03:26:46.602645+00	net_weight_g	249.606615575393	248	252	t
2319	572	2026-05-06 00:24:50.174465+00	fill_volume_ml	500.56458211966	495	505	t
2320	572	2026-05-05 23:43:54.542649+00	fill_volume_ml	497.763045188852	495	505	t
2321	573	2026-04-17 06:10:46.964167+00	viscosity_cp	976.956098646451	800	1200	t
2322	573	2026-04-17 08:28:25.317739+00	label_offset_mm	-0.355	-1.0	1.0	t
2323	573	2026-04-17 09:40:11.584457+00	fill_volume_ml	500.293119258483	495	505	t
2324	573	2026-04-17 08:19:58.470572+00	net_weight_g	250.565581884998	248	252	t
2325	573	2026-04-17 09:04:34.402365+00	label_offset_mm	0.668	-1.0	1.0	t
2326	573	2026-04-17 09:08:04.696702+00	net_weight_g	248.923315188534	248	252	t
2327	574	2026-05-02 16:46:58.916078+00	net_weight_g	248.599760813757	248	252	t
2328	574	2026-05-02 17:36:32.298671+00	viscosity_cp	829.045385350638	800	1200	t
2329	574	2026-05-02 15:51:08.680067+00	viscosity_cp	771.390516566855	800	1200	f
2330	574	2026-05-02 17:14:37.06658+00	fill_volume_ml	502.025588535304	495	505	t
2331	574	2026-05-02 15:40:28.313185+00	viscosity_cp	777.631023096316	800	1200	f
2332	575	2026-05-14 23:35:54.586836+00	viscosity_cp	1182.24156878556	800	1200	t
2333	575	2026-05-14 23:50:48.376752+00	cap_torque_nm	1.73949944579468	1.2	1.8	t
2334	575	2026-05-14 23:08:31.973109+00	net_weight_g	248.451460976887	248	252	t
2335	575	2026-05-14 23:12:16.963101+00	label_offset_mm	1.064	-1.0	1.0	f
2336	575	2026-05-15 00:01:40.715503+00	cap_torque_nm	1.61950385718675	1.2	1.8	t
2337	575	2026-05-14 23:01:15.738826+00	cap_torque_nm	1.59417203686637	1.2	1.8	t
2338	576	2026-03-27 07:20:10.091502+00	label_offset_mm	0.660	-1.0	1.0	t
2339	576	2026-03-27 06:40:39.51591+00	fill_volume_ml	496.295038664192	495	505	t
2340	576	2026-03-27 06:25:35.500664+00	viscosity_cp	1191.46039568695	800	1200	t
2341	577	2026-04-24 14:45:35.681797+00	fill_volume_ml	498.175695849212	495	505	t
2342	577	2026-04-24 14:16:30.600021+00	label_offset_mm	0.357	-1.0	1.0	t
2343	577	2026-04-24 14:43:34.914255+00	viscosity_cp	1060.14601318072	800	1200	t
2344	577	2026-04-24 14:23:59.11611+00	label_offset_mm	0.758	-1.0	1.0	t
2345	577	2026-04-24 14:16:42.957564+00	net_weight_g	251.320805418767	248	252	t
2346	578	2026-03-31 23:38:57.74619+00	label_offset_mm	-0.932	-1.0	1.0	t
2347	578	2026-03-31 22:45:17.793912+00	label_offset_mm	-1.171	-1.0	1.0	f
2348	578	2026-04-01 00:45:47.907984+00	fill_volume_ml	499.919781553902	495	505	t
2349	578	2026-03-31 23:47:40.219588+00	label_offset_mm	-0.737	-1.0	1.0	t
2350	578	2026-04-01 00:12:40.481901+00	fill_volume_ml	499.505541295386	495	505	t
2351	578	2026-03-31 22:57:39.535044+00	viscosity_cp	1195.75249882574	800	1200	t
2352	579	2026-04-23 12:43:37.438657+00	net_weight_g	249.402473513094	248	252	t
2353	579	2026-04-23 10:45:13.964767+00	net_weight_g	248.421257729105	248	252	t
2354	579	2026-04-23 10:35:12.316891+00	viscosity_cp	1188.43525762455	800	1200	t
2355	579	2026-04-23 07:00:08.9841+00	viscosity_cp	880.247398874799	800	1200	t
2356	579	2026-04-23 11:45:06.807713+00	net_weight_g	251.06523004833	248	252	t
2357	580	2026-04-12 15:23:30.564081+00	net_weight_g	248.226265493225	248	252	t
2358	580	2026-04-12 14:10:05.286167+00	label_offset_mm	-1.095	-1.0	1.0	f
2359	580	2026-04-12 14:19:35.462949+00	label_offset_mm	-1.181	-1.0	1.0	f
2360	580	2026-04-12 14:48:06.34741+00	viscosity_cp	822.610680026541	800	1200	t
2361	580	2026-04-12 14:19:12.34644+00	fill_volume_ml	499.072148024091	495	505	t
2362	580	2026-04-12 15:31:42.792425+00	cap_torque_nm	1.28708347589003	1.2	1.8	t
2363	581	2026-05-11 23:36:31.394895+00	fill_volume_ml	499.781210764734	495	505	t
2364	581	2026-05-12 00:05:27.184035+00	cap_torque_nm	1.482004530321	1.2	1.8	t
2365	581	2026-05-11 23:35:50.324324+00	fill_volume_ml	500.570076181832	495	505	t
2366	582	2026-04-02 08:45:24.792125+00	cap_torque_nm	1.25460762927981	1.2	1.8	t
2367	582	2026-04-02 10:49:55.730076+00	viscosity_cp	932.344707995581	800	1200	t
2368	582	2026-04-02 10:30:52.613229+00	fill_volume_ml	501.239891920095	495	505	t
2369	582	2026-04-02 12:06:05.508992+00	net_weight_g	249.27790887784	248	252	t
2370	582	2026-04-02 11:02:59.614371+00	net_weight_g	248.105365613791	248	252	t
2371	583	2026-04-08 14:38:08.077251+00	label_offset_mm	-0.662	-1.0	1.0	t
2372	583	2026-04-08 14:20:43.358555+00	net_weight_g	251.350690869628	248	252	t
2373	584	2026-04-06 00:53:05.026471+00	viscosity_cp	760.326752170562	800	1200	f
2374	584	2026-04-06 00:14:01.007838+00	net_weight_g	249.055303773232	248	252	t
2375	584	2026-04-06 00:53:19.331423+00	cap_torque_nm	1.33973106085157	1.2	1.8	t
2376	584	2026-04-05 22:37:04.091462+00	net_weight_g	251.506235451175	248	252	t
2377	585	2026-05-03 08:25:12.275833+00	viscosity_cp	973.73611447802	800	1200	t
2378	585	2026-05-03 06:47:54.895399+00	label_offset_mm	-0.143	-1.0	1.0	t
2379	585	2026-05-03 07:17:44.02997+00	label_offset_mm	0.003	-1.0	1.0	t
2380	585	2026-05-03 07:24:28.013038+00	fill_volume_ml	498.859112771654	495	505	t
2381	585	2026-05-03 07:01:40.129954+00	label_offset_mm	-1.117	-1.0	1.0	f
2382	585	2026-05-03 07:18:45.061472+00	cap_torque_nm	1.26327485428479	1.2	1.8	t
2383	586	2026-04-22 15:23:17.616148+00	cap_torque_nm	1.5012842179392	1.2	1.8	t
2384	586	2026-04-22 16:14:45.217569+00	cap_torque_nm	1.57687381163159	1.2	1.8	t
2385	586	2026-04-22 14:08:34.164869+00	net_weight_g	248.018717435854	248	252	t
2386	587	2026-05-03 01:22:20.916756+00	net_weight_g	250.059185010459	248	252	t
2387	587	2026-05-03 02:01:52.222963+00	net_weight_g	248.974084829981	248	252	t
2388	587	2026-05-03 00:15:33.485628+00	label_offset_mm	-0.984	-1.0	1.0	t
2389	587	2026-05-02 22:47:30.920608+00	label_offset_mm	0.506	-1.0	1.0	t
2390	588	2026-04-01 06:13:58.000479+00	viscosity_cp	771.327406099381	800	1200	f
2391	588	2026-04-01 06:37:25.624592+00	net_weight_g	251.44516641988	248	252	t
2392	588	2026-04-01 07:33:27.320664+00	net_weight_g	249.949764569534	248	252	t
2393	588	2026-04-01 07:16:39.833037+00	net_weight_g	248.377675334685	248	252	t
2394	588	2026-04-01 07:26:17.148427+00	net_weight_g	248.892986946826	248	252	t
2395	588	2026-04-01 07:04:41.299262+00	net_weight_g	251.904755673058	248	252	t
2396	589	2026-03-22 14:29:26.135282+00	cap_torque_nm	1.27705000241081	1.2	1.8	t
2397	589	2026-03-22 19:08:08.239111+00	net_weight_g	248.5180100575	248	252	t
2398	589	2026-03-22 14:58:06.755163+00	cap_torque_nm	1.28741624094611	1.2	1.8	t
2399	589	2026-03-22 17:35:08.424549+00	cap_torque_nm	1.53189695100911	1.2	1.8	t
2400	589	2026-03-22 15:14:39.652739+00	cap_torque_nm	1.54892361605319	1.2	1.8	t
2401	589	2026-03-22 20:15:20.512602+00	net_weight_g	248.442723556435	248	252	t
2402	590	2026-04-29 00:15:43.890828+00	net_weight_g	250.710779538477	248	252	t
2403	590	2026-04-29 01:59:36.517194+00	net_weight_g	251.129432806769	248	252	t
2404	590	2026-04-29 01:44:03.902483+00	label_offset_mm	-0.458	-1.0	1.0	t
2405	591	2026-04-17 09:54:11.887805+00	label_offset_mm	-0.220	-1.0	1.0	t
2406	591	2026-04-17 07:54:55.397766+00	net_weight_g	248.184175489638	248	252	t
2407	591	2026-04-17 07:24:32.139385+00	cap_torque_nm	1.63575781161272	1.2	1.8	t
2408	591	2026-04-17 08:54:35.385912+00	viscosity_cp	908.487557192511	800	1200	t
2409	591	2026-04-17 08:45:13.045857+00	cap_torque_nm	1.31826637258822	1.2	1.8	t
2410	592	2026-05-02 15:22:35.421487+00	net_weight_g	248.232923930979	248	252	t
2411	592	2026-05-02 16:10:55.495389+00	net_weight_g	248.99932421195	248	252	t
2412	592	2026-05-02 14:41:32.401763+00	fill_volume_ml	500.88869403576	495	505	t
2413	592	2026-05-02 15:57:30.136639+00	viscosity_cp	1161.83015177222	800	1200	t
2414	592	2026-05-02 17:40:59.975298+00	viscosity_cp	866.35194781361	800	1200	t
2415	593	2026-04-16 23:54:47.032896+00	viscosity_cp	899.087455923961	800	1200	t
2416	593	2026-04-16 22:20:17.104173+00	net_weight_g	248.861708203456	248	252	t
2417	593	2026-04-16 23:22:52.966629+00	cap_torque_nm	1.51856573312426	1.2	1.8	t
2418	593	2026-04-16 23:58:44.515736+00	viscosity_cp	1032.07139155068	800	1200	t
2419	593	2026-04-16 22:46:03.990535+00	cap_torque_nm	1.45305733211847	1.2	1.8	t
2420	593	2026-04-16 23:04:33.658508+00	viscosity_cp	1247.03801331572	800	1200	f
2421	594	2026-04-09 06:13:42.384439+00	viscosity_cp	794.935926622612	800	1200	f
2422	594	2026-04-09 06:52:19.873971+00	viscosity_cp	955.68307670075	800	1200	t
2423	594	2026-04-09 11:26:37.700249+00	viscosity_cp	1032.9993917302	800	1200	t
2424	594	2026-04-09 09:48:28.683289+00	net_weight_g	248.346636253106	248	252	t
2425	594	2026-04-09 11:04:37.173161+00	cap_torque_nm	1.37986542739904	1.2	1.8	t
2426	595	2026-04-17 15:18:50.209215+00	fill_volume_ml	502.67850726183	495	505	t
2427	595	2026-04-17 17:21:11.206598+00	fill_volume_ml	500.535236114486	495	505	t
2428	595	2026-04-17 19:03:02.271139+00	net_weight_g	250.745432859594	248	252	t
2429	596	2026-04-16 23:49:38.785643+00	viscosity_cp	926.422758338477	800	1200	t
2430	596	2026-04-17 00:12:52.142316+00	fill_volume_ml	503.449425076598	495	505	t
2431	596	2026-04-17 01:09:03.894103+00	label_offset_mm	0.814	-1.0	1.0	t
2432	596	2026-04-16 23:50:24.131043+00	net_weight_g	251.984475254712	248	252	t
2433	596	2026-04-17 01:47:50.183306+00	fill_volume_ml	500.976322174205	495	505	t
2434	596	2026-04-17 01:43:15.514455+00	label_offset_mm	-0.181	-1.0	1.0	t
2435	597	2026-04-21 08:56:01.29183+00	net_weight_g	249.201827317685	248	252	t
2436	597	2026-04-21 09:09:27.238854+00	cap_torque_nm	1.61244848891604	1.2	1.8	t
2437	597	2026-04-21 07:17:20.960986+00	cap_torque_nm	1.36911117790243	1.2	1.8	t
2438	597	2026-04-21 09:49:38.13869+00	label_offset_mm	0.058	-1.0	1.0	t
2439	598	2026-04-16 16:23:08.985749+00	fill_volume_ml	498.059041890406	495	505	t
2440	598	2026-04-16 15:30:30.172181+00	fill_volume_ml	497.930230608124	495	505	t
2441	598	2026-04-16 14:37:10.344387+00	cap_torque_nm	1.50876933207665	1.2	1.8	t
2442	598	2026-04-16 15:30:41.289291+00	label_offset_mm	-0.976	-1.0	1.0	t
2443	598	2026-04-16 15:46:18.241289+00	cap_torque_nm	1.25542302700114	1.2	1.8	t
2444	599	2026-03-30 23:22:30.850347+00	label_offset_mm	0.360	-1.0	1.0	t
2445	599	2026-03-30 22:22:05.91121+00	fill_volume_ml	503.704820031853	495	505	t
2446	599	2026-03-30 23:09:53.879454+00	viscosity_cp	806.266464115208	800	1200	t
2447	600	2026-03-30 11:47:38.120074+00	label_offset_mm	0.124	-1.0	1.0	t
2448	600	2026-03-30 10:23:43.579096+00	viscosity_cp	1082.62061783784	800	1200	t
2449	600	2026-03-30 09:13:07.368744+00	fill_volume_ml	499.512490976688	495	505	t
2450	600	2026-03-30 07:19:56.518874+00	net_weight_g	248.473237756003	248	252	t
2451	600	2026-03-30 07:29:19.334328+00	fill_volume_ml	499.892462311676	495	505	t
2452	600	2026-03-30 06:58:44.120735+00	label_offset_mm	-0.590	-1.0	1.0	t
\.


--
-- Name: deviations_deviation_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.deviations_deviation_id_seq', 643, true);


--
-- Name: equipment_equipment_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.equipment_equipment_id_seq', 10, true);


--
-- Name: operators_operator_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.operators_operator_id_seq', 8, true);


--
-- Name: production_runs_run_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.production_runs_run_id_seq', 600, true);


--
-- Name: quality_checks_check_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.quality_checks_check_id_seq', 2452, true);


--
-- Name: deviations deviations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deviations
    ADD CONSTRAINT deviations_pkey PRIMARY KEY (deviation_id);


--
-- Name: equipment equipment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment
    ADD CONSTRAINT equipment_pkey PRIMARY KEY (equipment_id);


--
-- Name: operators operators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operators
    ADD CONSTRAINT operators_pkey PRIMARY KEY (operator_id);


--
-- Name: production_runs production_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_runs
    ADD CONSTRAINT production_runs_pkey PRIMARY KEY (run_id);


--
-- Name: quality_checks quality_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quality_checks
    ADD CONSTRAINT quality_checks_pkey PRIMARY KEY (check_id);


--
-- Name: deviations deviations_equipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deviations
    ADD CONSTRAINT deviations_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.equipment(equipment_id);


--
-- Name: deviations deviations_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deviations
    ADD CONSTRAINT deviations_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.production_runs(run_id);


--
-- Name: production_runs production_runs_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_runs
    ADD CONSTRAINT production_runs_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.operators(operator_id);


--
-- Name: quality_checks quality_checks_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quality_checks
    ADD CONSTRAINT quality_checks_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.production_runs(run_id);


--
-- PostgreSQL database dump complete
--

\unrestrict yA7vm1Co60HWvKbtg8t82QaCazqZgHnGOh0hAr72LKsYg3WT4nEecQg7w3dPKoS

