import { useQuery } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../src/ui/Text';
import { api, errorMessage, newIdempotencyKey, unwrap } from '../../src/api';
import { useCart } from '../../src/cart';
import { displayPhone, formatXaf, isValidCongoPhone } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { useSession } from '../../src/session';
import { loadJson, saveJson } from '../../src/storage';
import { colors, font, space } from '../../src/theme';
import { Button } from '../../src/ui/Button';
import { Chip, ErrorText, Field } from '../../src/ui/Form';
import { Empty, Loading, Screen, Section } from '../../src/ui/Layout';

const ADDRESS_KEY = 'zandu.lastAddress';

interface Address {
  zoneId: string | null;
  mode: 'home' | 'pickup_point';
  pickupPointId: string | null;
  recipientName: string;
  phone: string;
  landmark: string;
}

/** Livraison : adresse par repères, domicile ou point relais. Mémorisée pour la prochaine fois. */
export default function DeliveryScreen() {
  const router = useRouter();
  const { products } = useLocalSearchParams<{ products?: string }>();
  const { ready, user } = useSession();
  const cart = useCart();
  const [address, setAddress] = useState<Address>({
    zoneId: null,
    mode: 'home',
    pickupPointId: null,
    recipientName: '',
    phone: '',
    landmark: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ key: string; body: string } | null>(null);

  const zones = useQuery({
    queryKey: ['zones'],
    queryFn: async () => unwrap(await api.GET('/v1/delivery/zones')),
    staleTime: 3_600_000,
  });

  useEffect(() => {
    void loadJson<Address | null>(ADDRESS_KEY, null).then((saved) => {
      setAddress((a) => saved ?? { ...a, phone: user ? displayPhone(user.phone) : '' });
    });
  }, [user]);

  const selected = products ? products.split(',') : null;
  const lines = useMemo(
    () => cart.lines.filter((l) => !selected || selected.includes(l.productId)),
    [cart.lines, selected],
  );

  if (!ready) return <Loading />;
  if (!user) {
    const next = products ? `/commande/livraison?products=${products}` : '/commande/livraison';
    return <Redirect href={{ pathname: '/connexion', params: { next } }} />;
  }
  if (lines.length === 0)
    return (
      <Empty message={t.cart.empty} action={t.cart.browse} onAction={() => router.replace('/')} />
    );

  const zone = zones.data?.find((z) => z.id === address.zoneId);
  const set = (patch: Partial<Address>) => setAddress((a) => ({ ...a, ...patch }));
  const valid =
    !!address.zoneId &&
    address.recipientName.trim().length >= 2 &&
    isValidCongoPhone(address.phone) &&
    address.landmark.trim().length >= 5 &&
    (address.mode === 'home' || !!address.pickupPointId);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const body = {
      items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
      delivery: {
        mode: address.mode,
        zoneId: address.zoneId!,
        ...(address.mode === 'pickup_point' && address.pickupPointId
          ? { pickupPointId: address.pickupPointId }
          : {}),
        recipientName: address.recipientName.trim(),
        phone: address.phone,
        landmark: address.landmark.trim(),
      },
    };
    // Même clé tant que le contenu ne change pas : un renvoi après coupure ne crée pas de doublon.
    const serialized = JSON.stringify(body);
    if (attempt.current?.body !== serialized)
      attempt.current = { key: newIdempotencyKey(), body: serialized };
    try {
      const checkout = unwrap(
        await api.POST('/v1/checkouts', {
          params: { header: { 'Idempotency-Key': attempt.current.key } },
          body,
        }),
      );
      await saveJson(ADDRESS_KEY, address);
      cart.removeMany(lines.map((l) => l.productId));
      router.replace(`/paiement/${checkout.id}`);
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
            label={t.checkout.continue}
            onPress={() => void submit()}
            disabled={!valid}
            loading={busy}
            testID="checkout-continue"
          />
        </>
      }
    >
      <Section title={t.checkout.zone}>
        {zones.isPending ? <Loading /> : null}
        {['Pointe-Noire', 'Brazzaville'].map((city) => (
          <View key={city} style={styles.city}>
            <Text style={styles.cityName}>{city}</Text>
            <View style={styles.wrap}>
              {(zones.data ?? [])
                .filter((z) => z.city === city)
                .map((z) => (
                  <Chip
                    key={z.id}
                    label={z.name}
                    selected={address.zoneId === z.id}
                    onPress={() => set({ zoneId: z.id, pickupPointId: null })}
                    testID={`zone-${z.name}`}
                  />
                ))}
            </View>
          </View>
        ))}
      </Section>

      {zone ? (
        <Section title={t.checkout.mode}>
          <View style={styles.wrap}>
            <Chip
              label={t.checkout.home}
              selected={address.mode === 'home'}
              onPress={() => set({ mode: 'home' })}
            />
            {zone.pickupPoints.length ? (
              <Chip
                label={t.checkout.pickup}
                selected={address.mode === 'pickup_point'}
                onPress={() => set({ mode: 'pickup_point' })}
              />
            ) : null}
          </View>
          {address.mode === 'pickup_point'
            ? zone.pickupPoints.map((pp) => (
                <Chip
                  key={pp.id}
                  label={`${pp.name} — ${pp.landmark}`}
                  selected={address.pickupPointId === pp.id}
                  onPress={() => set({ pickupPointId: pp.id })}
                />
              ))
            : null}
        </Section>
      ) : null}

      <Section>
        <Field
          label={t.checkout.recipient}
          value={address.recipientName}
          onChangeText={(v) => set({ recipientName: v })}
          autoComplete="name"
          testID="checkout-name"
        />
        <Field
          label={t.checkout.phone}
          value={address.phone}
          onChangeText={(v) => set({ phone: v })}
          keyboardType="phone-pad"
          testID="checkout-phone"
        />
        <Field
          label={t.checkout.landmark}
          value={address.landmark}
          onChangeText={(v) => set({ landmark: v })}
          placeholder={t.checkout.landmarkPlaceholder}
          multiline
          testID="checkout-landmark"
        />
      </Section>

      <Section title={t.payment.summary}>
        {lines.map((l) => (
          <View key={l.productId} style={styles.row}>
            <Text style={styles.item} numberOfLines={1}>
              {l.quantity} × {l.title}
            </Text>
            <Text style={styles.amount}>{formatXaf(l.price * l.quantity)}</Text>
          </View>
        ))}
        <Text style={styles.note}>{t.cart.deliveryNote}</Text>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  city: { gap: space.sm },
  cityName: { fontSize: font.small, fontWeight: '700', color: colors.muted },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  item: { flex: 1, color: colors.text, fontSize: font.small },
  amount: { color: colors.text, fontWeight: '700' },
  note: { fontSize: 12, color: colors.muted },
});
