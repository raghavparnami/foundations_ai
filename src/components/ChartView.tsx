"use client";
import { useEffect, useRef, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
} from "recharts";

type ChartSpec = {
  type: "bar" | "line" | "pie" | "area";
  title: string;
  x_field: string;
  y_field: string;
  series_field?: string;
  data: Record<string, string | number>[];
};

const PALETTE = ["#5b6cff", "#8a4dff", "#d36cff", "#7c3aed", "#a78bfa", "#c084fc"];

export default function ChartView({ slug, fallbackSpec }: { slug: string; fallbackSpec?: ChartSpec }) {
  const [spec, setSpec] = useState<ChartSpec | null>(fallbackSpec ?? null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (spec) return;
    let alive = true;
    fetch(`/api/charts/${slug}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setSpec(j.chart?.spec ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [slug, spec]);

  if (!spec) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-4 text-[12px] text-[var(--text-faint)]">
        loading chart…
      </div>
    );
  }

  async function downloadPng() {
    if (!ref.current) return;
    const { toPng } = await import("html-to-image");
    const url = await toPng(ref.current, { pixelRatio: 2, backgroundColor: "#ffffff" });
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}.png`;
    a.click();
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-4 shadow-sm">
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-sm font-semibold text-[var(--text)]">{spec.title}</h3>
        <button
          onClick={downloadPng}
          className="text-[11px] px-2 py-1 rounded-md text-[var(--text-muted)] hover:text-[var(--accent)] border border-[var(--border)]"
        >
          ⤓ PNG
        </button>
      </div>
      <div ref={ref} className="bg-white">
        <ResponsiveContainer width="100%" height={260}>
          {renderChart(spec)}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function renderChart(s: ChartSpec): React.ReactElement {
  switch (s.type) {
    case "line":
      return (
        <LineChart data={s.data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="#eef0ff" strokeDasharray="3 3" />
          <XAxis dataKey={s.x_field} stroke="#9aa0b4" fontSize={11} />
          <YAxis stroke="#9aa0b4" fontSize={11} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey={s.y_field} stroke={PALETTE[0]} strokeWidth={2} dot={false} />
        </LineChart>
      );
    case "area":
      return (
        <AreaChart data={s.data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <defs>
            <linearGradient id="lg-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={PALETTE[0]} stopOpacity={0.4} />
              <stop offset="100%" stopColor={PALETTE[0]} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#eef0ff" strokeDasharray="3 3" />
          <XAxis dataKey={s.x_field} stroke="#9aa0b4" fontSize={11} />
          <YAxis stroke="#9aa0b4" fontSize={11} />
          <Tooltip />
          <Area type="monotone" dataKey={s.y_field} stroke={PALETTE[0]} fill="url(#lg-area)" />
        </AreaChart>
      );
    case "pie":
      return (
        <PieChart>
          <Pie
            data={s.data}
            dataKey={s.y_field}
            nameKey={s.x_field}
            cx="50%"
            cy="50%"
            outerRadius={90}
            label={(d) => String(d[s.x_field as keyof typeof d])}
          >
            {s.data.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]!} />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      );
    case "bar":
    default:
      return (
        <BarChart data={s.data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="#eef0ff" strokeDasharray="3 3" />
          <XAxis dataKey={s.x_field} stroke="#9aa0b4" fontSize={11} />
          <YAxis stroke="#9aa0b4" fontSize={11} />
          <Tooltip />
          <Bar dataKey={s.y_field} fill={PALETTE[0]} radius={[6, 6, 0, 0]} />
        </BarChart>
      );
  }
}
