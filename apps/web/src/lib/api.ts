import { ApiError, createZanduClient, unwrap, type ZanduClient } from '@zandu/api-client';
import { redirect } from 'next/navigation';
import { sessionToken } from './session';

/** Adresse de l'API, vue du serveur du site. */
export const API_URL = process.env.ZANDU_API_URL ?? 'http://localhost:3000';
/** Adresse publique du site (liens partagés, Open Graph). */
export const SITE_URL = (process.env.SITE_URL ?? 'http://localhost:3200').replace(/\/$/, '');
/** Site de recette (ADR-0013) : paiements simulés, jamais indexé par les moteurs de recherche. */
export const RECETTE = process.env.ZANDU_ENV === 'recette';

type Result<T> = { data?: T; error?: unknown; response: Response };

/**
 * Lectures publiques (catalogue, fiches, boutiques) : mises en cache 60 s côté serveur.
 * Un produit partagé dans un groupe WhatsApp de 200 personnes ne sollicite l'API qu'une fois.
 */
const publicClient = createZanduClient({
  baseUrl: API_URL,
  fetch: (input, init) => fetch(input, { ...init, next: { revalidate: 60 } }),
});

export async function catalog<T>(request: (api: ZanduClient) => Promise<Result<T>>): Promise<T> {
  return unwrap(await request(publicClient));
}

/** Client authentifié de la personne connectée (jamais mis en cache). */
export async function userClient(token?: string | null): Promise<ZanduClient> {
  const value = token === undefined ? await sessionToken() : token;
  return createZanduClient({
    baseUrl: API_URL,
    getToken: () => value,
    fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
  });
}

/** Lecture d'une page de compte : la donnée, ou la page de connexion qui ramène ici. */
export async function mine<T>(
  back: string,
  request: (api: ZanduClient) => Promise<Result<T>>,
): Promise<T> {
  const token = await sessionToken();
  if (!token) redirect(loginUrl(back));
  try {
    return unwrap(await request(await userClient(token)));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect(loginUrl(back));
    throw error;
  }
}

export const loginUrl = (back: string): string => `/connexion?suite=${encodeURIComponent(back)}`;

export function withParam(path: string, key: string, value: string): string {
  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set(key, value);
  return `${base}?${params.toString()}`;
}

export const field = (form: FormData, name: string): string => String(form.get(name) ?? '').trim();

/**
 * Chemin interne sûr pour une redirection (`?suite=`) : jamais vers un autre site. Refuse
 * « //site » et « /\site » (les navigateurs lisent la barre oblique inverse comme « / »).
 */
export const safePath = (value: string | undefined | null): string =>
  value && /^\/(?![/\\])/.test(value) && !/[\\\s]/.test(value) ? value : '/';
