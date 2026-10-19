import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../../src/ui/Text';
import { api, errorMessage, unwrap } from '../../src/api';
import { t } from '../../src/i18n/fr';
import { colors, font, radius, space, touchTarget } from '../../src/theme';
import { Chip } from '../../src/ui/Form';
import { Empty, Failure, Loading } from '../../src/ui/Layout';
import { ProductTile } from '../../src/ui/ProductTile';

type Sort = 'relevance' | 'price_asc' | 'price_desc' | 'newest';
const SORTS: Sort[] = ['relevance', 'price_asc', 'price_desc', 'newest'];

/** Recherche tolérante (accents, fautes de frappe), une requête 300 ms après la dernière frappe. */
export default function SearchScreen() {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('relevance');

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);

  const enabled = query.length >= 2;
  const results = useQuery({
    queryKey: ['products', 'search', query, sort],
    queryFn: async () =>
      unwrap(await api.GET('/v1/products', { params: { query: { q: query, sort, limit: 40 } } }))
        .items,
    enabled,
    placeholderData: keepPreviousData,
  });

  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t.search.placeholder}
          placeholderTextColor={colors.faint}
          autoFocus
          returnKeyType="search"
          style={styles.input}
          accessibilityLabel={t.tabs.search}
          testID="search-input"
        />
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  top: { padding: space.md, gap: space.sm, backgroundColor: colors.surface },
  input: {
    minHeight: touchTarget,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    fontSize: font.body,
    color: colors.text,
  },
  chips: { gap: space.sm },
  list: { padding: space.sm },
});
