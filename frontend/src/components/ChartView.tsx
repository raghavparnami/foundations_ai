import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
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

/**
 * Renders a chart spec fetched from `/api/charts/{slug}` using recharts.
 * Accepts an optional `fallbackSpec` for callers that already have the spec
 * client-side.
 */
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
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] p-4 text-[12px] text-[var(--text-faint)]">
        loading chart…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] p-4">
      <h3 className="text-sm font-semibold text-[var(--text)] mb-2">{spec.title}</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart(spec)}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const STROKE = "#a78bfa";
const GRID = "rgba(255,255,255,0.08)";
const AXIS = "rgba(255,255,255,0.5)";

function renderChart(s: ChartSpec): ReactElement {
  switch (s.type) {
    case "line":
      return (
        <LineChart data={s.data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey={s.xKey} stroke={AXIS} fontSize={11} />
          <YAxis stroke={AXIS} fontSize={11} />
          <Tooltip
            contentStyle={{
              background: "#111",
              border: "1px solid rgba(255,255,255,0.1)",
              fontSize: 11,
            }}
          />
          <Line
            type="monotone"
            dataKey={s.yKey}
            stroke={STROKE}
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      );
    case "area":
      return (
        <AreaChart data={s.data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <defs>
            <linearGradient id="loom-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={STROKE} stopOpacity={0.5} />
              <stop offset="100%" stopColor={STROKE} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey={s.xKey} stroke={AXIS} fontSize={11} />
          <YAxis stroke={AXIS} fontSize={11} />
          <Tooltip
            contentStyle={{
              background: "#111",
              border: "1px solid rgba(255,255,255,0.1)",
              fontSize: 11,
            }}
          />
          <Area
            type="monotone"
            dataKey={s.yKey}
            stroke={STROKE}
            fill="url(#loom-area)"
          />
        </AreaChart>
      );
    case "bar":
    default:
      return (
        <BarChart data={s.data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey={s.xKey} stroke={AXIS} fontSize={11} />
          <YAxis stroke={AXIS} fontSize={11} />
          <Tooltip
            contentStyle={{
              background: "#111",
              border: "1px solid rgba(255,255,255,0.1)",
              fontSize: 11,
            }}
          />
          <Bar dataKey={s.yKey} fill={STROKE} radius={[4, 4, 0, 0]} />
        </BarChart>
      );
  }
}
