import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { errMsg } from "../lib/format.js";
import { MHead, MFoot } from "./Shell.jsx";

export function AgentCard({ agent, onClick }) {
  const c = agent.color || "#3B6EA5";
  return (
    <div className="agentcard" onClick={onClick}>
      {agent.locked ? <span className="lock">🔒</span> : null}
      <div className="av" style={{ background: `${c}1F`, color: c }}>{agent.icon}</div>
      <h3>{agent.name}</h3>
      <p>{agent.description}</p>
    </div>
  );
}

/**
 * Grilla de agentes. En modo privado, al pulsar crea la consulta
 * (POST /consultations) y navega al chat; maneja agente bloqueado (upsell)
 * y cuota agotada (402).
 */
export default function AgentGrid({ agents, publicMode = false, onBusy }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [upsell, setUpsell] = useState(null); // null | "locked" | "quota"
  const [creating, setCreating] = useState(false);

  const start = async (a) => {
    if (publicMode) { navigate("/signup"); return; }
    if (a.locked) { setUpsell("locked"); return; }
    if (creating) return;
    setCreating(true);
    onBusy?.(true);
    try {
      const r = await api.consultations.create({ agent_id: a.id });
      navigate(`/app/consultas/${r.id}`);
    } catch (e) {
      if (e.status === 402) setUpsell("quota");
      else if (e.status === 403) setUpsell("locked");
      else toast(errMsg(e), "err");
    } finally {
      setCreating(false);
      onBusy?.(false);
    }
  };

  return (
    <>
      <div className="agentgrid">
        {(agents || []).map((a) => (
          <AgentCard key={a.id} agent={a} onClick={() => start(a)} />
        ))}
      </div>
      <Modal open={Boolean(upsell)} onClose={() => setUpsell(null)} width={480}>
        {upsell === "quota" ? (
          <MHead
            icon="🔒"
            title="Alcanzó sus consultas del plan"
            sub="Su plan actual agotó las consultas del mes. Para seguir consultando necesita un plan superior."
          />
        ) : (
          <MHead
            icon="🔒"
            title="Agente no incluido en su plan"
            sub="Este agente está disponible en los planes superiores."
          />
        )}
        <MFoot>
          <button className="btn" onClick={() => setUpsell(null)}>Más tarde</button>
          <button className="btn gold" onClick={() => { setUpsell(null); navigate("/app/planes"); }}>Ver planes</button>
        </MFoot>
      </Modal>
    </>
  );
}
