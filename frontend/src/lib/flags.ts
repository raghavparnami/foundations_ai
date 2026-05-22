/**
 * Tiny feature-flag hook.
 *
 * Resolution order (first non-undefined wins):
 *   1. localStorage["flag.<name>"] === "1"  — dev-time toggle, no rebuild
 *   2. window.__LOOM_FLAGS__[name] === true — runtime injection (same
 *      pattern as window.__LOOM_API_BASE__ in api.ts); set by an inline
 *      script in index.html if/when we wire Railway env-var pass-through.
 *   3. default false
 *
 * Toggle in devtools:
 *   localStorage.setItem("flag.situation_room_enabled", "1"); location.reload();
 */
import { useSyncExternalStore } from "react";

declare global {
  interface Window {
    __LOOM_FLAGS__?: Record<string, boolean>;
  }
}

export type FlagName = "situation_room_enabled";

function readFlag(name: FlagName): boolean {
  if (typeof window === "undefined") return false;
  try {
    const ls = window.localStorage.getItem(`flag.${name}`);
    if (ls === "1") return true;
    if (ls === "0") return false;
  } catch {
    /* private mode etc — ignore */
  }
  return window.__LOOM_FLAGS__?.[name] === true;
}

// Subscribe to storage events from other tabs so toggles propagate.
function subscribe(cb: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key && e.key.startsWith("flag.")) cb();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

export function useFlag(name: FlagName): boolean {
  return useSyncExternalStore(
    subscribe,
    () => readFlag(name),
    () => false, // SSR snapshot — flag off
  );
}
