import type { Payment } from '@zandu/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Check, Lock, Package as PackageIcon, Wallet } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../src/ui/Text';
import { api, errorCode, errorMessage, newIdempotencyKey, unwrap } from '../../src/api';
import { SIMULATOR_ENABLED } from '../../src/config';
import { apiUrl, fetchOnServer, recetteHeaders } from '../../src/server';
import { displayPhone, formatXaf, isValidCongoPhone, suggestOperator } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { useSession } from '../../src/session';
import { colors, font, radius, space } from '../../src/theme';
import { Button } from '../../src/ui/Button';
import { ErrorText, Field } from '../../src/ui/Form';
import { Amount, Badge, Card, HeaderBadge, Eyebrow, Note } from '../../src/ui/kit';
import { CountdownRing } from '../../src/ui/CountdownRing';
import { Failure, Loading, Screen } from '../../src/ui/Layout';
import { GuaranteeCard } from '../../src/ui/Trust';

const OPERATORS = [
  { code: 'mtn', label: 'MTN MoMo' },
  { code: 'airtel', label: 'Airtel Money' },
] as const;
type Operator = (typeof OPERATORS)[number]['code'];
/** Durée laissée pour valider le PIN (PAYMENT_TTL_MINUTES de l'API, 10 min par défaut). */
const PAYMENT_WINDOW_MS = 10 * 60_000;

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
    await fetchOnServer(`${apiUrl()}/dev/simulator/collections/${p.id}/approve`, {
      method: 'POST',
      headers: recetteHeaders(),
    });
    void payment.refetch();
  };

  const operatorLabel = (code: string) => OPERATORS.find((o) => o.code === code)?.label ?? code;

  // ---- Paiement reçu : « Où est votre argent ? » ----
  if (c.status === 'paid' || status === 'succeeded') {
    const firstOrder = c.orders[0];
    return (
      <Screen
        style={styles.centered}
        footer={
          <Button
            label={t.payment.track}
            testID="payment-track"
            onPress={() =>
              c.orders.length === 1 && firstOrder
                ? router.replace(`/commande/${firstOrder.id}`)
                : router.replace('/commandes')
            }
          />
        }
      >
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.success} testID="payment-success">
          <View style={styles.successIcon}>
            <Check color={colors.onBrand} size={44} strokeWidth={3} />
          </View>
          <Text style={styles.heroTitle}>{t.payment.successTitle}</Text>
          <Amount value={c.grandTotal} size="xl" />
          {c.orders.map((o) => (
            <Text key={o.id} style={styles.ref}>
              {o.publicRef} · {o.seller.shopName}
            </Text>
          ))}
        </View>
        <Card>
          <Text style={styles.cardTitle}>{t.payment.whereIsMoney}</Text>
          <View style={styles.moneySteps}>
            {[Lock, PackageIcon, Wallet].map((Icon, i) => (
              <View key={i} style={styles.moneyStep}>
                <View style={[styles.moneyIcon, i === 0 && styles.moneyIconActive]}>
                  <Icon
                    color={i === 0 ? colors.onBrand : colors.muted}
                    size={20}
                    strokeWidth={1.8}
                  />
                </View>
                <Text style={[styles.moneyLabel, i === 0 && styles.moneyLabelActive]}>
                  {t.payment.moneySteps[i]}
                </Text>
              </View>
            ))}
          </View>
          <Text style={styles.muted}>{t.payment.moneyBody}</Text>
        </Card>
        <Note icon={Lock} tone="waiting">
          {t.payment.codeBySms}
        </Note>
      </Screen>
    );
  }

  // ---- Panier expiré ----
  if (c.status === 'expired') {
    return (
      <Screen footer={<Button label={t.payment.restart} onPress={() => router.replace('/')} />}>
        <Card>
          <Text style={styles.heroTitle}>{t.payment.expiredTitle}</Text>
          <Text style={styles.muted}>{t.payment.checkoutExpired}</Text>
        </Card>
      </Screen>
    );
  }

  // ---- En attente de la validation PIN : anneau de 10 minutes ----
  if (payment.data && waiting) {
    const p = payment.data;
    const msLeft = new Date(p.expiresAt).getTime() - now;
    const label = operatorLabel(p.operator);
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
        <Stack.Screen
          options={{
            title: t.payment.inProgress,
            headerBackVisible: false,
            // L'opérateur est rappelé sous le montant : l'en-tête garde la place pour le titre.
            headerRight: () => null,
          }}
        />
        <View style={styles.waiting} testID="payment-waiting">
          <CountdownRing
            msLeft={msLeft}
            totalMs={PAYMENT_WINDOW_MS}
            caption={t.payment.toValidate}
          />
          <Text style={styles.heroTitle}>{t.payment.validateTitle}</Text>
          <Amount value={p.amount} size="lg" />
          <Text style={styles.ref}>
            {label} · {displayPhone(p.msisdn)}
          </Text>
        </View>
        <Card>
          {t.payment.steps(label).map((step, i) => (
            <View key={i} style={styles.step}>
              <View style={[styles.stepNumber, i === 0 && styles.stepNumberActive]}>
                <Text style={[styles.stepDigit, i === 0 && styles.stepDigitActive]}>{i + 1}</Text>
              </View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </Card>
        <Text style={styles.help}>{t.payment.noPrompt}</Text>
      </Screen>
    );
  }

  // ---- Choix de l'opérateur ; échec ou expiration : message clair, nouvel essai ----
  const failure =
    payment.data && (status === 'failed' || status === 'expired') ? payment.data : null;
  const guessed = suggestOperator(phone);
  const firstOrder = c.orders[0];
  const firstItem = firstOrder?.items[0];
  const articleCount = c.orders.reduce(
    (n, o) => n + o.items.reduce((m, i) => m + i.quantity, 0),
    0,
  );

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
      <Stack.Screen options={{ headerRight: () => <HeaderBadge label={t.checkout.step(2)} /> }} />
      {failure ? (
        <Card style={styles.failure} testID="payment-failed">
          <Text style={styles.failureTitle}>
            {status === 'expired' ? t.payment.expiredTitle : t.payment.failedTitle}
          </Text>
          <Text style={styles.muted}>{failure.failure?.message}</Text>
          <Button label={t.payment.otherOperator} variant="secondary" onPress={tryAgain} />
        </Card>
      ) : null}

      <Card>
        {firstItem ? (
          <View style={styles.product}>
            <View style={styles.productIcon}>
              <PackageIcon color={colors.muted} size={22} strokeWidth={1.8} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.productTitle} numberOfLines={1}>
                {c.orders.length === 1 && firstOrder!.items.length === 1
                  ? firstItem.title
                  : t.common.items(articleCount)}
              </Text>
              <Text style={styles.muted} numberOfLines={1}>
                {c.orders.map((o) => o.seller.shopName).join(', ')} · {t.common.items(articleCount)}
              </Text>
            </View>
          </View>
        ) : null}
        <View style={styles.row}>
          <Text style={styles.label}>{t.payment.items}</Text>
          <Text style={styles.value}>{formatXaf(c.itemsTotal)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>{t.payment.delivery}</Text>
          <Text style={styles.value}>{formatXaf(c.deliveryTotal)}</Text>
        </View>
        <View style={[styles.row, styles.totalRow]}>
          <Text style={styles.totalLabel}>{t.payment.total}</Text>
          <Amount value={c.grandTotal} size="md" />
        </View>
      </Card>

      <Eyebrow>{t.payment.operator}</Eyebrow>
      <View style={styles.operators}>
        {OPERATORS.map((o) => {
          const selected = operator === o.code;
          return (
            <Pressable
              key={o.code}
              onPress={() => setOperator(o.code)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={[styles.operator, selected && styles.operatorSelected]}
              testID={`operator-${o.code}`}
            >
              <Text style={styles.operatorName}>{o.label}</Text>
              <Text
                style={[styles.operatorHint, selected && guessed === o.code && styles.detected]}
              >
                {selected && guessed === o.code
                  ? t.payment.detected(phone.replace(/\D/g, '').replace(/^242/, '').slice(0, 2))
                  : t.payment.numbers[o.code]}
              </Text>
              {selected ? (
                <View style={styles.operatorCheck}>
                  <Check color={colors.onBrand} size={14} strokeWidth={3} />
                </View>
              ) : null}
            </Pressable>
          );
        })}
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
      <GuaranteeCard />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { paddingTop: space.xl },
  success: { alignItems: 'center', gap: space.sm, paddingVertical: space.md },
  successIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  heroTitle: { fontSize: 22, fontWeight: '800', color: colors.text, textAlign: 'center' },
  ref: { fontSize: font.small, color: colors.muted, textAlign: 'center' },
  cardTitle: { fontSize: font.body, fontWeight: '800', color: colors.text },
  moneySteps: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: space.sm },
  moneyStep: { flex: 1, alignItems: 'center', gap: 6 },
  moneyIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moneyIconActive: { backgroundColor: colors.waiting, borderColor: colors.waiting },
  moneyLabel: { fontSize: 12, color: colors.muted, textAlign: 'center', fontWeight: '600' },
  moneyLabelActive: { color: colors.text },
  muted: { fontSize: font.small, color: colors.muted, lineHeight: 19 },
  waiting: { alignItems: 'center', gap: space.sm, paddingVertical: space.md },
  step: { flexDirection: 'row', gap: space.md, alignItems: 'center', paddingVertical: 4 },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberActive: { backgroundColor: colors.brand },
  stepDigit: { fontSize: 13, fontWeight: '700', color: colors.muted },
  stepDigitActive: { color: colors.onBrand },
  stepText: { flex: 1, color: colors.text, fontSize: font.small, lineHeight: 19 },
  help: { fontSize: font.small, color: colors.muted, lineHeight: 20, textAlign: 'center' },
  failure: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  failureTitle: { fontSize: font.body, fontWeight: '800', color: colors.danger },
  product: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'center',
    paddingBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  productIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productTitle: { color: colors.text, fontWeight: '600', fontSize: font.body },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  label: { flex: 1, color: colors.muted, fontSize: font.small },
  value: { color: colors.text, fontSize: font.small },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space.sm,
    alignItems: 'center',
  },
  totalLabel: { fontSize: font.body, fontWeight: '700', color: colors.text },
  operators: { flexDirection: 'row', gap: space.sm },
  operator: {
    flex: 1,
    gap: 4,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  operatorSelected: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  operatorName: { color: colors.text, fontWeight: '700', fontSize: font.body },
  operatorHint: { color: colors.muted, fontSize: 12 },
  detected: { color: colors.brand, fontWeight: '700' },
  operatorCheck: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
