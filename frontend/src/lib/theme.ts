/**
 * Theme manager: light / dark / auto (follows system preference).
 *
 * The resolved mode is applied as `data-theme="light|dark"` on
 * <html>; CSS overrides under `:root[data-theme="dark"]` paint the
 * dark palette. The preference is stored in localStorage under
 * "loom.theme"; default is "auto".
 *
 * Consumers:
 *   const { mode, resolved, setMode } = useTheme();
 *   mode      = "light" | "dark" | "auto"
 *   resolved  = "light" | "dark"  // what's actually painted
 *
 * Charts and any other JS that needs concrete color values should call
 * useTheme() and read CSS variables off `:root` via getComputedStyle.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export type ThemeMode = "light" | "dark" | "auto";
export type Resolved = "light" | "dark";

const KEY = "loom.theme";

function readMode(): ThemeMode {
  if (typeof window === "undefined") return "auto";
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "auto") return v;
  } catch {
    /* ignore */
  }
  return "auto";
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveMode(mode: ThemeMode): Resolved {
  if (mode === "auto") return systemPrefersDark() ? "dark" : "light";
  return mode;
}

function applyToRoot(resolved: Resolved): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.style.colorScheme = resolved;
}

// External store so multiple consumers see the same value without prop drilling.
const listeners = new Set<() => void>();
let currentMode: ThemeMode = readMode();

function notify(): void {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // Cross-tab sync
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      currentMode = readMode();
      cb();
    }
  };
  // System preference change (only matters when mode === "auto")
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onMq = () => cb();
  window.addEventListener("storage", onStorage);
  mq.addEventListener("change", onMq);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
    mq.removeEventListener("change", onMq);
  };
}

function getSnapshot(): ThemeMode {
  return currentMode;
}

export function useTheme(): {
  mode: ThemeMode;
  resolved: Resolved;
  setMode: (m: ThemeMode) => void;
} {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [resolved, setResolved] = useState<Resolved>(() => resolveMode(mode));

  useEffect(() => {
    const r = resolveMode(mode);
    setResolved(r);
    applyToRoot(r);
  }, [mode]);

  const setMode = useCallback((m: ThemeMode) => {
    try {
      window.localStorage.setItem(KEY, m);
    } catch {
      /* private mode */
    }
    currentMode = m;
    notify();
  }, []);

  return { mode, resolved, setMode };
}

/**
 * Call once at app boot to apply the persisted theme BEFORE React mounts —
 * prevents a flash of light theme on first paint when the user is on dark.
 */
export function initTheme(): void {
  const m = readMode();
  applyToRoot(resolveMode(m));
}
