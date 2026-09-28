import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Spinner, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { errMsg } from "../lib/format.js";
import { signupFlow } from "../lib/flow.js";
import { AuthWrap } from "../components/Shell.jsx";

const SIZES = [
  ["1-9", "1 – 9"], ["10-50", "10 – 50"], ["51-200", "51 – 200"],
  ["201-1000", "201 – 1.000"], ["1000+", "+1.000"],
];
const INDUSTRIES = [
  ["construccion", "Construcción"], ["retail", "Retail y comercio"], ["tecnologia", "Tecnología / SaaS"],
  ["servicios", "Servicios profesionales"], ["salud", "Salud"], ["mineria", "Minería"],
  ["transporte", "Transporte y logística"], ["otra", "Otra"],
];
const ROLES = [
  ["dueno", "Dueño / Socio"], ["gerente_general", "Gerente General"], ["rrhh", "Gerente de Personas / RR.HH."],
  ["finanzas", "Finanzas / Contabilidad"], ["legal_interno", "Fiscal / Abogado interno"], ["otro", "Otro"],
];

export default function Onboarding() {
  const navigate = useNavigate();
  const toast = useToast();
  const [size, setSize] = useState("1-9");
  const [industry, setIndustry] = useState("construccion");
  const [role, setRole] = useState("dueno");
  const [sending, setSending] = useState(false);

  const finish = async () => {
    setSending(true);
    try {
      await api.users.completeOnboarding({ size, industry, role });
      signupFlow.clear();
      toast("¡Cuenta lista! Ya puede comenzar a consultar.", "ok");
      navigate("/app");
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      setSending(false);
    }
  };

  return (
    <AuthWrap step={3}>
      <h2>Cuéntenos de su empresa</h2>
      <p className="muted" style={{ margin: "6px 0 20px" }}>Esto ajusta las respuestas de los agentes a su realidad</p>

      <div className="field">
        <label>Número de trabajadores</label>
        <select className="input" value={size} onChange={(e) => setSize(e.target.value)}>
          {SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Industria</label>
        <select className="input" value={industry} onChange={(e) => setIndustry(e.target.value)}>
          {INDUSTRIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Su rol</label>
        <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <div className="note gold" style={{ margin: "18px 0" }}>
        🇨🇱 Jurisdicción: <b>Chile</b> — todas las respuestas se fundarán en la legislación chilena vigente.
      </div>
      <button className="btn primary block lg" disabled={sending} onClick={finish}>
        {sending ? <Spinner size={18} /> : "Entrar a Justiniano"}
      </button>
    </AuthWrap>
  );
}
