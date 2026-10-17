import { cookies } from 'next/headers';

const SESSION_COOKIE = 'zbo_session';
const CHALLENGE_COOKIE = 'zbo_challenge';

const base = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

/**
 * Le jeton de session de l'API reste côté serveur, dans un cookie httpOnly : aucun script du
 * navigateur ne peut le lire (vol de session par injection de script impossible).
 */
export async function sessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export async function startSession(token: string, expiresAt: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, { ...base, expires: new Date(expiresAt) });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Étape intermédiaire de la connexion : le code SMS a été envoyé à ce numéro. */
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
