import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Modal, Spinner, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { errCode, errMsg, fileIco, fmtSize, isFreePlan, DISC_AI } from "../lib/format.js";
import { MHead, MFoot } from "../components/Shell.jsx";
import ReviewModal from "../components/ReviewModal.jsx";
import DocGenModal from "../components/DocGenModal.jsx";
import { useUser } from "../components/UserContext.jsx";

const POLL_MS = 2500;
const POLL_MAX_MS = 20000;

function MsgBody({ content }) {
  const parts = String(content || "").split(/\n{2,}/);
  return parts.map((p, i) => (
    <p key={i} style={i ? { marginTop: 9 } : undefined}>
      {p.split("\n").map((l, j) => (j ? <React.Fragment key={j}><br />{l}</React.Fragment> : l))}
    </p>
  ));
}

export default function Chat() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user, refreshUsage } = useUser();
  const free = isFreePlan(user?.plan);

  const [cons, setCons] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [agent, setAgent] = useState(null);
  const [loading, setLoading] = useState(true);

  const [text, setText] = useState("");
  const [attach, setAttach] = useState([]); // [{id,name,size_bytes}]
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [locked, setLocked] = useState(false);

  const [reviewMsgId, setReviewMsgId] = useState(null);
  const [docOpen, setDocOpen] = useState(false);
  const [quotaMsg, setQuotaMsg] = useState(null);

  const bodyRef = useRef(null);
  const fileRef = useRef(null);
  const pollRef = useRef(null);

  const scrollDown = () => {
    setTimeout(() => {
      const b = bodyRef.current;
      if (b) b.scrollTop = b.scrollHeight;
    }, 40);
  };

  /* Carga inicial: cabecera + mensajes + catálogo de agentes (icono/color) */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const [c, m, ag] = await Promise.all([
          api.consultations.get(id),
          api.consultations.messages(id, { page_size: 100 }),
          api.catalog.agents().catch(() => ({ items: [] })),
        ]);
        if (!alive) return;
        setCons(c);
        setMsgs(m.items || []);
        setAgent((ag.items || []).find((x) => x.id === c.agent_id) || null);
        setLocked(c.interactions_limit != null && c.interactions_used >= c.interactions_limit);
      } catch (e) {
        toast(errMsg(e), "err");
        navigate("/app/consultas");
      } finally {
        if (alive) setLoading(false);
        scrollDown();
      }
    })();
    return () => { alive = false; clearTimeout(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(scrollDown, [msgs.length]);

  const lastAssistant = useMemo(() => [...msgs].reverse().find((m) => m.role === "assistant"), [msgs]);
  const suggestions = lastAssistant?.suggestions || [];

  /* Adjuntos */
  const onFiles = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (!files.length) return;
    setUploading(true);
    try {
      for (const f of files) {
        const r = await api.attachments.upload(f);
        setAttach((prev) => [...prev, { id: r.id, name: r.name || f.name, size_bytes: r.size_bytes ?? f.size }]);
      }
      toast(`${files.length} archivo(s) adjunto(s)`, "ok");
    } catch (err) {
      toast(errMsg(err), "err");
    } finally {
      setUploading(false);
    }
  };

  const rmAttach = async (att) => {
    setAttach((prev) => prev.filter((a) => a.id !== att.id));
    try { await api.attachments.remove(att.id); } catch { /* ya descartado en el backend */ }
  };

  /* Polling de respaldo: si el POST no trae la respuesta del asistente,
     re-consulta los mensajes hasta ~20 s. */
  const pollForAssistant = (sinceCount, startedAt = Date.now()) => {
    clearTimeout(pollRef.current);
    pollRef.current = setTimeout(async () => {
      try {
        const r = await api.consultations.messages(id, { page_size: 100 });
        const items = r.items || [];
        setMsgs(items);
        const last = items[items.length - 1];
        if (last?.role === "assistant" && items.length > sinceCount) {
          setSending(false);
          return;
        }
      } catch { /* reintenta */ }
      if (Date.now() - startedAt < POLL_MAX_MS) pollForAssistant(sinceCount, startedAt);
      else setSending(false);
    }, POLL_MS);
  };

  const send = async (quick) => {
    const content = (quick ?? text).trim();
    if (!content || sending || locked) return;
    const attachIds = attach.map((a) => a.id);
    const optimistic = {
      id: `tmp_${Date.now()}`, role: "user", content,
      attachments: attach.map((a) => ({ id: a.id, name: a.name, size_bytes: a.size_bytes })),
    };
    setMsgs((prev) => [...prev, optimistic]);
    setText("");
    setAttach([]);
    setSending(true);
    scrollDown();
    try {
      const body = { content };
      if (attachIds.length) body.attachment_ids = attachIds;
      const r = await api.http.post(`/consultations/${id}/messages`, { body });
      setCons((c) => c && {
        ...c,
        title: r.consultation_title ?? c.title,
        interactions_used: r.interactions_used ?? c.interactions_used,
        interactions_limit: r.interactions_limit !== undefined ? r.interactions_limit : c.interactions_limit,
      });
      if (r.interactions_limit != null && r.interactions_used >= r.interactions_limit) setLocked(true);
      refreshUsage();
      if (r.assistant_message) {
        setMsgs((prev) => [
          ...prev.filter((m) => m.id !== optimistic.id),
          r.user_message || optimistic,
          r.assistant_message,
        ]);
        setSending(false);
      } else {
        // Respuesta diferida: refresca y hace polling corto
        pollForAssistant(msgs.length + 1);
      }
    } catch (e) {
      setMsgs((prev) => prev.filter((m) => m.id !== optimistic.id));
      setText(content);
      setSending(false);
      if (errCode(e) === "interaction_limit_reached") { setLocked(true); toast("Límite de interacciones alcanzado", "warn"); }
      else if (e.status === 503) toast("El servicio de IA no está disponible; reintente.", "err");
      else toast(errMsg(e), "err");
    }
  };

  const exportChat = async () => {
    try {
      const r = await api.consultations.export(id, { format: "pdf" });
      if (r?.download_url) {
        window.open(r.download_url, "_blank", "noopener");
        toast("Exportación lista", "ok");
      }
    } catch (e) {
      toast(errMsg(e), "err");
    }
  };

  const copyMsg = async (content) => {
    try {
      await navigator.clipboard.writeText(content || "");
      toast("Copiado al portapapeles", "ok");
    } catch {
      toast("No se pudo copiar", "err");
    }
  };

  if (loading || !cons) {
    return <div style={{ display: "flex", justifyContent: "center", padding: 80 }}><Spinner size={30} /></div>;
  }

  const color = agent?.color || "#3B6EA5";
  const icon = agent?.icon || "💬";
  const limit = cons.interactions_limit;
  const left = limit != null ? Math.max(0, limit - cons.interactions_used) : null;
  const pct = limit ? Math.min(100, (cons.interactions_used / limit) * 100) : 0;

  return (
    <div className="chatshell">
      {/* Cabecera del hilo */}
      <div className="chathead">
        <button className="iconbtn" onClick={() => navigate("/app/consultas")}>←</button>
        <div style={{
          width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center",
          background: `${color}1F`, color, fontSize: 16,
        }}>{icon}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 650, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {cons.title || `Nueva consulta · ${agent?.name || cons.agent_id}`}
          </div>
          <div className="subtle">{agent?.name || cons.agent_id} · 🇨🇱 Chile</div>
        </div>
        {limit != null && (
          <span className={`badge ${locked ? "err" : left <= 5 ? "warn" : "info"}`}>
            {cons.interactions_used}/{limit}
          </span>
        )}
        <button className="btn sm" onClick={exportChat}>Exportar consulta</button>
      </div>

      {/* Mensajes */}
      <div className="chatbody" ref={bodyRef}>
        {msgs.map((m, i) => (
          m.role === "user" ? (
            <div className="msg user" key={m.id || i}>
              <div className="bub">
                <MsgBody content={m.content} />
                {m.attachments?.length ? (
                  <div className="att">
                    {m.attachments.map((f) => (
                      <span className="attchip" key={f.id || f.name}>
                        <span>{fileIco(f.name)}</span>
                        <span className="nm">{f.name}</span>
                        {f.size_bytes ? <span className="sz">{fmtSize(f.size_bytes)}</span> : null}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="msg bot" key={m.id || i}>
              <div className="ava" style={{ background: `${color}1F`, color }}>{icon}</div>
              <div>
                <div className="bub">
                  <MsgBody content={m.content} />
                  {m.legal_basis?.length ? (
                    <div className="cite"><b>Fundamento:</b> {m.legal_basis.map(b => typeof b === "string" ? b : (b.article || b.text || b.title || b.description || JSON.stringify(b))).join(" • ")}</div>
                  ) : null}
                  {m.disclaimer ? (
                    <div className="aidisc"><span>⚠️</span><span>{m.disclaimer}</span></div>
                  ) : null}
                </div>
                {i > 0 && (
                  <div className="msgactions">
                    <button className="btn sm" onClick={() => setReviewMsgId(m.id)}>🧑‍⚖️ Pedir revisión de abogado</button>
                    <button className="btn sm" onClick={() => setDocOpen(true)}>📄 Generar documento</button>
                    <button className="btn sm ghost" onClick={() => copyMsg(m.content)}>⧉ Copiar</button>
                  </div>
                )}
              </div>
            </div>
          )
        ))}
        {sending && (
          <div className="msg bot">
            <div className="ava" style={{ background: `${color}1F`, color }}>{icon}</div>
            <div className="bub">
              <span className="subtle">Analizando la normativa aplicable</span>{" "}
              <span className="typing"><i /><i /><i /></span>
            </div>
          </div>
        )}
      </div>

      {/* Pie: cuota + composer */}
      <div className="chatfoot">
        {limit != null && (
          <div className="quota">
            <span>Interacciones: <b>{left}</b> restantes</span>
            <div className={`bar ${pct >= 100 ? "err" : pct > 75 ? "warn" : ""}`}><i style={{ width: `${pct}%` }} /></div>
            {locked && (
              <a style={{ cursor: "pointer", fontWeight: 600 }} onClick={() => navigate("/app/planes")}>Ver planes</a>
            )}
          </div>
        )}
        {locked ? (
          <div className="note" style={{ background: "var(--err-bg)", borderColor: "var(--err)" }}>
            <b>Límite de interacciones alcanzado</b>
            <p style={{ marginTop: 5 }}>
              Esta consulta alcanzó las {limit} interacciones de su plan. Cambie de plan para continuar
              en el mismo hilo o abra una consulta nueva.
            </p>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn gold sm" onClick={() => navigate("/app/planes")}>Ver planes</button>
              <button className="btn sm" onClick={() => navigate("/app/agentes")}>Abrir consulta nueva</button>
            </div>
          </div>
        ) : (
          <>
            {suggestions.length > 0 && (
              <div className="chips">
                {suggestions.map((s) => (
                  <span className="chip" key={s} onClick={() => send(s)}>{s}</span>
                ))}
              </div>
            )}
            {attach.length > 0 && (
              <div className="attbar">
                {attach.map((f) => (
                  <span className="attchip" key={f.id}>
                    <span>{fileIco(f.name)}</span>
                    <span className="nm" title={f.name}>{f.name}</span>
                    <span className="sz">{fmtSize(f.size_bytes)}</span>
                    <span className="x" title="Quitar" onClick={() => rmAttach(f)}>✕</span>
                  </span>
                ))}
              </div>
            )}
            <div className="composer">
              <button className="attachbtn" title="Adjuntar archivos" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <Spinner size={16} /> : "＋"}
              </button>
              <input ref={fileRef} type="file" multiple hidden
                accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.webp,.heic" onChange={onFiles} />
              <textarea
                placeholder="Describa su situación con el mayor detalle posible…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                }}
              />
              <button className="btn primary" style={{ minHeight: 44 }} disabled={sending || !text.trim()} onClick={() => send()}>
                Enviar ➤
              </button>
            </div>
            <div className="subtle center" style={{ marginTop: 7, fontSize: 11 }}>⚠️ {DISC_AI}</div>
          </>
        )}
      </div>

      {/* Modales */}
      <ReviewModal
        open={Boolean(reviewMsgId)}
        onClose={() => setReviewMsgId(null)}
        messageId={reviewMsgId}
        area={cons.agent_id}
        onCreated={() => navigate("/app/revisiones")}
      />
      <DocGenModal
        open={docOpen}
        onClose={() => setDocOpen(false)}
        consultationId={id}
        initialArea={cons.agent_id}
        freePlan={free}
        onCreated={(doc, { wantReview }) => navigate(`/app/documentos/${doc.id}`, { state: { wantReview } })}
        onQuota={(e) => setQuotaMsg(errMsg(e))}
      />
      <Modal open={Boolean(quotaMsg)} onClose={() => setQuotaMsg(null)} width={460}>
        <MHead icon="🔒" title="Límite de documentos alcanzado" sub={quotaMsg || ""} />
        <MFoot>
          <button className="btn" onClick={() => setQuotaMsg(null)}>Más tarde</button>
          <button className="btn gold" onClick={() => { setQuotaMsg(null); navigate("/app/planes"); }}>Ver planes</button>
        </MFoot>
      </Modal>
    </div>
  );
}
