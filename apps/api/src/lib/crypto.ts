import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export const hmac = (secret: string, value: string): string =>
  createHmac('sha256', secret).update(value).digest('hex');

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** Code numérique (OTP, code de remise) tiré par un générateur cryptographique. */
export const randomDigits = (length: number): string =>
  Array.from({ length }, () => randomInt(0, 10).toString()).join('');

// Alphabet de Crockford sans I, L, O, U : lisible et dictable au téléphone.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Référence publique de commande, ex. ZD-7K3M9Q2P (32^8 ≈ 10^12 combinaisons). */
export const publicOrderRef = (): string =>
  `ZD-${Array.from({ length: 8 }, () => CROCKFORD[randomInt(0, 32)]).join('')}`;

/** JSON à clés triées, pour comparer deux corps de requête (idempotence). */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
