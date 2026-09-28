import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Logo, Spinner, useToast } from "@justiniano/ui";
import { api } from "../api.js";

/**
 * Inicio de sesión del abogado revisor (§6.6/§6.7). Cubre el desafío MFA por
 * SMS y la verificación de correo pendiente (§6.2) cuando el backend la exige.
 */
export default function Login() {
  const toast = useToast();
  const navigate = useNavigate();
  const [mail, setMail] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  /* fase: "login" | "mfa" | "verify-email" */
  const [fase, setFase] = useState("login");
  const [mfaToken, setMfaToken] = useState(null);
  const [code, setCode] = useState("");

  const entrar = async (e) => {
    e?.preventDefault();
    if (!mail.trim() || !pass) { toast("Ingrese su correo y contraseña", "warn"); return; }
    setBusy(true);
    try {
      const r = await api.auth.login({ email: mail.trim(), password: pass });
      if (r?.mfa_required) {
        setMfaToken(r.mfa_token);
        setFase("mfa");
        toast("Le enviamos un código por SMS para completar el ingreso", "info");
      } else {
        toast(`Sesión iniciada · ${r?.user?.name || mail.trim()}`, "ok");
        navigate("/");
      }
    } catch (err) {
      if (err?.code === "email_not_verified") {
        setFase("verify-email");
        toast("Debe verificar su correo antes de entrar. Le reenviamos un código.", "warn");
        api.auth.resendEmailCode({ email: mail.trim() }).catch(() => {});
      } else {
        toast(err.message, "err");
      }
    } finally {
      setBusy(false);
    }
  };

  const verificarMfa = async (e) => {
    e?.preventDefault();
    if (!/^\d{6}$/.test(code)) { toast("Ingrese el código de 6 dígitos", "warn"); return; }
    setBusy(true);
    try {
      await api.auth.mfaVerify({ mfa_token: mfaToken, code });
      toast("Sesión iniciada", "ok");
      navigate("/");
    } catch (err) {
      toast(err.message, "err");
    } finally {
      setBusy(false);
    }
  };

  const verificarCorreo = async (e) => {
    e?.preventDefault();
    if (!/^\d{6}$/.test(code)) { toast("Ingrese el código de 6 dígitos", "warn"); return; }
    setBusy(true);
    try {
      await api.auth.verifyEmail({ email: mail.trim(), code });
      toast("Correo verificado ✓ Entrando…", "ok");
      setCode("");
      setFase("login");
      await entrar();
    } catch (err) {
      toast(err.message, "err");
      setBusy(false);
    }
  };

  const olvido = async () => {
    if (!mail.trim()) { toast("Escriba su correo para recuperar la contraseña", "warn"); return; }
    try {
      await api.auth.forgotPassword({ email: mail.trim() });
      toast("Si el correo existe, le enviamos instrucciones para restablecer su contraseña", "info");
    } catch (err) {
      toast(err.message, "err");
    }
  };

  return (
    <div className="loginwrap"><div className="loginbox">
      <div style={{ textAlign: "center", marginBottom: 22 }}>
        <div className="logo" style={{ justifyContent: "center" }}>
          <Logo variant="iso" height={38} />
          <div style={{ textAlign: "left" }}><b>Justiniano</b><small>ABOGADOS REVISORES</small></div>
        </div>
        <p className="small">Portal para abogados habilitados que revisan documentos y responden consultas</p>
      </div>
      <div className="card">
        {fase === "login" && (
          <form onSubmit={entrar}>
            <label>Correo</label>
            <input value={mail} onChange={(e) => setMail(e.target.value)} placeholder="nombre@correo.cl" autoComplete="email" />
            <label>Contraseña</label>
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />
            <div style={{ marginTop: 18 }} className="grid">
              <button className="btn" style={{ justifyContent: "center" }} disabled={busy} type="submit">
                {busy ? <Spinner size={16} /> : "Entrar"}
              </button>
              <Link to="/registro" className="btn ghost" style={{ justifyContent: "center", textDecoration: "none" }}>
                Crear cuenta de abogado revisor →
              </Link>
            </div>
            <p className="small" style={{ marginTop: 14, textAlign: "center" }}>
              <a href="#/login" onClick={(e) => { e.preventDefault(); olvido(); }}>¿Olvidó su contraseña?</a>
            </p>
          </form>
        )}
        {fase === "mfa" && (
          <form onSubmit={verificarMfa}>
            <h2>Verificación en dos pasos</h2>
            <p className="small" style={{ margin: "8px 0" }}>
              Ingrese el código de 6 dígitos que enviamos por SMS a su teléfono registrado.
            </p>
            <label>Código SMS</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} placeholder="123456" />
            <div style={{ marginTop: 18 }} className="grid">
              <button className="btn" style={{ justifyContent: "center" }} disabled={busy} type="submit">
                {busy ? <Spinner size={16} /> : "Confirmar código"}
              </button>
              <button type="button" className="btn ghost" style={{ justifyContent: "center" }}
                onClick={() => { setFase("login"); setCode(""); }}>← Volver</button>
            </div>
          </form>
        )}
        {fase === "verify-email" && (
          <form onSubmit={verificarCorreo}>
            <h2>Verifique su correo</h2>
            <p className="small" style={{ margin: "8px 0" }}>
              Enviamos un código de 6 dígitos a <b>{mail.trim()}</b>. Ingréselo para activar su cuenta.
            </p>
            <label>Código de verificación</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} placeholder="123456" />
            <div style={{ marginTop: 18 }} className="grid">
              <button className="btn" style={{ justifyContent: "center" }} disabled={busy} type="submit">
                {busy ? <Spinner size={16} /> : "Verificar y entrar"}
              </button>
              <button type="button" className="btn ghost" style={{ justifyContent: "center" }}
                onClick={() => api.auth.resendEmailCode({ email: mail.trim() })
                  .then(() => toast("Código reenviado", "info")).catch((err) => toast(err.message, "err"))}>
                Reenviar código
              </button>
            </div>
          </form>
        )}
      </div>
    </div></div>
  );
}
