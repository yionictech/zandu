import { cookies } from 'next/headers';

const SESSION_COOKIE = 'zw_session';
const CHALLENGE_COOKIE = 'zw_challenge';

const base = {
  httpOnly: true,
  sameSite: 'lax' as const, // retour depuis un lien WhatsApp : la session doit suivre
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

/** Jeton de session de l'API, gardé côté serveur (cookie httpOnly, illisible par les scripts). */
export async function sessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export async function startSession(token: string, expiresAt: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, { ...base, expires: new Date(expiresAt) });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export interface Challenge {
  id: string;
  phone: string;
}

export async function pendingChallenge(): Promise<Challenge | null> {
  const raw = (await cookies()).get(CHALLENGE_COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Challenge;
  } catch {
    return null;
  }
}

export async function setChallenge(challenge: Challenge | null): Promise<void> {
  const jar = await cookies();
  if (challenge) jar.set(CHALLENGE_COOKIE, JSON.stringify(challenge), { ...base, maxAge: 300 });
  else jar.delete(CHALLENGE_COOKIE);
}
