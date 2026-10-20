import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  Bell,
  ChevronDown,
  LayoutGrid,
  Laptop,
  MapPin,
  Search,
  Shirt,
  ShoppingBasket,
  Smartphone,
  Sofa,
  Sparkles,
  type LucideIcon,
} from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, errorMessage, unwrap } from '../../src/api';
import { t } from '../../src/i18n/fr';
import { CITIES, useCity } from '../../src/prefs';
import { useSession } from '../../src/session';
import { colors, font, radius, space, touchTarget } from '../../src/theme';
import { IconButton } from '../../src/ui/kit';
import { Empty, Failure, Loading } from '../../src/ui/Layout';
import { ProductTile } from '../../src/ui/ProductTile';
import { Text } from '../../src/ui/Text';
import { TrustBanner } from '../../src/ui/Trust';
import { useInbox } from '../../src/inbox';

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  electronique: Smartphone,
  telephones: Smartphone,
  informatique: Laptop,
  mode: Shirt,
  beaute: Sparkles,
  maison: Sofa,
  alimentation: ShoppingBasket,
};

/** Tuile de catégorie : icône dans un carré arrondi, nom dessous (maquette « Accueil »). */
function CategoryTile({
  label,
  icon: Icon,
  selected,
  onPress,
}: {
  label: string;
  icon: LucideIcon;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.category}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <View style={[styles.categoryIcon, selected && styles.categoryIconSelected]}>
        <Icon color={selected ? colors.onBrand : colors.brand} size={24} strokeWidth={1.7} />
      </View>
      <Text
        style={[styles.categoryLabel, selected && styles.categoryLabelSelected]}
        numberOfLines={2}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Accueil : ville de livraison, recherche, garantie, catégories, nouveautés. */
export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const inbox = useInbox(!!user);
  const [city, setCity] = useCity();
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: async () => unwrap(await api.GET('/v1/categories')),
    staleTime: 3_600_000,
  });
  const products = useQuery({
    queryKey: ['products', 'home', categoryId, city],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/products', {
          params: {
            query: { sort: 'newest', limit: 40, city, ...(categoryId ? { categoryId } : {}) },
          },
        }),
      ).items,
  });

  const roots = (categories.data ?? []).filter((c) => !c.parentId);
  const nextCity = () => setCity(CITIES[(CITIES.indexOf(city) + 1) % CITIES.length]!);

  return (
    <FlatList
      data={products.data ?? []}
      keyExtractor={(p) => p.id}
      numColumns={2}
      renderItem={({ item }) => <ProductTile product={item} />}
      contentContainerStyle={[styles.list, { paddingTop: insets.top + space.sm }]}
      refreshing={products.isRefetching}
      onRefresh={() => void products.refetch()}
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.topRow}>
            <Text style={styles.logo} accessibilityRole="header">
              zandu<Text style={styles.logoDot}>.</Text>
            </Text>
            <Pressable
              style={styles.city}
              onPress={nextCity}
              accessibilityRole="button"
              accessibilityLabel={`${t.home.city} : ${city}`}
              testID="home-city"
            >
              <MapPin color={colors.brand} size={16} strokeWidth={2} />
              <Text style={styles.cityText}>{city}</Text>
              <ChevronDown color={colors.muted} size={16} />
            </Pressable>
            <IconButton
              icon={Bell}
              label={t.home.notifications}
              dot={(inbox.data?.unread ?? 0) > 0}
              onPress={() => router.push(user ? '/notifications' : '/connexion')}
              testID="home-notifications"
            />
          </View>
          <Pressable
            style={styles.search}
            onPress={() => router.push('/recherche')}
            accessibilityRole="search"
          >
            <Search color={colors.muted} size={20} strokeWidth={1.8} />
            <Text style={styles.searchText}>{t.home.searchPlaceholder}</Text>
          </Pressable>
          <TrustBanner />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categories}
          >
            <CategoryTile
              label={t.home.allCategories}
              icon={LayoutGrid}
              selected={categoryId === null}
              onPress={() => setCategoryId(null)}
            />
            {roots.map((c) => (
              <CategoryTile
                key={c.id}
                label={c.name.split(' et ')[0]!}
                icon={CATEGORY_ICONS[c.slug] ?? LayoutGrid}
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
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  logo: { flex: 1, fontSize: 26, fontWeight: '800', color: colors.text },
  logoDot: { color: colors.brand, fontWeight: '800', fontSize: 26 },
  city: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cityText: { color: colors.text, fontWeight: '600', fontSize: font.small },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: Math.max(touchTarget, 52),
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
  },
  searchText: { color: colors.faint, fontSize: font.body, flex: 1 },
  categories: { gap: space.md, paddingRight: space.md },
  category: { width: 76, alignItems: 'center', gap: 6 },
  categoryIcon: {
    width: 60,
    height: 60,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryIconSelected: { backgroundColor: colors.brand, borderColor: colors.brand },
  categoryLabel: { fontSize: 11, color: colors.muted, textAlign: 'center', fontWeight: '500' },
  categoryLabelSelected: { color: colors.text, fontWeight: '700' },
  sectionTitle: { fontSize: font.title, fontWeight: '800', color: colors.text },
});
