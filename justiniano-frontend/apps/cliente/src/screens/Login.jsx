import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal, Spinner, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { errCode, errMsg } from "../lib/format.js";
import { AuthWrap, MHead, MBody, MFoot } from "../components/Shell.jsx";
import OtpInput from "../components/OtpInput.jsx";

export default function Login() {
  const navigate = useNavigate();
  const toast = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sending, setSending] = useState(false);

  // Desafío MFA (login con 2FA activo devuelve mfa_required + mfa_token)
  const [mfaToken, setMfaToken] = useState(null);
  const [mfaCode, setMfaCode] = useState("");

  // Recuperación de contraseña
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");

  const afterLogin = async (loginResp) => {
    let onboarded = loginResp?.user?.onboarding_completed;
    if (onboarded === undefined) {
      try { onboarded = (await api.users.me())?.onboarding?.size != null; } catch { onboarded = true; }
    }
    toast("Sesión iniciada", "ok");
    navigate(onboarded === false ? "/onboarding" : "/app");
  };

  const submit = async () => {
    if (!email || !password) { toast("Ingrese su correo y contraseña", "warn"); return; }
    setSending(true);
    try {
      const r = await api.auth.login({ email: email.trim(), password });
      if (r?.mfa_required) {
        setMfaToken(r.mfa_token);
        toast("Le enviamos un código 2FA por SMS", "info");
      } else {
        await afterLogin(r);
      }
    } catch (e) {
      if (errCode(e) === "email_not_verified") toast("Debe completar la verificación de correo.", "warn");
      else toast(errMsg(e, "Correo o contraseña incorrectos."), "err");
    } finally {
      setSending(false);
    }
  };

  const submitMfa = async () => {
    if (mfaCode.length < 6) { toast("Ingrese el código de 6 dígitos", "warn"); return; }
    setSending(true);
    try {
      const r = await api.auth.mfaVerify({ mfa_token: mfaToken, code: mfaCode });
      await afterLogin(r);
    } catch (e) {
      if (e.status === 410) {
        toast("El desafío expiró; reinicie el login.", "warn");
        setMfaToken(null);
      } else toast(errMsg(e, "Código incorrecto."), "err");
    } finally {
      setSending(false);
    }
  };

  const sendForgot = async () => {
    try {
      await api.auth.forgotPassword({ email: forgotEmail.trim() });
      toast("Si el correo existe, le enviamos instrucciones para restablecer su contraseña.", "ok");
      setForgotOpen(false);
    } catch (e) {
      toast(errMsg(e), "err");
    }
  };

  if (mfaToken) {
    return (
      <AuthWrap>
        <div className="center">
          <div style={{ fontSize: 34 }}>🔐</div>
          <h2 style={{ marginTop: 8 }}>Verificación en dos pasos</h2>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            Enviamos un SMS con un código de 6 dígitos a su teléfono.
          </p>
        </div>
        <OtpInput onChange={setMfaCode} />
        <button className="btn primary block lg" disabled={mfaCode.length < 6 || sending} onClick={submitMfa}>
          {sending ? <Spinner size={18} /> : "Verificar"}
        </button>
        <p className="center subtle" style={{ marginTop: 14 }}>
          <a style={{ cursor: "pointer" }} onClick={() => setMfaToken(null)}>Volver al inicio de sesión</a>
        </p>
      </AuthWrap>
    );
  }

  return (
    <AuthWrap>
      <h2>Bienvenido de vuelta</h2>
      <p className="muted" style={{ margin: "6px 0 20px" }}>Ingrese a su cuenta</p>

      <div className="field">
        <label>Correo corporativo</label>
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          autoComplete="email" onKeyDown={(e) => e.key === "Enter" && submit()} />
      </div>
      <div className="field">
        <label>Contraseña</label>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password" onKeyDown={(e) => e.key === "Enter" && submit()} />
      </div>
      <p style={{ margin: "-4px 0 16px" }}>
        <a style={{ cursor: "pointer", fontSize: 12.5 }} onClick={() => { setForgotEmail(email); setForgotOpen(true); }}>
          ¿Olvidó su contraseña?
        </a>
      </p>
      <button className="btn primary block lg" disabled={sending} onClick={submit}>
        {sending ? <Spinner size={18} /> : "Ingresar"}
      </button>
      <p className="center subtle" style={{ marginTop: 14 }}>
        ¿No tiene cuenta? <a style={{ cursor: "pointer" }} onClick={() => navigate("/signup")}>Crear cuenta</a>
      </p>

      <Modal open={forgotOpen} onClose={() => setForgotOpen(false)} width={440}>
        <MHead icon="🔑" title="Recuperar contraseña"
          sub="Le enviaremos un enlace para restablecer su contraseña." />
        <MBody>
          <div className="field">
            <label>Correo corporativo</label>
            <input className="input" type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} />
          </div>
        </MBody>
        <MFoot>
          <button className="btn" onClick={() => setForgotOpen(false)}>Cancelar</button>
          <button className="btn primary" onClick={sendForgot}>Enviar</button>
        </MFoot>
      </Modal>
    </AuthWrap>
  );
}
