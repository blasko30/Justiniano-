import React, { useEffect, useState } from "react";
import { Spinner, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { errMsg, DISCLAIMER_GLOBAL } from "../lib/format.js";
import { PageHead } from "../components/Shell.jsx";
import AgentGrid from "../components/AgentGrid.jsx";

export default function Agents() {
  const toast = useToast();
  const [agents, setAgents] = useState(null);

  useEffect(() => {
    let alive = true;
    api.catalog.agents()
      .then((r) => alive && setAgents(r.items || []))
      .catch((e) => { if (alive) { setAgents([]); toast(errMsg(e), "err"); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <PageHead title="Agentes especializados" sub="Seleccione la materia de su consulta" />
      {agents === null ? (
        <div className="center" style={{ padding: 40 }}><Spinner size={28} /></div>
      ) : (
        <AgentGrid agents={agents} />
      )}
      <div className="note" style={{ marginTop: 20 }}>ℹ️ {DISCLAIMER_GLOBAL}</div>
    </>
  );
}
