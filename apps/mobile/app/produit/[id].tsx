import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, Heart, Share2, ShoppingCart, Star, Truck } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { FlatList, Share, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, errorMessage, unwrap } from '../../src/api';
import { useCart } from '../../src/cart';
import { SITE_URL } from '../../src/config';
import { formatDate, formatXaf, groupThousands } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { useFavorites } from '../../src/prefs';
import { colors, font, radius, space } from '../../src/theme';
import { Button } from '../../src/ui/Button';
import { Amount, Badge, Card, IconButton } from '../../src/ui/kit';
import { Failure, Loading, Screen } from '../../src/ui/Layout';
import { ProductImage } from '../../src/ui/ProductImage';
import { Text } from '../../src/ui/Text';
import { GuaranteeCard } from '../../src/ui/Trust';

/**
 * Fiche produit (maquette « Fiche produit ») : photos en grand, boutique et badge « Vérifié »,
 * prix, garantie, livraison, avis ; en bas, le panier à côté du bouton principal.
 */
export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cart = useCart();
  const favorites = useFavorites();
  const { width } = useWindowDimensions();
  const [added, setAdded] = useState(false);
  const [page, setPage] = useState(0);

  // Statistiques du vendeur : une vue par ouverture de la fiche.
  useEffect(() => {
    void api.POST('/v1/products/{id}/view', { params: { path: { id } } }).catch(() => undefined);
  }, [id]);
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
  const favorite = favorites.has(p.id);

  const buyNow = () => {
    cart.add(p, 1);
    router.push({ pathname: '/commande/livraison', params: { products: p.id } });
  };
  const share = () =>
    void Share.share({
      message: [
        t.product.shareMessage(p.title, formatXaf(p.price)),
        SITE_URL ? `${SITE_URL}/produit/${p.id}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    }).catch(() => undefined);

  return (
    <Screen
      style={styles.screen}
      footer={
        !p.seller.open ? (
          <Text style={styles.outOfStock}>{t.product.shopClosed}</Text>
        ) : p.stock > 0 ? (
          <View style={styles.actions}>
            <IconButton
              icon={ShoppingCart}
              label={added ? t.product.added : t.product.addToCart}
              active={added}
              onPress={() => {
                cart.add(p, 1);
                setAdded(true);
              }}
              testID="add-to-cart"
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
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.gallery}>
        <FlatList
          data={photos}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(uri, index) => uri ?? `placeholder-${index}`}
          onMomentumScrollEnd={(e) =>
            setPage(Math.round(e.nativeEvent.contentOffset.x / imageWidth))
          }
          renderItem={({ item }) => (
            <ProductImage
              uri={item}
              title={p.title}
              style={{ width: imageWidth, height: imageWidth * 0.86 }}
            />
          )}
        />
        <View style={[styles.overlay, { top: insets.top + space.sm }]}>
          <IconButton icon={ChevronLeft} label="Retour" onPress={() => router.back()} />
          <View style={styles.overlayRight}>
            <IconButton icon={Share2} label={t.product.share} onPress={share} />
            <IconButton
              icon={Heart}
              label={favorite ? t.product.unfavorite : t.product.favorite}
              active={favorite}
              onPress={() =>
                favorites.toggle({
                  id: p.id,
                  title: p.title,
                  price: p.price,
                  coverImage: p.coverImage,
                  shopName: p.seller.shopName,
                })
              }
              testID="product-favorite"
            />
          </View>
        </View>
        {photos.length > 1 ? (
          <View style={styles.dots}>
            {photos.map((_, i) => (
              <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.padded}>
        <View style={styles.shopRow}>
          <Text style={styles.shop}>{p.seller.shopName}</Text>
          {p.seller.verified ? <Badge label={t.trust.verified} tone="brand" /> : null}
          {p.condition !== 'new' ? (
            <Badge label={t.vendor.conditions[p.condition]} tone="waiting" />
          ) : null}
        </View>
        <Text style={styles.title}>{p.title}</Text>
        {p.reviews.count > 0 ? (
          <View style={styles.ratingRow}>
            <Star color={colors.brand} fill={colors.brand} size={16} />
            <Text style={styles.rating}>{p.reviews.average?.toFixed(1).replace('.', ',')}</Text>
            <Text style={styles.ratingCount}>{t.product.verifiedReviews(p.reviews.count)}</Text>
          </View>
        ) : null}
        <View style={styles.priceRow}>
          <Amount value={p.price} size="xl" />
          {p.compareAtPrice && p.compareAtPrice > p.price ? (
            <Text style={styles.compareAt}>{groupThousands(String(p.compareAtPrice))} FCFA</Text>
          ) : null}
        </View>
        {p.stock > 0 && p.stock <= 3 ? (
          <Text style={styles.low}>{t.product.stockLow(p.stock)}</Text>
        ) : null}
      </View>

      <View style={styles.padded}>
        <GuaranteeCard />
      </View>

      <View style={[styles.padded, styles.deliveryRow]}>
        <View style={styles.deliveryIcon}>
          <Truck color={colors.waiting} size={20} strokeWidth={1.8} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.deliveryTitle}>{t.product.deliveryTitle}</Text>
          <Text style={styles.meta}>{t.product.deliveryBody}</Text>
        </View>
      </View>

      {p.description ? (
        <View style={styles.padded}>
          <Card>
            <Text style={styles.sectionTitle}>{t.product.description}</Text>
            <Text style={styles.body}>{p.description}</Text>
          </Card>
        </View>
      ) : null}

      <View style={styles.padded}>
        <Card>
          <Text style={styles.sectionTitle}>{t.product.reviews}</Text>
          {reviews.data?.length ? (
            reviews.data.map((r) => (
              <View key={r.id} style={styles.review}>
                <View style={styles.ratingRow}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      size={14}
                      color={n <= r.rating ? colors.brand : colors.faint}
                      fill={n <= r.rating ? colors.brand : 'transparent'}
                    />
                  ))}
                </View>
                {r.tags.length ? (
                  <View style={styles.tags}>
                    {r.tags.map((tag) => (
                      <Badge key={tag} label={t.reviewTags[tag]} />
                    ))}
                  </View>
                ) : null}
                {r.comment ? <Text style={styles.body}>{r.comment}</Text> : null}
                <Text style={styles.small}>
                  {r.authorName} · {formatDate(r.createdAt)}
                </Text>
                {r.sellerReply ? (
                  <Text style={styles.small}>
                    {t.product.sellerReply(p.seller.shopName)} {r.sellerReply}
                  </Text>
                ) : null}
              </View>
            ))
          ) : (
            <Text style={styles.meta}>{t.product.noReviews}</Text>
          )}
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 0, gap: space.md },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  action: { flex: 1 },
  gallery: { backgroundColor: colors.surface },
  overlay: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  overlayRight: { flexDirection: 'row', gap: space.sm },
  dots: {
    position: 'absolute',
    bottom: space.md,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.faint },
  dotActive: { width: 18, backgroundColor: colors.brand },
  padded: { paddingHorizontal: space.md },
  shopRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  shop: { fontSize: font.small, color: colors.muted, fontWeight: '500' },
  title: { fontSize: 22, fontWeight: '800', color: colors.text, marginTop: 6, lineHeight: 28 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  rating: { color: colors.text, fontWeight: '700', fontSize: font.small },
  ratingCount: {
    color: colors.muted,
    fontSize: font.small,
    textDecorationLine: 'underline',
    marginLeft: 4,
  },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, marginTop: space.sm },
  compareAt: { color: colors.faint, textDecorationLine: 'line-through', fontSize: font.small },
  low: { fontSize: font.small, color: colors.danger, fontWeight: '700', marginTop: 4 },
  deliveryRow: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  deliveryIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deliveryTitle: { color: colors.text, fontWeight: '700', fontSize: font.body },
  meta: { fontSize: font.small, color: colors.muted, lineHeight: 20 },
  sectionTitle: { fontSize: font.body, fontWeight: '800', color: colors.text },
  body: { fontSize: font.body, color: colors.text, lineHeight: 22 },
  review: { gap: 4, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: colors.border },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  small: { fontSize: 12, color: colors.muted },
  outOfStock: { textAlign: 'center', color: colors.danger, fontWeight: '700' },
});
