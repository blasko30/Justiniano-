/* Gráficos SVG simples, réplica de los del wireframe (sin librerías). */
import React from "react";

export function Bars({ vals = [], labels = [], color = "#FF6B35", h = 120 }) {
  if (!vals.length) return null;
  const max = Math.max(...vals, 0) * 1.15 || 1;
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
            <text x={x + bw / 2} y={h + 16} fontSize="11" fill="#94A3B8"
              textAnchor="middle" fontFamily="Inter">{labels[i] || ""}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function LineProj({ hist = [], proj = [], labels = [], h = 130 }) {
  const all = [...hist, ...proj.slice(1)];
  if (!all.length) return null;
  const max = Math.max(...all, 0) * 1.15 || 1;
  const n = all.length;
  const X = (i) => 20 + i * (360 / Math.max(n - 1, 1));
  const Y = (v) => h - (v / max) * (h - 14);
  const pts = hist.map((v, i) => `${X(i)},${Y(v)}`).join(" ");
  const ppts = proj.map((v, i) => `${X(hist.length - 1 + i)},${Y(v)}`).join(" ");
  return (
    <svg viewBox={`0 0 400 ${h + 24}`} style={{ width: "100%" }}>
      <polyline points={pts} fill="none" stroke="#FF6B35" strokeWidth="3" strokeLinecap="round" />
      <polyline points={ppts} fill="none" stroke="#FF6B35" strokeWidth="3"
        strokeDasharray="6 6" opacity=".6" />
      {hist.map((v, i) => <circle key={`h${i}`} cx={X(i)} cy={Y(v)} r="4" fill="#FF6B35" />)}
      {proj.slice(1).map((v, i) =>
        <circle key={`p${i}`} cx={X(hist.length + i)} cy={Y(v)} r="4" fill="#FF6B35" opacity=".5" />)}
      {labels.map((l, i) => (
        <text key={`l${i}`} x={X(i)} y={h + 18} fontSize="10.5" fill="#94A3B8"
          textAnchor="middle" fontFamily="Inter">{l}</text>
      ))}
    </svg>
  );
}

export function MultiLine({ series = [], labels = [], h = 140 }) {
  const all = series.flatMap((s) => s.vals || []);
  if (!all.length || !labels.length) return null;
  const max = Math.max(...all, 0) * 1.15 || 1;
  const n = labels.length;
  const X = (i) => 24 + i * (352 / Math.max(n - 1, 1));
  const Y = (v) => h - (v / max) * (h - 14);
  return (
    <svg viewBox={`0 0 400 ${h + 24}`} style={{ width: "100%" }}>
      {series.map((sr, k) => (
        <g key={k}>
          <polyline points={(sr.vals || []).map((v, i) => `${X(i)},${Y(v)}`).join(" ")}
            fill="none" stroke={sr.color} strokeWidth={sr.dash ? 2 : 3}
            strokeDasharray={sr.dash ? "5 5" : undefined} strokeLinecap="round" />
          {!sr.dash && (sr.vals || []).map((v, i) =>
            <circle key={i} cx={X(i)} cy={Y(v)} r="3.5" fill={sr.color} />)}
        </g>
      ))}
      {labels.map((l, i) => (
        <text key={i} x={X(i)} y={h + 18} fontSize="10.5" fill="#94A3B8"
          textAnchor="middle" fontFamily="Inter">{l}</text>
      ))}
    </svg>
  );
}

export function HBar({ pct = 0, color = "#FF6B35" }) {
  return (
    <div className="bar-h">
      <i style={{ width: `${Math.min(Math.max(pct, 0), 100)}%`, background: color }} />
    </div>
  );
}

export function Delta({ v, goodUp = true, children }) {
  if (v === null || v === undefined) return null;
  const good = (v >= 0) === goodUp;
  const cls = v === 0 ? "neu" : good ? "up" : "down";
  return (
    <span className={`delta ${cls}`}>
      {v > 0 ? "▲" : v < 0 ? "▼" : "–"} {Math.abs(v)}{children || "%"}
    </span>
  );
}
