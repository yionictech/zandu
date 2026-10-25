import type { Order } from '@zandu/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Lock, Package as PackageIcon, Phone, Star } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../src/ui/Text';
import { api, errorMessage, unwrap } from '../../src/api';
import { displayPhone, formatDateTime, formatXaf } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { colors, font, radius, space } from '../../src/theme';
import { Button } from '../../src/ui/Button';
import { Chip, ErrorText, Field } from '../../src/ui/Form';
import { Amount, Card, Eyebrow, Note } from '../../src/ui/kit';
import { Failure, Loading, Screen } from '../../src/ui/Layout';
import { statusColor } from '../../src/status';
import { MapTiles } from '../../src/ui/MapTiles';
import { Timeline } from '../../src/ui/Timeline';

const CODE_PENDING = [
  'paid',
  'preparing',
  'ready_for_pickup',
  'in_delivery',
  'awaiting_collection',
];

type Tag = 'conforme' | 'livreur_ponctuel' | 'bien_emballe';
const TAGS: Tag[] = ['conforme', 'livreur_ponctuel', 'bien_emballe'];

/** « Notez votre achat » : étoiles, étiquettes et avis (maquette « Colis remis »). */
function ReviewForm({
  orderId,
  item,
  shop,
}: {
  orderId: string;
  item: Order['items'][number];
  shop: string;
}) {
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<Tag[]>([]);
  const [comment, setComment] = useState('');
  const review = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/order-items/{id}/review', {
          params: { path: { id: item.itemId } },
          body: { rating, tags, ...(comment.trim() ? { comment: comment.trim() } : {}) },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['order', orderId] }),
  });
  if (item.reviewed || review.isSuccess)
    return (
      <Card>
        <Text style={styles.thanks}>{t.orders.rated}</Text>
      </Card>
    );
  return (
    <Card>
      <View style={styles.product}>
        <View style={styles.productIcon}>
          <PackageIcon color={colors.muted} size={22} strokeWidth={1.8} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>{t.orders.rateTitle}</Text>
          <Text style={styles.muted} numberOfLines={1}>
            {item.title} · {shop}
          </Text>
        </View>
      </View>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            onPress={() => setRating(n)}
            accessibilityLabel={`${n} étoiles`}
            style={styles.starTouch}
          >
            <Star
              size={32}
              color={n <= rating ? colors.brand : colors.faint}
              fill={n <= rating ? colors.brand : 'transparent'}
            />
          </Pressable>
        ))}
      </View>
      {rating > 0 ? (
        <>
          <View style={styles.tags}>
            {TAGS.map((tag) => (
              <Chip
                key={tag}
                label={t.reviewTags[tag]}
                selected={tags.includes(tag)}
                onPress={() =>
                  setTags(tags.includes(tag) ? tags.filter((x) => x !== tag) : [...tags, tag])
                }
              />
            ))}
          </View>
          <Field
            label={t.orders.commentPlaceholder}
            value={comment}
            onChangeText={setComment}
            placeholder="Qu’avez-vous pensé du produit et du vendeur ?"
            multiline
          />
          <ErrorText message={review.error ? errorMessage(review.error) : null} />
          <Button
            label={t.orders.sendReview}
            onPress={() => review.mutate()}
            loading={review.isPending}
          />
        </>
      ) : null}
    </Card>
  );
}

/**
 * Livreur en route (docs/ux/03 §15) : son prénom, le bouton pour l'appeler et sa dernière
 * position sur une petite carte, rafraîchie toutes les 20 s.
 */
function RiderOnTheWay({ orderId }: { orderId: string }) {
  const tracking = useQuery({
    queryKey: ['order', orderId, 'tracking'],
    queryFn: async () =>
      unwrap(await api.GET('/v1/orders/{id}/tracking', { params: { path: { id: orderId } } })),
    refetchInterval: 20_000,
  });
  const tr = tracking.data;
  if (!tr?.onTheWay || !tr.rider) return null;
  const rider = tr.rider;
  return (
    <Card testID="rider-on-the-way">
      <View style={styles.riderRow}>
        <View style={styles.flex}>
          <Eyebrow color={colors.waiting}>{t.orders.riderComing}</Eyebrow>
          <Text style={styles.body}>{rider.name}</Text>
        </View>
        <Pressable
          onPress={() => void Linking.openURL(`tel:${rider.phone}`)}
          accessibilityRole="button"
          accessibilityLabel={`${t.orders.callRider} ${rider.name}`}
          style={styles.callRider}
        >
          <Phone color={colors.onBrand} size={20} strokeWidth={2} />
        </Pressable>
      </View>
      {tr.position ? (
        <>
          <MapTiles lat={tr.position.lat} lng={tr.position.lng} testID="rider-map" />
          <Text style={styles.muted}>{t.orders.positionAt(timeOf(tr.position.at))}</Text>
        </>
      ) : (
        <Text style={styles.muted}>{t.orders.positionSoon}</Text>
      )}
    </Card>
  );
}

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Brazzaville',
  });

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

  const count = o.items.reduce((n, i) => n + i.quantity, 0);
  const summary =
    o.items.length === 1 ? `${o.items[0]!.quantity} × ${o.items[0]!.title}` : t.common.items(count);
  const done = o.status === 'delivered' || o.status === 'completed';

  return (
    <Screen
      footer={
        <View style={styles.footerRow}>
          <Text style={styles.footerText} numberOfLines={1}>
            {t.orders.paidLine(summary)}
          </Text>
          <Text style={styles.footerAmount}>{formatXaf(o.total)}</Text>
        </View>
      }
    >
      <Stack.Screen options={{ title: o.publicRef }} />
      <Card style={styles.hero}>
        <Text
          style={[styles.eyebrow, { color: statusColor(o.status) }]}
          testID="order-status"
          accessibilityLabel={t.status[o.status]}
        >
          {t.statusShort[o.status].toUpperCase()}
        </Text>
        <Text style={styles.headline}>{t.orders.headline(o.status, o.seller.shopName)}</Text>
        <Text style={styles.muted}>
          {o.seller.shopName} · {formatDateTime(o.createdAt)}
        </Text>
      </Card>

      {o.status === 'in_delivery' ? <RiderOnTheWay orderId={o.id} /> : null}

      {o.status === 'delivered' && o.disputeWindowEndsAt ? (
        <Card>
          <Text style={styles.conformTitle}>{t.orders.conformTitle}</Text>
          <Text style={styles.muted}>
            {t.orders.deadline(formatDateTime(o.disputeWindowEndsAt))}
          </Text>
          <View style={styles.twoButtons}>
            <Button
              label={t.orders.problemShort}
              variant="secondary"
              style={styles.flex}
              onPress={() => router.push(`/litige/${o.id}`)}
            />
            <Button
              label={t.orders.allGood}
              style={styles.flex}
              onPress={() => action.mutate('confirm')}
              loading={action.isPending}
              testID="order-confirm"
            />
          </View>
        </Card>
      ) : null}

      <ErrorText message={action.error ? errorMessage(action.error) : null} />
      {notice ? <Note icon={Lock}>{notice}</Note> : null}

      {done
        ? o.items.map((item) => (
            <ReviewForm key={item.itemId} orderId={o.id} item={item} shop={o.seller.shopName} />
          ))
        : null}

      <Card>
        <Timeline history={o.history} />
      </Card>

      <Card>
        <Eyebrow>{t.orders.shippedTo}</Eyebrow>
        <Text style={styles.body}>
          {String(address.recipientName)} · {displayPhone(String(address.phone))}
        </Text>
        <Text style={styles.muted}>{String(address.landmark)}</Text>
      </Card>

      <Card>
        {o.items.map((item) => (
          <View key={item.itemId} style={styles.row}>
            <Text style={styles.itemTitle} numberOfLines={2}>
              {item.quantity} × {item.title}
            </Text>
            <Text style={styles.value}>{formatXaf(item.lineTotal)}</Text>
          </View>
        ))}
        <View style={styles.row}>
          <Text style={styles.muted}>{t.orders.deliveryFee}</Text>
          <Text style={styles.value}>{formatXaf(o.deliveryFee)}</Text>
        </View>
        <View style={[styles.row, styles.totalRow]}>
          <Text style={styles.totalLabel}>{t.orders.total}</Text>
          <Amount value={o.total} size="md" />
        </View>
        {o.refundedAmount > 0 ? (
          <Text style={styles.refund}>Remboursé : {formatXaf(o.refundedAmount)}</Text>
        ) : null}
      </Card>

      {CODE_PENDING.includes(o.status) ? (
        <Button label={t.orders.newCode} variant="ghost" onPress={() => action.mutate('code')} />
      ) : null}

      {o.status === 'paid' ? (
        confirmCancel ? (
          <Card>
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
          </Card>
        ) : (
          <Button label={t.orders.cancel} variant="ghost" onPress={() => setConfirmCancel(true)} />
        )
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  riderRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  callRider: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
  hero: { gap: 6, borderColor: colors.brandBorder },
  eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  headline: { fontSize: 22, fontWeight: '800', color: colors.text, lineHeight: 28 },
  muted: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
  conformTitle: { fontSize: font.title, fontWeight: '800', color: colors.text },
  twoButtons: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  cardTitle: { color: colors.text, fontWeight: '700', fontSize: font.body },
  product: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  productIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stars: { flexDirection: 'row', justifyContent: 'center' },
  starTouch: { padding: 8 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  thanks: { color: colors.trust, fontSize: font.body, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  itemTitle: { flex: 1, color: colors.text, fontSize: font.small },
  value: { color: colors.text, fontSize: font.small },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space.sm,
    alignItems: 'center',
  },
  totalLabel: { fontSize: font.body, fontWeight: '700', color: colors.text },
  refund: { color: colors.trust, fontWeight: '700' },
  body: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  footerText: { flex: 1, color: colors.muted, fontSize: font.small },
  footerAmount: { color: colors.text, fontWeight: '700', fontSize: font.small },
});
