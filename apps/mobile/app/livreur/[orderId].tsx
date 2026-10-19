import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../src/ui/Text';
import { api, errorCode, errorMessage, unwrap } from '../../src/api';
import { displayPhone } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { missionDestination } from '../../src/rider/MissionCard';
import { colors, font, radius, space } from '../../src/theme';
import { Banner } from '../../src/ui/Banner';
import { Button } from '../../src/ui/Button';
import { CodePad } from '../../src/ui/CodePad';
import { Chip, ErrorText } from '../../src/ui/Form';
import { Failure, Loading, Screen, Section } from '../../src/ui/Layout';
import { RequireRole } from '../../src/ui/RequireRole';

type Step =
  | { kind: 'pickup' }
  | { kind: 'atPickupPoint' }
  | { kind: 'handover'; code: string }
  | { kind: 'failed'; reason: string };

function CallLink({ phone }: { phone: string }) {
  return (
    <Pressable
      onPress={() => void Linking.openURL(`tel:${phone}`)}
      accessibilityRole="link"
      style={styles.call}
    >
      <Text style={styles.callText}>
        📞 {t.rider.call} · {displayPhone(phone)}
      </Text>
    </Pressable>
  );
}

function Mission({ orderId }: { orderId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState('');

  const mission = useQuery({
    queryKey: ['rider', 'mission', orderId],
    queryFn: async () =>
      unwrap(await api.GET('/v1/rider/deliveries/{id}', { params: { path: { id: orderId } } })),
  });
  const step = useMutation({
    mutationFn: async (s: Step) => {
      const params = { params: { path: { id: orderId } } };
      if (s.kind === 'pickup')
        return unwrap(await api.POST('/v1/rider/deliveries/{id}/pickup', params));
      if (s.kind === 'atPickupPoint')
        return unwrap(await api.POST('/v1/rider/deliveries/{id}/arrived-at-pickup-point', params));
      if (s.kind === 'handover')
        return unwrap(
          await api.POST('/v1/rider/deliveries/{id}/handover', {
            ...params,
            body: { code: s.code },
          }),
        );
      return unwrap(
        await api.POST('/v1/rider/deliveries/{id}/failed', {
          ...params,
          body: { reason: s.reason },
        }),
      );
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
  const locked = m.handoverAttemptsLeft === 0 || errorCode(step.error) === 'handover_locked';

  if (m.status === 'delivered') {
    return (
      <Screen style={styles.done}>
        <Stack.Screen options={{ title: m.publicRef }} />
        <Text style={styles.doneTitle} testID="handover-done">
          {t.rider.delivered}
        </Text>
        <Text style={styles.doneBody}>{t.rider.deliveredBody}</Text>
        <Button label={t.rider.backToList} onPress={() => router.replace('/livreur')} />
      </Screen>
    );
  }

  if (m.status === 'failed' || m.status === 'cancelled') {
    return (
      <Screen style={styles.done}>
        <Stack.Screen options={{ title: m.publicRef }} />
        <Text style={styles.doneBody}>{t.rider.failedReported}</Text>
        <Button label={t.rider.backToList} onPress={() => router.replace('/livreur')} />
      </Screen>
    );
  }

  const stepError = step.error
    ? errorCode(step.error) === 'invalid_handover_code'
      ? t.rider.wrongCode(m.handoverAttemptsLeft)
      : locked
        ? t.rider.locked
        : errorMessage(step.error)
    : null;

  const failure = failing ? (
    <Section title={t.rider.failedReason}>
      <View style={styles.wrap}>
        {t.rider.failedReasons.map((r) => (
          <Chip key={r} label={r} selected={reason === r} onPress={() => setReason(r)} />
        ))}
      </View>
      <Button
        label={t.rider.confirmFailed}
        onPress={() => step.mutate({ kind: 'failed', reason })}
        disabled={!reason}
        loading={step.isPending}
      />
      <Button label={t.common.cancel} variant="ghost" onPress={() => setFailing(false)} />
    </Section>
  ) : (
    <Button label={t.rider.failed} variant="ghost" onPress={() => setFailing(true)} />
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: m.publicRef }} />
      <View style={styles.header}>
        <Text style={styles.ref}>{m.publicRef}</Text>
        <Text style={styles.status}>{t.rider.status[m.status]}</Text>
      </View>
      <Banner message={`🛡 ${t.rider.prepaid}`} tone="trust" />

      {m.status === 'assigned' ? (
        <>
          <Section title={t.rider.pickupAt}>
            <Text style={styles.big}>{m.pickup.shopName}</Text>
            <Text style={styles.body}>
              {m.pickup.zone}, {m.pickup.city} · {t.common.items(m.itemCount)}
            </Text>
            <CallLink phone={m.pickup.phone} />
          </Section>
          <Section title={t.rider.deliverTo}>
            <Text style={styles.body}>{missionDestination(m)}</Text>
          </Section>
          <ErrorText message={stepError} />
          <Button
            label={t.rider.pickedUp}
            onPress={() => step.mutate({ kind: 'pickup' })}
            loading={step.isPending}
            testID="rider-pickup"
          />
        </>
      ) : (
        <>
          <Section title={t.rider.deliverTo}>
            <Text style={styles.big}>{m.recipient.recipientName}</Text>
            <Text style={styles.body}>{missionDestination(m)}</Text>
            {m.destination.pickupPoint ? (
              <Text style={styles.muted}>{m.destination.pickupPoint.landmark}</Text>
            ) : (
              <Text style={styles.muted}>{m.recipient.landmark}</Text>
            )}
            <CallLink phone={m.recipient.phone} />
          </Section>

          {m.deliveryMode === 'pickup_point' && m.status === 'picked_up' ? (
            <Button
              label={t.rider.atPickupPoint}
              variant="secondary"
              onPress={() => step.mutate({ kind: 'atPickupPoint' })}
              loading={step.isPending}
            />
          ) : null}

          <Section title={t.rider.codeTitle}>
            <Text style={styles.muted}>{t.rider.codeHint}</Text>
            {locked ? (
              <Banner message={t.rider.locked} tone="danger" />
            ) : (
              <>
                <CodePad value={code} onChange={setCode} disabled={step.isPending} />
                <ErrorText message={stepError} />
                <Button
                  label={t.rider.validate}
                  variant="trust"
                  onPress={() => step.mutate({ kind: 'handover', code })}
                  disabled={code.length !== 6}
                  loading={step.isPending}
                  testID="rider-handover"
                />
              </>
            )}
          </Section>
        </>
      )}
      {failure}
    </Screen>
  );
}

/** Mission : récupérer le colis, puis le remettre contre le code de l'acheteur (F10). */
export default function MissionScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  return (
    <RequireRole role="rider">
      <Mission orderId={orderId} />
    </RequireRole>
  );
}

const styles = StyleSheet.create({
  header: { gap: 2 },
  ref: { fontSize: font.headline, fontWeight: '900', color: colors.text, letterSpacing: 1 },
  status: { fontSize: font.body, fontWeight: '700', color: colors.waiting },
  big: { fontSize: font.title, fontWeight: '800', color: colors.text },
  body: { fontSize: font.body, color: colors.text },
  muted: { fontSize: font.small, color: colors.muted, lineHeight: 19 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  call: {
    alignSelf: 'flex-start',
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
  },
  callText: { color: colors.brand, fontWeight: '800', fontSize: font.body },
  done: { flexGrow: 1, justifyContent: 'center', alignItems: 'stretch', gap: space.lg },
  doneTitle: { fontSize: 40, fontWeight: '900', color: colors.trust, textAlign: 'center' },
  doneBody: { fontSize: font.body, color: colors.text, textAlign: 'center', lineHeight: 21 },
});
