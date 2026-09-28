/**
 * Utilitarios de formato y catálogos del portal del abogado revisor.
 * Los códigos de especialidad son los del catálogo del backend (§20.2).
 */

export const CLP = (n) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 })
    .format(Number(n) || 0);

export const NUM = (n) => new Intl.NumberFormat("es-CL").format(Number(n) || 0);

/* Catálogo de especialidades (§20.2): código backend ↔ etiqueta del wireframe */
export const ESPECIALIDADES = [
  { code: "lab", label: "Laboral" },
  { code: "con", label: "Contratos" },
  { code: "trib", label: "Tributario" },
  { code: "civ", label: "Civil" },
  { code: "soc", label: "Societario" },
  { code: "pi", label: "Propiedad intelectual" },
  { code: "pd", label: "Protección de datos" },
  { code: "arr", label: "Arriendos" },
];

export const specLabel = (code) =>
  ESPECIALIDADES.find((e) => e.code === code)?.label || code;

export const UNIS = [
  "Universidad de Chile", "Pontificia U. Católica de Chile", "Universidad de Concepción",
  "Universidad Diego Portales", "Universidad Adolfo Ibáñez", "Universidad de Valparaíso",
  "Universidad Austral de Chile", "Otra…",
];

/* SLA (§20): urgente (prioritaria) 8 h hábiles · normal 48 h hábiles */
export const URG = {
  fast: { label: "Urgente · 8 h hábiles", short: "Urgente", badge: "b-bad" },
  std: { label: "Normal · 48 h hábiles", short: "Normal", badge: "b-info" },
};
export const urg = (u) => URG[u] || URG.std;

export const SOURCE_LABELS = {
  direct: "Asignación directa",
  admin: "Asignación de administración",
  auto: "Asignación automática",
  pool: "Tomado de la bolsa",
  client: "Cliente lo eligió (su abogado de siempre)",
};
export const sourceLabel = (s) => SOURCE_LABELS[s] || s || "—";

export const REJECT_REASONS = [
  { code: "conflict_of_interest", label: "Conflicto de interés" },
  { code: "out_of_specialty", label: "Fuera de mi especialidad" },
  { code: "no_availability", label: "Sin disponibilidad en el plazo" },
  { code: "other", label: "Otro" },
];

export const AVAILABILITY = [
  { code: "lt_5h", label: "Menos de 5 h semanales" },
  { code: "5_15h", label: "5 a 15 h semanales" },
  { code: "gt_15h", label: "Más de 15 h semanales" },
];

const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "2026-08" → "Ago" */
export const mesCorto = (ym) => {
  const m = parseInt(String(ym || "").slice(5, 7), 10);
  return MESES_CORTOS[m - 1] || ym;
};

/** "2026-08" → "Agosto 2026" */
export const mesLargo = (ym) => {
  const m = parseInt(String(ym || "").slice(5, 7), 10);
  const nombre = MESES_LARGOS[m - 1] || "";
  return nombre ? `${nombre[0].toUpperCase()}${nombre.slice(1)} ${String(ym).slice(0, 4)}` : ym;
};

/** ISO 8601 → "07-08-2026 · 17:12" (hora local) */
export function fmtDT(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()} · ${hh}:${mi}`;
}

/** ISO 8601 → "07-08-2026" */
export function fmtD(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

/** Horas (con signo) que faltan para un vencimiento ISO; null si no hay fecha. */
export function horasRestantes(iso) {
  if (!iso) return null;
  const diff = (new Date(iso).getTime() - Date.now()) / 3600e3;
  return Math.round(diff * 10) / 10;
}

export const iniciales = (nombre) =>
  String(nombre || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

export const estadoRevision = (state) =>
  state === 2 ? { label: "Por aceptar", badge: "b-warn" }
    : state === 3 ? { label: "En curso", badge: "b-info" }
      : state === 4 ? { label: "Entregada", badge: "b-ok" }
        : { label: "En bolsa", badge: "b-mut" };

export const tipoLabel = (targetType) =>
  targetType === "document" ? "📄 Revisión" : "💬 Consulta";
