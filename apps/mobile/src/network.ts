import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { apiUrl, fetchOnServer } from './server';

/**
 * Réseau disponible ou non, d'après les réponses de l'API elle-même : un téléphone peut être
 * connecté à l'antenne avec un forfait épuisé, ce que l'état de la connexion ne dit pas.
 * Une requête qui échoue faute de réseau passe l'application hors connexion ; elle interroge
 * alors l'API toutes les quelques secondes (et au retour au premier plan) jusqu'à ce qu'elle
 * réponde. React Query met en pause les chargements hors connexion et les relance au retour.
 */
const PROBE_EVERY_MS = 8_000;

/** Requête impossible faute de réseau (et non refusée par l'API). */
export class NetworkError extends Error {
  constructor() {
    super('network');
    this.name = 'NetworkError';
  }
}

let probe: ReturnType<typeof setInterval> | null = null;

export function reportNetwork(ok: boolean): void {
  if (ok === onlineManager.isOnline()) return;
  onlineManager.setOnline(ok);
  if (ok && probe) {
    clearInterval(probe);
    probe = null;
  }
  if (!ok && !probe) probe = setInterval(() => void check(), PROBE_EVERY_MS);
}

async function check(): Promise<void> {
  try {
    await fetch(`${apiUrl()}/health`, { cache: 'no-store' });
    reportNetwork(true);
  } catch {
    reportNetwork(false);
  }
}

/** `fetch` du client de l'API : chaque réponse ou échec renseigne l'état du réseau. */
export async function trackedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    const response = await fetchOnServer(input, init);
    reportNetwork(true);
    return response;
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    reportNetwork(false);
    throw new NetworkError();
  }
}

// React Query n'écoute plus le navigateur : c'est l'API qui dit si le réseau répond.
onlineManager.setEventListener(() => {
  const app = AppState.addEventListener('change', (state) => {
    if (state === 'active' && !onlineManager.isOnline()) void check();
  });
  const web = Platform.OS === 'web' ? globalThis.window : undefined;
  const retry = () => void check();
  web?.addEventListener?.('online', retry);
  web?.addEventListener?.('offline', retry);
  return () => {
    app.remove();
    web?.removeEventListener?.('online', retry);
    web?.removeEventListener?.('offline', retry);
  };
});

export function useOnline(): boolean {
  return useSyncExternalStore(
    (listener) => onlineManager.subscribe(listener),
    () => onlineManager.isOnline(),
  );
}
