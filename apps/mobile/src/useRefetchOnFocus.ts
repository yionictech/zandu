import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

/**
 * Actualise quand on revient sur l'écran (après avoir accepté une commande, par exemple).
 * La dernière fonction reçue est gardée à part : une fonction recréée à chaque affichage ne
 * relance pas l'actualisation en boucle.
 */
export function useRefetchOnFocus(refetch: () => unknown): void {
  const firstFocus = useRef(true);
  const latest = useRef(refetch);
  useEffect(() => {
    latest.current = refetch;
  }, [refetch]);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void latest.current();
    }, []),
  );
}
