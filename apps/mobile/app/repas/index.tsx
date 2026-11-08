import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Clock, Star, UtensilsCrossed } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { api, errorMessage, unwrap } from '../../src/api';
import { t } from '../../src/i18n/fr';
import { useCity } from '../../src/prefs';
import { colors, font, radius, space } from '../../src/theme';
import { Badge } from '../../src/ui/kit';
import { Empty, Failure, Loading, Screen } from '../../src/ui/Layout';
import { ProductImage } from '../../src/ui/ProductImage';
import { Text } from '../../src/ui/Text';

/** Rayon « Repas » : restaurants de la ville, ouverts d'abord, temps de préparation et note. */
export default function RestaurantsScreen() {
  const router = useRouter();
  const [city] = useCity();
  const list = useQuery({
    queryKey: ['restaurants', city],
    queryFn: async () =>
      unwrap(await api.GET('/v1/restaurants', { params: { query: { city } } })).items,
  });
  if (list.isPending) return <Loading />;
  if (list.isError)
    return <Failure message={errorMessage(list.error)} onRetry={() => void list.refetch()} />;
  return (
    <Screen refreshing={list.isRefetching} onRefresh={() => void list.refetch()}>
      <Text style={styles.intro}>{t.food.intro}</Text>
      {list.data.length === 0 ? <Empty message={t.food.none} /> : null}
      {list.data.map((r) => (
        <Pressable
          key={r.id}
          onPress={() => router.push(`/repas/${r.id}`)}
          style={[styles.card, !r.openNow && styles.closed]}
          accessibilityRole="button"
          accessibilityLabel={r.shopName}
          testID={`restaurant-${r.slug}`}
        >
          {r.coverImage ? (
            <ProductImage uri={r.coverImage} title={r.shopName} style={styles.cover} />
          ) : (
            <View style={[styles.cover, styles.coverEmpty]}>
              <UtensilsCrossed color={colors.muted} size={28} />
            </View>
          )}
          <View style={styles.body}>
            <View style={styles.titleRow}>
              <Text style={styles.name} numberOfLines={2}>
                {r.shopName}
              </Text>
              <Badge
                label={r.openNow ? t.food.open : t.food.closed}
                tone={r.openNow ? 'brand' : 'neutral'}
              />
            </View>
            <Text style={styles.meta} numberOfLines={1}>
              {r.zone} · {t.food.dishes(r.dishCount)}
            </Text>
            <View style={styles.row}>
              <Clock color={colors.muted} size={14} />
              <Text style={styles.meta}>{t.food.prep(r.prepMinutes)}</Text>
              {r.ratingAvg ? (
                <>
                  <Star color={colors.brand} fill={colors.brand} size={14} />
                  <Text style={styles.meta}>
                    {r.ratingAvg.toFixed(1).replace('.', ',')} ({r.ratingCount})
                  </Text>
                </>
              ) : null}
            </View>
          </View>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { color: colors.muted, fontSize: font.small, lineHeight: 20 },
  card: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  closed: { opacity: 0.6 },
  cover: { width: 88, height: 88, borderRadius: radius.md },
  coverEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  body: { flex: 1, gap: 4, justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  name: { flex: 1, color: colors.text, fontWeight: '800', fontSize: font.body },
  meta: { color: colors.muted, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
