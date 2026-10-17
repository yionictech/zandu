import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { errorMessage } from '../../src/api';
import { t } from '../../src/i18n/fr';
import { SellerOrderCard } from '../../src/seller/OrderCard';
import { useSellerOrders, type OrderFilter } from '../../src/seller/queries';
import { space } from '../../src/theme';
import { useRefetchOnFocus } from '../../src/useRefetchOnFocus';
import { Chip } from '../../src/ui/Form';
import { Empty, Failure, Loading } from '../../src/ui/Layout';
import { RequireRole } from '../../src/ui/RequireRole';

const FILTERS: OrderFilter[] = ['todo', 'shipping', 'done', 'all'];

function SellerOrders() {
  const [filter, setFilter] = useState<OrderFilter>('todo');
  const orders = useSellerOrders(filter);
  useRefetchOnFocus(orders.refetch);

  return (
    <View style={styles.screen}>
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Chip
            key={f}
            label={t.seller.filters[f]}
            selected={filter === f}
            onPress={() => setFilter(f)}
            testID={`orders-filter-${f}`}
          />
        ))}
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
          ListEmptyComponent={<Empty message={t.seller.noOrders} />}
          renderItem={({ item }) => <SellerOrderCard order={item} />}
        />
      )}
    </View>
  );
}

export default function SellerOrdersScreen() {
  return (
    <RequireRole role="seller">
      <SellerOrders />
    </RequireRole>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, padding: space.md },
  list: { paddingHorizontal: space.md, paddingBottom: space.xl, gap: space.sm },
});
