/**
 * Identité de l'éditeur, reprise par les conditions d'utilisation et la politique de
 * confidentialité. À renseigner avant la mise en production (docs/exploitation/publication-stores.md) ;
 * le texte des deux pages est à faire relire par un juriste (loi 29-2019, D2).
 */
export const LEGAL = {
  company: process.env.ZANDU_LEGAL_COMPANY ?? 'Zandu (société en cours d’immatriculation)',
  address: process.env.ZANDU_LEGAL_ADDRESS ?? 'Pointe-Noire, République du Congo',
  rccm: process.env.ZANDU_LEGAL_RCCM ?? null,
  email: process.env.ZANDU_LEGAL_EMAIL ?? 'contact@zandu.cg',
  phone: process.env.ZANDU_SUPPORT_PHONE ?? null,
  updated: '30 octobre 2026',
};
