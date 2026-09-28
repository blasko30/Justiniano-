/* 3 · Operación: salud técnica de la plataforma + operación legal (§17). */
import React from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { usePeriod } from "../components/Shell.jsx";
import { useLoad } from "../lib/useLoad.js";
import { Loading, LoadError } from "../components/bits.jsx";
import { HBar } from "../components/charts.jsx";
import { NUM, PLABEL, PAPI, fmtDate } from "../lib/format.js";

const Big = ({ children, color }) => (
  <div style={{ fontFamily: "'Nunito'", fontSize: 24, fontWeight: 800, color }}>{children}</div>
);

export default function Ops() {
  const navigate = useNavigate();
  const { period } = usePeriod();
  const panel = useLoad(() => api.adminOps.panel({ period: PAPI[period] }), [period]);

  if (panel.loading) return <Loading />;
  if (panel.error) return <LoadError error={panel.error} onRetry={panel.reload} />;

  const { platform, legal_ops: ops } = panel.data;
  const rev = ops.reviews || {};
  const sh = ops.support_hours || {};
  const tickets = ops.tickets || {};
  const vol = ops.volume || {};
  const dot = (st) => (
    <span className="statusdot"
      style={{ background: st === "ok" ? "var(--ok)" : st === "degraded" ? "var(--warn)" : "var(--bad)" }} />
  );
  const fmtLat = (ms) => (ms == null ? "—" : ms >= 1000
    ? `${(ms / 1000).toLocaleString("es-CL", { maximumFractionDigits: 1 })} s` : `${ms} ms`);

  return (
    <>
      <h1>Operación</h1>
      <p className="small" style={{ marginBottom: 14 }}>
        Salud técnica de la plataforma + indicadores de la operación legal.
      </p>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Servicios de la plataforma</h2>
          {platform.status === "operational"
            ? <span className="badge b-ok">● Operativa</span>
            : <span className="badge b-warn">● Degradada</span>}
        </div>
        <table style={{ marginTop: 8 }}>
          <tbody>
            <tr>
              <th>Servicio</th><th>Estado</th><th>Uptime 30 d</th>
              <th>Latencia media</th><th>Nota</th>
            </tr>
            {(platform.services || []).map((s) => (
              <tr key={s.name}>
                <td><b>{s.label}</b></td>
                <td>{dot(s.status)}{s.status === "ok" ? "Operativo" : "Degradado"}</td>
                <td className="num">{s.uptime_30d_pct}%</td>
                <td className="num">{fmtLat(s.avg_latency_ms)}</td>
                <td><small>{s.note || "—"}</small></td>
              </tr>
            ))}
          </tbody>
        </table>
        <small style={{ display: "block", marginTop: 8 }}>
          {platform.last_incident
            ? <>Último incidente: {fmtDate(platform.last_incident.at)} — {platform.last_incident.summary}
              {platform.last_incident.resolved_at ? " (resuelto)" : " (en curso)"}</>
            : "Sin incidentes en los últimos 30 días."}
        </small>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 16 }}>
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>Revisiones de abogados</h2>
            <button className="btn ghost xs" onClick={() => navigate("/revisores")}>
              Gestionar revisores →
            </button>
          </div>
          <div className="kpis" style={{ marginTop: 10 }}>
            {[["En cola", NUM(rev.queue)], ["SLA cumplido", `${rev.sla_pct ?? "—"}%`],
              ["Tiempo medio", `${NUM(rev.avg_turnaround_hours)} h`],
              ["Abogados activos", NUM(rev.active_lawyers)]].map(([l, v]) => (
              <div key={l} className="card" style={{ padding: 12 }}>
                <small>{l}</small>
                <div style={{ fontFamily: "'Nunito'", fontSize: 22, fontWeight: 800 }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <small><b>Capacidad de revisión utilizada</b></small>
              <small>{rev.capacity_used_pct ?? 0}%</small>
            </div>
            <HBar pct={rev.capacity_used_pct || 0} color="#D97706" />
          </div>
        </div>

        <div className="card">
          <h2>Horas de apoyo (soporte incluido en planes)</h2>
          <div style={{ fontFamily: "'Nunito'", fontSize: 26, fontWeight: 800, margin: "8px 0" }}>
            {NUM(sh.used)} h{" "}
            <small style={{ fontSize: 14, color: "var(--txt2)" }}>
              consumidas de {NUM(sh.contracted)} h contratadas {PLABEL[period]}
            </small>
          </div>
          <HBar pct={sh.contracted ? (sh.used / sh.contracted) * 100 : 0} />
          <table style={{ marginTop: 12 }}>
            <tbody>
              <tr><th>Plan</th><th>Consumo</th><th>Incluidas por cuenta</th></tr>
              {(sh.by_plan || []).length === 0 && (
                <tr><td colSpan={3}><small>Sin planes con horas de apoyo.</small></td></tr>
              )}
              {(sh.by_plan || []).map((p) => (
                <tr key={p.plan}>
                  <td><b>{p.plan}</b></td>
                  <td className="num">{NUM(p.used)} h</td>
                  <td className="num">{NUM(p.included_per_account)} h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 16 }}>
        <div className="card">
          <h2>Soporte</h2>
          <div className="row" style={{ gap: 20, marginTop: 8 }}>
            <div><small>Tickets abiertos</small>
              <Big color="var(--bad)">{NUM(tickets.open)}</Big></div>
            <div><small>Resueltos {PLABEL[period]}</small>
              <Big>{NUM(tickets.resolved)}</Big></div>
            <div><small>1ª respuesta</small>
              <Big>{tickets.first_response_hours != null
                ? `${tickets.first_response_hours} h` : "—"}</Big></div>
          </div>
        </div>
        <div className="card">
          <h2>Volumen de la plataforma {PLABEL[period]}</h2>
          <div className="row" style={{ gap: 20, marginTop: 8 }}>
            <div><small>Consultas IA</small><Big>{NUM(vol.ai_consultations)}</Big></div>
            <div><small>Documentos generados</small><Big>{NUM(vol.documents_generated)}</Big></div>
            <div><small>Descargas</small><Big>{NUM(vol.downloads)}</Big></div>
          </div>
        </div>
      </div>
    </>
  );
}
