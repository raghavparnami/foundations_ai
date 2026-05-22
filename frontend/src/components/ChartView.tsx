import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
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
import { useTheme } from "../lib/theme";

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

type Palette = {
  ACCENT: string;
  ACCENT_HI: string;
  GRID: string;
  AXIS: string;
  TICK: string;
  TOOLTIP_BG: string;
  TOOLTIP_BORDER: string;
  TOOLTIP_TEXT: string;
};

const LIGHT_PALETTE: Palette = {
  ACCENT: "#5b6cff",
  ACCENT_HI: "#8a4dff",
  GRID: "#eceef5",
  AXIS: "#5b6075",
  TICK: "#9aa0b4",
  TOOLTIP_BG: "#ffffff",
  TOOLTIP_BORDER: "#d2d6e3",
  TOOLTIP_TEXT: "#14152a",
};

const DARK_PALETTE: Palette = {
  ACCENT: "#8a93ff",
  ACCENT_HI: "#b07cff",
  GRID: "#2a2d3a",
  AXIS: "#9095a8",
  TICK: "#6b6f80",
  TOOLTIP_BG: "#161823",
  TOOLTIP_BORDER: "#3a3e50",
  TOOLTIP_TEXT: "#e8e9f0",
};

function humanLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function isPercentField(key: string): boolean {
  return /(percent|pct|rate|share|ratio)/i.test(key);
}

function formatValue(v: unknown, _key: string, isPct: boolean): string {
  if (typeof v !== "number" || Number.isNaN(v)) return String(v ?? "");
  if (isPct) {
    // If looks like 0..1 fraction, scale to %. Otherwise treat as already %.
    const pctVal = Math.abs(v) <= 1.5 ? v * 100 : v;
    return `${pctVal.toFixed(1)}%`;
  }
  if (Math.abs(v) >= 1000) return v.toLocaleString();
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(1);
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

  const summary = useMemo(() => buildSummary(spec), [spec]);
  const { resolved } = useTheme();
  const p: Palette = resolved === "dark" ? DARK_PALETTE : LIGHT_PALETTE;

  if (!spec) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-5 text-[12px] text-[var(--text-faint)] shadow-sm">
        loading chart…
      </div>
    );
  }

  return (
    <figure className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-6 shadow-[0_2px_18px_rgba(20,21,42,0.04)]">
      <figcaption className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[15px] font-semibold text-[var(--text)] leading-tight">
            {spec.title}
          </h3>
          <p className="text-[11px] text-[var(--text-faint)] mt-1 font-medium uppercase tracking-wider">
            {humanLabel(spec.yKey)} by {humanLabel(spec.xKey)}
          </p>
        </div>
        {summary && (
          <div className="text-right shrink-0">
            <div
              className="text-[18px] font-semibold leading-none"
              style={{ color: p.ACCENT }}
            >
              {summary.maxLabel}
            </div>
            <div className="text-[10px] text-[var(--text-faint)] mt-1 uppercase tracking-wider">
              {summary.maxKey}
            </div>
          </div>
        )}
      </figcaption>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart(spec, p)}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

function buildSummary(
  spec: ChartSpec | null,
): { maxKey: string; maxLabel: string } | null {
  if (!spec || spec.data.length === 0) return null;
  const isPct = isPercentField(spec.yKey);
  let maxIdx = 0;
  let maxVal = -Infinity;
  for (let i = 0; i < spec.data.length; i++) {
    const row = spec.data[i];
    if (!row) continue;
    const raw = row[spec.yKey];
    const num = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(num) && num > maxVal) {
      maxVal = num;
      maxIdx = i;
    }
  }
  if (!Number.isFinite(maxVal)) return null;
  const peakRow = spec.data[maxIdx];
  const peakKey = peakRow ? String(peakRow[spec.xKey] ?? "") : "";
  return {
    maxKey: peakKey ? `peak · ${peakKey}` : "peak",
    maxLabel: formatValue(maxVal, spec.yKey, isPct),
  };
}

function renderChart(s: ChartSpec, p: Palette): ReactElement {
  const xLabel = humanLabel(s.xKey);
  const yLabel = humanLabel(s.yKey);
  const isPct = isPercentField(s.yKey);
  const { ACCENT, ACCENT_HI, GRID, AXIS, TICK, TOOLTIP_BG, TOOLTIP_BORDER, TOOLTIP_TEXT } = p;

  // Auto-rotate x-axis labels when there are many bars or the labels are
  // long. Without rotation Recharts overlaps them on top of each other.
  const xValues = s.data.map((r) => String(r[s.xKey] ?? ""));
  const maxLen = xValues.reduce((m, v) => Math.max(m, v.length), 0);
  const longLabels = maxLen > 10 || s.data.length > 6;
  const truncate18 = (raw: unknown) => {
    const v = String(raw ?? "");
    return v.length > 18 ? v.slice(0, 17) + "…" : v;
  };

  const xAxisExtra = longLabels
    ? {
        angle: -35,
        textAnchor: "end" as const,
        height: 72,
        tickFormatter: truncate18,
        interval: 0,
      }
    : { interval: 0 };

  const axisProps = {
    stroke: AXIS,
    tick: { fill: TICK, fontSize: 11, fontWeight: 500 },
    axisLine: { stroke: GRID },
    tickLine: { stroke: GRID },
    tickMargin: 8,
  };

  const tooltipProps = {
    contentStyle: {
      background: TOOLTIP_BG,
      border: `1px solid ${TOOLTIP_BORDER}`,
      borderRadius: 10,
      fontSize: 12,
      color: TOOLTIP_TEXT,
      boxShadow: "0 6px 24px rgba(20, 21, 42, 0.10)",
      padding: "8px 12px",
    },
    cursor: { fill: "rgba(91, 108, 255, 0.06)" },
    formatter: (value: unknown) => [
      formatValue(value, s.yKey, isPct),
      yLabel,
    ] as [string, string],
  };

  const margin = {
    top: 28,
    right: 28,
    bottom: longLabels ? 84 : 44,
    left: 24,
  };

  // Find max for bar highlighting.
  let maxIdx = -1;
  let maxVal = -Infinity;
  s.data.forEach((row, i) => {
    const v = Number(row[s.yKey]);
    if (Number.isFinite(v) && v > maxVal) {
      maxVal = v;
      maxIdx = i;
    }
  });

  const yTickFormatter = (v: unknown) =>
    formatValue(v, s.yKey, isPct).replace(/\s+/, "");

  switch (s.type) {
    case "line":
      return (
        <LineChart data={s.data} margin={margin}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey={s.xKey}
            {...axisProps}
            {...xAxisExtra}
            label={{
              value: xLabel,
              position: "insideBottom",
              offset: longLabels ? -4 : -20,
              fill: AXIS,
              fontSize: 11,
              fontWeight: 500,
            }}
          />
          <YAxis
            {...axisProps}
            tickFormatter={yTickFormatter}
            label={{
              value: yLabel,
              angle: -90,
              position: "insideLeft",
              offset: -4,
              fill: AXIS,
              fontSize: 11,
              fontWeight: 500,
            }}
          />
          <Tooltip {...tooltipProps} />
          <Line
            type="monotone"
            dataKey={s.yKey}
            stroke={ACCENT}
            strokeWidth={2.5}
            dot={{ r: 3, fill: ACCENT, stroke: ACCENT }}
            activeDot={{ r: 6, stroke: ACCENT_HI, strokeWidth: 2 }}
            animationDuration={600}
          />
        </LineChart>
      );

    case "area":
      return (
        <AreaChart data={s.data} margin={margin}>
          <defs>
            <linearGradient id="loom-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.55} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey={s.xKey}
            {...axisProps}
            {...xAxisExtra}
            label={{
              value: xLabel,
              position: "insideBottom",
              offset: longLabels ? -4 : -20,
              fill: AXIS,
              fontSize: 11,
              fontWeight: 500,
            }}
          />
          <YAxis
            {...axisProps}
            tickFormatter={yTickFormatter}
            label={{
              value: yLabel,
              angle: -90,
              position: "insideLeft",
              offset: -4,
              fill: AXIS,
              fontSize: 11,
              fontWeight: 500,
            }}
          />
          <Tooltip {...tooltipProps} />
          <Area
            type="monotone"
            dataKey={s.yKey}
            stroke={ACCENT}
            strokeWidth={2.5}
            fill="url(#loom-area)"
            animationDuration={600}
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
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0.85} />
            </linearGradient>
            <linearGradient id="loom-bar-hi" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT_HI} />
              <stop offset="100%" stopColor={ACCENT} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey={s.xKey}
            {...axisProps}
            {...xAxisExtra}
            label={{
              value: xLabel,
              position: "insideBottom",
              offset: longLabels ? -4 : -20,
              fill: AXIS,
              fontSize: 11,
              fontWeight: 500,
            }}
          />
          <YAxis
            {...axisProps}
            tickFormatter={yTickFormatter}
            label={{
              value: yLabel,
              angle: -90,
              position: "insideLeft",
              offset: -4,
              fill: AXIS,
              fontSize: 11,
              fontWeight: 500,
            }}
          />
          <Tooltip {...tooltipProps} />
          <Bar
            dataKey={s.yKey}
            radius={[8, 8, 0, 0]}
            maxBarSize={64}
            animationDuration={650}
          >
            {s.data.map((_, i) => (
              <Cell
                key={i}
                fill={i === maxIdx ? "url(#loom-bar-hi)" : "url(#loom-bar)"}
                stroke={i === maxIdx ? ACCENT_HI : "transparent"}
                strokeWidth={i === maxIdx ? 1 : 0}
              />
            ))}
            <LabelList
              dataKey={s.yKey}
              position="top"
              formatter={(v: unknown) => formatValue(v, s.yKey, isPct)}
              fill={AXIS}
              fontSize={11}
              fontWeight={600}
            />
          </Bar>
          {/* Dim ref colour kept in case future series compare */}
          <defs>
            <linearGradient id="loom-bar-dim" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT_DIM} />
              <stop offset="100%" stopColor={ACCENT_DIM} stopOpacity={0.6} />
            </linearGradient>
          </defs>
        </BarChart>
      );
  }
}
