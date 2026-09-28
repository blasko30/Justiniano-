/* 5 · Revisores: KPIs, bolsa de pendientes, carga por revisor, postulaciones
   y tarifario de honorarios (§21). */
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "@justiniano/ui";
import { ApiError } from "@justiniano/api";
import { api } from "../api.js";
import { useLoad } from "../lib/useLoad.js";
import { Loading, LoadError, useAction, Avatar } from "../components/bits.jsx";
import { HBar } from "../components/charts.jsx";
import { NUM, CLP, fmtDate, isoInDays } from "../lib/format.js";

export const lawyerStatus = (l) => {
  if (l.suspended_at) return ["Suspendido", "b-bad"];
  if (l.paused || !l.available) return ["En pausa", "b-mut"];
  if (l.active_cases >= l.max_concurrent_cases) return ["Al límite", "b-warn"];
  return ["Disponible", "b-ok"];
};
export const capColor = (p) => (p >= 100 ? "#DC2626" : p >= 70 ? "#D97706" : "#16A34A");
const fmtWait = (h) => (h == null ? "—" : h < 1 ? `${Math.round(h * 60)} min`
  : `${h.toLocaleString("es-CL", { maximumFractionDigits: 1 })} h`);
const age = (birth) => {
  if (!birth) return null;
  const b = new Date(birth), now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) a -= 1;
  return a;
};

export default function Reviewers() {
  const navigate = useNavigate();
  const run = useAction();
  const [modal, setModal] = useState(null);
  // modal: {kind:"assign",review,lawyerId} | {kind:"app",app,specs} |
  //        {kind:"reject",app,reason,detail} | {kind:"rates",form}

  const ov = useLoad(() => api.adminReviewers.overview(), []);
  const pend = useLoad(() => api.adminReviewers.reviews(
    { status: "pending_assignment", page_size: 50 }), []);
  const team = useLoad(() => api.adminReviewers.lawyers(
    { verification_status: "verified", page_size: 100 }), []);
  const apps = useLoad(() => api.adminReviewers.lawyers(
    { verification_status: "pending", page_size: 50 }), []);
  const rates = useLoad(() => api.adminReviewers.rates().catch((e) => {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }), []);

  const loading = ov.loading || pend.loading || team.loading || apps.loading || rates.loading;
  const error = ov.error || pend.error || team.error || apps.error || rates.error;
  if (loading) return <Loading />;
  if (error) {
    const reload = () => { ov.reload(); pend.reload(); team.reload(); apps.reload(); rates.reload(); };
    return <LoadError error={error} onRetry={reload} />;
  }

  const o = ov.data;
  const pending = pend.data.items || [];
  const lawyers = (team.data.items || []).filter((l) => !l.suspended_at);
  const applications = apps.data.items || [];
  const rt = rates.data;
  const reloadAll = () => { ov.reload(); pend.reload(); team.reload(); };

  /* ── acciones ── */
  const assignOk = async () => {
    const { review, lawyerId } = modal;
    if (!lawyerId) return;
    const l = lawyers.find((x) => x.id === lawyerId);
    await run(() => api.adminReviewers.assign(review.id, { lawyer_id: lawyerId }),
      `«${review.title}» asignado a ${l?.name || lawyerId} · pendiente de aceptación`,
      () => { setModal(null); reloadAll(); });
  };

  const approveApp = async () => {
    const { app, specs } = modal;
    const sel = Object.keys(specs).filter((k) => specs[k]);
    if (!sel.length) return;
    await run(() => api.adminReviewers.patchVerification(app.id,
      { status: "verified", approved_specialties: sel }),
    `Acreditación de ${app.name} aprobada (${sel.length} especialidad${sel.length > 1 ? "es" : ""}) · notificado por correo`,
    () => { setModal(null); apps.reload(); team.reload(); ov.reload(); });
  };

  const rejectApp = async () => {
    const { app, reason, detail } = modal;
    const text = detail.trim() ? `${reason} — ${detail.trim()}` : reason;
    await run(() => api.adminReviewers.patchVerification(app.id,
      { status: "rejected", rejection_reason: text }),
    `Postulación de ${app.name} rechazada · notificado con el motivo`,
    () => { setModal(null); apps.reload(); ov.reload(); });
  };

  const saveRates = async () => {
    const f = modal.form;
    const body = {
      review_std_clp: parseInt(f.rev_std, 10) || 0,
      review_urgent_clp: parseInt(f.rev_urg, 10) || 0,
      consultation_std_clp: parseInt(f.con_std, 10) || 0,
      consultation_urgent_clp: parseInt(f.con_urg, 10) || 0,
      sla_bonus_pct: parseInt(f.bono, 10) || 0,
      effective_from: f.from,
    };
    await run(() => api.adminReviewers.putRates(body),
      (r) => `Tarifario versión ${r.version} guardado · vigente desde ${r.effective_from}`,
      () => { setModal(null); rates.reload(); });
  };

  const openRates = () => setModal({
    kind: "rates",
    form: {
      rev_std: rt?.review_std_clp ?? 18000, rev_urg: rt?.review_urgent_clp ?? 28000,
      con_std: rt?.consultation_std_clp ?? 8000, con_urg: rt?.consultation_urgent_clp ?? 12000,
      bono: rt?.sla_bonus_pct ?? 5, from: isoInDays(1),
    },
  });

  const openApp = (a) => {
    const declared = [...new Set([...(a.specialties || []), ...(a.specialties_pending || [])])];
    const specs = {};
    declared.forEach((s) => { specs[s] = true; });
    setModal({ kind: "app", app: a, specs });
  };

  const urgBadge = (u) => (
    <span className={`badge ${u === "fast" ? "b-bad" : "b-info"}`}>
      {u === "fast" ? "Urgente · 8 h" : "Normal · 48 h"}
    </span>
  );

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>Revisores</h1>
          <p className="small">
            Abogados habilitados que revisan documentos y responden consultas.
            SLA: urgente 8 h hábiles · normal 48 h.
          </p>
        </div>
        <button className="btn ghost" onClick={openRates}>💰 Tarifario de honorarios</button>
      </div>

      {/* KPIs */}
      <div className="kpis" style={{ margin: "14px 0" }}>
        {[
          ["Revisores activos", NUM(o.reviewers.active),
            <span key="a" className="delta neu">
              {o.reviewers.available} disponibles · {o.reviewers.paused} en pausa
            </span>],
          ["Casos en curso", NUM(o.workload.cases_in_progress),
            <span key="b" className={`delta ${o.workload.utilization_pct >= 85 ? "down" : "neu"}`}>
              {o.workload.utilization_pct}% de la capacidad
            </span>],
          ["Pendientes de asignar", NUM(o.pending_assignment.total),
            o.pending_assignment.urgent
              ? <span key="c" className="delta down">▲ {o.pending_assignment.urgent} urgentes</span>
              : <span key="c" className="delta neu">sin urgentes</span>],
          ["Postulaciones por revisar", NUM(o.applications_pending),
            <span key="d" className="delta neu">meta: resolver en 48 h</span>],
          ["SLA global · 90 d", o.sla_global_90d_pct != null ? `${o.sla_global_90d_pct}%` : "—",
            <span key="e" className="delta neu">entregas dentro de plazo</span>],
        ].map(([t, v, d], i) => (
          <div key={i} className="card" style={{ padding: 16 }}>
            <small>{t}</small>
            <div style={{ fontFamily: "'Nunito'", fontSize: 26, fontWeight: 800, margin: "4px 0" }}>{v}</div>
            {d}
          </div>
        ))}
      </div>

      {/* Bolsa de pendientes */}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Labores pendientes de asignar</h2>
          <span className={`badge ${o.pending_assignment.urgent ? "b-bad" : "b-mut"}`}>
            {pending.length} en bolsa
          </span>
        </div>
        {pending.length ? (
          <>
            <table style={{ marginTop: 8 }}>
              <tbody>
                <tr>
                  <th>Requerimiento</th><th>Tipo</th><th>Área</th>
                  <th>Cliente · plan</th><th>Urgencia</th><th>En espera</th><th></th>
                </tr>
                {pending.map((p) => (
                  <tr key={p.id}>
                    <td style={{ maxWidth: 280 }}><b>{p.title}</b></td>
                    <td>{p.target_type === "document" ? "📄 Revisión" : "💬 Consulta"}</td>
                    <td>{p.area || "—"}</td>
                    <td>
                      {p.client?.company || "—"}<br />
                      <small>Plan {p.client?.plan || "—"}</small>
                    </td>
                    <td>{urgBadge(p.urgency)}</td>
                    <td>
                      <b style={{ color: p.urgency === "fast" ? "var(--bad)" : "inherit" }}>
                        {fmtWait(p.waiting_business_hours)}
                      </b>
                    </td>
                    <td>
                      <button className="btn sec xs"
                        onClick={() => setModal({ kind: "assign", review: p, lawyerId: "" })}>
                        Asignar →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <small style={{ display: "block", marginTop: 8 }}>
              Estos casos también están visibles en la bolsa de los revisores; la
              asignación manual los retira de la bolsa y notifica al abogado (queda
              pendiente de su aceptación).
            </small>
          </>
        ) : (
          <p className="small" style={{ marginTop: 8 }}>
            ✅ No hay labores pendientes de asignar.
          </p>
        )}
      </div>

      {/* Carga por revisor */}
      <div className="card" style={{ marginTop: 16 }}>
        <h2>Carga por revisor</h2>
        {lawyers.length ? (
          <table style={{ marginTop: 8 }}>
            <tbody>
              <tr>
                <th>Revisor</th><th>Especialidades</th><th>Casos en curso</th>
                <th style={{ minWidth: 150 }}>Capacidad</th><th>SLA</th>
                <th>Rating</th><th>Estado</th><th></th>
              </tr>
              {lawyers.map((l) => {
                const c = l.active_cases || 0;
                const pct = Math.round((c / (l.max_concurrent_cases || 1)) * 100);
                const [en, ec] = lawyerStatus(l);
                const sla = l.stats?.sla_compliance_pct;
                return (
                  <tr key={l.id} className="click" onClick={() => navigate(`/revisores/${l.id}`)}>
                    <td>
                      <div className="row"><Avatar name={l.name} /><b>{l.name}</b></div>
                    </td>
                    <td><small>{(l.specialties || []).join(" · ") || "—"}</small></td>
                    <td className="num">
                      <b>{c}</b>
                      {l.urgent_in_progress
                        ? <> <span className="badge b-bad">{l.urgent_in_progress} urg.</span></>
                        : null}
                    </td>
                    <td>
                      <HBar pct={pct} color={capColor(pct)} />
                      <small>{c} de {l.max_concurrent_cases} ({pct}%)</small>
                    </td>
                    <td className="num" style={{
                      color: sla == null ? "inherit"
                        : sla >= 95 ? "var(--ok)" : sla >= 90 ? "var(--warn)" : "var(--bad)",
                    }}>
                      <b>{sla != null ? `${sla}%` : "—"}</b>
                    </td>
                    <td className="num">
                      {l.stats?.rating != null ? `${Number(l.stats.rating).toFixed(1)} ★` : "—"}
                    </td>
                    <td><span className={`badge ${ec}`}>{en}</span></td>
                    <td>
                      <small style={{ color: "var(--naranja)", fontWeight: 700 }}>Ver ficha →</small>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="small" style={{ marginTop: 8 }}>Aún no hay revisores acreditados.</p>
        )}
      </div>

      {/* Postulaciones */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Postulaciones pendientes de revisar</h2>
          <span className={`badge ${applications.length ? "b-warn" : "b-mut"}`}>
            {applications.length} pendientes
          </span>
        </div>
        {applications.length ? (
          <>
            <table style={{ marginTop: 8 }}>
              <tbody>
                <tr>
                  <th>Postulante</th><th>Universidad del título</th><th>Año</th>
                  <th>Especialidades declaradas</th><th>Recibida</th><th>Adjuntos</th><th></th>
                </tr>
                {applications.map((a) => {
                  const declared = [...new Set([...(a.specialties || []), ...(a.specialties_pending || [])])];
                  const years = age(a.birth_date);
                  return (
                    <tr key={a.id}>
                      <td>
                        <b>{a.name}</b><br />
                        <small>{a.rut || "—"}{years != null ? ` · ${years} años` : ""}</small>
                      </td>
                      <td>{a.university || "—"}</td>
                      <td className="num">{a.degree_year || "—"}</td>
                      <td><small>{declared.join(" · ") || "—"}</small></td>
                      <td>{fmtDate(a.submitted_at)}</td>
                      <td><small>📎 {NUM((a.documents || []).length)} documento(s)</small></td>
                      <td>
                        <button className="btn xs" onClick={() => openApp(a)}>Revisar →</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <small style={{ display: "block", marginTop: 8 }}>
              La cuenta del postulante ya existe con acceso limitado (verificación
              paralela): no recibe requerimientos hasta aprobar esta revisión.
            </small>
          </>
        ) : (
          <p className="small" style={{ marginTop: 8 }}>✅ No hay postulaciones pendientes.</p>
        )}
      </div>

      {/* Tarifario */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h2>Tarifario de honorarios</h2>
            <small>
              {rt
                ? <>Versión {rt.version} · vigente desde {rt.effective_from} · los honorarios ya devengados no se recalculan</>
                : "No hay tarifario vigente · cree la primera versión"}
            </small>
          </div>
          <button className="btn ghost xs" onClick={openRates}>Modificar tarifario</button>
        </div>
        {rt && (
          <div className="kpis" style={{ marginTop: 12 }}>
            {[["Revisión · normal", CLP(rt.review_std_clp)],
              ["Revisión · urgente", CLP(rt.review_urgent_clp)],
              ["Consulta · normal", CLP(rt.consultation_std_clp)],
              ["Consulta · urgente", CLP(rt.consultation_urgent_clp)],
              ["Bono SLA ≥ 95%", `+${rt.sla_bonus_pct}%`]].map(([l, v]) => (
              <div key={l} className="card" style={{ padding: 14 }}>
                <small>{l}</small>
                <div style={{ fontFamily: "'Nunito'", fontSize: 22, fontWeight: 800 }}>{v}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Modal asignar ── */}
      <Modal open={modal?.kind === "assign"} onClose={() => setModal(null)} width={640}>
        {modal?.kind === "assign" && (() => {
          const p = modal.review;
          const cands = lawyers
            .map((l) => ({ l, match: (l.specialties || []).includes(p.area),
              ratio: (l.active_cases || 0) / (l.max_concurrent_cases || 1) }))
            .sort((a, b) => (b.match - a.match) || (a.ratio - b.ratio));
          return (
            <>
              <h2>Asignar requerimiento</h2>
              <p className="small" style={{ margin: "8px 0" }}>
                <b>{p.title}</b> · {p.area || "—"} · {p.client?.company || "—"} · {urgBadge(p.urgency)}
              </p>
              <p className="small">
                Ordenados por especialidad y menor carga. El abogado recibe la
                asignación pendiente de aceptación.
              </p>
              <div style={{ maxHeight: 320, overflow: "auto", marginTop: 6 }}>
                {cands.map(({ l, match }) => {
                  const pct = Math.round(((l.active_cases || 0) / (l.max_concurrent_cases || 1)) * 100);
                  const block = l.paused || !l.available;
                  return (
                    <label key={l.id} style={{
                      display: "flex", alignItems: "center", gap: 12,
                      border: "1px solid var(--border)", borderRadius: 12,
                      padding: "10px 12px", margin: "7px 0",
                      cursor: block ? "not-allowed" : "pointer", opacity: block ? 0.5 : 1,
                    }}>
                      <input type="radio" name="asg" value={l.id} style={{ width: "auto" }}
                        disabled={block} checked={modal.lawyerId === l.id}
                        onChange={() => setModal({ ...modal, lawyerId: l.id })} />
                      <Avatar name={l.name} />
                      <div style={{ flex: 1 }}>
                        <b style={{ fontSize: 14 }}>{l.name}</b>{" "}
                        {match
                          ? <span className="badge b-ok">Especialidad ✓</span>
                          : <span className="badge b-mut">Otra especialidad</span>}{" "}
                        {block ? <span className="badge b-mut">En pausa</span> : null}
                        <div style={{ maxWidth: 220 }}><HBar pct={pct} color={capColor(pct)} /></div>
                        <small>{l.active_cases || 0} de {l.max_concurrent_cases} casos ({pct}%)</small>
                      </div>
                    </label>
                  );
                })}
              </div>
              <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
                <button className="btn ghost" onClick={() => setModal(null)}>Cancelar</button>
                <button className="btn" onClick={assignOk} disabled={!modal.lawyerId}>
                  Asignar requerimiento
                </button>
              </div>
            </>
          );
        })()}
      </Modal>

      {/* ── Modal revisar postulación ── */}
      <Modal open={modal?.kind === "app"} onClose={() => setModal(null)} width={640}>
        {modal?.kind === "app" && (() => {
          const a = modal.app;
          const years = age(a.birth_date);
          const docLabel = { id_document: "👁️ Ver documento de identidad",
            degree_certificate: "👁️ Ver certificado de título" };
          return (
            <>
              <h2>Revisar postulación · {a.name}</h2>
              <div className="formgrid" style={{ marginTop: 10 }}>
                {[["RUT", a.rut || "—"], ["Correo", a.email || "—"],
                  ["Edad declarada", years != null ? `${years} años (≥ 18 ${years >= 18 ? "✓" : "✗"})` : "—"],
                  ["Recibida", fmtDate(a.submitted_at)],
                  ["Universidad del título", a.university || "—"],
                  ["Año de titulación", a.degree_year || "—"]].map(([l, v]) => (
                  <div key={l}>
                    <label>{l}</label>
                    <div style={{ padding: "8px 0", borderBottom: "1px dashed var(--border)" }}>
                      <b style={{ fontSize: 14 }}>{v}</b>
                    </div>
                  </div>
                ))}
              </div>
              <label style={{ marginTop: 14 }}>Documentos adjuntos</label>
              <div className="row" style={{ gap: 10 }}>
                {(a.documents || []).length === 0 && <small>Sin documentos adjuntos.</small>}
                {(a.documents || []).map((d) => (
                  <a key={d.kind} className="btn sec xs" href={d.sas_url}
                    target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                    {docLabel[d.kind] || `👁️ Ver ${d.kind}`}
                  </a>
                ))}
              </div>
              <small style={{ display: "block", marginTop: 6 }}>
                URL segura de 15 min (solo consola) · acceso registrado en la auditoría
                administrativa.
              </small>
              <label style={{ marginTop: 14 }}>
                Especialidades a aprobar{" "}
                <small style={{ fontWeight: 400 }}>
                  (puede aprobar un subconjunto de las declaradas)
                </small>
              </label>
              <div className="row" style={{ gap: 12 }}>
                {Object.keys(modal.specs).map((e) => (
                  <label key={e} style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
                    <input type="checkbox" checked={modal.specs[e]} style={{ width: "auto" }}
                      onChange={(ev) => setModal({
                        ...modal, specs: { ...modal.specs, [e]: ev.target.checked },
                      })} /> {e}
                  </label>
                ))}
              </div>
              <div className="row" style={{ justifyContent: "space-between", marginTop: 18 }}>
                <button className="btn danger"
                  onClick={() => setModal({
                    kind: "reject", app: a,
                    reason: "Documento de identidad ilegible o no coincide", detail: "",
                  })}>
                  Rechazar…
                </button>
                <div className="row">
                  <button className="btn ghost" onClick={() => setModal(null)}>Cerrar</button>
                  <button className="btn" onClick={approveApp}
                    disabled={!Object.values(modal.specs).some(Boolean)}>
                    Aprobar acreditación ✓
                  </button>
                </div>
              </div>
            </>
          );
        })()}
      </Modal>

      {/* ── Modal rechazo de postulación ── */}
      <Modal open={modal?.kind === "reject"} onClose={() => setModal(null)}>
        {modal?.kind === "reject" && (
          <>
            <h2>Rechazar postulación · {modal.app.name}</h2>
            <p className="small" style={{ margin: "8px 0" }}>
              El postulante verá el motivo en su perfil y podrá corregir y reenviar
              sus documentos.
            </p>
            <label>Motivo del rechazo *</label>
            <select value={modal.reason}
              onChange={(e) => setModal({ ...modal, reason: e.target.value })}>
              {["Documento de identidad ilegible o no coincide",
                "Certificado de título no verificable", "Universidad no reconocida",
                "Datos inconsistentes con los registros", "Otro"].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <label>Detalle para el postulante</label>
            <textarea rows={2} value={modal.detail}
              onChange={(e) => setModal({ ...modal, detail: e.target.value })} />
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
              <button className="btn ghost" onClick={() => openApp(modal.app)}>← Volver</button>
              <button className="btn danger" onClick={rejectApp}>Rechazar postulación</button>
            </div>
          </>
        )}
      </Modal>

      {/* ── Modal tarifario ── */}
      <Modal open={modal?.kind === "rates"} onClose={() => setModal(null)} width={640}>
        {modal?.kind === "rates" && (
          <>
            <h2>Modificar tarifario de honorarios</h2>
            <p className="small" style={{ margin: "8px 0" }}>
              Se crea la versión {(rt?.version || 0) + 1} con vigencia desde la fecha
              indicada. Los honorarios ya devengados conservan la versión con la que
              se calcularon.
            </p>
            <div className="formgrid">
              {[["rev_std", "Revisión · normal (CLP)"], ["rev_urg", "Revisión · urgente (CLP)"],
                ["con_std", "Consulta · normal (CLP)"], ["con_urg", "Consulta · urgente (CLP)"],
                ["bono", "Bono SLA ≥ 95% (%)"]].map(([k, l]) => (
                <div key={k}>
                  <label>{l}</label>
                  <input type="number" value={modal.form[k]}
                    onChange={(e) => setModal({
                      ...modal, form: { ...modal.form, [k]: e.target.value },
                    })} />
                </div>
              ))}
              <div>
                <label>Vigente desde</label>
                <input type="date" value={modal.form.from}
                  onChange={(e) => setModal({
                    ...modal, form: { ...modal.form, from: e.target.value },
                  })} />
              </div>
            </div>
            {(Number(modal.form.rev_urg) < Number(modal.form.rev_std)
              || Number(modal.form.con_urg) < Number(modal.form.con_std)) && (
              <p className="small" style={{ color: "var(--bad)", marginTop: 10 }}>
                La tarifa urgente no puede ser menor que la normal.
              </p>
            )}
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
              <button className="btn ghost" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn" onClick={saveRates}
                disabled={Number(modal.form.rev_urg) < Number(modal.form.rev_std)
                  || Number(modal.form.con_urg) < Number(modal.form.con_std)}>
                Guardar nueva versión
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
