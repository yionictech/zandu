import { useQuery } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';
import { api, unwrap } from '../api';
import { colors, font, space } from '../theme';
import { Chip } from './Form';
import { Loading } from './Layout';
import { Text } from './Text';

const CITIES = ['Pointe-Noire', 'Brazzaville'];

/** Quartiers desservis, groupés par ville (même liste que la livraison d'une commande). */
export function useZones() {
  return useQuery({
    queryKey: ['zones'],
    queryFn: async () => unwrap(await api.GET('/v1/delivery/zones')),
    staleTime: 3_600_000,
  });
}

/** Choix d'un quartier en pastilles, ville par ville. */
export function ZonePicker({
  label,
  value,
  onChange,
  testPrefix,
}: {
  label: string;
  value: string | null;
  onChange: (zoneId: string) => void;
  testPrefix: string;
}) {
  const zones = useZones();
  return (
    <View style={styles.box}>
      <Text style={styles.label}>{label}</Text>
      {zones.isPending ? <Loading /> : null}
      {CITIES.map((city) => (
        <View key={city} style={styles.city}>
          <Text style={styles.cityName}>{city}</Text>
          <View style={styles.wrap}>
            {(zones.data ?? [])
              .filter((z) => z.city === city)
              .map((z) => (
                <Chip
                  key={z.id}
                  label={z.name}
                  selected={value === z.id}
                  onPress={() => onChange(z.id)}
                  testID={`${testPrefix}-${z.name}`}
                />
              ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: space.sm },
  label: { fontSize: font.small, fontWeight: '600', color: colors.muted },
  city: { gap: space.sm },
  cityName: { fontSize: 12, fontWeight: '700', color: colors.faint },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
