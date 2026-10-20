import { useEffect, useState } from 'react';

/** Heure courante rafraîchie régulièrement (comptes à rebours : « Acceptez avant 14:40 »). */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
