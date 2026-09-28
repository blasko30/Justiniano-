/* 4 · Ventas (rol admin): KPIs, serie con proyección, tabla por vendedor,
   conversión free→pago y gestión de vendedores (§18). */
import React, { useState } from "react";
import { Modal } from "@justiniano/ui";
import { api } from "../api.js";
import { usePeriod } from "../components/Shell.jsx";
import { useLoad } from "../lib/useLoad.js";
import { Loading, LoadError, useAction, Avatar } from "../components/bits.jsx";
import { LineProj, HBar } from "../components/charts.jsx";
import { NUM, CLP, PLABEL, PAPI, nextMonths } from "../lib/format.js";

const TABS = { vend: "Por vendedor", tipo: "Por tipo de empresa", city: "Por ciudad" };
const BY = { vend: "seller", tipo: "industry", city: "city" };

export default function SalesAdmin() {
  const { period } = usePeriod();
  const run = useAction();
  const [tab, setTab] = useState("vend");
  const [modal, setModal] = useState(null);
  // modal: {kind:"newSeller",form} | {kind:"editSeller",seller,form}

  const ov = useLoad(() => api.adminSales.overview({ period: PAPI[period] }), [period]);
  const sellers = useLoad(() => api.adminSales.sellers(
    { period: PAPI[period], include_inactive: true }), [period]);
  const conv = useLoad(() => api.adminSales.conversion(
    { by: BY[tab], period: PAPI[period] }), [tab, period]);

  if (ov.loading || sellers.loading) return <Loading />;
  if (ov.error) return <LoadError error={ov.error} onRetry={ov.reload} />;
  if (sellers.error) return <LoadError error={sellers.error} onRetry={sellers.reload} />;

  const t = ov.data.totals;
  const serie = ov.data.series || {};
  const hist = serie.monthly_sales_mm || [];
  const proj = hist.length ? [hist[hist.length - 1], ...(serie.projection_mm || [])] : [];
  const labels = [...(serie.months || []), ...nextMonths((serie.projection_mm || []).length)];
  const items = sellers.data.items || [];
  const activeSellers = items.filter((s) => s.active);
  const team = sellers.data.team_totals || {};

  /* ── modales de vendedor ── */
  const openNew = () => setModal({
    kind: "newSeller", form: { name: "", email: "", phone: "", target: "" },
  });
  const openEdit = (s) => {
    // target_clp llega multiplicado por el período; la meta se edita mensual
    const factor = { mes: 1, tri: 3, ano: 12 }[period];
    setModal({
      kind: "editSeller", seller: s,
      form: { name: s.name, phone: "", active: s.active, transferTo: "",
        target: String(Math.round((s.target_clp || 0) / factor)) },
    });
  };

  const createSeller = async () => {
    const f = modal.form;
    const body = { name: f.name.trim(), email: f.email.trim().toLowerCase(),
      target_monthly_clp: parseInt(f.target, 10) || 0 };
    if (f.phone.trim()) body.phone = f.phone.replace(/\s/g, "");
    await run(() => api.adminSales.createSeller(body),
      `Vendedor «${body.name}» creado · invitación enviada por correo`,
      () => { setModal(null); sellers.reload(); });
  };

  const saveSeller = async () => {
    const { seller, form: f } = modal;
    const body = {};
    if (f.name.trim() && f.name.trim() !== seller.name) body.name = f.name.trim();
    if (f.phone.trim()) body.phone = f.phone.replace(/\s/g, "");
    const target = parseInt(f.target, 10);
    if (target > 0) body.target_monthly_clp = target;
    if (f.active !== seller.active) body.active = f.active;
    if (!f.active && f.transferTo) body.transfer_clients_to = f.transferTo;
    await run(() => api.adminSales.patchSeller(seller.seller_id, body),
      `Vendedor «${seller.name}» actualizado`,
      () => { setModal(null); sellers.reload(); });
  };

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Ventas</h1>
        <button className="btn" onClick={openNew}>＋ Nuevo vendedor</button>
      </div>

      <div className="kpis" style={{ margin: "14px 0" }}>
        {[
          [`Ventas totales ${PLABEL[period]}`, CLP(t.sales_clp)],
          ["Cumplimiento de meta", `${t.attainment_pct}%`],
          ["Nuevos contratos", NUM(t.contracts)],
          ["Proyección próximo trimestre", CLP(ov.data.projection_next_quarter_clp)],
          ["Conversión free → pago (global)", `${t.free_to_paid_pct}%`],
        ].map(([l, v]) => (
          <div key={l} className="card" style={{ padding: 16 }}>
            <small>{l}</small>
            <div style={{ fontFamily: "'Nunito'", fontSize: 22, fontWeight: 800, margin: "4px 0" }}>{v}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Ventas mensuales y proyección (MM CLP)</h2>
          <span className="small">— real &nbsp;·&nbsp; ╌ proyección</span>
        </div>
        {hist.length
          ? <LineProj hist={hist} proj={proj} labels={labels} />
          : <p className="small" style={{ marginTop: 8 }}>Sin ventas registradas este año.</p>}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Ventas por vendedor · {PLABEL[period]}</h2>
        {items.length ? (
          <table style={{ marginTop: 8 }}>
            <tbody>
              <tr>
                <th>Vendedor</th><th>Ventas</th><th>Meta</th><th>Cumplimiento</th>
                <th>Contratos</th><th>Conversión free→pago</th>
              </tr>
              {items.map((s) => {
                const pct = s.attainment_pct || 0;
                return (
                  <tr key={s.seller_id} className="click" onClick={() => openEdit(s)}>
                    <td>
                      <div className="row">
                        <Avatar name={s.name} />
                        <b>{s.name}</b>
                        {!s.active && <span className="badge b-mut">Inactivo</span>}
                      </div>
                    </td>
                    <td className="num">{CLP(s.sales_clp)}</td>
                    <td className="num">{CLP(s.target_clp)}</td>
                    <td style={{ minWidth: 140 }}>
                      <HBar pct={pct}
                        color={pct >= 100 ? "#16A34A" : pct >= 80 ? "#FF6B35" : "#DC2626"} />
                      <small>{pct}%</small>
                    </td>
                    <td className="num">{NUM(s.contracts)}</td>
                    <td className="num">
                      <b>{s.free_to_paid_pct}%</b>{" "}
                      <small>({NUM(s.free_accounts_assigned)} free asignados)</small>
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td><b>Total equipo</b></td>
                <td className="num"><b>{CLP(team.sales_clp)}</b></td>
                <td className="num">{CLP(team.target_clp)}</td>
                <td><HBar pct={team.attainment_pct || 0} /></td>
                <td className="num"><b>{NUM(t.contracts)}</b></td>
                <td className="num"><b>{t.free_to_paid_pct}%</b></td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="small" style={{ marginTop: 8 }}>
            Aún no hay vendedores. Cree el primero con «＋ Nuevo vendedor».
          </p>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Conversión free → pago</h2>
        <div className="tabs" style={{ marginTop: 8 }}>
          {Object.keys(TABS).map((k) => (
            <div key={k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>
              {TABS[k]}
            </div>
          ))}
        </div>
        {conv.loading ? <Loading /> : conv.error
          ? <LoadError error={conv.error} onRetry={conv.reload} />
          : (conv.data.items || []).length === 0
            ? <p className="small">Sin cuentas free asignadas en el período.</p>
            : (conv.data.items || []).map((x) => (
              <div key={x.key} style={{ margin: "10px 0" }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <small><b>{x.key}</b></small>
                  <small><b>{x.conversion_pct}%</b>{" "}
                    <span style={{ fontWeight: 400 }}>({x.converted} de {x.eligible})</span>
                  </small>
                </div>
                <HBar pct={x.conversion_pct * 2.2} />
              </div>
            ))}
        <small>
          Conversión = cuentas Gratuito que pasaron a plan de pago dentro de 90 días ·{" "}
          {PLABEL[period]}.
        </small>
      </div>

      {/* ── Modal nuevo vendedor ── */}
      <Modal open={modal?.kind === "newSeller"} onClose={() => setModal(null)} width={640}>
        {modal?.kind === "newSeller" && (
          <>
            <h2>Nuevo vendedor</h2>
            <p className="small" style={{ margin: "8px 0" }}>
              Se crea la cuenta interna con rol vendedor y se envía la invitación por
              correo para que fije su contraseña (la consola nunca crea contraseñas).
            </p>
            <div className="formgrid">
              <div>
                <label>Nombre completo *</label>
                <input value={modal.form.name} placeholder="Nombre y apellido"
                  onChange={(e) => setModal({ ...modal, form: { ...modal.form, name: e.target.value } })} />
              </div>
              <div>
                <label>Correo corporativo *</label>
                <input value={modal.form.email} placeholder="nombre@justiniano.cl"
                  onChange={(e) => setModal({ ...modal, form: { ...modal.form, email: e.target.value } })} />
              </div>
              <div>
                <label>Teléfono</label>
                <input value={modal.form.phone} placeholder="+56 9 …"
                  onChange={(e) => setModal({ ...modal, form: { ...modal.form, phone: e.target.value } })} />
              </div>
              <div>
                <label>Meta mensual (CLP) *</label>
                <input type="number" value={modal.form.target} placeholder="9000000"
                  onChange={(e) => setModal({ ...modal, form: { ...modal.form, target: e.target.value } })} />
              </div>
            </div>
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
              <button className="btn ghost" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn" onClick={createSeller}
                disabled={!modal.form.name.trim() || !modal.form.email.trim()
                  || !(parseInt(modal.form.target, 10) > 0)}>
                Crear vendedor
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* ── Modal editar vendedor ── */}
      <Modal open={modal?.kind === "editSeller"} onClose={() => setModal(null)} width={640}>
        {modal?.kind === "editSeller" && (
          <>
            <h2>Vendedor · {modal.seller.name}</h2>
            <p className="small" style={{ margin: "8px 0" }}>{modal.seller.email}</p>
            <div className="formgrid">
              <div>
                <label>Nombre completo</label>
                <input value={modal.form.name}
                  onChange={(e) => setModal({ ...modal, form: { ...modal.form, name: e.target.value } })} />
              </div>
              <div>
                <label>Teléfono (dejar vacío para no cambiar)</label>
                <input value={modal.form.phone} placeholder="+56 9 …"
                  onChange={(e) => setModal({ ...modal, form: { ...modal.form, phone: e.target.value } })} />
              </div>
              <div>
                <label>Meta mensual (CLP)</label>
                <input type="number" value={modal.form.target}
                  onChange={(e) => setModal({ ...modal, form: { ...modal.form, target: e.target.value } })} />
              </div>
              <div>
                <label>Estado</label>
                <select value={modal.form.active ? "on" : "off"}
                  onChange={(e) => setModal({
                    ...modal, form: { ...modal.form, active: e.target.value === "on" },
                  })}>
                  <option value="on">Activo</option>
                  <option value="off">Inactivo</option>
                </select>
              </div>
            </div>
            {!modal.form.active && modal.seller.active && (
              <>
                <label>Reasignar su cartera a *</label>
                <select value={modal.form.transferTo}
                  onChange={(e) => setModal({
                    ...modal, form: { ...modal.form, transferTo: e.target.value },
                  })}>
                  <option value="">— Seleccione un vendedor activo —</option>
                  {activeSellers.filter((s) => s.seller_id !== modal.seller.seller_id)
                    .map((s) => (
                      <option key={s.seller_id} value={s.seller_id}>{s.name}</option>
                    ))}
                </select>
                <small>
                  Para desactivar un vendedor con cartera debe reasignar sus clientes a
                  otro vendedor activo.
                </small>
              </>
            )}
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
              <button className="btn ghost" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn" onClick={saveSeller}>Guardar cambios</button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
