import type { OrderStatus } from '@zandu/api-client';
import { Check, ChevronRight, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../i18n/fr';
import { colors, font, radius, space } from '../theme';
import { Text } from '../ui/Text';

/**
 * Pièces des écrans vendeur (maquettes vendeur) : en-tête à grand titre, interrupteur, barre
 * d'étapes d'une commande, badge de statut, choix en carte, case à cocher, ligne de réglage.
 */

/** En-tête des onglets vendeur : grand titre à gauche, une action ronde à droite. */
export function TabHeader({ title, right }: { title: ReactNode; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + space.md }]}>
      <View style={styles.headerTitle}>
        {typeof title === 'string' ? <Text style={styles.title}>{title}</Text> : title}
      </View>
      {right}
    </View>
  );
}

/** Interrupteur citron (produit en ligne, boutique ouverte). */
export function Toggle({
  value,
  onChange,
  label,
  disabled,
  testID,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={label}
      hitSlop={8}
      style={[styles.track, value && styles.trackOn, disabled && styles.disabled]}
      testID={testID}
    >
      <View style={[styles.knob, value && styles.knobOn]} />
    </Pressable>
  );
}

/** Couleur du badge d'une commande côté vendeur : corail à accepter, citron à faire, cyan en route. */
export function sellerStatusTone(status: OrderStatus): { background: string; color: string } {
  if (status === 'paid' || status === 'disputed')
    return { background: colors.danger, color: colors.onBrand };
  if (status === 'preparing' || status === 'ready_for_pickup' || status === 'delivered')
    return { background: colors.brand, color: colors.onBrand };
  if (status === 'in_delivery' || status === 'awaiting_collection')
    return { background: colors.waiting, color: colors.onBrand };
  return { background: colors.surfaceRaised, color: colors.muted };
}

export function StatusBadge({ status, testID }: { status: OrderStatus; testID?: string }) {
  const tone = sellerStatusTone(status);
  return (
    <View style={[styles.badge, { backgroundColor: tone.background }]} testID={testID}>
      <Text style={[styles.badgeText, { color: tone.color }]}>{t.vendor.shortStatus[status]}</Text>
    </View>
  );
}

/** Étape atteinte d'une commande : Acceptée, Préparée, Remise livreur, Livrée. */
export function orderStep(status: OrderStatus): number {
  return (
    (
      {
        preparing: 1,
        ready_for_pickup: 2,
        in_delivery: 3,
        awaiting_collection: 3,
        delivered: 4,
        completed: 4,
        disputed: 4,
      } as Partial<Record<OrderStatus, number>>
    )[status] ?? 0
  );
}

/** Barre d'étapes sous l'en-tête d'une commande (4 segments, libellés dessous). */
export function OrderSteps({ status }: { status: OrderStatus }) {
  const reached = orderStep(status);
  return (
    <View style={styles.steps}>
      {t.vendor.steps.map((label, i) => (
        <View key={label} style={styles.step}>
          <View style={[styles.stepBar, i < reached && styles.stepBarOn]} />
          <Text style={[styles.stepLabel, i < reached && styles.stepLabelOn]} numberOfLines={1}>
            {label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Choix en carte avec bouton radio (réponse à un litige). */
export function RadioCard({
  title,
  hint,
  selected,
  onPress,
  testID,
}: {
  title: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.radioCard, selected && styles.radioCardOn]}
      testID={testID}
    >
      <View style={[styles.radio, selected && styles.radioOn]}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
      <View style={styles.flex}>
        <Text style={styles.radioTitle}>{title}</Text>
        {hint ? <Text style={styles.muted}>{hint}</Text> : null}
      </View>
    </Pressable>
  );
}

/** Case à cocher citron avec son texte (liste « Avant de fermer le colis », conditions). */
export function CheckRow({
  label,
  checked,
  onPress,
  testID,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={styles.checkRow}
      testID={testID}
    >
      <View style={[styles.box, checked && styles.boxOn]}>
        {checked ? <Check color={colors.onBrand} size={16} strokeWidth={3} /> : null}
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

/** Ligne de réglage de « Ma boutique » : icône, titre, valeur, chevron. */
export function SettingRow({
  icon: Icon,
  title,
  value,
  onPress,
  testID,
}: {
  icon: LucideIcon;
  title: string;
  value?: string | null;
  onPress?: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.setting, pressed && styles.pressed]}
      testID={testID}
    >
      <Icon color={colors.muted} size={20} strokeWidth={1.8} />
      <View style={styles.flex}>
        <Text style={styles.settingTitle}>{title}</Text>
        {value ? (
          <Text style={styles.muted} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
      </View>
      {onPress ? <ChevronRight color={colors.muted} size={18} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    backgroundColor: colors.background,
  },
  headerTitle: { flex: 1 },
  title: { fontSize: 24, fontWeight: '800', color: colors.text },
  track: {
    width: 50,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
    justifyContent: 'center',
  },
  trackOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.muted },
  knobOn: { backgroundColor: colors.onBrand, alignSelf: 'flex-end' },
  disabled: { opacity: 0.5 },
  badge: { borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'center' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  steps: { flexDirection: 'row', gap: 6 },
  step: { flex: 1, gap: 6 },
  stepBar: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceRaised },
  stepBarOn: { backgroundColor: colors.brand },
  stepLabel: { fontSize: 11, color: colors.faint },
  stepLabelOn: { color: colors.text, fontWeight: '700' },
  radioCard: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
  },
  radioCardOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.brand },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
  radioTitle: { fontSize: font.body, fontWeight: '700', color: colors.text },
  muted: { fontSize: font.small, color: colors.muted, lineHeight: 18 },
  flex: { flex: 1, gap: 2 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 8 },
  box: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.faint,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  checkLabel: { flex: 1, fontSize: font.body, color: colors.text, lineHeight: 21 },
  setting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: 14,
  },
  pressed: { backgroundColor: colors.surfaceRaised },
  settingTitle: { fontSize: font.body, fontWeight: '600', color: colors.text },
});
