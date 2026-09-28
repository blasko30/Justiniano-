import React, { useEffect, useMemo, useState } from "react";
import { Modal, Spinner, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { errCode, errDetails, errMsg } from "../lib/format.js";
import { MHead, MBody, MFoot } from "./Shell.jsx";

/* ── Normalización del esquema dinámico (§8.5) ───────────────────── */

function mapType(t) {
  const v = (t || "text").toLowerCase();
  if (["texto_largo", "textarea", "area"].includes(v)) return "area";
  if (["fecha_iso", "date", "fecha"].includes(v)) return "date";
  if (["monto_clp", "number", "num", "paginacion", "entero"].includes(v)) return "number";
  if (v === "select") return "select";
  if (["checkbox_group", "checks"].includes(v)) return "checks";
  if (v === "email") return "email";
  return "text"; // texto_corto, rut, etc.
}

function pickText(x, fallback = "") {
  if (!x) return fallback;
  if (typeof x === "string") return x;
  return x.es || Object.values(x)[0] || fallback;
}

function normField(f) {
  const key = f.key || f.name || f.id;
  return {
    key,
    label: pickText(f.label || f.label_i18n, key ? key.replace(/_/g, " ") : ""),
    type: mapType(f.type),
    required: Boolean(f.required),
    sensitive: Boolean(f.sensitive),
    options: f.options || [],
    placeholder: f.placeholder || f.ph || "",
    full: Boolean(f.full) || ["area", "checks"].includes(mapType(f.type)),
  };
}

/** Acepta {sections:[{title,fields}]}, lista plana de campos o {fields:[...]}. */
export function normalizeSections(resp) {
  let secs = resp?.sections;
  if (!Array.isArray(secs) || !secs.length) {
    const flat = resp?.fields || [];
    secs = flat.length ? [{ title: "Datos del documento", fields: flat }] : [];
  } else if (!secs[0]?.fields) {
    secs = [{ title: "Datos del documento", fields: secs }];
  }
  return secs.map((s) => ({
    title: pickText(s.title || s.name || s.title_i18n, "Antecedentes"),
    fields: (s.fields || []).map(normField).filter((f) => f.key),
  }));
}

export function allFields(sections) {
  return sections.flatMap((s) => s.fields);
}

/** Coerce los valores del formulario al tipo que espera el backend (§11.2). */
function coerceValues(sections, vals) {
  const out = {};
  for (const f of allFields(sections)) {
    const v = vals[f.key];
    if (v === undefined || v === null) continue;
    if (f.type === "checks") {
      if (Array.isArray(v) && v.length) out[f.key] = v;
    } else if (f.type === "number") {
      const n = parseInt(String(v).replace(/[^\d]/g, ""), 10);
      if (!Number.isNaN(n)) out[f.key] = n;
    } else {
      const s = String(v).trim();
      if (s) out[f.key] = s;
    }
  }
  return out;
}

/* ── Campo individual ────────────────────────────────────────────── */

function FieldInput({ f, value, bad, onChange }) {
  const cls = `input ${bad ? "bad" : ""}`;
  if (f.type === "checks") {
    const arr = Array.isArray(value) ? value : [];
    return (
      <div className="fcheck">
        {f.options.map((o) => (
          <label key={o}>
            <input
              type="checkbox"
              checked={arr.includes(o)}
              onChange={(e) => onChange(e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))}
            />{" "}
            {o}
          </label>
        ))}
      </div>
    );
  }
  if (f.type === "select") {
    return (
      <select className={cls} value={value || ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">— Seleccione —</option>
        {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (f.type === "area") {
    return <textarea className={cls} rows={2} placeholder={f.placeholder} value={value || ""} onChange={(e) => onChange(e.target.value)} />;
  }
  const type = f.type === "date" ? "date" : f.type === "email" ? "email" : "text";
  return (
    <input
      className={cls}
      type={type}
      inputMode={f.type === "number" ? "numeric" : undefined}
      placeholder={f.placeholder}
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Formulario dinámico reutilizable (paso 2 y edición de campos). */
export function DynamicForm({ sections, vals, setVals, missing, sensitive, freePlan }) {
  return (
    <>
      {sensitive ? (
        <div className="sensnote">
          <span style={{ fontSize: 16 }}>🔒</span>
          <div>
            Nota: Estás ingresando datos personales sensibles. Al continuar, autorizas su procesamiento
            cifrado con el único fin de confeccionar el documento
            {freePlan ? (
              <div style={{ marginTop: 5, opacity: 0.85 }}>
                En el plan Gratuito los datos se conservan 30 días y luego se eliminan.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {sections.map((sec) => (
        <div className="fsec" key={sec.title}>
          <h4>{sec.title}</h4>
          <div className="fgrid">
            {sec.fields.map((f) => (
              <div key={f.key} className={`f ${f.full ? "full" : ""}`}>
                <label>
                  {f.label}{f.required ? <span className="rq"> *</span> : null}
                </label>
                <FieldInput
                  f={f}
                  value={vals[f.key]}
                  bad={missing.includes(f.key)}
                  onChange={(v) => setVals((prev) => ({ ...prev, [f.key]: v }))}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="note">
        ⚖️ Los campos obligatorios son los que la normativa exige para que el documento produzca efecto.
      </div>
    </>
  );
}

/* ── Modal Generar documento (2 pasos) ───────────────────────────── */

export default function DocGenModal({ open, onClose, consultationId = null, initialArea = null, freePlan = false, onCreated, onQuota }) {
  const toast = useToast();

  const [step, setStep] = useState(1);
  const [areas, setAreas] = useState([]);
  const [area, setArea] = useState("");
  const [formats, setFormats] = useState([]);
  const [formatId, setFormatId] = useState("");
  const [wantReview, setWantReview] = useState(false);

  const [schema, setSchema] = useState(null); // {sections, contains_sensitive_fields}
  const [vals, setVals] = useState({});
  const [missing, setMissing] = useState([]);

  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  // Carga de áreas al abrir
  useEffect(() => {
    if (!open) return;
    setStep(1); setVals({}); setMissing([]); setSchema(null); setWantReview(false);
    let alive = true;
    setLoading(true);
    api.catalog.documentAreas()
      .then((r) => {
        if (!alive) return;
        const items = r.items || [];
        setAreas(items);
        const first = (initialArea && items.find((a) => a.id === initialArea)) ? initialArea : items[0]?.id || "";
        setArea(first);
      })
      .catch((e) => toast(errMsg(e), "err"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Formatos del área seleccionada
  useEffect(() => {
    if (!open || !area) return;
    let alive = true;
    api.catalog.documentFormats({ area })
      .then((r) => {
        if (!alive) return;
        setFormats(r.items || []);
        setFormatId(r.items?.[0]?.id || "");
      })
      .catch((e) => toast(errMsg(e), "err"));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, area]);

  const selFormat = useMemo(() => formats.find((f) => f.id === formatId), [formats, formatId]);
  const sections = useMemo(() => (schema ? normalizeSections(schema) : []), [schema]);

  const goStep2 = async () => {
    if (!formatId) { toast("Seleccione un formato de documento", "warn"); return; }
    setLoading(true);
    try {
      const r = await api.catalog.formatFields(formatId);
      console.log("FORMAT FIELDS RESPONSE:", JSON.stringify(r));
      setSchema(r);
      setVals({});
      setMissing([]);
      setStep(2);
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      setLoading(false);
    }
  };

  const submit = async (strict) => {
    const fields = coerceValues(sections, vals);
    if (strict) {
      const faltan = allFields(sections).filter((f) => f.required && (fields[f.key] === undefined)).map((f) => f.key);
      if (faltan.length) {
        setMissing(faltan);
        toast(`Complete los campos obligatorios (${faltan.length})`, "warn");
        return;
      }
    }
    setSending(true);
    try {
      const body = {
        format_id: formatId,
        fields,
        complete_later: !strict,
        sensitive_data_consent: true,
      };
      if (consultationId) body.consultation_id = consultationId;
      const r = await api.documents.create(body);
      toast("Documento generado", "ok");
      onClose?.();
      onCreated?.(r, { wantReview });
    } catch (e) {
      if (e.status === 402) { onClose?.(); onQuota ? onQuota(e) : toast(errMsg(e), "err"); }
      else if (errCode(e) === "missing_required_fields") {
        const faltan = errDetails(e)?.fields || [];
        setMissing(Array.isArray(faltan) ? faltan : []);
        toast("Hay campos obligatorios sin completar", "warn");
      } else toast(errMsg(e), "err");
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} width={640}>
      {step === 1 ? (
        <>
          <MHead icon="📄" title="Generar documento"
            sub="Elija el área y el formato; el agente redacta el documento con los antecedentes de su consulta." />
          <MBody>
            {loading ? <div className="center" style={{ padding: 24 }}><Spinner /></div> : (
              <>
                <div className="subtle" style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 8 }}>
                  Paso 1 de 2
                </div>
                <div className="field">
                  <label>Área del derecho</label>
                  <select className="input" value={area} onChange={(e) => setArea(e.target.value)}>
                    {areas.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}{a.formats_count ? ` · ${a.formats_count} formatos` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Formato del documento · <span className="subtle">{formats.length} formatos disponibles</span></label>
                  <select className="input" value={formatId} onChange={(e) => setFormatId(e.target.value)}>
                    {formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                {selFormat ? (
                  <div className="row" style={{ gap: 8, margin: "-4px 0 14px", flexWrap: "wrap" }}>
                    {selFormat.type ? <span className="tag">{selFormat.type}</span> : null}
                    {selFormat.notarial_signature_required ? <span className="badge warn">Requiere firma notarial</span> : null}
                  </div>
                ) : null}
                <label className="row" style={{ gap: 9, fontSize: 13 }}>
                  <input type="checkbox" checked={wantReview} onChange={(e) => setWantReview(e.target.checked)} />
                  Pedir revisión de abogado (1 crédito)
                </label>
              </>
            )}
          </MBody>
          <MFoot>
            <button className="btn" onClick={onClose}>Cancelar</button>
            <button className="btn primary" disabled={loading || !formatId} onClick={goStep2}>Continuar →</button>
          </MFoot>
        </>
      ) : (
        <>
          <MHead icon="📝" title={selFormat?.name || "Datos del documento"}
            sub="Complete los campos para que el documento salga listo para firma. Puede dejarlos en blanco y editarlos después." />
          <MBody>
            <div className="subtle" style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 10 }}>
              Paso 2 de 2
            </div>
            <DynamicForm
              sections={sections}
              vals={vals}
              setVals={setVals}
              missing={missing}
              sensitive={Boolean(schema?.contains_sensitive_fields)}
              freePlan={freePlan}
            />
          </MBody>
          <MFoot>
            <button className="btn" onClick={() => setStep(1)}>← Volver</button>
            <button className="btn" disabled={sending} onClick={() => submit(false)}>Completar después</button>
            <button className="btn primary" disabled={sending} onClick={() => submit(true)}>
              {sending ? <Spinner size={16} /> : "Generar con estos datos"}
            </button>
          </MFoot>
        </>
      )}
    </Modal>
  );
}

/* ── Modal Editar campos (PATCH /documents/{id}/fields) ──────────── */

export function DocFieldsEditModal({ open, onClose, formatId, initialValues = {}, docId, freePlan = false, onSaved }) {
  const toast = useToast();
  const [schema, setSchema] = useState(null);
  const [vals, setVals] = useState({});
  const [missing, setMissing] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open || !formatId) return;
    let alive = true;
    setLoading(true);
    api.catalog.formatFields(formatId)
      .then((r) => {
        if (!alive) return;
        setSchema(r);
        setVals({ ...initialValues });
        setMissing([]);
      })
      .catch((e) => toast(errMsg(e), "err"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, formatId]);

  const sections = useMemo(() => (schema ? normalizeSections(schema) : []), [schema]);

  const save = async () => {
    setSending(true);
    try {
      const fields = coerceValues(sections, vals);
      await api.documents.patchFields(docId, { fields });
      toast("Cambios guardados", "ok");
      onClose?.();
      onSaved?.();
    } catch (e) {
      if (errCode(e) === "document_locked") toast("Un documento en revisión o revisado no admite edición de campos", "warn");
      else toast(errMsg(e), "err");
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} width={640}>
      <MHead icon="✎" title="Editar datos"
        sub="Actualice los campos: el documento se vuelve a redactar con los nuevos datos." />
      <MBody>
        {loading || !schema ? <div className="center" style={{ padding: 24 }}><Spinner /></div> : (
          <DynamicForm
            sections={sections}
            vals={vals}
            setVals={setVals}
            missing={missing}
            sensitive={Boolean(schema?.contains_sensitive_fields)}
            freePlan={freePlan}
          />
        )}
      </MBody>
      <MFoot>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={sending || loading} onClick={save}>
          {sending ? <Spinner size={16} /> : "Guardar"}
        </button>
      </MFoot>
    </Modal>
  );
}
