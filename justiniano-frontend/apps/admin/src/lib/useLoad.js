import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Carga de datos con estados loading / error / data y recarga manual.
 * `fn` recibe nada y devuelve una promesa; se reejecuta al cambiar `deps`.
 */
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const seq = useRef(0);

  const run = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve()
      .then(fn)
      .then((data) => { if (seq.current === id) setState({ data, loading: false, error: null }); })
      .catch((error) => { if (seq.current === id) setState({ data: null, loading: false, error }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}
