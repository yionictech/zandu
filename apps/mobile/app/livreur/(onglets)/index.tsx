import { useQuery } from '@tanstack/react-query';
import { Bike, Building2 } from 'lucide-react-native';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { api, errorMessage, unwrap } from '../../../src/api';
import { t } from '../../../src/i18n/fr';
import { MissionCard } from '../../../src/rider/MissionCard';
import { firstName, riderKeys, useRiderMe } from '../../../src/rider/ui';
import { CheckRow, TabHeader } from '../../../src/seller/ui';
import { colors, font, radius, space } from '../../../src/theme';
import { useRefetchOnFocus } from '../../../src/useRefetchOnFocus';
import { Avatar, Card, Eyebrow } from '../../../src/ui/kit';
import { Failure, Loading } from '../../../src/ui/Layout';
import { Text } from '../../../src/ui/Text';

/**
 * Courses du livreur partenaire (maquette « Zandu Livreur ») : la journée en chiffres, les
 * courses attribuées par le support dans l'ordre, et la liste « Avant de partir ».
 */
export default function RiderHome() {
  const me = useRiderMe();
  const missions = useQuery({
    queryKey: riderKeys.missions,
    queryFn: async () => unwrap(await api.GET('/v1/rider/deliveries')).items,
    refetchInterval: 20_000,
  });
  const [ready, setReady] = useState<number[]>([]);
  const refetch = () => {
    void me.refetch();
    void missions.refetch();
  };
  useRefetchOnFocus(refetch);

  if (me.isPending || missions.isPending) return <Loading />;
  if (me.isError || missions.isError)
    return <Failure message={errorMessage(me.error ?? missions.error)} onRetry={refetch} />;
  const r = me.data;
  const name = firstName(r.fullName) || t.rider.appName;

  return (
    <View style={styles.screen}>
      <TabHeader
        title={
          <View style={styles.identity}>
            <Avatar name={r.fullName ?? name} size={44} />
            <View style={styles.flex}>
              <Text style={styles.muted}>{t.rider.hello(name)}</Text>
              <Text style={styles.appName}>{t.rider.appName}</Text>
            </View>
          </View>
        }
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={missions.isRefetching}
            onRefresh={refetch}
            colors={[colors.brand]}
          />
        }
      >
        <View style={styles.partner}>
          <Building2 color={colors.brand} size={16} strokeWidth={1.8} />
          <Text style={styles.partnerText}>{t.rider.partner(r.partnerName)}</Text>
        </View>

        <View style={styles.stats}>
          {(
            [
              [t.rider.today.delivered, r.deliveredToday, t.rider.todaySuffix],
              [t.rider.today.inProgress, r.inProgress, ''],
              [t.rider.today.total, r.deliveredTotal, ''],
            ] as const
          ).map(([label, value, suffix]) => (
            <Card key={label} style={styles.stat}>
              <Eyebrow>{label}</Eyebrow>
              <Text style={styles.statValue} testID={`rider-stat-${label}`}>
                {value}
              </Text>
              {suffix ? <Text style={styles.muted}>{suffix}</Text> : null}
            </Card>
          ))}
        </View>

        <Text style={styles.section}>{t.rider.myCourses}</Text>
        {missions.data.length === 0 ? (
          <Card style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Bike color={colors.brand} size={30} strokeWidth={1.7} />
            </View>
            <Text style={styles.emptyTitle}>{t.rider.empty}</Text>
            <Text style={styles.emptyBody}>{t.rider.emptyBody}</Text>
          </Card>
        ) : (
          missions.data.map((m) => <MissionCard key={m.orderId} mission={m} />)
        )}

        <Card>
          <Text style={styles.cardTitle}>{t.rider.beforeLeaving}</Text>
          {t.rider.beforeLeavingList.map((label, i) => (
            <CheckRow
              key={label}
              label={label}
              checked={ready.includes(i)}
              onPress={() =>
                setReady((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]))
              }
            />
          ))}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: space.md, paddingTop: space.xs, gap: space.md, paddingBottom: space.xl },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1, gap: 2 },
  appName: { fontSize: font.title, fontWeight: '800', color: colors.text },
  muted: { fontSize: font.small, color: colors.muted },
  partner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
    borderWidth: 1,
    borderColor: colors.brandBorder,
  },
  partnerText: { fontSize: font.small, color: colors.brand, fontWeight: '700' },
  stats: { flexDirection: 'row', gap: space.sm },
  stat: { flex: 1, gap: 4, padding: space.md },
  statValue: { fontSize: 24, fontWeight: '800', color: colors.text },
  section: { fontSize: font.title, fontWeight: '800', color: colors.text, marginTop: space.xs },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: font.title, fontWeight: '800', color: colors.text, textAlign: 'center' },
  emptyBody: { fontSize: font.small, color: colors.muted, textAlign: 'center', lineHeight: 19 },
  cardTitle: { fontSize: font.body, fontWeight: '800', color: colors.text, marginBottom: 4 },
});
