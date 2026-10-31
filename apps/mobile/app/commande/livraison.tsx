import { useQuery } from '@tanstack/react-query';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Check, House, Store } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../src/ui/Text';
import { Badge, Card, HeaderBadge } from '../../src/ui/kit';
import { api, errorMessage, newIdempotencyKey, unwrap } from '../../src/api';
import { useCart } from '../../src/cart';
import { displayPhone, formatXaf, isValidCongoPhone } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { useSession } from '../../src/session';
import { loadJson, saveJson } from '../../src/storage';
import { colors, font, radius, space } from '../../src/theme';
import { Button } from '../../src/ui/Button';
import { Chip, ErrorText, Field } from '../../src/ui/Form';
import { Empty, Loading, Screen } from '../../src/ui/Layout';
import { LocationPicker, type PinnedLocation } from '../../src/ui/LocationPicker';
import { CouponField, type AppliedCoupon } from '../../src/ui/CouponField';

const ADDRESS_KEY = 'zandu.lastAddress';

interface Address {
  zoneId: string | null;
  mode: 'home' | 'pickup_point';
  pickupPointId: string | null;
  recipientName: string;
  phone: string;
  landmark: string;
  /** Repère sur la carte (facultatif, domicile seulement). */
  location?: PinnedLocation | null;
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
  const [remember, setRemember] = useState(true);
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null);
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
        ...(address.mode === 'home' && address.location ? { location: address.location } : {}),
      },
      ...(coupon ? { couponCode: coupon.code } : {}),
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
      await saveJson(ADDRESS_KEY, remember ? address : null);
      cart.removeMany(lines.map((l) => l.productId));
      router.replace(`/paiement/${checkout.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const itemsTotal = lines.reduce((n, l) => n + l.price * l.quantity, 0);
  const summary =
    lines.length === 1
      ? `${lines[0]!.quantity} × ${lines[0]!.title}`
      : t.common.items(lines.reduce((n, l) => n + l.quantity, 0));
  const addLandmark = (word: string) =>
    set({
      landmark: address.landmark.trim()
        ? `${address.landmark.trim()}, ${word.toLowerCase()} `
        : `${word} `,
    });

  return (
    <Screen
      footer={
        <>
          <View style={styles.summary}>
            <Text style={styles.summaryText} numberOfLines={1}>
              {summary} + {t.checkout.plusDelivery}
            </Text>
            <Text style={styles.summaryAmount}>{formatXaf(itemsTotal)}</Text>
          </View>
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
      <Stack.Screen options={{ headerRight: () => <HeaderBadge label={t.checkout.step(1)} /> }} />
      <View style={styles.modes}>
        <ModeCard
          icon={House}
          title={t.checkout.home}
          hint={t.checkout.homeHint}
          selected={address.mode === 'home'}
          onPress={() => set({ mode: 'home' })}
        />
        <ModeCard
          icon={Store}
          title={t.checkout.pickupTitle}
          hint={t.checkout.pickupHint}
          selected={address.mode === 'pickup_point'}
          disabled={!!zone && zone.pickupPoints.length === 0}
          onPress={() => set({ mode: 'pickup_point' })}
        />
      </View>

      <Card>
        <View style={styles.twoCols}>
          <View style={styles.flex}>
            <Field
              label={t.checkout.recipientShort}
              value={address.recipientName}
              onChangeText={(v) => set({ recipientName: v })}
              autoComplete="name"
              testID="checkout-name"
            />
          </View>
          <View style={styles.flex}>
            <Field
              label={t.checkout.phoneShort}
              value={address.phone}
              onChangeText={(v) => set({ phone: v })}
              keyboardType="phone-pad"
              testID="checkout-phone"
            />
          </View>
        </View>

        <Text style={styles.label}>{t.checkout.zone}</Text>
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

        {zone && address.mode === 'pickup_point' ? (
          <View style={styles.wrap}>
            {zone.pickupPoints.map((pp) => (
              <Chip
                key={pp.id}
                label={`${pp.name} — ${pp.landmark}`}
                selected={address.pickupPointId === pp.id}
                onPress={() => set({ pickupPointId: pp.id })}
              />
            ))}
          </View>
        ) : null}

        <Field
          label={t.checkout.landmark}
          value={address.landmark}
          onChangeText={(v) => set({ landmark: v })}
          placeholder={t.checkout.landmarkPlaceholder}
          multiline
          testID="checkout-landmark"
        />
        <View style={styles.wrap}>
          {t.checkout.landmarkChips.map((word) => (
            <Pressable key={word} onPress={() => addLandmark(word)} style={styles.landmarkChip}>
              <Text style={styles.landmarkChipText}>+ {word}</Text>
            </Pressable>
          ))}
        </View>
        {address.mode === 'home' ? (
          <LocationPicker
            value={address.location ?? null}
            onChange={(location) => set({ location })}
          />
        ) : null}
      </Card>

      <CouponField
        value={coupon}
        onChange={setCoupon}
        sellerIds={[...new Set(lines.map((l) => l.sellerId))]}
      />

      <Pressable
        style={styles.remember}
        onPress={() => setRemember(!remember)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: remember }}
      >
        <View style={[styles.checkbox, remember && styles.checkboxOn]}>
          {remember ? <Check color={colors.onBrand} size={16} strokeWidth={3} /> : null}
        </View>
        <Text style={styles.rememberText}>{t.checkout.saveAddress}</Text>
      </Pressable>
    </Screen>
  );
}

/** Carte de choix « À domicile » / « Point relais » (contour citron quand choisie). */
function ModeCard({
  icon: Icon,
  title,
  hint,
  selected,
  disabled,
  onPress,
}: {
  icon: typeof House;
  title: string;
  hint: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      style={[styles.mode, selected && styles.modeSelected, disabled && styles.modeDisabled]}
    >
      <Icon color={selected ? colors.brand : colors.muted} size={22} strokeWidth={1.8} />
      <Text style={styles.modeTitle}>{title}</Text>
      <Text style={styles.modeHint}>{hint}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  modes: { flexDirection: 'row', gap: space.sm },
  mode: {
    flex: 1,
    gap: 4,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  modeSelected: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  modeDisabled: { opacity: 0.4 },
  modeTitle: { color: colors.text, fontWeight: '700', fontSize: font.body, marginTop: 6 },
  modeHint: { color: colors.muted, fontSize: 12 },
  twoCols: { flexDirection: 'row', gap: space.sm },
  label: { fontSize: font.small, fontWeight: '600', color: colors.muted },
  city: { gap: space.sm },
  cityName: { fontSize: 12, fontWeight: '700', color: colors.faint },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  landmarkChip: {
    paddingHorizontal: 14,
    minHeight: 38,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  landmarkChipText: { color: colors.text, fontSize: font.small, fontWeight: '500' },
  remember: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.faint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  rememberText: { flex: 1, color: colors.text, fontSize: font.small },
  summary: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  summaryText: { flex: 1, color: colors.muted, fontSize: 12 },
  summaryAmount: { color: colors.text, fontWeight: '700', fontSize: 12 },
});
