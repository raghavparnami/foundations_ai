"use client";
import { useEffect, useState } from "react";

const KEY = "loom.activeProject";
const ALL = "__all__";

type Listener = (slug: string) => void;
const listeners = new Set<Listener>();

function readSlug(): string {
  if (typeof window === "undefined") return ALL;
  try {
    return localStorage.getItem(KEY) ?? ALL;
  } catch {
    return ALL;
  }
}

export function useActiveProject(): [string, (slug: string) => void] {
  const [slug, setSlug] = useState<string>(ALL);

  useEffect(() => {
    setSlug(readSlug());
    const listener: Listener = (s) => setSlug(s);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  function set(s: string) {
    try {
      localStorage.setItem(KEY, s);
    } catch {
      /* swallow */
    }
    setSlug(s);
    for (const l of listeners) l(s);
  }

  return [slug, set];
}

export const ALL_PROJECTS = ALL;
