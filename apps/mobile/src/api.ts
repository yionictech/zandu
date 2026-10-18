import { ApiError, createZanduClient, unwrap } from '@zandu/api-client';
import { QueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { API_URL } from './config';
import { t } from './i18n/fr';
import { NetworkError, trackedFetch } from './network';

let currentToken: string | null = null;
let onUnauthorized: () => void = () => undefined;

/** Branché par la session : jeton courant et réaction à une session expirée. */
export function bindSession(token: string | null, unauthorized: () => void): void {
  currentToken = token;
  onUnauthorized = unauthorized;
}

export const api = createZanduClient({
  baseUrl: API_URL,
  getToken: () => currentToken,
  onUnauthorized: () => onUnauthorized(),
  fetch: trackedFetch,
});

export { unwrap };

/** Une clé par intention (commande, paiement) : un renvoi après coupure réseau ne crée pas de doublon. */
export const newIdempotencyKey = (): string => randomUUID();

/** Message à afficher pour n'importe quelle erreur (l'API fournit déjà des messages en français). */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return t.common.offline;
}

/** Échec faute de réseau : à refaire plus tard, rien n'a été refusé. */
export const isNetworkError = (error: unknown): boolean => error instanceof NetworkError;

export function errorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
    // Une action (payer, confirmer, publier) échoue tout de suite sans réseau, avec un message :
    // elle n'est jamais mise en attente puis rejouée toute seule.
    mutations: { networkMode: 'always' },
  },
});
