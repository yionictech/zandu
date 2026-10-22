import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Check, Hourglass } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api, errorMessage, unwrap } from '../../src/api';
import { displayPhone, formatDateTime, formatXaf } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { operatorName, sellerKeys, useBalance } from '../../src/seller/queries';
import { colors, font, space } from '../../src/theme';
import { Button } from '../../src/ui/Button';
import { CodeInput } from '../../src/ui/CodeInput';
import { ErrorText, Field } from '../../src/ui/Form';
import { Amount, Badge, Card, Eyebrow, Note } from '../../src/ui/kit';
import { Failure, Loading, Screen } from '../../src/ui/Layout';
import { RequireRole } from '../../src/ui/RequireRole';
import { Text } from '../../src/ui/Text';

type Done = { amount: number; status: 'pending' | 'awaiting_review' };

/**
 * Retirer mon argent (maquette « Mes gains », docs/ux/03 §14) : montant, code SMS de
 * confirmation, puis l'argent part — ou attend le contrôle de Zandu au-delà du seuil.
 */
function Withdraw() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const balance = useBalance();
  const info = useQuery({
    queryKey: ['seller', 'withdrawals'],
    queryFn: async () => unwrap(await api.GET('/v1/seller/withdrawals')),
  });
  const [amount, setAmount] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [done, setDone] = useState<Done | null>(null);

  const ask = useMutation({
    mutationFn: async (value: number) =>
      unwrap(await api.POST('/v1/seller/withdrawals', { body: { amount: value } })),
    onSuccess: (r) => setChallenge(r.challengeId),
  });
  const confirm = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/seller/withdrawals/confirm', {
          body: { challengeId: challenge!, code },
        }),
      ),
    onSuccess: (r) => {
      setDone({ amount: r.amount, status: r.status });
      void queryClient.invalidateQueries({ queryKey: ['seller'] });
    },
    onError: () => setCode(''),
  });

  if (info.isPending || balance.isPending) return <Loading />;
  if (info.isError || balance.isError)
    return (
      <Failure
        message={errorMessage(info.error ?? balance.error)}
        onRetry={() => void info.refetch()}
      />
    );
  const w = info.data;
  const account = balance.data.payoutAccount;
  const operator = operatorName(account.operator);
  const value = Number(amount.replace(/\D/g, ''));
  const valid = value >= w.minimum && value <= w.withdrawable;

  if (done) {
    const review = done.status === 'awaiting_review';
    return (
      <Screen
        footer={
          <Button
            label={t.vendor.myMoneyButton}
            onPress={() => router.replace('/vendeur/argent')}
          />
        }
        style={styles.done}
      >
        <View style={[styles.mark, review && styles.markReview]}>
          {review ? (
            <Hourglass color={colors.onBrand} size={34} strokeWidth={2.2} />
          ) : (
            <Check color={colors.onBrand} size={38} strokeWidth={3} />
          )}
        </View>
        <Text style={styles.doneTitle} testID="withdraw-done">
          {review ? t.vendor.withdrawInReview : t.vendor.withdrawSent}
        </Text>
        <Text style={styles.doneBody}>
          {review
            ? t.vendor.withdrawInReviewBody(formatXaf(done.amount))
            : t.vendor.withdrawSentBody(formatXaf(done.amount), operator)}
        </Text>
      </Screen>
    );
  }

  const error = ask.error ?? confirm.error;
  return (
    <Screen
      footer={
        <>
          <ErrorText message={error ? errorMessage(error) : null} />
          {challenge ? (
            <Button
              label={t.vendor.withdrawConfirm}
              onPress={() => confirm.mutate()}
              disabled={code.length !== 6}
              loading={confirm.isPending}
              testID="withdraw-confirm"
            />
          ) : (
            <Button
              label={t.vendor.withdrawSendCode}
              onPress={() => ask.mutate(value)}
              disabled={!valid}
              loading={ask.isPending}
              testID="withdraw-send-code"
            />
          )}
        </>
      }
    >
      <Card style={styles.hero}>
        <Eyebrow>{t.vendor.withdrawable}</Eyebrow>
        <Amount value={w.withdrawable} size="lg" color={colors.brand} testID="withdrawable" />
        <Text style={styles.muted}>
          {operator} · {displayPhone(account.phone)}
        </Text>
      </Card>
      {w.blockedReason && w.withdrawable === 0 ? (
        <Note icon={Hourglass} tone="waiting">
          {t.vendor.withdrawBlocked[w.blockedReason]}
        </Note>
      ) : null}
      {challenge ? (
        <Card>
          <Text style={styles.cardTitle}>{t.vendor.withdrawCodeTitle}</Text>
          <Text style={styles.muted}>
            {formatXaf(value)} · {t.vendor.withdrawCodeHint(displayPhone(account.phone))}
          </Text>
          <CodeInput
            value={code}
            onChange={setCode}
            label={t.vendor.withdrawCodeTitle}
            testID="withdraw-code"
          />
        </Card>
      ) : (
        <Card>
          <Field
            label={t.vendor.withdrawAmount}
            value={amount}
            onChangeText={setAmount}
            keyboardType="number-pad"
            placeholder={String(w.withdrawable)}
            testID="withdraw-amount"
          />
          <View style={styles.row}>
            <Text style={styles.muted}>{t.vendor.withdrawMin(formatXaf(w.minimum))}</Text>
            <Button
              label={t.vendor.withdrawAll}
              variant="ghost"
              onPress={() => setAmount(String(w.withdrawable))}
              disabled={w.withdrawable < w.minimum}
            />
          </View>
          <Text style={styles.muted}>{t.vendor.withdrawReview(formatXaf(w.reviewAbove))}</Text>
        </Card>
      )}
      {w.items.length ? (
        <Card>
          <Text style={styles.cardTitle}>{t.vendor.withdrawHistory}</Text>
          {w.items.map((item) => (
            <View key={item.id} style={styles.item}>
              <View style={styles.flex}>
                <Text style={styles.body}>{formatXaf(item.amount)}</Text>
                <Text style={styles.muted}>
                  {formatDateTime(item.createdAt)}
                  {item.reviewNote && item.status === 'failed' ? ` · ${item.reviewNote}` : ''}
                </Text>
              </View>
              <Badge
                label={t.vendor.withdrawStatus[item.status]}
                tone={
                  item.status === 'succeeded'
                    ? 'brand'
                    : item.status === 'failed'
                      ? 'danger'
                      : 'waiting'
                }
              />
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

export default function WithdrawScreen() {
  return (
    <RequireRole role="seller">
      <Withdraw />
    </RequireRole>
  );
}

const styles = StyleSheet.create({
  hero: { gap: space.sm },
  muted: { fontSize: font.small, color: colors.muted, lineHeight: 19 },
  cardTitle: { fontSize: font.body, fontWeight: '800', color: colors.text },
  body: { fontSize: font.body, fontWeight: '700', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 6 },
  flex: { flex: 1, gap: 2 },
  done: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: space.md },
  mark: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markReview: { backgroundColor: colors.waiting },
  doneTitle: { fontSize: font.headline, fontWeight: '800', color: colors.text },
  doneBody: { fontSize: font.body, color: colors.muted, textAlign: 'center', lineHeight: 21 },
});
