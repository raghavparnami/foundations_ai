import { Link, Outlet, useLocation } from "react-router";
import HistoryList from "../components/HistoryList";
import { useSidebarCollapsed } from "../lib/ui_state";
import { useTheme } from "../lib/theme";
import type { ThemeMode } from "../lib/theme";

type IconName =
  | "chat"
  | "wiki"
  | "connections"
  | "skills"
  | "catalog"
  | "memory"
  | "ledger"
  | "spend"
  | "roster";

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Converse", icon: "chat" },
  { href: "/roster", label: "Roster", icon: "roster" },
  { href: "/ledger", label: "Ledger", icon: "ledger" },
  { href: "/spend", label: "Spend", icon: "spend" },
  { href: "/wiki", label: "Wiki", icon: "wiki" },
  { href: "/connections", label: "Connections", icon: "connections" },
  { href: "/skills", label: "Skills", icon: "skills" },
  { href: "/memory", label: "Memory", icon: "memory" },
  { href: "/admin", label: "Catalog", icon: "catalog" },
];

export default function Layout() {
  const { collapsed, toggle } = useSidebarCollapsed();
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {collapsed ? (
        <CollapsedRail onExpand={toggle} />
      ) : (
        <ExpandedSidebar onCollapse={toggle} />
      )}
      <div className="flex-1 min-w-0 flex flex-col bg-[var(--bg)]">
        <Outlet />
      </div>
    </div>
  );
}

function CollapsedRail({ onExpand }: { onExpand: () => void }) {
  return (
    <nav
      aria-label="Sidebar (collapsed)"
      className="w-12 shrink-0 h-screen border-r border-[var(--border)] bg-[var(--bg-soft)] flex flex-col items-center py-3 gap-3"
    >
      <button
        type="button"
        onClick={onExpand}
        aria-label="Expand sidebar"
        title="Expand sidebar"
        className="rounded-md p-1.5 text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-elev)] transition"
      >
        <ChevronRight size={16} />
      </button>
      <div aria-hidden style={{ width: 22, height: 22, borderRadius: 6, background: "var(--gradient-hero)" }} />
      <ThemeToggle compact />
    </nav>
  );
}

function ExpandedSidebar({ onCollapse }: { onCollapse: () => void }) {
  const location = useLocation();
  const path = location.pathname;
  return (
    <nav
      aria-label="Sidebar"
      className="w-[220px] shrink-0 h-screen border-r border-[var(--border)] bg-[var(--bg-soft)] flex flex-col"
    >
      <div className="px-5 py-4 border-b border-[var(--border)] flex items-center gap-2.5">
        <BrandMark />
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-[var(--text)] leading-tight">
            Loom
          </div>
          <div className="text-[10px] text-[var(--text-faint)] leading-tight">
            tables, always preparing
          </div>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          className="rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-elev)] transition"
        >
          <ChevronLeft size={14} />
        </button>
      </div>
      <ul className="p-2 space-y-0.5">
        {NAV.map((n) => {
          const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
          return (
            <li key={n.href}>
              <Link
                to={n.href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] transition ${
                  active
                    ? "bg-[var(--bg-elev)] text-[var(--text)] border border-[var(--border)] shadow-sm font-medium"
                    : "text-[var(--text-muted)] hover:bg-[var(--bg-elev)]/60 hover:text-[var(--text)]"
                }`}
              >
                <Icon name={n.icon} active={active} />
                {n.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <HistoryList />
      <div className="p-3 border-t border-[var(--border)] flex items-center justify-between gap-2">
        <span className="text-[10px] text-[var(--text-faint)] font-mono">
          deepseek/v3.1 · v0.5
        </span>
        <ThemeToggle />
      </div>
    </nav>
  );
}

function ThemeToggle({ compact }: { compact?: boolean }) {
  const { mode, setMode } = useTheme();
  const ORDER: ThemeMode[] = ["auto", "light", "dark"];
  const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length] ?? "auto";
  const label =
    mode === "dark" ? "Dark" : mode === "light" ? "Light" : "Auto";
  return (
    <button
      type="button"
      onClick={() => setMode(next)}
      title={`Theme: ${label} (click for ${next})`}
      aria-label={`Theme: ${label}. Click to switch to ${next}.`}
      className={
        compact
          ? "rounded-md p-1.5 text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-elev)] transition"
          : "flex items-center gap-1.5 px-2 py-1 rounded-md text-[10.5px] uppercase tracking-wider font-medium text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-elev)] transition"
      }
    >
      <ThemeIcon mode={mode} size={compact ? 16 : 12} />
      {compact ? null : label}
    </button>
  );
}

function BrandMark() {
  return (
    <div
      aria-hidden
      style={{
        width: 26,
        height: 26,
        borderRadius: 8,
        background: "var(--gradient-hero)",
        boxShadow: "0 4px 12px -2px rgba(91,108,255,0.45)",
      }}
    />
  );
}

function ChevronLeft({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
function ChevronRight({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
function ThemeIcon({ mode, size = 14 }: { mode: ThemeMode; size?: number }) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (mode === "dark") {
    return (
      <svg {...props}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    );
  }
  if (mode === "light") {
    return (
      <svg {...props}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
    </svg>
  );
}

function Icon({ name, active }: { name: IconName; active: boolean }) {
  const stroke = active ? "var(--accent)" : "currentColor";
  const props = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke,
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "chat":
      return (
        <svg {...props}>
          <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      );
    case "wiki":
      return (
        <svg {...props}>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z" />
          <path d="M8 7h8" />
          <path d="M8 11h6" />
        </svg>
      );
    case "connections":
      return (
        <svg {...props}>
          <path d="M9 2v6" />
          <path d="M15 2v6" />
          <path d="M6 8h12v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4z" />
          <path d="M12 16v6" />
        </svg>
      );
    case "skills":
      return (
        <svg {...props}>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      );
    case "catalog":
      return (
        <svg {...props}>
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
          <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6" />
        </svg>
      );
    case "memory":
      return (
        <svg {...props}>
          <path d="M9.5 2A5.5 5.5 0 0 0 4 7.5v0a3.5 3.5 0 0 0-1 6.78V18a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-3.72A3.5 3.5 0 0 0 20 7.5v0A5.5 5.5 0 0 0 14.5 2h-5z" />
          <path d="M9 13h6" />
        </svg>
      );
    case "ledger":
      return (
        <svg {...props}>
          <path d="M4 4h12a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2z" />
          <path d="M8 8h6M8 12h6M8 16h4" />
        </svg>
      );
    case "spend":
      return (
        <svg {...props}>
          <path d="M12 1v22" />
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      );
    case "roster":
      return (
        <svg {...props}>
          <circle cx="9" cy="8" r="3" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M3 19a6 6 0 0 1 12 0" />
          <path d="M14.5 17a4 4 0 0 1 7 0" />
        </svg>
      );
  }
}
