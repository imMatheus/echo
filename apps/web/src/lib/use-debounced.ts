import { useEffect, useState } from 'react';

/**
 * Returns `value` once it has stopped changing for `delayMs`. The initial
 * value is returned immediately, so first renders are never delayed — use
 * this to debounce text-input filters without slowing initial loads,
 * pagination, or select changes.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
