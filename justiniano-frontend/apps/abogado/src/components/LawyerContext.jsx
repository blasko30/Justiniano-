import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";

/**
 * Perfil del abogado autenticado (GET /lawyers/me), compartido por el shell y
 * las pantallas. `verified` refleja verification_status === "verified".
 */
const LawyerCtx = createContext({ lawyer: null, loading: true, verified: false, refresh: () => {} });

export function LawyerProvider({ children }) {
  const [lawyer, setLawyer] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.lawyers.me();
      setLawyer(me);
    } catch (e) {
      if (e?.status === 401 || e?.status === 403) {
        api.tokens.clear();
        window.location.hash = "#/login";
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const value = useMemo(
    () => ({ lawyer, loading, verified: lawyer?.verification_status === "verified", refresh }),
    [lawyer, loading, refresh],
  );
  return <LawyerCtx.Provider value={value}>{children}</LawyerCtx.Provider>;
}

export const useLawyer = () => useContext(LawyerCtx);
