import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Logo, Spinner, useTheme, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { iniciales, specLabel } from "../lib/format.js";
import { useLawyer } from "./LawyerContext.jsx";

/**
 * Layout del portal: barra lateral, topbar con el estado de acreditación y
 * banner cuando la verificación está en curso o fue rechazada.
 */
export default function Shell() {
  const { lawyer, loading, verified } = useLawyer();
  const { theme, toggle } = useTheme();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [nuevos, setNuevos] = useState(0);

  /* Pill de «por aceptar» en la navegación (overview §20.5) */
  useEffect(() => {
    let alive = true;
    api.lawyers.overview()
      .then((o) => { if (alive) setNuevos(o?.pending_acceptance || 0); })
      .catch(() => {});
    return () => { alive = false; };
  }, [location.pathname]);

  const salir = async () => {
    try { await api.auth.logout(); } catch { /* la sesión local ya se limpió */ }
    toast("Sesión cerrada", "info");
    navigate("/login");
  };

  const NAVS = [
    { to: "/", ico: "📋", n: "Panel", end: true },
    { to: "/requerimientos", ico: "⚖️", n: "Requerimientos", pill: nuevos || null },
    { to: "/honorarios", ico: "💰", n: "Honorarios" },
    { to: "/perfil", ico: "👤", n: "Mi perfil" },
  ];
  const especialidades = (lawyer?.specialties?.length ? lawyer.specialties : lawyer?.specialties_pending) || [];
  const rechazada = lawyer?.verification_status === "rejected";

  return (
    <div id="app">
      <aside>
        <div className="logo">
          <Logo variant="iso" height={38} />
          <div><b>Justiniano</b><small>ABOGADOS</small></div>
        </div>
        {NAVS.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav ${isActive ? "on" : ""}`}
            style={{ textDecoration: "none" }}>
            {n.ico} {n.n}
            {n.pill ? <span className="pill">{n.pill}</span> : null}
          </NavLink>
        ))}
        <div style={{ flex: 1 }} />
        <div className="nav" onClick={toggle}>{theme === "light" ? "🌙 Modo oscuro" : "☀️ Modo claro"}</div>
        <div className="nav" onClick={salir}>↩ Cerrar sesión</div>
      </aside>
      <main>
        {loading || !lawyer ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Spinner size={30} /></div>
        ) : (
          <>
            <div className="topbar">
              <span className={`badge ${verified ? "b-ok" : rechazada ? "b-bad" : "b-warn"}`}>
                {verified ? "● Acreditación verificada" : rechazada ? "● Acreditación rechazada" : "● Verificación en curso"}
              </span>
              {especialidades.length > 0 && <small>{especialidades.map(specLabel).join(" · ")}</small>}
              <div className="sp" />
              <div className="row">
                <div className="avatar">{iniciales(lawyer.name)}</div>
                <div>
                  <b style={{ fontSize: 14 }}>{lawyer.name}</b><br />
                  <small>Abogado revisor</small>
                </div>
              </div>
            </div>
            {!verified && !rechazada && (
              <div className="banner warn">⏳ <div>
                <b>Su acreditación está en verificación.</b> Ya puede explorar el portal y completar su perfil,
                pero no recibirá requerimientos ni podrá tomar casos de la bolsa hasta que validemos su documento
                de identidad y certificado de título (24–48 h hábiles).
              </div></div>
            )}
            {rechazada && (
              <div className="banner warn">⚠️ <div>
                <b>Su acreditación fue rechazada.</b> {lawyer.rejection_reason || ""} Puede volver a subir sus
                documentos desde «Mi perfil».
              </div></div>
            )}
            <Outlet />
          </>
        )}
      </main>
    </div>
  );
}
