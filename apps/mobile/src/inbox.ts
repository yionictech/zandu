import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './api';

/** Centre de notifications du compte (cloche de l'accueil, écran « Notifications »). */
export function useInbox(enabled: boolean) {
  return useQuery({
    queryKey: ['inbox'],
    queryFn: async () => unwrap(await api.GET('/v1/me/notifications')),
    enabled,
    refetchInterval: 60_000,
  });
}
