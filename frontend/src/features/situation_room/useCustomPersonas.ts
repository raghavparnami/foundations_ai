/**
 * Loads user-created SME personas from /api/sme/personas and merges them
 * with the built-in SME_ROSTER. Re-fetches when a mutation hint is bumped.
 *
 * The built-in 6 are authoritative; if a user creates a persona with the
 * same id as a built-in (shouldn't happen — backend enforces uniqueness)
 * the built-in wins.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { SME_ROSTER } from "./fixtures";
import type { SMEPersona, SMEIconName } from "./types";

type PersonaApi = {
  id: string;
  name: string;
  role: string;
  icon: string;
  color_bg: string;
  color_fg: string;
  domain: string[];
  enabled: boolean;
};

function fromApi(p: PersonaApi): SMEPersona {
  return {
    id: p.id,
    name: p.name,
    role: p.role,
    icon: (p.icon as SMEIconName) || "settings-cog",
    color: { bg: p.color_bg, fg: p.color_fg },
    domain: p.domain || [],
  };
}

export function useAllPersonas(): {
  personas: SMEPersona[];
  refresh: () => Promise<void>;
} {
  const [custom, setCustom] = useState<SMEPersona[]>([]);

  const refresh = useCallback(async () => {
    try {
      const list = await api.get<PersonaApi[]>("/api/sme/personas");
      setCustom(
        list
          .filter((p) => !SME_ROSTER.find((b) => b.id === p.id))
          .map(fromApi),
      );
    } catch {
      // backend offline → just show built-ins
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { personas: [...SME_ROSTER, ...custom], refresh };
}
