import { api, isNetworkError } from './api';
import { loadJson, saveJson, secureStorage } from './storage';

/** Jeton de notification de ce téléphone (ADR-0018), gardé pour l'oublier à la déconnexion. */
export const PUSH_TOKEN_KEY = 'zandu.pushToken';
/** Session à fermer côté serveur : déconnexion faite sans réseau, renvoyée au retour. */
const PENDING_LOGOUT_KEY = 'zandu.pendingLogout';

/**
 * Déconnexion côté serveur : le téléphone ne reçoit plus les notifications du compte, puis la
 * session est fermée (elle restait valable jusqu'ici). Sans réseau, c'est refait au retour.
 */
export async function closeSessionOnServer(sessionToken: string): Promise<void> {
  const pushToken = await loadJson<string | null>(PUSH_TOKEN_KEY, null);
  try {
    if (pushToken) await api.POST('/v1/devices/unregister', { body: { token: pushToken } });
    await api.POST('/v1/auth/logout', {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    await secureStorage.remove(PENDING_LOGOUT_KEY);
    if (pushToken) await saveJson(PUSH_TOKEN_KEY, null);
  } catch (error) {
    if (isNetworkError(error)) await secureStorage.set(PENDING_LOGOUT_KEY, sessionToken);
  }
}

/** Au démarrage et au retour du réseau : termine une déconnexion faite hors connexion. */
export async function finishPendingLogout(): Promise<void> {
  const pending = await secureStorage.get(PENDING_LOGOUT_KEY);
  if (pending) await closeSessionOnServer(pending);
}
