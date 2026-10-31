import { useQuery } from '@tanstack/react-query';
import { Lightbulb } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api, errorMessage, unwrap } from '../../src/api';
import { groupThousands } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { colors, font, radius, space } from '../../src/theme';
import { Chip } from '../../src/ui/Form';
import { Card, Eyebrow } from '../../src/ui/kit';
import { Failure, Loading, Screen } from '../../src/ui/Layout';
import { RequireRole } from '../../src/ui/RequireRole';
import { Text } from '../../src/ui/Text';

type Period = '7d' | '30d' | '90d';
const PERIODS: Period[] = ['7d', '30d', '90d'];
const BAR_AREA = 120;
const dayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

/**
 * Statistiques de la boutique : vues, commandes, ventes, ventes par semaine, produits les plus
 * vus, réactivité, et trois conseils au plus pour vendre davantage.
 */
export default function SellerStatsScreen() {
  return (
    <RequireRole role="seller">
      <Stats />
    </RequireRole>
  );
}

function Stats() {
  const [period, setPeriod] = useState<Period>('30d');
  const stats = useQuery({
    queryKey: ['seller', 'stats', period],
    queryFn: async () =>
      unwrap(await api.GET('/v1/seller/stats', { params: { query: { period } } })),
  });
  if (stats.isPending) return <Loading />;
  if (stats.isError)
    return <Failure message={errorMessage(stats.error)} onRetry={() => void stats.refetch()} />;
  const s = stats.data;

  return (
    <Screen refreshing={stats.isRefetching} onRefresh={() => void stats.refetch()}>
      <View style={styles.periods}>
        {PERIODS.map((p) => (
          <Chip
            key={p}
            label={t.stats.periods[p]}
            selected={p === period}
            onPress={() => setPeriod(p)}
            testID={`stats-period-${p}`}
          />
        ))}
      </View>

      <View style={styles.tiles}>
        <Tile label={t.stats.views} value={groupThousands(String(s.views))} testID="stats-views" />
        <Tile label={t.stats.orders} value={String(s.orders)} testID="stats-orders" />
      </View>
      <Tile label={t.stats.sales} value={groupThousands(String(s.sales))} brand />
      <Text style={styles.muted}>
        {t.stats.conversion} :{' '}
        {s.conversionPercent === null
          ? t.stats.empty
          : `${String(s.conversionPercent).replace('.', ',')}`}
      </Text>

      <Card>
        <Text style={styles.cardTitle}>{t.stats.weekly}</Text>
        <WeeklyBars weeks={s.weekly} />
      </Card>

      <Card>
        <Text style={styles.cardTitle}>{t.stats.top}</Text>
        {s.topProducts.length === 0 ? <Text style={styles.muted}>{t.stats.empty}</Text> : null}
        {s.topProducts.map((p, i) => (
          <View key={p.productId} style={styles.topRow}>
            <Text style={styles.rank}>{i + 1}</Text>
            <View style={styles.flex}>
              <Text style={styles.body} numberOfLines={1}>
                {p.title}
              </Text>
              <Text style={styles.muted}>{t.stats.topLine(p.views, p.sold)}</Text>
            </View>
          </View>
        ))}
      </Card>

      <Card>
        <Text style={styles.cardTitle}>{t.stats.speed}</Text>
        <Line
          label={t.stats.acceptance}
          value={s.acceptanceRatePercent === null ? t.stats.empty : `${s.acceptanceRatePercent} %`}
        />
        <Line
          label={t.stats.acceptDelay}
          value={
            s.averageAcceptMinutes === null
              ? t.stats.empty
              : t.stats.minutes(s.averageAcceptMinutes)
          }
        />
        <Line
          label={t.stats.prepDelay}
          value={
            s.averagePrepMinutes === null ? t.stats.empty : t.stats.minutes(s.averagePrepMinutes)
          }
        />
      </Card>

      <Card testID="stats-tips">
        <View style={styles.tipHead}>
          <Lightbulb color={colors.brand} size={20} strokeWidth={2} />
          <Text style={styles.cardTitle}>{t.stats.tipsTitle}</Text>
        </View>
        {s.tips.length === 0 ? <Text style={styles.muted}>{t.stats.noTips}</Text> : null}
        {s.tips.map((tip) => (
          <Text key={tip} style={styles.tip}>
            • {t.stats.tips[tip]}
          </Text>
        ))}
      </Card>
    </Screen>
  );
}

function Tile({
  label,
  value,
  brand,
  testID,
}: {
  label: string;
  value: string;
  brand?: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.tile} testID={testID}>
      <Eyebrow>{label}</Eyebrow>
      <Text style={[styles.tileValue, brand && styles.tileBrand]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={styles.lineValue}>{value}</Text>
    </View>
  );
}

/**
 * Ventes des 8 dernières semaines : une série, une couleur, barres fines posées sur la ligne de
 * base. Toucher une barre affiche la semaine et le montant (la semaine en cours par défaut).
 */
function WeeklyBars({
  weeks,
}: {
  weeks: Array<{ weekStart: string; orders: number; sales: number }>;
}) {
  const [selected, setSelected] = useState(weeks.length - 1);
  const max = Math.max(1, ...weeks.map((w) => w.sales));
  const current = weeks[selected];
  return (
    <View>
      {current ? (
        <Text style={styles.chartValue} testID="stats-week-value">
          {dayMonth.format(new Date(`${current.weekStart}T12:00:00Z`))} ·{' '}
          {groupThousands(String(current.sales))} FCFA · {current.orders}{' '}
          {t.stats.orders.toLowerCase()}
        </Text>
      ) : null}
      <View style={styles.bars} accessibilityRole="image">
        {weeks.map((w, i) => (
          <Pressable
            key={w.weekStart}
            onPress={() => setSelected(i)}
            style={styles.barSlot}
            accessibilityLabel={`${w.weekStart} : ${w.sales} FCFA`}
            hitSlop={4}
          >
            <View
              style={[
                styles.bar,
                {
                  height: Math.max(2, Math.round((w.sales / max) * BAR_AREA)),
                  opacity: i === selected ? 1 : 0.55,
                },
              ]}
            />
          </Pressable>
        ))}
      </View>
      <View style={styles.baseline} />
      <View style={styles.axis}>
        <Text style={styles.axisLabel}>
          {weeks[0] ? dayMonth.format(new Date(`${weeks[0].weekStart}T12:00:00Z`)) : ''}
        </Text>
        <Text style={styles.axisLabel}>{t.stats.thisWeek}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  periods: { flexDirection: 'row', gap: space.sm },
  tiles: { flexDirection: 'row', gap: space.sm },
  tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: 4,
  },
  tileValue: { color: colors.text, fontSize: 22, fontWeight: '800' },
  tileBrand: { color: colors.brand },
  muted: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
  body: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  cardTitle: { color: colors.text, fontWeight: '800', fontSize: font.body },
  flex: { flex: 1 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rank: { color: colors.muted, fontWeight: '800', fontSize: font.body, width: 18 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  lineValue: { color: colors.text, fontWeight: '700', fontSize: font.small },
  tipHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tip: { color: colors.text, fontSize: font.small, lineHeight: 20 },
  chartValue: {
    color: colors.text,
    fontSize: font.small,
    fontWeight: '700',
    marginBottom: space.sm,
  },
  bars: { height: BAR_AREA, flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  barSlot: { flex: 1, height: BAR_AREA, justifyContent: 'flex-end', alignItems: 'center' },
  bar: {
    width: '70%',
    maxWidth: 28,
    backgroundColor: colors.brand,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  baseline: { height: 1, backgroundColor: colors.border },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  axisLabel: { color: colors.faint, fontSize: 11 },
});
