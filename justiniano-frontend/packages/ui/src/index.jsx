/**
 * @justiniano/ui — piezas compartidas entre los tres portales.
 *
 * - ThemeProvider / useTheme: modo claro/oscuro persistido (data-theme en <html>).
 * - Logo: variantes lockup (horizontal) e isotipo, con versión para dark mode.
 * - ToastProvider / useToast: avisos flotantes.
 * - Modal: diálogo accesible simple.
 * - Spinner, EmptyState: utilitarios pequeños.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import logoLock from "../assets/logo-lock.png";
import logoLockD from "../assets/logo-lockD.png";
import logoIso from "../assets/logo-iso.png";
import logoIsoD from "../assets/logo-isoD.png";

export const LOGO = { lock: logoLock, lockD: logoLockD, iso: logoIso, isoD: logoIsoD };

/* ── Tema claro / oscuro ─────────────────────────────────────────── */
const ThemeCtx = createContext({ theme: "light", toggle: () => {} });

export function ThemeProvider({ children, storageKey = "jus_theme" }) {
  const [theme, setTheme] = useState(() => localStorage.getItem(storageKey) || "light");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(storageKey, theme);
  }, [theme, storageKey]);
  const toggle = useCallback(() => setTheme((t) => (t === "light" ? "dark" : "light")), []);
  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);

export function ThemeToggle({ className = "iconbtn", title = "Cambiar tema" }) {
  const { theme, toggle } = useTheme();
  return (
    <button type="button" className={className} onClick={toggle} title={title} aria-label={title}>
      {theme === "light" ? "🌙" : "☀️"}
    </button>
  );
}

/* ── Logo ─────────────────────────────────────────────────────────── */
export function Logo({ variant = "lock", height = 34, alt = "Justiniano", ...rest }) {
  const { theme } = useTheme();
  const src =
    variant === "iso"
      ? theme === "dark" ? logoIsoD : logoIso
      : theme === "dark" ? logoLockD : logoLock;
  return <img src={src} alt={alt} style={{ height, width: "auto", display: "block" }} {...rest} />;
}

/* ── Toasts ───────────────────────────────────────────────────────── */
const ToastCtx = createContext(() => {});
let toastSeq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, kind = "info", ms = 3400) => {
    const id = ++toastSeq;
    setToasts((ts) => [...ts, { id, msg, kind }]);
    window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), ms);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="jus-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`jus-toast jus-toast--${t.kind}`}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/* ── Modal ────────────────────────────────────────────────────────── */
export function Modal({ open, onClose, children, width = 520, labelledBy }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="jus-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="jus-modal" role="dialog" aria-modal="true" aria-labelledby={labelledBy} style={{ maxWidth: width }}>
        {children}
      </div>
    </div>
  );
}

/* ── Utilitarios ──────────────────────────────────────────────────── */
export function Spinner({ size = 22 }) {
  return <span className="jus-spinner" style={{ width: size, height: size }} aria-label="Cargando…" />;
}

export function EmptyState({ icon = "🗂️", title, children }) {
  return (
    <div className="jus-empty">
      <div className="jus-empty__icon" aria-hidden>{icon}</div>
      {title && <h3>{title}</h3>}
      {children && <p>{children}</p>}
    </div>
  );
}
