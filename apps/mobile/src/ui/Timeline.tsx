import type { OrderStatus } from '@zandu/api-client';
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
  return (
    <View style={styles.list}>
      {NOMINAL.map((step, index) => {
        const at = reached.get(step.status);
        const done = at !== undefined;
        return (
          <View key={step.status} style={styles.row}>
            <View style={styles.rail}>
              <View style={[styles.dot, done && styles.dotDone]} />
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
  row: { flexDirection: 'row', minHeight: 44 },
  rail: { width: 24, alignItems: 'center' },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginTop: 3,
  },
  dotDone: { backgroundColor: colors.trust, borderColor: colors.trust },
  line: { flex: 1, width: 2, backgroundColor: colors.border },
  lineDone: { backgroundColor: colors.trust },
  text: { flex: 1, paddingLeft: space.sm, paddingBottom: space.sm },
  label: { fontSize: font.body, color: colors.text, fontWeight: '600' },
  pending: { color: colors.muted, fontWeight: '400' },
  at: { fontSize: 12, color: colors.muted },
  off: { marginTop: space.sm, color: colors.danger, fontWeight: '700' },
});
