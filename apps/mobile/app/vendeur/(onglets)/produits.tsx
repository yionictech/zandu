import type { SellerProductSummary } from '@zandu/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Plus, Search } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { api, errorMessage, unwrap } from '../../../src/api';
import { formatXaf } from '../../../src/format';
import { t } from '../../../src/i18n/fr';
import {
  removeQueued,
  takeBackQueued,
  useOutbox,
  type QueuedProduct,
} from '../../../src/seller/outbox';
import { useSellerProducts } from '../../../src/seller/queries';
import { TabHeader, Toggle } from '../../../src/seller/ui';
import { productStatusColor } from '../../../src/status';
import { colors, font, radius, space } from '../../../src/theme';
import { useRefetchOnFocus } from '../../../src/useRefetchOnFocus';
import { Banner } from '../../../src/ui/Banner';
import { Button } from '../../../src/ui/Button';
import { Chip } from '../../../src/ui/Form';
import { Empty, Failure, Loading } from '../../../src/ui/Layout';
import { ProductImage } from '../../../src/ui/ProductImage';
import { Text, TextInput } from '../../../src/ui/Text';

const FILTERS = ['all', 'online', 'low', 'hidden'] as const;
type Filter = (typeof FILTERS)[number];

const isLow = (p: SellerProductSummary) =>
  p.status === 'published' && p.stock <= p.lowStockThreshold;

function ProductRow({ product }: { product: SellerProductSummary }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: async (online: boolean) =>
      unwrap(
        await api.PATCH('/v1/seller/products/{id}', {
          params: { path: { id: product.id } },
          body: { status: online ? 'published' : 'archived' },
        }),
      ),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['seller'] }),
  });
  const switchable = product.status === 'published' || product.status === 'archived';
  const stock =
    product.stock === 0
      ? t.vendor.soldOut
      : isLow(product)
        ? t.vendor.onlyLeftShort(product.stock)
        : t.vendor.inStock(product.stock);
  return (
    <Pressable
      style={styles.card}
      onPress={() => router.push(`/vendeur/produit/${product.id}`)}
      testID={`seller-product-${product.title}`}
    >
      <ProductImage uri={product.coverImage} title={product.title} style={styles.image} />
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>
          {product.title}
        </Text>
        <Text style={styles.price}>{formatXaf(product.price)}</Text>
        {switchable ? (
          <Text
            style={[styles.stock, (product.stock === 0 || isLow(product)) && styles.stockAlert]}
          >
            {stock}
          </Text>
        ) : (
          <Text style={[styles.state, { color: productStatusColor(product.status) }]}>
            ● {t.seller.productStatus[product.status]}
          </Text>
        )}
        {product.status === 'rejected' && product.rejectionReason ? (
          <Text style={styles.rejected} numberOfLines={2}>
            {t.seller.rejectedBecause(product.rejectionReason)}
          </Text>
        ) : null}
        {toggle.error ? <Text style={styles.rejected}>{errorMessage(toggle.error)}</Text> : null}
      </View>
      {switchable ? (
        <Toggle
          value={toggle.isPending ? !!toggle.variables : product.status === 'published'}
          onChange={(next) => toggle.mutate(next)}
          disabled={toggle.isPending}
          label={product.status === 'published' ? t.vendor.hide : t.vendor.showOnline}
          testID={`product-toggle-${product.title}`}
        />
      ) : null}
    </Pressable>
  );
}

/** Mes produits (maquette) : recherche, filtres, interrupteur « en ligne / masqué ». */
export default function SellerProducts() {
  const router = useRouter();
  const { notice } = useLocalSearchParams<{ notice?: 'published' | 'review' | 'queued' }>();
  const outbox = useOutbox();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const live = useSellerProducts(false);
  const hidden = useSellerProducts(true);
  useRefetchOnFocus(() => {
    void live.refetch();
    void hidden.refetch();
  });

  const all = useMemo(
    () => [...(live.data ?? []), ...(hidden.data ?? [])],
    [live.data, hidden.data],
  );
  const counts = {
    all: all.length,
    online: all.filter((p) => p.status === 'published').length,
    low: all.filter(isLow).length,
    hidden: hidden.data?.length ?? 0,
  };
  const needle = query.trim().toLowerCase();
  const shown = all
    .filter((p) =>
      filter === 'online'
        ? p.status === 'published'
        : filter === 'low'
          ? isLow(p)
          : filter === 'hidden'
            ? p.status === 'archived'
            : true,
    )
    .filter((p) => !needle || p.title.toLowerCase().includes(needle));

  // Fiches en attente d'envoi : visibles même si la liste n'a jamais été chargée (sans réseau).
  if (live.isPending && !outbox.items.length) return <Loading />;
  if (live.isError)
    return <Failure message={errorMessage(live.error)} onRetry={() => void live.refetch()} />;

  return (
    <View style={styles.screen}>
      <TabHeader
        title={t.vendor.myProducts}
        right={
          <Pressable
            style={styles.add}
            onPress={() => router.push('/vendeur/produit/nouveau')}
            accessibilityRole="button"
            accessibilityLabel={t.seller.actions.addProduct}
            testID="products-add"
          >
            <Plus color={colors.onBrand} size={24} strokeWidth={2.4} />
          </Pressable>
        }
      />
      <FlatList
        data={shown}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        refreshing={live.isRefetching}
        onRefresh={() => void live.refetch()}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.search}>
              <Search color={colors.muted} size={18} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder={t.vendor.searchCatalog}
                placeholderTextColor={colors.faint}
                accessibilityLabel={t.vendor.searchCatalog}
              />
            </View>
            <ScrollView
              horizontal
              contentContainerStyle={styles.filters}
              showsHorizontalScrollIndicator={false}
            >
              {FILTERS.map((f) => (
                <Chip
                  key={f}
                  label={t.vendor.productFilters[f](counts[f])}
                  selected={filter === f}
                  onPress={() => setFilter(f)}
                  testID={`products-filter-${f}`}
                />
              ))}
            </ScrollView>
            {notice === 'queued' ? (
              outbox.items.length ? (
                <Banner tone="waiting" message={t.seller.queued} />
              ) : null
            ) : notice ? (
              <Banner
                tone="trust"
                message={notice === 'published' ? t.seller.published : t.seller.sentToReview}
              />
            ) : null}
            {outbox.sent.map((s, i) => (
              <Banner key={i} tone="trust" message={t.seller.outboxSent(s.title)} />
            ))}
            {outbox.items.length ? (
              <View style={styles.outbox} testID="outbox">
                <Text style={styles.outboxTitle}>{t.seller.outboxTitle}</Text>
                {outbox.items.map((item) => (
                  <QueuedCard key={item.id} item={item} />
                ))}
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          live.isPending ? (
            <Loading />
          ) : outbox.items.length ? undefined : (
            <Empty message={filter === 'hidden' ? t.seller.noArchived : t.seller.noProducts} />
          )
        }
        renderItem={({ item }) => <ProductRow product={item} />}
      />
    </View>
  );
}

/** Fiche préparée sans réseau : en attente, en cours d'envoi, ou refusée (à corriger). */
function QueuedCard({ item }: { item: QueuedProduct }) {
  const router = useRouter();
  const fix = async () => {
    const productId = await takeBackQueued(item.id);
    router.push(productId ? `/vendeur/produit/${productId}` : '/vendeur/produit/nouveau');
  };
  return (
    <View style={styles.card} testID={`queued-${item.form.title.trim()}`}>
      <ProductImage
        uri={item.photos[0]?.uri ?? null}
        title={item.form.title}
        style={styles.image}
      />
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>
          {item.form.title.trim()}
        </Text>
        <Text style={styles.price}>{formatXaf(Number(item.form.price))}</Text>
        {item.state === 'failed' ? (
          <>
            <Text style={styles.rejected}>{t.seller.outboxFailed(item.error ?? '')}</Text>
            <View style={styles.buttons}>
              <Button label={t.seller.outboxFix} variant="secondary" onPress={() => void fix()} />
              <Button
                label={t.seller.outboxDelete}
                variant="ghost"
                onPress={() => removeQueued(item.id)}
              />
            </View>
          </>
        ) : (
          <Text style={styles.stock}>
            {item.state === 'sending' ? t.seller.outboxSending : t.seller.outboxWaiting}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  add: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { paddingHorizontal: space.md, gap: space.sm, paddingBottom: space.xl },
  header: { gap: space.sm, marginBottom: space.xs },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    minHeight: 48,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: font.body, paddingVertical: 10 },
  filters: { gap: space.sm },
  outbox: { gap: space.sm },
  outboxTitle: { color: colors.text, fontSize: font.body, fontWeight: '800' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.sm + 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  image: { width: 64, height: 64, borderRadius: radius.md },
  info: { flex: 1, gap: 2 },
  title: { color: colors.text, fontSize: font.body },
  price: { color: colors.text, fontWeight: '800' },
  stock: { fontSize: 12, color: colors.muted },
  stockAlert: { color: colors.danger, fontWeight: '700' },
  state: { fontSize: 12, fontWeight: '700' },
  rejected: { color: colors.danger, fontSize: 12 },
  buttons: { flexDirection: 'row', gap: space.sm },
});
