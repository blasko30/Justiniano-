import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal, Spinner, useTheme, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { errCode, errMsg, fmtDate, money, planLabel, isFreePlan, DISCLAIMER_GLOBAL } from "../lib/format.js";
import { PageHead, MHead, MBody, MFoot } from "../components/Shell.jsx";
import { useUser } from "../components/UserContext.jsx";

const LANGS = [["es", "Español"], ["en", "English"], ["pt", "Português"], ["fr", "Français"]];
const SIZE_LABELS = { "1-9": "1 – 9", "10-50": "10 – 50", "51-200": "51 – 200", "201-1000": "201 – 1.000", "1000+": "+1.000" };
const ROLE_LABELS = {
  dueno: "Dueño / Socio", gerente_general: "Gerente General", rrhh: "Gerente de Personas / RR.HH.",
  finanzas: "Finanzas / Contabilidad", legal_interno: "Fiscal / Abogado interno", otro: "Otro",
};

function RowItem({ label, children }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", padding: "11px 0", borderBottom: "1px solid var(--border)" }}>
      <span className="muted">{label}</span>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>{children}</div>
    </div>
  );
}

function Switch({ checked, onChange }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="sl" />
    </label>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const toast = useToast();
  const { theme, toggle } = useTheme();
  const { user, usage, refreshUser, refreshUsage } = useUser();

  const [countries, setCountries] = useState([]);
  const [consents, setConsents] = useState(null);
  const [payMethod, setPayMethod] = useState(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", company: "", phone: "" });
  const [pwOpen, setPwOpen] = useState(false);
  const [pwForm, setPwForm] = useState({ current: "", next: "" });
  const [payOpen, setPayOpen] = useState(false);
  const [payments, setPayments] = useState(null);
  const [delOpen, setDelOpen] = useState(false);
  const [delPw, setDelPw] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([api.catalog.countries(), api.users.consents(), api.billing.paymentMethod()]).then(([c, cs, pm]) => {
      if (!alive) return;
      if (c.status === "fulfilled") setCountries(c.value.items || []);
      if (cs.status === "fulfilled") setConsents(cs.value.items || []); else setConsents([]);
      if (pm.status === "fulfilled") setPayMethod(pm.value);
    });
    return () => { alive = false; };
  }, []);

  const savePrefs = async (patch) => {
    try {
      await api.users.updatePreferences(patch);
      refreshUser();
    } catch (e) {
      toast(errMsg(e), "err");
    }
  };

  const toggleTheme = async () => {
    const next = theme === "light" ? "dark" : "light";
    toggle();
    savePrefs({ theme: next });
  };

  const openEdit = () => {
    setEditForm({ name: user?.name || "", company: user?.company || "", phone: user?.phone || "" });
    setEditOpen(true);
  };

  const saveProfile = async () => {
    setBusy(true);
    try {
      const body = {};
      if (editForm.name.trim() && editForm.name !== user?.name) body.name = editForm.name.trim();
      if (editForm.company.trim() && editForm.company !== user?.company) body.company = editForm.company.trim();
      if (editForm.phone.trim() && editForm.phone !== user?.phone) body.phone = editForm.phone.trim();
      if (Object.keys(body).length) {
        const r = await api.users.updateMe(body);
        if (r?.verification_required === "phone") {
          toast("Le enviamos un SMS para verificar el nuevo teléfono", "info");
        } else {
          toast("Cambios guardados", "ok");
        }
        refreshUser();
      }
      setEditOpen(false);
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    if (pwForm.next.length < 8) { toast("La nueva contraseña debe tener al menos 8 caracteres", "warn"); return; }
    setBusy(true);
    try {
      await api.auth.changePassword({ current_password: pwForm.current, new_password: pwForm.next });
      toast("Contraseña actualizada", "ok");
      setPwOpen(false);
      setPwForm({ current: "", next: "" });
    } catch (e) {
      toast(errMsg(e, "La contraseña actual no coincide"), "err");
    } finally {
      setBusy(false);
    }
  };

  const openPayments = async () => {
    setPayOpen(true);
    setPayments(null);
    try {
      const r = await api.billing.payments({ page_size: 50 });
      setPayments(r.items || []);
    } catch (e) {
      setPayments([]);
      toast(errMsg(e), "err");
    }
  };

  const openPortal = async () => {
    try {
      const r = await api.billing.portal();
      if (r?.portal_url) window.location.href = r.portal_url;
    } catch (e) {
      if (errCode(e) === "no_stripe_customer") toast("Aún no tiene pagos registrados", "info");
      else toast(errMsg(e), "err");
    }
  };

  const deleteAccount = async () => {
    setBusy(true);
    try {
      await api.users.deleteMe({ password: delPw });
      api.tokens.clear();
      toast("Cuenta eliminada", "info");
      navigate("/");
    } catch (e) {
      toast(errMsg(e, "La contraseña no coincide"), "err");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    try { await api.auth.logout(); } catch { /* sesión local limpia */ }
    toast("Sesión cerrada", "info");
    navigate("/");
  };

  if (!user) return <div className="center" style={{ padding: 60 }}><Spinner size={30} /></div>;

  const free = isFreePlan(user.plan);
  const cardInfo = payMethod?.card || payMethod;
  const cons = usage?.consultations;
  const docsU = usage?.documents_month;

  return (
    <>
      <PageHead title="Ajustes" />
      <div className="twocol">
        {/* Cuenta */}
        <div className="card pad-lg">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <h3>Cuenta</h3>
            <button className="btn sm" onClick={openEdit}>✎ Editar</button>
          </div>
          <RowItem label="Nombre y apellido"><b>{user.name}</b></RowItem>
          <RowItem label="Empresa"><b>{user.company || "—"}</b></RowItem>
          <RowItem label="Correo corporativo">
            <b>{user.email}</b>
            <span className={`badge ${user.email_verified ? "ok" : "warn"}`}>
              {user.email_verified ? "✓ Verificado" : "Sin verificar"}
            </span>
          </RowItem>
          <RowItem label="Teléfono móvil">
            <b>{user.phone || "—"}</b>
            <span className={`badge ${user.phone_verified ? "ok" : "warn"}`}>
              {user.phone_verified ? "✓ Verificado" : "Sin verificar"}
            </span>
          </RowItem>
          <RowItem label="Su rol"><span>{ROLE_LABELS[user.onboarding?.role] || user.onboarding?.role || "—"}</span></RowItem>
          <RowItem label="Número de trabajadores"><span>{SIZE_LABELS[user.onboarding?.size] || user.onboarding?.size || "—"}</span></RowItem>
        </div>

        {/* Preferencias + seguridad */}
        <div className="card pad-lg">
          <h3 style={{ marginBottom: 8 }}>Preferencias</h3>
          <RowItem label="Idioma">
            <select className="pill" value={user.lang || "es"} onChange={(e) => savePrefs({ lang: e.target.value })}>
              {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </RowItem>
          <RowItem label="País / jurisdicción">
            <select className="pill" value={user.country || "CL"} onChange={(e) => savePrefs({ country: e.target.value })}>
              {(countries.length ? countries : [{ code: "CL", name: "Chile" }]).map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </RowItem>
          <RowItem label="Tema oscuro">
            <Switch checked={theme === "dark"} onChange={toggleTheme} />
          </RowItem>
          <RowItem label="Notificaciones por correo">
            <Switch checked={user.notifications?.email !== false}
              onChange={(v) => savePrefs({ email_notifications: v })} />
          </RowItem>
          <RowItem label="Alertas por SMS">
            <Switch checked={user.notifications?.sms !== false}
              onChange={(v) => savePrefs({ sms_alerts: v })} />
          </RowItem>

          <h3 style={{ margin: "18px 0 8px" }}>Seguridad</h3>
          <RowItem label="Verificación en dos pasos">
            <span className={`badge ${user.mfa_enabled ? "ok" : "free"}`}>{user.mfa_enabled ? "SMS ✓" : "Desactivada"}</span>
          </RowItem>
          <RowItem label="Términos aceptados">
            {user.terms_accepted_at
              ? <span className="badge ok">✓ {fmtDate(user.terms_accepted_at)}</span>
              : <span className="badge warn">Sin verificar</span>}
          </RowItem>
          <RowItem label="Contraseña">
            <button className="btn sm" onClick={() => setPwOpen(true)}>Cambiar contraseña</button>
          </RowItem>
        </div>

        {/* Facturación */}
        <div className="card pad-lg">
          <h3 style={{ marginBottom: 8 }}>Facturación</h3>
          <RowItem label="Su plan">
            <span className={`badge ${free ? "free" : "pro"}`}>{planLabel(user.plan)}</span>
            <button className="btn sm gold" onClick={() => navigate("/app/planes")}>
              {free ? "Ver planes" : "Planes y precios"}
            </button>
          </RowItem>
          <RowItem label="Créditos de revisión">
            <b>{user.credits ?? 0}</b>
            <button className="btn sm" onClick={() => navigate("/app/planes")}>Comprar créditos</button>
          </RowItem>
          <RowItem label="Medio de pago">
            <span>{cardInfo?.last4 ? `${cardInfo.brand ? cardInfo.brand + " " : ""}•••• ${cardInfo.last4}` : "Sin medio de pago"}</span>
            <button className="btn sm" onClick={openPortal}>Gestionar</button>
          </RowItem>
          <RowItem label="Historial de pagos">
            <button className="btn sm" onClick={openPayments}>Ver todo</button>
          </RowItem>
        </div>

        {/* Uso y cuotas */}
        <div className="card pad-lg">
          <h3 style={{ marginBottom: 10 }}>Uso y cuotas</h3>
          {!usage ? <div className="center" style={{ padding: 12 }}><Spinner /></div> : (
            <>
              <RowItem label="Consultas del mes">
                <b>{cons?.used ?? 0}{cons?.limit != null ? ` / ${cons.limit}` : " · ilimitadas"}</b>
              </RowItem>
              <RowItem label="Documentos del mes">
                <b>{docsU?.used ?? 0}{docsU?.limit != null ? ` / ${docsU.limit}` : " · ilimitados"}</b>
              </RowItem>
              <RowItem label="Revisiones en curso"><b>{usage.reviews_in_progress ?? 0}</b></RowItem>
              <RowItem label="Créditos disponibles"><b>{usage.credits ?? 0}</b></RowItem>
            </>
          )}
        </div>

        {/* Consentimientos */}
        <div className="card pad-lg">
          <h3 style={{ marginBottom: 10 }}>Registro de consentimientos</h3>
          {consents === null ? (
            <div className="center" style={{ padding: 12 }}><Spinner /></div>
          ) : consents.length === 0 ? (
            <p className="subtle">Sin registros</p>
          ) : (
            <table className="tablelike" style={{ fontSize: 12.5 }}>
              <tbody>
                {consents.slice(0, 8).map((c) => (
                  <tr key={c.id} style={{ cursor: "default" }}>
                    <td style={{ padding: "8px 0" }}>{typeof c.detail === "string" ? c.detail : c.event}</td>
                    <td style={{ padding: "8px 0", textAlign: "right", whiteSpace: "nowrap" }} className="subtle">
                      {fmtDate(c.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="note" style={{ marginTop: 12 }}>
            🔐 Este registro deja constancia de las advertencias mostradas y aceptadas, con fecha y hora.
          </div>
        </div>

        {/* Marca / sesión */}
        <div className="card pad-lg">
          <h3 style={{ marginBottom: 12 }}>Justiniano</h3>
          <p className="subtle" style={{ marginBottom: 14 }}>{DISCLAIMER_GLOBAL}</p>
          <div className="row wrap">
            <button className="btn" onClick={logout}>Cerrar sesión</button>
            <button className="btn danger" onClick={() => setDelOpen(true)}>Eliminar cuenta</button>
          </div>
        </div>
      </div>

      {/* Modal editar perfil */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} width={480}>
        <MHead icon="✎" title="Editar perfil" sub="Un teléfono nuevo requiere verificación por SMS." />
        <MBody>
          <div className="field">
            <label>Nombre y apellido</label>
            <input className="input" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="field">
            <label>Empresa</label>
            <input className="input" value={editForm.company} onChange={(e) => setEditForm((f) => ({ ...f, company: e.target.value }))} />
          </div>
          <div className="field">
            <label>Teléfono móvil (formato +569…)</label>
            <input className="input" value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))} />
          </div>
        </MBody>
        <MFoot>
          <button className="btn" onClick={() => setEditOpen(false)}>Cancelar</button>
          <button className="btn primary" disabled={busy} onClick={saveProfile}>{busy ? <Spinner size={16} /> : "Guardar"}</button>
        </MFoot>
      </Modal>

      {/* Modal cambiar contraseña */}
      <Modal open={pwOpen} onClose={() => setPwOpen(false)} width={440}>
        <MHead icon="🔑" title="Cambiar contraseña" />
        <MBody>
          <div className="field">
            <label>Contraseña actual</label>
            <input className="input" type="password" value={pwForm.current}
              onChange={(e) => setPwForm((f) => ({ ...f, current: e.target.value }))} autoComplete="current-password" />
          </div>
          <div className="field">
            <label>Nueva contraseña</label>
            <input className="input" type="password" value={pwForm.next}
              onChange={(e) => setPwForm((f) => ({ ...f, next: e.target.value }))} autoComplete="new-password" />
            <div className="hint">Mínimo 8 caracteres.</div>
          </div>
        </MBody>
        <MFoot>
          <button className="btn" onClick={() => setPwOpen(false)}>Cancelar</button>
          <button className="btn primary" disabled={busy} onClick={changePassword}>{busy ? <Spinner size={16} /> : "Guardar"}</button>
        </MFoot>
      </Modal>

      {/* Modal historial de pagos */}
      <Modal open={payOpen} onClose={() => setPayOpen(false)} width={560}>
        <MHead icon="🧾" title="Historial de pagos" />
        <MBody>
          {payments === null ? (
            <div className="center" style={{ padding: 20 }}><Spinner /></div>
          ) : payments.length === 0 ? (
            <p className="subtle">Aún no hay pagos registrados.</p>
          ) : (
            <table className="tablelike">
              <thead>
                <tr><th>Fecha</th><th>Descripción</th><th style={{ textAlign: "right" }}>Monto</th><th /></tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} style={{ cursor: "default" }}>
                    <td className="muted">{fmtDate(p.date)}</td>
                    <td>{p.description}</td>
                    <td style={{ textAlign: "right" }}><b>{money(p.amount_clp)}</b></td>
                    <td style={{ textAlign: "right" }}>
                      {p.invoice_url ? <a href={p.invoice_url} target="_blank" rel="noreferrer">Factura ↗</a> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </MBody>
        <MFoot>
          <button className="btn" onClick={() => setPayOpen(false)}>Cerrar</button>
        </MFoot>
      </Modal>

      {/* Modal eliminar cuenta */}
      <Modal open={delOpen} onClose={() => setDelOpen(false)} width={460}>
        <MHead icon="⚠️" title="Eliminar cuenta"
          sub="Esta acción es definitiva: se cancelará su suscripción y se cerrarán todas sus sesiones." />
        <MBody>
          <div className="field">
            <label>Confirme con su contraseña</label>
            <input className="input" type="password" value={delPw} onChange={(e) => setDelPw(e.target.value)} />
          </div>
        </MBody>
        <MFoot>
          <button className="btn" onClick={() => setDelOpen(false)}>Cancelar</button>
          <button className="btn danger" disabled={busy || delPw.length < 8} onClick={deleteAccount}>
            {busy ? <Spinner size={16} /> : "Eliminar cuenta"}
          </button>
        </MFoot>
      </Modal>
    </>
  );
}
