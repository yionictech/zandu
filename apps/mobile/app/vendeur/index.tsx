import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { errorMessage } from '../../src/api';
import { t } from '../../src/i18n/fr';
import { MoneyTiles } from '../../src/seller/MoneyTiles';
import { SellerOrderCard } from '../../src/seller/OrderCard';
import { useBalance, useSellerOrders, useShop } from '../../src/seller/queries';
import { colors, font, radius, space } from '../../src/theme';
import { useRefetchOnFocus } from '../../src/useRefetchOnFocus';
import { Banner } from '../../src/ui/Banner';
import { Button } from '../../src/ui/Button';
import { Failure, Loading, Screen, Section } from '../../src/ui/Layout';
import { RequireRole } from '../../src/ui/RequireRole';

function Dashboard() {
  const router = useRouter();
  const { created } = useLocalSearchParams<{ created?: string }>();
  const shop = useShop();
  const todo = useSellerOrders('todo');
  const balance = useBalance();
  const refetchAll = () => {
    void shop.refetch();
    void todo.refetch();
    void balance.refetch();
  };
  useRefetchOnFocus(refetchAll);

  if (shop.isPending) return <Loading />;
  if (shop.isError) return <Failure message={errorMessage(shop.error)} onRetry={refetchAll} />;
  const s = shop.data;
  const toAccept = (todo.data ?? []).filter((o) => o.status === 'paid');
  const toPrepare = (todo.data ?? []).filter((o) => o.status === 'preparing');

  const kycBanner = {
    unverified: { message: t.seller.kycBanner, tone: 'brand' as const },
    rejected: { message: t.seller.kycRejectedShort, tone: 'danger' as const },
    pending_review: { message: t.seller.kycPending, tone: 'waiting' as const },
    suspended: { message: t.seller.suspended, tone: 'danger' as const },
    verified: null,
  }[s.verificationStatus];

  return (
    <Screen refreshing={todo.isRefetching} onRefresh={refetchAll}>
      <Stack.Screen options={{ title: s.shopName }} />
      {created ? <Banner message={t.seller.created} tone="trust" /> : null}
      {kycBanner ? (
        <Banner
          message={kycBanner.message}
          tone={kycBanner.tone}
          onPress={() => router.push('/vendeur/verification')}
          testID="kyc-banner"
        />
      ) : (
        <Text style={styles.verified}>✔ {t.seller.verified}</Text>
      )}

      <Section title={t.seller.todo}>
        {todo.isPending ? <Loading /> : null}
        {toAccept.length > 0 ? (
          <Text style={styles.count}>{t.seller.toAccept(toAccept.length)}</Text>
        ) : null}
        {toPrepare.length > 0 ? (
          <Text style={styles.count}>{t.seller.toPrepare(toPrepare.length)}</Text>
        ) : null}
        {todo.data && todo.data.length === 0 ? (
          <Text style={styles.muted}>{t.seller.nothingTodo}</Text>
        ) : null}
        {[...toAccept, ...toPrepare].slice(0, 5).map((order) => (
          <SellerOrderCard key={order.id} order={order} />
        ))}
      </Section>

      {balance.data ? (
        <Pressable onPress={() => router.push('/vendeur/argent')} accessibilityRole="button">
          <MoneyTiles available={balance.data.available} inEscrow={balance.data.inEscrow} />
        </Pressable>
      ) : null}

      <Button
        label={`＋  ${t.seller.actions.addProduct}`}
        onPress={() => router.push('/vendeur/produit/nouveau')}
        testID="dashboard-add-product"
      />
      <View style={styles.grid}>
        {(
          [
            ['products', '/vendeur/produits', '🛍'],
            ['orders', '/vendeur/commandes', '📦'],
            ['money', '/vendeur/argent', '💰'],
            ['verification', '/vendeur/verification', '🪪'],
          ] as const
        ).map(([key, href, icon]) => (
          <Pressable
            key={key}
            style={styles.action}
            onPress={() => router.push(href)}
            accessibilityRole="button"
            testID={`dashboard-${key}`}
          >
            <Text style={styles.actionIcon}>{icon}</Text>
            <Text style={styles.actionLabel}>{t.seller.actions[key]}</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

/** Espace vendeur : d'abord ce qui est à faire, ensuite l'argent, ensuite les outils. */
export default function SellerHome() {
  return (
    <RequireRole role="seller">
      <Dashboard />
    </RequireRole>
  );
}

const styles = StyleSheet.create({
  verified: { color: colors.trust, fontWeight: '800', fontSize: font.body },
  count: { color: colors.text, fontWeight: '700', fontSize: font.body },
  muted: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  action: {
    width: '48.5%',
    minHeight: 76,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionIcon: { fontSize: 22 },
  actionLabel: { fontSize: font.body, fontWeight: '700', color: colors.text },
});
