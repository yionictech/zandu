import type { SellerOrder } from '@zandu/api-client';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDateTime, formatXaf } from '../format';
import { t } from '../i18n/fr';
import { statusColor } from '../status';
import { colors, font, radius, space } from '../theme';

/** Une commande dans les listes vendeur : ce qu'il faut faire, avant quand, pour combien. */
export function SellerOrderCard({ order }: { order: SellerOrder }) {
  const items = order.items.reduce((n, i) => n + i.quantity, 0);
  return (
    <Link href={`/vendeur/commande/${order.id}`} asChild>
      <Pressable style={styles.card} testID={`seller-order-${order.publicRef}`}>
        <View style={styles.row}>
          <Text style={styles.ref}>{order.publicRef}</Text>
          <Text style={styles.net}>{formatXaf(order.sellerNet)}</Text>
        </View>
        <Text style={[styles.status, { color: statusColor(order.status) }]}>
          {t.sellerStatus[order.status]}
        </Text>
        <Text style={styles.muted} numberOfLines={1}>
          {t.common.items(items)} · {order.items.map((i) => i.title).join(', ')}
        </Text>
        {order.status === 'paid' && order.sellerAcceptDeadline ? (
          <Text style={styles.deadline}>
            {t.seller.acceptBefore(formatDateTime(order.sellerAcceptDeadline))}
          </Text>
        ) : null}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ref: { fontWeight: '800', color: colors.text, letterSpacing: 0.5 },
  net: { fontWeight: '800', color: colors.trust, fontSize: font.body },
  status: { fontWeight: '700', fontSize: font.body },
  muted: { color: colors.muted, fontSize: font.small },
  deadline: { color: colors.waiting, fontSize: font.small, fontWeight: '700' },
});
