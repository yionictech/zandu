import type { RiderMission } from '@zandu/api-client';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n/fr';
import { colors, font, radius, space } from '../theme';

const STATUS_COLORS: Partial<Record<RiderMission['status'], string>> = {
  assigned: colors.brand,
  picked_up: colors.waiting,
  at_pickup_point: colors.waiting,
  delivered: colors.trust,
};

export function missionDestination(m: RiderMission): string {
  return m.destination.pickupPoint
    ? t.seller.pickupPointValue(m.destination.pickupPoint.name)
    : `${m.destination.zone}, ${m.destination.city}`;
}

/** Une mission : d'où, vers où, combien de colis. Le prochain geste se lit à la couleur. */
export function MissionCard({ mission }: { mission: RiderMission }) {
  return (
    <Link href={`/livreur/${mission.orderId}`} asChild>
      <Pressable style={styles.card} testID={`mission-${mission.publicRef}`}>
        <View style={styles.row}>
          <Text style={styles.ref}>{mission.publicRef}</Text>
          <Text style={[styles.status, { color: STATUS_COLORS[mission.status] ?? colors.muted }]}>
            {t.rider.status[mission.status]}
          </Text>
        </View>
        <Text style={styles.line}>
          <Text style={styles.label}>{t.rider.pickupAt} </Text>
          {mission.pickup.shopName} · {mission.pickup.zone}
        </Text>
        <Text style={styles.line}>
          <Text style={styles.label}>{t.rider.deliverTo} </Text>
          {missionDestination(mission)}
        </Text>
        <Text style={styles.muted}>{t.common.items(mission.itemCount)}</Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ref: { fontWeight: '800', color: colors.text, letterSpacing: 0.5 },
  status: { fontWeight: '800', fontSize: font.small },
  line: { color: colors.text, fontSize: font.body },
  label: { color: colors.muted, fontSize: font.small },
  muted: { color: colors.muted, fontSize: font.small },
});
