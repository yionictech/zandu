import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';

/** Actualise quand on revient sur l'écran (après avoir accepté une commande, par exemple). */
export function useRefetchOnFocus(refetch: () => unknown): void {
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void refetch();
    }, [refetch]),
  );
}
