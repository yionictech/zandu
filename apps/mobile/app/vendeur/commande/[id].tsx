import type {
  DeliveryStatus,
  DisputeSellerChoice,
  PrepMinutes,
  SellerOrder,
} from '@zandu/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Bike,
  Camera,
  Check,
  Clock3,
  Info,
  Package,
  ShieldCheck,
  Star,
  Truck,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api, errorMessage, unwrap } from '../../../src/api';
import { countdown, formatDateTime, formatXaf } from '../../../src/format';
import { t } from '../../../src/i18n/fr';
import { sellerKeys, timeOf, useShop } from '../../../src/seller/queries';
import { CheckRow, OrderSteps, RadioCard, StatusBadge } from '../../../src/seller/ui';
import { colors, font, radius, space } from '../../../src/theme';
import { CameraPermissionError, pickImage, uploadImage } from '../../../src/upload';
import { useNow } from '../../../src/useNow';
import { Button } from '../../../src/ui/Button';
import { CountdownRing } from '../../../src/ui/CountdownRing';
import { Chip, ErrorText, Field } from '../../../src/ui/Form';
import { CodeInput } from '../../../src/ui/CodeInput';
import { Amount, Avatar, Card, Eyebrow, Note } from '../../../src/ui/kit';
import { Failure, Loading, Screen } from '../../../src/ui/Layout';
import { RequireRole } from '../../../src/ui/RequireRole';
import { MessagesButton } from '../../../src/ui/MessagesButton';
import { Text } from '../../../src/ui/Text';

type Detail = SellerOrder & {
  history: Array<{ status: string; at: string }>;
  rider: { name: string } | null;
  delivery: {
    status: DeliveryStatus;
    pickupConfirmedAt: string | null;
    returnConfirmedAt: string | null;
    failureReason: string | null;
  } | null;
  dispute: {
    id: string;
    reason: string;
    description: string;
    status: 'open' | 'resolved';
    slaDueAt: string;
    sellerChoice: DisputeSellerChoice | null;
    sellerMessage: string | null;
    buyerName: string;
    buyerEvidenceCount: number;
    sellerEvidenceCount: number;
  } | null;
  reviews: Array<{
    id: string;
    rating: number;
    comment: string | null;
    tags: Array<keyof typeof t.reviewTags>;
    authorName: string;
  }>;
};

const PREP: PrepMinutes[] = [15, 30, 60, 120];
const rate = (o: SellerOrder) =>
  o.itemsSubtotal > 0 ? `${Math.round((o.commission / o.itemsSubtotal) * 1000) / 10} %` : '0 %';
const place = (o: SellerOrder) => o.destination.pickupPoint ?? o.destination.zone;

/** Articles de la commande, avec une vignette (maquette « À accepter »). */
function Items({ order }: { order: SellerOrder }) {
  return (
    <>
      {order.items.map((item) => (
        <View key={item.itemId} style={styles.item}>
          <View style={styles.thumb}>
            <Package color={colors.muted} size={22} strokeWidth={1.7} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.itemTitle} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={styles.small}>
              {t.common.items(item.quantity)} · {formatXaf(item.lineTotal)}
            </Text>
          </View>
        </View>
      ))}
      {order.discountTotal > 0 ? (
        <Text style={styles.small}>
          {t.promo.discount(order.couponCode ?? '')} : − {formatXaf(order.discountTotal)}
        </Text>
      ) : null}
    </>
  );
}

/** À accepter : échéance, ce que le vendeur recevra, livraison, « Prêt dans ». */
function ToAccept({
  order,
  prep,
  setPrep,
}: {
  order: SellerOrder;
  prep: PrepMinutes;
  setPrep: (p: PrepMinutes) => void;
}) {
  const now = useNow();
  const deadline = order.sellerAcceptDeadline
    ? new Date(order.sellerAcceptDeadline).getTime()
    : null;
  const left = deadline ? deadline - now : 0;
  return (
    <>
      {order.sellerAcceptDeadline ? (
        <View style={styles.deadline}>
          <Clock3 color={colors.danger} size={18} strokeWidth={2} />
          <Text style={styles.deadlineText}>
            {t.vendor.acceptBeforeShort(timeOf(order.sellerAcceptDeadline))}
          </Text>
          {left < 3_600_000 ? <Text style={styles.deadlineTime}>{countdown(left)}</Text> : null}
        </View>
      ) : null}
      <Card>
        <Items order={order} />
        <View style={styles.divider} />
        <View style={styles.between}>
          <Text style={styles.muted}>{t.vendor.youReceive}</Text>
          <Amount value={order.sellerNet} size="md" testID="seller-net" />
        </View>
      </Card>
      <Card highlight>
        <View style={styles.rowTop}>
          <ShieldCheck color={colors.brand} size={20} strokeWidth={1.8} />
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>{t.vendor.alreadyPaid}</Text>
            <Text style={styles.muted}>{t.vendor.alreadyPaidBody}</Text>
          </View>
        </View>
      </Card>
      <Card>
        <Eyebrow>{t.vendor.delivery}</Eyebrow>
        <View style={styles.row}>
          <Bike color={colors.waiting} size={22} strokeWidth={1.8} />
          <View style={styles.flex}>
            <Text style={styles.body}>{t.vendor.riderComes}</Text>
            <Text style={styles.small}>{t.vendor.destination(place(order))}</Text>
          </View>
        </View>
      </Card>
      <Card>
        <Eyebrow>{t.vendor.readyIn}</Eyebrow>
        <View style={styles.wrap}>
          {PREP.map((minutes) => (
            <Chip
              key={minutes}
              label={t.vendor.prepChoices[minutes]!}
              selected={prep === minutes}
              onPress={() => setPrep(minutes)}
              testID={`ready-in-${minutes}`}
            />
          ))}
        </View>
      </Card>
    </>
  );
}

/** À préparer : temps promis restant, liste « Avant de fermer le colis ». */
function Preparing({ order }: { order: Detail }) {
  const now = useNow(15_000);
  const [checked, setChecked] = useState<number[]>([]);
  const promised = order.readyPromisedAt ? new Date(order.readyPromisedAt).getTime() : null;
  const left = promised ? promised - now : 0;
  const minutes = Math.ceil(left / 60_000);
  // Durée promise à l'acceptation : de l'heure d'acceptation à l'heure promise.
  const acceptedAt = order.history.find((h) => h.status === 'preparing')?.at;
  const total =
    promised && acceptedAt
      ? Math.max(60_000, promised - new Date(acceptedAt).getTime())
      : 30 * 60_000;
  const list = t.vendor.checklist(order.publicRef);
  return (
    <>
      <OrderSteps status={order.status} />
      {promised ? (
        <Card>
          <View style={styles.row}>
            <CountdownRing
              msLeft={Math.max(0, left)}
              totalMs={total}
              size={56}
              color={minutes >= 0 ? colors.brand : colors.danger}
              label={`${Math.abs(minutes)}'`}
            />
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>
                {minutes >= 0 ? t.vendor.readyInMinutes(minutes) : t.vendor.late(-minutes)}
              </Text>
              <Text style={styles.muted}>
                {t.vendor.promised(
                  t.vendor.prepChoices[Math.round(total / 60_000)] ??
                    formatDateTime(order.readyPromisedAt!),
                )}
              </Text>
            </View>
          </View>
        </Card>
      ) : null}
      <Card>
        <Text style={styles.cardTitle}>{t.vendor.beforeClosing}</Text>
        {list.map((label, i) => (
          <CheckRow
            key={label}
            label={label}
            checked={checked.includes(i)}
            onPress={() =>
              setChecked((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]))
            }
          />
        ))}
      </Card>
      <Note icon={Bike} tone="waiting">
        {t.vendor.riderSent}
      </Note>
    </>
  );
}

/**
 * Code à 4 chiffres montré par le livreur : retrait (avant de lui donner le colis) ou retour
 * (quand il rapporte un colis non livré).
 */
function RiderCode({ orderId, kind }: { orderId: string; kind: 'pickup' | 'return' }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const confirm = useMutation({
    mutationFn: async () => {
      const params = { params: { path: { id: orderId } }, body: { code } };
      return kind === 'pickup'
        ? unwrap(await api.POST('/v1/seller/orders/{id}/rider-pickup', params))
        : unwrap(await api.POST('/v1/seller/orders/{id}/rider-return', params));
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['seller'] }),
    onError: () => setCode(''),
  });
  return (
    <Card highlight>
      <Eyebrow color={colors.brand}>
        {kind === 'pickup' ? t.vendor.riderCodeTitle : t.vendor.returnCodeTitle}
      </Eyebrow>
      {kind === 'pickup' ? <Text style={styles.small}>{t.vendor.riderCodeHint}</Text> : null}
      <CodeInput
        value={code}
        onChange={setCode}
        length={4}
        label={kind === 'pickup' ? t.vendor.riderCodeTitle : t.vendor.returnCodeTitle}
        testID={`seller-${kind}-code`}
      />
      <ErrorText message={confirm.error ? errorMessage(confirm.error) : null} />
      <Button
        label={kind === 'pickup' ? t.vendor.riderCodeConfirm : t.vendor.returnConfirm}
        onPress={() => confirm.mutate()}
        disabled={code.length !== 4}
        loading={confirm.isPending}
        testID={`seller-${kind}-confirm`}
      />
    </Card>
  );
}

/** Prête : le livreur attribué, ce qu'on vérifie devant lui. */
function Ready({
  order,
  rider,
  delivery,
}: {
  order: SellerOrder;
  rider: Detail['rider'];
  delivery: Detail['delivery'];
}) {
  const [checked, setChecked] = useState<number[]>([]);
  const expected = rider && delivery?.status === 'assigned';
  return (
    <>
      <OrderSteps status={order.status} />
      {expected && !delivery.pickupConfirmedAt ? (
        <RiderCode orderId={order.id} kind="pickup" />
      ) : null}
      {expected && delivery.pickupConfirmedAt ? (
        <Note icon={Check}>{t.vendor.riderCodeOk(rider.name)}</Note>
      ) : null}
      <Card>
        <View style={styles.between}>
          <Eyebrow>{t.vendor.yourRider}</Eyebrow>
          {rider ? (
            <View style={[styles.tag, { backgroundColor: colors.waiting }]}>
              <Text style={styles.tagDark}>{t.vendor.riderAssigned}</Text>
            </View>
          ) : null}
        </View>
        {rider ? (
          <View style={styles.row}>
            <Avatar name={rider.name} size={44} />
            <Text style={styles.cardTitle}>{rider.name}</Text>
          </View>
        ) : (
          <View style={styles.row}>
            <Truck color={colors.waiting} size={22} strokeWidth={1.8} />
            <View style={styles.flex}>
              <Text style={styles.body}>{t.vendor.riderSoon}</Text>
              <Text style={styles.small}>{t.vendor.riderSoonBody}</Text>
            </View>
          </View>
        )}
      </Card>
      <Card>
        {t.vendor.handOverChecklist.map((label, i) => (
          <CheckRow
            key={label}
            label={label}
            checked={checked.includes(i)}
            onPress={() =>
              setChecked((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]))
            }
          />
        ))}
      </Card>
    </>
  );
}

/** Livrée ou terminée : ce que la vente rapporte, l'avis de la cliente. */
function Delivered({ order, reviews }: { order: SellerOrder; reviews: Detail['reviews'] }) {
  const done = order.status === 'completed';
  return (
    <>
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Check color={colors.onBrand} size={34} strokeWidth={3} />
        </View>
        <Text style={styles.heroTitle}>{t.vendor.deliveredTitle}</Text>
        <Text style={styles.heroBody}>
          {done ? t.vendor.completedBody : t.vendor.deliveredBody}
        </Text>
      </View>
      <Card>
        <View style={styles.between}>
          <Text style={styles.muted}>{t.vendor.sale}</Text>
          <Text style={styles.body}>{formatXaf(order.itemsSubtotal)}</Text>
        </View>
        <View style={styles.between}>
          <Text style={styles.muted}>{t.vendor.commissionRate(rate(order))}</Text>
          <Text style={styles.body}>− {formatXaf(order.commission)}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.between}>
          <Text style={styles.cardTitle}>
            {done ? t.vendor.addedToBalance : t.vendor.toBalance}
          </Text>
          <Amount value={order.sellerNet} size="sm" color={colors.brand} testID="seller-net" />
        </View>
      </Card>
      {reviews.map((review) => (
        <Card key={review.id}>
          <View style={styles.between}>
            <Eyebrow>{t.vendor.buyerReview}</Eyebrow>
            <View style={styles.stars}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Star
                  key={n}
                  size={14}
                  color={n <= review.rating ? colors.brand : colors.faint}
                  fill={n <= review.rating ? colors.brand : 'transparent'}
                />
              ))}
            </View>
          </View>
          {review.tags.length ? (
            <View style={styles.wrap}>
              {review.tags.map((tag) => (
                <View key={tag} style={styles.tag}>
                  <Text style={styles.tagText}>{t.reviewTags[tag]}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {review.comment ? <Text style={styles.body}>{review.comment}</Text> : null}
          <Text style={styles.small}>
            {review.authorName} · {order.destination.zone}
          </Text>
        </Card>
      ))}
    </>
  );
}

/** Litige : ce que signale la cliente, la réponse du vendeur, ses photos. */
function Dispute({
  order,
  dispute,
  choice,
  setChoice,
  message,
  setMessage,
}: {
  order: SellerOrder;
  dispute: NonNullable<Detail['dispute']>;
  choice: DisputeSellerChoice | null;
  setChoice: (c: DisputeSellerChoice) => void;
  message: string;
  setMessage: (m: string) => void;
}) {
  const queryClient = useQueryClient();
  const proof = useMutation({
    mutationFn: async () => {
      const image = await pickImage('camera');
      if (!image) return null;
      const uploadId = await uploadImage('dispute_evidence', image);
      return unwrap(
        await api.POST('/v1/seller/orders/{id}/dispute-evidence', {
          params: { path: { id: order.id } },
          body: { uploadId },
        }),
      );
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: sellerKeys.order(order.id) }),
  });
  const open = dispute.status === 'open';
  return (
    <>
      <View style={styles.deadline}>
        <Clock3 color={colors.danger} size={18} strokeWidth={2} />
        <Text style={styles.deadlineText}>
          {open ? t.vendor.answerBefore(formatDateTime(dispute.slaDueAt)) : t.vendor.disputeClosed}
        </Text>
        <Text style={styles.deadlineTime}>
          {t.vendor.blockedAmount(formatXaf(order.itemsSubtotal))}
        </Text>
      </View>
      <Card>
        <View style={styles.between}>
          <Eyebrow>{t.vendor.buyerSays(dispute.buyerName)}</Eyebrow>
          <View style={[styles.tag, { backgroundColor: colors.danger }]}>
            <Text style={styles.tagDark}>
              {t.dispute.reasons[dispute.reason as keyof typeof t.dispute.reasons] ??
                dispute.reason}
            </Text>
          </View>
        </View>
        <Text style={styles.body}>« {dispute.description} »</Text>
        <Text style={styles.small}>{t.vendor.photosAttached(dispute.buyerEvidenceCount)}</Text>
      </Card>
      {open ? (
        <>
          <Eyebrow>{t.vendor.yourAnswer}</Eyebrow>
          {(Object.keys(t.vendor.choices) as DisputeSellerChoice[]).map((key) => (
            <RadioCard
              key={key}
              title={t.vendor.choices[key][0]}
              hint={t.vendor.choices[key][1]}
              selected={choice === key}
              onPress={() => setChoice(key)}
              testID={`dispute-choice-${key}`}
            />
          ))}
          <Field
            label={t.vendor.messageLabel}
            value={message}
            onChangeText={setMessage}
            multiline
            maxLength={1000}
            testID="dispute-message"
          />
          <Pressable
            style={styles.proof}
            onPress={() => proof.mutate()}
            disabled={proof.isPending}
            accessibilityRole="button"
          >
            <Camera color={colors.text} size={18} />
            <Text style={styles.body}>
              {proof.isPending
                ? t.upload.sending
                : dispute.sellerEvidenceCount
                  ? `${t.vendor.addProof} · ${t.vendor.proofsSent(dispute.sellerEvidenceCount)}`
                  : t.vendor.addProof}
            </Text>
          </Pressable>
          <ErrorText
            message={
              proof.error
                ? proof.error instanceof CameraPermissionError
                  ? t.upload.permission
                  : errorMessage(proof.error)
                : null
            }
          />
          {dispute.sellerChoice ? (
            <Note icon={Info} tone="waiting">
              {t.vendor.answerSent}
            </Note>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function SellerOrderDetail({ id }: { id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const shop = useShop();
  const [prep, setPrep] = useState<PrepMinutes | null>(null);
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState('');
  const [choice, setChoice] = useState<DisputeSellerChoice | null>(null);
  const [message, setMessage] = useState('');

  const order = useQuery({
    queryKey: sellerKeys.order(id),
    queryFn: async () =>
      unwrap(await api.GET('/v1/seller/orders/{id}', { params: { path: { id } } })) as Detail,
    refetchInterval: 30_000,
  });
  // Réponse déjà envoyée : reprise pour pouvoir la modifier.
  useEffect(() => {
    const d = order.data?.dispute;
    if (d?.sellerChoice && choice === null) {
      setChoice(d.sellerChoice);
      setMessage(d.sellerMessage ?? '');
    }
  }, [order.data, choice]);

  const done = () => {
    setRefusing(false);
    void queryClient.invalidateQueries({ queryKey: ['seller'] });
  };
  const accept = useMutation({
    mutationFn: async (readyInMinutes: PrepMinutes) =>
      unwrap(
        await api.POST('/v1/seller/orders/{id}/accept', {
          params: { path: { id } },
          body: { readyInMinutes },
        }),
      ),
    onSuccess: done,
  });
  const ready = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST('/v1/seller/orders/{id}/ready', { params: { path: { id } } })),
    onSuccess: done,
  });
  const refuse = useMutation({
    mutationFn: async (why: string) =>
      unwrap(
        await api.POST('/v1/seller/orders/{id}/reject', {
          params: { path: { id } },
          body: { reason: why },
        }),
      ),
    onSuccess: done,
  });
  const answer = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/seller/orders/{id}/dispute-response', {
          params: { path: { id } },
          body: { choice: choice!, message: message.trim() },
        }),
      ),
    onSuccess: done,
  });

  if (order.isPending) return <Loading />;
  if (order.isError)
    return <Failure message={errorMessage(order.error)} onRetry={() => void order.refetch()} />;
  const o = order.data;
  const chosenPrep = prep ?? (shop.data?.defaultPrepMinutes as PrepMinutes | undefined) ?? 30;
  const error = accept.error ?? ready.error ?? refuse.error ?? answer.error;

  const refuseFooter = (
    <>
      <Text style={styles.label}>{t.vendor.refuseWhy}</Text>
      <View style={styles.wrap}>
        {t.seller.rejectReasons.map((r) => (
          <Chip key={r} label={r} selected={reason === r} onPress={() => setReason(r)} />
        ))}
      </View>
      <Field label={t.dispute.reasons.other} value={reason} onChangeText={setReason} />
      <ErrorText message={error ? errorMessage(error) : null} />
      <Button
        label={t.vendor.confirmRefuse}
        onPress={() => refuse.mutate(reason.trim())}
        disabled={reason.trim().length < 3}
        loading={refuse.isPending}
        testID="seller-refuse-confirm"
      />
      <Button label={t.common.cancel} variant="ghost" onPress={() => setRefusing(false)} />
    </>
  );

  const footer =
    o.status === 'paid' ? (
      refusing ? (
        refuseFooter
      ) : (
        <>
          <ErrorText message={error ? errorMessage(error) : null} />
          <View style={styles.pair}>
            <Pressable
              style={styles.refuse}
              onPress={() => setRefusing(true)}
              accessibilityRole="button"
              testID="seller-refuse"
            >
              <Text style={styles.refuseText}>{t.vendor.refuse}</Text>
            </Pressable>
            <View style={styles.flex}>
              <Button
                label={t.vendor.accept}
                onPress={() => accept.mutate(chosenPrep)}
                loading={accept.isPending}
                testID="seller-accept"
              />
            </View>
          </View>
        </>
      )
    ) : o.status === 'preparing' ? (
      refusing ? (
        refuseFooter
      ) : (
        <>
          <ErrorText message={error ? errorMessage(error) : null} />
          <Button
            label={t.vendor.markReady}
            onPress={() => ready.mutate()}
            loading={ready.isPending}
            testID="seller-ready"
          />
          <Pressable
            onPress={() => {
              setReason(t.vendor.outOfStockReason);
              setRefusing(true);
            }}
            accessibilityRole="button"
            style={styles.linkButton}
          >
            <Text style={styles.dangerLink}>{t.vendor.outOfStock}</Text>
          </Pressable>
        </>
      )
    ) : o.status === 'disputed' && o.dispute?.status === 'open' ? (
      <>
        <ErrorText message={error ? errorMessage(error) : null} />
        <Button
          label={o.dispute.sellerChoice ? t.vendor.updateAnswer : t.vendor.sendAnswer}
          onPress={() => answer.mutate()}
          disabled={!choice}
          loading={answer.isPending}
          testID="dispute-send"
        />
      </>
    ) : o.status === 'delivered' || o.status === 'completed' ? (
      <>
        <Button label={t.vendor.myMoneyButton} onPress={() => router.push('/vendeur/argent')} />
        <Button
          label={t.vendor.backToOrders}
          variant="secondary"
          onPress={() => router.push('/vendeur/commandes')}
        />
      </>
    ) : undefined;

  return (
    <Screen footer={footer} refreshing={order.isRefetching} onRefresh={() => void order.refetch()}>
      <Stack.Screen
        options={{
          title: o.status === 'disputed' ? t.vendor.disputeTitle : o.publicRef,
          headerRight: () => (
            <View style={styles.headerBadge}>
              <StatusBadge status={o.status} testID="seller-order-status" />
            </View>
          ),
        }}
      />
      <MessagesButton orderId={o.id} />
      {o.status === 'paid' ? (
        <ToAccept order={o} prep={chosenPrep} setPrep={setPrep} />
      ) : o.status === 'preparing' ? (
        <Preparing order={o} />
      ) : o.status === 'ready_for_pickup' ? (
        <Ready order={o} rider={o.rider} delivery={o.delivery} />
      ) : o.delivery?.status === 'returning' ? (
        <>
          <Card style={styles.returning}>
            <Text style={styles.cardTitle}>{t.vendor.returnTitle}</Text>
            <Text style={styles.muted}>{t.vendor.returnBody(o.delivery.failureReason ?? '—')}</Text>
          </Card>
          {o.delivery.returnConfirmedAt ? (
            <Note icon={Check}>{t.vendor.returnOk}</Note>
          ) : (
            <RiderCode orderId={o.id} kind="return" />
          )}
        </>
      ) : o.status === 'in_delivery' || o.status === 'awaiting_collection' ? (
        <>
          <OrderSteps status={o.status} />
          <Card>
            <View style={styles.row}>
              <Truck color={colors.waiting} size={22} strokeWidth={1.8} />
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>{t.vendor.onTheWay}</Text>
                <Text style={styles.muted}>{t.vendor.onTheWayBody}</Text>
              </View>
            </View>
          </Card>
        </>
      ) : o.status === 'delivered' || o.status === 'completed' ? (
        <Delivered order={o} reviews={o.reviews} />
      ) : o.status === 'disputed' && o.dispute ? (
        <Dispute
          order={o}
          dispute={o.dispute}
          choice={choice}
          setChoice={setChoice}
          message={message}
          setMessage={setMessage}
        />
      ) : (
        <Card>
          <Text style={styles.cardTitle}>
            {o.status === 'refunded' ? t.vendor.refundedTitle : t.vendor.cancelledTitle}
          </Text>
          {o.cancelReason ? <Text style={styles.muted}>{o.cancelReason}</Text> : null}
        </Card>
      )}
      {o.status !== 'paid' && o.status !== 'delivered' && o.status !== 'completed' ? (
        <Card>
          <Items order={o} />
          <View style={styles.between}>
            <Text style={styles.muted}>{t.vendor.youReceive}</Text>
            <Text style={styles.cardTitle}>{formatXaf(o.sellerNet)}</Text>
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}

/** Une commande côté vendeur : chaque statut a son écran (maquettes vendeur). */
export default function SellerOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <RequireRole role="seller">
      <SellerOrderDetail id={id} />
    </RequireRole>
  );
}

const styles = StyleSheet.create({
  headerBadge: { marginRight: space.md, justifyContent: 'center' },
  returning: { borderColor: colors.danger, backgroundColor: colors.dangerSoft, gap: 4 },
  flex: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pair: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  cardTitle: { color: colors.text, fontWeight: '800', fontSize: font.body },
  body: { color: colors.text, fontSize: font.body, lineHeight: 21 },
  muted: { color: colors.muted, fontSize: font.small, lineHeight: 18 },
  small: { color: colors.muted, fontSize: 12 },
  label: { color: colors.text, fontWeight: '700', fontSize: font.small },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  itemTitle: { color: colors.text, fontWeight: '700', fontSize: font.body },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deadline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.dangerSoft,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
  },
  deadlineText: { flex: 1, color: colors.danger, fontWeight: '700', fontSize: font.body },
  deadlineTime: { color: colors.danger, fontWeight: '800', fontSize: font.body },
  tag: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  tagDark: { color: colors.onBrand, fontSize: 12, fontWeight: '700' },
  stars: { flexDirection: 'row', gap: 2 },
  hero: { alignItems: 'center', gap: space.sm, paddingVertical: space.md },
  heroIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: { color: colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  heroBody: { color: colors.muted, fontSize: font.body, textAlign: 'center', lineHeight: 21 },
  refuse: {
    paddingHorizontal: space.lg,
    minHeight: 52,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refuseText: { color: colors.danger, fontWeight: '800', fontSize: font.body },
  linkButton: { alignItems: 'center', paddingVertical: space.sm },
  dangerLink: { color: colors.danger, fontWeight: '700', fontSize: font.body },
  proof: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    justifyContent: 'center',
  },
});
