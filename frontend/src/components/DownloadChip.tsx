import { apiUrl } from "../lib/api";

export type DownloadKind = "report" | "presentation" | "chart";

type DownloadChipProps = {
  slug: string;
  kind: DownloadKind;
  title: string;
  bytes?: number;
};

/**
 * Pill linking to a downloadable artifact (report, deck, or chart). The
 * `slug` is folded into the standard route for the kind, e.g.
 * `/api/reports/{slug}/download`.
 */
export default function DownloadChip({
  slug,
  kind,
  title,
  bytes,
}: DownloadChipProps) {
  const href = hrefFor(kind, slug);
  const label =
    kind === "report"
      ? "Markdown report"
      : kind === "presentation"
        ? "PowerPoint deck"
        : "Chart";
  return (
    <a
      href={href}
      download
      className="inline-flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] px-4 py-2.5 hover:bg-[var(--bg-elev)] transition group"
    >
      <span className="text-[var(--text-muted)] shrink-0" aria-hidden>
        <KindIcon kind={kind} />
      </span>
      <span className="flex flex-col">
        <span className="text-[13px] font-medium text-[var(--text)]">{title}</span>
        <span className="text-[11px] text-[var(--text-faint)]">
          {label}
          {bytes ? ` · ${formatBytes(bytes)}` : ""}
        </span>
      </span>
      <span className="ml-2 text-[12px] text-[var(--text-faint)] group-hover:text-[var(--text)]">
        ⤓
      </span>
    </a>
  );
}

function hrefFor(kind: DownloadKind, slug: string): string {
  if (kind === "presentation") return apiUrl(`/api/presentations/${slug}/download`);
  if (kind === "chart") return apiUrl(`/api/charts/${slug}/download`);
  return apiUrl(`/api/reports/${slug}/download`);
}

function KindIcon({ kind }: { kind: DownloadKind }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (kind === "presentation") {
    return (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="12" rx="1" />
        <line x1="8" y1="20" x2="16" y2="20" />
        <line x1="12" y1="16" x2="12" y2="20" />
      </svg>
    );
  }
  if (kind === "chart") {
    return (
      <svg {...common}>
        <polyline points="3 17 9 11 13 15 21 7" />
        <polyline points="14 7 21 7 21 14" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
