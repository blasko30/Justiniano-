import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Spinner, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { errMsg } from "../lib/format.js";
import { PageHead } from "../components/Shell.jsx";
import { ConsultList } from "./Dashboard.jsx";
import { useUser } from "../components/UserContext.jsx";

export default function Chats() {
  const navigate = useNavigate();
  const toast = useToast();
  const { usage } = useUser();
  const [items, setItems] = useState(null);
  const [agents, setAgents] = useState([]);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([api.consultations.list({ page_size: 50 }), api.catalog.agents()]).then(([c, a]) => {
      if (!alive) return;
      if (c.status === "fulfilled") setItems(c.value.items || []);
      else { setItems([]); toast(errMsg(c.reason), "err"); }
      if (a.status === "fulfilled") setAgents(a.value.items || []);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cons = usage?.consultations;
  const sub = cons?.limit != null ? `${cons.used} de ${cons.limit} consultas usadas este mes` : "";

  return (
    <>
      <PageHead
        title="Consultas"
        sub={sub}
        right={
          <button className="btn primary" style={{ minHeight: 52, fontSize: 15.5, padding: "12px 24px", borderRadius: 14 }}
            onClick={() => navigate("/app/agentes")}>
            ＋ Nueva consulta
          </button>
        }
      />
      {items === null ? (
        <div className="center" style={{ padding: 40 }}><Spinner size={28} /></div>
      ) : (
        <ConsultList items={items} agents={agents} />
      )}
    </>
  );
}
