import type { ProductCard } from '@zandu/api-client';
import { Link } from 'expo-router';
import { Check } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { formatXaf } from '../format';
import { t } from '../i18n/fr';
import { colors, font, radius, space } from '../theme';
import { ProductImage } from './ProductImage';

/** Carte produit de la grille (2 colonnes sur 360 dp). */
export function ProductTile({ product }: { product: ProductCard }) {
  return (
    <Link href={`/produit/${product.id}`} asChild>
      <Pressable style={styles.card} accessibilityRole="link" testID={`product-${product.id}`}>
        <ProductImage uri={product.coverImage} title={product.title} style={styles.image} />
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={2}>
            {product.title}
          </Text>
          <Text style={styles.price}>{formatXaf(product.price)}</Text>
          <View style={styles.sellerRow}>
            {product.seller.verified ? (
              <>
                <Check color={colors.trust} size={13} strokeWidth={2.5} />
                <Text style={styles.verified}>{t.trust.verified} ·</Text>
              </>
            ) : null}
            <Text style={styles.seller} numberOfLines={1}>
              {product.seller.shopName}
            </Text>
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    margin: space.xs,
    padding: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  image: { width: '100%', aspectRatio: 1, borderRadius: radius.md },
  body: { paddingTop: space.sm, gap: 4 },
  title: { fontSize: font.small, color: colors.text, minHeight: 34, lineHeight: 17 },
  price: { fontSize: font.body, fontWeight: '800', color: colors.text },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  verified: { fontSize: 12, color: colors.trust, fontWeight: '600', flexShrink: 0 },
  seller: { fontSize: 12, color: colors.muted, flexShrink: 1 },
});
