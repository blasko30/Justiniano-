/* Piezas pequeñas reutilizadas por las pantallas de la consola. */
import React from "react";
import { Spinner, EmptyState, useToast } from "@justiniano/ui";
import { ApiError } from "@justiniano/api";

export function Loading({ label = "Cargando…" }) {
  return (
    <div className="row" style={{ justifyContent: "center", padding: "48px 0", gap: 12 }}>
      <Spinner /> <span className="small">{label}</span>
    </div>
  );
}

export function LoadError({ error, onRetry }) {
  return (
    <EmptyState icon="⚠️" title="No se pudo cargar la información">
      {error instanceof ApiError ? error.message : "Error de conexión con el servidor."}
      {onRetry && (
        <>
          <br />
          <button className="btn ghost xs" style={{ marginTop: 10 }} onClick={onRetry}>
            Reintentar
          </button>
        </>
      )}
    </EmptyState>
  );
}

/** Hook: ejecuta una acción de la API mostrando errores como toast. */
export function useAction() {
  const toast = useToast();
  return async (fn, okMsg, after) => {
    try {
      const r = await fn();
      if (okMsg) toast(typeof okMsg === "function" ? okMsg(r) : okMsg, "ok");
      after?.(r);
      return r;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Error de conexión con el servidor.", "err");
      return null;
    }
  };
}

export function KpiMini({ label, value }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <small>{label}</small>
      <div style={{ fontFamily: "'Nunito'", fontSize: 24, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

export function Avatar({ name, size = 30, fontSize = 12 }) {
  const ini = String(name || "?").split(" ").filter(Boolean)
    .map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize, flex: "none" }}>
      {ini}
    </div>
  );
}
