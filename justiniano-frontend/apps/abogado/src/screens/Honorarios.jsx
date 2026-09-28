import React, { useEffect, useState } from "react";
import { EmptyState, Spinner, useToast } from "@justiniano/ui";
import { api } from "../api.js";
import { CLP, fmtD, mesCorto, mesLargo, tipoLabel, urg } from "../lib/format.js";

/** Gráfico de barras del wireframe (SVG, miles de CLP). */
function Bars({ vals, labels, color = "#FF6B35", h = 120 }) {
  if (!vals.length) return null;
  const max = Math.max(...vals, 1) * 1.15;
  return (
    <svg viewBox={`0 0 400 ${h + 26}`} style={{ width: "100%" }}>
      {vals.map((v, i) => {
        const bh = (v / max) * h;
        const x = i * (400 / vals.length) + 6;
        const bw = 400 / vals.length - 12;
        return (
          <g key={i}>
            <rect x={x} y={h - bh} width={bw} height={bh} rx="5" fill={color}
              opacity={i === vals.length - 1 ? 1 : 0.55} />
            <text x={x + bw / 2} y={h + 16} fontSize="11" fill="#94A3B8" textAnchor="middle"
              fontFamily="Inter">{labels[i] || ""}</text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Honorarios (§20.22–§20.25): KPIs del mes, evolución, tarifario vigente,
 * detalle del período y liquidaciones mensuales con descarga en PDF.
 */
export default function Honorarios() {
  const toast = useToast();
  const [ov, setOv] = useState(null);
  const [entries, setEntries] = useState(null);
  const [settlements, setSettlements] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [o, e, s] = await Promise.all([
          api.lawyers.feesOverview(),
          api.lawyers.feesEntries({ page: 1, page_size: 100 }),
          api.lawyers.feesSettlements({ page: 1, page_size: 24 }),
        ]);
        if (!alive) return;
        setOv(o); setEntries(e); setSettlements(s);
      } catch (err) {
        toast(err.message, "err");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const descargar = async (liq) => {
    setDownloading(liq.id);
    try {
      const r = await api.lawyers.downloadSettlement(liq.id);
      if (r?.download_url) window.open(r.download_url, "_blank", "noopener");
      else toast("No recibimos la URL de descarga", "err");
    } catch (e) {
      toast(e.message, "err");
    } finally {
      setDownloading(null);
    }
  };

  if (loading) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Spinner size={30} /></div>;
  if (!ov) return <EmptyState icon="💰" title="No pudimos cargar sus honorarios">Reintente en unos segundos.</EmptyState>;

  /* Evolución: historial (desc) + mes en curso, en miles de CLP */
  const historia = [...(ov.monthly_history || [])].reverse();
  const vals = [...historia.map((m) => m.total_clp / 1000), ov.accrued_clp / 1000];
  const labels = [...historia.map((m) => mesCorto(m.month)), mesCorto(ov.month)];

  const mesNombre = mesLargo(ov.month).split(" ")[0].toLowerCase();
  const tarifas = [
    ["Revisión de documento · normal", CLP(ov.rates?.review_std_clp)],
    ["Revisión de documento · urgente", CLP(ov.rates?.review_urgent_clp)],
    ["Consulta / asesoría · normal", CLP(ov.rates?.consultation_std_clp)],
    ["Consulta / asesoría · urgente", CLP(ov.rates?.consultation_urgent_clp)],
    ["Bono cumplimiento SLA mensual ≥ 95 %", `+${ov.rates?.sla_bonus_pct ?? 0} % de lo liquidado`],
  ];
  const kpis = [
    [`Acumulado · ${mesNombre}`, CLP(ov.accrued_clp), <span className="delta neu">devengado</span>],
    ["Revisiones completadas", ov.reviews_count, <span className="delta neu">{mesNombre}</span>],
    ["Consultas respondidas", ov.consultations_count, <span className="delta neu">{mesNombre}</span>],
    ["Bono SLA proyectado", ov.sla_compliance_pct >= 95 ? `+${ov.sla_bonus_pct} %` : "—",
      <span className={`delta ${ov.sla_compliance_pct >= 95 ? "up" : "neu"}`}>SLA {ov.sla_compliance_pct} %</span>],
    ["Próxima liquidación", fmtD(ov.next_settlement_date), <span className="delta neu">automática</span>],
  ];

  return (
    <>
      <h1>Honorarios</h1>
      <p className="small" style={{ marginBottom: 14 }}>
        Sus honorarios se liquidan mensualmente los primeros 5 días del mes siguiente, contra boleta de honorarios.
      </p>
      <div className="kpis">
        {kpis.map(([t, v, foot]) => (
          <div key={t} className="card kpi">
            <div className="t">{t}</div>
            <div className="v" style={{ fontSize: 22 }}>{v}</div>
            <div className="foot">{foot}</div>
          </div>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.3fr 1fr", marginTop: 16 }}>
        <div className="card">
          <h2>Evolución mensual (miles CLP)</h2>
          <Bars vals={vals} labels={labels} />
          <small>{mesLargo(ov.month)} en curso: {CLP(ov.accrued_clp)} acumulados.</small>
        </div>
        <div className="card">
          <h2>Tarifario vigente</h2>
          {tarifas.map(([t, v]) => (
            <div key={t} className="row" style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px dashed var(--border)" }}>
              <small>{t}</small><b style={{ fontSize: 14 }}>{v}</b>
            </div>
          ))}
          <small style={{ display: "block", marginTop: 8 }}>
            Las tarifas las define administración y pueden variar por convenio.
          </small>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Detalle del mes en curso</h2>
        {entries?.items?.length ? (
          <table style={{ marginTop: 8 }}>
            <tbody>
              <tr><th>Fecha</th><th>Tipo</th><th>Requerimiento</th><th>Cliente</th><th>Urgencia</th><th>Monto</th></tr>
              {entries.items.map((h) => (
                <tr key={h.id}>
                  <td>{fmtD(h.accrued_at)}</td>
                  <td>{h.kind === "review" ? "📄 Revisión" : "💬 Consulta"}</td>
                  <td><b>{h.title || tipoLabel(h.kind === "review" ? "document" : "message")}</b></td>
                  <td>{h.client_company}</td>
                  <td><span className={`badge ${urg(h.urgency).badge}`}>{urg(h.urgency).short}</span></td>
                  <td className="num"><b>{CLP(h.amount_clp)}</b></td>
                </tr>
              ))}
              <tr>
                <td colSpan={5}><b>Total acumulado {mesNombre}</b></td>
                <td className="num"><b>{CLP(entries.sum_clp)}</b></td>
              </tr>
            </tbody>
          </table>
        ) : (
          <EmptyState icon="🧾" title="Sin honorarios este mes">
            Los honorarios se devengan automáticamente al entregar cada requerimiento.
          </EmptyState>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Liquidaciones anteriores</h2>
        {settlements?.items?.length ? (
          <table style={{ marginTop: 8 }}>
            <tbody>
              <tr><th>Período</th><th>Revisiones</th><th>Consultas</th><th>Bono SLA</th>
                <th>Monto liquidado</th><th>Estado</th><th>Fecha de pago</th><th></th></tr>
              {settlements.items.map((l) => (
                <tr key={l.id}>
                  <td><b>{mesLargo(l.period)}</b></td>
                  <td className="num">{l.reviews_count}</td>
                  <td className="num">{l.consultations_count}</td>
                  <td className="num">{l.sla_bonus_pct ? `+${l.sla_bonus_pct} %` : "—"}</td>
                  <td className="num"><b>{CLP(l.total_clp)}</b></td>
                  <td><span className={`badge ${l.status === "paid" ? "b-ok" : "b-warn"}`}>
                    {l.status === "paid" ? "Pagada" : "Pendiente"}</span></td>
                  <td>{l.paid_at ? fmtD(l.paid_at) : "—"}</td>
                  <td>
                    <button className="btn ghost xs" disabled={downloading === l.id} onClick={() => descargar(l)}>
                      {downloading === l.id ? "Generando…" : "Descargar PDF"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState icon="📄" title="Aún no hay liquidaciones">
            La primera liquidación se genera los primeros 5 días del mes siguiente a su primera entrega.
          </EmptyState>
        )}
      </div>
    </>
  );
}
