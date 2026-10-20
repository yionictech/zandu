import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, errorMessage, unwrap } from '../../src/api';
import { t } from '../../src/i18n/fr';
import { useCity } from '../../src/prefs';
import { colors, font, radius, space, touchTarget } from '../../src/theme';
import { Chip } from '../../src/ui/Form';
import { Empty, Failure, Loading } from '../../src/ui/Layout';
import { ProductTile } from '../../src/ui/ProductTile';
import { Text, TextInput } from '../../src/ui/Text';

type Sort = 'relevance' | 'price_asc' | 'price_desc' | 'newest';
const SORTS: Sort[] = ['relevance', 'price_asc', 'price_desc', 'newest'];

/**
 * Recherche tolérante (accents, fautes de frappe), une requête 300 ms après la dernière frappe ;
 * tri et filtres « Livrable à … » et « Vendeur vérifié » (maquette « Recherche »).
 */
export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const [city] = useCity();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('relevance');
  const [inCity, setInCity] = useState(true);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);

  const enabled = query.length >= 2;
  const results = useQuery({
    queryKey: ['products', 'search', query, sort, inCity ? city : null, verified],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/products', {
          params: {
            query: {
              q: query,
              sort,
              limit: 40,
              ...(inCity ? { city } : {}),
              ...(verified ? { verified: true } : {}),
            },
          },
        }),
      ).items,
    enabled,
    placeholderData: keepPreviousData,
  });

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.sm }]}>
      <View style={styles.top}>
        <View style={[styles.field, text !== '' && styles.fieldActive]}>
          <Search color={colors.muted} size={20} strokeWidth={1.8} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t.search.placeholder}
            autoFocus
            returnKeyType="search"
            style={styles.input}
            accessibilityLabel={t.tabs.search}
            testID="search-input"
          />
          {text ? (
            <Pressable onPress={() => setText('')} accessibilityLabel={t.search.clear} hitSlop={10}>
              <X color={colors.muted} size={18} />
            </Pressable>
          ) : null}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {SORTS.map((s) => (
            <Chip
              key={s}
              label={t.search.sort[s]}
              selected={sort === s}
              onPress={() => setSort(s)}
            />
          ))}
        </ScrollView>
        <View style={styles.filters}>
          <Filter
            label={t.search.deliverableIn(city)}
            on={inCity}
            onPress={() => setInCity(!inCity)}
          />
          <Filter
            label={t.search.verifiedOnly}
            on={verified}
            onPress={() => setVerified(!verified)}
          />
        </View>
        {enabled && results.data ? (
          <Text style={styles.count}>
            {t.search.resultsFor} <Text style={styles.query}>{query}</Text> ·{' '}
            {t.search.count(results.data.length)}
          </Text>
        ) : null}
      </View>
      {!enabled ? (
        <Empty message={t.search.hint} />
      ) : results.isPending ? (
        <Loading />
      ) : results.isError ? (
        <Failure message={errorMessage(results.error)} onRetry={() => void results.refetch()} />
      ) : (
        <FlatList
          data={results.data}
          keyExtractor={(p) => p.id}
          numColumns={2}
          renderItem={({ item }) => <ProductTile product={item} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Empty message={t.search.noResult} />}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </View>
  );
}

/** Filtre activable : contour citron et croix quand il est actif. */
function Filter({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      style={[styles.filter, on && styles.filterOn]}
    >
      <Text style={[styles.filterText, on && styles.filterTextOn]}>{label}</Text>
      {on ? <X color={colors.brand} size={14} strokeWidth={2.5} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  top: { paddingHorizontal: space.md, paddingBottom: space.sm, gap: space.sm },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: Math.max(touchTarget, 52),
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
  },
  fieldActive: { borderColor: colors.brand },
  input: { flex: 1, fontSize: font.body, minHeight: 48 },
  chips: { gap: space.sm },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterOn: { borderColor: colors.brandBorder, backgroundColor: colors.brandSoft },
  filterText: { color: colors.text, fontSize: font.small, fontWeight: '600' },
  filterTextOn: { color: colors.brand },
  count: { color: colors.muted, fontSize: font.small },
  query: { color: colors.text, fontWeight: '700' },
  list: { padding: space.sm },
});
