import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useCart, type CartLine } from '../../src/cart';
import { formatXaf } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { colors, font, space } from '../../src/theme';
import { Button } from '../../src/ui/Button';
import { Empty, Screen, Section } from '../../src/ui/Layout';
import { ProductImage } from '../../src/ui/ProductImage';

function Stepper({ line }: { line: CartLine }) {
  const { setQuantity } = useCart();
  return (
    <View style={styles.stepper}>
      <Pressable
        style={styles.step}
        onPress={() => setQuantity(line.productId, line.quantity - 1)}
        accessibilityLabel="Moins"
      >
        <Text style={styles.stepText}>−</Text>
      </Pressable>
      <Text style={styles.qty}>{line.quantity}</Text>
      <Pressable
        style={styles.step}
        onPress={() => setQuantity(line.productId, line.quantity + 1)}
        disabled={line.quantity >= line.stock}
        accessibilityLabel="Plus"
      >
        <Text style={styles.stepText}>+</Text>
      </Pressable>
    </View>
  );
}

/** Panier multi-vendeurs : un seul paiement, une commande et un suivi par boutique. */
export default function CartScreen() {
  const router = useRouter();
  const cart = useCart();
  if (cart.lines.length === 0) {
    return (
      <Empty message={t.cart.empty} action={t.cart.browse} onAction={() => router.push('/')} />
    );
  }
  const shops = [...new Set(cart.lines.map((l) => l.sellerId))];

  return (
    <Screen
      footer={
        <>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t.cart.itemsTotal}</Text>
            <Text style={styles.total}>{formatXaf(cart.itemsTotal)}</Text>
          </View>
          <Text style={styles.note}>{t.cart.deliveryNote}</Text>
          <Button
            label={t.cart.checkout}
            onPress={() => router.push('/commande/livraison')}
            testID="cart-checkout"
          />
        </>
      }
    >
      {shops.map((sellerId) => {
        const lines = cart.lines.filter((l) => l.sellerId === sellerId);
        return (
          <Section key={sellerId} title={lines[0]!.shopName}>
            {lines.map((line) => (
              <View key={line.productId} style={styles.line}>
                <ProductImage uri={line.coverImage} title={line.title} style={styles.thumb} />
                <View style={styles.lineBody}>
                  <Text style={styles.title} numberOfLines={2}>
                    {line.title}
                  </Text>
                  <Text style={styles.price}>{formatXaf(line.price * line.quantity)}</Text>
                  <View style={styles.lineActions}>
                    <Stepper line={line} />
                    <Pressable onPress={() => cart.remove(line.productId)}>
                      <Text style={styles.remove}>{t.cart.remove}</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
          </Section>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', gap: space.md, paddingVertical: space.xs },
  thumb: { width: 72, height: 72, borderRadius: 8 },
  lineBody: { flex: 1, gap: 4 },
  title: { fontSize: font.small, color: colors.text },
  price: { fontSize: font.body, fontWeight: '800', color: colors.text },
  lineActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
  },
  step: { width: 40, height: 36, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 20, color: colors.brand, fontWeight: '700' },
  qty: { minWidth: 28, textAlign: 'center', fontWeight: '700', color: colors.text },
  remove: { color: colors.muted, textDecorationLine: 'underline', fontSize: font.small },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { fontSize: font.body, color: colors.muted },
  total: { fontSize: font.title, fontWeight: '900', color: colors.text },
  note: { fontSize: 12, color: colors.muted },
});
