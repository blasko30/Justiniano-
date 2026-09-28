import React, { useRef } from "react";
import { ESPECIALIDADES, UNIS } from "../lib/format.js";

/**
 * Campos de la acreditación profesional (§20.2), compartidos entre el paso 2
 * del registro y el reemplazo de documentos en «Mi perfil».
 *
 * value = { uni, uniOtra, tit, idFile, titFile, esp: [códigos] }
 */
export default function AccreditationFields({ value, onChange }) {
  const idRef = useRef(null);
  const titRef = useRef(null);
  const set = (patch) => onChange({ ...value, ...patch });

  const toggleEsp = (code) => {
    const esp = value.esp.includes(code)
      ? value.esp.filter((c) => c !== code)
      : [...value.esp, code];
    set({ esp });
  };

  const fmtSize = (f) => (f.size >= 1048576
    ? `${(f.size / 1048576).toFixed(1).replace(".", ",")} MB`
    : `${Math.max(1, Math.round(f.size / 1024))} KB`);

  return (
    <>
      <div className="formgrid">
        <div>
          <label>Universidad que otorgó el título *</label>
          <select value={value.uni} onChange={(e) => set({ uni: e.target.value })}>
            {UNIS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          {value.uni === "Otra…" && (
            <input style={{ marginTop: 8 }} placeholder="Nombre de la universidad"
              value={value.uniOtra} onChange={(e) => set({ uniOtra: e.target.value })} />
          )}
        </div>
        <div>
          <label>Año de titulación *</label>
          <input type="number" min="1970" max={new Date().getFullYear()} placeholder="2018"
            value={value.tit} onChange={(e) => set({ tit: e.target.value })} />
        </div>
      </div>

      <label>Documento de identidad (ambos lados) *</label>
      <div className={`attach ${value.idFile ? "ok" : ""}`}>
        <small>{value.idFile ? `✓ ${value.idFile.name} · ${fmtSize(value.idFile)}` : "PDF o imagen · máx. 10 MB"}</small>
        <input ref={idRef} type="file" accept=".pdf,image/*" style={{ display: "none" }}
          onChange={(e) => set({ idFile: e.target.files?.[0] || null })} />
        <button type="button" className={`btn ${value.idFile ? "ghost" : "sec"} xs`}
          onClick={() => { if (value.idFile) { set({ idFile: null }); if (idRef.current) idRef.current.value = ""; } else idRef.current?.click(); }}>
          {value.idFile ? "Quitar" : "Adjuntar"}
        </button>
      </div>

      <label>Certificado de título de abogado *</label>
      <div className={`attach ${value.titFile ? "ok" : ""}`}>
        <small>{value.titFile ? `✓ ${value.titFile.name} · ${fmtSize(value.titFile)}` : "PDF · máx. 10 MB · debe indicar la universidad que lo emite"}</small>
        <input ref={titRef} type="file" accept="application/pdf" style={{ display: "none" }}
          onChange={(e) => set({ titFile: e.target.files?.[0] || null })} />
        <button type="button" className={`btn ${value.titFile ? "ghost" : "sec"} xs`}
          onClick={() => { if (value.titFile) { set({ titFile: null }); if (titRef.current) titRef.current.value = ""; } else titRef.current?.click(); }}>
          {value.titFile ? "Quitar" : "Adjuntar"}
        </button>
      </div>

      <label>Especialidades en las que puede revisar y asesorar *</label>
      <div className="chips">
        {ESPECIALIDADES.map((e) => (
          <button key={e.code} type="button" className={`chipbtn ${value.esp.includes(e.code) ? "on" : ""}`}
            onClick={() => toggleEsp(e.code)}>{e.label}</button>
        ))}
      </div>
    </>
  );
}

/** Validación del bloque de acreditación; devuelve el mensaje de error o null. */
export function validarAcreditacion(v) {
  const uni = v.uni === "Otra…" ? v.uniOtra.trim() : v.uni;
  if (!uni || !v.tit) return "Indique universidad y año de titulación";
  const year = parseInt(v.tit, 10);
  if (!(year >= 1970 && year <= new Date().getFullYear())) return "Indique un año de titulación válido";
  if (!v.idFile) return "Adjunte su documento de identidad";
  if (!v.titFile) return "Adjunte su certificado de título";
  if (v.titFile.type !== "application/pdf") return "El certificado de título debe ser PDF";
  if (!v.esp.length) return "Seleccione al menos una especialidad";
  return null;
}

/** Construye el multipart/form-data de POST /lawyers/me/accreditation (§20.2). */
export function formDataAcreditacion(v) {
  const fd = new FormData();
  fd.append("id_document", v.idFile);
  fd.append("degree_certificate", v.titFile);
  fd.append("university", v.uni === "Otra…" ? v.uniOtra.trim() : v.uni);
  fd.append("degree_year", String(parseInt(v.tit, 10)));
  fd.append("specialties", v.esp.join(","));
  return fd;
}

export const acreditacionVacia = () =>
  ({ uni: UNIS[0], uniOtra: "", tit: "", idFile: null, titFile: null, esp: [] });
