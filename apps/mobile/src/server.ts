import { API_URL, DEMO, SERVER_PICKER } from './config';
import { demoFetch } from './demo';
import { loadJson, saveJson } from './storage';

/**
 * Serveur visé par l'APK de test (docs/exploitation/apk-de-test.md) : l'adresse est saisie dans
 * l'application (écran « Serveur de test ») au lieu d'être figée à la construction. Hors APK de
 * test, c'est toujours EXPO_PUBLIC_API_URL.
 */
export interface TestServer {
  url: string;
  /** Clé de recette (en-tête x-recette-key) pour lire les SMS de test et simuler un paiement. */
  key: string | null;
}

const KEY = 'zandu.testServer';
let current: TestServer | null = null;

export const apiUrl = (): string => current?.url ?? API_URL;
export const recetteKey = (): string | null => current?.key ?? null;
/** APK de test sans serveur choisi : l'écran « Serveur de test » s'ouvre au démarrage. */
export const needsServer = (): boolean => SERVER_PICKER && current === null;

export async function loadServer(): Promise<void> {
  if (SERVER_PICKER) current = await loadJson<TestServer | null>(KEY, null);
}

export async function saveServer(server: TestServer): Promise<void> {
  current = server;
  await saveJson(KEY, server);
}

/** « 192.168.1.20:3000 » → « http://192.168.1.20:3000 » ; sans barre finale. */
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/** En-têtes des routes de recette (/dev/…). */
export const recetteHeaders = (): Record<string, string> => {
  const key = recetteKey();
  return key ? { 'x-recette-key': key } : {};
};

/**
 * Les appels du client de l'API visent API_URL : on les envoie au serveur choisi. Le corps est
 * relu (une requête déjà construite ne se recopie pas vers une autre adresse dans le navigateur).
 */
export async function fetchOnServer(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const target = apiUrl();
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (DEMO && url.startsWith(API_URL)) return demoFetch(input, init);
  if (target === API_URL || !url.startsWith(API_URL)) return fetch(input, init);
  const moved = target + url.slice(API_URL.length);
  if (typeof input === 'string' || input instanceof URL) return fetch(moved, init);
  const hasBody = input.method !== 'GET' && input.method !== 'HEAD';
  return fetch(moved, {
    method: input.method,
    headers: input.headers,
    ...(hasBody ? { body: await input.blob() } : {}),
    signal: input.signal,
    ...init,
  });
}
