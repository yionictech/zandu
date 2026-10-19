import type { Payment } from '@zandu/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../src/ui/Text';
import { api, errorCode, errorMessage, newIdempotencyKey, unwrap } from '../../src/api';
import { API_URL, SIMULATOR_ENABLED } from '../../src/config';
import {
  countdown,
  displayPhone,
  formatXaf,
  isValidCongoPhone,
  suggestOperator,
} from '../../src/format';
import { t } from '../../src/i18n/fr';
import { useSession } from '../../src/session';
import { colors, font, radius, space } from '../../src/theme';
import { Button } from '../../src/ui/Button';
import { Chip, ErrorText, Field } from '../../src/ui/Form';
import { Failure, Loading, Screen, Section } from '../../src/ui/Layout';
import { GuaranteeCard } from '../../src/ui/Trust';

const OPERATORS = [
  { code: 'mtn', label: 'MTN MoMo' },
  { code: 'airtel', label: 'Airtel Money' },
] as const;
type Operator = (typeof OPERATORS)[number]['code'];

/**
 * Paiement Mobile Money (docs/ux/02-parcours-et-ecrans.md) : un montant énorme, l'opérateur
 * deviné, puis l'attente de la validation PIN avec compte à rebours. L'écran interroge l'API
 * toutes les 3 s ; l'API, elle, ne fait confiance qu'au webhook signé de l'agrégateur.
 */
export default function PaymentScreen() {
  const { checkoutId } = useLocalSearchParams<{ checkoutId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useSession();
  const [phone, setPhone] = useState(user ? displayPhone(user.phone) : '');
  const [operator, setOperator] = useState<Operator>(suggestOperator(phone) ?? 'mtn');
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const attemptKey = useRef<string | null>(null);

  const checkout = useQuery({
    queryKey: ['checkout', checkoutId],
    queryFn: async () =>
      unwrap(await api.GET('/v1/checkouts/{id}', { params: { path: { id: checkoutId } } })),
  });
  const payment = useQuery({
    queryKey: ['payment', paymentId],
    queryFn: async () =>
      unwrap(await api.GET('/v1/payments/{id}', { params: { path: { id: paymentId! } } })),
    enabled: paymentId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'pending' || status === 'created' ? 3000 : false;
    },
  });

  const status = payment.data?.status;
  const waiting = status === 'pending' || status === 'created';
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);
  useEffect(() => {
    if (status === 'succeeded') {
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void checkout.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (checkout.isPending) return <Loading />;
  if (checkout.isError)
    return (
      <Failure message={errorMessage(checkout.error)} onRetry={() => void checkout.refetch()} />
    );
  const c = checkout.data;

  const pay = async () => {
    setBusy(true);
    setError(null);
    attemptKey.current ??= newIdempotencyKey();
    try {
      const created = unwrap(
        await api.POST('/v1/checkouts/{id}/payments', {
          params: { path: { id: checkoutId }, header: { 'Idempotency-Key': attemptKey.current } },
          body: { operator, phone },
        }),
      );
      queryClient.setQueryData(['payment', created.id], created);
      setPaymentId(created.id);
      attemptKey.current = null;
    } catch (e) {
      // Une demande est déjà en attente (double appui, retour sur l'écran) : on la reprend.
      const details = (e as { details?: { paymentId?: string } }).details;
      if (errorCode(e) === 'payment_in_progress' && details?.paymentId)
        setPaymentId(details.paymentId);
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const tryAgain = () => {
    setPaymentId(null);
    setError(null);
    void checkout.refetch();
  };

  const simulateApproval = async (p: Payment) => {
    await fetch(`${API_URL}/dev/simulator/collections/${p.id}/approve`, { method: 'POST' });
    void payment.refetch();
  };

  // ---- Paiement reçu ----
  if (c.status === 'paid' || status === 'succeeded') {
    const firstOrder = c.orders[0];
    return (
      <Screen
        footer={
          <Button
            label={t.payment.track}
            variant="trust"
            testID="payment-track"
            onPress={() =>
              c.orders.length === 1 && firstOrder
                ? router.replace(`/commande/${firstOrder.id}`)
                : router.replace('/commandes')
            }
          />
        }
      >
        <View style={[styles.hero, styles.heroSuccess]} testID="payment-success">
          <Text style={styles.heroIcon}>✓</Text>
          <Text style={styles.heroTitle}>{t.payment.successTitle}</Text>
          <Text style={styles.amount}>{formatXaf(c.grandTotal)}</Text>
          {c.orders.map((o) => (
            <Text key={o.id} style={styles.ref}>
              {o.publicRef} · {o.seller.shopName}
            </Text>
          ))}
        </View>
        <GuaranteeCard />
        <Text style={styles.body}>{t.payment.successBody}</Text>
      </Screen>
    );
  }

  // ---- Panier expiré ----
  if (c.status === 'expired') {
    return (
      <Screen footer={<Button label={t.payment.restart} onPress={() => router.replace('/')} />}>
        <View style={[styles.hero, styles.heroWarning]}>
          <Text style={styles.heroTitle}>{t.payment.expiredTitle}</Text>
          <Text style={styles.body}>{t.payment.checkoutExpired}</Text>
        </View>
      </Screen>
    );
  }

  // ---- En attente de la validation PIN ----
  if (payment.data && waiting) {
    const p = payment.data;
    const msLeft = new Date(p.expiresAt).getTime() - now;
    return (
      <Screen
        footer={
          SIMULATOR_ENABLED ? (
            <Button
              label={t.payment.simulate}
              variant="secondary"
              onPress={() => void simulateApproval(p)}
              testID="payment-simulate"
            />
          ) : undefined
        }
      >
        <View style={[styles.hero, styles.heroWaiting]} testID="payment-waiting">
          <Text style={styles.heroTitle}>{t.payment.validateTitle}</Text>
          <Text style={styles.amount}>{formatXaf(p.amount)}</Text>
          <Text style={styles.ref}>
            {OPERATORS.find((o) => o.code === p.operator)?.label} · {displayPhone(p.msisdn)}
          </Text>
          <Text style={styles.countdown} accessibilityLabel="Temps restant">
            {countdown(msLeft)}
          </Text>
          <Text style={styles.body}>{t.payment.validateBody}</Text>
        </View>
        <GuaranteeCard />
        <Text style={styles.help}>{t.payment.noPrompt}</Text>
      </Screen>
    );
  }

  // ---- Échec ou expiration de la tentative : message clair, nouvel essai ----
  const failure =
    payment.data && (status === 'failed' || status === 'expired') ? payment.data : null;

  return (
    <Screen
      footer={
        <>
          <ErrorText message={error} />
          <Button
            label={t.payment.pay(formatXaf(c.grandTotal))}
            onPress={() => {
              if (failure) setPaymentId(null);
              void pay();
            }}
            loading={busy}
            disabled={!isValidCongoPhone(phone)}
            testID="payment-pay"
          />
        </>
      }
    >
      {failure ? (
        <View style={[styles.hero, styles.heroFailure]} testID="payment-failed">
          <Text style={styles.heroTitle}>
            {status === 'expired' ? t.payment.expiredTitle : t.payment.failedTitle}
          </Text>
          <Text style={styles.body}>{failure.failure?.message}</Text>
          <Button label={t.payment.otherOperator} variant="secondary" onPress={tryAgain} />
        </View>
      ) : null}

      <Section title={t.payment.summary}>
        {c.orders.map((o) => (
          <View key={o.id} style={styles.row}>
            <Text style={styles.label} numberOfLines={1}>
              {o.seller.shopName} ({o.items.reduce((n, i) => n + i.quantity, 0)} art.)
            </Text>
            <Text style={styles.value}>{formatXaf(o.itemsSubtotal)}</Text>
          </View>
        ))}
        <View style={styles.row}>
          <Text style={styles.label}>{t.payment.delivery}</Text>
          <Text style={styles.value}>{formatXaf(c.deliveryTotal)}</Text>
        </View>
        <View style={[styles.row, styles.totalRow]}>
          <Text style={styles.totalLabel}>{t.payment.total}</Text>
          <Text style={styles.total}>{formatXaf(c.grandTotal)}</Text>
        </View>
      </Section>

      <Section title={t.payment.operator}>
        <View style={styles.operators}>
          {OPERATORS.map((o) => (
            <Chip
              key={o.code}
              label={o.label}
              selected={operator === o.code}
              onPress={() => setOperator(o.code)}
              testID={`operator-${o.code}`}
            />
          ))}
        </View>
        <Field
          label={t.payment.phone}
          value={phone}
          onChangeText={(v) => {
            setPhone(v);
            const guess = suggestOperator(v);
            if (guess) setOperator(guess);
          }}
          keyboardType="phone-pad"
          testID="payment-phone"
        />
      </Section>
      <GuaranteeCard />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.lg, padding: space.lg, alignItems: 'center', gap: space.sm },
  heroWaiting: { backgroundColor: colors.waitingSoft },
  heroSuccess: { backgroundColor: colors.trustSoft },
  heroFailure: { backgroundColor: colors.dangerSoft, alignItems: 'stretch' },
  heroWarning: { backgroundColor: colors.waitingSoft },
  heroIcon: { fontSize: 44, color: colors.trust, fontWeight: '900' },
  heroTitle: {
    fontSize: font.headline,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
  },
  amount: { fontSize: font.amount + 6, fontWeight: '900', color: colors.text },
  ref: { fontSize: font.body, color: colors.muted, fontWeight: '600' },
  countdown: {
    fontSize: 40,
    fontWeight: '800',
    color: colors.waiting,
    fontVariant: ['tabular-nums'],
  },
  body: { fontSize: font.body, color: colors.text, textAlign: 'center', lineHeight: 22 },
  help: { fontSize: font.small, color: colors.muted, lineHeight: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  label: { flex: 1, color: colors.muted, fontSize: font.body },
  value: { color: colors.text, fontWeight: '700', fontSize: font.body },
  totalRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.sm },
  totalLabel: { fontSize: font.title, fontWeight: '800', color: colors.text },
  total: { fontSize: font.title, fontWeight: '900', color: colors.text },
  operators: { flexDirection: 'row', gap: space.sm },
});
