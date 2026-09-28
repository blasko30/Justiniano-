import React, { useState } from "react";
import { Modal, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { REJECT_REASONS } from "../lib/format.js";

/**
 * Modal de rechazo / devolución de un requerimiento (§20.9). El motivo es
 * obligatorio y el caso vuelve a la bolsa notificando a administración.
 *
 * props: review = { id, title, client } | null, onClose, onDone
 */
export default function RejectModal({ review, onClose, onDone }) {
  const toast = useToast();
  const [reason, setReason] = useState(REJECT_REASONS[0].code);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);

  const rechazar = async () => {
    if (reason === "other" && !detail.trim()) {
      toast("Indique el detalle del motivo «Otro»", "warn"); return;
    }
    setBusy(true);
    try {
      await api.lawyers.reject(review.id, { reason, detail: detail.trim() || null });
      toast("Requerimiento devuelto a la bolsa · se notificó a administración", "ok");
      onDone?.();
    } catch (e) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={Boolean(review)} onClose={onClose} width={560}>
      <h2>Rechazar requerimiento</h2>
      <p className="small" style={{ margin: "8px 0" }}>
        <b>{review?.title}</b>{review?.client ? <> · {review.client}</> : null}
      </p>
      <label>Motivo del rechazo *</label>
      <select value={reason} onChange={(e) => setReason(e.target.value)}>
        {REJECT_REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
      </select>
      <label>Detalle (visible para administración)</label>
      <textarea rows={2} value={detail} onChange={(e) => setDetail(e.target.value)} />
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn danger" onClick={rechazar} disabled={busy}>
          {busy ? "Rechazando…" : "Rechazar y devolver a la bolsa"}
        </button>
      </div>
    </Modal>
  );
}
