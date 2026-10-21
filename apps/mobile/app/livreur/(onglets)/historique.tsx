import { useQuery } from '@tanstack/react-query';
import { Check, Undo2 } from 'lucide-react-native';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { api, errorMessage, unwrap } from '../../../src/api';
import { t } from '../../../src/i18n/fr';
import { riderKeys } from '../../../src/rider/ui';
import { timeOf } from '../../../src/seller/queries';
import { TabHeader } from '../../../src/seller/ui';
import { colors, font, radius, space } from '../../../src/theme';
import { useRefetchOnFocus } from '../../../src/useRefetchOnFocus';
import { Chip } from '../../../src/ui/Form';
import { Card, Eyebrow } from '../../../src/ui/kit';
import { Failure, Loading } from '../../../src/ui/Layout';
import { Text } from '../../../src/ui/Text';

const day = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Brazzaville',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** Historique (maquette) : courses livrées et rapportées, groupées par jour. */
export default function RiderHistory() {
  const [period, setPeriod] = useState<'7d' | '30d'>('7d');
  const history = useQuery({
    queryKey: riderKeys.history(period),
    queryFn: async () =>
      unwrap(await api.GET('/v1/rider/history', { params: { query: { period } } })),
  });
  useRefetchOnFocus(history.refetch);

  const days = new Map<string, NonNullable<typeof history.data>['items']>();
  for (const item of history.data?.items ?? []) {
    const key = day.format(new Date(item.at));
    days.set(key, [...(days.get(key) ?? []), item]);
  }

  return (
    <View style={styles.screen}>
      <TabHeader title={t.rider.historyTitle} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={history.isRefetching}
            onRefresh={() => void history.refetch()}
            colors={[colors.brand]}
          />
        }
      >
        <View style={styles.chips}>
          {(['7d', '30d'] as const).map((p) => (
            <Chip
              key={p}
              label={t.rider.periods[p]}
              selected={period === p}
              onPress={() => setPeriod(p)}
            />
          ))}
        </View>
        {history.isPending ? (
          <Loading />
        ) : history.isError ? (
          <Failure message={errorMessage(history.error)} onRetry={() => void history.refetch()} />
        ) : (
          <>
            <View style={styles.stats}>
              {(
                [
                  [t.rider.historyStats.delivered, String(history.data.delivered)],
                  [t.rider.historyStats.returned, String(history.data.returned)],
                  [
                    t.rider.historyStats.average,
                    history.data.averageMinutes === null
                      ? '—'
                      : t.rider.minutes(history.data.averageMinutes),
                  ],
                ] as const
              ).map(([label, value]) => (
                <Card key={label} style={styles.stat}>
                  <Eyebrow>{label}</Eyebrow>
                  <Text style={styles.statValue}>{value}</Text>
                </Card>
              ))}
            </View>
            {history.data.items.length === 0 ? (
              <Text style={styles.empty}>{t.rider.historyEmpty}</Text>
            ) : null}
            {[...days.entries()].map(([label, items]) => (
              <View key={label} style={styles.day}>
                <Eyebrow>{label}</Eyebrow>
                {items.map((item) => {
                  const ok = item.outcome === 'delivered';
                  return (
                    <Card
                      key={item.orderId}
                      style={styles.row}
                      testID={`history-${item.publicRef}`}
                    >
                      <View style={[styles.icon, !ok && styles.iconReturn]}>
                        {ok ? (
                          <Check color={colors.brand} size={18} strokeWidth={2.2} />
                        ) : (
                          <Undo2 color={colors.danger} size={18} strokeWidth={2} />
                        )}
                      </View>
                      <View style={styles.flex}>
                        <Text style={styles.route} numberOfLines={1}>
                          {item.from} → {item.to}
                        </Text>
                        <Text style={styles.muted} numberOfLines={1}>
                          {[
                            timeOf(item.at),
                            item.publicRef,
                            item.minutes !== null ? t.rider.minutes(item.minutes) : item.reason,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      </View>
                      <Text style={[styles.outcome, !ok && { color: colors.danger }]}>
                        {t.rider.outcome[item.outcome]}
                      </Text>
                    </Card>
                  );
                })}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: space.md, paddingTop: space.xs, gap: space.md, paddingBottom: space.xl },
  chips: { flexDirection: 'row', gap: space.sm },
  stats: { flexDirection: 'row', gap: space.sm },
  stat: { flex: 1, gap: 4 },
  statValue: { fontSize: 19, fontWeight: '800', color: colors.text },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: space.lg },
  day: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconReturn: { backgroundColor: colors.dangerSoft },
  flex: { flex: 1, gap: 2 },
  route: { fontSize: font.body, fontWeight: '700', color: colors.text },
  muted: { fontSize: font.small, color: colors.muted },
  outcome: { fontSize: font.small, fontWeight: '700', color: colors.brand },
});
