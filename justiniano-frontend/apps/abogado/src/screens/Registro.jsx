import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Logo, Spinner, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { AVAILABILITY } from "../lib/format.js";
import AccreditationFields, {
  acreditacionVacia, formDataAcreditacion, validarAcreditacion,
} from "../components/AccreditationFields.jsx";

const TERMS_VERSION = "2026-06"; // versión vigente de TyC (settings del backend)
const PASOS = ["Datos personales", "Acreditación profesional", "Preferencias y términos"];

/**
 * Registro del abogado revisor en dos fases contra el backend:
 *  1) POST /auth/lawyer-signup (§20.1) con datos personales + preferencias + TyC,
 *  2) verificación del correo (§6.2), login (§6.6) y subida de la acreditación
 *     (§20.2, multipart) con los antecedentes del paso 2 del wizard.
 */
export default function Registro() {
  const toast = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [ageErr, setAgeErr] = useState("");
  const [otp, setOtp] = useState("");
  const [d, setD] = useState({
    n: "", rut: "", mail: "", tel: "", fnac: "", city: "", p1: "", p2: "",
    acred: acreditacionVacia(),
    urg: true, promo: false, disp: "5_15h", jura: false, terms: false,
  });
  const set = (patch) => setD((prev) => ({ ...prev, ...patch }));

  /* ── Paso 1: datos personales ── */
  const next1 = () => {
    setAgeErr("");
    if (!d.n.trim() || !d.rut.trim() || !d.mail.trim() || !d.fnac) {
      toast("Complete los campos obligatorios (*)", "warn"); return;
    }
    const age = (Date.now() - new Date(d.fnac).getTime()) / 31557600000;
    if (!(age >= 18)) {
      setAgeErr("Debe ser mayor de 18 años para registrarse como abogado revisor."); return;
    }
    if (d.tel.trim() && !/^\+[1-9]\d{7,14}$/.test(d.tel.replace(/[\s\-()]/g, ""))) {
      toast("El teléfono debe tener formato internacional (+56 9 …)", "warn"); return;
    }
    if (d.p1.length < 8) { toast("La contraseña debe tener al menos 8 caracteres", "warn"); return; }
    if (!d.p1 || d.p1 !== d.p2) { toast("Las contraseñas no coinciden", "warn"); return; }
    setStep(2);
  };

  /* ── Paso 2: acreditación ── */
  const next2 = () => {
    const err = validarAcreditacion(d.acred);
    if (err) { toast(err, "warn"); return; }
    setStep(3);
  };

  /* ── Paso 3: crear la cuenta ── */
  const crearCuenta = async () => {
    if (!d.jura || !d.terms) { toast("Debe aceptar la declaración jurada y los términos", "warn"); return; }
    setBusy(true);
    try {
      const tel = d.tel.replace(/[\s\-()]/g, "");
      await api.http.post("/auth/lawyer-signup", {
        auth: false,
        body: {
          name: d.n.trim(), rut: d.rut.trim(), email: d.mail.trim().toLowerCase(),
          phone: tel || null, birth_date: d.fnac, city: d.city.trim() || null,
          password: d.p1, accepts_urgent: d.urg, promoter: d.promo,
          availability: d.disp, terms_accepted: d.terms, terms_version: TERMS_VERSION,
          sworn_declaration: d.jura,
        },
      });
      toast("Cuenta creada · le enviamos un código de verificación a su correo", "ok");
      setStep(4);
    } catch (err) {
      toast(err.message, "err");
    } finally {
      setBusy(false);
    }
  };

  /* ── Paso 4: verificar correo, entrar y subir la acreditación ── */
  const verificarYSubir = async () => {
    if (!/^\d{6}$/.test(otp)) { toast("Ingrese el código de 6 dígitos", "warn"); return; }
    setBusy(true);
    try {
      await api.auth.verifyEmail({ email: d.mail.trim().toLowerCase(), code: otp });
      await api.auth.login({ email: d.mail.trim().toLowerCase(), password: d.p1 });
    } catch (err) {
      toast(err.message, "err");
      setBusy(false);
      return;
    }
    try {
      await api.http.post("/lawyers/me/accreditation", { formData: formDataAcreditacion(d.acred) });
      toast("Cuenta creada · sus documentos están en verificación", "ok");
    } catch (err) {
      toast(`No pudimos subir su acreditación: ${err.message}. Puede reintentarlo desde «Mi perfil».`, "err");
    }
    setBusy(false);
    navigate("/");
  };

  const marco = (contenido, foot) => (
    <div className="loginwrap"><div className="loginbox wide">
      <div className="logo" style={{ justifyContent: "center" }}>
        <Logo variant="iso" height={38} />
        <div><b>Justiniano</b><small>REGISTRO DE ABOGADO REVISOR</small></div>
      </div>
      <div className="steps">
        {PASOS.map((n, i) => (
          <div key={n} className={`step ${step === i + 1 ? "on" : step > i + 1 ? "done" : ""}`}>
            <div className="dot">{step > i + 1 ? "✓" : i + 1}</div><small>{n}</small>
          </div>
        ))}
      </div>
      <div className="card">
        {contenido}
        <div className="row" style={{ justifyContent: "space-between", marginTop: 20 }}>
          {step > 1 && step < 4
            ? <button className="btn ghost" onClick={() => setStep(step - 1)}>← Atrás</button>
            : step === 1
              ? <button className="btn ghost" onClick={() => navigate("/login")}>Cancelar</button>
              : <span />}
          {foot}
        </div>
      </div>
      <p className="small" style={{ textAlign: "center", marginTop: 12 }}>
        Sus documentos se revisan de forma paralela: podrá entrar a su panel de inmediato, pero recibirá
        requerimientos solo cuando su acreditación sea validada.
      </p>
    </div></div>
  );

  if (step === 1) {
    return marco(
      <>
        <h2>Datos personales</h2>
        <div className="formgrid">
          <div><label>Nombre completo *</label>
            <input value={d.n} onChange={(e) => set({ n: e.target.value })} placeholder="Nombre y apellidos" /></div>
          <div><label>RUT *</label>
            <input value={d.rut} onChange={(e) => set({ rut: e.target.value })} placeholder="12.345.678-9" /></div>
          <div><label>Correo *</label>
            <input value={d.mail} onChange={(e) => set({ mail: e.target.value })} placeholder="nombre@correo.cl" /></div>
          <div><label>Teléfono</label>
            <input value={d.tel} onChange={(e) => set({ tel: e.target.value })} placeholder="+56 9 …" /></div>
          <div><label>Fecha de nacimiento *</label>
            <input type="date" value={d.fnac} onChange={(e) => set({ fnac: e.target.value })} />
            <small>Debe ser mayor de 18 años.</small>
            {ageErr && <div className="err">{ageErr}</div>}</div>
          <div><label>Ciudad</label>
            <input value={d.city} onChange={(e) => set({ city: e.target.value })} placeholder="Santiago" /></div>
          <div><label>Contraseña *</label>
            <input type="password" value={d.p1} onChange={(e) => set({ p1: e.target.value })} /></div>
          <div><label>Confirmar contraseña *</label>
            <input type="password" value={d.p2} onChange={(e) => set({ p2: e.target.value })} /></div>
        </div>
      </>,
      <button className="btn" onClick={next1}>Continuar →</button>,
    );
  }

  if (step === 2) {
    return marco(
      <>
        <h2>Acreditación profesional</h2>
        <p className="small">Estos antecedentes serán validados por el equipo de Justiniano.</p>
        <AccreditationFields value={d.acred} onChange={(acred) => set({ acred })} />
      </>,
      <button className="btn" onClick={next2}>Continuar →</button>,
    );
  }

  if (step === 3) {
    return marco(
      <>
        <h2>Preferencias y términos</h2>
        <div className="tglrow">
          <div><b>Acepto requerimientos urgentes</b><br />
            <small>Prioritarios, con plazo de 8 h hábiles y tarifa mayor. Puede cambiarlo luego en su perfil.</small></div>
          <label className="tgl">
            <input type="checkbox" checked={d.urg} onChange={(e) => set({ urg: e.target.checked })} /><i /></label>
        </div>
        <div className="tglrow">
          <div><b>Quiero actuar además como promotor / vendedor</b><br />
            <small>Habilita el módulo «Mis ventas»: cartera de clientes referidos, proyecciones y comisiones por contrato cerrado.</small></div>
          <label className="tgl">
            <input type="checkbox" checked={d.promo} onChange={(e) => set({ promo: e.target.checked })} /><i /></label>
        </div>
        <div>
          <label>Disponibilidad estimada</label>
          <select value={d.disp} onChange={(e) => set({ disp: e.target.value })}>
            {AVAILABILITY.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
          </select>
        </div>
        <label style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "flex-start", fontWeight: 400 }}>
          <input type="checkbox" style={{ width: "auto", marginTop: 4 }} checked={d.jura}
            onChange={(e) => set({ jura: e.target.checked })} />
          <span className="small">Declaro bajo juramento estar habilitado para el ejercicio de la profesión de
            abogado en Chile y no tener sanciones vigentes.</span>
        </label>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontWeight: 400 }}>
          <input type="checkbox" style={{ width: "auto", marginTop: 4 }} checked={d.terms}
            onChange={(e) => set({ terms: e.target.checked })} />
          <span className="small">He leído y acepto los Términos y Condiciones para abogados revisores, incluida
            la política de confidencialidad de los documentos de clientes.</span>
        </label>
      </>,
      <button className="btn" onClick={crearCuenta} disabled={busy}>
        {busy ? <Spinner size={16} /> : "Crear mi cuenta ✓"}
      </button>,
    );
  }

  /* Paso 4 — verificación del correo (requisito del backend antes del login) */
  return marco(
    <>
      <h2>Verifique su correo</h2>
      <p className="small" style={{ margin: "8px 0" }}>
        Enviamos un código de 6 dígitos a <b>{d.mail.trim()}</b> (vence en 10 minutos). Al confirmarlo,
        entraremos a su panel y subiremos su acreditación profesional para la validación.
      </p>
      <label>Código de verificación</label>
      <input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" maxLength={6} placeholder="123456" />
      <p className="small" style={{ marginTop: 10 }}>
        <a href="#/registro" onClick={(e) => {
          e.preventDefault();
          api.auth.resendEmailCode({ email: d.mail.trim().toLowerCase() })
            .then(() => toast("Código reenviado", "info")).catch((err) => toast(err.message, "err"));
        }}>Reenviar código</a>
      </p>
    </>,
    <button className="btn" onClick={verificarYSubir} disabled={busy}>
      {busy ? <Spinner size={16} /> : "Confirmar y entrar →"}
    </button>,
  );
}
