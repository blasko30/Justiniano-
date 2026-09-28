import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal, Spinner, EmptyState, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { errCode, errMsg, fmtDate, REVIEW_STEPS } from "../lib/format.js";
import { PageHead, MHead, MBody, MFoot } from "../components/Shell.jsx";
import ReviewModal from "../components/ReviewModal.jsx";

function Timeline({ review }) {
  const byState = Object.fromEntries((review.state_history || []).map((h) => [h.state, h]));
  return (
    <div className="timeline">
      {REVIEW_STEPS.map((label, i) => {
        const n = i + 1;
        const cls = review.state > n ? "done" : review.state === n ? "now" : "";
        const h = byState[n];
        return (
          <div className={`tl ${cls}`} key={label}>
            <b style={{ fontSize: 13 }}>{h?.label || label}</b>
            {n === 2 && review.lawyer ? (
              <div className="subtle">
                {review.lawyer.name}{review.lawyer.rut ? ` · RUT ${review.lawyer.rut}` : ""} · Colegio de Abogados de Chile
              </div>
            ) : null}
            {h?.at ? <div className="subtle">{fmtDate(h.at)}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

function ChatModal({ review, onClose }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [enabled, setEnabled] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bodyRef = useRef(null);

  const load = async () => {
    try {
      const r = await api.reviews.chat(review.id);
      setItems(r.items || []);
      setEnabled(r.chat_enabled !== false);
      setTimeout(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, 30);
    } catch (e) {
      toast(errMsg(e), "err");
      setItems([]);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [review.id]);

  const send = async () => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      await api.reviews.sendChat(review.id, { content });
      setText("");
      await load();
    } catch (e) {
      if (errCode(e) === "chat_closed") toast("Chat cerrado: más de 7 días desde la entrega o sin abogado asignado.", "warn");
      else toast(errMsg(e), "err");
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal open onClose={onClose} width={560}>
      <MHead icon="💬" title="Chat con el abogado"
        sub={review.document_name || "Revisión de respuesta del agente"} />
      <MBody>
        {items === null ? (
          <div className="center" style={{ padding: 24 }}><Spinner /></div>
        ) : (
          <div ref={bodyRef} style={{ maxHeight: 320, overflowY: "auto", display: "grid", gap: 10, padding: "4px 0" }}>
            {items.length === 0 && <p className="subtle center">Aún no hay mensajes en este expediente.</p>}
            {items.map((m) => (
              <div key={m.id} className={`msg ${m.sender_role === "client" ? "user" : "bot"}`} style={{ margin: 0 }}>
                <div className="bub">
                  <div className="subtle" style={{ marginBottom: 3, color: m.sender_role === "client" ? "rgba(255,255,255,.8)" : undefined }}>
                    {m.sender_role === "client" ? "Usted" : m.sender_name || "Abogado"} · {fmtDate(m.created_at)}
                  </div>
                  {m.content}
                </div>
              </div>
            ))}
          </div>
        )}
        {enabled ? (
          <div className="composer" style={{ marginTop: 12 }}>
            <textarea
              placeholder="Escriba su mensaje al abogado…"
              value={text}
              maxLength={2000}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            />
            <button className="btn primary" style={{ minHeight: 44 }} disabled={sending || !text.trim()} onClick={send}>➤</button>
          </div>
        ) : (
          <div className="note" style={{ marginTop: 12 }}>El chat de este expediente está cerrado.</div>
        )}
      </MBody>
      <MFoot>
        <button className="btn" onClick={onClose}>Cerrar</button>
      </MFoot>
    </Modal>
  );
}

export default function Reviews() {
  const navigate = useNavigate();
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [chatFor, setChatFor] = useState(null);
  const [annFor, setAnnFor] = useState(null);

  const load = () => {
    api.reviews.list({ page_size: 50 })
      .then((r) => setItems(r.items || []))
      .catch((e) => { setItems([]); toast(errMsg(e), "err"); });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  return (
    <>
      <PageHead
        title="Mis revisiones"
        sub="Un abogado habilitado revisa el documento o la respuesta y firma sus observaciones."
        right={<button className="btn gold" onClick={() => setNewOpen(true)}>＋ Solicitar revisión</button>}
      />

      {items === null ? (
        <div className="center" style={{ padding: 40 }}><Spinner size={28} /></div>
      ) : items.length === 0 ? (
        <div className="card"><EmptyState icon="🧑‍⚖️" title="No hay revisiones solicitadas" /></div>
      ) : (
        <div className="twocol">
          {items.map((r) => (
            <div className="card pad" key={r.id}>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                <b style={{ fontSize: 14 }}>{r.document_name || "Respuesta del agente"}</b>
                <span className={`badge ${r.state === 4 ? "ok" : "warn"}`}>
                  {REVIEW_STEPS[(r.state || 1) - 1]}
                </span>
              </div>
              <div className="subtle" style={{ marginBottom: 12 }}>
                {fmtDate(r.created_at)} · {r.urgency === "fast" ? "Prioritaria · 8 h hábiles" : "Estándar · 48 h hábiles"}
              </div>
              <Timeline review={r} />
              {r.state === 4 && r.observations ? (
                <div className="note gold" style={{ marginTop: 10 }}>
                  <b>Observaciones del abogado:</b> {r.observations}
                </div>
              ) : null}
              <div className="row wrap" style={{ marginTop: 12 }}>
                {r.document_id ? (
                  <button className="btn sm" onClick={() => navigate(`/app/documentos/${r.document_id}`)}>Abrir documento</button>
                ) : null}
                {r.state >= 2 && r.lawyer ? (
                  <button className="btn sm" onClick={() => setChatFor(r)}>💬 Chat con el abogado</button>
                ) : null}
                {r.annotations?.length ? (
                  <button className="btn sm" onClick={() => setAnnFor(r)}>📝 {r.annotations.length} anotaciones</button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <ReviewModal open={newOpen} onClose={() => setNewOpen(false)} onCreated={load} />
      {chatFor ? <ChatModal review={chatFor} onClose={() => setChatFor(null)} /> : null}

      <Modal open={Boolean(annFor)} onClose={() => setAnnFor(null)} width={620}>
        <MHead icon="📝" title="Anotaciones del abogado" sub={annFor?.document_name || ""} />
        <MBody>
          <div style={{ display: "grid", gap: 10 }}>
            {(annFor?.annotations || []).map((a) => (
              <div className="card pad" key={a.id} style={{ background: "var(--bg-sunken)" }}>
                <div className="subtle" style={{ marginBottom: 6 }}>
                  Párrafo {a.paragraph_index + 1} · {a.kind === "change" ? "Cambio propuesto" : "Comentario"}
                </div>
                {a.kind === "change" ? (
                  <>
                    <p style={{ fontSize: 13 }}><b>Original:</b> <span style={{ textDecoration: "line-through", opacity: 0.7 }}>{a.original_text}</span></p>
                    <p style={{ fontSize: 13, marginTop: 4 }}><b>Propuesto:</b> {a.proposed_text}</p>
                  </>
                ) : (
                  <p style={{ fontSize: 13 }}>{a.comment_text}</p>
                )}
              </div>
            ))}
          </div>
        </MBody>
        <MFoot>
          <button className="btn" onClick={() => setAnnFor(null)}>Cerrar</button>
        </MFoot>
      </Modal>
    </>
  );
}
