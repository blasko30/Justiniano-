/* 5b · Ficha del revisor: KPIs, casos en curso, especialidades, gestión y
   suspensión (§21.9–21.11). */
import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Modal, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { useLoad } from "../lib/useLoad.js";
import { Loading, LoadError, useAction, Avatar } from "../components/bits.jsx";
import { Delta } from "../components/charts.jsx";
import { NUM, CLP, REASSIGN_REASONS } from "../lib/format.js";

const fmtDue = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("es-CL", { weekday: "short", day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}`;
};

export default function ReviewerDetail() {
  const { lawyerId } = useParams();
  const navigate = useNavigate();
  const run = useAction();
  const toast = useToast();
  const [modal, setModal] = useState(null);
  // modal: {kind:"reassign",review,to,reason,detail} | {kind:"suspend",reason}

  const det = useLoad(() => api.adminReviewers.lawyerDetail(lawyerId), [lawyerId]);
  const team = useLoad(() => api.adminReviewers.lawyers(
    { verification_status: "verified", page_size: 100 }), []);
  const areas = useLoad(() => api.catalog.documentAreas().catch(() => null), []);

  const back = (
    <div className="crumb" onClick={() => navigate("/revisores")}>← Volver a revisores</div>
  );

  if (det.loading || team.loading || areas.loading) return <>{back}<Loading /></>;
  if (det.error) return <>{back}<LoadError error={det.error} onRetry={det.reload} /></>;

  const l = det.data;
  const cases = l.active_reviews || [];
  const cap = l.max_concurrent_cases || 1;
  const pct = Math.round((l.kpis.active_cases / cap) * 100);
  const estado = l.suspended_at ? ["Suspendido", "b-bad"]
    : l.paused || !l.available ? ["En pausa", "b-mut"]
      : l.kpis.active_cases >= cap ? ["Al límite", "b-warn"] : ["Disponible", "b-ok"];

  const catalog = areas.data?.items?.length
    ? areas.data.items.map((a) => a.id)
    : l.specialties || [];
  const areaName = (id) =>
    areas.data?.items?.find((a) => a.id === id)?.name || id;

  const candidates = (team.data?.items || [])
    .filter((x) => !x.suspended_at && x.id !== l.id);

  /* ── acciones ── */
  const patch = (body, msg) =>
    run(() => api.adminReviewers.patchLawyer(l.id, body), msg, () => det.reload());

  const toggleSpec = (id) => {
    const has = (l.specialties || []).includes(id);
    if (has && (l.specialties || []).length <= 1) {
      toast("Debe conservar al menos una especialidad", "warn");
      return;
    }
    const next = has
      ? l.specialties.filter((s) => s !== id)
      : [...(l.specialties || []), id];
    patch({ approved_specialties: next }, "Especialidades actualizadas");
  };

  const setCap = (delta) => {
    const next = cap + delta;
    if (next < 1 || next > 20) return;
    patch({ max_concurrent_cases: next }, null);
  };

  const togglePause = () => patch(
    { paused: !l.paused },
    l.paused ? `${l.name} vuelve a recibir asignaciones` : `Asignaciones pausadas para ${l.name}`,
  );

  const reassignOk = async (toPool) => {
    const m = modal;
    if (m.reason === "other" && !m.detail.trim()) return;
    const body = {
      lawyer_id: toPool ? null : m.to,
      reason: m.reason,
      ...(m.detail.trim() ? { detail: m.detail.trim() } : {}),
    };
    const toName = candidates.find((c) => c.id === m.to)?.name;
    await run(() => api.adminReviewers.reassign(m.review.id, body),
      toPool
        ? `«${m.review.title}» devuelto a la bolsa de requerimientos`
        : `Caso reasignado de ${l.name} a ${toName || "otro revisor"} · ambos notificados`,
      () => { setModal(null); det.reload(); });
  };

  const suspendOk = async () => {
    if (modal.reason.trim().length < 10) return;
    await run(() => api.adminReviewers.suspendLawyer(l.id, { reason: modal.reason.trim() }),
      `${l.name} suspendido · sus casos volvieron a la bolsa`,
      () => { setModal(null); navigate("/revisores"); });
  };

  return (
    <>
      {back}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <Avatar name={l.name} size={48} fontSize={18} />
          <div>
            <h1 style={{ fontSize: 24 }}>{l.name}</h1>
            <small>
              {l.university || "—"} · titulado {l.degree_year || "—"}
              {l.verification_status === "verified" ? " · acreditación verificada ✓" : ""}
            </small>
          </div>
        </div>
        <span className={`badge ${estado[1]}`} style={{ fontSize: 13, padding: "6px 14px" }}>
          {estado[0]}
        </span>
      </div>

      <div className="kpis" style={{ margin: "16px 0" }}>
        {[
          ["Casos en curso", `${l.kpis.active_cases} / ${cap}`,
            <span key="a" className={`delta ${pct >= 100 ? "down" : "neu"}`}>
              {pct}% de su capacidad
            </span>],
          ["Urgentes en curso", NUM(l.kpis.urgent_in_progress), null],
          ["SLA · 90 días", l.kpis.sla_90d_pct != null ? `${l.kpis.sla_90d_pct}%` : "—",
            l.kpis.sla_90d_pct != null
              ? <Delta key="c" v={l.kpis.sla_90d_pct >= 95 ? 2 : -2} /> : null],
          ["Completados · total", NUM(l.kpis.delivered_total), null],
          ["Rating de clientes",
            l.kpis.rating != null ? `${Number(l.kpis.rating).toFixed(1)} ★` : "—", null],
          ["Honorarios · mes", CLP(l.kpis.fees_month_clp),
            <span key="f" className="delta neu">devengados</span>],
        ].map(([t, v, d], i) => (
          <div key={i} className="card" style={{ padding: 16 }}>
            <small>{t}</small>
            <div style={{ fontFamily: "'Nunito'", fontSize: 22, fontWeight: 800, margin: "4px 0" }}>{v}</div>
            {d}
          </div>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.5fr 1fr" }}>
        <div className="card">
          <h2>Casos en curso</h2>
          {cases.length ? (
            <table style={{ marginTop: 8 }}>
              <tbody>
                <tr>
                  <th>Requerimiento</th><th>Cliente</th><th>Urgencia</th>
                  <th>Vence</th><th></th>
                </tr>
                {cases.map((cs) => (
                  <tr key={cs.id}>
                    <td><b>{cs.title}</b></td>
                    <td>{cs.client_company || "—"}</td>
                    <td>
                      <span className={`badge ${cs.urgency === "fast" ? "b-bad" : "b-info"}`}>
                        {cs.urgency === "fast" ? "Urgente" : "Normal"}
                      </span>
                    </td>
                    <td>{fmtDue(cs.sla_due_at)}</td>
                    <td>
                      <button className="btn ghost xs"
                        onClick={() => setModal({
                          kind: "reassign", review: cs,
                          to: candidates[0]?.id || "", reason: "overload", detail: "",
                        })}>
                        Reasignar…
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="small" style={{ marginTop: 8 }}>Sin casos en curso.</p>
          )}
        </div>

        <div>
          <div className="card">
            <h2>Especialidades aprobadas</h2>
            <p className="small">
              Determinan la asignación automática y su bolsa. Los cambios rigen de
              inmediato.
            </p>
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              {catalog.map((id) => (
                <button key={id}
                  className={`btn ${(l.specialties || []).includes(id) ? "" : "ghost"} xs`}
                  style={{ borderRadius: 99 }} onClick={() => toggleSpec(id)}>
                  {areaName(id)}
                </button>
              ))}
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h2>Gestión</h2>
            <div className="limitrow">
              <span className="small">Recibe requerimientos urgentes</span>
              <b>{l.accepts_urgent ? "Sí" : "No"} <small>(preferencia del abogado)</small></b>
            </div>
            <div className="limitrow">
              <span className="small">Capacidad máxima simultánea</span>
              <span>
                <button className="btn ghost xs" onClick={() => setCap(-1)}>−</button>
                <b style={{ margin: "0 8px" }}>{cap}</b>
                <button className="btn ghost xs" onClick={() => setCap(1)}>＋</button>
              </span>
            </div>
            <div className="row" style={{ marginTop: 14, gap: 10 }}>
              <button className={`btn ${l.paused ? "sec" : "ghost"}`} onClick={togglePause}>
                {l.paused ? "▶ Reanudar asignaciones" : "⏸ Pausar asignaciones"}
              </button>
              <button className="btn danger"
                onClick={() => setModal({ kind: "suspend", reason: "" })}>
                Suspender…
              </button>
            </div>
            <small style={{ display: "block", marginTop: 10 }}>
              Pausar detiene nuevas asignaciones sin afectar los casos en curso.
              Suspender además devuelve sus casos a la bolsa.
            </small>
          </div>
        </div>
      </div>

      {/* ── Modal reasignar ── */}
      <Modal open={modal?.kind === "reassign"} onClose={() => setModal(null)}>
        {modal?.kind === "reassign" && (
          <>
            <h2>Reasignar caso</h2>
            <p className="small" style={{ margin: "8px 0" }}>
              <b>{modal.review.title}</b> · {modal.review.client_company || "—"} ·
              actualmente con <b>{l.name}</b>
            </p>
            <label>Nuevo revisor</label>
            <select value={modal.to} onChange={(e) => setModal({ ...modal, to: e.target.value })}>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.active_cases}/{c.max_concurrent_cases} casos
                  {c.paused || !c.available ? " · en pausa" : ""}
                </option>
              ))}
            </select>
            <label>Motivo (queda en la auditoría)</label>
            <select value={modal.reason}
              onChange={(e) => setModal({ ...modal, reason: e.target.value })}>
              {REASSIGN_REASONS.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
            {modal.reason === "other" && (
              <>
                <label>Detalle del motivo *</label>
                <textarea rows={2} value={modal.detail}
                  onChange={(e) => setModal({ ...modal, detail: e.target.value })} />
              </>
            )}
            <div className="row" style={{ justifyContent: "space-between", marginTop: 16 }}>
              <button className="btn danger" onClick={() => reassignOk(true)}>
                Devolver a la bolsa
              </button>
              <div className="row">
                <button className="btn ghost" onClick={() => setModal(null)}>Cancelar</button>
                <button className="btn" onClick={() => reassignOk(false)}
                  disabled={!modal.to || (modal.reason === "other" && !modal.detail.trim())}>
                  Reasignar
                </button>
              </div>
            </div>
          </>
        )}
      </Modal>

      {/* ── Modal suspender ── */}
      <Modal open={modal?.kind === "suspend"} onClose={() => setModal(null)}>
        {modal?.kind === "suspend" && (
          <>
            <h2>Suspender a {l.name}</h2>
            <p style={{ margin: "10px 0" }}>
              La suspensión desactiva la cuenta del revisor: deja de recibir
              asignaciones y de ver la bolsa.
            </p>
            {l.kpis.active_cases > 0 && (
              <div className="card" style={{ background: "var(--warnbg)", border: "none", margin: "10px 0" }}>
                <small>
                  ⚠️ Tiene {l.kpis.active_cases} casos en curso: se devolverán a la
                  bolsa de requerimientos y los clientes serán notificados de la
                  reasignación.
                </small>
              </div>
            )}
            <label>Motivo (obligatorio, queda en la auditoría)</label>
            <textarea rows={2} value={modal.reason}
              placeholder="Ej: incumplimientos reiterados de SLA…"
              onChange={(e) => setModal({ ...modal, reason: e.target.value })} />
            {modal.reason.trim().length > 0 && modal.reason.trim().length < 10 && (
              <small style={{ color: "var(--bad)" }}>
                Indique el motivo con al menos 10 caracteres.
              </small>
            )}
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
              <button className="btn ghost" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn danger" onClick={suspendOk}
                disabled={modal.reason.trim().length < 10}>
                Suspender revisor
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
