import type { OrderStatus } from '@zandu/api-client';
import { Check } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { formatDateTime } from '../format';
import { colors, font, space } from '../theme';

const NOMINAL: Array<{ status: OrderStatus; label: string }> = [
  { status: 'paid', label: 'Payée' },
  { status: 'preparing', label: 'Acceptée par le vendeur' },
  { status: 'ready_for_pickup', label: 'Prête' },
  { status: 'in_delivery', label: 'En route' },
  { status: 'delivered', label: 'Remise' },
  { status: 'completed', label: 'Terminée' },
];

/** Frise de suivi « à la Amazon » : chaque étape franchie avec son heure. */
export function Timeline({ history }: { history: Array<{ status: OrderStatus; at: string }> }) {
  const reached = new Map(history.map((h) => [h.status, h.at]));
  const off = history.find((h) => ['cancelled', 'refunded', 'disputed'].includes(h.status));
  // Étape en cours : la première non franchie (anneau citron), sauf commande arrêtée.
  const current = off ? -1 : NOMINAL.findIndex((step) => !reached.has(step.status));
  return (
    <View style={styles.list}>
      {NOMINAL.map((step, index) => {
        const at = reached.get(step.status);
        const done = at !== undefined;
        return (
          <View key={step.status} style={styles.row}>
            <View style={styles.rail}>
              <View
                style={[styles.dot, done && styles.dotDone, index === current && styles.dotCurrent]}
              >
                {done ? <Check color={colors.onBrand} size={13} strokeWidth={3} /> : null}
              </View>
              {index < NOMINAL.length - 1 ? (
                <View style={[styles.line, done && styles.lineDone]} />
              ) : null}
            </View>
            <View style={styles.text}>
              <Text style={[styles.label, !done && styles.pending]}>{step.label}</Text>
              {at ? <Text style={styles.at}>{formatDateTime(at)}</Text> : null}
            </View>
          </View>
        );
      })}
      {off ? (
        <Text style={styles.off}>
          {off.status === 'disputed'
            ? 'Problème signalé'
            : off.status === 'refunded'
              ? 'Remboursée'
              : 'Annulée'}{' '}
          · {formatDateTime(off.at)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 0 },
  row: { flexDirection: 'row', minHeight: 54 },
  rail: { width: 26, alignItems: 'center' },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.faint,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: colors.trust, borderColor: colors.trust },
  dotCurrent: { borderColor: colors.brand },
  line: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  lineDone: { backgroundColor: colors.trust },
  text: { flex: 1, paddingLeft: space.md, paddingTop: 1, paddingBottom: space.sm },
  label: { fontSize: font.body, color: colors.text, fontWeight: '600' },
  pending: { color: colors.muted, fontWeight: '400' },
  at: { fontSize: 12, color: colors.muted },
  off: { marginTop: space.sm, color: colors.danger, fontWeight: '700' },
});
