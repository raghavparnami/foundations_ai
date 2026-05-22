/**
 * Small persisted UI flags that survive reload (and cross-tab).
 *
 * Today: just the sidebar collapsed state. New flags drop into the same
 * pattern — one storage key per flag, one tiny hook each.
 */
import { useSyncExternalStore } from "react";

const KEY_SIDEBAR = "loom.sidebar_collapsed";

const listeners = new Map<string, Set<() => void>>();

function getListenerSet(key: string): Set<() => void> {
  let s = listeners.get(key);
  if (!s) {
    s = new Set();
    listeners.set(key, s);
  }
  return s;
}

function subscribeFor(key: string) {
  return (cb: () => void) => {
    const set = getListenerSet(key);
    set.add(cb);
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) cb();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      set.delete(cb);
      window.removeEventListener("storage", onStorage);
    };
  };
}

function notify(key: string): void {
  const set = listeners.get(key);
  if (set) for (const l of set) l();
}

function readBool(key: string, def: boolean): boolean {
  if (typeof window === "undefined") return def;
  try {
    const v = window.localStorage.getItem(key);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    /* ignore */
  }
  return def;
}

function writeBool(key: string, v: boolean): void {
  try {
    window.localStorage.setItem(key, v ? "1" : "0");
  } catch {
    /* ignore */
  }
  notify(key);
}

export function useSidebarCollapsed(): {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (v: boolean) => void;
} {
  const collapsed = useSyncExternalStore(
    subscribeFor(KEY_SIDEBAR),
    () => readBool(KEY_SIDEBAR, true), // default collapsed
    () => true,
  );
  return {
    collapsed,
    toggle: () => writeBool(KEY_SIDEBAR, !collapsed),
    setCollapsed: (v) => writeBool(KEY_SIDEBAR, v),
  };
}
