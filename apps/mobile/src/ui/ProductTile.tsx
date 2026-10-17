import type { ProductCard } from '@zandu/api-client';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
          <Text style={styles.seller} numberOfLines={1}>
            {product.seller.verified ? `✓ ${t.trust.verified} · ` : ''}
            {product.seller.shopName}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
    margin: space.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  image: { width: '100%', aspectRatio: 1 },
  body: { padding: space.sm, gap: 2 },
  title: { fontSize: font.small, color: colors.text, minHeight: 34 },
  price: { fontSize: font.body, fontWeight: '800', color: colors.text },
  seller: { fontSize: 12, color: colors.trust },
});
