import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { EmptyState, Spinner, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import {
  CLP, estadoRevision, fmtD, fmtDT, horasRestantes, sourceLabel, specLabel, tipoLabel, urg,
} from "../lib/format.js";
import { useLawyer } from "../components/LawyerContext.jsx";
import RejectModal from "../components/RejectModal.jsx";

/**
 * Requerimientos (§20.6/§20.10): «Mis casos» (asignaciones en estados 2–3),
 * «Bolsa disponible» (claim §20.11) y «Completados» (estado 4).
 */
export default function Requerimientos() {
  const { verified } = useLawyer();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [tab, setTab] = useState(location.state?.tab || "mine");
  const [mine, setMine] = useState(null);
  const [pool, setPool] = useState(null);
  const [done, setDone] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);

  const cargar = async () => {
    setLoading(true);
    if (!verified) {
      setMine({ items: [], total: 0 }); setPool({ items: [], total: 0 }); setDone({ items: [], total: 0 });
      setLoading(false);
      return;
    }
    try {
      const [m, p, f] = await Promise.all([
        api.lawyers.myReviews({ page: 1, page_size: 50 }),
        api.lawyers.pool({ page: 1, page_size: 50 }),
        api.lawyers.myReviews({ status: "delivered", page: 1, page_size: 50 }),
      ]);
      setMine(m); setPool(p); setDone(f);
    } catch (e) {
      toast(e.message, "err");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [verified]);

  const aceptar = async (r) => {
    setBusyId(r.id);
    try {
      await api.lawyers.accept(r.id);
      toast("Requerimiento aceptado · el plazo SLA comenzó a correr", "ok");
      await cargar();
    } catch (e) {
      toast(e.message, "err");
    } finally {
      setBusyId(null);
    }
  };

  const tomarCaso = async (p) => {
    setBusyId(p.id);
    try {
      await api.lawyers.claim(p.id);
      toast(`Caso «${p.title}» agregado a sus requerimientos`, "ok");
      await cargar();
    } catch (e) {
      toast(e.message, "err");
    } finally {
      setBusyId(null);
    }
  };

  const cuerpo = () => {
    if (loading) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Spinner size={30} /></div>;

    if (tab === "mine") {
      return (
        <div className="card">
          {!(mine?.items?.length) ? (
            <EmptyState icon="⚖️" title="Sin casos activos">
              {verified
                ? "No tiene asignaciones en curso. Revise la bolsa disponible para tomar un caso."
                : "Recibirá asignaciones cuando su acreditación esté verificada."}
            </EmptyState>
          ) : (
            <table>
              <tbody>
                <tr><th>Requerimiento</th><th>Tipo</th><th>Cliente · plan</th><th>Origen</th>
                  <th>Urgencia</th><th>Vence</th><th>Estado</th><th></th></tr>
                {mine.items.map((r) => {
                  const est = estadoRevision(r.state);
                  const hrs = horasRestantes(r.sla_due_at);
                  return (
                    <tr key={r.id} className="click" onClick={() => navigate(`/caso/${r.id}`)}>
                      <td style={{ maxWidth: 260 }}>
                        <b>{r.title}</b><br />
                        <small>{specLabel(r.area)} · recibido {fmtDT(r.assigned_at)}</small>
                      </td>
                      <td>{tipoLabel(r.target_type)}</td>
                      <td>{r.client?.company}<br /><small>Plan {r.client?.plan}</small></td>
                      <td><small>{sourceLabel(r.source)}</small></td>
                      <td><span className={`badge ${urg(r.urgency).badge}`}>{urg(r.urgency).label}</span></td>
                      <td><b style={{ color: hrs != null && hrs < 6 ? "var(--bad)" : "inherit" }}>
                        {r.sla_due_at ? fmtDT(r.sla_due_at) : "Al aceptar"}</b></td>
                      <td><span className={`badge ${est.badge}`}>{est.label}</span></td>
                      <td>
                        {r.state === 2 ? (
                          <div className="row">
                            <button className="btn xs" disabled={busyId === r.id}
                              onClick={(e) => { e.stopPropagation(); aceptar(r); }}>Aceptar</button>
                            <button className="btn ghost xs"
                              onClick={(e) => { e.stopPropagation(); setRejecting({ id: r.id, title: r.title, client: r.client?.company }); }}>
                              Rechazar</button>
                          </div>
                        ) : (
                          <small style={{ color: "var(--naranja)", fontWeight: 700 }}>Abrir →</small>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <small style={{ display: "block", marginTop: 10 }}>
            ℹ️ Al aceptar un requerimiento comienza a correr el plazo SLA (urgente: 8 h hábiles · normal: 48 h
            hábiles). Un rechazo requiere motivo y devuelve el caso a la bolsa.
          </small>
        </div>
      );
    }

    if (tab === "pool") {
      return (
        <div className="card">
          {!verified && (
            <div className="banner warn" style={{ marginBottom: 12 }}>
              🔒 La bolsa se habilita cuando su acreditación esté verificada.
            </div>
          )}
          {!(pool?.items?.length) ? (
            <EmptyState icon="🗂️" title="La bolsa está vacía">
              No hay casos publicados en sus especialidades por ahora.
            </EmptyState>
          ) : (
            <table>
              <tbody>
                <tr><th>Requerimiento</th><th>Tipo</th><th>Área</th><th>Cliente · plan</th>
                  <th>Urgencia</th><th>Plazo</th><th>Honorario</th><th></th></tr>
                {pool.items.map((p) => (
                  <tr key={p.id}>
                    <td style={{ maxWidth: 280 }}>
                      <b>{p.title}</b><br /><small>Publicado {fmtDT(p.published_at)}</small>
                    </td>
                    <td>{tipoLabel(p.target_type)}</td>
                    <td>{specLabel(p.area)}</td>
                    <td>{p.client_company}<br /><small>Plan {p.client_plan}</small></td>
                    <td><span className={`badge ${urg(p.urgency).badge}`}>{urg(p.urgency).short}</span></td>
                    <td><small>{p.sla_from_claim} desde la aceptación</small></td>
                    <td className="num"><b>{CLP(p.fee_amount_clp)}</b></td>
                    <td>
                      <button className="btn sec xs" disabled={!verified || busyId === p.id} onClick={() => tomarCaso(p)}>
                        {verified ? (busyId === p.id ? "…" : "Tomar caso") : "🔒"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <small style={{ display: "block", marginTop: 10 }}>
            Solo se muestran casos de sus especialidades. Los urgentes exigen respuesta en 8 h hábiles desde la
            aceptación.
          </small>
        </div>
      );
    }

    /* Completados */
    return (
      <div className="card">
        {!(done?.items?.length) ? (
          <EmptyState icon="✅" title="Aún no hay requerimientos completados">
            Sus entregas aparecerán aquí junto con el honorario devengado.
          </EmptyState>
        ) : (
          <table>
            <tbody>
              <tr><th>Fecha</th><th>Tipo</th><th>Requerimiento</th><th>Cliente</th><th>Urgencia</th><th>Honorario</th></tr>
              {done.items.map((h) => (
                <tr key={h.id} className="click" onClick={() => navigate(`/caso/${h.id}`)}>
                  <td>{fmtD(h.assigned_at)}</td>
                  <td>{tipoLabel(h.target_type)}</td>
                  <td><b>{h.title}</b></td>
                  <td>{h.client?.company}</td>
                  <td><span className={`badge ${urg(h.urgency).badge}`}>{urg(h.urgency).short}</span></td>
                  <td className="num">{CLP(h.fee_amount_clp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  };

  return (
    <>
      <h1>Requerimientos</h1>
      <p className="small">Recibe casos por asignación directa y además puede tomar casos de la bolsa abierta.</p>
      <div className="tabs" style={{ marginTop: 12 }}>
        <div className={`tab ${tab === "mine" ? "on" : ""}`} onClick={() => setTab("mine")}>
          Mis casos ({mine?.total ?? "…"})</div>
        <div className={`tab ${tab === "pool" ? "on" : ""}`} onClick={() => setTab("pool")}>
          Bolsa disponible ({pool?.total ?? "…"})</div>
        <div className={`tab ${tab === "done" ? "on" : ""}`} onClick={() => setTab("done")}>
          Completados</div>
      </div>
      {cuerpo()}
      {rejecting && (
        <RejectModal review={rejecting} onClose={() => setRejecting(null)}
          onDone={() => { setRejecting(null); cargar(); }} />
      )}
    </>
  );
}
