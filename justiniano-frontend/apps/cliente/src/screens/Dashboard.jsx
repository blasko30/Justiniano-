import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Spinner, EmptyState, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { errMsg, fmtDate, limitLabel } from "../lib/format.js";
import { PageHead } from "../components/Shell.jsx";
import AgentGrid from "../components/AgentGrid.jsx";
import { useUser } from "../components/UserContext.jsx";

export function ConsultList({ items, agents }) {
  const navigate = useNavigate();
  if (!items.length) {
    return (
      <div className="card">
        <EmptyState icon="💬" title="Aún no tiene consultas">
          Elija un agente para comenzar su primera consulta
        </EmptyState>
        <div className="center" style={{ paddingBottom: 26 }}>
          <button className="btn primary" onClick={() => navigate("/app/agentes")}>Nueva consulta</button>
        </div>
      </div>
    );
  }
  const byId = Object.fromEntries((agents || []).map((a) => [a.id, a]));
  return (
    <div className="card">
      <table className="tablelike">
        <tbody>
          {items.map((c) => {
            const a = byId[c.agent_id] || {};
            const color = a.color || "#3B6EA5";
            const limit = c.interactions_limit;
            const full = limit != null && c.interactions_used >= limit;
            return (
              <tr key={c.id} onClick={() => navigate(`/app/consultas/${c.id}`)}>
                <td style={{ width: 40 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 9, display: "grid", placeItems: "center",
                    background: `${color}1F`, color,
                  }}>{a.icon || "💬"}</div>
                </td>
                <td>
                  <b>{c.title || `Nueva consulta · ${a.name || c.agent_id}`}</b>
                  <div className="subtle">{a.name || c.agent_id} · {fmtDate(c.last_message_at || c.created_at)}</div>
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <span className={`badge ${full ? "err" : limit != null && c.interactions_used > limit * 0.75 ? "warn" : "info"}`}>
                    {c.interactions_used}{limit != null ? `/${limit}` : ""}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user, usage } = useUser();

  const [agents, setAgents] = useState(null);
  const [consults, setConsults] = useState(null);
  const [docsTotal, setDocsTotal] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      api.catalog.agents(),
      api.consultations.list({ page_size: 3 }),
      api.documents.list({ page_size: 1 }),
    ]).then(([a, c, d]) => {
      if (!alive) return;
      if (a.status === "fulfilled") setAgents(a.value.items || []); else { setAgents([]); toast(errMsg(a.reason), "err"); }
      if (c.status === "fulfilled") setConsults(c.value.items || []); else setConsults([]);
      if (d.status === "fulfilled") setDocsTotal(d.value.total ?? 0); else setDocsTotal(0);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cons = usage?.consultations;
  const used = cons?.used ?? 0;
  const limit = cons?.limit;
  const nearLimit = limit != null && used >= limit - 1 && used < limit;
  const atLimit = limit != null && used >= limit;
  const firstName = (user?.name || "").split(" ")[0];

  return (
    <>
      <PageHead
        title={`Hola${firstName ? `, ${firstName}` : ""} 👋`}
        sub="¿En qué materia legal necesita apoyo hoy?"
        right={
          <button className="btn primary" style={{ minHeight: 52, fontSize: 15.5, padding: "12px 24px", borderRadius: 14 }}
            onClick={() => navigate("/app/agentes")}>
            ＋ Nueva consulta
          </button>
        }
      />

      {nearLimit && (
        <div className="note gold" style={{ marginBottom: 18 }}>
          ⚠️ Le queda 1 consulta este mes. Cambie de plan para seguir sin límites.
          <button className="btn gold sm" style={{ marginLeft: 10 }} onClick={() => navigate("/app/planes")}>Ver planes</button>
        </div>
      )}
      {atLimit && (
        <div className="note" style={{ marginBottom: 18, background: "var(--err-bg)", borderColor: "var(--err)" }}>
          🚫 Alcanzó las consultas de su plan este mes. Para seguir consultando necesita un plan superior.
          <button className="btn gold sm" style={{ marginLeft: 10 }} onClick={() => navigate("/app/planes")}>Ver planes</button>
        </div>
      )}

      <div className="statgrid">
        <div className="stat">
          <div className="k">Consultas del mes</div>
          <div className="v">{limit != null ? `${used}/${limit}` : used}</div>
          <div className="s">{limit == null ? "Consultas ilimitadas" : "según su plan"}</div>
        </div>
        <div className="stat">
          <div className="k">Documentos generados</div>
          <div className="v">{docsTotal === null ? <Spinner size={18} /> : docsTotal}</div>
          <div className="s"><a style={{ cursor: "pointer" }} onClick={() => navigate("/app/documentos")}>Ver todo</a></div>
        </div>
        <div className="stat">
          <div className="k">Revisiones en curso</div>
          <div className="v">{usage?.reviews_in_progress ?? "—"}</div>
          <div className="s"><a style={{ cursor: "pointer" }} onClick={() => navigate("/app/revisiones")}>Ver todo</a></div>
        </div>
        <div className="stat">
          <div className="k">Créditos de revisión</div>
          <div className="v">{user?.credits ?? usage?.credits ?? "—"}</div>
          <div className="s"><a style={{ cursor: "pointer" }} onClick={() => navigate("/app/planes")}>Comprar créditos</a></div>
        </div>
      </div>

      <h2 style={{ marginBottom: 4 }}>Agentes especializados</h2>
      <p className="muted" style={{ marginBottom: 14 }}>Seleccione la materia de su consulta</p>
      {agents === null ? (
        <div className="center" style={{ padding: 24 }}><Spinner /></div>
      ) : (
        <div style={{ marginBottom: 28 }}><AgentGrid agents={agents} /></div>
      )}

      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h2>Consultas recientes</h2>
        <a style={{ cursor: "pointer", fontSize: 13 }} onClick={() => navigate("/app/consultas")}>Ver todo</a>
      </div>
      {consults === null ? (
        <div className="center" style={{ padding: 24 }}><Spinner /></div>
      ) : (
        <ConsultList items={consults} agents={agents || []} />
      )}
    </>
  );
}
