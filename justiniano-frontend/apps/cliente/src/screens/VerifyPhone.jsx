import React, { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { Spinner, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { errMsg } from "../lib/format.js";
import { signupFlow } from "../lib/flow.js";
import { AuthWrap } from "../components/Shell.jsx";
import OtpInput, { ResendLink } from "../components/OtpInput.jsx";

export default function VerifyPhone() {
  const navigate = useNavigate();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const phone = signupFlow.phone;

  if (!phone) return <Navigate to="/signup" replace />;

  const verify = async () => {
    if (code.length < 6) { toast("Código incorrecto. Intente nuevamente.", "warn"); return; }
    setSending(true);
    try {
      await api.auth.verifyPhone({ phone, code });
      toast("Teléfono verificado", "ok");
      // Con las credenciales aún en memoria iniciamos sesión para el onboarding.
      const { email, password } = signupFlow;
      if (email && password) {
        try {
          await api.auth.login({ email, password });
          navigate("/onboarding");
          return;
        } catch {
          /* cae al login manual */
        }
      }
      toast("Cuenta verificada. Inicie sesión para continuar.", "info");
      navigate("/login");
    } catch (e) {
      toast(errMsg(e, "Código incorrecto. Intente nuevamente."), "err");
    } finally {
      setSending(false);
    }
  };

  const resend = async () => {
    try {
      await api.auth.resendPhoneCode({ phone });
      toast("Código reenviado", "ok");
    } catch (e) {
      toast(errMsg(e), "err");
    }
  };

  return (
    <AuthWrap step={2}>
      <div className="center">
        <div style={{ fontSize: 34 }}>📱</div>
        <h2 style={{ marginTop: 8 }}>Verifique su teléfono</h2>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          Enviamos un SMS con un código de 6 dígitos a<br />
          <b style={{ color: "var(--fg)" }}>{phone}</b>
        </p>
      </div>
      <OtpInput onChange={setCode} />
      <button className="btn primary block lg" disabled={code.length < 6 || sending} onClick={verify}>
        {sending ? <Spinner size={18} /> : "Verificar"}
      </button>
      <div className="row center" style={{ justifyContent: "center", gap: 14, marginTop: 14, fontSize: 12.5 }}>
        <ResendLink onResend={resend} />
        <span className="subtle">·</span>
        <a style={{ cursor: "pointer" }} onClick={() => navigate("/signup")}>Cambiar dato</a>
      </div>
    </AuthWrap>
  );
}
