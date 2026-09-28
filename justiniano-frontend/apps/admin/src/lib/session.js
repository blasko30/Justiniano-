/* Sesión de la consola: el rol viaja en el JWT (claim `role`). */
import { api } from "../api.js";

const K_PROFILE = "jus_admin_profile";

function decodeJwt(token) {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return null;
  }
}

/** Rol y correo del access token vigente (null si no hay sesión). */
export function tokenClaims() {
  const t = api.tokens.access;
  return t ? decodeJwt(t) : null;
}

export function getProfile() {
  try { return JSON.parse(localStorage.getItem(K_PROFILE)) || null; } catch { return null; }
}

export function setProfile(p) {
  localStorage.setItem(K_PROFILE, JSON.stringify(p));
}

export function clearProfile() {
  localStorage.removeItem(K_PROFILE);
}

export const CARGO = { admin: "Administrador", seller: "Vendedor" };

/** Sesión efectiva: rol del JWT + nombre guardado tras el login. */
export function getSession() {
  const claims = tokenClaims();
  if (!claims) return null;
  const profile = getProfile() || {};
  return {
    role: claims.role,
    email: claims.email,
    name: profile.name || claims.email || "—",
    cargo: CARGO[claims.role] || claims.role,
  };
}
