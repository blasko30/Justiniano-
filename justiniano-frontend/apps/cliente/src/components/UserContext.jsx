import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";

/**
 * Perfil (GET /users/me) y consumo (GET /users/me/usage) compartidos por el
 * shell privado: topbar, sidebar (cuotas) y las pantallas que los necesiten.
 */
const Ctx = createContext({ user: null, usage: null, loading: true, refreshUser: () => {}, refreshUsage: () => {} });

export function UserProvider({ children }) {
  const [user, setUser] = useState(null);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try { setUser(await api.users.me()); } catch { /* el guard redirige si la sesión expiró */ }
  }, []);

  const refreshUsage = useCallback(async () => {
    try { setUsage(await api.users.usage()); } catch { /* silencioso */ }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [u, us] = await Promise.allSettled([api.users.me(), api.users.usage()]);
        if (!alive) return;
        if (u.status === "fulfilled") setUser(u.value);
        if (us.status === "fulfilled") setUsage(us.value);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const value = useMemo(
    () => ({ user, usage, loading, refreshUser, refreshUsage, setUser }),
    [user, usage, loading, refreshUser, refreshUsage],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useUser = () => useContext(Ctx);
