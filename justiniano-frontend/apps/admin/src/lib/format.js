/* Utilidades de formato y catálogos de la consola (textos del wireframe). */

export const CLP = (n) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 })
    .format(n ?? 0);

export const NUM = (n) => new Intl.NumberFormat("es-CL").format(n ?? 0);

/* Período del selector superior → parámetro `period` de la API */
export const PLABEL = { mes: "este mes", tri: "este trimestre", ano: "este año" };
export const PNAME = { mes: "Mes", tri: "Trimestre", ano: "Año" };
export const PAPI = { mes: "month", tri: "quarter", ano: "year" };

/* Límites de plan: clave del backend → etiqueta del wireframe */
export const LIMIT_KEYS = ["documents_month", "support_hours", "agents",
  "questions_month", "seats", "history_months"];
export const LIMIT_LABELS = {
  documents_month: "Documentos a descargar / mes",
  support_hours: "Horas de apoyo incluidas",
  agents: "Límite de agentes IA",
  questions_month: "Preguntas (interacciones) / mes",
  seats: "Usuarios incluidos en el plan",
  history_months: "Historial de documentos (meses)",
};
export const fmtLim = (v) => (v === -1 ? "Ilimitado" : NUM(v));

/* Industrias del CRM (enum backend → etiqueta) */
export const INDUSTRIES = [
  ["construccion", "Construcción"], ["retail", "Retail"], ["tecnologia", "Tecnología"],
  ["servicios", "Servicios"], ["salud", "Salud"], ["mineria", "Minería"],
  ["transporte", "Transporte"], ["otra", "Otra"],
];
export const industryLabel = (id) =>
  (INDUSTRIES.find(([k]) => k === id) || [null, id || "—"])[1];

/* Etapas del pipeline (enum backend → etiqueta del wireframe) */
export const STAGES = [
  ["prospect", "Prospecto"], ["demo", "Demo agendada"], ["proposal", "Propuesta enviada"],
  ["negotiation", "Negociación"], ["closing", "Listo para cierre"],
];
export const stageLabel = (id) => (STAGES.find(([k]) => k === id) || [null, id])[1];

/* Motivos de reasignación (etiqueta del wireframe → enum backend) */
export const REASSIGN_REASONS = [
  ["overload", "Sobrecarga del revisor"], ["not_accepted", "No aceptó en plazo"],
  ["conflict_of_interest", "Conflicto de interés"], ["client_request", "Solicitud del cliente"],
  ["other", "Otro"],
];

export const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/* Últimos n meses (abreviados, terminando en el actual) */
export function lastMonths(n) {
  const now = new Date(), out = [];
  for (let i = n - 1; i >= 0; i--) out.push(MESES[(now.getMonth() - i + 24) % 12]);
  return out;
}

/* Próximos n meses (sin incluir el actual) */
export function nextMonths(n) {
  const now = new Date(), out = [];
  for (let i = 1; i <= n; i++) out.push(MESES[(now.getMonth() + i) % 12]);
  return out;
}

/* Etiquetas de los últimos 7 días (termina hoy) */
export function last7Days() {
  const now = new Date(), out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now); d.setDate(now.getDate() - i);
    out.push(DIAS[d.getDay()]);
  }
  return out;
}

/* «Hace X» a partir de un timestamp ISO */
export function timeAgo(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "Ahora";
  if (min < 60) return `Hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "Hace 1 día" : `Hace ${d} días`;
}

export const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10)
    : d.toISOString().slice(0, 10);
};

/* Fecha ISO local desplazada `days` días (para proyecciones) */
export function isoInDays(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export const initials = (name) =>
  String(name || "?").split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
