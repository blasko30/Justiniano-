import React from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { Logo, ThemeToggle, Spinner, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { initials, planLabel, isFreePlan, errMsg, DISCLAIMER_GLOBAL } from "../lib/format.js";
import { UserProvider, useUser } from "./UserContext.jsx";

/* ── Piezas comunes ─────────────────────────────────────────────── */

export function PageHead({ title, sub, right }) {
  return (
    <div className="row wrap" style={{ justifyContent: "space-between", marginBottom: 20, gap: 12 }}>
      <div>
        <h1 style={{ fontSize: 26 }}>{title}</h1>
        {sub ? <p className="muted" style={{ marginTop: 4 }}>{sub}</p> : null}
      </div>
      <div className="row">{right || null}</div>
    </div>
  );
}

/** Cabecera / cuerpo / pie para el Modal compartido (piel del wireframe). */
export function MHead({ icon, title, sub }) {
  return (
    <div className="mhead">
      <div style={{ fontSize: 24 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <h2>{title}</h2>
        {sub ? <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>{sub}</p> : null}
      </div>
    </div>
  );
}
export const MBody = ({ children }) => <div className="mbody">{children}</div>;
export const MFoot = ({ children }) => <div className="mfoot">{children}</div>;

export function Loading({ pad = 60 }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: pad }}>
      <Spinner size={30} />
    </div>
  );
}

/* ── Topbar pública + marco de autenticación ────────────────────── */

export function PublicTopbar() {
  const navigate = useNavigate();
  return (
    <div className="topbar">
      <div className="logo" onClick={() => navigate("/")} title="Justiniano">
        <Logo variant="lock" height={34} />
      </div>
      <div className="spacer" />
      <div className="tb-actions">
        <ThemeToggle />
        <button className="btn ghost sm" onClick={() => navigate("/planes")}>Planes</button>
        <button className="btn ghost sm" onClick={() => navigate("/login")}>Iniciar sesión</button>
        <button className="btn primary sm" onClick={() => navigate("/signup")}>Crear cuenta</button>
      </div>
    </div>
  );
}

/** Tarjeta centrada de los pasos de autenticación, con indicador de progreso. */
export function AuthWrap({ step, children }) {
  return (
    <>
      <PublicTopbar />
      <main className="main fadein">
        <div className="narrow" style={{ paddingTop: 26 }}>
          {step !== undefined && (
            <div className="steps">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={`st ${i < step ? "done" : i === step ? "on" : ""}`} />
              ))}
            </div>
          )}
          <div className="card pad-lg">{children}</div>
          <p className="subtle center" style={{ marginTop: 16 }}>{DISCLAIMER_GLOBAL}</p>
        </div>
      </main>
    </>
  );
}

/* ── Shell privado: topbar + sidebar + rutas hijas ──────────────── */

const NAV = [
  { to: "/app", ico: "🏠", n: "Inicio", end: true },
  { to: "/app/agentes", ico: "🧑‍⚖️", n: "Agentes" },
  { to: "/app/consultas", ico: "💬", n: "Consultas" },
  { to: "/app/documentos", ico: "📄", n: "Documentos" },
  { to: "/app/revisiones", ico: "✅", n: "Revisiones" },
];
const NAV_BILL = [
  { to: "/app/planes", ico: "💳", n: "Planes" },
  { to: "/app/ajustes", ico: "⚙️", n: "Ajustes" },
];

function navActive(pathname, item) {
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(item.to + "/");
}

function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, usage } = useUser();
  const free = isFreePlan(user?.plan);
  const cons = usage?.consultations;
  const used = cons?.used ?? 0;
  const limit = cons?.limit; // null = ilimitado
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;

  return (
    <aside className="sidebar">
      <button
        className="btn primary block"
        style={{ marginBottom: 16, minHeight: 52, fontSize: 15.5, borderRadius: 14 }}
        onClick={() => navigate("/app/agentes")}
      >
        ＋ Nueva consulta
      </button>
      {NAV.map((n) => (
        <div key={n.to} className={`navitem ${navActive(location.pathname, n) ? "active" : ""}`} onClick={() => navigate(n.to)}>
          <span className="ico">{n.ico}</span>{n.n}
        </div>
      ))}
      <div className="navsec">Facturación</div>
      {NAV_BILL.map((n) => (
        <div key={n.to} className={`navitem ${navActive(location.pathname, n) ? "active" : ""}`} onClick={() => navigate(n.to)}>
          <span className="ico">{n.ico}</span>{n.n}
        </div>
      ))}
      <div className="card pad" style={{ marginTop: 18, background: "var(--bg-sunken)" }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
          <b style={{ fontSize: 12.5 }}>Consultas del mes</b>
          <span className={`badge ${free ? "free" : "pro"}`}>{planLabel(user?.plan)}</span>
        </div>
        {limit ? (
          <>
            <div className={`bar ${pct >= 100 ? "err" : pct > 66 ? "warn" : ""}`} style={{ maxWidth: "none", margin: "8px 0 6px" }}>
              <i style={{ width: `${pct}%` }} />
            </div>
            <div className="subtle">{used} de {limit} usadas</div>
            {free && (
              <button className="btn gold sm block" style={{ marginTop: 10 }} onClick={() => navigate("/app/planes")}>
                Ver planes
              </button>
            )}
          </>
        ) : (
          <div className="subtle">∞ consultas</div>
        )}
        <div className="divider" style={{ margin: "12px 0" }} />
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="subtle">Créditos de revisión</span>
          <b>{user?.credits ?? usage?.credits ?? 0}</b>
        </div>
      </div>
    </aside>
  );
}

function PrivateTopbar() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useUser();
  const free = isFreePlan(user?.plan);

  const logout = async () => {
    try { await api.auth.logout(); } catch (e) { void errMsg(e); }
    toast("Sesión cerrada", "info");
    navigate("/");
  };

  return (
    <div className="topbar">
      <div className="logo" onClick={() => navigate("/app")} title="Justiniano">
        <Logo variant="lock" height={34} />
      </div>
      <div className="spacer" />
      <div className="tb-actions">
        <ThemeToggle />
        <button className="iconbtn" title="Ajustes" onClick={() => navigate("/app/ajustes")}>⚙️</button>
        <button className="iconbtn" title="Cerrar sesión" onClick={logout}>↩</button>
        <div className="row" style={{ gap: 8, cursor: "pointer" }} onClick={() => navigate("/app/ajustes")}>
          <div style={{
            width: 30, height: 30, borderRadius: "50%", background: "var(--brand-600)", color: "#fff",
            display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700,
          }}>
            {initials(user?.name)}
          </div>
          <span className={`badge ${free ? "free" : "pro"}`}>{planLabel(user?.plan)}</span>
        </div>
      </div>
    </div>
  );
}

/** Layout privado. Las pantallas hijas se renderizan en <Outlet/>. */
export default function Shell() {
  return (
    <UserProvider>
      <PrivateTopbar />
      <div className="appwrap">
        <Sidebar />
        <main className="main">
          <div className="container fadein">
            <Outlet />
          </div>
        </main>
      </div>
    </UserProvider>
  );
}

/** Variante sin container (para el chat, que ocupa toda la altura). */
export function ShellBare() {
  return (
    <UserProvider>
      <PrivateTopbar />
      <div className="appwrap">
        <Sidebar />
        <main className="chatpage">
          <Outlet />
        </main>
      </div>
    </UserProvider>
  );
}
