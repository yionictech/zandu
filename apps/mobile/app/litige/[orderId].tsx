import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api, errorMessage, unwrap } from '../../src/api';
import { t } from '../../src/i18n/fr';
import { colors, font, space } from '../../src/theme';
import { Button } from '../../src/ui/Button';
import { Chip, ErrorText, Field } from '../../src/ui/Form';
import { Screen, Section } from '../../src/ui/Layout';

type Reason = keyof typeof t.dispute.reasons;
const REASONS = Object.keys(t.dispute.reasons) as Reason[];

/** Signaler un problème (F12) : le paiement du vendeur est gelé jusqu'à la décision du support. */
export default function DisputeScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState<Reason | null>(null);
  const [description, setDescription] = useState('');

  const open = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/orders/{id}/disputes', {
          params: { path: { id: orderId } },
          body: { reason: reason!, description: description.trim() },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      router.back();
    },
  });

  return (
    <Screen
      footer={
        <>
          <ErrorText message={open.error ? errorMessage(open.error) : null} />
          <Button
            label={t.dispute.submit}
            onPress={() => open.mutate()}
            disabled={!reason || description.trim().length < 10}
            loading={open.isPending}
          />
        </>
      }
    >
      <Section title={t.dispute.reason}>
        <View style={styles.wrap}>
          {REASONS.map((r) => (
            <Chip
              key={r}
              label={t.dispute.reasons[r]}
              selected={reason === r}
              onPress={() => setReason(r)}
            />
          ))}
        </View>
      </Section>
      <Field
        label={t.dispute.description}
        value={description}
        onChangeText={setDescription}
        multiline
      />
      <Text style={styles.sla}>{t.dispute.sla}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  sla: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
});
