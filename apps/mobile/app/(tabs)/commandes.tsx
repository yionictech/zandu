import { useQuery } from '@tanstack/react-query';
import { Link, useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { api, errorMessage, unwrap } from '../../src/api';
import { formatDateTime, formatXaf } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { useSession } from '../../src/session';
import { colors, font, radius, space } from '../../src/theme';
import { statusColor } from '../../src/status';
import { Empty, Failure, Loading } from '../../src/ui/Layout';

/** Mes commandes : statut lisible en un coup d'œil, mises à jour au retour sur l'écran. */
export default function OrdersScreen() {
  const router = useRouter();
  const { ready, user } = useSession();
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

  return (
    <FlatList
      data={orders.data}
      keyExtractor={(o) => o.id}
      contentContainerStyle={styles.list}
      refreshing={orders.isRefetching}
      onRefresh={() => void orders.refetch()}
      ListEmptyComponent={<Empty message={t.orders.empty} />}
      renderItem={({ item }) => (
        <Link href={`/commande/${item.id}`} asChild>
          <Pressable style={styles.card} testID={`order-${item.publicRef}`}>
            <View style={styles.row}>
              <Text style={styles.ref}>{item.publicRef}</Text>
              <Text style={styles.date}>{formatDateTime(item.createdAt)}</Text>
            </View>
            <Text style={[styles.status, { color: statusColor(item.status) }]}>
              {t.status[item.status]}
            </Text>
            <Text style={styles.items} numberOfLines={1}>
              {item.items.map((i) => i.title).join(', ')} · {item.seller.shopName}
            </Text>
            <Text style={styles.total}>{formatXaf(item.total)}</Text>
          </Pressable>
        </Link>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: space.md, gap: space.sm, flexGrow: 1 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  ref: { fontWeight: '800', color: colors.text, letterSpacing: 0.5 },
  date: { color: colors.muted, fontSize: 12 },
  status: { fontWeight: '700', fontSize: font.body },
  items: { color: colors.muted, fontSize: font.small },
  total: { fontWeight: '800', color: colors.text },
});
