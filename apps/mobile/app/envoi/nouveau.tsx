import type { components } from '@zandu/api-client';
import { useQuery } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import { ArrowDown, Ban, Package, PackageOpen, ShieldCheck, Truck } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api, errorMessage, newIdempotencyKey, unwrap } from '../../src/api';
import { displayPhone, formatXaf, isValidCongoPhone } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { useSession } from '../../src/session';
import { loadJson, saveJson } from '../../src/storage';
import { colors, font, radius, space } from '../../src/theme';
import { Button } from '../../src/ui/Button';
import { ErrorText, Field } from '../../src/ui/Form';
import { Card, Eyebrow, Note } from '../../src/ui/kit';
import { Loading, Screen } from '../../src/ui/Layout';
import { LocationPicker, type PinnedLocation } from '../../src/ui/LocationPicker';
import { Text } from '../../src/ui/Text';
import { ZonePicker } from '../../src/ui/ZonePicker';

type Size = components['schemas']['ParcelSize'];
const SIZES: Array<{ size: Size; icon: typeof Package }> = [
  { size: 'small', icon: Package },
  { size: 'medium', icon: PackageOpen },
  { size: 'large', icon: Truck },
];
const SENDER_KEY = 'zandu.parcelSender';

interface Place {
  name: string;
  phone: string;
  zoneId: string | null;
  landmark: string;
  location?: PinnedLocation | null;
}
const emptyPlace: Place = { name: '', phone: '', zoneId: null, landmark: '' };
const placeValid = (p: Place) =>
  p.name.trim().length >= 2 &&
  isValidCongoPhone(p.phone) &&
  !!p.zoneId &&
  p.landmark.trim().length >= 5;

/**
 * Envoyer un colis : taille, contenu, chez qui le livreur l'enlève, à qui il le remet. Le prix
 * (tarif entre les deux quartiers + taille) s'affiche dès que les quartiers sont choisis ; on
 * paie ensuite par Mobile Money comme un achat, en séquestre jusqu'à la remise.
 */
export default function NewParcelScreen() {
  const router = useRouter();
  const { ready, user } = useSession();
  const [size, setSize] = useState<Size>('small');
  const [description, setDescription] = useState('');
  const [from, setFrom] = useState<Place>(emptyPlace);
  const [to, setTo] = useState<Place>(emptyPlace);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ key: string; body: string } | null>(null);

  // L'expéditeur, c'est presque toujours moi, au même endroit : prérempli et mémorisé.
  useEffect(() => {
    void loadJson<Place | null>(SENDER_KEY, null).then((saved) =>
      setFrom(
        saved ?? {
          ...emptyPlace,
          name: user?.fullName ?? '',
          phone: user ? displayPhone(user.phone) : '',
        },
      ),
    );
  }, [user]);

  const quote = useQuery({
    queryKey: ['parcel-quote', from.zoneId, to.zoneId, size],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/parcels/quote', {
          params: { query: { fromZoneId: from.zoneId!, toZoneId: to.zoneId!, size } },
        }),
      ),
    enabled: !!from.zoneId && !!to.zoneId,
    retry: false,
  });

  if (!ready) return <Loading />;
  if (!user)
    return <Redirect href={{ pathname: '/connexion', params: { next: '/envoi/nouveau' } }} />;

  const valid =
    description.trim().length >= 2 && placeValid(from) && placeValid(to) && !!quote.data;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const place = (p: Place) => ({
      name: p.name.trim(),
      phone: p.phone,
      zoneId: p.zoneId!,
      landmark: p.landmark.trim(),
      ...(p.location ? { location: p.location } : {}),
    });
    const body = {
      size,
      description: description.trim(),
      pickup: place(from),
      recipient: place(to),
    };
    const serialized = JSON.stringify(body);
    if (attempt.current?.body !== serialized)
      attempt.current = { key: newIdempotencyKey(), body: serialized };
    try {
      const created = unwrap(
        await api.POST('/v1/parcels', {
          params: { header: { 'Idempotency-Key': attempt.current.key } },
          body,
        }),
      );
      await saveJson(SENDER_KEY, { ...from, location: from.location ?? null });
      router.replace(`/paiement/${created.checkoutId}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        <>
          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>{t.parcel.price}</Text>
            <Text style={styles.priceValue} testID="parcel-price">
              {quote.data ? formatXaf(quote.data.price) : '—'}
            </Text>
          </View>
          {!from.zoneId || !to.zoneId ? (
            <Text style={styles.hint}>{t.parcel.choosePlaces}</Text>
          ) : null}
          <ErrorText message={error ?? (quote.isError ? errorMessage(quote.error) : null)} />
          <Button
            label={quote.data ? t.parcel.pay(formatXaf(quote.data.price)) : t.checkout.continue}
            onPress={() => void submit()}
            disabled={!valid}
            loading={busy}
            testID="parcel-continue"
          />
        </>
      }
    >
      <Text style={styles.intro}>{t.parcel.intro}</Text>

      <Eyebrow>{t.parcel.size}</Eyebrow>
      <View style={styles.sizes}>
        {SIZES.map(({ size: s, icon: Icon }) => {
          const selected = s === size;
          return (
            <Pressable
              key={s}
              onPress={() => setSize(s)}
              style={[styles.size, selected && styles.sizeSelected]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              testID={`parcel-size-${s}`}
            >
              <Icon color={selected ? colors.brand : colors.muted} size={22} strokeWidth={1.8} />
              <Text style={styles.sizeLabel}>{t.parcel.sizes[s].label}</Text>
              <Text style={styles.sizeHint}>{t.parcel.sizes[s].hint}</Text>
            </Pressable>
          );
        })}
      </View>
      <Field
        label={t.parcel.description}
        value={description}
        onChangeText={setDescription}
        placeholder={t.parcel.descriptionPlaceholder}
        maxLength={120}
        testID="parcel-description"
      />

      <PlaceCard
        title={t.parcel.from}
        nameLabel={t.parcel.yourName}
        landmarkPlaceholder={t.parcel.landmarkFromPlaceholder}
        value={from}
        onChange={setFrom}
        prefix="parcel-from"
      />
      <View style={styles.arrow}>
        <ArrowDown color={colors.brand} size={22} strokeWidth={2} />
      </View>
      <PlaceCard
        title={t.parcel.to}
        nameLabel={t.parcel.recipientName}
        landmarkPlaceholder={t.parcel.landmarkToPlaceholder}
        value={to}
        onChange={setTo}
        prefix="parcel-to"
      />

      <Note icon={ShieldCheck} tone="brand">
        {t.parcel.priceHint}
      </Note>
      <Note icon={Ban} tone="danger">
        {t.parcel.forbidden}
      </Note>
    </Screen>
  );
}

function PlaceCard({
  title,
  nameLabel,
  landmarkPlaceholder,
  value,
  onChange,
  prefix,
}: {
  title: string;
  nameLabel: string;
  landmarkPlaceholder: string;
  value: Place;
  onChange: (p: Place) => void;
  prefix: string;
}) {
  const set = (patch: Partial<Place>) => onChange({ ...value, ...patch });
  return (
    <Card>
      <Text style={styles.cardTitle}>{title}</Text>
      <View style={styles.twoCols}>
        <View style={styles.flex}>
          <Field
            label={nameLabel}
            value={value.name}
            onChangeText={(v) => set({ name: v })}
            autoComplete="name"
            testID={`${prefix}-name`}
          />
        </View>
        <View style={styles.flex}>
          <Field
            label={t.parcel.phone}
            value={value.phone}
            onChangeText={(v) => set({ phone: v })}
            keyboardType="phone-pad"
            testID={`${prefix}-phone`}
          />
        </View>
      </View>
      <ZonePicker
        label={t.parcel.zone}
        value={value.zoneId}
        onChange={(zoneId) => set({ zoneId })}
        testPrefix={`${prefix}-zone`}
      />
      <Field
        label={t.parcel.landmark}
        value={value.landmark}
        onChangeText={(v) => set({ landmark: v })}
        placeholder={landmarkPlaceholder}
        multiline
        testID={`${prefix}-landmark`}
      />
      <LocationPicker value={value.location ?? null} onChange={(location) => set({ location })} />
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  intro: { color: colors.muted, fontSize: font.small, lineHeight: 20 },
  sizes: { flexDirection: 'row', gap: space.sm },
  size: {
    flex: 1,
    gap: 4,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sizeSelected: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  sizeLabel: { color: colors.text, fontWeight: '700', fontSize: font.body, marginTop: 4 },
  sizeHint: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  cardTitle: { color: colors.text, fontWeight: '800', fontSize: font.body },
  twoCols: { flexDirection: 'row', gap: space.sm },
  arrow: { alignItems: 'center', marginVertical: -space.xs },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  priceLabel: { color: colors.muted, fontSize: font.small },
  priceValue: { color: colors.text, fontWeight: '800', fontSize: 20 },
  hint: { color: colors.faint, fontSize: 12 },
});
