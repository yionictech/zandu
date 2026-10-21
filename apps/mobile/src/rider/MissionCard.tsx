import type { RiderMission } from '@zandu/api-client';
import { Link } from 'expo-router';
import { Package, ShieldCheck } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';
import { t } from '../i18n/fr';
import { colors, font, radius, space } from '../theme';
import { Badge } from '../ui/kit';

const STATUS_TONE: Partial<Record<RiderMission['status'], 'brand' | 'waiting' | 'danger'>> = {
  assigned: 'brand',
  picked_up: 'waiting',
  at_pickup_point: 'waiting',
  returning: 'danger',
};

export function missionDestination(m: RiderMission): string {
  return m.destination.pickupPoint
    ? t.seller.pickupPointValue(m.destination.pickupPoint.name)
    : `${m.destination.zone}, ${m.destination.city}`;
}

/** Une course (maquette « Nouvelle course ») : récupérer chez…, livrer à…, déjà payé. */
export function MissionCard({ mission }: { mission: RiderMission }) {
  const landmark = mission.destination.pickupPoint?.landmark ?? mission.recipient.landmark;
  return (
    <Link href={`/livreur/${mission.orderId}`} asChild>
      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
        testID={`mission-${mission.publicRef}`}
      >
        <View style={styles.row}>
          <Text style={styles.ref}>{mission.publicRef}</Text>
          <Badge
            label={t.rider.status[mission.status]}
            tone={STATUS_TONE[mission.status] ?? 'neutral'}
          />
        </View>
        <View style={styles.route}>
          <View style={styles.rail}>
            <View style={[styles.dot, { backgroundColor: colors.brand }]} />
            <View style={styles.line} />
            <View style={[styles.dot, { backgroundColor: colors.danger }]} />
          </View>
          <View style={styles.stops}>
            <View>
              <Text style={[styles.label, { color: colors.brand }]}>
                {t.rider.pickupAt.toUpperCase()}
              </Text>
              <Text style={styles.place}>{mission.pickup.shopName}</Text>
              <Text style={styles.muted}>{mission.pickup.zone}</Text>
            </View>
            <View>
              <Text style={[styles.label, { color: colors.danger }]}>
                {t.rider.deliverTo.toUpperCase()}
              </Text>
              <Text style={styles.place}>{missionDestination(mission)}</Text>
              {landmark ? (
                <Text style={styles.muted} numberOfLines={2}>
                  {landmark}
                </Text>
              ) : null}
            </View>
          </View>
        </View>
        <View style={styles.chips}>
          <View style={styles.chip}>
            <Package color={colors.muted} size={14} strokeWidth={1.8} />
            <Text style={styles.chipText}>{t.common.items(mission.itemCount)}</Text>
          </View>
          <View style={styles.chip}>
            <ShieldCheck color={colors.brand} size={14} strokeWidth={1.8} />
            <Text style={styles.chipText}>{t.rider.prepaid}</Text>
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { backgroundColor: colors.surfaceRaised },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ref: { fontWeight: '800', color: colors.text, letterSpacing: 0.5 },
  route: { flexDirection: 'row', gap: space.md },
  rail: { alignItems: 'center', paddingTop: 4, width: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  line: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 4 },
  stops: { flex: 1, gap: space.md },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  place: { fontSize: font.body, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted, fontSize: font.small, lineHeight: 18 },
  chips: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
  },
  chipText: { fontSize: 12, color: colors.text },
});
