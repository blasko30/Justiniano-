import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal, Spinner, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { errCode, errMsg, stars, isFreePlan } from "../lib/format.js";
import { MHead, MBody, MFoot } from "./Shell.jsx";
import { useUser } from "./UserContext.jsx";

function LawyerRow({ l }) {
  return (
    <div className="lawrow">
      <div className="lawav">{l.initials}</div>
      <div style={{ minWidth: 0 }}>
        <b style={{ fontSize: 13.5 }}>{l.name}</b>
        <div className="d">
          {l.rating != null && <><span className="stars">{stars(l.rating)}</span> {Number(l.rating).toFixed(1)} · </>}
          {l.reviews_with_user ? `${l.reviews_with_user} revisiones con usted` : "Abogado habilitado"}
        </div>
      </div>
    </div>
  );
}

/**
 * Solicitud de revisión por abogado (§12.2) sobre un documento o una
 * respuesta del agente. Urgencia, modo de asignación (auto / frecuente /
 * elegir profesional), notas y costo en créditos.
 */
export default function ReviewModal({ open, onClose, documentId = null, messageId = null, area = null, onCreated }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { user, refreshUser, refreshUsage } = useUser();
  const free = isFreePlan(user?.plan);

  const [docs, setDocs] = useState([]);
  const [lawyers, setLawyers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const [target, setTarget] = useState(messageId ? "__msg" : documentId || "");
  const [urgency, setUrgency] = useState("std");
  const [mode, setMode] = useState("auto");
  const [lawyerId, setLawyerId] = useState("");
  const [notes, setNotes] = useState("");
  const [upsellFast, setUpsellFast] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTarget(messageId ? "__msg" : documentId || "");
    setUrgency("std"); setMode("auto"); setLawyerId(""); setNotes("");
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const jobs = [api.reviews.lawyers({ specialty: area || undefined })];
        if (!messageId) jobs.push(api.documents.list({ page_size: 100 }));
        const [ls, ds] = await Promise.all(jobs);
        if (!alive) return;
        setLawyers(ls.items || []);
        if (ds) {
          setDocs(ds.items || []);
          if (!documentId && ds.items?.length) setTarget(ds.items[0].id);
        }
      } catch (e) {
        toast(errMsg(e), "err");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const frequent = useMemo(() => lawyers.find((l) => l.is_frequent), [lawyers]);
  const cost = urgency === "fast" ? 2 : 1;
  const credits = user?.credits ?? 0;

  const pickUrgency = (u) => {
    if (u === "fast" && free) { setUpsellFast(true); return; }
    setUrgency(u);
  };

  const submit = async () => {
    const body = {
      target_type: messageId && target === "__msg" ? "message" : "document",
      urgency,
      assignment_mode: mode,
    };
    if (body.target_type === "message") body.message_id = messageId;
    else {
      if (!target || target === "__msg") { toast("Seleccione el documento a revisar", "warn"); return; }
      body.document_id = target;
    }
    if (mode === "pick") {
      if (!lawyerId) { toast("Elija un profesional", "warn"); return; }
      body.lawyer_id = lawyerId;
    }
    if (notes.trim()) body.notes = notes.trim();

    if (cost > credits) {
      toast(`Créditos insuficientes: la revisión ${urgency === "fast" ? "prioritaria" : "estándar"} requiere ${cost} crédito(s)`, "warn");
      return;
    }
    setSending(true);
    try {
      const r = await api.reviews.create(body);
      toast(r.state >= 2 ? "Revisión solicitada y abogado asignado" : "Solicitud de revisión enviada", "ok");
      refreshUser(); refreshUsage();
      onClose?.();
      onCreated?.(r);
    } catch (e) {
      if (e.status === 402) toast("Créditos insuficientes. Compre créditos en Planes.", "err");
      else if (errCode(e) === "priority_not_available") setUpsellFast(true);
      else if (errCode(e) === "already_under_review") toast("El documento ya tiene una revisión activa", "warn");
      else toast(errMsg(e), "err");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Modal open={open && !upsellFast} onClose={onClose} width={560}>
        <MHead icon="🧑‍⚖️" title="Revisión por abogado"
          sub="Un abogado habilitado revisa el documento o la respuesta y firma sus observaciones." />
        <MBody>
          {loading ? (
            <div className="center" style={{ padding: 24 }}><Spinner /></div>
          ) : (
            <>
              <div className="field">
                <label>¿Qué desea revisar?</label>
                <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
                  {messageId ? <option value="__msg">Última respuesta del agente</option> : null}
                  {docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>

              <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 6, color: "var(--fg-muted)" }}>Urgencia</label>
              <div className="optlist" style={{ marginBottom: 16 }}>
                <div className={`opt ${urgency === "std" ? "on" : ""}`} onClick={() => pickUrgency("std")}>
                  <span className="rd" />
                  <div><b>Estándar · 48 h hábiles</b><div className="d">1 crédito</div></div>
                </div>
                <div className={`opt ${urgency === "fast" ? "on" : ""} ${free ? "off" : ""}`} onClick={() => pickUrgency("fast")}>
                  <span className="rd" />
                  <div style={{ flex: 1 }}><b>⚡ Prioritaria · 8 h hábiles</b><div className="d">Respuesta el mismo día hábil · 2 créditos</div></div>
                  {free ? <span className="badge pro" style={{ alignSelf: "center" }}>🔒 Planes pagos</span> : null}
                </div>
              </div>

              <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 6, color: "var(--fg-muted)" }}>¿Quién realiza la revisión?</label>
              <div className="optlist" style={{ marginBottom: 16 }}>
                <div className={`opt ${mode === "auto" ? "on" : ""}`} onClick={() => setMode("auto")}>
                  <span className="rd" />
                  <div><b>⚡ Asignación automática</b><div className="d">El primer abogado disponible de la especialidad. Es la vía más rápida.</div></div>
                </div>
                {frequent ? (
                  <div className={`opt ${mode === "frequent" ? "on" : ""}`} onClick={() => setMode("frequent")}>
                    <span className="rd" />
                    <div style={{ flex: 1 }}>
                      <b>⭐ Mi abogado de siempre</b>
                      <div style={{ marginTop: 7 }}><LawyerRow l={frequent} /></div>
                      <div className="d" style={{ marginTop: 5 }}>{frequent.reviews_with_user} revisiones previas con usted</div>
                    </div>
                  </div>
                ) : null}
                <div className={`opt ${mode === "pick" ? "on" : ""}`} onClick={() => setMode("pick")}>
                  <span className="rd" />
                  <div style={{ flex: 1 }}>
                    <b>👤 Elegir un profesional</b>
                    <div className="d">Sujeto a la disponibilidad del abogado; puede sumar horas al plazo.</div>
                    {mode === "pick" ? (
                      <div style={{ marginTop: 9, display: "grid", gap: 7 }}>
                        {lawyers.length === 0 && <span className="subtle">No hay abogados disponibles ahora.</span>}
                        {lawyers.map((l) => (
                          <div key={l.id} className={`opt ${lawyerId === l.id ? "on" : ""}`} style={{ padding: "9px 10px" }}
                            onClick={(e) => { e.stopPropagation(); setLawyerId(l.id); }}>
                            <span className="rd" />
                            <div style={{ flex: 1 }}><LawyerRow l={l} /></div>
                            {l.sla_hours ? <span className="tag" style={{ alignSelf: "center" }}>{l.sla_hours} h</span> : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="field">
                <label>Contexto adicional para el abogado (opcional)</label>
                <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
              </div>
              <div className="row" style={{ justifyContent: "space-between", padding: "11px 13px", background: "var(--bg-sunken)", borderRadius: 10 }}>
                <span className="muted">Costo</span>
                <b>{cost} crédito{cost > 1 ? "s" : ""}</b>
              </div>
              <div className="subtle" style={{ marginTop: 8 }}>
                Créditos de revisión: <b>{credits}</b> ·{" "}
                <a style={{ cursor: "pointer" }} onClick={() => { onClose?.(); navigate("/app/planes"); }}>Comprar créditos</a>
              </div>
              <div className="note" style={{ marginTop: 12 }}>
                ✅ La revisión humana convierte la orientación IA en asesoría profesional respaldada.
              </div>
            </>
          )}
        </MBody>
        <MFoot>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={sending || loading} onClick={submit}>
            {sending ? <Spinner size={16} /> : "Solicitar revisión"}
          </button>
        </MFoot>
      </Modal>

      <Modal open={upsellFast} onClose={() => setUpsellFast(false)} width={440}>
        <MHead icon="⚡" title="Prioritaria · 8 h hábiles"
          sub="La urgencia prioritaria está disponible en los planes pagos." />
        <MFoot>
          <button className="btn" onClick={() => setUpsellFast(false)}>Volver</button>
          <button className="btn primary" onClick={() => { setUpsellFast(false); onClose?.(); navigate("/app/planes"); }}>Ver planes</button>
        </MFoot>
      </Modal>
    </>
  );
}
