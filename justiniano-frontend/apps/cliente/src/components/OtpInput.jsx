import React, { useEffect, useRef, useState } from "react";

/**
 * Seis casillas de código OTP con auto-avance, borrado hacia atrás y pegado.
 * onChange recibe el código concatenado (0–6 dígitos).
 */
export default function OtpInput({ onChange, autoFocus = true }) {
  const refs = useRef([]);
  const [vals, setVals] = useState(["", "", "", "", "", ""]);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  const emit = (next) => {
    setVals(next);
    onChange?.(next.join(""));
  };

  const onInput = (i, raw) => {
    const digits = raw.replace(/\D/g, "");
    if (!digits) {
      const next = [...vals];
      next[i] = "";
      emit(next);
      return;
    }
    const next = [...vals];
    // Soporta pegar el código completo en cualquier casilla
    for (let k = 0; k < digits.length && i + k < 6; k++) next[i + k] = digits[k];
    emit(next);
    const last = Math.min(5, i + digits.length);
    refs.current[last]?.focus();
  };

  const onKeyDown = (i, e) => {
    if (e.key === "Backspace" && !vals[i] && i > 0) refs.current[i - 1]?.focus();
  };

  return (
    <div className="otp">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          maxLength={6}
          inputMode="numeric"
          value={vals[i]}
          onChange={(e) => onInput(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          aria-label={`Dígito ${i + 1}`}
        />
      ))}
    </div>
  );
}

/** Cuenta regresiva de reenvío (45 s) con enlace al terminar. */
export function ResendLink({ onResend, seconds = 45 }) {
  const [left, setLeft] = useState(seconds);

  useEffect(() => {
    if (left <= 0) return undefined;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  if (left > 0) {
    return <span className="subtle">Reenviar en 0:{String(left).padStart(2, "0")}</span>;
  }
  return (
    <a
      style={{ cursor: "pointer" }}
      onClick={async () => {
        await onResend?.();
        setLeft(seconds);
      }}
    >
      Reenviar código
    </a>
  );
}
