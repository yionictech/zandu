/**
 * Fondations visuelles de l'application : celles de `@zandu/design` (docs/ux/03), partagées avec
 * le site et le back-office, plus les noms des polices chargées par l'application.
 */
import { fontSize } from '@zandu/design';

export { colors, radius, space, touchTarget } from '@zandu/design';

/** Tailles de texte. */
export const font = fontSize;

/**
 * Polices chargées au démarrage (app/_layout.tsx). Sur Android, une police chargée ne se met pas
 * en gras toute seule : chaque graisse est une police à part (voir ui/Text.tsx).
 */
export const fonts = {
  regular: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  bold: 'DMSans_700Bold',
  /** Titres et montants : linéale large. */
  display: 'Unbounded_700Bold',
  displayHeavy: 'Unbounded_800ExtraBold',
} as const;
