import type { Order } from '@zandu/api-client';
import { useQuery } from '@tanstack/react-query';
import { Link, useRouter } from 'expo-router';
import { Check, Package as PackageIcon } from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { api, errorMessage, unwrap } from '../../src/api';
import { useCart } from '../../src/cart';
import { formatDateTime, formatXaf } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { useSession } from '../../src/session';
import { orderProgress, statusColor } from '../../src/status';
import { colors, font, radius, space } from '../../src/theme';
import { Chip } from '../../src/ui/Form';
import { Empty, Failure, Loading } from '../../src/ui/Layout';
import { Text } from '../../src/ui/Text';

const FINISHED = ['delivered', 'completed', 'refunded', 'cancelled'];

/** « Racheter » : les articles reviennent dans le panier, au prix et au stock du moment. */
function BuyAgain({ order }: { order: Order }) {
  const cart = useCart();
  const [done, setDone] = useState(false);
  const again = async () => {
    for (const item of order.items) {
      const product = await api
        .GET('/v1/products/{id}', { params: { path: { id: item.productId } } })
        .then(unwrap)
        .catch(() => null);
      if (product && product.stock > 0) cart.add(product, item.quantity);
    }
    setDone(true);
  };
  return (
    <Pressable
      onPress={() => void again()}
      style={styles.again}
      accessibilityRole="button"
      disabled={done}
    >
      <Text style={styles.againText}>{done ? t.orders.addedAgain : t.orders.buyAgain}</Text>
    </Pressable>
  );
}

function OrderCard({ order }: { order: Order }) {
  const finished = FINISHED.includes(order.status);
  const title = order.items.map((i) => i.title).join(', ');
  const color = statusColor(order.status);
  return (
    <Link href={`/commande/${order.id}`} asChild>
      <Pressable
        // Link asChild transmet le style tel quel au DOM sur le web : un objet, pas un tableau.
        style={StyleSheet.flatten([styles.card, !finished && styles.cardActive])}
        testID={`order-${order.publicRef}`}
      >
        <View style={styles.row}>
          <Text style={styles.ref}>{order.publicRef}</Text>
          {finished ? (
            <Text style={styles.date}>{formatDateTime(order.createdAt)}</Text>
          ) : (
            <View style={[styles.badge, { backgroundColor: color }]}>
              <Text style={styles.badgeText}>{t.statusShort[order.status]}</Text>
            </View>
          )}
        </View>
        <View style={styles.body}>
          {!finished ? (
            <View style={styles.thumb}>
              <PackageIcon color={colors.muted} size={22} strokeWidth={1.8} />
            </View>
          ) : null}
          <View style={styles.flex}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            {!finished ? (
              <Text style={styles.small} numberOfLines={1}>
                {t.status[order.status]}
              </Text>
            ) : null}
          </View>
          <Text style={styles.amount}>{formatXaf(order.total)}</Text>
        </View>
        {finished ? (
          <View style={styles.row}>
            <View style={styles.doneRow}>
              {order.status === 'completed' || order.status === 'delivered' ? (
                <Check color={colors.trust} size={14} strokeWidth={2.5} />
              ) : null}
              <Text style={[styles.doneText, { color }]}>
                {t.statusShort[order.status]}
                {order.items.every((i) => i.reviewed) && order.status === 'completed'
                  ? ` · ${t.orders.reviewed}`
                  : ''}
              </Text>
            </View>
            {order.status === 'completed' || order.status === 'delivered' ? (
              <BuyAgain order={order} />
            ) : null}
          </View>
        ) : (
          <View style={styles.progress}>
            {[1, 2, 3, 4, 5].map((n) => (
              <View
                key={n}
                style={[styles.segment, n <= orderProgress(order.status) && styles.segmentOn]}
              />
            ))}
          </View>
        )}
      </Pressable>
    </Link>
  );
}

/** Mes commandes (maquette) : en cours d'abord, terminées ensuite, avec « Racheter ». */
export default function OrdersScreen() {
  const router = useRouter();
  const { ready, user } = useSession();
  const [tab, setTab] = useState<'current' | 'finished'>('current');
  const orders = useQuery({
    queryKey: ['orders'],
    queryFn: async () => unwrap(await api.GET('/v1/orders')).items,
    enabled: !!user,
  });

  if (!ready) return <Loading />;
  if (!user) {
    return (
      <Empty
        message={t.orders.loginPrompt}
        action={t.orders.login}
        onAction={() => router.push({ pathname: '/connexion', params: { next: '/commandes' } })}
      />
    );
  }
  if (orders.isPending) return <Loading />;
  if (orders.isError)
    return <Failure message={errorMessage(orders.error)} onRetry={() => void orders.refetch()} />;

  const current = orders.data.filter((o) => !FINISHED.includes(o.status));
  const finished = orders.data.filter((o) => FINISHED.includes(o.status));
  // Rien en cours : on montre directement les terminées.
  const shown = tab === 'current' && current.length ? current : finished;
  const activeTab = shown === current ? 'current' : 'finished';

  return (
    <FlatList
      data={shown}
      keyExtractor={(o) => o.id}
      contentContainerStyle={styles.list}
      refreshing={orders.isRefetching}
      onRefresh={() => void orders.refetch()}
      ListHeaderComponent={
        <View style={styles.tabs}>
          <Chip
            label={t.orders.inProgress(current.length)}
            selected={activeTab === 'current'}
            onPress={() => setTab('current')}
          />
          <Chip
            label={t.orders.finished(finished.length)}
            selected={activeTab === 'finished'}
            onPress={() => setTab('finished')}
          />
        </View>
      }
      ListEmptyComponent={<Empty message={t.orders.empty} />}
      renderItem={({ item }) => <OrderCard order={item} />}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: space.md, gap: space.sm, flexGrow: 1 },
  flex: { flex: 1 },
  tabs: { flexDirection: 'row', gap: space.sm, marginBottom: space.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardActive: { borderColor: colors.brandBorder },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ref: { fontWeight: '700', color: colors.text, letterSpacing: 0.5 },
  date: { color: colors.muted, fontSize: 12 },
  badge: { borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { color: colors.onBrand, fontSize: 12, fontWeight: '700' },
  body: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: colors.text, fontSize: font.body },
  small: { color: colors.muted, fontSize: 12 },
  amount: { fontWeight: '800', color: colors.text, fontSize: font.body },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  doneText: { fontSize: font.small, fontWeight: '700' },
  again: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    minHeight: 40,
    justifyContent: 'center',
  },
  againText: { color: colors.text, fontWeight: '600', fontSize: font.small },
  progress: { flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.surfaceRaised },
  segmentOn: { backgroundColor: colors.brand },
});
