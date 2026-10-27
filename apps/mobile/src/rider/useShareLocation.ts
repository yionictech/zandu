import * as Location from 'expo-location';
import type { LatLng } from '@zandu/domain';
import { useEffect, useState } from 'react';
import { api } from '../api';

export type ShareState = 'off' | 'asking' | 'sharing' | 'denied';

/**
 * Partage la position du livreur pendant qu'il est en route vers le client (docs/ux/03 §15) :
 * application au premier plan seulement, une position toutes les 15 s ou tous les 30 m. Rien
 * n'est envoyé en dehors de cet écran ni après la remise.
 */
export function useShareLocation(
  orderId: string,
  active: boolean,
): { state: ShareState; position: LatLng | null } {
  const [state, setState] = useState<ShareState>('off');
  // Dernière position connue, pour la distance qui reste jusqu'au client.
  const [position, setPosition] = useState<LatLng | null>(null);
  useEffect(() => {
    if (!active) {
      setState('off');
      return;
    }
    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;
    setState('asking');
    void (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== 'granted') {
        setState('denied');
        return;
      }
      setState('sharing');
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 15_000, distanceInterval: 30 },
        (position) => {
          setPosition({ lat: position.coords.latitude, lng: position.coords.longitude });
          void api.POST('/v1/rider/deliveries/{id}/position', {
            params: { path: { id: orderId } },
            body: {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              ...(position.coords.accuracy != null ? { accuracy: position.coords.accuracy } : {}),
            },
          });
        },
      );
      if (cancelled) subscription.remove();
    })().catch(() => {
      if (!cancelled) setState('denied');
    });
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [orderId, active]);
  return { state, position };
}
