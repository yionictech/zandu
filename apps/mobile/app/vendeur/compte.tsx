import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Check, Info } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api, errorMessage, unwrap } from '../../src/api';
import { displayPhone, formatRate, isValidCongoPhone, suggestOperator } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { sellerKeys, useShop } from '../../src/seller/queries';
import { CheckRow } from '../../src/seller/ui';
import { colors, font, radius, space } from '../../src/theme';
import { Button } from '../../src/ui/Button';
import { ErrorText, Field } from '../../src/ui/Form';
import { HeaderBadge, Note } from '../../src/ui/kit';
import { Loading, Screen } from '../../src/ui/Layout';
import { RequireRole } from '../../src/ui/RequireRole';
import { Text } from '../../src/ui/Text';

type Operator = 'mtn' | 'airtel';

/** Taux de commission indicatif, pour une catégorie vendue (règles du back-office). */
function useIndicativeRate(categoryId: string | undefined) {
  return useQuery({
    queryKey: ['commission-preview', categoryId, 100_000],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/seller/commission-preview', {
          params: { query: { categoryId: categoryId!, price: 100_000 } },
        }),
      ),
    enabled: !!categoryId,
    staleTime: 3_600_000,
  });
}

function PayoutAccount({ onboarding }: { onboarding: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const shop = useShop();
  const [operator, setOperator] = useState<Operator>('mtn');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [terms, setTerms] = useState(false);
  const [filled, setFilled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rate = useIndicativeRate(shop.data?.soldCategoryIds[0]);

  useEffect(() => {
    if (!shop.data || filled) return;
    setOperator(shop.data.payoutOperator);
    setPhone(displayPhone(shop.data.payoutPhone));
    setName(shop.data.payoutAccountName ?? '');
    setTerms(shop.data.termsAccepted);
    setFilled(true);
  }, [shop.data, filled]);

  if (shop.isPending || !filled) return <Loading />;
  const s = shop.data!;
  const valid = isValidCongoPhone(phone) && name.trim().length >= 2 && terms;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = unwrap(
        await api.PATCH('/v1/seller/shop', {
          body: {
            payoutPhone: phone,
            payoutOperator: operator,
            payoutAccountName: name.trim(),
            ...(s.termsAccepted ? {} : { acceptTerms: true as const }),
          },
        }),
      );
      queryClient.setQueryData(sellerKeys.shop, updated);
      void queryClient.invalidateQueries({ queryKey: ['seller'] });
      if (onboarding) router.replace({ pathname: '/vendeur', params: { sent: '1' } });
      else router.back();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        <>
          <ErrorText message={error} />
          <Button
            label={onboarding ? t.vendor.sendRequest : t.vendor.save}
            onPress={() => void submit()}
            disabled={!valid}
            loading={busy}
            testID="payout-submit"
          />
        </>
      }
    >
      <Stack.Screen
        options={{
          title: onboarding ? t.seller.openTitle : t.vendor.mobileMoneyAccount,
          headerRight: onboarding ? () => <HeaderBadge label={t.vendor.step(3)} /> : undefined,
        }}
      />
      <Text style={styles.title}>{t.vendor.moneyTitle}</Text>
      <Text style={styles.muted}>{t.vendor.moneyIntro}</Text>
      <View style={styles.operators}>
        {(['mtn', 'airtel'] as const).map((op) => {
          const selected = operator === op;
          return (
            <Pressable
              key={op}
              onPress={() => setOperator(op)}
              style={[styles.operator, selected && styles.operatorOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              testID={`payout-operator-${op}`}
            >
              <Text style={styles.operatorName}>{op === 'mtn' ? 'MTN MoMo' : 'Airtel Money'}</Text>
              <Text style={selected ? styles.selected : styles.small}>
                {selected
                  ? t.vendor.selected
                  : op === 'mtn'
                    ? t.vendor.mtnNumbers
                    : t.vendor.airtelNumbers}
              </Text>
              {selected ? (
                <View style={styles.check}>
                  <Check color={colors.onBrand} size={14} strokeWidth={3} />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <Field
        label={t.vendor.mobileMoneyNumber}
        value={phone}
        onChangeText={(value) => {
          setPhone(value);
          const guess = suggestOperator(value);
          if (guess) setOperator(guess);
        }}
        keyboardType="phone-pad"
        testID="payout-phone"
      />
      <Field
        label={t.vendor.accountName}
        value={name}
        onChangeText={setName}
        placeholder="Grâce N."
        maxLength={80}
        testID="payout-name"
      />
      <Note icon={Info} tone="waiting">
        {t.vendor.accountNameHint}
      </Note>
      {s.termsAccepted ? null : (
        <View style={styles.terms}>
          <CheckRow
            label={t.vendor.acceptTerms(rate.data ? formatRate(rate.data.rateBps) : '…')}
            checked={terms}
            onPress={() => setTerms(!terms)}
            testID="payout-terms"
          />
        </View>
      )}
    </Screen>
  );
}

/** Ouvrir ma boutique, étape 3 sur 3 : où recevoir l'argent, conditions vendeur. */
export default function PayoutAccountScreen() {
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  return (
    <RequireRole role="seller">
      <PayoutAccount onboarding={onboarding === '1'} />
    </RequireRole>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.headline, fontWeight: '800', color: colors.text },
  muted: { color: colors.muted, fontSize: font.body, lineHeight: 21 },
  small: { color: colors.muted, fontSize: 12 },
  operators: { flexDirection: 'row', gap: space.sm },
  operator: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: 4,
  },
  operatorOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  operatorName: { color: colors.text, fontWeight: '700', fontSize: font.body },
  selected: { color: colors.brand, fontWeight: '700', fontSize: 12 },
  check: {
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
  terms: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
});
