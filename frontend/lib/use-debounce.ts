import { useEffect, useState } from 'react';

// `value`, once it has stopped changing for `delay` ms. Used for search boxes
// so each keystroke doesn't fire a request.
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
