import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Clock } from 'lucide-react-native';
import { FlatList, StyleSheet, View } from 'react-native';
import { api, errorMessage, unwrap } from '../../src/api';
import { t } from '../../src/i18n/fr';
import { colors, font, space } from '../../src/theme';
import { Badge, Note } from '../../src/ui/kit';
import { Empty, Failure, Loading } from '../../src/ui/Layout';
import { ProductTile } from '../../src/ui/ProductTile';
import { Text } from '../../src/ui/Text';

/** Menu d'un restaurant : ses plats (toucher un plat pour choisir taille et accompagnement). */
export default function RestaurantMenuScreen() {
  const { sellerId } = useLocalSearchParams<{ sellerId: string }>();
  const restaurants = useQuery({
    queryKey: ['restaurants', 'all'],
    queryFn: async () => unwrap(await api.GET('/v1/restaurants')).items,
  });
  const menu = useQuery({
    queryKey: ['products', 'menu', sellerId],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/products', {
          params: { query: { sellerId, limit: 50, sort: 'newest' } },
        }),
      ).items,
  });
  const r = restaurants.data?.find((x) => x.id === sellerId);
  if (menu.isPending) return <Loading />;
  if (menu.isError)
    return <Failure message={errorMessage(menu.error)} onRetry={() => void menu.refetch()} />;
  return (
    <FlatList
      data={menu.data}
      keyExtractor={(p) => p.id}
      numColumns={2}
      renderItem={({ item }) => <ProductTile product={item} />}
      contentContainerStyle={styles.list}
      refreshing={menu.isRefetching}
      onRefresh={() => void menu.refetch()}
      ListHeaderComponent={
        <View style={styles.header}>
          <Stack.Screen options={{ title: r?.shopName ?? t.food.menu }} />
          {r ? (
            <>
              <View style={styles.row}>
                <Badge
                  label={r.openNow ? t.food.open : t.food.closed}
                  tone={r.openNow ? 'brand' : 'neutral'}
                />
                <Clock color={colors.muted} size={14} />
                <Text style={styles.meta}>{t.food.prep(r.prepMinutes)}</Text>
              </View>
              {r.openingHours ? <Text style={styles.meta}>{r.openingHours}</Text> : null}
              {!r.openNow ? (
                <Note icon={Clock} tone="waiting">
                  {t.food.closedNow}
                </Note>
              ) : null}
            </>
          ) : null}
          <Text style={styles.title}>{t.food.menu}</Text>
        </View>
      }
      ListEmptyComponent={<Empty message={t.food.none} />}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: space.sm, backgroundColor: colors.background, flexGrow: 1 },
  header: { gap: space.sm, padding: space.xs, paddingBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { color: colors.muted, fontSize: font.small },
  title: { color: colors.text, fontWeight: '800', fontSize: font.title },
});
