import type { RiderMission } from '@zandu/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Check,
  CircleCheck,
  Clock3,
  Hourglass,
  Info,
  Lock,
  MapPin,
  MessageSquareText,
  Navigation,
  PhoneCall,
  ShieldCheck,
} from 'lucide-react-native';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { arrivalMinutes, distanceMeters, formatDistance, type LatLng } from '@zandu/domain';
import { api, errorCode, errorMessage, unwrap } from '../../src/api';
import { countdown } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { missionDestination } from '../../src/rider/MissionCard';
import {
  firstName,
  missionStep,
  PersonCard,
  RiderSteps,
  riderKeys,
  ShowCode,
  useRiderMe,
} from '../../src/rider/ui';
import { useShareLocation, type ShareState } from '../../src/rider/useShareLocation';
import { timeOf } from '../../src/seller/queries';
import { CheckRow } from '../../src/seller/ui';
import { colors, font, fonts, space } from '../../src/theme';
import { useNow } from '../../src/useNow';
import { Button } from '../../src/ui/Button';
import { CodePad } from '../../src/ui/CodePad';
import { Chip, ErrorText } from '../../src/ui/Form';
import { Badge, Card, Eyebrow, Note } from '../../src/ui/kit';
import { Failure, Loading, Screen } from '../../src/ui/Layout';
import { RequireRole } from '../../src/ui/RequireRole';
import { LiveMap } from '../../src/ui/LiveMap';
import { useStartCall } from '../../src/call/useStartCall';
import { MessagesButton } from '../../src/ui/MessagesButton';
import { Text } from '../../src/ui/Text';

type Action =
  | { kind: 'pickup' }
  | { kind: 'arrived' }
  | { kind: 'atPickupPoint' }
  | { kind: 'call' }
  | { kind: 'handover'; code: string }
  | { kind: 'return'; reason: 'absent' | 'refused'; note?: string }
  | { kind: 'returned' };

const minutesBetween = (from: string, to: string) =>
  Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000));

/** Lien discret « Un problème sur la route ? » vers le signalement d'incident. */
function ProblemLink({ orderId }: { orderId: string }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(`/livreur/incident/${orderId}`)}
      accessibilityRole="button"
      style={styles.link}
      testID="rider-incident"
    >
      <Text style={styles.dangerLink}>{t.rider.problem}</Text>
    </Pressable>
  );
}

/** Étape 1 : chez le vendeur, montrer le code de retrait puis vérifier le colis. */
function Pickup({
  m,
  checked,
  toggle,
}: {
  m: RiderMission;
  checked: number[];
  toggle(i: number): void;
}) {
  const startCall = useStartCall(m.orderId);
  return (
    <>
      <PersonCard
        name={m.pickup.shopName}
        line={`${m.pickup.zone}, ${m.pickup.city} · ${m.publicRef}`}
        phone={m.pickup.phone}
        appCall={() => startCall.mutate('seller')}
      />
      {m.pickupCode ? (
        <ShowCode
          title={t.rider.pickupCodeTitle}
          code={m.pickupCode}
          hint={t.rider.pickupCodeHint}
          testID="rider-pickup-code"
        />
      ) : null}
      {m.pickupConfirmedAt ? (
        <Note icon={CircleCheck}>{t.rider.pickupConfirmed}</Note>
      ) : (
        <Note icon={Hourglass} tone="waiting">
          {t.rider.pickupWaiting}
        </Note>
      )}
      <Card>
        <Text style={styles.cardTitle}>{t.rider.checkParcel}</Text>
        {[...m.items.map((i) => `${i.quantity} × ${i.title}`), t.rider.sealed].map((label, i) => (
          <CheckRow
            key={label}
            label={label}
            checked={checked.includes(i)}
            onPress={() => toggle(i)}
            testID={`rider-check-${i}`}
          />
        ))}
      </Card>
    </>
  );
}

/** Étape 2 : en route vers le client (ou le point relais). */
/** Ce que le livreur partage : sa position, pendant la course seulement. */
function SharingNote({ state }: { state: ShareState }) {
  if (state === 'sharing') return <Note icon={Navigation}>{t.rider.sharing}</Note>;
  if (state === 'denied')
    return (
      <Note icon={Navigation} tone="waiting">
        {t.rider.sharingDenied}
      </Note>
    );
  return null;
}

function OnTheWay({
  m,
  sharing,
  here,
}: {
  m: RiderMission;
  sharing: ShareState;
  here: LatLng | null;
}) {
  const startCall = useStartCall(m.orderId);
  const point = m.destination.pickupPoint;
  return (
    <>
      <Destination m={m} here={here} />
      {point ? (
        <Card>
          <Eyebrow>{t.rider.deliverTo}</Eyebrow>
          <Text style={styles.cardTitle}>{missionDestination(m)}</Text>
          <Text style={styles.muted}>{point.landmark}</Text>
        </Card>
      ) : (
        <>
          <PersonCard
            name={m.recipient.recipientName}
            line={`${m.destination.zone} · ${m.publicRef}`}
            phone={m.recipient.phone}
            appCall={() => startCall.mutate('buyer')}
          />
          <Card style={styles.landmark}>
            <MapPin color={colors.danger} size={20} strokeWidth={1.8} />
            <View style={styles.flex}>
              <Eyebrow color={colors.danger}>{t.rider.landmark}</Eyebrow>
              <Text style={styles.landmarkText}>{m.recipient.landmark || m.destination.zone}</Text>
            </View>
          </Card>
        </>
      )}
      <SharingNote state={sharing} />
      <Note icon={ShieldCheck}>{t.rider.prepaidLong}</Note>
    </>
  );
}

/**
 * Où livrer sur la carte (docs/ux/03 §16) : le repère posé par le client ou le point relais,
 * la distance qui reste et l'itinéraire dans l'application de cartes du téléphone.
 */
function Destination({ m, here }: { m: RiderMission; here: LatLng | null }) {
  const to = m.destination.location;
  if (!to) return <Note icon={MapPin}>{t.rider.noPin}</Note>;
  return (
    <Card>
      <LiveMap
        lat={to.lat}
        lng={to.lng}
        pin="home"
        other={here ? { point: here, pin: 'rider' } : null}
        label={t.rider.deliverTo}
        testID="destination-map"
      />
      <Text style={styles.muted}>
        {here
          ? t.rider.distanceLeft(formatDistance(distanceMeters(here, to)), arrivalMinutes(here, to))
          : missionDestination(m)}
      </Text>
      <Button
        label={t.rider.route}
        variant="secondary"
        onPress={() =>
          void Linking.openURL(
            `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}`,
          )
        }
        testID="destination-route"
      />
    </Card>
  );
}

/** Étape 3 : la remise contre le code du client. */
function Handover({
  m,
  code,
  setCode,
  error,
  disabled,
}: {
  m: RiderMission;
  code: string;
  setCode(code: string): void;
  error: string | null;
  disabled: boolean;
}) {
  const locked = m.handoverAttemptsLeft === 0;
  return (
    <>
      <View style={styles.center}>
        <View style={styles.roundIcon}>
          <Lock color={colors.brand} size={26} strokeWidth={1.8} />
        </View>
        <Text style={styles.headline}>
          {t.rider.askCode(firstName(m.recipient.recipientName) || m.recipient.recipientName)}
        </Text>
        <Text style={styles.centerText}>{t.rider.askCodeBody}</Text>
      </View>
      {locked ? (
        <Note icon={Info} tone="danger">
          {t.rider.locked}
        </Note>
      ) : (
        <CodePad value={code} onChange={setCode} disabled={disabled} />
      )}
      <ErrorText message={error} />
      <Note icon={ShieldCheck}>{t.rider.codeHint}</Note>
    </>
  );
}

/** Client injoignable : attente chronométrée, appels, puis absence (ou refus). */
function Waiting({
  m,
  onCall,
  refusing,
  setRefusing,
  reason,
  setReason,
}: {
  m: RiderMission;
  onCall(): void;
  refusing: boolean;
  setRefusing(v: boolean): void;
  reason: string;
  setReason(v: string): void;
}) {
  const now = useNow();
  const waited = m.arrivedAt ? now - new Date(m.arrivedAt).getTime() : 0;
  const total =
    m.absentAllowedAt && m.arrivedAt
      ? new Date(m.absentAllowedAt).getTime() - new Date(m.arrivedAt).getTime()
      : 0;
  return (
    <>
      <Card style={styles.wait}>
        <View style={styles.between}>
          <Eyebrow color={colors.danger}>{t.rider.waitOnSite}</Eyebrow>
          <Text style={styles.timer} testID="rider-wait-timer">
            {countdown(waited)}
            <Text style={styles.muted}> / {countdown(total)}</Text>
          </Text>
        </View>
        <Text style={styles.muted}>
          {m.destination.zone} · {m.recipient.landmark}
        </Text>
      </Card>
      <Card>
        <Text style={styles.cardTitle}>{t.rider.contactAttempts}</Text>
        {m.contacts.map((c, i) => (
          <View key={`${c.kind}-${i}`} style={styles.attempt}>
            {c.kind === 'sms' ? (
              <MessageSquareText color={colors.muted} size={18} strokeWidth={1.8} />
            ) : (
              <PhoneCall color={colors.muted} size={18} strokeWidth={1.8} />
            )}
            <Text style={styles.flexText}>{t.rider.contactKinds[c.kind]}</Text>
            <Text style={styles.muted}>{timeOf(c.at)}</Text>
          </View>
        ))}
        <Button
          label={t.rider.callAgain}
          variant="secondary"
          onPress={onCall}
          testID="rider-call-again"
        />
      </Card>
      <Note icon={Clock3} tone="waiting">
        {t.rider.absentRule(Math.round(total / 60_000))}
      </Note>
      {refusing ? (
        <Card>
          <Text style={styles.cardTitle}>{t.rider.refusedWhy}</Text>
          <View style={styles.wrap}>
            {t.rider.refusedReasons.map((r) => (
              <Chip key={r} label={r} selected={reason === r} onPress={() => setReason(r)} />
            ))}
          </View>
        </Card>
      ) : (
        <Pressable
          onPress={() => setRefusing(true)}
          accessibilityRole="button"
          style={styles.link}
          testID="rider-refused"
        >
          <Text style={styles.dangerLink}>{t.rider.refused}</Text>
        </Pressable>
      )}
    </>
  );
}

/** Retour : rapporter le colis au vendeur, avec le code de retour. */
function Return({
  m,
  intact,
  setIntact,
}: {
  m: RiderMission;
  intact: boolean;
  setIntact(v: boolean): void;
}) {
  const startCall = useStartCall(m.orderId);
  return (
    <>
      <Card>
        <Text style={styles.cardTitle}>{t.rider.returnHeadline}</Text>
        <Text style={styles.muted}>{t.rider.returnBody}</Text>
      </Card>
      <Eyebrow>{t.rider.destination}</Eyebrow>
      <PersonCard
        name={m.pickup.shopName}
        line={`${m.pickup.zone}, ${m.pickup.city}`}
        phone={m.pickup.phone}
        appCall={() => startCall.mutate('seller')}
      />
      {m.returnCode ? (
        <ShowCode
          title={t.rider.returnCodeTitle}
          code={m.returnCode}
          hint={t.rider.returnCodeHint}
          testID="rider-return-code"
        />
      ) : null}
      {m.returnConfirmedAt ? <Note icon={CircleCheck}>{t.rider.returnConfirmed}</Note> : null}
      <Card>
        <CheckRow
          label={t.rider.intact}
          checked={intact}
          onPress={() => setIntact(!intact)}
          testID="rider-intact"
        />
      </Card>
    </>
  );
}

/** Course terminée : remise réussie, ou colis rendu au vendeur. */
function Done({ m }: { m: RiderMission }) {
  const me = useRiderMe();
  if (m.status !== 'delivered')
    return (
      <Card style={styles.center}>
        <Text style={styles.cardTitle}>{t.rider.status[m.status]}</Text>
        <Text style={styles.centerText}>
          {m.returnedAt ? t.rider.returnedDone : t.rider.failedReported}
        </Text>
      </Card>
    );
  const rows: Array<[string, string]> = [
    [t.rider.summary.order, m.publicRef],
    [t.rider.summary.route, `${m.pickup.zone} → ${m.destination.zone}`],
  ];
  if (m.pickedUpAt && m.deliveredAt)
    rows.push([
      t.rider.summary.duration,
      t.rider.minutes(minutesBetween(m.pickedUpAt, m.deliveredAt)),
    ]);
  if (me.data) rows.push([t.rider.summary.today, String(me.data.deliveredToday)]);
  return (
    <>
      <View style={styles.center}>
        <View style={styles.success}>
          <Check color={colors.onBrand} size={40} strokeWidth={3} />
        </View>
        <Text style={styles.headline} testID="handover-done">
          {t.rider.delivered}
        </Text>
        <Text style={styles.centerText}>
          {t.rider.deliveredBody(firstName(m.recipient.recipientName) || m.recipient.recipientName)}
        </Text>
      </View>
      <Card>
        {rows.map(([label, value]) => (
          <View key={label} style={styles.between}>
            <Text style={styles.muted}>{label}</Text>
            <Text style={styles.value}>{value}</Text>
          </View>
        ))}
      </Card>
    </>
  );
}

function Mission({ orderId }: { orderId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const now = useNow(1000);
  const [code, setCode] = useState('');
  const [checked, setChecked] = useState<number[]>([]);
  const [intact, setIntact] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState('');

  const mission = useQuery({
    queryKey: riderKeys.mission(orderId),
    queryFn: async () =>
      unwrap(await api.GET('/v1/rider/deliveries/{id}', { params: { path: { id: orderId } } })),
    // Plus souvent quand on attend le vendeur (code de retrait ou de retour).
    refetchInterval: (q) => {
      const d = q.state.data;
      const waitingSeller =
        (d?.status === 'assigned' && !d.pickupConfirmedAt) ||
        (d?.status === 'returning' && !d.returnConfirmedAt);
      return waitingSeller ? 4_000 : 20_000;
    },
  });
  // En route vers le client : la position est partagée (premier plan seulement).
  const { state: sharing, position: here } = useShareLocation(
    orderId,
    mission.data?.status === 'picked_up',
  );
  const step = useMutation({
    mutationFn: async (a: Action) => {
      const params = { params: { path: { id: orderId } } };
      switch (a.kind) {
        case 'pickup':
          return unwrap(await api.POST('/v1/rider/deliveries/{id}/pickup', params));
        case 'arrived':
          return unwrap(await api.POST('/v1/rider/deliveries/{id}/arrived', params));
        case 'atPickupPoint':
          return unwrap(
            await api.POST('/v1/rider/deliveries/{id}/arrived-at-pickup-point', params),
          );
        case 'call':
          return unwrap(await api.POST('/v1/rider/deliveries/{id}/contact-attempt', params));
        case 'handover':
          return unwrap(
            await api.POST('/v1/rider/deliveries/{id}/handover', {
              ...params,
              body: { code: a.code },
            }),
          );
        case 'return':
          return unwrap(
            await api.POST('/v1/rider/deliveries/{id}/return', {
              ...params,
              body: { reason: a.reason, ...(a.note ? { note: a.note } : {}) },
            }),
          );
        case 'returned':
          return unwrap(await api.POST('/v1/rider/deliveries/{id}/returned', params));
      }
    },
    onSuccess: (_, a) => {
      if (a.kind === 'return') setWaiting(false);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['rider'] });
    },
    onError: () => setCode(''),
  });

  if (mission.isPending) return <Loading />;
  if (mission.isError)
    return <Failure message={errorMessage(mission.error)} onRetry={() => void mission.refetch()} />;
  const m = mission.data;
  const current = missionStep(m);
  const home = m.deliveryMode === 'home';
  const handover = m.status === 'at_pickup_point' || (m.status === 'picked_up' && !!m.arrivedAt);
  const showWaiting = waiting && home && m.status === 'picked_up' && !!m.arrivedAt;

  const stepError = step.error
    ? errorCode(step.error) === 'invalid_handover_code'
      ? t.rider.wrongCode(m.handoverAttemptsLeft)
      : errorCode(step.error) === 'handover_locked'
        ? t.rider.locked
        : errorMessage(step.error)
    : null;

  const title =
    m.status === 'assigned'
      ? t.rider.pickupTitle
      : m.status === 'returning'
        ? t.rider.returnTitle
        : showWaiting
          ? t.rider.absentTitle
          : handover
            ? t.rider.handoverTitle
            : m.status === 'picked_up'
              ? t.rider.onTheWay
              : m.publicRef;

  const absentIn = m.absentAllowedAt ? new Date(m.absentAllowedAt).getTime() - now : 0;
  const allChecked = checked.length === m.items.length + 1;
  const toggle = (i: number) =>
    setChecked((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]));

  let footer;
  if (m.status === 'assigned') {
    footer = (
      <>
        <ErrorText message={stepError} />
        <Button
          label={t.rider.pickedUp}
          onPress={() => step.mutate({ kind: 'pickup' })}
          disabled={!m.pickupConfirmedAt || !allChecked}
          loading={step.isPending}
          testID="rider-pickup"
        />
        <ProblemLink orderId={orderId} />
      </>
    );
  } else if (m.status === 'returning') {
    footer = (
      <>
        <ErrorText message={stepError} />
        <Button
          label={t.rider.returned}
          onPress={() => step.mutate({ kind: 'returned' })}
          disabled={!m.returnConfirmedAt || !intact}
          loading={step.isPending}
          testID="rider-returned"
        />
        <ProblemLink orderId={orderId} />
      </>
    );
  } else if (showWaiting) {
    footer = (
      <>
        <ErrorText message={stepError} />
        {refusing ? (
          <Button
            label={t.rider.confirmRefused}
            variant="secondary"
            onPress={() => step.mutate({ kind: 'return', reason: 'refused', note: reason })}
            disabled={!reason}
            loading={step.isPending}
            testID="rider-confirm-refused"
          />
        ) : null}
        <Button
          label={
            absentIn > 0 ? t.rider.declareAbsentIn(countdown(absentIn)) : t.rider.declareAbsent
          }
          onPress={() => step.mutate({ kind: 'return', reason: 'absent' })}
          disabled={absentIn > 0}
          loading={step.isPending && !refusing}
          testID="rider-absent"
        />
        <Button
          label={t.rider.backToHandover}
          variant="ghost"
          onPress={() => {
            setWaiting(false);
            setRefusing(false);
          }}
        />
      </>
    );
  } else if (handover) {
    footer = (
      <>
        <Button
          label={t.rider.validate}
          onPress={() => step.mutate({ kind: 'handover', code })}
          disabled={code.length !== 6 || m.handoverAttemptsLeft === 0}
          loading={step.isPending}
          testID="rider-handover"
        />
        {home ? (
          <Pressable
            onPress={() => setWaiting(true)}
            accessibilityRole="button"
            style={styles.link}
            testID="rider-absent-or-refused"
          >
            <Text style={styles.dangerLink}>{t.rider.absentOrRefused}</Text>
          </Pressable>
        ) : null}
      </>
    );
  } else if (m.status === 'picked_up') {
    footer = (
      <>
        <ErrorText message={stepError} />
        <Button
          label={home ? t.rider.arrived : t.rider.atPickupPoint}
          onPress={() => step.mutate({ kind: home ? 'arrived' : 'atPickupPoint' })}
          loading={step.isPending}
          testID="rider-arrived"
        />
        <ProblemLink orderId={orderId} />
      </>
    );
  } else {
    footer = (
      <>
        <Button label={t.rider.backToList} onPress={() => router.replace('/livreur')} />
        <Button
          label={t.rider.seeHistory}
          variant="secondary"
          onPress={() => router.replace('/livreur/historique')}
        />
      </>
    );
  }

  return (
    <Screen
      footer={footer}
      refreshing={mission.isRefetching}
      onRefresh={() => void mission.refetch()}
    >
      <Stack.Screen
        options={{
          title,
          headerRight: () => (
            <View style={styles.headerBadge}>
              {showWaiting ? null : m.status === 'returning' || m.status === 'failed' ? (
                <Badge label={t.rider.notDelivered} tone="danger" />
              ) : (
                <Badge label={m.publicRef} />
              )}
            </View>
          ),
        }}
      />
      {m.status !== 'returning' ? <RiderSteps step={current} /> : null}
      {m.status === 'delivered' ? null : <MessagesButton orderId={orderId} />}
      {m.status === 'assigned' ? (
        <Pickup m={m} checked={checked} toggle={toggle} />
      ) : m.status === 'returning' ? (
        <Return m={m} intact={intact} setIntact={setIntact} />
      ) : showWaiting ? (
        <Waiting
          m={m}
          onCall={() => {
            step.mutate({ kind: 'call' });
            void Linking.openURL(`tel:${m.recipient.phone}`);
          }}
          refusing={refusing}
          setRefusing={setRefusing}
          reason={reason}
          setReason={setReason}
        />
      ) : handover ? (
        <Handover m={m} code={code} setCode={setCode} error={stepError} disabled={step.isPending} />
      ) : m.status === 'picked_up' ? (
        <OnTheWay m={m} sharing={sharing} here={here} />
      ) : (
        <Done m={m} />
      )}
    </Screen>
  );
}

/**
 * Une course (maquette « Livreur ») en 4 étapes : récupérer avec le code de retrait, en route,
 * remise contre le code du client (ou attente, absence et retour au vendeur), terminé.
 */
export default function MissionScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  return (
    <RequireRole role="rider">
      <Mission orderId={orderId} />
    </RequireRole>
  );
}

const styles = StyleSheet.create({
  headerBadge: { marginRight: space.md },
  cardTitle: { fontSize: font.body, fontWeight: '800', color: colors.text },
  muted: { fontSize: font.small, color: colors.muted, lineHeight: 19 },
  flex: { flex: 1, gap: 4 },
  flexText: { flex: 1, fontSize: font.body, color: colors.text },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  value: { fontSize: font.body, fontWeight: '700', color: colors.text },
  landmark: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  landmarkText: { fontSize: font.title, fontWeight: '800', color: colors.text, lineHeight: 24 },
  center: { alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  centerText: { fontSize: font.body, color: colors.muted, textAlign: 'center', lineHeight: 21 },
  headline: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.text,
    textAlign: 'center',
    lineHeight: 30,
  },
  roundIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  success: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wait: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  timer: { fontFamily: fonts.display, fontSize: 22, color: colors.text },
  attempt: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 6 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  link: { alignItems: 'center', paddingVertical: space.sm },
  dangerLink: { color: colors.danger, fontWeight: '700', fontSize: font.body },
});
