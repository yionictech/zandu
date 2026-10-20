import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { groupThousands } from '../format';
import { colors, font, radius, space } from '../theme';
import { Text } from './Text';

/**
 * Pièces communes des écrans de la nouvelle direction visuelle (docs/ux/03) : montants en
 * linéale large avec « FCFA » en petit, boutons ronds, badges, avatars à initiales, encarts.
 */

const AMOUNT_SIZES = { sm: 15, md: 20, lg: 32, xl: 44 } as const;

/** « 95 000 FCFA » : chiffres en linéale large, « FCFA » plus petit et discret. */
export function Amount({
  value,
  size = 'md',
  color = colors.text,
  sign,
  testID,
}: {
  value: number;
  size?: keyof typeof AMOUNT_SIZES;
  color?: string;
  sign?: '+' | '−';
  testID?: string;
}) {
  const px = AMOUNT_SIZES[size];
  return (
    <Text style={[styles.amount, { fontSize: px, color, lineHeight: px * 1.2 }]} testID={testID}>
      {sign ?? ''}
      {groupThousands(String(Math.abs(value)))}
      <Text style={[styles.currency, { fontSize: Math.max(11, Math.round(px * 0.42)) }]}>
        {' FCFA'}
      </Text>
    </Text>
  );
}

/** Bouton rond (retour, partage, favori, cloche), avec un point quand il y a du nouveau. */
export function IconButton({
  icon: Icon,
  onPress,
  label,
  dot,
  active,
  testID,
}: {
  icon: LucideIcon;
  onPress: () => void;
  label: string;
  dot?: boolean;
  active?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
      testID={testID}
    >
      <Icon
        color={active ? colors.brand : colors.text}
        fill={active ? colors.brand : 'transparent'}
        size={20}
        strokeWidth={1.8}
      />
      {dot ? <View style={styles.dot} /> : null}
    </Pressable>
  );
}

type Tone = 'brand' | 'waiting' | 'danger' | 'neutral';
const BADGE: Record<Tone, { background: string; color: string }> = {
  brand: { background: colors.brand, color: colors.onBrand },
  waiting: { background: colors.waiting, color: colors.onBrand },
  danger: { background: colors.danger, color: colors.onBrand },
  neutral: { background: colors.surfaceRaised, color: colors.muted },
};

/** Petit badge en pilule : « Vérifié », « En route », « À accepter », « Étape 1 / 2 ». */
export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const { background, color } = BADGE[tone];
  return (
    <View style={[styles.badge, { backgroundColor: background }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

/** Badge à droite de l'en-tête (« Étape 1 / 2 »), centré verticalement et décollé du bord. */
export function HeaderBadge({ label }: { label: string }) {
  return (
    <View style={styles.headerBadge}>
      <Badge label={label} />
    </View>
  );
}

/** Initiales d'une boutique ou d'une personne (« MG » pour Mama Grâce Électro). */
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials =
    name
      .split(/\s+/)
      .filter((w) => /^\p{L}/u.test(w))
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '•';
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.32 }]}>{initials}</Text>
    </View>
  );
}

/** Carte sombre à bord fin. */
export function Card({
  children,
  style,
  highlight,
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Bord citron (choix sélectionné, garantie). */
  highlight?: boolean;
  testID?: string;
}) {
  return (
    <View style={[styles.card, highlight && styles.cardHighlight, style]} testID={testID}>
      {children}
    </View>
  );
}

/** Encart d'information : une icône et une phrase (« Ce numéro sert aussi à payer… »). */
export function Note({
  icon: Icon,
  children,
  tone = 'brand',
}: {
  icon: LucideIcon;
  children: ReactNode;
  tone?: 'brand' | 'waiting' | 'danger';
}) {
  const accent = { brand: colors.brand, waiting: colors.waiting, danger: colors.danger }[tone];
  return (
    <View style={styles.note}>
      <Icon color={accent} size={18} strokeWidth={1.8} />
      <Text style={styles.noteText}>{children}</Text>
    </View>
  );
}

/** Petit titre de rubrique en capitales espacées (« PAYER AVEC », « LIVRAISON À »). */
export function Eyebrow({ children, color = colors.muted }: { children: string; color?: string }) {
  return <Text style={[styles.eyebrow, { color }]}>{children.toUpperCase()}</Text>;
}

const styles = StyleSheet.create({
  amount: { fontWeight: '800' },
  currency: { color: colors.muted, fontWeight: '800' },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: colors.surfaceRaised },
  dot: {
    position: 'absolute',
    top: 9,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.danger,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  headerBadge: { justifyContent: 'center', marginRight: space.md },
  badgeText: { fontSize: 12, fontWeight: '700' },
  avatar: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.brand, fontWeight: '800' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: space.sm,
  },
  cardHighlight: { borderColor: colors.brandBorder, backgroundColor: colors.brandSoft },
  note: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
  },
  noteText: { flex: 1, color: colors.muted, fontSize: font.small, lineHeight: 19 },
  eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1 },
});
