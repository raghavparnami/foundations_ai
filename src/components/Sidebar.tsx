"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import HistoryList from "./HistoryList";

type IconName = "chat" | "wiki" | "connections" | "skills" | "catalog" | "memory";

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/",            label: "Chat",        icon: "chat" },
  { href: "/wiki",        label: "Wiki",        icon: "wiki" },
  { href: "/connections", label: "Connections", icon: "connections" },
  { href: "/skills",      label: "Skills",      icon: "skills" },
  { href: "/memory",      label: "Memory",      icon: "memory" },
  { href: "/admin",       label: "Catalog",     icon: "catalog" },
];

export default function Sidebar() {
  const path = usePathname();
  return (
    <nav className="w-[220px] shrink-0 h-screen border-r border-[var(--border)] bg-[var(--bg-soft)] flex flex-col">
      <div className="px-5 py-4 border-b border-[var(--border)] flex items-center gap-2.5">
        <BrandMark />
        <div>
          <div className="text-[14px] font-semibold text-[var(--text)] leading-tight">Loom</div>
          <div className="text-[10px] text-[var(--text-faint)] leading-tight">
            tables, always preparing
          </div>
        </div>
      </div>
      <ul className="p-2 space-y-0.5">
        {NAV.map((n) => {
          const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
          return (
            <li key={n.href}>
              <Link
                href={n.href}
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
      <div className="p-3 border-t border-[var(--border)] text-[10px] text-[var(--text-faint)] font-mono">
        deepseek/v3.1 · v0.1
      </div>
    </nav>
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
  }
}
