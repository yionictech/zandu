/**
 * Fondations visuelles de Zandu (docs/ux/03-nouvelle-direction-visuelle.md) : thème sombre,
 * citron pour l'action principale et la confiance, cyan pour l'argent bloqué et ce qui est en
 * route, corail pour l'urgent et les problèmes. Couleurs mesurées sur les maquettes d'octobre 2026.
 *
 * Source unique : l'application lit ce fichier, le site et le back-office lisent `tokens.css`,
 * généré à partir de lui (`pnpm --filter @zandu/design generate`).
 */
export const colors = {
  /** Fond de tous les écrans. */
  background: '#0B0E15',
  /** Barres du bas (bouton principal, onglets). */
  bar: '#10141D',
  /** Cartes, champs, puces. */
  surface: '#161A25',
  /** Vignettes, éléments posés sur une carte. */
  surfaceRaised: '#1C2230',
  border: '#232832',
  text: '#ECEEF1',
  muted: '#9B9FA7',
  faint: '#585D65',

  /** Citron : bouton principal, onglet actif, « Vérifié », Garantie Zandu, argent disponible. */
  brand: '#C6F432',
  brandPressed: '#A8CF24',
  /** Texte posé sur le citron. */
  onBrand: '#0B0E15',
  brandSoft: '#1C2316',
  brandBorder: '#445033',
  /** La confiance prend la couleur de la marque (maquettes). */
  trust: '#C6F432',
  trustSoft: '#1C2316',

  /** Cyan : argent bloqué, en livraison, information. */
  waiting: '#3BDFFD',
  waitingSoft: '#10252B',
  /** Corail : à accepter, problème, refus, urgence. */
  danger: '#F77858',
  dangerSoft: '#2A1714',
  /** Violet : seconde série des graphiques (commissions, Airtel Money). */
  accent: '#8B7BFF',

  placeholder: '#1C2230',
} as const;

export type ColorName = keyof typeof colors;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

/** Champs 12, cartes 16, boutons et puces en pilule. */
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const fontSize = {
  small: 13,
  body: 15,
  title: 18,
  headline: 24,
  amount: 34,
} as const;

/**
 * Polices provisoires, proches des maquettes (à confirmer avec la designer) : une linéale très
 * large pour les titres et les montants, une linéale géométrique pour le texte. Libres (OFL).
 */
export const fontFamily = {
  display: 'Unbounded',
  body: 'DM Sans',
} as const;

/** Cible tactile minimale (48 dp). */
export const touchTarget = 48;
