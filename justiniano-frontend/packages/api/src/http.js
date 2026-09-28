/**
 * Cliente HTTP base para la API de Justiniano (FastAPI, prefijo /api/v1).
 *
 * - Autenticación Bearer JWT con refresh automático (rotación de refresh token).
 * - Los tokens se guardan en localStorage bajo un prefijo por portal
 *   (jus_cliente / jus_abogado / jus_admin) para poder abrir varios portales
 *   en el mismo navegador sin pisarse.
 * - Errores normalizados como ApiError { status, code, message, detail }.
 */

const DEFAULT_BASE = "http://localhost:8000/api/v1";

export class ApiError extends Error {
  constructor(status, payload) {
    const detail = payload?.detail ?? payload;
    const message =
      (typeof detail === "string" && detail) ||
      detail?.message ||
      detail?.msg ||
      (Array.isArray(detail) && detail[0]?.msg) ||
      `Error ${status}`;
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = detail?.code || null;
    this.detail = detail;
  }
}

export function createHttp({ baseUrl, storagePrefix = "jus", onAuthLost } = {}) {
  const base = (baseUrl || import.meta.env?.VITE_API_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
  const K_ACCESS = `${storagePrefix}_access`;
  const K_REFRESH = `${storagePrefix}_refresh`;

  const tokens = {
    get access() { return localStorage.getItem(K_ACCESS); },
    get refresh() { return localStorage.getItem(K_REFRESH); },
    set(pair) {
      if (pair?.access_token) localStorage.setItem(K_ACCESS, pair.access_token);
      if (pair?.refresh_token) localStorage.setItem(K_REFRESH, pair.refresh_token);
    },
    clear() {
      localStorage.removeItem(K_ACCESS);
      localStorage.removeItem(K_REFRESH);
    },
  };

  let refreshing = null; // promesa compartida para evitar refresh en paralelo

  async function doRefresh() {
    const rt = tokens.refresh;
    if (!rt) throw new ApiError(401, { detail: "Sesión expirada" });
    const res = await fetch(`${base}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: rt }),
    });
    if (!res.ok) {
      tokens.clear();
      onAuthLost?.();
      throw new ApiError(res.status, await safeJson(res));
    }
    const pair = await res.json();
    tokens.set(pair);
    return pair;
  }

  async function safeJson(res) {
    try { return await res.json(); } catch { return null; }
  }

  function buildQuery(params) {
    if (!params) return "";
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      q.set(k, String(v));
    }
    const s = q.toString();
    return s ? `?${s}` : "";
  }

  async function request(method, path, { body, params, auth = true, formData, retry = true, blob = false } = {}) {
    const headers = {};
    let payload;
    if (formData) {
      payload = formData; // el navegador fija el boundary
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    if (auth && tokens.access) headers["Authorization"] = `Bearer ${tokens.access}`;

    const res = await fetch(`${base}${path}${buildQuery(params)}`, {
      method,
      headers,
      body: payload,
    });

    if (res.status === 401 && auth && retry && tokens.refresh) {
      refreshing = refreshing || doRefresh().finally(() => { refreshing = null; });
      await refreshing;
      return request(method, path, { body, params, auth, formData, retry: false, blob });
    }

    if (!res.ok) throw new ApiError(res.status, await safeJson(res));
    if (res.status === 204) return null;
    if (blob) return res.blob();
    return safeJson(res);
  }

  return {
    base,
    tokens,
    get: (p, o) => request("GET", p, o),
    post: (p, o) => request("POST", p, o),
    put: (p, o) => request("PUT", p, o),
    patch: (p, o) => request("PATCH", p, o),
    del: (p, o) => request("DELETE", p, o),
  };
}
