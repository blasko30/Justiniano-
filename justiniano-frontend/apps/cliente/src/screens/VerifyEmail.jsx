import React, { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { Spinner, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { errMsg } from "../lib/format.js";
import { signupFlow } from "../lib/flow.js";
import { AuthWrap } from "../components/Shell.jsx";
import OtpInput, { ResendLink } from "../components/OtpInput.jsx";

export default function VerifyEmail() {
  const navigate = useNavigate();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const email = signupFlow.email;

  if (!email) return <Navigate to="/signup" replace />;

  const verify = async () => {
    if (code.length < 6) { toast("Código incorrecto. Intente nuevamente.", "warn"); return; }
    setSending(true);
    try {
      await api.auth.verifyEmail({ email, code });
      toast("Correo verificado", "ok");
      navigate("/verificar-telefono");
    } catch (e) {
      toast(errMsg(e, "Código incorrecto. Intente nuevamente."), "err");
    } finally {
      setSending(false);
    }
  };

  const resend = async () => {
    try {
      await api.auth.resendEmailCode({ email });
      toast("Código reenviado", "ok");
    } catch (e) {
      toast(errMsg(e), "err");
    }
  };

  return (
    <AuthWrap step={1}>
      <div className="center">
        <div style={{ fontSize: 34 }}>📧</div>
        <h2 style={{ marginTop: 8 }}>Verifique su correo</h2>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          Enviamos un código de 6 dígitos a<br />
          <b style={{ color: "var(--fg)" }}>{email}</b>
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
