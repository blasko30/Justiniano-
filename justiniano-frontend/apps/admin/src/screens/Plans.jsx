/* 2 · Planes: tarjetas editables, creación, modificación y baja lógica (§16). */
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal, EmptyState } from "@justiniano/ui";
import { api } from "../api.js";
import { useLoad } from "../lib/useLoad.js";
import { Loading, LoadError, useAction } from "../components/bits.jsx";
import { NUM, CLP, LIMIT_KEYS, LIMIT_LABELS, fmtLim } from "../lib/format.js";

const TABS = [["all", "Todos"], ["on", "A la venta"], ["off", "Sin uso"]];
const STATUS_PARAM = { all: "all", on: "active", off: "retired" };
const DEFAULT_LIMITS = { documents_month: 10, support_hours: 1, agents: 4,
  questions_month: 200, seats: 3, history_months: 6 };

export default function Plans() {
  const navigate = useNavigate();
  const run = useAction();
  const [tab, setTab] = useState("all");
  const [modal, setModal] = useState(null); // {kind:"form",plan?} | {kind:"delete",plan}
  const [form, setForm] = useState(null);

  const all = useLoad(() => api.adminPlans.list({ status: "all" }), []);

  if (all.loading) return <Loading />;
  if (all.error) return <LoadError error={all.error} onRetry={all.reload} />;

  const plans = all.data.items || [];
  const onSale = plans.filter((p) => p.active);
  const retired = plans.filter((p) => !p.active);
  const list = tab === "all" ? plans : tab === "on" ? onSale : retired;

  const openForm = (plan) => {
    setForm(plan ? {
      name: plan.name, color: plan.color || "#FF6B35",
      pm: plan.price_monthly_clp ?? "", py: plan.price_annual_clp ?? "",
      corporate: Boolean(plan.corporate),
      limits: { ...DEFAULT_LIMITS, ...(plan.limits || {}) },
    } : {
      name: "", color: "#FF6B35", pm: "", py: "", corporate: false,
      limits: { ...DEFAULT_LIMITS },
    });
    setModal({ kind: "form", plan: plan || null });
  };

  const save = async () => {
    const name = form.name.trim();
    if (!name) return; // el botón queda deshabilitado sin nombre
    const limits = {};
    for (const k of LIMIT_KEYS) limits[k] = parseInt(form.limits[k], 10) || 0;
    const pm = form.corporate || form.pm === "" ? null : parseInt(form.pm, 10);
    const py = form.corporate || form.py === "" ? null : parseInt(form.py, 10);
    const p = modal.plan;
    if (p) {
      const body = { name, color: form.color, limits };
      if (pm !== null) body.price_monthly_clp = pm;
      if (py !== null) body.price_annual_clp = py;
      await run(() => api.adminPlans.patch(p.id, body),
        `Plan «${name}» actualizado`, () => { setModal(null); all.reload(); });
    } else {
      await run(() => api.adminPlans.create({
        name, color: form.color, price_monthly_clp: pm, price_annual_clp: py,
        corporate: form.corporate, limits,
      }), `Plan «${name}» creado y a la venta`, () => { setModal(null); all.reload(); });
    }
  };

  const retire = (p) => run(() => api.adminPlans.retire(p.id),
    `Plan «${p.name}» marcado como sin uso (conservado en base de datos)`,
    () => { setModal(null); all.reload(); });

  const restore = (p) => run(() => api.adminPlans.patch(p.id, { active: true }),
    `Plan «${p.name}» reactivado y a la venta`, () => all.reload());

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>Planes</h1>
          <p className="small">
            {onSale.length} planes a la venta · {retired.length} sin uso
          </p>
        </div>
        <button className="btn" onClick={() => openForm(null)}>＋ Crear nuevo plan</button>
      </div>
      <div className="tabs">
        {TABS.map(([id, label]) => (
          <div key={id} className={`tab ${tab === id ? "on" : ""}`} onClick={() => setTab(id)}>
            {label}
          </div>
        ))}
      </div>

      {list.length === 0 ? (
        <EmptyState icon="📦" title="Sin planes en esta vista">
          {tab === "off" ? "No hay planes marcados sin uso." : "Cree el primer plan con «＋ Crear nuevo plan»."}
        </EmptyState>
      ) : (
        <div className="plangrid">
          {list.map((p) => (
            <div key={p.id} className={`card ${p.active ? "" : "plan-dead"}`}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h2 style={{ color: p.color || "var(--txt)" }}>{p.name}</h2>
                {p.active
                  ? <span className="badge b-ok">A la venta</span>
                  : <span className="badge b-mut">Sin uso</span>}
              </div>
              <div style={{ fontFamily: "'Nunito'", fontSize: 24, fontWeight: 800, margin: "4px 0" }}>
                {p.corporate ? "A medida"
                  : p.price_monthly_clp === 0 ? "Gratis"
                    : <>{CLP(p.price_monthly_clp)}<small style={{ fontSize: 13, color: "var(--txt2)" }}> /mes</small></>}
              </div>
              {p.corporate
                ? <small>Cotización con el equipo comercial</small>
                : p.price_monthly_clp > 0
                  ? <small>Anual: {CLP(p.price_annual_clp)} (2 meses gratis)</small>
                  : <small>&nbsp;</small>}
              <div style={{ margin: "12px 0" }}>
                {LIMIT_KEYS.map((k) => (
                  <div key={k} className="limitrow">
                    <span className="small">{LIMIT_LABELS[k]}</span>
                    <b style={{ fontSize: 13 }}>{fmtLim((p.limits || {})[k] ?? 0)}</b>
                  </div>
                ))}
              </div>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="badge b-info" style={{ cursor: "pointer" }}
                  onClick={() => navigate(`/planes/${p.id}/usuarios`)}>
                  👥 {NUM(p.users_count)} usuarios →
                </span>
                <div className="row">
                  <button className="btn ghost xs" onClick={() => openForm(p)}>Modificar</button>
                  {p.active
                    ? <button className="btn danger xs" onClick={() => setModal({ kind: "delete", plan: p })}>Eliminar</button>
                    : <button className="btn sec xs" onClick={() => restore(p)}>Reactivar</button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="small" style={{ marginTop: 12 }}>
        ℹ️ Al eliminar un plan no se borra de la base de datos: se marca como <b>Sin uso</b>.
        Deja de ofrecerse a nuevos clientes y sus usuarios actuales conservan las
        condiciones hasta migrar de plan.
      </p>

      {/* ── Modal crear / modificar plan ── */}
      <Modal open={modal?.kind === "form"} onClose={() => setModal(null)} width={640}>
        {modal?.kind === "form" && form && (
          <>
            <h2>{modal.plan ? `Modificar plan · ${modal.plan.name}` : "Crear nuevo plan"}</h2>
            <div className="formgrid">
              <div>
                <label>Nombre del plan</label>
                <input value={form.name} placeholder="Ej: Intermedio"
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label>Color distintivo</label>
                <input type="color" value={form.color} style={{ height: 46, padding: 4 }}
                  onChange={(e) => setForm({ ...form, color: e.target.value })} />
              </div>
              <div>
                <label>Precio mensual (CLP)</label>
                <input type="number" value={form.pm} disabled={form.corporate}
                  placeholder="0 = gratuito · vacío = a medida"
                  onChange={(e) => setForm({ ...form, pm: e.target.value })} />
              </div>
              <div>
                <label>Precio anual (CLP)</label>
                <input type="number" value={form.py} disabled={form.corporate}
                  onChange={(e) => setForm({ ...form, py: e.target.value })} />
              </div>
            </div>
            <h3 style={{ marginTop: 16 }}>
              Límites del plan <small style={{ fontWeight: 400 }}>(usar -1 para ilimitado)</small>
            </h3>
            <div className="formgrid">
              {LIMIT_KEYS.map((k) => (
                <div key={k}>
                  <label>{LIMIT_LABELS[k]}</label>
                  <input type="number" value={form.limits[k]}
                    onChange={(e) => setForm({ ...form, limits: { ...form.limits, [k]: e.target.value } })} />
                </div>
              ))}
            </div>
            {!modal.plan && (
              <label style={{ marginTop: 14 }}>
                <input type="checkbox" checked={form.corporate}
                  style={{ width: "auto", marginRight: 8 }}
                  onChange={(e) => setForm({ ...form, corporate: e.target.checked })} />
                Plan corporativo (precio a medida, cierre con equipo comercial)
              </label>
            )}
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 18 }}>
              <button className="btn ghost" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn" onClick={save} disabled={!form.name.trim()}>
                {modal.plan ? "Guardar cambios" : "Crear plan"}
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* ── Modal eliminar (baja lógica) ── */}
      <Modal open={modal?.kind === "delete"} onClose={() => setModal(null)}>
        {modal?.kind === "delete" && (
          <>
            <h2>Eliminar plan «{modal.plan.name}»</h2>
            <p style={{ margin: "10px 0" }}>
              El plan <b>no se borra de la base de datos</b>: se marcará como{" "}
              <span className="badge b-mut">Sin uso</span> y dejará de ofrecerse a
              nuevos clientes.
            </p>
            <div className="card" style={{ background: "var(--warnbg)", border: "none", margin: "10px 0" }}>
              <small>
                ⚠️ {NUM(modal.plan.users_count)} usuarios están actualmente en este plan.
                Conservarán sus condiciones y podrá migrarlos desde la lista de usuarios
                del plan.
              </small>
            </div>
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
              <button className="btn ghost" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn danger" onClick={() => retire(modal.plan)}>
                Marcar como sin uso
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
