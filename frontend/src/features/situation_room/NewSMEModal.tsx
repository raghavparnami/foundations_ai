/**
 * Modal for creating a new SME persona (teach-only mode).
 *
 * Fields:
 *   - id (slug, lowercase, unique)
 *   - name + role
 *   - icon picker (from the 6 inline SVGs we already ship)
 *   - color preset (one of 6 brand pairs from the built-in roster)
 *   - domain tags (comma-separated, used by the keyword matcher)
 *
 * On save: POST /api/sme/personas. The card appears on next snapshot poll
 * with status 'watching · awaiting probe', ready to be taught.
 */
import { useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { SMEIcon } from "./icons";
import type { SMEIconName } from "./types";

const ICONS: SMEIconName[] = [
  "settings-cog",
  "broadcast",
  "target",
  "truck-delivery",
  "tool",
  "shield-check",
];

const COLOR_PRESETS: { bg: string; fg: string; label: string }[] = [
  { bg: "#EEEDFE", fg: "#534AB7", label: "Violet" },
  { bg: "#FAECE7", fg: "#993C1D", label: "Terracotta" },
  { bg: "#E1F5EE", fg: "#0F6E56", label: "Green" },
  { bg: "#E6F1FB", fg: "#185FA5", label: "Blue" },
  { bg: "#FBEAF0", fg: "#993556", label: "Rose" },
  { bg: "#F1EFE8", fg: "#5F5E5A", label: "Slate" },
];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

type Props = {
  onClose: () => void;
  onCreated: () => void;
};

export default function NewSMEModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [id, setId] = useState("");
  const [icon, setIcon] = useState<SMEIconName>("settings-cog");
  const [colorIdx, setColorIdx] = useState(0);
  const [domain, setDomain] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-fill id from name unless the user typed something custom.
  const [idTouched, setIdTouched] = useState(false);
  useEffect(() => {
    if (!idTouched) setId(slugify(name));
  }, [name, idTouched]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  async function submit() {
    const tags = domain
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);
    if (id.length < 2 || !name.trim() || !role.trim()) {
      setError("Name, role, and id are required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const color = COLOR_PRESETS[colorIdx]!;
      await api.post("/api/sme/personas", {
        id,
        name: name.trim(),
        role: role.trim(),
        icon,
        color_bg: color.bg,
        color_fg: color.fg,
        domain: tags,
      });
      onCreated();
      onClose();
    } catch (e) {
      const msg =
        e instanceof ApiError && e.status === 409
          ? `SME id '${id}' already exists`
          : (e as Error).message;
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const preview = COLOR_PRESETS[colorIdx]!;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="newsme-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[92%] max-w-lg rounded-2xl bg-[var(--color-background-primary)] p-6 shadow-[0_24px_60px_rgba(0,0,0,0.35)] flex flex-col gap-4"
        style={{ border: "0.5px solid var(--color-border-tertiary)" }}
      >
        <header className="flex items-start gap-3">
          <span
            aria-hidden
            className="inline-flex items-center justify-center rounded-full shrink-0"
            style={{ width: 36, height: 36, background: preview.bg, color: preview.fg }}
          >
            <SMEIcon name={icon} size={18} />
          </span>
          <div className="flex-1 min-w-0">
            <h2 id="newsme-title" className="text-[15px] font-medium text-[var(--text)]">
              Add a new SME
            </h2>
            <p className="text-[11.5px] text-[var(--text-muted)] mt-0.5">
              Teach-only. Starts in 'watching' until you teach it or bind a probe later.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text)] px-2 py-1"
          >
            Close
          </button>
        </header>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)]">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Logan"
              className="bg-[var(--bg-soft)] text-[13px] text-[var(--text)] outline-none rounded-md px-2.5 py-2"
              style={{ border: "0.5px solid var(--color-border-tertiary)" }}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)]">
            Role
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Logistics · ETA"
              className="bg-[var(--bg-soft)] text-[13px] text-[var(--text)] outline-none rounded-md px-2.5 py-2"
              style={{ border: "0.5px solid var(--color-border-tertiary)" }}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)]">
          ID slug
          <input
            value={id}
            onChange={(e) => {
              setIdTouched(true);
              setId(slugify(e.target.value));
            }}
            placeholder="logan"
            className="bg-[var(--bg-soft)] text-[13px] text-[var(--text)] outline-none rounded-md px-2.5 py-2 font-mono"
            style={{ border: "0.5px solid var(--color-border-tertiary)" }}
          />
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)]">
          Domain keywords (comma-separated)
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="logistics, eta, freight, customs"
            className="bg-[var(--bg-soft)] text-[13px] text-[var(--text)] outline-none rounded-md px-2.5 py-2"
            style={{ border: "0.5px solid var(--color-border-tertiary)" }}
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-[var(--text-muted)]">Icon</span>
          <div className="flex flex-wrap gap-1.5">
            {ICONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setIcon(n)}
                aria-pressed={icon === n}
                className="w-8 h-8 rounded-md inline-flex items-center justify-center transition"
                style={{
                  background: icon === n ? preview.bg : "var(--bg-soft)",
                  color: icon === n ? preview.fg : "var(--text-muted)",
                  border: `0.5px solid ${icon === n ? preview.fg : "var(--color-border-tertiary)"}`,
                }}
              >
                <SMEIcon name={n} size={14} />
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-[var(--text-muted)]">Color</span>
          <div className="flex flex-wrap gap-1.5">
            {COLOR_PRESETS.map((c, i) => (
              <button
                key={c.label}
                type="button"
                onClick={() => setColorIdx(i)}
                aria-pressed={colorIdx === i}
                title={c.label}
                className="w-8 h-8 rounded-md transition"
                style={{
                  background: c.bg,
                  border: `0.5px solid ${colorIdx === i ? c.fg : "var(--color-border-tertiary)"}`,
                  boxShadow: colorIdx === i ? `inset 0 0 0 2px ${c.fg}33` : undefined,
                }}
              />
            ))}
          </div>
        </div>

        {error && (
          <div className="text-[11.5px] text-red-500">{error}</div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] font-medium px-3 py-1.5 rounded-full bg-[var(--bg-soft)] text-[var(--text-muted)] hover:text-[var(--text)] transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || !name.trim() || !role.trim() || id.length < 2}
            className="text-[12px] font-medium px-4 py-1.5 rounded-full text-white disabled:opacity-40 transition"
            style={{ background: preview.fg }}
          >
            {submitting ? "Adding…" : "Add SME"}
          </button>
        </div>
      </div>
    </div>
  );
}
