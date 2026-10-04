/**
 * Filtre de la messagerie acheteur-vendeur (F13). Masque numéros de téléphone, liens et
 * e-mails pour éviter que la vente se conclue hors plateforme, sans séquestre — donc sans
 * protection pour l'acheteur. Les montants courts (« 25 000 FCFA ») ne sont pas touchés.
 * Limite connue : les numéros écrits en toutes lettres passent ; à traiter en V2 (modération).
 */
export interface FilterResult {
  text: string;
  masked: boolean;
  reasons: Array<'phone' | 'link' | 'email'>;
}

const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/gi;
const URL = /\b(?:https?:\/\/|www\.)\S+/gi;
const BARE_DOMAIN =
  /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|cg|cd|fr|me|io|ly|app|shop|store|link|info)\b(?:\/\S*)?/gi;
// Au moins 8 chiffres, éventuellement séparés par espaces, points, tirets ou barres.
const PHONE = /(?:\+|\b00)?\d(?:[\s.\-/]*\d){7,}/g;

export const MASK = {
  phone: '[numéro masqué]',
  link: '[lien masqué]',
  email: '[e-mail masqué]',
} as const;

export function filterChatMessage(input: string): FilterResult {
  const reasons = new Set<FilterResult['reasons'][number]>();
  const replace = (text: string, pattern: RegExp, kind: 'phone' | 'link' | 'email'): string =>
    text.replace(pattern, () => {
      reasons.add(kind);
      return MASK[kind];
    });

  let text = replace(input, EMAIL, 'email');
  text = replace(text, URL, 'link');
  text = replace(text, BARE_DOMAIN, 'link');
  text = replace(text, PHONE, 'phone');

  return { text, masked: reasons.size > 0, reasons: [...reasons] };
}
