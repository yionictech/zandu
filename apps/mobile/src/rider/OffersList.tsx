import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Bike, Package } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { api, errorMessage, unwrap } from '../api';
import { formatXaf } from '../format';
import { t } from '../i18n/fr';
import { colors, font, space } from '../theme';
import { Button } from '../ui/Button';
import { ErrorText } from '../ui/Form';
import { Badge, Card } from '../ui/kit';
import { Text } from '../ui/Text';
import { riderKeys } from './ui';

/** Courses disponibles (envois, moto-taxis) : le premier livreur qui accepte prend la course. */
export function OffersList() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const offers = useQuery({
    queryKey: ['rider', 'offers'],
    queryFn: async () => unwrap(await api.GET('/v1/rider/offers')).items,
    refetchInterval: 15_000,
  });
  const accept = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.POST('/v1/rider/offers/{id}/accept', { params: { path: { id } } })),
    onSuccess: (mission) => {
      void queryClient.invalidateQueries({ queryKey: riderKeys.missions });
      void queryClient.invalidateQueries({ queryKey: ['rider', 'offers'] });
      router.push(`/livreur/${mission.orderId}`);
    },
    onError: () => void offers.refetch(),
  });
  const items = offers.data ?? [];
  return (
    <View style={styles.box} testID="rider-offers">
      <Text style={styles.section}>{t.offers.title}</Text>
      <Text style={styles.muted}>{t.offers.hint}</Text>
      {items.length === 0 ? (
        <Card>
          <Text style={styles.muted}>{t.offers.none}</Text>
        </Card>
      ) : null}
      <ErrorText message={accept.error ? errorMessage(accept.error) : null} />
      {items.map((o) => (
        <Card key={o.orderId} testID={`offer-${o.publicRef}`}>
          <View style={styles.row}>
            {o.kind === 'ride' ? (
              <Bike color={colors.brand} size={20} />
            ) : (
              <Package color={colors.brand} size={20} />
            )}
            <Badge label={o.kind === 'ride' ? t.offers.ride : t.offers.parcel} tone="brand" />
            <Text style={styles.ref}>{o.publicRef}</Text>
          </View>
          <Text style={styles.route}>
            {o.from} → {o.to}
          </Text>
          {o.pickupLandmark ? <Text style={styles.muted}>{o.pickupLandmark}</Text> : null}
          {o.trip ? (
            <Text style={styles.muted}>
              {t.ride.trip(
                (o.trip.distanceMeters / 1000).toFixed(1).replace('.', ','),
                o.trip.etaMinutes,
              )}
            </Text>
          ) : null}
          <Text style={styles.earning}>{t.offers.earning(formatXaf(o.earning))}</Text>
          <Button
            label={t.offers.accept}
            onPress={() => accept.mutate(o.orderId)}
            loading={accept.isPending && accept.variables === o.orderId}
            testID={`offer-accept-${o.publicRef}`}
          />
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: space.sm },
  section: { fontSize: font.title, fontWeight: '800', color: colors.text },
  muted: { color: colors.muted, fontSize: font.small },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  ref: { color: colors.faint, fontSize: 12, marginLeft: 'auto' },
  route: { color: colors.text, fontWeight: '800', fontSize: font.body },
  earning: { color: colors.brand, fontWeight: '800', fontSize: font.body },
});
