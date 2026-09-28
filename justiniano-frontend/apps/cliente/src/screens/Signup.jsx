import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Spinner, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { errMsg } from "../lib/format.js";
import { signupFlow } from "../lib/flow.js";
import { AuthWrap } from "../components/Shell.jsx";

const TYC_TXT =
  "He leído y acepto los Términos y Condiciones, y entiendo que las respuestas de la IA pueden " +
  "contener errores y no reemplazan a un abogado humano";

export default function Signup() {
  const navigate = useNavigate();
  const toast = useToast();

  const [countries, setCountries] = useState([]);
  const [form, setForm] = useState({
    name: "", company: "", email: "", country: "CL", phone: "", password: "", terms: false,
  });
  const [badTerms, setBadTerms] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api.catalog.countries().then((r) => setCountries(r.items || [])).catch(() => {});
  }, []);

  const co = countries.find((c) => c.code === form.country);
  const dial = co?.dial || "+56";
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.terms) {
      setBadTerms(true);
      toast("Debe aceptar los Términos y Condiciones para continuar", "warn");
      return;
    }
    const phone = dial + form.phone.replace(/[^\d]/g, "");
    setSending(true);
    try {
      await api.auth.signup({
        name: form.name.trim(),
        email: form.email.trim(),
        phone,
        company: form.company.trim(),
        country: form.country,
        password: form.password,
        accepts_terms: true,
      });
      signupFlow.email = form.email.trim().toLowerCase();
      signupFlow.phone = phone;
      signupFlow.password = form.password;
      toast("Código de verificación enviado al correo", "ok");
      navigate("/verificar-correo");
    } catch (e) {
      if (e.status === 409) toast("El correo ya tiene una cuenta. Inicie sesión.", "warn");
      else toast(errMsg(e), "err");
    } finally {
      setSending(false);
    }
  };

  return (
    <AuthWrap step={0}>
      <h2>Cree su cuenta</h2>
      <p className="muted" style={{ margin: "6px 0 20px" }}>Empiece con sus consultas gratuitas</p>

      <div className="field">
        <label>Nombre y apellido</label>
        <input className="input" value={form.name} onChange={set("name")} autoComplete="name" />
      </div>
      <div className="field">
        <label>Empresa</label>
        <input className="input" value={form.company} onChange={set("company")} autoComplete="organization" />
      </div>
      <div className="field">
        <label>Correo corporativo</label>
        <input className="input" type="email" value={form.email} onChange={set("email")} autoComplete="email" />
        <div className="hint">Recibirá un código de verificación en este correo.</div>
      </div>
      <div className="field">
        <label>País de operación</label>
        <select className="input" value={form.country} onChange={set("country")}>
          {(countries.length ? countries : [{ code: "CL", name: "Chile", available: true, dial: "+56" }]).map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}{c.available ? "" : " · Próximamente"}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Teléfono móvil</label>
        <div className="row">
          <span className="btn" style={{ pointerEvents: "none" }}>{dial}</span>
          <input className="input" style={{ flex: 1 }} value={form.phone} onChange={set("phone")}
            placeholder="9 8123 4567" autoComplete="tel-national" />
        </div>
        <div className="hint">Verificaremos este número por SMS.</div>
      </div>
      <div className="field">
        <label>Contraseña</label>
        <input className="input" type="password" value={form.password} onChange={set("password")} autoComplete="new-password" />
        <div className="hint">Mínimo 8 caracteres.</div>
      </div>

      <label
        className={`consent ${form.terms ? "on" : ""} ${badTerms ? "bad" : ""}`}
        style={{ margin: "4px 0 18px" }}
      >
        <input
          type="checkbox"
          checked={form.terms}
          onChange={(e) => { setForm((f) => ({ ...f, terms: e.target.checked })); setBadTerms(false); }}
        />
        <span>{TYC_TXT}</span>
      </label>

      <button className="btn primary block lg" disabled={sending} onClick={submit}>
        {sending ? <Spinner size={18} /> : "Crear cuenta"}
      </button>
      <p className="center subtle" style={{ marginTop: 14 }}>
        ¿Ya tiene cuenta? <a style={{ cursor: "pointer" }} onClick={() => navigate("/login")}>Inicie sesión</a>
      </p>
    </AuthWrap>
  );
}
