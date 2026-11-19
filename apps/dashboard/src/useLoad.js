import { useCallback, useEffect, useRef, useState } from 'react';
import { SignedOut } from './api.js';

/**
 * Loads `load()` and reloads when `deps` change. A SignedOut error goes to `onSignedOut`
 * (the app then shows the sign-in screen); any other error is shown by the page.
 */
export function useLoad(load, deps, onSignedOut) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const lastKey = useRef(null);

  useEffect(() => {
    let live = true;
    // New filters: drop the old figures so they never show under the new label.
    // A plain reload keeps them on screen until the fresh ones arrive.
    const key = JSON.stringify(deps);
    const changed = key !== lastKey.current;
    lastKey.current = key;
    setState((s) => ({ data: changed ? null : s.data, loading: true, error: null }));
    load().then(
      (data) => live && setState({ data, error: null, loading: false }),
      (error) => {
        if (!live) return;
        if (error instanceof SignedOut) onSignedOut?.(error.message);
        setState((s) => ({ data: s.data, error, loading: false }));
      },
    );
    return () => {
      live = false;
    };
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
