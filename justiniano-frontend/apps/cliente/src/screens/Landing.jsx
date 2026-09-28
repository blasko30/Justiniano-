import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Spinner, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { errMsg, DISCLAIMER_GLOBAL } from "../lib/format.js";
import { PublicTopbar } from "../components/Shell.jsx";
import AgentGrid from "../components/AgentGrid.jsx";

const FEATURES = [
  ["1️⃣", "Elija un agente", "Ocho especialidades legales, cada una entrenada en su materia y jurisdicción."],
  ["2️⃣", "Consulte y genere documentos", "Respuestas con citas normativas, más cartas, contratos y escritos listos para usar."],
  ["3️⃣", "Valide con un abogado", "Solicite la revisión de un abogado habilitado sobre cualquier respuesta o documento."],
];

export default function Landing() {
  const navigate = useNavigate();
  const toast = useToast();
  const [agents, setAgents] = useState(null);
  const [countries, setCountries] = useState([]);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([api.catalog.agents(), api.catalog.countries()]).then(([a, c]) => {
      if (!alive) return;
      if (a.status === "fulfilled") setAgents(a.value.items || []);
      else { setAgents([]); toast(errMsg(a.reason), "err"); }
      if (c.status === "fulfilled") setCountries(c.value.items || []);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <PublicTopbar />
      <main className="main fadein">
        <div className="container">
          <section className="hero">
            <div style={{ position: "relative", zIndex: 2 }}>
              <span className="badge" style={{ background: "rgba(255,255,255,.16)", color: "#fff", marginBottom: 14 }}>
                🇨🇱 Jurisdicción: Chile · Disponible
              </span>
              <h1>Su departamento legal, disponible 24/7</h1>
              <p>
                Agentes especializados en derecho laboral, tributario, civil, contratos y más. Respuestas fundadas
                en la legislación chilena, con revisión opcional de un abogado humano.
              </p>
              <div className="row wrap">
                <button className="btn primary lg" onClick={() => navigate("/signup")}>Comenzar gratis</button>
                <button
                  className="btn lg"
                  style={{ background: "transparent", border: "2px solid rgba(255,255,255,.55)", color: "#fff" }}
                  onClick={() => navigate("/login")}
                >
                  Iniciar sesión
                </button>
              </div>
              <p style={{ marginTop: 14, fontSize: 12.5, opacity: 0.8 }}>Consultas gratuitas · Sin tarjeta de crédito</p>
            </div>
          </section>

          <section style={{ marginTop: 32 }}>
            <h2 style={{ marginBottom: 14 }}>Cómo funciona</h2>
            <div className="threecol">
              {FEATURES.map(([i, t, d]) => (
                <div className="card pad" key={t}>
                  <div style={{ fontSize: 22, marginBottom: 8 }}>{i}</div>
                  <h3>{t}</h3>
                  <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>{d}</p>
                </div>
              ))}
            </div>
          </section>

          <section style={{ marginTop: 32 }}>
            <h2 style={{ marginBottom: 4 }}>Agentes especializados</h2>
            <p className="muted" style={{ marginBottom: 14 }}>Seleccione la materia de su consulta</p>
            {agents === null ? (
              <div className="center" style={{ padding: 30 }}><Spinner /></div>
            ) : (
              <AgentGrid agents={agents} publicMode />
            )}
          </section>

          {countries.length > 0 && (
            <section style={{ marginTop: 32 }} className="card pad-lg">
              <h2 style={{ marginBottom: 4 }}>Jurisdicción</h2>
              <p className="muted" style={{ marginBottom: 14 }}>Chile disponible hoy. Resto de América, progresivamente.</p>
              <div className="row wrap">
                {countries.map((c) => (
                  <span key={c.code} className={`badge ${c.available ? "ok" : "free"}`} style={{ padding: "6px 12px" }}>
                    {c.name}{c.available ? "" : " · Próximamente"}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section style={{ marginTop: 32 }} className="center">
            <h2>Comenzar gratis</h2>
            <p className="muted" style={{ margin: "8px 0 16px" }}>Consultas gratuitas · Sin tarjeta de crédito</p>
            <button className="btn primary lg" onClick={() => navigate("/signup")}>Crear cuenta</button>
          </section>

          <footer style={{ marginTop: 40, padding: "22px 0", borderTop: "1px solid var(--border)" }}>
            <p className="subtle">{DISCLAIMER_GLOBAL}</p>
            <p className="subtle" style={{ marginTop: 8 }}>© 2026 Justiniano · Asesoría legal para empresas</p>
          </footer>
        </div>
      </main>
    </>
  );
}
