import React, { useState } from "react";
import { Modal, Spinner, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { ESPECIALIDADES } from "../lib/format.js";
import { useLawyer } from "../components/LawyerContext.jsx";
import AccreditationFields, {
  acreditacionVacia, formDataAcreditacion, validarAcreditacion,
} from "../components/AccreditationFields.jsx";

const DOC_LABELS = {
  id_document: "Documento de identidad",
  degree_certificate: "Certificado de título",
};

/**
 * Mi perfil (§20.3/§20.4): acreditación profesional y documentos, especialidades
 * (sujetas a validación de administración) y preferencias operativas.
 */
export default function Perfil() {
  const { lawyer, verified, refresh } = useLawyer();
  const toast = useToast();
  const [acredOpen, setAcredOpen] = useState(false);
  const [acred, setAcred] = useState(acreditacionVacia());
  const [busy, setBusy] = useState(false);
  const [savingSpecs, setSavingSpecs] = useState(false);

  if (!lawyer) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Spinner size={30} /></div>;

  const pendiente = lawyer.verification_status === "pending";
  const rechazada = lawyer.verification_status === "rejected";
  const seleccion = lawyer.specialties_pending?.length ? lawyer.specialties_pending : (lawyer.specialties || []);
  const cambiosPendientes = Boolean(lawyer.specialties_pending?.length)
    && JSON.stringify([...lawyer.specialties_pending].sort()) !== JSON.stringify([...(lawyer.specialties || [])].sort());

  const toggleEsp = async (code) => {
    const nuevas = seleccion.includes(code) ? seleccion.filter((c) => c !== code) : [...seleccion, code];
    if (!nuevas.length) { toast("Debe mantener al menos una especialidad", "warn"); return; }
    setSavingSpecs(true);
    try {
      await api.lawyers.patchMe({ specialties: nuevas });
      await refresh();
      toast("Especialidades actualizadas · sujetas a validación de administración", "ok");
    } catch (e) {
      toast(e.message, "err");
    } finally {
      setSavingSpecs(false);
    }
  };

  const patchPref = async (patch, mensaje) => {
    try {
      await api.lawyers.patchMe(patch);
      await refresh();
      toast(mensaje, "ok");
    } catch (e) {
      toast(e.message, "err");
    }
  };

  const abrirAcred = () => {
    setAcred({
      ...acreditacionVacia(),
      uni: lawyer.university || acreditacionVacia().uni,
      uniOtra: lawyer.university || "",
      tit: lawyer.degree_year ? String(lawyer.degree_year) : "",
      esp: seleccion,
    });
    setAcredOpen(true);
  };

  const subirAcreditacion = async () => {
    const err = validarAcreditacion(acred);
    if (err) { toast(err, "warn"); return; }
    setBusy(true);
    try {
      await api.http.post("/lawyers/me/accreditation", { formData: formDataAcreditacion(acred) });
      await refresh();
      setAcredOpen(false);
      toast("Documentos enviados · su cuenta queda en verificación (24–48 h hábiles)", "ok");
    } catch (e) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Mi perfil</h1>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 14 }}>
        <div className="card">
          <h2>Acreditación profesional</h2>
          <div className="row" style={{ margin: "10px 0" }}>
            <span className={`badge ${verified ? "b-ok" : rechazada ? "b-bad" : "b-warn"}`}>
              {verified ? "✓ Verificada por Justiniano"
                : rechazada ? "✕ Rechazada" : "⏳ En verificación (24–48 h hábiles)"}
            </span>
          </div>
          {rechazada && lawyer.rejection_reason && (
            <p className="small err" style={{ marginBottom: 8 }}>Motivo: {lawyer.rejection_reason}</p>
          )}
          {[
            ["Nombre", lawyer.name],
            ["RUT", lawyer.rut],
            ["Universidad que otorgó el título", lawyer.university || "—"],
            ["Año de titulación", lawyer.degree_year || "—"],
            ["Colegiatura", lawyer.bar || "—"],
          ].map(([k, v]) => (
            <div key={k} className="row" style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px dashed var(--border)" }}>
              <small>{k}</small><b style={{ fontSize: 14, textAlign: "right" }}>{v}</b>
            </div>
          ))}
          <label>Documentos adjuntos</label>
          {lawyer.documents?.length ? lawyer.documents.map((d) => (
            <div key={d.kind} className="attach ok">
              <small>✓ {DOC_LABELS[d.kind] || d.kind} · {d.name} {d.status === "verified" ? "· validado" : "· en revisión"}</small>
              <button className="btn ghost xs" onClick={abrirAcred}>Reemplazar</button>
            </div>
          )) : (
            <div className="attach">
              <small>Aún no ha subido su documento de identidad ni su certificado de título.</small>
              <button className="btn sec xs" onClick={abrirAcred}>Subir acreditación</button>
            </div>
          )}
          <small style={{ display: "block", marginTop: 10 }}>
            Si cambia un documento, la cuenta vuelve al estado «en verificación» hasta validarlo nuevamente.
          </small>
        </div>

        <div>
          <div className="card">
            <h2>Especialidades</h2>
            <p className="small">Determinan qué requerimientos se le asignan y qué casos ve en la bolsa.</p>
            <div className="chips">
              {ESPECIALIDADES.map((e) => (
                <button key={e.code} disabled={savingSpecs}
                  className={`chipbtn ${seleccion.includes(e.code) ? "on" : ""}`}
                  onClick={() => toggleEsp(e.code)}>{e.label}</button>
              ))}
            </div>
            {(cambiosPendientes || (pendiente && lawyer.specialties_pending?.length > 0)) && (
              <small style={{ display: "block", marginTop: 10 }}>
                ⏳ Sus cambios de especialidades están pendientes de validación por administración.
              </small>
            )}
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h2>Preferencias</h2>
            <div className="tglrow">
              <div><b>Recibir requerimientos urgentes</b><br /><small>8 h hábiles de plazo · tarifa mayor</small></div>
              <label className="tgl">
                <input type="checkbox" checked={Boolean(lawyer.accepts_urgent)}
                  onChange={(e) => patchPref({ accepts_urgent: e.target.checked }, "Preferencia de urgentes actualizada")} />
                <i />
              </label>
            </div>
            <div className="tglrow">
              <div><b>Actuar como promotor / vendedor</b><br /><small>Habilita el módulo «Mis ventas» y las comisiones</small></div>
              <label className="tgl">
                <input type="checkbox" checked={Boolean(lawyer.promoter)}
                  onChange={(e) => patchPref({ promoter: e.target.checked },
                    e.target.checked ? "Módulo «Mis ventas» habilitado" : "Módulo «Mis ventas» oculto")} />
                <i />
              </label>
            </div>
            <div className="tglrow">
              <div><b>Disponible para nuevos casos</b><br /><small>Si lo desactiva, deja de recibir asignaciones (vacaciones, sobrecarga)</small></div>
              <label className="tgl">
                <input type="checkbox" checked={Boolean(lawyer.available)}
                  onChange={(e) => patchPref({ available: e.target.checked },
                    e.target.checked ? "Disponible para asignaciones" : "Pausa de asignaciones activada")} />
                <i />
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* ── Modal reemplazo de acreditación ── */}
      <Modal open={acredOpen} onClose={() => setAcredOpen(false)} width={680}>
        <h2>Actualizar acreditación profesional</h2>
        <p className="small" style={{ margin: "8px 0" }}>
          Debe volver a adjuntar ambos documentos. Al enviarlos, su cuenta queda en «verificación en curso»
          hasta que el equipo de Justiniano los valide.
        </p>
        <AccreditationFields value={acred} onChange={setAcred} />
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button className="btn ghost" onClick={() => setAcredOpen(false)}>Cancelar</button>
          <button className="btn" onClick={subirAcreditacion} disabled={busy}>
            {busy ? "Subiendo…" : "Enviar a verificación ✓"}
          </button>
        </div>
      </Modal>
    </>
  );
}
