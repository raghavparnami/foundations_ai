import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../lib/api";

export type ChartType = "bar" | "line" | "area";

export type ChartSpec = {
  type: ChartType;
  data: Record<string, string | number>[];
  xKey: string;
  yKey: string;
  title: string;
};

type ChartResponse = {
  chart?: { spec?: ChartSpec };
};

const ACCENT = "#5b6cff";
const ACCENT_SOFT = "#8a4dff";
const GRID = "#e7e9f1";
const AXIS = "#5b6075";
const TICK = "#9aa0b4";
const TOOLTIP_BG = "#ffffff";
const TOOLTIP_BORDER = "#d2d6e3";

function humanLabel(key: string): string {
  // line_id -> Line Id; deviation_rate_percent -> Deviation Rate Percent
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatTick(v: unknown): string {
  if (typeof v === "number") {
    if (Math.abs(v) >= 1000) return v.toLocaleString();
    if (Number.isInteger(v)) return String(v);
    return v.toFixed(1);
  }
  return String(v ?? "");
}

export default function ChartView({
  slug,
  fallbackSpec,
}: {
  slug: string;
  fallbackSpec?: ChartSpec;
}) {
  const [spec, setSpec] = useState<ChartSpec | null>(fallbackSpec ?? null);

  useEffect(() => {
    if (spec) return;
    let alive = true;
    async function load() {
      try {
        const j = await api.get<ChartResponse>(`/api/charts/${slug}`);
        if (!alive) return;
        setSpec(j.chart?.spec ?? null);
      } catch {
        /* swallow */
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [slug, spec]);

  if (!spec) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-4 text-[12px] text-[var(--text-faint)] shadow-sm">
        loading chart…
      </div>
    );
  }

  return (
    <figure className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-5 shadow-sm">
      <figcaption className="mb-4">
        <h3 className="text-[14px] font-semibold text-[var(--text)] leading-tight">
          {spec.title}
        </h3>
        <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
          {humanLabel(spec.yKey)} by {humanLabel(spec.xKey)}
        </p>
      </figcaption>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart(spec)}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

function renderChart(s: ChartSpec): ReactElement {
  const xLabel = humanLabel(s.xKey);
  const yLabel = humanLabel(s.yKey);
  const axisProps = {
    stroke: AXIS,
    tick: { fill: TICK, fontSize: 11 },
    axisLine: { stroke: GRID },
    tickLine: { stroke: GRID },
  };
  const tooltipProps = {
    contentStyle: {
      background: TOOLTIP_BG,
      border: `1px solid ${TOOLTIP_BORDER}`,
      borderRadius: 8,
      fontSize: 12,
      color: "#14152a",
      boxShadow: "0 4px 16px rgba(20, 21, 42, 0.08)",
      padding: "8px 10px",
    },
    cursor: { fill: "rgba(91, 108, 255, 0.08)" },
    formatter: (value: unknown) => [formatTick(value), yLabel] as [string, string],
  };
  const margin = { top: 24, right: 24, bottom: 36, left: 16 };

  switch (s.type) {
    case "line":
      return (
        <LineChart data={s.data} margin={margin}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey={s.xKey}
            {...axisProps}
            label={{
              value: xLabel,
              position: "insideBottom",
              offset: -16,
              fill: AXIS,
              fontSize: 11,
            }}
          />
          <YAxis
            {...axisProps}
            tickFormatter={formatTick}
            label={{
              value: yLabel,
              angle: -90,
              position: "insideLeft",
              offset: 0,
              fill: AXIS,
              fontSize: 11,
            }}
          />
          <Tooltip {...tooltipProps} />
          <Line
            type="monotone"
            dataKey={s.yKey}
            stroke={ACCENT}
            strokeWidth={2.5}
            dot={{ r: 3, fill: ACCENT, stroke: ACCENT }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      );
    case "area":
      return (
        <AreaChart data={s.data} margin={margin}>
          <defs>
            <linearGradient id="loom-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.45} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey={s.xKey}
            {...axisProps}
            label={{
              value: xLabel,
              position: "insideBottom",
              offset: -16,
              fill: AXIS,
              fontSize: 11,
            }}
          />
          <YAxis
            {...axisProps}
            tickFormatter={formatTick}
            label={{
              value: yLabel,
              angle: -90,
              position: "insideLeft",
              offset: 0,
              fill: AXIS,
              fontSize: 11,
            }}
          />
          <Tooltip {...tooltipProps} />
          <Area
            type="monotone"
            dataKey={s.yKey}
            stroke={ACCENT}
            strokeWidth={2}
            fill="url(#loom-area)"
          />
        </AreaChart>
      );
    case "bar":
    default:
      return (
        <BarChart data={s.data} margin={margin}>
          <defs>
            <linearGradient id="loom-bar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} />
              <stop offset="100%" stopColor={ACCENT_SOFT} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey={s.xKey}
            {...axisProps}
            interval={0}
            label={{
              value: xLabel,
              position: "insideBottom",
              offset: -16,
              fill: AXIS,
              fontSize: 11,
            }}
          />
          <YAxis
            {...axisProps}
            tickFormatter={formatTick}
            label={{
              value: yLabel,
              angle: -90,
              position: "insideLeft",
              offset: 0,
              fill: AXIS,
              fontSize: 11,
            }}
          />
          <Tooltip {...tooltipProps} />
          <Bar dataKey={s.yKey} fill="url(#loom-bar)" radius={[6, 6, 0, 0]} maxBarSize={56}>
            <LabelList
              dataKey={s.yKey}
              position="top"
              formatter={(v: unknown) => formatTick(v)}
              fill={AXIS}
              fontSize={11}
            />
          </Bar>
        </BarChart>
      );
  }
}
