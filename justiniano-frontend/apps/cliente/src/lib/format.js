/**
 * Utilidades de formato del portal cliente.
 */

/** "2026-08-04" | ISO → "04 ago 2026" */
export function fmtDate(d) {
  if (!d) return "—";
  try {
    const date = new Date(d.length <= 10 ? `${d}T12:00:00` : d);
    return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  } catch {
    return d;
  }
}

/** CLP sin decimales */
export function money(n) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n);
}

/** Iniciales para el avatar ("María Rojas" → "MR") */
export function initials(name) {
  return (name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "•";
}

/** ★★★★☆ según rating 0–5 */
export function stars(r) {
  const f = Math.round(r || 0);
  return "★".repeat(f) + "☆".repeat(Math.max(0, 5 - f));
}

/** Icono por extensión de archivo */
export function fileIco(n) {
  const e = ((n || "").split(".").pop() || "").toLowerCase();
  if (["jpg", "jpeg", "png", "heic", "webp"].includes(e)) return "🖼️";
  if (e === "pdf") return "📕";
  if (["xlsx", "xls", "csv"].includes(e)) return "📊";
  if (["doc", "docx"].includes(e)) return "📘";
  return "📎";
}

/** Bytes → "1.2 MB" | "34 KB" */
export function fmtSize(b) {
  if (!b && b !== 0) return "";
  return b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
}

/** Etiqueta legible del plan (label del backend: free|bas|int|adv|corp o nombre) */
export function planLabel(p) {
  const map = { free: "Gratuito", bas: "Básico", int: "Intermedio", adv: "Avanzado", corp: "Corporativo" };
  return map[p] || p || "Gratuito";
}

export function isFreePlan(p) {
  return !p || p === "free" || p === "p_free" || p === "Gratuito";
}

/** -1 | null → "Ilimitado" */
export function limitLabel(v, plural = "Ilimitadas") {
  return v === -1 || v === null || v === undefined ? plural : String(v);
}

/**
 * El backend responde errores como {"error": {code, message, details}} y el
 * SDK guarda ese cuerpo completo en e.detail. Estos helpers normalizan ambos
 * mundos (por si algún día el backend usa el formato "detail" de FastAPI).
 */
export function errCode(e) {
  return e?.detail?.error?.code || e?.code || null;
}

export function errDetails(e) {
  return e?.detail?.error?.details || e?.detail?.details || null;
}

/** Mensaje de un ApiError apto para toast */
export function errMsg(e, fallback = "Ocurrió un error inesperado") {
  const backend = e?.detail?.error?.message;
  if (backend) return backend;
  const m = e?.message;
  if (m && !/^Error \d+$/.test(m)) return m;
  if (e?.status === 0 || (m && /fetch/i.test(m))) return "No se pudo conectar con el servidor";
  return m || fallback;
}

/** Estados del documento → [clase badge, etiqueta] */
export function docStatus(st) {
  const map = {
    draft: ["free", "Borrador IA"],
    review: ["warn", "En revisión"],
    ready: ["ok", "Revisado"],
    pending: ["info", "Pendiente"],
  };
  return map[st] || map.draft;
}

/** Etiquetas de los 4 estados de una revisión */
export const REVIEW_STEPS = ["Solicitud enviada", "Abogado asignado", "En revisión", "Revisión entregada"];

export const DISCLAIMER_DOC =
  "AVISO: Este documento fue generado por un sistema de inteligencia artificial y puede contener errores u omisiones. " +
  "No constituye asesoría legal y debe ser revisado y validado por un abogado habilitado antes de su firma o presentación.";

export const DISCLAIMER_GLOBAL =
  "Justiniano entrega orientación legal generada por IA. No constituye asesoría legal formal ni reemplaza el patrocinio " +
  "de un abogado, salvo que solicite la revisión humana.";

export const DISC_AI =
  "Aviso: Esta respuesta es generada por IA con fines informativos. Verifíquela con un abogado profesional";
