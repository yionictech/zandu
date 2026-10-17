import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { api, errorMessage, unwrap } from '../../src/api';
import { useCart } from '../../src/cart';
import { formatDate, formatXaf } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { colors, font, space } from '../../src/theme';
import { Button } from '../../src/ui/Button';
import { Failure, Loading, Screen, Section } from '../../src/ui/Layout';
import { ProductImage } from '../../src/ui/ProductImage';
import { GuaranteeCard } from '../../src/ui/Trust';

/** Fiche produit : photos, prix, promesse, garantie, vendeur, avis — et un seul bouton principal. */
export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const cart = useCart();
  const { width } = useWindowDimensions();
  const [added, setAdded] = useState(false);

  const product = useQuery({
    queryKey: ['product', id],
    queryFn: async () => unwrap(await api.GET('/v1/products/{id}', { params: { path: { id } } })),
  });
  const reviews = useQuery({
    queryKey: ['product', id, 'reviews'],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/products/{id}/reviews', {
          params: { path: { id }, query: { limit: 5 } },
        }),
      ).items,
  });

  if (product.isPending) return <Loading />;
  if (product.isError)
    return <Failure message={errorMessage(product.error)} onRetry={() => void product.refetch()} />;
  const p = product.data;
  const photos = p.media.length ? p.media.map((m) => m.url) : [null];
  const imageWidth = Math.min(width, 640);

  const buyNow = () => {
    cart.add(p, 1);
    router.push({ pathname: '/commande/livraison', params: { products: p.id } });
  };

  return (
    <Screen
      style={styles.screen}
      footer={
        p.stock > 0 ? (
          // Côte à côte : sur un écran de 360 dp, la fiche reste visible au-dessus.
          <View style={styles.actions}>
            <Button
              label={added ? `✓ ${t.product.added}` : t.product.addToCart}
              variant="secondary"
              style={styles.action}
              onPress={() => {
                cart.add(p, 1);
                setAdded(true);
              }}
            />
            <Button
              label={t.product.buyNow}
              onPress={buyNow}
              style={styles.action}
              testID="buy-now"
            />
          </View>
        ) : (
          <Text style={styles.outOfStock}>{t.product.outOfStock}</Text>
        )
      }
    >
      <Stack.Screen options={{ title: p.seller.shopName }} />
      <FlatList
        data={photos}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(uri, index) => uri ?? `placeholder-${index}`}
        renderItem={({ item }) => (
          <ProductImage
            uri={item}
            title={p.title}
            style={{ width: imageWidth, height: imageWidth }}
          />
        )}
      />
      <View style={styles.padded}>
        <Text style={styles.title}>{p.title}</Text>
        <Text style={styles.price}>{formatXaf(p.price)}</Text>
        {p.reviews.count > 0 ? (
          <Text style={styles.meta}>
            ★ {p.reviews.average?.toFixed(1)} · {t.product.verifiedReviews(p.reviews.count)}
          </Text>
        ) : null}
        {p.stock > 0 && p.stock <= 3 ? (
          <Text style={styles.low}>{t.product.stockLow(p.stock)}</Text>
        ) : null}
        <Text style={styles.meta}>🚚 {t.product.delivery}</Text>
      </View>

      <View style={styles.padded}>
        <GuaranteeCard />
      </View>

      <View style={styles.padded}>
        <Section>
          <Text style={styles.shop}>
            {p.seller.shopName}{' '}
            {p.seller.verified ? <Text style={styles.verified}> ✓ {t.trust.verified}</Text> : null}
          </Text>
          <Text style={styles.meta}>
            {p.seller.ratingAvg !== null
              ? t.product.sellerRating(p.seller.ratingAvg.toFixed(1), p.seller.ratingCount)
              : t.product.noRating}{' '}
            · {p.city}
          </Text>
        </Section>
      </View>

      {p.description ? (
        <View style={styles.padded}>
          <Section title={t.product.description}>
            <Text style={styles.body}>{p.description}</Text>
          </Section>
        </View>
      ) : null}

      <View style={styles.padded}>
        <Section title={t.product.reviews}>
          {reviews.data?.length ? (
            reviews.data.map((r) => (
              <View key={r.id} style={styles.review}>
                <Text style={styles.stars}>
                  {'★'.repeat(r.rating)}
                  {'☆'.repeat(5 - r.rating)}
                </Text>
                {r.comment ? <Text style={styles.body}>{r.comment}</Text> : null}
                <Text style={styles.small}>
                  {r.authorName} · {formatDate(r.createdAt)}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.meta}>{t.product.noReviews}</Text>
          )}
        </Section>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 0, gap: space.md },
  actions: { flexDirection: 'row', gap: space.sm },
  action: { flex: 1 },
  padded: { paddingHorizontal: space.md },
  title: { fontSize: font.title, fontWeight: '700', color: colors.text },
  price: { fontSize: font.amount - 4, fontWeight: '900', color: colors.text, marginVertical: 4 },
  meta: { fontSize: font.small, color: colors.muted, lineHeight: 20 },
  low: { fontSize: font.small, color: colors.waiting, fontWeight: '700' },
  shop: { fontSize: font.body, fontWeight: '800', color: colors.text },
  verified: { color: colors.trust, fontSize: font.small },
  body: { fontSize: font.body, color: colors.text, lineHeight: 22 },
  review: { gap: 2, paddingVertical: space.xs, borderTopWidth: 1, borderTopColor: colors.border },
  stars: { color: colors.waiting, fontSize: font.body },
  small: { fontSize: 12, color: colors.muted },
  outOfStock: { textAlign: 'center', color: colors.danger, fontWeight: '700' },
});
