/**
 * Jetons des appels en cours, gardés en mémoire seulement (jamais dans l'adresse de l'écran ni
 * sur le téléphone) : l'écran d'appel les reprend à l'ouverture.
 */
const access = new Map<string, { url: string; token: string }>();

export const rememberAccess = (callId: string, value: { url: string; token: string }) =>
  access.set(callId, value);
export const accessFor = (callId: string) => access.get(callId) ?? null;
export const forgetAccess = (callId: string) => access.delete(callId);
