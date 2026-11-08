import { useQuery } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import { ArrowDown, HardHat } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api, errorMessage, newIdempotencyKey, unwrap } from '../src/api';
import { formatXaf } from '../src/format';
import { t } from '../src/i18n/fr';
import { useSession } from '../src/session';
import { colors, font, space } from '../src/theme';
import { Button } from '../src/ui/Button';
import { ErrorText, Field } from '../src/ui/Form';
import { Card, Note } from '../src/ui/kit';
import { Loading, Screen } from '../src/ui/Layout';
import { LocationPicker, type PinnedLocation } from '../src/ui/LocationPicker';
import { Text } from '../src/ui/Text';
import { ZonePicker } from '../src/ui/ZonePicker';

interface Stop {
  zoneId: string | null;
  landmark: string;
  location: PinnedLocation | null;
}
const empty: Stop = { zoneId: null, landmark: '', location: null };
const valid = (s: Stop) => !!s.zoneId && s.landmark.trim().length >= 3 && !!s.location;

/**
 * Moto-taxi : départ (position du téléphone) et arrivée (position ou carte), prix et temps
 * avant de commander, paiement Mobile Money ; la course part aux conducteurs Zandu.
 */
export default function RideScreen() {
  const router = useRouter();
  const { ready, user } = useSession();
  const [from, setFrom] = useState<Stop>(empty);
  const [to, setTo] = useState<Stop>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ key: string; body: string } | null>(null);

  const quote = useQuery({
    queryKey: ['ride-quote', from.location, to.location],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/rides/quote', {
          params: {
            query: {
              fromLat: from.location!.lat,
              fromLng: from.location!.lng,
              toLat: to.location!.lat,
              toLng: to.location!.lng,
            },
          },
        }),
      ),
    enabled: !!from.location && !!to.location,
    retry: false,
  });

  if (!ready) return <Loading />;
  if (!user) return <Redirect href={{ pathname: '/connexion', params: { next: '/moto' } }} />;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const stop = (s: Stop) => ({
      zoneId: s.zoneId!,
      landmark: s.landmark.trim(),
      location: s.location!,
    });
    const body = { pickup: stop(from), destination: stop(to) };
    const serialized = JSON.stringify(body);
    if (attempt.current?.body !== serialized)
      attempt.current = { key: newIdempotencyKey(), body: serialized };
    try {
      const created = unwrap(
        await api.POST('/v1/rides', {
          params: { header: { 'Idempotency-Key': attempt.current.key } },
          body,
        }),
      );
      router.replace(`/paiement/${created.checkoutId}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const q = quote.data;
  return (
    <Screen
      footer={
        <>
          <View style={styles.priceRow}>
            <View>
              <Text style={styles.priceLabel}>{t.ride.price}</Text>
              {q ? (
                <Text style={styles.hint}>
                  {t.ride.trip(
                    (q.distanceMeters / 1000).toFixed(1).replace('.', ','),
                    q.etaMinutes,
                  )}
                </Text>
              ) : null}
            </View>
            <Text style={styles.priceValue} testID="ride-price">
              {q ? formatXaf(q.price) : '—'}
            </Text>
          </View>
          {!from.location || !to.location ? (
            <Text style={styles.hint}>{t.ride.needPins}</Text>
          ) : null}
          <ErrorText message={error ?? (quote.isError ? errorMessage(quote.error) : null)} />
          <Button
            label={q ? t.ride.pay(formatXaf(q.price)) : t.checkout.continue}
            onPress={() => void submit()}
            disabled={!valid(from) || !valid(to) || !q}
            loading={busy}
            testID="ride-continue"
          />
        </>
      }
    >
      <Text style={styles.intro}>{t.ride.intro}</Text>
      <StopCard
        title={t.ride.from}
        pinTitle={t.ride.fromPin}
        pinHint={t.ride.fromPinHint}
        placeholder={t.ride.fromPlaceholder}
        value={from}
        onChange={setFrom}
        prefix="ride-from"
      />
      <View style={styles.arrow}>
        <ArrowDown color={colors.brand} size={22} strokeWidth={2} />
      </View>
      <StopCard
        title={t.ride.to}
        pinTitle={t.ride.toPin}
        pinHint={t.ride.toPinHint}
        placeholder={t.ride.toPlaceholder}
        value={to}
        onChange={setTo}
        start={from.location}
        prefix="ride-to"
      />
      <Note icon={HardHat}>{t.ride.helmet}</Note>
    </Screen>
  );
}

function StopCard({
  title,
  pinTitle,
  pinHint,
  placeholder,
  value,
  onChange,
  start,
  prefix,
}: {
  title: string;
  pinTitle: string;
  pinHint: string;
  placeholder: string;
  value: Stop;
  onChange: (s: Stop) => void;
  start?: PinnedLocation | null;
  prefix: string;
}) {
  const set = (patch: Partial<Stop>) => onChange({ ...value, ...patch });
  return (
    <Card>
      <Text style={styles.cardTitle}>{title}</Text>
      <LocationPicker
        value={value.location}
        onChange={(location) => set({ location })}
        title={pinTitle}
        hint={pinHint}
        start={start ?? null}
        testPrefix={`${prefix}-pin`}
      />
      <ZonePicker
        label={t.ride.zone}
        value={value.zoneId}
        onChange={(zoneId) => set({ zoneId })}
        testPrefix={`${prefix}-zone`}
      />
      <Field
        label={t.ride.landmark}
        value={value.landmark}
        onChangeText={(landmark) => set({ landmark })}
        placeholder={placeholder}
        testID={`${prefix}-landmark`}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  intro: { color: colors.muted, fontSize: font.small, lineHeight: 20 },
  cardTitle: { color: colors.text, fontWeight: '800', fontSize: font.body },
  arrow: { alignItems: 'center', marginVertical: -space.xs },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  priceLabel: { color: colors.muted, fontSize: font.small },
  priceValue: { color: colors.text, fontWeight: '800', fontSize: 20 },
  hint: { color: colors.faint, fontSize: 12 },
});
