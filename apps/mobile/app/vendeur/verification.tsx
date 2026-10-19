import type { KycDocumentType } from '@zandu/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../src/ui/Text';
import { api, errorMessage, unwrap } from '../../src/api';
import { t } from '../../src/i18n/fr';
import { sellerKeys, useShop } from '../../src/seller/queries';
import { colors, font, radius, space } from '../../src/theme';
import { CameraPermissionError, pickImage, uploadImage } from '../../src/upload';
import { Banner } from '../../src/ui/Banner';
import { Button } from '../../src/ui/Button';
import { ErrorText } from '../../src/ui/Form';
import { Failure, Loading, Screen } from '../../src/ui/Layout';
import { RequireRole } from '../../src/ui/RequireRole';

interface Requirement {
  key: string;
  label: string;
  hint: string;
  /** Types qui satisfont l'exigence (carte d'identité OU passeport). */
  accepts: KycDocumentType[];
  /** Type envoyé quand le vendeur ajoute la pièce. */
  type: KycDocumentType;
  optional?: boolean;
}

function requirements(kind: 'individual' | 'business'): Requirement[] {
  const d = t.seller.documents;
  const h = t.seller.documentHint;
  const list: Requirement[] = [
    {
      key: 'id',
      label: t.seller.idOrPassport,
      hint: h.national_id,
      accepts: ['national_id', 'passport'],
      type: 'national_id',
    },
    { key: 'selfie', label: d.selfie, hint: h.selfie, accepts: ['selfie'], type: 'selfie' },
  ];
  if (kind === 'business') {
    list.push(
      { key: 'rccm', label: d.rccm, hint: h.rccm, accepts: ['rccm'], type: 'rccm' },
      { key: 'niu', label: d.niu, hint: h.niu, accepts: ['niu'], type: 'niu' },
    );
  }
  list.push({
    key: 'residence',
    label: d.residence_proof,
    hint: h.residence_proof,
    accepts: ['residence_proof'],
    type: 'residence_proof',
    optional: true,
  });
  return list;
}

function Verification() {
  const queryClient = useQueryClient();
  const shop = useShop();
  const kyc = useQuery({
    queryKey: sellerKeys.kyc,
    queryFn: async () => unwrap(await api.GET('/v1/seller/kyc')),
  });
  const send = useMutation({
    mutationFn: async ({
      type,
      source,
    }: {
      type: KycDocumentType;
      source: 'camera' | 'library';
    }) => {
      const image = await pickImage(source);
      if (!image) return null;
      const uploadId = await uploadImage('kyc_document', image);
      return unwrap(await api.POST('/v1/seller/kyc-documents', { body: { uploadId, type } }));
    },
    onSuccess: (view) => {
      if (!view) return;
      queryClient.setQueryData(sellerKeys.kyc, view);
      void queryClient.invalidateQueries({ queryKey: sellerKeys.shop });
    },
  });

  if (kyc.isPending || shop.isPending) return <Loading />;
  if (kyc.isError)
    return <Failure message={errorMessage(kyc.error)} onRetry={() => void kyc.refetch()} />;
  const k = kyc.data;
  const received = new Set(k.documents.map((doc) => doc.type));
  const open = k.verificationStatus === 'unverified' || k.verificationStatus === 'rejected';

  return (
    <Screen>
      <Text style={styles.intro}>{t.seller.verificationIntro}</Text>
      {k.verificationStatus === 'verified' ? (
        <Banner message={`✔ ${t.seller.verified}`} tone="trust" />
      ) : k.verificationStatus === 'pending_review' ? (
        <Banner message={t.seller.dossierComplete} tone="waiting" />
      ) : k.verificationStatus === 'rejected' && k.rejectionReason ? (
        <Banner message={t.seller.kycRejected(k.rejectionReason)} tone="danger" />
      ) : k.verificationStatus === 'suspended' ? (
        <Banner message={t.seller.suspended} tone="danger" />
      ) : null}

      {requirements(shop.data?.kind ?? 'individual').map((req) => {
        const done = req.accepts.some((type) => received.has(type));
        const sending = send.isPending && send.variables?.type === req.type;
        return (
          <View key={req.key} style={styles.card} testID={`kyc-${req.key}`}>
            <View style={styles.row}>
              <Text style={styles.label}>{req.label}</Text>
              {done ? <Text style={styles.done}>{t.seller.received}</Text> : null}
            </View>
            <Text style={styles.hint}>{req.hint}</Text>
            {!done && open ? (
              <View style={styles.buttons}>
                <Button
                  label={t.upload.camera}
                  variant={req.optional ? 'secondary' : 'primary'}
                  onPress={() => send.mutate({ type: req.type, source: 'camera' })}
                  loading={sending}
                  disabled={send.isPending}
                  testID={`kyc-${req.key}-camera`}
                />
                <Button
                  label={t.upload.library}
                  variant="ghost"
                  onPress={() => send.mutate({ type: req.type, source: 'library' })}
                  disabled={send.isPending}
                />
              </View>
            ) : null}
          </View>
        );
      })}
      <ErrorText
        message={
          send.error
            ? send.error instanceof CameraPermissionError
              ? t.upload.permission
              : errorMessage(send.error)
            : null
        }
      />
    </Screen>
  );
}

/** Vérification d'identité (F2) : pièces envoyées dans un espace privé, vues par le seul support. */
export default function VerificationScreen() {
  return (
    <RequireRole role="seller">
      <Verification />
    </RequireRole>
  );
}

const styles = StyleSheet.create({
  intro: { color: colors.muted, fontSize: font.body, lineHeight: 21 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { flex: 1, fontSize: font.body, fontWeight: '700', color: colors.text },
  done: { color: colors.trust, fontWeight: '800' },
  hint: { color: colors.muted, fontSize: font.small },
  buttons: { gap: space.xs },
});
