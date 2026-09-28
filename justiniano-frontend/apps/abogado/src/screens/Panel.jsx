import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState, Spinner, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { CLP, fmtDT, mesLargo, specLabel, urg } from "../lib/format.js";
import { useLawyer } from "../components/LawyerContext.jsx";

/**
 * Panel del abogado (§20.5): KPIs, próximos vencimientos y un extracto de la
 * bolsa de requerimientos disponible.
 */
export default function Panel() {
  const { verified } = useLawyer();
  const toast = useToast();
  const navigate = useNavigate();
  const [ov, setOv] = useState(null);
  const [pool, setPool] = useState([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(null);

  const cargar = async () => {
    try {
      const [o, p] = await Promise.all([
        api.lawyers.overview(),
        verified ? api.lawyers.pool({ page: 1, page_size: 3 }).catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
      ]);
      setOv(o);
      setPool(p?.items || []);
    } catch (e) {
      toast(e.message, "err");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [verified]);

  const tomarCaso = async (p) => {
    if (!verified) { toast("Su cuenta aún está en verificación", "warn"); return; }
    setClaiming(p.id);
    try {
      await api.lawyers.claim(p.id);
      toast(`Caso «${p.title}» agregado a sus requerimientos`, "ok");
      await cargar();
    } catch (e) {
      toast(e.message, "err");
    } finally {
      setClaiming(null);
    }
  };

  if (loading) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Spinner size={30} /></div>;
  if (!ov) return <EmptyState icon="📋" title="No pudimos cargar su panel">Reintente en unos segundos.</EmptyState>;

  const mesActual = mesLargo(new Date().toISOString().slice(0, 7)).split(" ")[0].toLowerCase();
  const kpis = [
    ["Casos activos", ov.active_cases,
      <span className="delta neu">{ov.pending_acceptance} por aceptar</span>],
    ["Urgentes en curso", ov.urgent_in_progress,
      ov.urgent_in_progress ? <span className="delta down">▲ prioridad</span> : <span className="delta neu">–</span>],
    [`Completados · ${mesActual}`, ov.completed_month, <span className="delta neu">mes en curso</span>],
    ["SLA cumplido · 90 d", `${ov.sla_compliance_90d_pct}%`,
      <span className={`delta ${ov.sla_compliance_90d_pct >= 95 ? "up" : "neu"}`}>
        {ov.sla_compliance_90d_pct >= 95 ? "▲ bono SLA" : "últimos 90 días"}</span>],
    ["Honorarios del mes", CLP(ov.fees_month_clp), <span className="delta neu">devengados</span>],
    ["Valoración de clientes", ov.rating != null ? `${String(ov.rating).replace(".", ",")} ★` : "—",
      <span className="delta neu">{ov.ratings_count || 0} evaluaciones</span>],
  ];

  return (
    <>
      <h1>Panel</h1>
      <p className="small" style={{ marginBottom: 14 }}>
        Su actividad como abogado revisor. Los plazos se cuentan en horas hábiles.
      </p>
      <div className="kpis">
        {kpis.map(([t, v, foot]) => (
          <div key={t} className="card kpi">
            <div className="t">{t}</div><div className="v">{v}</div><div className="foot">{foot}</div>
          </div>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.4fr 1fr", marginTop: 16 }}>
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>Próximos vencimientos</h2>
            <button className="btn ghost xs" onClick={() => navigate("/requerimientos")}>Ver todos →</button>
          </div>
          {ov.next_deadlines?.length ? (
            <table style={{ marginTop: 8 }}>
              <tbody>
                <tr><th>Requerimiento</th><th>Urgencia</th><th>Vence</th><th></th></tr>
                {ov.next_deadlines.map((r) => (
                  <tr key={r.review_id} className="click" onClick={() => navigate(`/caso/${r.review_id}`)}>
                    <td><b>{r.title}</b></td>
                    <td><span className={`badge ${urg(r.urgency).badge}`}>{urg(r.urgency).short}</span></td>
                    <td>
                      <b style={{ color: r.remaining_business_hours != null && r.remaining_business_hours < 6 ? "var(--bad)" : "inherit" }}>
                        {fmtDT(r.sla_due_at)}
                      </b><br />
                      <small>{r.remaining_business_hours != null ? `en ${String(r.remaining_business_hours).replace(".", ",")} h hábiles` : ""}</small>
                    </td>
                    <td><small style={{ color: "var(--naranja)", fontWeight: 700 }}>Abrir →</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState icon="✅" title="Sin vencimientos próximos">
              No tiene requerimientos en curso con plazo SLA corriendo.
            </EmptyState>
          )}
        </div>

        <div className="card">
          <h2>Bolsa de requerimientos</h2>
          <p className="small">Casos disponibles en sus especialidades que puede tomar ahora.</p>
          {pool.length ? pool.map((p) => (
            <div key={p.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, margin: "10px 0" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className={`badge ${urg(p.urgency).badge}`}>{urg(p.urgency).short}</span>
                <small>{fmtDT(p.published_at)}</small>
              </div>
              <b style={{ fontSize: 14 }}>{p.title}</b><br />
              <small>{specLabel(p.area)} · {p.client_company} · {CLP(p.fee_amount_clp)}</small>
              <div style={{ marginTop: 8 }}>
                <button className="btn sec xs" disabled={!verified || claiming === p.id} onClick={() => tomarCaso(p)}>
                  {verified ? (claiming === p.id ? "Tomando…" : "Tomar caso") : "🔒 Requiere verificación"}
                </button>
              </div>
            </div>
          )) : (
            <p className="small" style={{ margin: "12px 0" }}>
              {verified
                ? "No hay casos disponibles en sus especialidades por ahora."
                : "🔒 La bolsa se habilita cuando su acreditación esté verificada."}
            </p>
          )}
          <button className="btn ghost xs" onClick={() => navigate("/requerimientos", { state: { tab: "pool" } })}>
            Ver bolsa completa →
          </button>
        </div>
      </div>
      {ov.pending_acceptance > 0 && (
        <div className="banner info" style={{ marginTop: 16 }}>⚖️ <div>
          Tiene <b>{ov.pending_acceptance}</b> {ov.pending_acceptance === 1 ? "requerimiento asignado por aceptar" : "requerimientos asignados por aceptar"}.{" "}
          <a href="#/requerimientos">Ir a requerimientos →</a>
        </div></div>
      )}
    </>
  );
}
