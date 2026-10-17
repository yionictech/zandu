import type { Order } from '@zandu/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api, errorMessage, unwrap } from '../../src/api';
import { displayPhone, formatDateTime, formatXaf } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { colors, font, radius, space } from '../../src/theme';
import { Button } from '../../src/ui/Button';
import { ErrorText, Field } from '../../src/ui/Form';
import { Failure, Loading, Screen, Section } from '../../src/ui/Layout';
import { statusColor } from '../../src/status';
import { Timeline } from '../../src/ui/Timeline';

const CODE_PENDING = [
  'paid',
  'preparing',
  'ready_for_pickup',
  'in_delivery',
  'awaiting_collection',
];

function ReviewForm({ orderId, item }: { orderId: string; item: Order['items'][number] }) {
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const review = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/order-items/{id}/review', {
          params: { path: { id: item.itemId } },
          body: { rating, ...(comment.trim() ? { comment: comment.trim() } : {}) },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['order', orderId] }),
  });
  if (item.reviewed || review.isSuccess) return <Text style={styles.thanks}>{t.orders.rated}</Text>;
  return (
    <View style={styles.reviewBox}>
      <Text style={styles.label}>{t.orders.rate}</Text>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            onPress={() => setRating(n)}
            accessibilityLabel={`${n} étoiles`}
            style={styles.starTouch}
          >
            <Text style={[styles.star, n <= rating && styles.starOn]}>★</Text>
          </Pressable>
        ))}
      </View>
      {rating > 0 ? (
        <>
          <Field
            label={t.orders.commentPlaceholder}
            value={comment}
            onChangeText={setComment}
            multiline
          />
          <ErrorText message={review.error ? errorMessage(review.error) : null} />
          <Button
            label={t.orders.sendReview}
            variant="secondary"
            onPress={() => review.mutate()}
            loading={review.isPending}
          />
        </>
      ) : null}
    </View>
  );
}

/** Suivi d'une commande : frise, code de remise, confirmation de réception, litige, avis. */
export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const order = useQuery({
    queryKey: ['order', id],
    queryFn: async () => unwrap(await api.GET('/v1/orders/{id}', { params: { path: { id } } })),
    refetchInterval: 15_000,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['order', id] });
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
  };
  const action = useMutation({
    mutationFn: async (kind: 'cancel' | 'confirm' | 'code') => {
      const params = { params: { path: { id } } };
      if (kind === 'cancel') return unwrap(await api.POST('/v1/orders/{id}/cancel', params));
      if (kind === 'confirm')
        return unwrap(await api.POST('/v1/orders/{id}/confirm-receipt', params));
      return unwrap(await api.POST('/v1/orders/{id}/handover-code', params));
    },
    onSuccess: (_data, kind) => {
      if (kind === 'code') setNotice(t.orders.codeSent);
      setConfirmCancel(false);
      refresh();
    },
  });

  if (order.isPending) return <Loading />;
  if (order.isError)
    return <Failure message={errorMessage(order.error)} onRetry={() => void order.refetch()} />;
  const o = order.data;
  const address = o.shippingAddress;

  return (
    <Screen>
      <Stack.Screen options={{ title: o.publicRef }} />
      <View style={styles.header}>
        <Text style={[styles.status, { color: statusColor(o.status) }]} testID="order-status">
          {t.status[o.status]}
        </Text>
        <Text style={styles.muted}>
          {o.seller.shopName} · {formatDateTime(o.createdAt)}
        </Text>
      </View>

      {o.status === 'delivered' && o.disputeWindowEndsAt ? (
        <View style={styles.conform}>
          <Text style={styles.conformTitle}>{t.orders.conformTitle}</Text>
          <Text style={styles.muted}>
            {t.orders.conformBody(formatDateTime(o.disputeWindowEndsAt))}
          </Text>
          <Button
            label={t.orders.allGood}
            variant="trust"
            onPress={() => action.mutate('confirm')}
            loading={action.isPending}
            testID="order-confirm"
          />
          <Button
            label={t.orders.problem}
            variant="secondary"
            onPress={() => router.push(`/litige/${o.id}`)}
          />
        </View>
      ) : null}

      <ErrorText message={action.error ? errorMessage(action.error) : null} />
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <Section title={t.orders.history}>
        <Timeline history={o.history} />
      </Section>

      <Section>
        {o.items.map((item) => (
          <View key={item.itemId} style={styles.item}>
            <View style={styles.row}>
              <Text style={styles.itemTitle} numberOfLines={2}>
                {item.quantity} × {item.title}
              </Text>
              <Text style={styles.value}>{formatXaf(item.lineTotal)}</Text>
            </View>
            {o.status === 'delivered' || o.status === 'completed' ? (
              <ReviewForm orderId={o.id} item={item} />
            ) : null}
          </View>
        ))}
        <View style={styles.row}>
          <Text style={styles.muted}>{t.orders.deliveryFee}</Text>
          <Text style={styles.value}>{formatXaf(o.deliveryFee)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.totalLabel}>{t.orders.total}</Text>
          <Text style={styles.total}>{formatXaf(o.total)}</Text>
        </View>
        {o.refundedAmount > 0 ? (
          <Text style={styles.refund}>Remboursé : {formatXaf(o.refundedAmount)}</Text>
        ) : null}
      </Section>

      <Section title={t.orders.shippedTo}>
        <Text style={styles.body}>
          {String(address.recipientName)} · {displayPhone(String(address.phone))}
        </Text>
        <Text style={styles.muted}>{String(address.landmark)}</Text>
      </Section>

      {CODE_PENDING.includes(o.status) ? (
        <Button label={t.orders.newCode} variant="ghost" onPress={() => action.mutate('code')} />
      ) : null}

      {o.status === 'paid' ? (
        confirmCancel ? (
          <View style={styles.confirmBox}>
            <Text style={styles.body}>{t.orders.cancelConfirm}</Text>
            <Button
              label={t.common.confirm}
              onPress={() => action.mutate('cancel')}
              loading={action.isPending}
            />
            <Button
              label={t.common.cancel}
              variant="ghost"
              onPress={() => setConfirmCancel(false)}
            />
          </View>
        ) : (
          <Button label={t.orders.cancel} variant="ghost" onPress={() => setConfirmCancel(true)} />
        )
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 4 },
  status: { fontSize: font.headline, fontWeight: '800' },
  muted: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
  conform: {
    backgroundColor: colors.trustSoft,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.sm,
  },
  conformTitle: { fontSize: font.title, fontWeight: '800', color: colors.trust },
  notice: { color: colors.trust, fontWeight: '700' },
  item: {
    gap: space.sm,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  itemTitle: { flex: 1, color: colors.text, fontSize: font.body },
  value: { color: colors.text, fontWeight: '700' },
  totalLabel: { fontSize: font.title, fontWeight: '800', color: colors.text },
  total: { fontSize: font.title, fontWeight: '900', color: colors.text },
  refund: { color: colors.trust, fontWeight: '700' },
  body: { color: colors.text, fontSize: font.body },
  confirmBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  reviewBox: { gap: space.sm },
  label: { fontSize: font.small, fontWeight: '700', color: colors.text },
  stars: { flexDirection: 'row' },
  starTouch: { padding: 6 },
  star: { fontSize: 30, color: colors.border },
  starOn: { color: colors.waiting },
  thanks: { color: colors.trust, fontSize: font.small, fontWeight: '600' },
});
