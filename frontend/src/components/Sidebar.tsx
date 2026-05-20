import { useEffect, useState } from "react";
import { NavLink } from "react-router";
import { api } from "../lib/api";
import HistoryList from "./HistoryList";
import ProjectPicker from "./ProjectPicker";

type IconName =
  | "chat"
  | "wiki"
  | "skills"
  | "memory"
  | "projects"
  | "admin"
  | "connections";

type NavItem = { to: string; label: string; icon: IconName; end?: boolean };

const NAV: NavItem[] = [
  { to: "/chat",        label: "Chat",        icon: "chat" },
  { to: "/wiki",        label: "Wiki",        icon: "wiki" },
  { to: "/skills",      label: "Skills",      icon: "skills" },
  { to: "/memory",      label: "Memory",      icon: "memory" },
  { to: "/projects",    label: "Projects",    icon: "projects" },
  { to: "/admin",       label: "Admin",       icon: "admin" },
  { to: "/connections", label: "Connections", icon: "connections" },
];

type LlmInfo = {
  provider?: string;
  model?: string;
  version?: string;
};

/**
 * Richer alternative sidebar — Chat / Wiki / Skills / Memory / Projects /
 * Admin / Connections, plus the conversation history list and a footer with
 * the active model. Mounted by the caller (does NOT replace Layout.tsx).
 */
export default function Sidebar() {
  const [info, setInfo] = useState<LlmInfo | null>(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const j = await api.get<LlmInfo>("/api/llm/info");
        if (!alive) return;
        setInfo(j);
      } catch {
        /* swallow */
      }
    }
    void tick();
  }, []);

  const footer = info
    ? `${info.provider ?? "model"} · ${info.model ?? ""}`.trim()
    : "loom";

  return (
    <nav className="w-[220px] shrink-0 h-screen border-r border-[var(--border)] bg-[var(--bg-soft)] flex flex-col">
      <div className="px-5 py-4 border-b border-[var(--border)] flex items-center gap-2.5">
        <BrandMark />
        <div>
          <div className="text-[14px] font-semibold text-[var(--text)] leading-tight">
            Loom
          </div>
          <div className="text-[10px] text-[var(--text-faint)] leading-tight">
            tables, always preparing
          </div>
        </div>
      </div>

      <ProjectPicker />

      <ul className="p-2 space-y-0.5">
        {NAV.map((n) => (
          <li key={n.to}>
            <NavLink
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] transition ${
                  isActive
                    ? "bg-[var(--bg-elev)] text-[var(--text)] border border-[var(--border)] font-medium"
                    : "text-[var(--text-muted)] hover:bg-[var(--bg-soft)] hover:text-[var(--text)]"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon name={n.icon} active={isActive} />
                  {n.label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>

      <HistoryList />

      <div className="p-3 border-t border-[var(--border)] text-[10px] text-[var(--text-faint)] font-mono truncate">
        {footer}
      </div>
    </nav>
  );
}

function BrandMark() {
  return (
    <div
      aria-hidden
      className="h-[26px] w-[26px] rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500"
    />
  );
}

function Icon({ name, active }: { name: IconName; active: boolean }) {
  const stroke = active ? "#fff" : "currentColor";
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
    case "skills":
      return (
        <svg {...props}>
          <path d="M12 2l3 6 6 .9-4.5 4.4 1 6.2L12 16.8 6.5 19.5l1-6.2L3 8.9 9 8z" />
        </svg>
      );
    case "memory":
      return (
        <svg {...props}>
          <path d="M9.5 2A5.5 5.5 0 0 0 4 7.5v0a3.5 3.5 0 0 0-1 6.78V18a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-3.72A3.5 3.5 0 0 0 20 7.5v0A5.5 5.5 0 0 0 14.5 2h-5z" />
          <path d="M9 13h6" />
        </svg>
      );
    case "projects":
      return (
        <svg {...props}>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      );
    case "admin":
      return (
        <svg {...props}>
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
          <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6" />
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
  }
}
