import { useQuery } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../src/ui/Text';
import { api, errorCode, errorMessage, unwrap } from '../../src/api';
import { displayPhone, isValidCongoPhone, suggestOperator } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { useSession } from '../../src/session';
import { colors, font, space } from '../../src/theme';
import { Button } from '../../src/ui/Button';
import { Chip, ErrorText, Field } from '../../src/ui/Form';
import { Loading, Screen, Section } from '../../src/ui/Layout';

const CITIES = ['Pointe-Noire', 'Brazzaville'] as const;

/** Ouvrir ma boutique : un seul écran, aucune pièce demandée à ce stade. */
export default function OpenShopScreen() {
  const router = useRouter();
  const { ready, user, refresh } = useSession();
  const [shopName, setShopName] = useState('');
  const [city, setCity] = useState<(typeof CITIES)[number]>('Pointe-Noire');
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [payoutPhone, setPayoutPhone] = useState('');
  const [operator, setOperator] = useState<'mtn' | 'airtel' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const zones = useQuery({
    queryKey: ['zones'],
    queryFn: async () => unwrap(await api.GET('/v1/delivery/zones')),
    staleTime: 3_600_000,
  });

  // Le numéro de connexion est le plus souvent aussi le numéro Mobile Money.
  useEffect(() => {
    if (user && !payoutPhone) {
      setPayoutPhone(displayPhone(user.phone));
      setOperator(suggestOperator(user.phone));
    }
  }, [user, payoutPhone]);

  if (!ready) return <Loading />;
  if (!user)
    return <Redirect href={{ pathname: '/connexion', params: { next: '/vendeur/ouvrir' } }} />;
  if (user.roles.includes('seller')) return <Redirect href="/vendeur" />;

  const valid =
    shopName.trim().length >= 2 && !!zoneId && isValidCongoPhone(payoutPhone) && !!operator;

  const submit = async () => {
    if (!zoneId || !operator) return;
    setBusy(true);
    setError(null);
    try {
      unwrap(
        await api.POST('/v1/seller/shop', {
          body: {
            shopName: shopName.trim(),
            city,
            pickupZoneId: zoneId,
            payoutPhone,
            payoutOperator: operator,
          },
        }),
      );
      await refresh();
      router.replace({ pathname: '/vendeur', params: { created: '1' } });
    } catch (e) {
      // Boutique créée mais réponse perdue (coupure réseau) : on reprend simplement la suite.
      if (errorCode(e) === 'shop_exists') {
        await refresh().catch(() => undefined);
        router.replace('/vendeur');
        return;
      }
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
            label={t.seller.create}
            onPress={() => void submit()}
            disabled={!valid}
            loading={busy}
            testID="shop-create"
          />
        </>
      }
    >
      <Text style={styles.subtitle}>{t.seller.openSubtitle}</Text>
      <Section>
        <Field
          label={t.seller.shopName}
          value={shopName}
          onChangeText={setShopName}
          placeholder={t.seller.shopNamePlaceholder}
          maxLength={80}
          testID="shop-name"
        />
        <Text style={styles.label}>{t.seller.city}</Text>
        <View style={styles.wrap}>
          {CITIES.map((c) => (
            <Chip
              key={c}
              label={c}
              selected={city === c}
              onPress={() => {
                setCity(c);
                setZoneId(null);
              }}
            />
          ))}
        </View>
        <Text style={styles.label}>{t.seller.pickupZone}</Text>
        {zones.isPending ? <Loading /> : null}
        <View style={styles.wrap}>
          {(zones.data ?? [])
            .filter((z) => z.city === city)
            .map((z) => (
              <Chip
                key={z.id}
                label={z.name}
                selected={zoneId === z.id}
                onPress={() => setZoneId(z.id)}
                testID={`shop-zone-${z.name}`}
              />
            ))}
        </View>
      </Section>
      <Section>
        <Field
          label={t.seller.payoutPhone}
          value={payoutPhone}
          onChangeText={(value) => {
            setPayoutPhone(value);
            setOperator(suggestOperator(value) ?? operator);
          }}
          keyboardType="phone-pad"
          testID="shop-payout-phone"
        />
        <Text style={styles.label}>{t.seller.payoutOperator}</Text>
        <View style={styles.wrap}>
          <Chip label="MTN MoMo" selected={operator === 'mtn'} onPress={() => setOperator('mtn')} />
          <Chip
            label="Airtel Money"
            selected={operator === 'airtel'}
            onPress={() => setOperator('airtel')}
          />
        </View>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtitle: { color: colors.muted, fontSize: font.body, lineHeight: 21 },
  label: { fontSize: font.small, fontWeight: '600', color: colors.text, marginTop: space.xs },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
