/* 2b · Usuarios de un plan, con migración de plan vía PATCH /admin/users (§15.4). */
import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Modal, EmptyState } from "@justiniano/ui";
import { api } from "../api.js";
import { useLoad } from "../lib/useLoad.js";
import { Loading, LoadError, useAction } from "../components/bits.jsx";
import { NUM, timeAgo } from "../lib/format.js";

export default function PlanUsers() {
  const { planId } = useParams();
  const navigate = useNavigate();
  const run = useAction();
  const [migrate, setMigrate] = useState(null); // { user, plan_id, reason }

  const plans = useLoad(() => api.adminPlans.list({ status: "all" }), []);
  const users = useLoad(() => api.adminPlans.users(planId, { page_size: 50 }), [planId]);

  const back = (
    <div className="crumb" onClick={() => navigate("/planes")}>← Volver a planes</div>
  );

  if (plans.loading || users.loading) return <>{back}<Loading /></>;
  if (plans.error) return <>{back}<LoadError error={plans.error} onRetry={plans.reload} /></>;
  if (users.error) return <>{back}<LoadError error={users.error} onRetry={users.reload} /></>;

  const plan = (plans.data.items || []).find((p) => p.id === planId);
  if (!plan) return <>{back}<EmptyState icon="📦" title="Plan inexistente" /></>;

  const items = users.data.items || [];
  const targets = (plans.data.items || []).filter((p) => p.active && p.id !== planId);

  const doMigrate = async () => {
    if (!migrate.plan_id || migrate.reason.trim().length < 5) return;
    await run(
      () => api.adminMetrics.patchUser(migrate.user.user_id,
        { plan_id: migrate.plan_id, reason: migrate.reason.trim() }),
      `${migrate.user.company || "Usuario"} migrado de plan`,
      () => { setMigrate(null); users.reload(); },
    );
  };

  return (
    <>
      {back}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Usuarios del plan {plan.name}</h1>
        <span className={`badge ${plan.active ? "b-ok" : "b-mut"}`}>
          {plan.active ? "A la venta" : "Sin uso"}
        </span>
      </div>
      <p className="small">{NUM(users.data.total)} usuarios en total.</p>

      {items.length === 0 ? (
        <EmptyState icon="👥" title="Sin usuarios en este plan">
          Cuando existan suscriptores aparecerán en esta lista.
        </EmptyState>
      ) : (
        <div className="card" style={{ marginTop: 12 }}>
          <table>
            <tbody>
              <tr>
                <th>Empresa</th><th>Contacto</th><th>Ciudad</th><th>Industria</th>
                <th>Última actividad</th><th>Estado</th><th></th>
              </tr>
              {items.map((u) => (
                <tr key={u.user_id}>
                  <td><b>{u.company || "—"}</b></td>
                  <td>{u.contact || "—"}</td>
                  <td>{u.city || "—"}</td>
                  <td>{u.industry || "—"}</td>
                  <td>{timeAgo(u.last_activity_at)}</td>
                  <td>
                    <span className={`badge ${u.status === "active" ? "b-ok" : "b-mut"}`}>
                      {u.status === "active" ? "activo" : "inactivo"}
                    </span>
                  </td>
                  <td>
                    <button className="btn ghost xs"
                      onClick={() => setMigrate({ user: u, plan_id: targets[0]?.id || "", reason: "" })}>
                      Migrar de plan
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={Boolean(migrate)} onClose={() => setMigrate(null)}>
        {migrate && (
          <>
            <h2>Migrar de plan · {migrate.user.company || "—"}</h2>
            <p className="small" style={{ margin: "8px 0" }}>
              El usuario conservará su cuenta y pasará al plan seleccionado. El cambio
              queda auditado.
            </p>
            <label>Plan de destino</label>
            <select value={migrate.plan_id}
              onChange={(e) => setMigrate({ ...migrate, plan_id: e.target.value })}>
              {targets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <label>Motivo (obligatorio, queda en la auditoría)</label>
            <textarea rows={2} value={migrate.reason}
              placeholder="Ej: migración por retiro del plan…"
              onChange={(e) => setMigrate({ ...migrate, reason: e.target.value })} />
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
              <button className="btn ghost" onClick={() => setMigrate(null)}>Cancelar</button>
              <button className="btn" onClick={doMigrate}
                disabled={!migrate.plan_id || migrate.reason.trim().length < 5}>
                Migrar usuario
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
