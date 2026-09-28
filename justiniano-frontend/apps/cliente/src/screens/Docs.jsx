import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal, Spinner, EmptyState, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { errMsg, fmtDate, docStatus, isFreePlan } from "../lib/format.js";
import { PageHead, MHead, MFoot } from "../components/Shell.jsx";
import DocGenModal from "../components/DocGenModal.jsx";
import { useUser } from "../components/UserContext.jsx";

export default function Docs() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useUser();

  const [items, setItems] = useState(null);
  const [genOpen, setGenOpen] = useState(false);
  const [quotaMsg, setQuotaMsg] = useState(null);

  const load = () => {
    api.documents.list({ page_size: 100 })
      .then((r) => setItems(r.items || []))
      .catch((e) => { setItems([]); toast(errMsg(e), "err"); });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  return (
    <>
      <PageHead
        title="Documentos"
        sub="Cartas, contratos y escritos generados por sus agentes"
        right={<button className="btn primary" onClick={() => setGenOpen(true)}>＋ Generar documento</button>}
      />

      {items === null ? (
        <div className="center" style={{ padding: 40 }}><Spinner size={28} /></div>
      ) : items.length === 0 ? (
        <div className="card"><EmptyState icon="📄" title="Todavía no hay documentos" /></div>
      ) : (
        <div className="card">
          <table className="tablelike">
            <thead>
              <tr>
                <th>Documento</th>
                <th>Tipo</th>
                <th>Fecha</th>
                <th style={{ textAlign: "right" }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => {
                const [cls, label] = docStatus(d.status);
                return (
                  <tr key={d.id} onClick={() => navigate(`/app/documentos/${d.id}`)}>
                    <td>
                      <b>{d.name}</b>
                      <div className="subtle">{d.fields_completed}/{d.fields_total} campos completados</div>
                    </td>
                    <td className="muted">{d.type || "—"}</td>
                    <td className="muted">{fmtDate(d.created_at)}</td>
                    <td style={{ textAlign: "right" }}>
                      {d.missing_count ? <span className="badge warn" style={{ marginRight: 6 }}>{d.missing_count} ⚠</span> : null}
                      <span className={`badge ${cls}`}>{label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <DocGenModal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        freePlan={isFreePlan(user?.plan)}
        onCreated={(doc, { wantReview }) => navigate(`/app/documentos/${doc.id}`, { state: { wantReview } })}
        onQuota={(e) => setQuotaMsg(errMsg(e))}
      />
      <Modal open={Boolean(quotaMsg)} onClose={() => setQuotaMsg(null)} width={460}>
        <MHead icon="🔒" title="Límite de documentos alcanzado" sub={quotaMsg || ""} />
        <MFoot>
          <button className="btn" onClick={() => setQuotaMsg(null)}>Más tarde</button>
          <button className="btn gold" onClick={() => { setQuotaMsg(null); navigate("/app/planes"); }}>Ver planes</button>
        </MFoot>
      </Modal>
    </>
  );
}
