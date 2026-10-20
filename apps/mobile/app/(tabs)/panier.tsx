import { useRouter } from 'expo-router';
import { Info, Minus, Plus, ShieldCheck } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { useCart, type CartLine } from '../../src/cart';
import { formatXaf } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { colors, font, radius, space } from '../../src/theme';
import { Button } from '../../src/ui/Button';
import { Amount, Avatar, Card, Note } from '../../src/ui/kit';
import { Empty, Screen } from '../../src/ui/Layout';
import { ProductImage } from '../../src/ui/ProductImage';
import { Text } from '../../src/ui/Text';

/** Quantité en pilule « − 1 + » ; à zéro, l'article sort du panier. */
function Stepper({ line }: { line: CartLine }) {
  const { setQuantity } = useCart();
  return (
    <View style={styles.stepper}>
      <Pressable
        style={styles.step}
        onPress={() => setQuantity(line.productId, line.quantity - 1)}
        accessibilityLabel={line.quantity === 1 ? t.cart.remove : 'Moins'}
      >
        <Minus color={colors.text} size={18} />
      </Pressable>
      <Text style={styles.qty}>{line.quantity}</Text>
      <Pressable
        style={styles.step}
        onPress={() => setQuantity(line.productId, line.quantity + 1)}
        disabled={line.quantity >= line.stock}
        accessibilityLabel="Plus"
      >
        <Plus color={line.quantity >= line.stock ? colors.faint : colors.text} size={18} />
      </Pressable>
    </View>
  );
}

/** Panier multi-vendeurs (maquette « Panier ») : un seul paiement, un colis par boutique. */
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
          <View style={styles.protected}>
            <ShieldCheck color={colors.trust} size={15} />
            <Text style={styles.protectedText}>{t.cart.protected}</Text>
          </View>
          <Button
            label={t.cart.checkoutWith(formatXaf(cart.itemsTotal))}
            onPress={() => router.push('/commande/livraison')}
            testID="cart-checkout"
          />
        </>
      }
    >
      {shops.length > 1 ? (
        <Note icon={Info} tone="waiting">
          {t.cart.shops(shops.length)}
        </Note>
      ) : null}
      {shops.map((sellerId) => {
        const lines = cart.lines.filter((l) => l.sellerId === sellerId);
        return (
          <Card key={sellerId}>
            <View style={styles.shopRow}>
              <Avatar name={lines[0]!.shopName} size={36} />
              <Text style={styles.shop} numberOfLines={1}>
                {lines[0]!.shopName}
              </Text>
            </View>
            {lines.map((line) => (
              <View key={line.productId} style={styles.line}>
                <ProductImage uri={line.coverImage} title={line.title} style={styles.thumb} />
                <View style={styles.lineBody}>
                  <Text style={styles.title} numberOfLines={1}>
                    {line.title}
                  </Text>
                  <Amount value={line.price * line.quantity} size="sm" />
                </View>
                <Stepper line={line} />
              </View>
            ))}
          </Card>
        );
      })}
      <Card>
        <View style={styles.row}>
          <Text style={styles.label}>{t.cart.itemsTotal}</Text>
          <Text style={styles.value}>{formatXaf(cart.itemsTotal)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>{t.cart.delivery}</Text>
          <Text style={styles.value}>{t.cart.deliveryNext}</Text>
        </View>
        <View style={[styles.row, styles.totalRow]}>
          <Text style={styles.totalLabel}>{t.cart.total}</Text>
          <Amount value={cart.itemsTotal} size="md" />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  shopRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: 4 },
  shop: { flex: 1, color: colors.text, fontWeight: '700', fontSize: font.body },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 4 },
  thumb: { width: 56, height: 56, borderRadius: radius.md },
  lineBody: { flex: 1, gap: 2 },
  title: { fontSize: font.small, color: colors.text },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  step: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  qty: { minWidth: 20, textAlign: 'center', fontWeight: '700', color: colors.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { color: colors.muted, fontSize: font.small },
  value: { color: colors.text, fontSize: font.small },
  totalRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.sm },
  totalLabel: { color: colors.text, fontWeight: '700', fontSize: font.body },
  protected: { flexDirection: 'row', gap: 6, justifyContent: 'center', alignItems: 'center' },
  protectedText: { color: colors.muted, fontSize: 12 },
});
