import { ApiError, createZanduClient, unwrap, type ZanduClient } from '@zandu/api-client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { sessionToken } from './session';

/** Adresse de l'API, vue du serveur du back-office (jamais exposée au navigateur). */
export const API_URL = process.env.ZANDU_API_URL ?? 'http://localhost:3000';

export async function apiClient(token?: string | null): Promise<ZanduClient> {
  const value = token === undefined ? await sessionToken() : token;
  return createZanduClient({ baseUrl: API_URL, getToken: () => value });
}

/** Session expirée ou second facteur manquant : retour à l'étape de connexion utile. */
function redirectForAuth(error: unknown): void {
  if (!(error instanceof ApiError)) return;
  if (error.status === 401) redirect('/connexion?expiree=1');
  if (error.code === 'mfa_required') redirect('/connexion/code');
}

/** Réponse brute du client typé (données ou erreur). */
type Result<T> = { data?: T; error?: unknown; response: Response };

/** Lecture pour une page : la donnée, ou une redirection vers la connexion. */
export async function load<T>(request: (api: ZanduClient) => Promise<Result<T>>): Promise<T> {
  const token = await sessionToken();
  if (!token) redirect('/connexion');
  try {
    return unwrap(await request(await apiClient(token)));
  } catch (error) {
    redirectForAuth(error);
    throw error;
  }
}

/**
 * Action d'un formulaire : appelle l'API puis revient sur `back` avec un message de succès,
 * ou avec le message d'erreur de l'API (déjà en français).
 */
export async function act(
  back: string,
  success: string,
  request: (api: ZanduClient) => Promise<Result<unknown>>,
): Promise<never> {
  try {
    unwrap(await request(await apiClient()));
  } catch (error) {
    redirectForAuth(error);
    const message = error instanceof ApiError ? error.message : 'API injoignable, réessayez.';
    redirect(withParam(back, 'erreur', message));
  }
  revalidatePath('/', 'layout');
  redirect(withParam(back, 'ok', success));
}

export function withParam(path: string, key: string, value: string): string {
  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.delete('ok');
  params.delete('erreur');
  params.set(key, value);
  return `${base}?${params.toString()}`;
}

/** Champ texte d'un formulaire, sans espaces autour. */
export const field = (form: FormData, name: string): string => String(form.get(name) ?? '').trim();
