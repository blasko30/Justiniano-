/* Login de la consola interna. El rol (admin | seller) viaja en el JWT. */
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast, Spinner } from "@justiniano/ui";
import { ApiError } from "@justiniano/api";
import { api } from "../api.js";
import { tokenClaims, setProfile, clearProfile, CARGO } from "../lib/session.js";

export default function Login() {
  const navigate = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [mfa, setMfa] = useState(null); // { mfa_token, channel }
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const enter = async () => {
    const claims = tokenClaims();
    const role = claims?.role;
    if (role !== "admin" && role !== "seller") {
      await api.auth.logout().catch(() => {});
      clearProfile();
      toast("Acceso restringido al equipo de administración y ventas.", "err");
      return;
    }
    let name = null;
    try { name = (await api.users.me())?.name || null; } catch { /* opcional */ }
    setProfile({ name: name || claims.email, role });
    toast(`Sesión iniciada · ${CARGO[role]}`, "ok");
    navigate(role === "admin" ? "/dash" : "/ventas", { replace: true });
  };

  const doLogin = async (e) => {
    e?.preventDefault();
    if (!email.trim() || !pass) { toast("Ingrese correo y contraseña.", "warn"); return; }
    setBusy(true);
    try {
      const r = await api.auth.login({ email: email.trim(), password: pass });
      if (r?.mfa_required) {
        setMfa({ mfa_token: r.mfa_token, channel: r.channel });
        toast("Código de verificación enviado por SMS.");
      } else {
        if (r?.user?.name) setProfile({ name: r.user.name });
        await enter();
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Error de conexión con el servidor.", "err");
    } finally {
      setBusy(false);
    }
  };

  const doMfa = async (e) => {
    e?.preventDefault();
    if (!code.trim()) { toast("Ingrese el código recibido.", "warn"); return; }
    setBusy(true);
    try {
      await api.auth.mfaVerify({ mfa_token: mfa.mfa_token, code: code.trim() });
      await enter();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Error de conexión con el servidor.", "err");
      if (err instanceof ApiError && err.status === 410) { setMfa(null); setCode(""); }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="loginwrap">
      <div className="loginbox">
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div className="logo" style={{ justifyContent: "center" }}>
            <div className="iso">J</div>
            <div style={{ textAlign: "left" }}>
              <b>Justiniano</b><small>ADMINISTRACIÓN</small>
            </div>
          </div>
          <p className="small">Consola interna · acceso restringido al equipo</p>
        </div>
        <div className="card">
          {!mfa ? (
            <form onSubmit={doLogin}>
              <label>Correo corporativo</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="nombre@justiniano.cl" autoComplete="username" />
              <label>Contraseña</label>
              <input type="password" value={pass} onChange={(e) => setPass(e.target.value)}
                autoComplete="current-password" />
              <div style={{ marginTop: 18 }} className="grid">
                <button type="submit" className="btn" style={{ justifyContent: "center" }}
                  disabled={busy}>
                  {busy ? <Spinner size={16} /> : null} Iniciar sesión
                </button>
              </div>
              <p className="small" style={{ marginTop: 14, textAlign: "center" }}>
                La consola muestra los permisos del rol de su cuenta
                (Administrador o Vendedor).
              </p>
            </form>
          ) : (
            <form onSubmit={doMfa}>
              <h3>Verificación en dos pasos</h3>
              <p className="small" style={{ margin: "8px 0" }}>
                Enviamos un código por SMS. Ingréselo para completar el inicio de sesión.
              </p>
              <label>Código de verificación</label>
              <input value={code} onChange={(e) => setCode(e.target.value)}
                placeholder="000000" inputMode="numeric" autoFocus />
              <div style={{ marginTop: 18 }} className="grid">
                <button type="submit" className="btn" style={{ justifyContent: "center" }}
                  disabled={busy}>
                  {busy ? <Spinner size={16} /> : null} Verificar y entrar
                </button>
                <button type="button" className="btn ghost" style={{ justifyContent: "center" }}
                  onClick={() => { setMfa(null); setCode(""); }}>
                  ← Volver
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
