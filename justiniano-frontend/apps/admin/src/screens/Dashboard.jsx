/* 1 · Dashboard: KPIs del overview con navegación al detalle por métrica. */
import React from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { usePeriod } from "../components/Shell.jsx";
import { useLoad } from "../lib/useLoad.js";
import { Loading, LoadError, KpiMini } from "../components/bits.jsx";
import { Bars, HBar, Delta } from "../components/charts.jsx";
import { NUM, CLP, PLABEL, PAPI, last7Days } from "../lib/format.js";

export default function Dashboard() {
  const navigate = useNavigate();
  const { period } = usePeriod();

  const ov = useLoad(() => api.adminMetrics.overview({ period: PAPI[period] }), [period]);
  const plans = useLoad(() => api.adminPlans.list({ status: "all" }), []);

  if (ov.loading) return <Loading />;
  if (ov.error) return <LoadError error={ov.error} onRetry={ov.reload} />;

  const d = ov.data;
  const k = d.kpis;
  const ops = d.operational_summary || {};
  const colorByName = {};
  (plans.data?.items || []).forEach((p) => { colorByName[p.name] = p.color; });

  const kpis = [
    { key: "usuarios", t: "Usuarios totales", v: NUM(k.total_users.value),
      d: <Delta v={k.total_users.delta_pct} />, note: "cuentas registradas" },
    { key: "activos", t: "Usuarios activos", v: NUM(k.active_users.value),
      d: <Delta v={k.active_users.delta_pct} />,
      note: `${k.active_users.pct_of_total}% del total · ${PLABEL[period]}` },
    { key: "inactivos", t: "Usuarios inactivos", v: NUM(k.inactive_users.value),
      d: <Delta v={k.inactive_users.delta_pct} goodUp={false} />,
      note: "sin actividad en el período" },
    { key: "churn", t: "Churn", v: `${k.churn.rate_pct}%`,
      d: <Delta v={k.churn.delta_pp} goodUp={false}>{" pp"}</Delta>,
      note: `${NUM(k.churn.count)} bajas ${PLABEL[period]}` },
    { key: "nuevos", t: "Clientes ganados", v: NUM(k.new_clients.value),
      d: <Delta v={k.new_clients.delta_pct} />, note: `altas ${PLABEL[period]}` },
  ];

  const byPlan = d.series?.users_by_plan || [];
  const maxPlan = Math.max(...byPlan.map((p) => p.users), 1);

  return (
    <>
      <h1>Dashboard</h1>
      <p className="small" style={{ marginBottom: 16 }}>
        Haga clic en cualquier indicador para ver el detalle.
      </p>
      <div className="kpis">
        {kpis.map((x) => (
          <div key={x.key} className="card kpi" onClick={() => navigate(`/dash/${x.key}`)}>
            <div className="t">{x.t}</div>
            <div className="v">{x.v}</div>
            <div className="foot">{x.d}<small>{x.note}</small></div>
            <small style={{ color: "var(--naranja)", fontWeight: 700 }}>Ver detalle →</small>
          </div>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.4fr 1fr", marginTop: 16 }}>
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>Usuarios activos · últimos 7 días</h2>
            <span className="badge b-info">DAU</span>
          </div>
          <Bars vals={d.series?.daily_active_7d || []} labels={last7Days()} color="#2563EB" />
        </div>
        <div className="card">
          <h2>Distribución por plan</h2>
          {byPlan.length === 0 && (
            <p className="small" style={{ marginTop: 8 }}>Sin usuarios con plan asignado.</p>
          )}
          {byPlan.map((p) => (
            <div key={p.plan_id} style={{ margin: "10px 0" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <small><b>{p.name}</b></small><small>{NUM(p.users)}</small>
              </div>
              <HBar pct={(p.users / maxPlan) * 100} color={colorByName[p.name] || "#FF6B35"} />
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Indicadores operativos</h2>
          <button className="btn ghost xs" onClick={() => navigate("/operacion")}>
            Ver operación completa →
          </button>
        </div>
        <div className="kpis" style={{ marginTop: 12 }}>
          <KpiMini label="Revisiones en cola" value={NUM(ops.reviews_queue)} />
          <KpiMini label="SLA cumplido" value={`${ops.sla_pct ?? "—"}%`} />
          <KpiMini label={`Consultas IA ${PLABEL[period]}`} value={NUM(ops.ai_consultations)} />
          <KpiMini label="Documentos generados" value={NUM(ops.documents_generated)} />
          <KpiMini label="Tickets abiertos" value={NUM(ops.open_tickets)} />
        </div>
      </div>

      {k.churn.mrr_lost_clp > 0 && (
        <p className="small" style={{ marginTop: 12 }}>
          MRR perdido por churn {PLABEL[period]}: <b>{CLP(k.churn.mrr_lost_clp)}</b>
        </p>
      )}
    </>
  );
}
