/* 1b · Detalle de una métrica del dashboard (segmento parametrizado §15.2). */
import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { usePeriod } from "../components/Shell.jsx";
import { useLoad } from "../lib/useLoad.js";
import { Loading, LoadError, KpiMini, useAction } from "../components/bits.jsx";
import { Bars } from "../components/charts.jsx";
import { NUM, CLP, PLABEL, PAPI, lastMonths, last7Days, timeAgo } from "../lib/format.js";

const SEGMENT = { usuarios: "all", activos: "active", inactivos: "inactive",
  churn: "churned", nuevos: "new" };

export default function DashDetail() {
  const { metric } = useParams();
  const navigate = useNavigate();
  const { period } = usePeriod();
  const run = useAction();
  const segment = SEGMENT[metric];

  const ov = useLoad(() => api.adminMetrics.overview({ period: PAPI[period] }), [period]);
  const us = useLoad(
    () => (segment
      ? api.adminMetrics.users({ segment, period: PAPI[period], page_size: 20 })
      : Promise.resolve(null)),
    [segment, period],
  );

  const back = (
    <div className="crumb" onClick={() => navigate("/dash")}>← Volver al dashboard</div>
  );

  if (!segment) {
    return <>{back}<h1>Métrica desconocida</h1></>;
  }
  if (ov.loading || us.loading) return <>{back}<Loading /></>;
  if (ov.error) return <>{back}<LoadError error={ov.error} onRetry={ov.reload} /></>;
  if (us.error) return <>{back}<LoadError error={us.error} onRetry={us.reload} /></>;

  const k = ov.data.kpis;
  const series = ov.data.series || {};
  const items = us.data?.items || [];
  const total = us.data?.total ?? 0;

  const sendReminder = (u) => run(
    () => api.adminMetrics.sendReminder(u.user_id, { template: "reactivation" }),
    `Recordatorio de reactivación enviado a ${u.company || u.user_id}`,
  );

  const emptyRow = (cols) => (
    <tr><td colSpan={cols}><small>Sin registros en el período.</small></td></tr>
  );

  if (metric === "usuarios") {
    return (
      <>
        {back}
        <h1>Usuarios totales</h1>
        <p className="small">
          {NUM(k.total_users.value)} cuentas registradas ·{" "}
          {k.total_users.delta_pct >= 0 ? "crecimiento +" : ""}
          {k.total_users.delta_pct}% vs período anterior.
        </p>
        <div className="card" style={{ marginTop: 12 }}>
          <Bars vals={series.users_by_month || []} labels={lastMonths(8)} color="#FF6B35" />
          <small>Evolución de cuentas registradas</small>
        </div>
        <div className="card" style={{ marginTop: 14 }}>
          <h2>Muestra de cuentas</h2>
          <table>
            <tbody>
              <tr><th>Empresa</th><th>Plan</th><th>Última actividad</th><th>Estado</th></tr>
              {items.length === 0 && emptyRow(4)}
              {items.map((u) => (
                <tr key={u.user_id}>
                  <td><b>{u.company || "—"}</b></td>
                  <td>{u.plan || "—"}</td>
                  <td>{timeAgo(u.last_activity_at)}</td>
                  <td>
                    <span className={`badge ${u.status === "active" ? "b-ok" : "b-mut"}`}>
                      {u.status === "active" ? "activo" : "inactivo"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <small style={{ display: "block", marginTop: 8 }}>
            {NUM(total)} cuentas en total · se muestra una muestra representativa.
          </small>
        </div>
      </>
    );
  }

  if (metric === "activos") {
    return (
      <>
        {back}
        <h1>Usuarios activos</h1>
        <p className="small">
          {NUM(k.active_users.value)} usuarios con actividad {PLABEL[period]}{" "}
          ({k.active_users.pct_of_total}% del total). Actividad = inicio de sesión +
          al menos 1 consulta o documento.
        </p>
        <div className="card" style={{ marginTop: 12 }}>
          <h3>Activos diarios (7 días)</h3>
          <Bars vals={series.daily_active_7d || []} labels={last7Days()} color="#16A34A" />
        </div>
        <div className="card" style={{ marginTop: 14 }}>
          <h2>Usuarios activos recientes</h2>
          <table>
            <tbody>
              <tr><th>Empresa</th><th>Plan</th><th>Última actividad</th></tr>
              {items.length === 0 && emptyRow(3)}
              {items.map((u) => (
                <tr key={u.user_id}>
                  <td><b>{u.company || "—"}</b></td>
                  <td>{u.plan || "—"}</td>
                  <td>{timeAgo(u.last_activity_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  if (metric === "inactivos") {
    return (
      <>
        {back}
        <h1>Usuarios inactivos</h1>
        <p className="small">
          {NUM(k.inactive_users.value)} usuarios sin actividad {PLABEL[period]}. Riesgo de
          churn: los inactivos de planes de pago requieren gestión.
        </p>
        <div className="kpis" style={{ margin: "12px 0" }}>
          <KpiMini label="Usuarios inactivos" value={NUM(k.inactive_users.value)} />
          <KpiMini label="Promedio de días sin uso"
            value={items.length
              ? NUM(Math.round(items.reduce((a, u) => a + (u.days_inactive || 0), 0) / items.length))
              : "—"} />
        </div>
        <div className="card">
          <h2>Inactivos (prioridad)</h2>
          <table>
            <tbody>
              <tr>
                <th>Empresa</th><th>Plan</th><th>Sin actividad</th>
                <th>Vendedor asignado</th><th></th>
              </tr>
              {items.length === 0 && emptyRow(5)}
              {items.map((u) => (
                <tr key={u.user_id}>
                  <td><b>{u.company || "—"}</b></td>
                  <td>{u.plan || "—"}</td>
                  <td>{u.days_inactive != null ? `${NUM(u.days_inactive)} días` : "—"}</td>
                  <td>{u.assigned_seller || "—"}</td>
                  <td>
                    <button className="btn ghost xs" onClick={() => sendReminder(u)}>
                      Enviar recordatorio
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  if (metric === "churn") {
    return (
      <>
        {back}
        <h1>Churn</h1>
        <p className="small">
          {k.churn.rate_pct}% {PLABEL[period]} ({NUM(k.churn.count)} bajas). MRR
          perdido: {CLP(k.churn.mrr_lost_clp)}.
        </p>
        <div className="card" style={{ marginTop: 14 }}>
          <h2>Bajas recientes</h2>
          <table>
            <tbody>
              <tr>
                <th>Empresa</th><th>Plan</th><th>Fecha de baja</th>
                <th>Motivo</th><th>MRR perdido</th>
              </tr>
              {items.length === 0 && emptyRow(5)}
              {items.map((c) => (
                <tr key={c.user_id}>
                  <td><b>{c.company || "—"}</b></td>
                  <td>{c.plan || "—"}</td>
                  <td>{c.churned_at || "—"}</td>
                  <td>{c.reason || "—"}</td>
                  <td className="num">{CLP(c.mrr_lost_clp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  /* nuevos */
  return (
    <>
      {back}
      <h1>Clientes ganados</h1>
      <p className="small">
        {NUM(k.new_clients.value)} altas {PLABEL[period]} ·{" "}
        {NUM(k.new_clients.direct_to_paid)} llegaron directo a un plan de pago.
      </p>
      <div className="card" style={{ marginTop: 14 }}>
        <h2>Altas recientes</h2>
        <table>
          <tbody>
            <tr>
              <th>Empresa</th><th>Plan contratado</th><th>Origen</th><th>Vendedor</th>
            </tr>
            {items.length === 0 && emptyRow(4)}
            {items.map((c) => (
              <tr key={c.user_id}>
                <td><b>{c.company || "—"}</b></td>
                <td>{c.plan || "—"}</td>
                <td>{c.signup_source === "seller" ? "Vendedor" : "Web (self-service)"}</td>
                <td>{c.seller || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
