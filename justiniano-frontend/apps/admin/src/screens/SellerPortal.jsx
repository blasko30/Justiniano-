/* 4b · Portal del vendedor (rol seller): solo SUS datos + referencias anónimas
   del equipo (§19). */
import React, { useState } from "react";
import { Modal, EmptyState } from "@justiniano/ui";
import { api } from "../api.js";
import { usePeriod } from "../components/Shell.jsx";
import { useLoad } from "../lib/useLoad.js";
import { Loading, LoadError, useAction } from "../components/bits.jsx";
import { MultiLine, HBar } from "../components/charts.jsx";
import { NUM, CLP, PLABEL, PAPI, INDUSTRIES, industryLabel, STAGES, stageLabel,
  isoInDays } from "../lib/format.js";

const emptyClient = () => ({
  company: "", contact: "", email: "", phone: "", city: "",
  industry: "servicios", status: "prospect", plan_id: "", note: "",
});

export default function SellerPortal() {
  const { period } = usePeriod();
  const run = useAction();
  const [modal, setModal] = useState(null);
  // modal: {kind:"newClient",form} | {kind:"proj",client,form}

  const ov = useLoad(
    () => api.http.get("/sales/me/overview", { params: { period: PAPI[period] } }),
    [period],
  );
  const cl = useLoad(() => api.salesMe.clients({ page_size: 100 }), []);
  const plans = useLoad(() => api.billing.plans(), []);

  if (ov.loading || cl.loading || plans.loading) return <Loading />;
  if (ov.error) return <LoadError error={ov.error} onRetry={ov.reload} />;
  if (cl.error) return <LoadError error={cl.error} onRetry={cl.reload} />;

  const k = ov.data.kpis;
  const serie = ov.data.series || {};
  const clients = cl.data.items || [];
  const pipeline = cl.data.pipeline || { total_monthly_clp: 0, weighted_clp: 0 };
  const paidPlans = (plans.data?.items || [])
    .filter((p) => p.corporate || (p.price_monthly_clp || 0) > 0);
  const planName = (id) => (plans.data?.items || []).find((p) => p.id === id)?.name || id || "—";

  const series = [];
  if (serie.team_best_mm) series.push({ vals: serie.team_best_mm, color: "#2563EB", dash: true });
  if (serie.team_avg_mm) series.push({ vals: serie.team_avg_mm, color: "#94A3B8", dash: true });
  if (serie.me_mm) series.push({ vals: serie.me_mm, color: "#FF6B35" });

  /* ── alta de cliente ── */
  const openNew = () => setModal({
    kind: "newClient",
    form: { ...emptyClient(), plan_id: paidPlans[0]?.id || "" },
  });

  const createClient = async () => {
    const f = modal.form;
    const body = {
      company: f.company.trim(), contact: f.contact.trim(),
      status: f.status, industry: f.industry,
    };
    if (f.email.trim()) body.email = f.email.trim().toLowerCase();
    if (f.phone.trim()) body.phone = f.phone.replace(/\s/g, "");
    if (f.city.trim()) body.city = f.city.trim();
    if (f.note.trim()) body.note = f.note.trim();
    if (f.plan_id) {
      const plan = paidPlans.find((p) => p.id === f.plan_id);
      body.projection = {
        stage: "prospect", plan_id: f.plan_id,
        monthly_amount_clp: plan?.price_monthly_clp || 29900,
        probability_pct: 20, expected_close_date: isoInDays(50),
        ...(f.note.trim() ? { note: f.note.trim() } : {}),
      };
    }
    await run(() => api.salesMe.createClient(body),
      `Cliente «${body.company}» registrado en su cartera`,
      () => { setModal(null); cl.reload(); ov.reload(); });
  };

  /* ── proyección de cierre ── */
  const openProj = (c) => {
    const pr = c.projection;
    setModal({
      kind: "proj", client: c,
      form: {
        stage: pr?.stage || "prospect",
        plan_id: pr?.plan_id || paidPlans[0]?.id || "",
        monto: String(pr?.monthly_amount_clp ?? 29900),
        prob: String(pr?.probability_pct ?? 20),
        fecha: pr?.expected_close_date || isoInDays(50),
        nota: pr?.note || "",
      },
    });
  };

  const saveProj = async () => {
    const { client, form: f } = modal;
    const projection = {
      stage: f.stage, plan_id: f.plan_id,
      monthly_amount_clp: Math.max(parseInt(f.monto, 10) || 0, 1),
      probability_pct: Math.max(0, Math.min(100, parseInt(f.prob, 10) || 0)),
      expected_close_date: f.fecha,
      ...(f.nota.trim() ? { note: f.nota.trim() } : {}),
    };
    await run(() => api.salesMe.patchClient(client.id, { projection }),
      `Proyección de «${client.company}» actualizada`,
      () => { setModal(null); cl.reload(); ov.reload(); });
  };

  const dropProj = async () => {
    const { client } = modal;
    await run(() => api.salesMe.patchClient(client.id, { projection: null }),
      `Proyección de «${client.company}» retirada del pipeline`,
      () => { setModal(null); cl.reload(); ov.reload(); });
  };

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>Mis ventas</h1>
          <p className="small">Vista personal · no incluye información de otros vendedores.</p>
        </div>
        <button className="btn" onClick={openNew}>＋ Informar nuevo cliente</button>
      </div>

      <div className="kpis" style={{ margin: "14px 0" }}>
        {[
          [`Mis ventas ${PLABEL[period]}`, CLP(k.sales_clp), null],
          ["Mi meta", CLP(k.target_clp),
            <span key="m" className={`delta ${k.attainment_pct >= 100 ? "up" : "neu"}`}>
              {k.attainment_pct}% cumplida
            </span>],
          ["Mis contratos", NUM(k.contracts), null],
          ["Mi conversión free → pago", `${k.free_to_paid_pct}%`, null],
          ["Mi proyección de cierre", CLP(k.pipeline_weighted_clp),
            <span key="p" className="delta neu">{k.open_opportunities} oportunidades</span>],
        ].map(([l, v, d], i) => (
          <div key={i} className="card" style={{ padding: 16 }}>
            <small>{l}</small>
            <div style={{ fontFamily: "'Nunito'", fontSize: 21, fontWeight: 800, margin: "4px 0" }}>{v}</div>
            {d}
          </div>
        ))}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Mi rendimiento mensual (MM CLP)</h2>
          <div className="row" style={{ gap: 14 }}>
            <small><span className="statusdot" style={{ background: "#FF6B35" }} /><b>Yo</b></small>
            <small><span className="statusdot" style={{ background: "#94A3B8" }} />Promedio vendedores</small>
            {serie.team_best_mm && (
              <small><span className="statusdot" style={{ background: "#2563EB" }} />Mejor vendedor</small>
            )}
          </div>
        </div>
        <MultiLine series={series} labels={serie.months || []} />
        <small>
          Las referencias «promedio» y «mejor vendedor» son agregados anónimos del
          sistema.
        </small>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Mis clientes y proyección de cierre</h2>
          <span className="badge b-info">
            Pipeline: {CLP(pipeline.total_monthly_clp)} /mes · ponderado{" "}
            {CLP(pipeline.weighted_clp)}
          </span>
        </div>
        {clients.length === 0 ? (
          <EmptyState icon="👥" title="Su cartera está vacía">
            Informe su primer cliente con «＋ Informar nuevo cliente».
          </EmptyState>
        ) : (
          <table style={{ marginTop: 8 }}>
            <tbody>
              <tr>
                <th>Cliente</th><th>Contacto</th><th>Ciudad</th><th>Tipo</th>
                <th>Estado</th><th>Etapa</th><th>Plan proyectado</th>
                <th>Cierre est.</th><th>Prob.</th><th></th>
              </tr>
              {clients.map((c) => {
                const pr = c.projection;
                return (
                  <tr key={c.id}>
                    <td>
                      <b>{c.company}</b>
                      {c.current_plan && (
                        <><br /><small>Plan actual: {planName(c.current_plan)}</small></>
                      )}
                    </td>
                    <td>{c.contact || "—"}</td>
                    <td>{c.city || "—"}</td>
                    <td>{industryLabel(c.industry)}</td>
                    <td>
                      <span className={`badge ${c.status === "client" ? "b-ok" : "b-info"}`}>
                        {c.status === "client" ? "Cliente" : "Prospecto"}
                      </span>
                    </td>
                    {pr ? (
                      <>
                        <td><span className="badge b-warn">{stageLabel(pr.stage)}</span></td>
                        <td>
                          {planName(pr.plan_id)}<br />
                          <small>{CLP(pr.monthly_amount_clp)}/mes</small>
                        </td>
                        <td>{pr.expected_close_date}</td>
                        <td style={{ minWidth: 90 }}>
                          <HBar pct={pr.probability_pct}
                            color={pr.probability_pct >= 70 ? "#16A34A"
                              : pr.probability_pct >= 40 ? "#FF6B35" : "#94A3B8"} />
                          <small>{pr.probability_pct}%</small>
                        </td>
                        <td>
                          <button className="btn ghost xs" onClick={() => openProj(c)}>
                            Editar proyección
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td colSpan={3}><small>Sin proyección activa</small></td>
                        <td></td>
                        <td>
                          <button className="btn sec xs" onClick={() => openProj(c)}>
                            Crear proyección
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <small style={{ display: "block", marginTop: 8 }}>
          La proyección ponderada = Σ (monto mensual × probabilidad). Sus proyecciones
          alimentan la proyección de ventas que ve la administración.
        </small>
      </div>

      {/* ── Modal informar nuevo cliente ── */}
      <Modal open={modal?.kind === "newClient"} onClose={() => setModal(null)} width={640}>
        {modal?.kind === "newClient" && (() => {
          const f = modal.form;
          const set = (patch) => setModal({ ...modal, form: { ...f, ...patch } });
          return (
            <>
              <h2>Informar nuevo cliente</h2>
              <p className="small">
                El cliente quedará asociado a su cartera y visible para la administración.
              </p>
              <div className="formgrid">
                <div><label>Empresa *</label>
                  <input value={f.company} placeholder="Razón social"
                    onChange={(e) => set({ company: e.target.value })} /></div>
                <div><label>Contacto *</label>
                  <input value={f.contact} placeholder="Nombre y apellido"
                    onChange={(e) => set({ contact: e.target.value })} /></div>
                <div><label>Correo</label>
                  <input value={f.email} placeholder="contacto@empresa.cl"
                    onChange={(e) => set({ email: e.target.value })} /></div>
                <div><label>Teléfono</label>
                  <input value={f.phone} placeholder="+56 9 …"
                    onChange={(e) => set({ phone: e.target.value })} /></div>
                <div><label>Ciudad</label>
                  <input value={f.city} placeholder="Santiago"
                    onChange={(e) => set({ city: e.target.value })} /></div>
                <div><label>Tipo de empresa</label>
                  <select value={f.industry} onChange={(e) => set({ industry: e.target.value })}>
                    {INDUSTRIES.map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select></div>
                <div><label>Estado</label>
                  <select value={f.status} onChange={(e) => set({ status: e.target.value })}>
                    <option value="prospect">Prospecto</option>
                    <option value="client">Cliente</option>
                  </select></div>
                <div><label>Plan de interés</label>
                  <select value={f.plan_id} onChange={(e) => set({ plan_id: e.target.value })}>
                    <option value="">— Sin proyección inicial —</option>
                    {paidPlans.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select></div>
              </div>
              <label>Notas</label>
              <textarea rows={2} value={f.note} placeholder="Contexto comercial…"
                onChange={(e) => set({ note: e.target.value })} />
              <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
                <button className="btn ghost" onClick={() => setModal(null)}>Cancelar</button>
                <button className="btn" onClick={createClient}
                  disabled={!f.company.trim() || !f.contact.trim()}>
                  Registrar cliente
                </button>
              </div>
            </>
          );
        })()}
      </Modal>

      {/* ── Modal proyección de cierre ── */}
      <Modal open={modal?.kind === "proj"} onClose={() => setModal(null)} width={640}>
        {modal?.kind === "proj" && (() => {
          const c = modal.client;
          const f = modal.form;
          const set = (patch) => setModal({ ...modal, form: { ...f, ...patch } });
          return (
            <>
              <h2>{c.projection ? "Modificar" : "Crear"} proyección de cierre</h2>
              <p className="small">
                <b>{c.company}</b> · {c.contact || "—"} · {c.city || "—"}
              </p>
              <div className="formgrid">
                <div><label>Etapa</label>
                  <select value={f.stage} onChange={(e) => set({ stage: e.target.value })}>
                    {STAGES.map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select></div>
                <div><label>Plan proyectado</label>
                  <select value={f.plan_id} onChange={(e) => set({ plan_id: e.target.value })}>
                    {paidPlans.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select></div>
                <div><label>Monto mensual (CLP)</label>
                  <input type="number" value={f.monto}
                    onChange={(e) => set({ monto: e.target.value })} /></div>
                <div><label>Probabilidad de cierre (%)</label>
                  <input type="number" min="0" max="100" value={f.prob}
                    onChange={(e) => set({ prob: e.target.value })} /></div>
                <div><label>Fecha estimada de cierre</label>
                  <input type="date" value={f.fecha}
                    onChange={(e) => set({ fecha: e.target.value })} /></div>
              </div>
              <label>Nota</label>
              <textarea rows={2} value={f.nota}
                onChange={(e) => set({ nota: e.target.value })} />
              <div className="row" style={{ justifyContent: "space-between", marginTop: 16 }}>
                {c.projection
                  ? <button className="btn danger" onClick={dropProj}>Quitar proyección</button>
                  : <span />}
                <div className="row">
                  <button className="btn ghost" onClick={() => setModal(null)}>Cancelar</button>
                  <button className="btn" onClick={saveProj} disabled={!f.plan_id || !f.fecha}>
                    Guardar proyección
                  </button>
                </div>
              </div>
            </>
          );
        })()}
      </Modal>
    </>
  );
}
