/**
 * Fondations visuelles (docs/ux/01-principes-experience.md §3) : une couleur de marque,
 * un vert réservé à la confiance (garantie, séquestre), contrastes AA, police système.
 */
export const colors = {
  brand: '#C2410C',
  brandPressed: '#9A3412',
  brandSoft: '#FFF7ED',
  trust: '#047857',
  trustSoft: '#ECFDF5',
  waiting: '#B45309',
  waitingSoft: '#FFFBEB',
  danger: '#B91C1C',
  dangerSoft: '#FEF2F2',
  text: '#111827',
  muted: '#4B5563',
  border: '#E5E7EB',
  background: '#F3F4F6',
  surface: '#FFFFFF',
  placeholder: '#E5E7EB',
} as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export const radius = { sm: 6, md: 10, lg: 16 } as const;

export const font = {
  small: 13,
  body: 15,
  title: 18,
  headline: 22,
  amount: 32,
} as const;

/** Cible tactile minimale (48 dp). */
export const touchTarget = 48;
