import type { Order } from '@zandu/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Lock, Package as PackageIcon, Phone, Star } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useStartCall } from '../../src/call/useStartCall';
import { MessagesButton } from '../../src/ui/MessagesButton';
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
import { LiveMap } from '../../src/ui/LiveMap';
import { Timeline } from '../../src/ui/Timeline';
import { CodeInput } from '../../src/ui/CodeInput';
import { DEMO, SERVER_PICKER } from '../../src/config';
import { apiUrl, fetchOnServer, recetteHeaders } from '../../src/server';

const CODE_PENDING = [
  'paid',
  'preparing',
  'ready_for_pickup',
  'in_delivery',
  'awaiting_collection',
];

type Tag = 'conforme' | 'livreur_ponctuel' | 'bien_emballe';
const TAGS: Tag[] = ['conforme', 'livreur_ponctuel', 'bien_emballe'];

type RiderTag = 'ponctuel' | 'poli' | 'soigneux' | 'en_retard' | 'impoli' | 'colis_abime';
const GOOD: RiderTag[] = ['ponctuel', 'poli', 'soigneux'];
const BAD: RiderTag[] = ['en_retard', 'impoli', 'colis_abime'];

/** « Notez votre livreur » : après une remise à domicile, une fois (vu du livreur et du support). */
function RiderReviewForm({ orderId }: { orderId: string }) {
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<RiderTag[]>([]);
  const [comment, setComment] = useState('');
  const key = ['order', orderId, 'rider-review'];
  const status = useQuery({
    queryKey: key,
    queryFn: async () =>
      unwrap(await api.GET('/v1/orders/{id}/rider-review', { params: { path: { id: orderId } } })),
  });
  const send = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/orders/{id}/rider-review', {
          params: { path: { id: orderId } },
          body: { rating, tags, ...(comment.trim() ? { comment: comment.trim() } : {}) },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const s = status.data;
  if (!s?.rider || (!s.canRate && !s.review)) return null;
  if (s.review)
    return (
      <Card testID="rider-review-done">
        <Text style={styles.thanks}>{t.riderReview.thanks(s.rider.name, s.review.rating)}</Text>
      </Card>
    );
  const choices = rating === 0 ? [] : rating >= 4 ? GOOD : [...BAD, ...GOOD];
  return (
    <Card testID="rider-review">
      <Text style={styles.cardTitle}>{t.riderReview.title(s.rider.name)}</Text>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            onPress={() => {
              setRating(n);
              setTags([]);
            }}
            accessibilityLabel={`${n} étoiles`}
            style={styles.starTouch}
            testID={`rider-star-${n}`}
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
            {choices.map((tag) => (
              <Chip
                key={tag}
                label={t.riderReview.tags[tag]}
                selected={tags.includes(tag)}
                onPress={() =>
                  setTags(
                    tags.includes(tag)
                      ? tags.filter((x) => x !== tag)
                      : tags.length < 3
                        ? [...tags, tag]
                        : tags,
                  )
                }
              />
            ))}
          </View>
          <Field
            label={t.riderReview.comment}
            value={comment}
            onChangeText={setComment}
            maxLength={500}
            multiline
          />
          <Text style={styles.muted}>{t.riderReview.hint}</Text>
          <ErrorText message={send.error ? errorMessage(send.error) : null} />
          <Button
            label={t.riderReview.send}
            onPress={() => send.mutate()}
            loading={send.isPending}
            testID="rider-review-send"
          />
        </>
      ) : null}
    </Card>
  );
}

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
 * position sur la carte, rafraîchie toutes les 8 s.
 */
function RiderOnTheWay({ orderId }: { orderId: string }) {
  const startCall = useStartCall(orderId);
  const tracking = useQuery({
    queryKey: ['order', orderId, 'tracking'],
    queryFn: async () =>
      unwrap(await api.GET('/v1/orders/{id}/tracking', { params: { path: { id: orderId } } })),
    refetchInterval: 8_000,
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
          <Pressable
            onPress={() => void Linking.openURL(`tel:${rider.phone}`)}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text style={styles.normalCall}>{t.calls.normalCall}</Text>
          </Pressable>
        </View>
        <Pressable
          onPress={() => startCall.mutate('rider')}
          accessibilityRole="button"
          accessibilityLabel={`${t.orders.callRider} ${rider.name}`}
          style={styles.callRider}
          testID="call-rider"
        >
          <Phone color={colors.onBrand} size={20} strokeWidth={2} />
        </Pressable>
      </View>
      {tr.position ? (
        <>
          {tr.etaMinutes ? (
            <Text style={styles.eta} testID="rider-eta">
              {t.orders.eta(tr.etaMinutes)}
            </Text>
          ) : null}
          <LiveMap
            lat={tr.position.lat}
            lng={tr.position.lng}
            other={tr.destination ? { point: tr.destination, pin: 'home' } : null}
            label={t.orders.riderComing}
            testID="rider-map"
          />
          <Text style={styles.muted}>{t.orders.positionAt(timeOf(tr.position.at))}</Text>
        </>
      ) : (
        <Text style={styles.muted}>{t.orders.positionSoon}</Text>
      )}
    </Card>
  );
}

/**
 * Envoi de colis vu par l'expéditeur : où en est la course, le code de retrait du livreur à
 * saisir avant de lui donner le colis, le code de retour s'il le rapporte, et l'annulation
 * (remboursée) tant que le livreur n'a pas le colis.
 */
function ParcelPanel({ order, onChange }: { order: Order; onChange: () => void }) {
  const ride = order.kind === 'ride';
  const [code, setCode] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const tracking = useQuery({
    queryKey: ['order', order.id, 'tracking'],
    queryFn: async () =>
      unwrap(await api.GET('/v1/orders/{id}/tracking', { params: { path: { id: order.id } } })),
    refetchInterval: 8_000,
  });
  const act = useMutation({
    mutationFn: async (kind: 'pickup' | 'return' | 'cancel') => {
      const path = { params: { path: { id: order.id } } };
      const params = { ...path, body: { code } };
      if (ride) {
        if (kind === 'cancel') return unwrap(await api.POST('/v1/rides/{id}/cancel', path));
        return kind === 'pickup'
          ? unwrap(await api.POST('/v1/rides/{id}/rider-pickup', params))
          : unwrap(await api.POST('/v1/rides/{id}/rider-return', params));
      }
      if (kind === 'cancel') return unwrap(await api.POST('/v1/parcels/{id}/cancel', path));
      return kind === 'pickup'
        ? unwrap(await api.POST('/v1/parcels/{id}/rider-pickup', params))
        : unwrap(await api.POST('/v1/parcels/{id}/rider-return', params));
    },
    onSuccess: () => {
      setCode('');
      setConfirmCancel(false);
      void tracking.refetch();
      onChange();
    },
    onError: () => setCode(''),
  });
  const parcel = order.parcel;
  const pickup = order.pickupAddress;
  const d = tracking.data;
  const riderExpected = d?.deliveryStatus === 'assigned' && !d.pickupConfirmed;
  const returning = d?.deliveryStatus === 'returning';
  const canCancel = order.status === 'ready_for_pickup' && !d?.pickupConfirmed;
  return (
    <>
      <Card testID="parcel-card">
        <View style={styles.product}>
          <View style={styles.productIcon}>
            <PackageIcon color={colors.brand} size={22} strokeWidth={1.8} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>
              {ride ? t.ride.kind : t.parcel.kind}
              {parcel ? ` · ${t.parcel.sizes[parcel.size].label}` : ''}
            </Text>
            <Text style={styles.muted} numberOfLines={2}>
              {ride && order.trip
                ? t.ride.trip(
                    (order.trip.distanceMeters / 1000).toFixed(1).replace('.', ','),
                    order.trip.etaMinutes,
                  )
                : parcel?.description}
            </Text>
          </View>
        </View>
        {pickup ? (
          <>
            <Eyebrow>{ride ? t.ride.from : t.parcel.from}</Eyebrow>
            <Text style={styles.body}>
              {String(pickup.name)} · {String(pickup.zone ?? '')}
            </Text>
            <Text style={styles.muted}>{String(pickup.landmark)}</Text>
          </>
        ) : null}
        <Text style={styles.muted}>
          {ride
            ? t.ride.smsCode
            : t.parcel.recipientSms(displayPhone(String(order.shippingAddress.phone)))}
        </Text>
        {SERVER_PICKER || DEMO ? (
          <RecipientTestCode
            phone={String(order.shippingAddress.phone)}
            template={ride ? 'ride_code' : 'parcel_recipient_code'}
          />
        ) : null}
      </Card>

      {order.status === 'ready_for_pickup' && d?.deliveryStatus === 'awaiting_assignment' ? (
        <Note icon={Lock} tone="waiting">
          {ride ? t.ride.waiting : t.parcel.waitingRider}
        </Note>
      ) : null}
      {riderExpected || returning ? (
        <Card highlight testID="parcel-code">
          <Eyebrow color={colors.brand}>
            {returning ? t.parcel.returnTitle : ride ? t.ride.driverCode : t.parcel.riderCode}
          </Eyebrow>
          <Text style={styles.muted}>
            {returning
              ? t.parcel.returnHint
              : ride
                ? t.ride.driverCodeHint
                : t.parcel.riderCodeHint}
          </Text>
          <CodeInput
            value={code}
            onChange={setCode}
            length={4}
            label={returning ? t.parcel.returnTitle : t.parcel.riderCode}
            testID="parcel-code-input"
          />
          <ErrorText message={act.error ? errorMessage(act.error) : null} />
          <Button
            label={
              returning ? t.parcel.confirmReturn : ride ? t.ride.confirmCode : t.parcel.confirmCode
            }
            onPress={() => act.mutate(returning ? 'return' : 'pickup')}
            disabled={code.length !== 4}
            loading={act.isPending}
            testID="parcel-code-confirm"
          />
        </Card>
      ) : null}
      {d?.deliveryStatus === 'assigned' && d.pickupConfirmed ? (
        <Note icon={Lock}>{ride ? t.ride.onBoard : t.parcel.handedOver}</Note>
      ) : null}
      {canCancel ? (
        confirmCancel ? (
          <Card>
            <Text style={styles.body}>{t.orders.cancelConfirm}</Text>
            <Button
              label={t.common.confirm}
              onPress={() => act.mutate('cancel')}
              loading={act.isPending}
              testID="parcel-cancel-confirm"
            />
            <Button
              label={t.common.cancel}
              variant="ghost"
              onPress={() => setConfirmCancel(false)}
            />
          </Card>
        ) : (
          <Button
            label={ride ? t.ride.cancel : t.parcel.cancel}
            variant="ghost"
            onPress={() => setConfirmCancel(true)}
            testID="parcel-cancel"
          />
        )
      ) : null}
    </>
  );
}

/**
 * Démonstration et APK de test : le SMS du destinataire ne part pas, on le lit dans la boîte de
 * test (comme le code de connexion). Jamais dans la version des stores.
 */
function RecipientTestCode({ phone, template }: { phone: string; template: string }) {
  const [code, setCode] = useState<string | null>(null);
  const read = async () => {
    try {
      const res = await fetchOnServer(
        `${apiUrl()}/dev/messages?recipient=${encodeURIComponent(phone)}`,
        { headers: recetteHeaders() },
      );
      const { items } = (await res.json()) as {
        items: Array<{ template: string; variables: { code?: string } }>;
      };
      setCode(items.find((m) => m.template === template)?.variables.code ?? '—');
    } catch {
      setCode('—');
    }
  };
  return code ? (
    <Text style={styles.body} testID="parcel-recipient-code">
      {t.parcel.recipientCode(code)}
    </Text>
  ) : (
    <Button
      label={t.parcel.readRecipientCode}
      variant="ghost"
      onPress={() => void read()}
      testID="parcel-read-recipient-code"
    />
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

  // Envoi de colis ou moto-taxi : pas de boutique, panneau dédié.
  const isParcel = o.kind === 'parcel' || o.kind === 'ride';
  const count = o.items.reduce((n, i) => n + i.quantity, 0);
  const summary = isParcel
    ? o.kind === 'ride'
      ? t.ride.kind
      : t.parcel.kind
    : o.items.length === 1
      ? `${o.items[0]!.quantity} × ${o.items[0]!.title}`
      : t.common.items(count);
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
        <Text style={styles.headline}>
          {isParcel
            ? t.parcel.route(
                String(o.pickupAddress?.zone ?? ''),
                String(
                  o.kind === 'ride' ? o.shippingAddress.landmark : o.shippingAddress.recipientName,
                ),
              )
            : t.orders.headline(o.status, o.seller.shopName)}
        </Text>
        <Text style={styles.muted}>
          {isParcel ? (o.kind === 'ride' ? t.ride.kind : t.parcel.kind) : o.seller.shopName} ·{' '}
          {formatDateTime(o.createdAt)}
        </Text>
      </Card>

      {isParcel && o.status !== 'pending_payment' ? (
        <ParcelPanel order={o} onChange={refresh} />
      ) : null}
      {o.status === 'in_delivery' ? <RiderOnTheWay orderId={o.id} /> : null}
      {o.status === 'pending_payment' ? null : <MessagesButton orderId={o.id} />}

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

      {done && !isParcel
        ? o.items.map((item) => (
            <ReviewForm key={item.itemId} orderId={o.id} item={item} shop={o.seller.shopName} />
          ))
        : null}
      {done ? <RiderReviewForm orderId={o.id} /> : null}

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
        {o.discountTotal > 0 ? (
          <View style={styles.row} testID="order-discount">
            <Text style={styles.muted}>{t.promo.discount(o.couponCode ?? '')}</Text>
            <Text style={styles.value}>− {formatXaf(o.discountTotal)}</Text>
          </View>
        ) : null}
        <View style={styles.row}>
          <Text style={styles.muted}>{t.orders.deliveryFee}</Text>
          <Text style={styles.value}>{formatXaf(o.deliveryFee)}</Text>
        </View>
        <View style={[styles.row, styles.totalRow]}>
          <Text style={styles.totalLabel}>{t.orders.total}</Text>
          <Amount value={o.total} size="md" />
        </View>
        {o.pointsUsed > 0 ? (
          <View style={styles.row} testID="order-points">
            <Text style={styles.muted}>{t.loyalty.paidWithPoints}</Text>
            <Text style={styles.value}>− {formatXaf(o.pointsUsed)}</Text>
          </View>
        ) : null}
        {o.refundedAmount > 0 ? (
          <Text style={styles.refund}>Remboursé : {formatXaf(o.refundedAmount)}</Text>
        ) : null}
      </Card>

      {CODE_PENDING.includes(o.status) && !isParcel ? (
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
  eta: { fontSize: font.title, fontWeight: '800', color: colors.text },
  riderRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  normalCall: { color: colors.brand, fontWeight: '700', fontSize: font.small, marginTop: 2 },
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
