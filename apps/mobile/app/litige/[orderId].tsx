import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Camera, Lock } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api, errorMessage, unwrap } from '../../src/api';
import { formatXaf } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { colors, font, radius, space } from '../../src/theme';
import { pickImage, uploadImage, type LocalImage } from '../../src/upload';
import { Button } from '../../src/ui/Button';
import { ErrorText, Field } from '../../src/ui/Form';
import { Card, Eyebrow } from '../../src/ui/kit';
import { Screen } from '../../src/ui/Layout';
import { Text } from '../../src/ui/Text';

type Reason = keyof typeof t.dispute.reasons;
const REASONS = Object.keys(t.dispute.reasons) as Reason[];

/**
 * Signaler un problème (F12, maquette) : le montant reste bloqué, le motif, la description et
 * une photo ; le paiement du vendeur est gelé jusqu'à la décision du support.
 */
export default function DisputeScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState<Reason | null>(null);
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<LocalImage | null>(null);

  const order = useQuery({
    queryKey: ['order', orderId],
    queryFn: async () =>
      unwrap(await api.GET('/v1/orders/{id}', { params: { path: { id: orderId } } })),
  });

  const open = useMutation({
    mutationFn: async () => {
      const dispute = unwrap(
        await api.POST('/v1/orders/{id}/disputes', {
          params: { path: { id: orderId } },
          body: { reason: reason!, description: description.trim() },
        }),
      );
      // La photo part après l'ouverture : un échec d'envoi ne bloque pas le signalement.
      if (photo && dispute.id) {
        const uploadId = await uploadImage('dispute_evidence', photo).catch(() => null);
        if (uploadId)
          await api.POST('/v1/disputes/{id}/evidence', {
            params: { path: { id: dispute.id } },
            body: { uploadId },
          });
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      router.back();
    },
  });

  const o = order.data;
  return (
    <Screen
      footer={
        <>
          <ErrorText message={open.error ? errorMessage(open.error) : null} />
          <Button
            label={t.dispute.send}
            onPress={() => open.mutate()}
            disabled={!reason || description.trim().length < 10}
            loading={open.isPending}
          />
          <Text style={styles.answer}>{t.dispute.answer}</Text>
        </>
      }
    >
      {o ? (
        <>
          <Card highlight>
            <View style={styles.blockedRow}>
              <Lock color={colors.brand} size={18} />
              <Text style={styles.blocked}>{t.dispute.blocked(formatXaf(o.total))}</Text>
            </View>
            <Text style={styles.muted}>{t.dispute.blockedBody}</Text>
          </Card>
          <Text style={styles.muted}>
            {t.dispute.order} <Text style={styles.ref}>{o.publicRef}</Text> · {o.seller.shopName}
          </Text>
        </>
      ) : null}

      <Eyebrow>{t.dispute.question}</Eyebrow>
      {REASONS.map((r) => {
        const selected = reason === r;
        return (
          <Pressable
            key={r}
            onPress={() => setReason(r)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={[styles.reason, selected && styles.reasonSelected]}
          >
            <View style={[styles.radio, selected && styles.radioOn]}>
              {selected ? <View style={styles.radioDot} /> : null}
            </View>
            <Text style={styles.reasonText}>{t.dispute.reasons[r]}</Text>
          </Pressable>
        );
      })}

      <Field
        label={t.dispute.describe}
        value={description}
        onChangeText={setDescription}
        placeholder={t.dispute.description}
        multiline
      />
      <View style={styles.photoRow}>
        {photo ? <Image source={{ uri: photo.uri }} style={styles.thumb} /> : null}
        <Pressable
          style={styles.addPhoto}
          onPress={() =>
            void pickImage('camera')
              .then((p) => p && setPhoto(p))
              .catch(() => undefined)
          }
          accessibilityRole="button"
        >
          <Camera color={colors.text} size={18} strokeWidth={1.8} />
          <Text style={styles.addPhotoText}>{t.dispute.addPhoto}</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  blockedRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  blocked: { color: colors.text, fontWeight: '800', fontSize: font.body },
  muted: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
  ref: { color: colors.text, fontWeight: '700' },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  reasonSelected: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.faint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.brand },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
  reasonText: { color: colors.text, fontSize: font.body, fontWeight: '500' },
  photoRow: { flexDirection: 'row', gap: space.sm },
  thumb: { width: 64, height: 64, borderRadius: radius.md },
  addPhoto: {
    flex: 1,
    minHeight: 64,
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.faint,
  },
  addPhotoText: { color: colors.text, fontWeight: '600', fontSize: font.small },
  answer: { color: colors.muted, fontSize: 12, textAlign: 'center' },
});
