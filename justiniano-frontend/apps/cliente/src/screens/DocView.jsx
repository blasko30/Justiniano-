import React, { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Modal, Spinner, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { errCode, errMsg, fmtDate, docStatus, isFreePlan, DISCLAIMER_DOC, REVIEW_STEPS } from "../lib/format.js";
import { PageHead, MHead, MBody, MFoot } from "../components/Shell.jsx";
import ReviewModal from "../components/ReviewModal.jsx";
import { DocFieldsEditModal } from "../components/DocGenModal.jsx";
import { useUser } from "../components/UserContext.jsx";

function ReviewTimeline({ state, lawyer }) {
  return (
    <div className="timeline">
      {REVIEW_STEPS.map((s, i) => {
        const n = i + 1;
        const cls = state > n ? "done" : state === n ? "now" : "";
        return (
          <div className={`tl ${cls}`} key={s}>
            <b style={{ fontSize: 13 }}>{s}</b>
            {n === 2 && lawyer ? <div className="subtle">{lawyer.name}{lawyer.rut ? ` · RUT ${lawyer.rut}` : ""}</div> : null}
            {n === 4 && state === 4 ? <div className="subtle">Documento revisado y observado por abogado habilitado.</div> : null}
          </div>
        );
      })}
    </div>
  );
}

export default function DocView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { user } = useUser();
  const free = isFreePlan(user?.plan);

  const [doc, setDoc] = useState(null);
  const [formatId, setFormatId] = useState(null);
  const [loading, setLoading] = useState(true);

  const [dlOpen, setDlOpen] = useState(false);
  const [dlFmt, setDlFmt] = useState("docx");
  const [dlAck, setDlAck] = useState(false);
  const [dlBusy, setDlBusy] = useState(false);

  const [rmOpen, setRmOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(Boolean(location.state?.wantReview));

  const load = async () => {
    try {
      const d = await api.documents.get(id);
      setDoc(d);
      // El formato no viene en la respuesta: se resuelve por área + nombre
      if (d.area) {
        try {
          const fmts = await api.catalog.documentFormats({ area: d.area });
          const hit = (fmts.items || []).find((f) => f.name === d.name);
          setFormatId(hit?.id || null);
        } catch { setFormatId(null); }
      }
    } catch (e) {
      toast(errMsg(e), "err");
      navigate("/app/documentos");
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [id]);

  const download = async () => {
    if (!dlAck) { toast("Debe confirmar la advertencia para descargar el documento", "warn"); return; }
    setDlBusy(true);
    try {
      const r = await api.documents.download(id, { format: dlFmt, warning_acknowledged: true });
      if (r?.download_url) {
        const a = document.createElement("a");
        a.download = `${d?.name || "documento"}.html`;
        a.download = `${doc?.name || "documento"}.${dlFmt}`;
        a.click();
      }
      setDlOpen(false);
      setDlAck(false);
      toast(`Descarga iniciada · ${dlFmt.toUpperCase()}`, "ok");
    } catch (e) {
      if (e.status === 402) toast("Alcanzó el límite mensual de descargas de su plan", "warn");
      else toast(errMsg(e), "err");
    } finally {
      setDlBusy(false);
    }
  };

  const removeDisc = async () => {
    try {
      await api.documents.removeDisclaimer(id);
      setRmOpen(false);
      toast("Advertencia eliminada por el usuario", "ok");
      load();
    } catch (e) {
      if (errCode(e) === "already_removed") { setRmOpen(false); load(); }
      else toast(errMsg(e), "err");
    }
  };

  if (loading || !doc) {
    return <div className="center" style={{ padding: 60 }}><Spinner size={30} /></div>;
  }

  const [stCls, stLabel] = docStatus(doc.status);
  const rev = doc.review;
  const missing = doc.missing_fields || [];
  const fields = doc.fields || {};
  const canEdit = ["draft", "pending"].includes(doc.status);

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn sm" onClick={() => navigate("/app/documentos")}>← Volver</button>
      </div>
      <PageHead
        title={doc.name}
        sub={`${doc.type || "Documento"} · ${fmtDate(doc.created_at)}`}
        right={
          <>
            <span className={`badge ${stCls}`}>{stLabel}</span>
            {canEdit && formatId ? <button className="btn sm" onClick={() => setEditOpen(true)}>✎ Editar datos</button> : null}
            <button className="btn sm" onClick={() => setDlOpen(true)}>⬇ Descargar</button>
            {!rev || rev.state >= 4 ? (
              <button className="btn gold sm" onClick={() => setReviewOpen(true)}>🧑‍⚖️ Pedir revisión de abogado</button>
            ) : null}
          </>
        }
      />

      <div className="docgrid">
        {/* Documento */}
        <div className="doc">
          <h4>{doc.type || "Documento"} · Borrador generado por Justiniano</h4>
          {!doc.disclaimer_removed && (
            <div className="docdisc">
              <button className="rm" onClick={() => setRmOpen(true)}>✕ Eliminar esta nota</button>
              <b>⚠️ EXENCIÓN DE RESPONSABILIDAD</b>
              {DISCLAIMER_DOC}
              <div style={{ marginTop: 6, fontStyle: "italic", opacity: 0.85 }}>
                Puede eliminar esta nota antes de descargar el documento.
              </div>
            </div>
          )}
          {rev?.observations ? (
            <div className="cmt">🧑‍⚖️ Observación del abogado: {rev.observations}</div>
          ) : null}
          <div dangerouslySetInnerHTML={{ __html: doc.content_html || "<p>(Documento sin contenido)</p>" }} />
          {!doc.disclaimer_removed && <div className="docfoot">{DISCLAIMER_DOC}</div>}
        </div>

        {/* Panel lateral */}
        <div className="grid">
          <div className="card pad">
            <h3 style={{ marginBottom: 10 }}>Estado</h3>
            {rev ? (
              <>
                <ReviewTimeline state={rev.state} lawyer={rev.lawyer} />
                {rev.state === 4 && rev.observations ? (
                  <div className="note gold" style={{ marginTop: 10 }}>
                    <b>Observaciones del abogado:</b> {rev.observations}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <p className="muted" style={{ fontSize: 13 }}>Borrador generado por IA. Aún no solicitó revisión humana.</p>
                <button className="btn gold block sm" style={{ marginTop: 12 }} onClick={() => setReviewOpen(true)}>
                  🧑‍⚖️ Pedir revisión de abogado
                </button>
              </>
            )}
          </div>

          <div className="card pad">
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
              <h3>Datos del documento</h3>
              {canEdit && formatId ? <button className="btn sm" onClick={() => setEditOpen(true)}>✎ Editar datos</button> : null}
            </div>
            {Object.keys(fields).length ? (
              <table className="tablelike" style={{ fontSize: 12.5 }}>
                <tbody>
                  {Object.entries(fields).map(([k, v]) => {
                    const val = Array.isArray(v) ? v.join(", ") : String(v);
                    return (
                      <tr key={k} style={{ cursor: "default" }}>
                        <td style={{ padding: "7px 0", color: "var(--fg-muted)", width: "45%" }}>{k.replace(/_/g, " ")}</td>
                        <td style={{ padding: "7px 0", fontWeight: 600 }}>{val.length > 42 ? `${val.slice(0, 42)}…` : val}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="subtle">Aún no ha completado los datos.</p>
            )}
            {doc.disclaimer_removed ? (
              <div className="note" style={{ marginTop: 12, background: "var(--err-bg)", borderColor: "var(--err)" }}>
                🗑️ Advertencia eliminada por el usuario
              </div>
            ) : null}
            {missing.length ? (
              <div className="note" style={{ marginTop: 12 }}>⚠️ {missing.length} campos sin completar</div>
            ) : (
              <div className="note" style={{ marginTop: 12, background: "var(--ok-bg)", borderColor: "var(--ok)" }}>
                ✅ Documento completo
              </div>
            )}
          </div>

          {doc.legal_basis?.length ? (
            <div className="card pad">
              <h3 style={{ marginBottom: 8 }}>Fundamento legal</h3>
              <div className="subtle">{doc.legal_basis.join(" · ")}</div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Modal de descarga */}
      <Modal open={dlOpen} onClose={() => setDlOpen(false)} width={520}>
        <MHead icon="⚠️" title="Antes de descargar" sub={doc.name} />
        <MBody>
          <div className="field">
            <label>Formato de descarga</label>
            <div className="row">
              {[["docx", "Word (.docx)", "📘"], ["pdf", "PDF (.pdf)", "📕"], ["odt", "OpenDocument (.odt)", "📄"]].map(([k, l, i]) => (
                <button key={k} className={`btn sm ${dlFmt === k ? "primary" : ""}`} onClick={() => setDlFmt(k)}>
                  {i} {l}
                </button>
              ))}
            </div>
          </div>
          <label className={`consent ${dlAck ? "on" : ""}`} style={{ marginTop: 14 }}>
            <input type="checkbox" checked={dlAck} onChange={(e) => setDlAck(e.target.checked)} />
            <span>
              Entiendo que este documento fue generado por una IA y puede contener errores. Asumo la
              responsabilidad de revisarlo y validarlo antes de su firma.
            </span>
          </label>
          {doc.disclaimer_removed ? (
            <div className="note" style={{ marginTop: 12, background: "var(--err-bg)", borderColor: "var(--err)" }}>
              🗑️ Advertencia eliminada por el usuario
            </div>
          ) : (
            <div className="note" style={{ marginTop: 12 }}>
              📄 El archivo incluirá la nota de exención de responsabilidad en la primera página y en el pie.
            </div>
          )}
          {missing.length ? (
            <div className="note" style={{ marginTop: 10, background: "var(--warn-bg)", borderColor: "var(--warn)" }}>
              ⚠️ {missing.length} campos sin completar
            </div>
          ) : null}
        </MBody>
        <MFoot>
          <button className="btn" onClick={() => setDlOpen(false)}>Cancelar</button>
          <button className="btn primary" disabled={!dlAck || dlBusy} onClick={download}>
            {dlBusy ? <Spinner size={16} /> : "Entiendo y confirmo"}
          </button>
        </MFoot>
      </Modal>

      {/* Confirmación de eliminación del disclaimer */}
      <Modal open={rmOpen} onClose={() => setRmOpen(false)} width={480}>
        <MHead icon="🗑️" title="Eliminar esta nota"
          sub="Quedará registrado que usted vio la advertencia y decidió eliminarla del documento." />
        <MFoot>
          <button className="btn" onClick={() => setRmOpen(false)}>Cancelar</button>
          <button className="btn danger" onClick={removeDisc}>Eliminar esta nota</button>
        </MFoot>
      </Modal>

      {/* Edición de campos */}
      <DocFieldsEditModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        formatId={formatId}
        initialValues={fields}
        docId={id}
        freePlan={free}
        onSaved={load}
      />

      {/* Revisión */}
      <ReviewModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        documentId={id}
        area={doc.area}
        onCreated={() => { load(); navigate("/app/revisiones"); }}
      />
    </>
  );
}
