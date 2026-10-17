import { useQuery } from '@tanstack/react-query';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { api, errorMessage, unwrap } from '../../src/api';
import { formatXaf } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { sellerKeys } from '../../src/seller/queries';
import { productStatusColor } from '../../src/status';
import { colors, font, radius, space } from '../../src/theme';
import { useRefetchOnFocus } from '../../src/useRefetchOnFocus';
import { Banner } from '../../src/ui/Banner';
import { Button } from '../../src/ui/Button';
import { Empty, Failure, Loading } from '../../src/ui/Layout';
import { ProductImage } from '../../src/ui/ProductImage';
import { RequireRole } from '../../src/ui/RequireRole';

function SellerProducts() {
  const router = useRouter();
  const { notice } = useLocalSearchParams<{ notice?: 'published' | 'review' }>();
  const [archived, setArchived] = useState(false);
  const products = useQuery({
    queryKey: sellerKeys.products(archived),
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/seller/products', {
          params: { query: archived ? { status: 'archived' } : {} },
        }),
      ).items,
  });
  useRefetchOnFocus(products.refetch);

  if (products.isPending) return <Loading />;
  if (products.isError)
    return (
      <Failure message={errorMessage(products.error)} onRetry={() => void products.refetch()} />
    );

  return (
    <FlatList
      data={products.data}
      keyExtractor={(p) => p.id}
      contentContainerStyle={styles.list}
      refreshing={products.isRefetching}
      onRefresh={() => void products.refetch()}
      ListHeaderComponent={
        <View style={styles.header}>
          {notice ? (
            <Banner
              tone="trust"
              message={notice === 'published' ? t.seller.published : t.seller.sentToReview}
            />
          ) : null}
          {!archived ? (
            <Button
              label={`＋  ${t.seller.actions.addProduct}`}
              onPress={() => router.push('/vendeur/produit/nouveau')}
            />
          ) : null}
        </View>
      }
      ListEmptyComponent={<Empty message={archived ? t.seller.noArchived : t.seller.noProducts} />}
      ListFooterComponent={
        <Button
          label={archived ? t.seller.hideArchived : t.seller.showArchived}
          variant="ghost"
          onPress={() => setArchived(!archived)}
        />
      }
      renderItem={({ item }) => (
        <Link href={`/vendeur/produit/${item.id}`} asChild>
          <Pressable style={styles.card} testID={`seller-product-${item.title}`}>
            <ProductImage uri={item.coverImage} title={item.title} style={styles.image} />
            <View style={styles.info}>
              <Text style={styles.title} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.price}>{formatXaf(item.price)}</Text>
              <View style={styles.row}>
                <Text style={[styles.pill, { color: productStatusColor(item.status) }]}>
                  ● {t.seller.productStatus[item.status]}
                </Text>
                <Text style={[styles.stock, item.stock === 0 && styles.out]}>
                  {item.stock === 0 ? t.seller.outOfStock : t.seller.stockShort(item.stock)}
                </Text>
              </View>
              {item.status === 'rejected' && item.rejectionReason ? (
                <Text style={styles.rejected} numberOfLines={2}>
                  {t.seller.rejectedBecause(item.rejectionReason)}
                </Text>
              ) : null}
            </View>
          </Pressable>
        </Link>
      )}
    />
  );
}

export default function SellerProductsScreen() {
  return (
    <RequireRole role="seller">
      <SellerProducts />
    </RequireRole>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.md, gap: space.sm, paddingBottom: space.xl },
  header: { gap: space.sm, marginBottom: space.sm },
  card: {
    flexDirection: 'row',
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  image: { width: 76, height: 76, borderRadius: radius.sm },
  info: { flex: 1, gap: 2 },
  title: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  price: { color: colors.text, fontWeight: '800' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pill: { fontSize: font.small, fontWeight: '700' },
  stock: { fontSize: font.small, color: colors.muted },
  out: { color: colors.danger, fontWeight: '700' },
  rejected: { color: colors.danger, fontSize: font.small },
});
