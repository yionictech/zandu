import type { SellerOrder } from '@zandu/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Package } from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { api, errorMessage, unwrap } from '../../../src/api';
import { groupThousands } from '../../../src/format';
import { t } from '../../../src/i18n/fr';
import { timeOf, useSellerOrders, type OrderFilter } from '../../../src/seller/queries';
import { StatusBadge, TabHeader } from '../../../src/seller/ui';
import { colors, font, radius, space } from '../../../src/theme';
import { useRefetchOnFocus } from '../../../src/useRefetchOnFocus';
import { Chip } from '../../../src/ui/Form';
import { Empty, Failure, Loading } from '../../../src/ui/Layout';
import { Text } from '../../../src/ui/Text';

const FILTERS = ['all', 'new', 'prepare', 'shipping'] as const;
type Filter = (typeof FILTERS)[number];

/** « 95 000 F » : prix des articles, comme sur les maquettes. */
const shortAmount = (n: number) => `${groupThousands(String(n))} F`;

/** Une commande de la liste : référence, statut, article, destination, et l'action du moment. */
export function SellerOrderRow({ order }: { order: SellerOrder }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const ready = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/seller/orders/{id}/ready', { params: { path: { id: order.id } } }),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['seller'] }),
  });
  const open = () => router.push(`/vendeur/commande/${order.id}`);
  const first = order.items[0];
  const more = order.items.length - 1;
  return (
    <Pressable style={styles.card} onPress={open} testID={`seller-order-${order.publicRef}`}>
      <View style={styles.row}>
        <Text style={styles.ref}>
          {order.publicRef} <Text style={styles.time}>{timeOf(order.createdAt)}</Text>
        </Text>
        <StatusBadge status={order.status} />
      </View>
      <View style={styles.body}>
        <View style={styles.thumb}>
          <Package color={colors.muted} size={22} strokeWidth={1.7} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.title} numberOfLines={1}>
            {first?.title}
            {more > 0 ? ` + ${more}` : ''}
          </Text>
          <Text style={styles.muted} numberOfLines={1}>
            {order.destination.zone} ·{' '}
            {order.destination.pickupPoint ? t.vendor.pickupPoint : t.vendor.homeDelivery}
          </Text>
        </View>
        <Text style={styles.amount}>{shortAmount(order.itemsSubtotal)}</Text>
      </View>
      {order.status === 'paid' ? (
        <Pressable style={[styles.action, styles.actionUrgent]} onPress={open}>
          <Text style={styles.actionText}>{t.vendor.seeAndAccept}</Text>
        </Pressable>
      ) : order.status === 'preparing' ? (
        <Pressable
          style={[styles.action, styles.actionBrand]}
          onPress={() => ready.mutate()}
          disabled={ready.isPending}
          testID={`seller-ready-${order.publicRef}`}
        >
          <Text style={styles.actionText}>
            {ready.error ? errorMessage(ready.error) : t.vendor.markReady}
          </Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const QUERY: Record<Filter, OrderFilter> = {
  all: 'all',
  new: 'new',
  prepare: 'prepare',
  shipping: 'shipping',
};

/** Commandes de la boutique (maquette « Commandes ») : puces de filtre, actions directes. */
export default function SellerOrders() {
  const params = useLocalSearchParams<{ filter?: Filter }>();
  const [filter, setFilter] = useState<Filter>(
    FILTERS.includes(params.filter as Filter) ? (params.filter as Filter) : 'all',
  );
  const orders = useSellerOrders(QUERY[filter]);
  const fresh = useSellerOrders('new');
  useRefetchOnFocus(orders.refetch);
  const newCount = fresh.data?.length ?? 0;

  return (
    <View style={styles.screen}>
      <TabHeader title={t.vendor.ordersTitle} />
      <View>
        <ScrollView
          horizontal
          contentContainerStyle={styles.filters}
          showsHorizontalScrollIndicator={false}
        >
          {FILTERS.map((f) => (
            <Chip
              key={f}
              label={
                f === 'new' && newCount > 0
                  ? `${t.vendor.orderFilters[f]} · ${newCount}`
                  : t.vendor.orderFilters[f]
              }
              selected={filter === f}
              onPress={() => setFilter(f)}
              testID={`orders-filter-${f}`}
            />
          ))}
        </ScrollView>
      </View>
      {orders.isPending ? (
        <Loading />
      ) : orders.isError ? (
        <Failure message={errorMessage(orders.error)} onRetry={() => void orders.refetch()} />
      ) : (
        <FlatList
          data={orders.data}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.list}
          refreshing={orders.isRefetching}
          onRefresh={() => void orders.refetch()}
          ListEmptyComponent={<Empty message={t.vendor.noOrders} />}
          renderItem={({ item }) => <SellerOrderRow order={item} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  filters: { gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm },
  list: { paddingHorizontal: space.md, paddingBottom: space.xl, gap: space.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: space.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ref: { color: colors.text, fontWeight: '800', fontSize: font.body },
  time: { color: colors.muted, fontWeight: '400', fontSize: font.small },
  body: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1, gap: 2 },
  title: { color: colors.text, fontSize: font.body },
  muted: { color: colors.muted, fontSize: 12 },
  amount: { color: colors.text, fontWeight: '800', fontSize: font.body },
  action: { borderRadius: radius.pill, paddingVertical: 13, alignItems: 'center' },
  actionUrgent: { backgroundColor: colors.danger },
  actionBrand: { backgroundColor: colors.brand },
  actionText: { color: colors.onBrand, fontWeight: '800', fontSize: font.body },
});
