import { StyleSheet, View } from 'react-native';
import { Text } from '../../src/ui/Text';
import { errorMessage } from '../../src/api';
import { displayPhone, formatDateTime, formatXaf } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { MoneyTiles } from '../../src/seller/MoneyTiles';
import { useBalance, useShop } from '../../src/seller/queries';
import { colors, font, space } from '../../src/theme';
import { useRefetchOnFocus } from '../../src/useRefetchOnFocus';
import { Failure, Loading, Screen, Section } from '../../src/ui/Layout';
import { RequireRole } from '../../src/ui/RequireRole';

const PAYOUT_COLORS = {
  pending: colors.waiting,
  processing: colors.waiting,
  succeeded: colors.trust,
  failed: colors.danger,
} as const;

function Money() {
  const balance = useBalance();
  const shop = useShop();
  useRefetchOnFocus(balance.refetch);

  if (balance.isPending) return <Loading />;
  if (balance.isError)
    return <Failure message={errorMessage(balance.error)} onRetry={() => void balance.refetch()} />;
  const b = balance.data;

  return (
    <Screen refreshing={balance.isRefetching} onRefresh={() => void balance.refetch()}>
      <MoneyTiles available={b.available} inEscrow={b.inEscrow} />
      <View style={styles.hints}>
        <Text style={styles.hint}>
          <Text style={styles.hintStrong}>{t.seller.available} : </Text>
          {t.seller.availableHint}
        </Text>
        <Text style={styles.hint}>
          <Text style={styles.hintStrong}>{t.seller.inEscrow} : </Text>
          {t.seller.inEscrowHint}
        </Text>
        {shop.data ? (
          <Text style={styles.hint}>
            {t.seller.payoutTo(
              `${displayPhone(shop.data.payoutPhone)} (${shop.data.payoutOperator === 'mtn' ? 'MTN MoMo' : 'Airtel Money'})`,
            )}
          </Text>
        ) : null}
      </View>
      <Section title={t.seller.payouts}>
        {b.payouts.length === 0 ? <Text style={styles.hint}>{t.seller.noPayouts}</Text> : null}
        {b.payouts.map((p) => (
          <View key={p.id} style={styles.payout} testID="payout-row">
            <View style={styles.payoutInfo}>
              <Text style={styles.ref}>{p.publicRef ?? '—'}</Text>
              <Text style={styles.date}>{formatDateTime(p.succeededAt ?? p.createdAt)}</Text>
            </View>
            <View style={styles.payoutAmount}>
              <Text style={styles.amount}>{formatXaf(p.amount)}</Text>
              <Text style={[styles.status, { color: PAYOUT_COLORS[p.status] }]}>
                {t.seller.payoutStatus[p.status]}
              </Text>
            </View>
          </View>
        ))}
      </Section>
    </Screen>
  );
}

/** Mon argent (F15) : à recevoir, en séquestre, et l'historique des versements Mobile Money. */
export default function MoneyScreen() {
  return (
    <RequireRole role="seller">
      <Money />
    </RequireRole>
  );
}

const styles = StyleSheet.create({
  hints: { gap: space.xs, paddingHorizontal: space.xs },
  hint: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
  hintStrong: { color: colors.text, fontWeight: '700' },
  payout: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  payoutInfo: { gap: 2 },
  payoutAmount: { alignItems: 'flex-end', gap: 2 },
  ref: { fontWeight: '800', color: colors.text },
  date: { color: colors.muted, fontSize: 12 },
  amount: { fontWeight: '800', color: colors.text },
  status: { fontSize: font.small, fontWeight: '700' },
});
