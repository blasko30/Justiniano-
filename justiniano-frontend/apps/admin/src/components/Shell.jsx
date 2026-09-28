/* Shell de la consola: sidebar con navegación por rol + topbar con período. */
import React, { createContext, useContext, useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useTheme } from "@justiniano/ui";
import { api } from "../api.js";
import { getSession, clearProfile } from "../lib/session.js";
import { PLABEL, PNAME, initials } from "../lib/format.js";

/* ── Período global (Mes / Trimestre / Año) ─────────────────────────── */
const PeriodCtx = createContext({ period: "mes", setPeriod: () => {} });
export const usePeriod = () => useContext(PeriodCtx);

export function PeriodProvider({ children }) {
  const [period, setPeriod] = useState("mes");
  const value = useMemo(() => ({ period, setPeriod }), [period]);
  return <PeriodCtx.Provider value={value}>{children}</PeriodCtx.Provider>;
}

const NAVS = [
  { to: "/dash", ico: "📊", n: "Dashboard", roles: ["admin"] },
  { to: "/planes", ico: "📦", n: "Planes", roles: ["admin"] },
  { to: "/operacion", ico: "🛠️", n: "Operación", roles: ["admin"] },
  { to: "/revisores", ico: "⚖️", n: "Revisores", roles: ["admin"] },
  { to: "/ventas", ico: "📈", n: "Ventas", roles: ["admin", "seller"] },
];

export default function Shell({ children }) {
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const { period, setPeriod } = usePeriod();
  const session = getSession() || { name: "—", cargo: "—", role: null };
  const navs = NAVS.filter((n) => n.roles.includes(session.role));

  const logout = async () => {
    try { await api.auth.logout(); } finally {
      clearProfile();
      navigate("/login", { replace: true });
    }
  };

  return (
    <div id="app">
      <aside>
        <div className="logo">
          <div className="iso">J</div>
          <div><b>Justiniano</b><small>ADMINISTRACIÓN</small></div>
        </div>
        {navs.map((n) => (
          <NavLink key={n.to} to={n.to}
            className={({ isActive }) => `nav ${isActive ? "on" : ""}`}
            style={{ textDecoration: "none" }}>
            {n.ico} {n.n}
          </NavLink>
        ))}
        <div style={{ flex: 1 }} />
        <div className="nav" onClick={toggle}>
          {theme === "light" ? "🌙 Modo oscuro" : "☀️ Modo claro"}
        </div>
        <div className="nav" onClick={logout}>↩ Cerrar sesión</div>
      </aside>
      <main>
        <div className="topbar">
          <div className="seg">
            {["mes", "tri", "ano"].map((p) => (
              <button key={p} className={period === p ? "on" : ""}
                onClick={() => setPeriod(p)}>{PNAME[p]}</button>
            ))}
          </div>
          <span className="small">
            Período: <b>{PLABEL[period]}</b> · comparado con el período anterior
          </span>
          <div className="sp" />
          <div className="row">
            <div className="avatar">{initials(session.name)}</div>
            <div>
              <b style={{ fontSize: 14 }}>{session.name}</b><br />
              <small>{session.cargo}</small>
            </div>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
