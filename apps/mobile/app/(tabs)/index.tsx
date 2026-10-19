import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../src/ui/Text';
import { api, errorMessage, unwrap } from '../../src/api';
import { t } from '../../src/i18n/fr';
import { colors, font, radius, space, touchTarget } from '../../src/theme';
import { Chip } from '../../src/ui/Form';
import { Empty, Failure, Loading } from '../../src/ui/Layout';
import { ProductTile } from '../../src/ui/ProductTile';
import { TrustBanner } from '../../src/ui/Trust';

/** Accueil : découvrir vite (catégories, nouveautés), rassurer tout de suite (séquestre). */
export default function HomeScreen() {
  const router = useRouter();
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: async () => unwrap(await api.GET('/v1/categories')),
    staleTime: 3_600_000,
  });
  const products = useQuery({
    queryKey: ['products', 'home', categoryId],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/products', {
          params: { query: { sort: 'newest', limit: 40, ...(categoryId ? { categoryId } : {}) } },
        }),
      ).items,
  });

  const roots = (categories.data ?? []).filter((c) => !c.parentId);

  return (
    <FlatList
      data={products.data ?? []}
      keyExtractor={(p) => p.id}
      numColumns={2}
      renderItem={({ item }) => <ProductTile product={item} />}
      contentContainerStyle={styles.list}
      refreshing={products.isRefetching}
      onRefresh={() => void products.refetch()}
      ListHeaderComponent={
        <View style={styles.header}>
          <Pressable
            style={styles.search}
            onPress={() => router.push('/recherche')}
            accessibilityRole="search"
          >
            <Text style={styles.searchText}>🔍 {t.home.searchPlaceholder}</Text>
          </Pressable>
          <TrustBanner />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            <Chip
              label={t.home.allCategories}
              selected={categoryId === null}
              onPress={() => setCategoryId(null)}
            />
            {roots.map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                selected={categoryId === c.id}
                onPress={() => setCategoryId(c.id)}
              />
            ))}
          </ScrollView>
          <Text style={styles.sectionTitle}>{t.home.latest}</Text>
        </View>
      }
      ListEmptyComponent={
        products.isPending ? (
          <Loading />
        ) : products.isError ? (
          <Failure message={errorMessage(products.error)} onRetry={() => void products.refetch()} />
        ) : (
          <Empty message={t.home.empty} />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: space.sm, backgroundColor: colors.background, flexGrow: 1 },
  header: { gap: space.md, padding: space.xs, paddingBottom: space.sm },
  search: {
    minHeight: touchTarget,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
  searchText: { color: colors.muted, fontSize: font.body },
  chips: { gap: space.sm, paddingRight: space.md },
  sectionTitle: { fontSize: font.title, fontWeight: '800', color: colors.text },
});
