import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { api, unwrap } from '../api';
import { DEMO } from '../config';
import { useSession } from '../session';

/**
 * Appel entrant, application ouverte : l'écran d'appel s'ouvre tout seul (la notification
 * « Appel entrant » prend le relais quand l'application est fermée).
 */
export function IncomingCalls() {
  const { user } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const shown = useRef(new Set<string>());
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  const incoming = useQuery({
    queryKey: ['calls', 'incoming'],
    queryFn: async () => unwrap(await api.GET('/v1/me/calls/incoming')),
    enabled: !!user && active && !DEMO,
    refetchInterval: 4_000,
  });
  const call = incoming.data?.items[0];
  useEffect(() => {
    if (!call || shown.current.has(call.id) || pathname.startsWith('/appel/')) return;
    shown.current.add(call.id);
    router.push(`/appel/${call.id}`);
  }, [call?.id, pathname]);
  return null;
}
