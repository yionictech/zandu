import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Alert } from 'react-native';
import { api, errorMessage, unwrap } from '../api';
import { t } from '../i18n/fr';
import { rememberAccess } from './store';

export type CallTarget = 'buyer' | 'seller' | 'rider';

/** Lance un appel internet vers un participant de la commande et ouvre l'écran d'appel. */
export function useStartCall(orderId: string) {
  const router = useRouter();
  return useMutation({
    mutationFn: async (to: CallTarget) =>
      unwrap(
        await api.POST('/v1/orders/{id}/calls', {
          params: { path: { id: orderId } },
          body: { to },
        }),
      ),
    onSuccess: (call) => {
      rememberAccess(call.id, call.livekit);
      router.push(`/appel/${call.id}`);
    },
    onError: (error) => Alert.alert(t.calls.failedTitle, errorMessage(error)),
  });
}
