import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { EmptyState, Modal, Spinner, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { CLP, fmtDT, sourceLabel, urg } from "../lib/format.js";
import { useLawyer } from "../components/LawyerContext.jsx";
import RejectModal from "../components/RejectModal.jsx";

const stripTags = (html) => String(html || "").replace(/<[^>]+>/g, "");

/** Párrafo con control de cambios: texto plano + <del>/<ins> de cada cambio. */
function ParaConCambios({ html, changes }) {
  const texto = stripTags(html);
  if (!changes.length) return <span dangerouslySetInnerHTML={{ __html: html }} />;
  const nodos = [];
  let resto = texto;
  const pendientes = [];
  changes.forEach((c, i) => {
    const idx = resto.indexOf(c.original_text);
    if (idx === -1) { pendientes.push(c); return; }
    nodos.push(<span key={`t${i}`}>{resto.slice(0, idx)}</span>);
    nodos.push(<del key={`d${i}`}>{c.original_text}</del>);
    nodos.push(<span key={`s${i}`}> </span>);
    nodos.push(<ins key={`n${i}`}>{c.proposed_text}</ins>);
    resto = resto.slice(idx + c.original_text.length);
  });
  nodos.push(<span key="fin">{resto}</span>);
  pendientes.forEach((c, i) => {
    nodos.push(<span key={`pd${i}`}> <del>{c.original_text}</del> <ins>{c.proposed_text}</ins></span>);
  });
  return <>{nodos}</>;
}

/**
 * Espacio de revisión del caso (§20.7–§20.21): documento con anotaciones por
 * párrafo, chat con el cliente, historial documental, borrador y entrega.
 */
export default function Caso() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { lawyer } = useLawyer();

  const [ws, setWs] = useState(null);
  const [anns, setAnns] = useState([]);
  const [chat, setChat] = useState({ items: [], chat_enabled: true });
  const [hist, setHist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("chat");
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  /* Modales */
  const [cmtModal, setCmtModal] = useState(null);     // { index }
  const [cmtText, setCmtText] = useState("");
  const [chgModal, setChgModal] = useState(null);     // { index, ann? }
  const [chgOld, setChgOld] = useState("");
  const [chgNew, setChgNew] = useState("");
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [obs, setObs] = useState("");
  const [declara, setDeclara] = useState(false);
  const [rejecting, setRejecting] = useState(null);
  const [histDoc, setHistDoc] = useState(null);       // documento histórico abierto
  const chatBoxRef = useRef(null);

  const esDoc = ws?.target_type === "document";
  const enCurso = ws?.state === 3;
  const entregada = ws?.state === 4;

  const cargarAnotaciones = async () => {
    try {
      const a = await api.lawyers.annotations(id);
      setAnns(a?.items || []);
    } catch { /* consultas no tienen anotaciones */ }
  };

  const cargarChat = async () => {
    try {
      const c = await api.lawyers.chat(id);
      setChat(c || { items: [], chat_enabled: false });
    } catch { /* chat disponible desde el estado 2 */ }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const w = await api.lawyers.workspace(id);
        if (!alive) return;
        setWs(w);
        setDraft(w.draft || "");
        await Promise.all([
          w.target_type === "document" ? cargarAnotaciones() : Promise.resolve(),
          cargarChat(),
        ]);
      } catch (e) {
        toast(e.message, "err");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [id]);

  useEffect(() => {
    const b = chatBoxRef.current;
    if (b) b.scrollTop = b.scrollHeight;
  }, [chat.items.length, tab]);

  useEffect(() => {
    if (tab === "hist" && hist === null) {
      api.lawyers.clientHistory(id)
        .then((h) => setHist(h?.items || []))
        .catch((e) => { setHist([]); toast(e.message, "err"); });
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [tab]);

  const porParrafo = useMemo(() => {
    const m = {};
    for (const a of anns) {
      const b = (m[a.paragraph_index] = m[a.paragraph_index] || { comments: [], changes: [], highlights: [] });
      if (a.kind === "comment") b.comments.push(a);
      else if (a.kind === "change") b.changes.push(a);
      else b.highlights.push(a);
    }
    return m;
  }, [anns]);
  const nCmts = anns.filter((a) => a.kind === "comment").length;
  const nChgs = anns.filter((a) => a.kind === "change").length;
  const nHl = anns.filter((a) => a.kind === "highlight").length;

  /* ── Acciones sobre anotaciones ── */
  const publicarComentario = async () => {
    if (!cmtText.trim()) { toast("Escriba el comentario", "warn"); return; }
    setBusy(true);
    try {
      await api.lawyers.createAnnotation(id, {
        kind: "comment", paragraph_index: cmtModal.index, comment_text: cmtText.trim(),
      });
      toast(`Comentario publicado en el párrafo ${cmtModal.index + 1}`, "ok");
      setCmtModal(null); setCmtText("");
      await cargarAnotaciones();
    } catch (e) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  const guardarCambio = async () => {
    if (!chgOld.trim() || !chgNew.trim()) { toast("Complete ambos textos", "warn"); return; }
    setBusy(true);
    try {
      if (chgModal.ann) {
        await api.lawyers.patchAnnotation(id, chgModal.ann.id, {
          original_text: chgOld.trim(), proposed_text: chgNew.trim(),
        });
      } else {
        await api.lawyers.createAnnotation(id, {
          kind: "change", paragraph_index: chgModal.index,
          original_text: chgOld.trim(), proposed_text: chgNew.trim(),
        });
      }
      toast(`Cambio propuesto en el párrafo ${chgModal.index + 1}`, "ok");
      setChgModal(null);
      await cargarAnotaciones();
    } catch (e) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  const eliminarAnotacion = async (ann) => {
    try {
      await api.lawyers.deleteAnnotation(id, ann.id);
      await cargarAnotaciones();
    } catch (e) {
      toast(e.message, "err");
    }
  };

  const toggleResaltado = async (index) => {
    if (!enCurso) { toast("La revisión no está en curso", "warn"); return; }
    const existente = porParrafo[index]?.highlights?.[0];
    try {
      if (existente) await api.lawyers.deleteAnnotation(id, existente.id);
      else await api.lawyers.createAnnotation(id, { kind: "highlight", paragraph_index: index });
      await cargarAnotaciones();
    } catch (e) {
      toast(e.message, "err");
    }
  };

  /* ── Borrador, chat y entrega ── */
  const guardarBorrador = async () => {
    try {
      await api.lawyers.saveDraft(id, { draft });
      toast("Borrador guardado", "ok");
    } catch (e) {
      toast(e.message, "err");
    }
  };

  const enviarChat = async () => {
    const v = msg.trim();
    if (!v) return;
    try {
      await api.lawyers.sendChat(id, { content: v });
      setMsg("");
      await cargarChat();
    } catch (e) {
      toast(e.message, "err");
    }
  };

  const abrirEntrega = () => {
    if (!esDoc && !draft.trim()) { toast("Redacte su respuesta antes de entregar", "warn"); return; }
    setObs((o) => o || (esDoc ? draft : ""));
    setDeclara(false);
    setDeliverOpen(true);
  };

  const entregar = async () => {
    if (!declara) { toast("Debe confirmar la declaración de revisión íntegra", "warn"); return; }
    if (obs.trim().length < 10) { toast("Escriba la observación final (mínimo 10 caracteres)", "warn"); return; }
    setBusy(true);
    try {
      const body = { final_observations: obs.trim(), declaration: true };
      if (!esDoc) body.response_text = draft;
      await api.lawyers.deliver(id, body);
      toast("Entregado ✓ El cliente fue notificado y el honorario se sumó a su liquidación", "ok");
      navigate("/requerimientos");
    } catch (e) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  const verHistorico = async (h) => {
    try {
      const doc = await api.lawyers.historyDocument(id, h.id);
      setHistDoc({ ...doc, meta: h });
    } catch (e) {
      toast(e.message, "err");
    }
  };

  const aceptar = async () => {
    setBusy(true);
    try {
      await api.lawyers.accept(id);
      toast("Requerimiento aceptado · el plazo SLA comenzó a correr", "ok");
      const w = await api.lawyers.workspace(id);
      setWs(w);
    } catch (e) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Spinner size={30} /></div>;
  if (!ws) return <EmptyState icon="⚖️" title="Caso no encontrado">El requerimiento no existe o ya no está asignado a usted.</EmptyState>;

  const titulo = esDoc ? ws.document?.name : "Consulta de asesoría";
  const parrafos = ws.document?.paragraphs || [];

  /* ── Columna izquierda ── */
  const izquierda = esDoc ? (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2>📄 {titulo}</h2>
          <small>{ws.client?.company} · v1 subida por el cliente</small>
        </div>
        <span className={`badge ${urg(ws.urgency).badge}`}>{urg(ws.urgency).label}</span>
      </div>
      {ws.client_note && (
        <div className="banner info" style={{ margin: "12px 0 4px" }}>📌 <div>
          <b>Indicación del cliente:</b> {ws.client_note}</div></div>
      )}
      <p className="small" style={{ margin: "10px 0 4px" }}>
        Pase el cursor sobre un párrafo para <b>comentar</b>, <b>proponer un cambio</b> (control de cambios) o{" "}
        <b>resaltar</b>. Sus intervenciones quedan identificadas con su nombre.
      </p>
      <div className="doc">
        {parrafos.map((p) => {
          const b = porParrafo[p.index] || { comments: [], changes: [], highlights: [] };
          return (
            <div key={p.index} className={`para ${b.highlights.length ? "hl" : ""}`}>
              <ParaConCambios html={p.html} changes={b.changes} />
              {b.comments.length > 0 && (
                <span className="cmark" onClick={() => setTab("cmts")}>💬 {b.comments.length}</span>
              )}
              {b.changes.length > 0 && <span className="chgmark">✏️ cambio propuesto</span>}
              {enCurso && (
                <span className="ptools">
                  <button onClick={() => { setCmtText(""); setCmtModal({ index: p.index }); }}>💬 Comentar</button>
                  <button onClick={() => {
                    const existente = b.changes[0] || null;
                    setChgOld(existente ? existente.original_text : stripTags(p.html).slice(0, 90));
                    setChgNew(existente ? existente.proposed_text : "");
                    setChgModal({ index: p.index, ann: existente });
                  }}>✏️ Cambio</button>
                  <button onClick={() => toggleResaltado(p.index)}>🖍️ Resaltar</button>
                </span>
              )}
            </div>
          );
        })}
        {!parrafos.length && <p className="small">El documento no tiene contenido para revisar.</p>}
      </div>
      {!entregada && (
        <>
          <label>Borrador de su observación final (privado hasta la entrega)</label>
          <textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)}
            placeholder="Síntesis en preparación: riesgos detectados, recomendaciones…" />
        </>
      )}
      <div className="row" style={{ justifyContent: "space-between", marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <small><b>{nChgs}</b> cambios propuestos · <b>{nCmts}</b> comentarios · <b>{nHl}</b> párrafos resaltados</small>
        {!entregada && (
          <div className="row">
            <button className="btn ghost" onClick={guardarBorrador}>Guardar borrador</button>
            <button className="btn" onClick={abrirEntrega} disabled={!enCurso}>Entregar revisión firmada ✓</button>
          </div>
        )}
      </div>
    </div>
  ) : (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div><h2>💬 Consulta de asesoría</h2><small>{ws.client?.company}</small></div>
        <span className={`badge ${urg(ws.urgency).badge}`}>{urg(ws.urgency).label}</span>
      </div>
      <div className="banner info" style={{ margin: "14px 0" }}>❓ <div>
        <b>Pregunta del cliente:</b> {ws.question}
        {ws.client_note && <><br /><small>{ws.client_note}</small></>}
      </div></div>
      <label>Su respuesta profesional</label>
      <textarea rows={8} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={entregada}
        placeholder="Redacte su respuesta fundada. Puede citar normas (p. ej., art. 161 del Código del Trabajo) y jurisprudencia. La respuesta se entregará firmada con su nombre, RUT y colegiatura." />
      <small style={{ display: "block", marginTop: 6 }}>
        Puede usar el chat lateral para pedir antecedentes adicionales antes de responder.
      </small>
      {!entregada && (
        <div className="row" style={{ justifyContent: "space-between", marginTop: 14 }}>
          <button className="btn ghost" onClick={guardarBorrador}>Guardar borrador</button>
          <button className="btn" onClick={abrirEntrega} disabled={!enCurso}>Enviar respuesta firmada ✓</button>
        </div>
      )}
    </div>
  );

  /* ── Columna derecha ── */
  const derecha = (
    <div className="card">
      <div className="tabs" style={{ marginBottom: 10 }}>
        {[["chat", "Chat"], ["cmts", "Anotaciones"], ["hist", "Historial"], ["info", "Detalles"]].map(([k, n]) => (
          <div key={k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{n}</div>
        ))}
      </div>

      {tab === "chat" && (
        <>
          <div className="chatbox" ref={chatBoxRef}>
            {chat.items.length ? chat.items.map((m) => (
              <div key={m.id} className={`msg ${m.sender_role === "lawyer" ? "me" : "cli"}`}>
                {m.content}
                <small>{m.sender_name || (m.sender_role === "lawyer" ? "Usted" : "Cliente")} · {fmtDT(m.created_at)}</small>
              </div>
            )) : <p className="small">Aún no hay mensajes. Puede pedir antecedentes al cliente.</p>}
          </div>
          <div className="chatin">
            <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Escribir al cliente…"
              disabled={!chat.chat_enabled}
              onKeyDown={(e) => { if (e.key === "Enter") enviarChat(); }} />
            <button className="btn xs" onClick={enviarChat} disabled={!chat.chat_enabled}>Enviar</button>
          </div>
          <small style={{ display: "block", marginTop: 8 }}>
            {chat.chat_enabled
              ? "El chat queda registrado en el expediente del requerimiento."
              : "Chat cerrado: más de 7 días desde la entrega."}
          </small>
        </>
      )}

      {tab === "cmts" && (
        <>
          <h3>Cambios propuestos</h3>
          {anns.filter((a) => a.kind === "change").map((a) => (
            <div key={a.id} className="chg">
              <b>✏️ Párrafo {a.paragraph_index + 1}</b><br />
              <del>{a.original_text}</del> → <ins>{a.proposed_text}</ins>
              {a.client_resolution && <><br /><small>Resolución del cliente: {a.client_resolution}</small></>}
              {enCurso && (
                <div className="row" style={{ marginTop: 6 }}>
                  <button className="btn ghost xs" onClick={() => {
                    setChgOld(a.original_text); setChgNew(a.proposed_text);
                    setChgModal({ index: a.paragraph_index, ann: a });
                  }}>Editar</button>
                  <button className="btn danger xs" onClick={() => eliminarAnotacion(a)}>Descartar</button>
                </div>
              )}
            </div>
          ))}
          {!nChgs && <p className="small">Sin cambios propuestos.</p>}
          <h3 style={{ marginTop: 14 }}>Comentarios</h3>
          {anns.filter((a) => a.kind === "comment").map((a) => (
            <div key={a.id} className="cmt">
              <b>💬 Párrafo {a.paragraph_index + 1} · {a.author || lawyer?.name}</b><br />
              {a.comment_text}
              {enCurso && (
                <div style={{ marginTop: 5 }}>
                  <button className="btn danger xs" onClick={() => eliminarAnotacion(a)}>Eliminar</button>
                </div>
              )}
            </div>
          ))}
          {!nCmts && <p className="small">Sin comentarios.</p>}
        </>
      )}

      {tab === "hist" && (
        <>
          <h3>Documentos históricos del cliente</h3>
          <p className="small">Solo consulta en pantalla. <b>La descarga está deshabilitada</b> para este rol.</p>
          {hist === null && <div style={{ display: "flex", justifyContent: "center", padding: 20 }}><Spinner /></div>}
          {hist?.length === 0 && <p className="small">El cliente no tiene otros documentos en su historial.</p>}
          {hist?.map((h) => (
            <div key={h.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "11px 13px", margin: "9px 0" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <b style={{ fontSize: 14 }}>{h.name}</b><br />
                  <small>{h.kind} · {h.created_at} · {h.origin === "reviewed" ? "Revisión humana" : "Generado en Justiniano"}</small>
                </div>
                <button className="btn ghost xs" onClick={() => verHistorico(h)}>👁️ Ver</button>
              </div>
            </div>
          ))}
        </>
      )}

      {tab === "info" && (
        <>
          <h3>Detalles del requerimiento</h3>
          {[
            ["Cliente", ws.client?.company || "—"],
            ["Plan del cliente", ws.client?.plan || "—"],
            ["Origen", sourceLabel(ws.source)],
            ["Vence", ws.sla_due_at ? fmtDT(ws.sla_due_at) : "Al aceptar comienza el plazo"],
            ["Honorario", CLP(ws.fee_amount_clp)],
          ].map(([k, v]) => (
            <div key={k} className="row" style={{ justifyContent: "space-between", padding: "7px 0", borderBottom: "1px dashed var(--border)" }}>
              <small>{k}</small><b style={{ fontSize: 13.5, textAlign: "right" }}>{v}</b>
            </div>
          ))}
          {!entregada && (
            <button className="btn danger xs" style={{ marginTop: 14 }}
              onClick={() => setRejecting({ id: ws.id, title: titulo, client: ws.client?.company })}>
              Devolver requerimiento…
            </button>
          )}
        </>
      )}
    </div>
  );

  return (
    <>
      <div className="crumb" onClick={() => navigate("/requerimientos")}>← Volver a requerimientos</div>
      {ws.state === 2 && (
        <div className="banner warn">⏳ <div>
          <b>Requerimiento pendiente de aceptación.</b> Al aceptar comienza a correr el plazo SLA
          ({urg(ws.urgency).label.toLowerCase()}).{" "}
          <button className="btn xs" style={{ marginLeft: 8 }} disabled={busy} onClick={aceptar}>Aceptar</button>{" "}
          <button className="btn ghost xs" onClick={() => setRejecting({ id: ws.id, title: titulo, client: ws.client?.company })}>
            Rechazar</button>
        </div></div>
      )}
      {entregada && (
        <div className="banner info">✅ <div>
          <b>Revisión entregada.</b> El expediente queda disponible en modo consulta; el chat sigue abierto por 7 días.
        </div></div>
      )}
      <div className="workgrid">{izquierda}{derecha}</div>

      {/* ── Modal comentario ── */}
      <Modal open={Boolean(cmtModal)} onClose={() => setCmtModal(null)} width={620}>
        {cmtModal && (
          <>
            <h2>💬 Comentar párrafo {cmtModal.index + 1}</h2>
            <p className="small" style={{ margin: "8px 0", background: "var(--chip)", padding: 10, borderRadius: 10 }}>
              {stripTags(parrafos[cmtModal.index]?.html || "").slice(0, 180)}…
            </p>
            <label>Comentario (visible para el cliente, firmado por usted)</label>
            <textarea rows={3} value={cmtText} onChange={(e) => setCmtText(e.target.value)}
              placeholder="Su observación jurídica…" />
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
              <button className="btn ghost" onClick={() => setCmtModal(null)}>Cancelar</button>
              <button className="btn" onClick={publicarComentario} disabled={busy}>Publicar comentario</button>
            </div>
          </>
        )}
      </Modal>

      {/* ── Modal cambio propuesto ── */}
      <Modal open={Boolean(chgModal)} onClose={() => setChgModal(null)} width={680}>
        {chgModal && (
          <>
            <h2>✏️ Proponer cambio · párrafo {chgModal.index + 1}</h2>
            <p className="small" style={{ margin: "8px 0" }}>
              El cambio queda como <del>texto eliminado</del> / <ins>texto propuesto</ins> (control de cambios).
              El cliente lo acepta o rechaza desde su aplicación. El texto original debe coincidir exactamente
              con un fragmento del párrafo.
            </p>
            <label>Texto original a reemplazar</label>
            <textarea rows={2} value={chgOld} onChange={(e) => setChgOld(e.target.value)} />
            <label>Texto propuesto</label>
            <textarea rows={3} value={chgNew} onChange={(e) => setChgNew(e.target.value)} />
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
              <button className="btn ghost" onClick={() => setChgModal(null)}>Cancelar</button>
              <button className="btn" onClick={guardarCambio} disabled={busy}>Guardar cambio propuesto</button>
            </div>
          </>
        )}
      </Modal>

      {/* ── Modal entrega firmada ── */}
      <Modal open={deliverOpen} onClose={() => setDeliverOpen(false)} width={680}>
        <h2>{esDoc ? "Entregar revisión firmada" : "Enviar respuesta firmada"}</h2>
        <p className="small" style={{ margin: "8px 0" }}><b>{titulo}</b> · {ws.client?.company}</p>
        {esDoc && (
          <div className="card" style={{ background: "var(--chip)", border: "none", padding: 12, margin: "10px 0" }}>
            <small>Se entregarán al cliente: <b>{nChgs}</b> cambios propuestos (control de cambios),{" "}
              <b>{nCmts}</b> comentarios y su observación final.</small>
          </div>
        )}
        <label>Observación final (resumen firmado de su revisión) *</label>
        <textarea rows={4} value={obs} onChange={(e) => setObs(e.target.value)}
          placeholder="Síntesis profesional: riesgos detectados, recomendaciones y próximos pasos…" />
        <div className="card" style={{ background: "var(--infobg)", border: "none", padding: 12, margin: "12px 0" }}>
          <small>✍️ <b>Firma profesional:</b> {lawyer?.name} · RUT {lawyer?.rut}
            {lawyer?.bar ? ` · ${lawyer.bar}` : ""}
            {lawyer?.university ? ` · Título: ${lawyer.university}${lawyer?.degree_year ? ` (${lawyer.degree_year})` : ""}` : ""}</small>
        </div>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontWeight: 400 }}>
          <input type="checkbox" style={{ width: "auto", marginTop: 4 }} checked={declara}
            onChange={(e) => setDeclara(e.target.checked)} />
          <span className="small">Declaro haber revisado íntegramente el {esDoc ? "documento" : "caso"} y que mi{" "}
            {esDoc ? "revisión" : "respuesta"} refleja mi opinión profesional.</span>
        </label>
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button className="btn ghost" onClick={() => setDeliverOpen(false)}>Seguir trabajando</button>
          <button className="btn" onClick={entregar} disabled={busy}>
            {busy ? "Entregando…" : "Entregar al cliente ✓"}
          </button>
        </div>
      </Modal>

      {/* ── Modal visor histórico con marca de agua ── */}
      <Modal open={Boolean(histDoc)} onClose={() => setHistDoc(null)} width={720}>
        {histDoc && (
          <>
            <h2>👁️ {histDoc.name}</h2>
            <p className="small" style={{ margin: "6px 0" }}>
              {histDoc.meta?.kind} · {histDoc.meta?.created_at} ·{" "}
              <b style={{ color: "var(--warn)" }}>solo consulta, descarga deshabilitada</b>
            </p>
            <div className="wmwrap">
              <div className="wmdoc" dangerouslySetInnerHTML={{ __html: histDoc.content_html }} />
              <div className="wm"><span>
                {histDoc.watermark}<br />{histDoc.watermark}<br />{histDoc.watermark}
              </span></div>
            </div>
            <div className="row" style={{ justifyContent: "space-between", marginTop: 14 }}>
              <small>🔒 Visualización con marca de agua registrada en la bitácora de acceso.</small>
              <button className="btn ghost" onClick={() => setHistDoc(null)}>Cerrar</button>
            </div>
          </>
        )}
      </Modal>

      {rejecting && (
        <RejectModal review={rejecting} onClose={() => setRejecting(null)}
          onDone={() => { setRejecting(null); navigate("/requerimientos"); }} />
      )}
    </>
  );
}
