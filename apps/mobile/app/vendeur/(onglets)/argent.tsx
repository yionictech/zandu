import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { errorMessage } from '../../../src/api';
import { displayPhone, formatDateTime, groupThousands } from '../../../src/format';
import { t } from '../../../src/i18n/fr';
import { operatorName, useBalance } from '../../../src/seller/queries';
import { TabHeader } from '../../../src/seller/ui';
import { colors, font, radius, space } from '../../../src/theme';
import { useRefetchOnFocus } from '../../../src/useRefetchOnFocus';
import { Button } from '../../../src/ui/Button';
import { Amount, Card, Eyebrow } from '../../../src/ui/kit';
import { Failure, Loading } from '../../../src/ui/Layout';
import { Text } from '../../../src/ui/Text';

const MOVEMENT = {
  held: { color: colors.waiting, sign: '' },
  released: { color: colors.brand, sign: '+' },
  paid_out: { color: colors.muted, sign: '−' },
} as const;

/** « 05 ••• •• 90 » : le numéro de reversement sans le dévoiler entièrement. */
function maskedPhone(e164: string): string {
  const d = displayPhone(e164);
  return `${d.slice(0, 2)} ••• •• ${d.slice(-2)}`;
}

/** Mon argent (maquette) : disponible, bloqué, comment on est payé, mouvements. */
export default function SellerMoney() {
  const router = useRouter();
  const balance = useBalance();
  useRefetchOnFocus(balance.refetch);

  if (balance.isPending) return <Loading />;
  if (balance.isError)
    return <Failure message={errorMessage(balance.error)} onRetry={() => void balance.refetch()} />;
  const b = balance.data;
  const total = b.available + b.inEscrow;
  const share = total > 0 ? b.available / total : 0;

  return (
    <View style={styles.screen}>
      <TabHeader title={t.vendor.myMoney} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.hero}>
          <Eyebrow>{t.vendor.availableToPayout}</Eyebrow>
          <Amount value={b.available} size="lg" color={colors.brand} testID="money-available" />
          <View style={styles.bar}>
            {total > 0 ? (
              <>
                <View style={[styles.barPart, { flex: share, backgroundColor: colors.brand }]} />
                <View
                  style={[styles.barPart, { flex: 1 - share, backgroundColor: colors.waiting }]}
                />
              </>
            ) : null}
          </View>
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: colors.brand }]} />
              <Text style={styles.muted}>{t.vendor.availableShort}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: colors.waiting }]} />
              <Text style={styles.muted} testID="money-escrow">
                {t.vendor.blocked} · {groupThousands(String(b.inEscrow))} F
              </Text>
            </View>
          </View>
          {b.payoutMode === 'on_demand' ? (
            <Button
              label={`${t.vendor.withdrawTo(operatorName(b.payoutAccount.operator))} · ${maskedPhone(b.payoutAccount.phone)}`}
              onPress={() => router.push('/vendeur/retrait')}
              testID="money-withdraw"
            />
          ) : (
            <View style={styles.payoutTo}>
              <Text style={styles.payoutText}>
                {t.vendor.autoPayout(operatorName(b.payoutAccount.operator))} ·{' '}
                {maskedPhone(b.payoutAccount.phone)}
              </Text>
            </View>
          )}
        </Card>

        <Card>
          <Text style={styles.cardTitle}>{t.vendor.whenPaid}</Text>
          <View style={styles.when}>
            {t.vendor.whenSteps.map((label, i) => (
              <View key={label} style={styles.whenStep}>
                <View
                  style={[
                    styles.whenNumber,
                    { backgroundColor: [colors.faint, colors.waiting, colors.brand][i] },
                  ]}
                >
                  <Text style={styles.whenDigit}>{i + 1}</Text>
                </View>
                <Text style={styles.whenLabel}>{label}</Text>
              </View>
            ))}
          </View>
        </Card>

        <Card>
          <Text style={styles.cardTitle}>{t.vendor.movements}</Text>
          {b.movements.length === 0 ? (
            <Text style={styles.muted}>{t.vendor.noMovements}</Text>
          ) : null}
          {b.movements.map((m, i) => (
            <View
              key={`${m.kind}-${m.publicRef}-${i}`}
              style={styles.movement}
              testID={m.kind === 'paid_out' ? 'payout-row' : `movement-${m.kind}`}
            >
              <View style={[styles.dot, { backgroundColor: MOVEMENT[m.kind].color }]} />
              <View style={styles.flex}>
                <Text style={styles.body}>
                  {m.kind === 'paid_out'
                    ? `${t.vendor.movementKinds.paid_out} · ${operatorName(b.payoutAccount.operator)}`
                    : `${t.vendor.movementKinds[m.kind]} · ${m.publicRef}`}
                </Text>
                <Text style={styles.small}>{formatDateTime(m.at)}</Text>
              </View>
              <Text style={[styles.amount, { color: MOVEMENT[m.kind].color }]}>
                {MOVEMENT[m.kind].sign}
                {groupThousands(String(m.amount))}
              </Text>
            </View>
          ))}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: space.md, paddingTop: space.xs, gap: space.md, paddingBottom: space.xl },
  hero: { gap: space.sm },
  bar: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
  },
  barPart: { height: 8 },
  legend: { flexDirection: 'row', justifyContent: 'space-between' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  payoutTo: {
    backgroundColor: colors.brandSoft,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.brandBorder,
    paddingVertical: 12,
    paddingHorizontal: space.md,
    alignItems: 'center',
  },
  payoutText: { color: colors.brand, fontWeight: '700', fontSize: font.small, textAlign: 'center' },
  cardTitle: { color: colors.text, fontSize: font.body, fontWeight: '800' },
  when: { flexDirection: 'row', gap: space.sm },
  whenStep: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: space.sm + 2,
    gap: 6,
  },
  whenNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  whenDigit: { color: colors.onBrand, fontSize: 12, fontWeight: '800' },
  whenLabel: { color: colors.text, fontSize: 12, fontWeight: '700' },
  movement: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 8 },
  flex: { flex: 1, gap: 2 },
  body: { color: colors.text, fontSize: font.body },
  small: { color: colors.muted, fontSize: 12 },
  muted: { color: colors.muted, fontSize: font.small },
  amount: { fontWeight: '800', fontSize: font.body },
});
