import type { DeliveryIncident } from '@zandu/api-client';
import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Phone } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { api, errorMessage, unwrap } from '../../../src/api';
import { t } from '../../../src/i18n/fr';
import { useRiderMe } from '../../../src/rider/ui';
import { RadioCard } from '../../../src/seller/ui';
import { colors, font, radius, space } from '../../../src/theme';
import { Button } from '../../../src/ui/Button';
import { ErrorText, Field } from '../../../src/ui/Form';
import { Eyebrow } from '../../../src/ui/kit';
import { Screen } from '../../../src/ui/Layout';
import { RequireRole } from '../../../src/ui/RequireRole';
import { Text } from '../../../src/ui/Text';

const KINDS = Object.keys(t.rider.incidents) as DeliveryIncident[];

function Incident({ orderId }: { orderId: string }) {
  const router = useRouter();
  const me = useRiderMe();
  const [kind, setKind] = useState<DeliveryIncident | null>(null);
  const [note, setNote] = useState('');
  const send = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/rider/deliveries/{id}/incident', {
          params: { path: { id: orderId } },
          body: { kind: kind!, ...(note.trim() ? { note: note.trim() } : {}) },
        }),
      ),
  });
  const partnerPhone = me.data?.partnerPhone;

  if (send.isSuccess)
    return (
      <Screen
        footer={<Button label={t.rider.backToList} onPress={() => router.back()} />}
        style={styles.done}
      >
        <Text style={styles.doneText} testID="incident-sent">
          {t.rider.incidentSent}
        </Text>
      </Screen>
    );

  return (
    <Screen
      footer={
        <>
          <ErrorText message={send.error ? errorMessage(send.error) : null} />
          <Button
            label={t.rider.sendIncident}
            onPress={() => send.mutate()}
            disabled={!kind}
            loading={send.isPending}
            testID="incident-send"
          />
          <Text style={styles.hint}>{t.rider.incidentHint}</Text>
        </>
      }
    >
      {partnerPhone ? (
        <Pressable
          style={styles.danger}
          onPress={() => void Linking.openURL(`tel:${partnerPhone}`)}
          accessibilityRole="button"
        >
          <View style={styles.dangerIcon}>
            <Phone color={colors.danger} size={20} strokeWidth={2} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.dangerTitle}>{t.rider.danger}</Text>
            <Text style={styles.dangerBody}>{t.rider.dangerBody}</Text>
          </View>
        </Pressable>
      ) : null}
      <Eyebrow>{t.rider.whatHappened}</Eyebrow>
      {KINDS.map((k) => (
        <RadioCard
          key={k}
          title={t.rider.incidents[k]}
          selected={kind === k}
          onPress={() => setKind(k)}
          testID={`incident-${k}`}
        />
      ))}
      <Field
        label={t.rider.details}
        value={note}
        onChangeText={setNote}
        placeholder={t.rider.detailsPlaceholder}
        maxLength={500}
        multiline
      />
    </Screen>
  );
}

/** Signaler un incident sur une course (maquette) : le support est prévenu tout de suite. */
export default function IncidentScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  return (
    <RequireRole role="rider">
      <Incident orderId={orderId} />
    </RequireRole>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  danger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.danger,
  },
  dangerIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.onBrand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerTitle: { fontSize: font.body, fontWeight: '800', color: colors.onBrand },
  dangerBody: { fontSize: font.small, color: colors.onBrand },
  hint: { fontSize: font.small, color: colors.muted, textAlign: 'center' },
  done: { flexGrow: 1, justifyContent: 'center' },
  doneText: { fontSize: font.body, color: colors.text, textAlign: 'center', lineHeight: 22 },
});
