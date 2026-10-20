import type { KycDocumentType } from '@zandu/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Camera, Check, Image as ImageIcon, UserRound } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { api, errorMessage, unwrap } from '../../src/api';
import { t } from '../../src/i18n/fr';
import { sellerKeys, useShop } from '../../src/seller/queries';
import { colors, font, radius, space } from '../../src/theme';
import { CameraPermissionError, pickImage, uploadImage } from '../../src/upload';
import { Banner } from '../../src/ui/Banner';
import { Button } from '../../src/ui/Button';
import { ErrorText } from '../../src/ui/Form';
import { Card, HeaderBadge } from '../../src/ui/kit';
import { Failure, Loading, Screen } from '../../src/ui/Layout';
import { RequireRole } from '../../src/ui/RequireRole';
import { Text } from '../../src/ui/Text';

interface Requirement {
  key: string;
  label: string;
  done: string;
  /** Types qui satisfont l'exigence (carte d'identité OU passeport). */
  accepts: KycDocumentType[];
  /** Type envoyé quand le vendeur ajoute la pièce. */
  type: KycDocumentType;
  optional?: boolean;
}

function requirements(kind: 'individual' | 'business'): Requirement[] {
  const d = t.seller.documents;
  const list: Requirement[] = [
    {
      key: 'id',
      label: t.vendor.photographId,
      done: t.vendor.idAdded,
      accepts: ['national_id', 'passport'],
      type: 'national_id',
    },
    {
      key: 'selfie',
      label: t.vendor.addSelfie,
      done: t.vendor.selfieAdded,
      accepts: ['selfie'],
      type: 'selfie',
    },
  ];
  if (kind === 'business') {
    list.push(
      { key: 'rccm', label: d.rccm, done: d.rccm, accepts: ['rccm'], type: 'rccm' },
      { key: 'niu', label: d.niu, done: d.niu, accepts: ['niu'], type: 'niu' },
    );
  }
  list.push({
    key: 'residence',
    label: d.residence_proof,
    done: d.residence_proof,
    accepts: ['residence_proof'],
    type: 'residence_proof',
    optional: true,
  });
  return list;
}

/** Numéro d'étape dans un rond (maquette « Faites vérifier votre boutique »). */
function StepNumber({ n, done, active }: { n: number; done?: boolean; active?: boolean }) {
  return (
    <View style={[styles.number, done && styles.numberDone, active && styles.numberActive]}>
      {done ? (
        <Check color={colors.onBrand} size={14} strokeWidth={3} />
      ) : (
        <Text style={[styles.numberText, active && styles.numberTextActive]}>{n}</Text>
      )}
    </View>
  );
}

function Verification({ onboarding }: { onboarding: boolean }) {
  const router = useRouter();
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
  const s = shop.data;
  const received = new Set(k.documents.map((doc) => doc.type));
  const open = k.verificationStatus === 'unverified' || k.verificationStatus === 'rejected';

  return (
    <Screen
      footer={
        onboarding ? (
          <>
            <Button
              label={t.vendor.continue}
              onPress={() =>
                router.replace({ pathname: '/vendeur/compte', params: { onboarding: '1' } })
              }
              testID="kyc-continue"
            />
            <Text style={styles.footNote}>{t.vendor.privateNote}</Text>
          </>
        ) : undefined
      }
    >
      <Stack.Screen
        options={{
          title: onboarding ? t.seller.openTitle : t.seller.verificationTitle,
          headerRight: onboarding ? () => <HeaderBadge label={t.vendor.step(2)} /> : undefined,
        }}
      />
      <Text style={styles.title}>{t.vendor.verifyTitle}</Text>
      <Text style={styles.muted}>{t.vendor.verifyIntro}</Text>

      {k.verificationStatus === 'verified' ? (
        <Banner message={`✔ ${t.seller.verified}`} tone="trust" />
      ) : k.verificationStatus === 'pending_review' ? (
        <Banner message={t.seller.dossierComplete} tone="waiting" />
      ) : k.verificationStatus === 'rejected' && k.rejectionReason ? (
        <Banner message={t.seller.kycRejected(k.rejectionReason)} tone="danger" />
      ) : k.verificationStatus === 'suspended' ? (
        <Banner message={t.seller.suspended} tone="danger" />
      ) : null}

      <Card>
        <View style={styles.row}>
          <StepNumber n={1} done />
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>{t.vendor.shopInfo}</Text>
            <Text style={styles.small} numberOfLines={1}>
              {s ? `${s.shopName} · ${s.pickupZoneName}` : ''}
            </Text>
          </View>
          <Pressable
            onPress={() => router.push({ pathname: '/vendeur/ouvrir', params: { edit: '1' } })}
            hitSlop={8}
          >
            <Text style={styles.link}>{t.vendor.edit}</Text>
          </Pressable>
        </View>
      </Card>

      <Card highlight={open}>
        <View style={styles.row}>
          <StepNumber n={2} active={open} done={!open} />
          <Text style={[styles.cardTitle, styles.flex]}>{t.vendor.managerId}</Text>
        </View>
        <View style={styles.grid}>
          {requirements(s?.kind ?? 'individual').map((req) => {
            const done = req.accepts.some((type) => received.has(type));
            const sending = send.isPending && send.variables?.type === req.type;
            const Icon = req.key === 'selfie' ? UserRound : Camera;
            return (
              <View
                key={req.key}
                style={[styles.tile, req.optional && styles.tileWide, done && styles.tileDone]}
                testID={`kyc-${req.key}`}
              >
                {done ? (
                  <>
                    <Check color={colors.brand} size={22} strokeWidth={2.4} />
                    <Text style={styles.tileText}>{req.done}</Text>
                  </>
                ) : (
                  <>
                    <Pressable
                      style={styles.tileMain}
                      onPress={() => send.mutate({ type: req.type, source: 'camera' })}
                      disabled={!open || send.isPending}
                      accessibilityRole="button"
                      testID={`kyc-${req.key}-camera`}
                    >
                      <Icon color={colors.text} size={22} strokeWidth={1.8} />
                      <Text style={styles.tileText}>{sending ? t.upload.sending : req.label}</Text>
                    </Pressable>
                    {open ? (
                      <Pressable
                        onPress={() => send.mutate({ type: req.type, source: 'library' })}
                        disabled={send.isPending}
                        accessibilityRole="button"
                        accessibilityLabel={`${req.label} : ${t.upload.library}`}
                        style={styles.library}
                        hitSlop={6}
                      >
                        <ImageIcon color={colors.muted} size={14} />
                        <Text style={styles.small}>{t.upload.library}</Text>
                      </Pressable>
                    ) : null}
                  </>
                )}
              </View>
            );
          })}
        </View>
        <ErrorText
          message={
            send.error
              ? send.error instanceof CameraPermissionError
                ? t.upload.permission
                : errorMessage(send.error)
              : null
          }
        />
      </Card>

      <Pressable
        onPress={() =>
          router.push({
            pathname: '/vendeur/compte',
            params: onboarding ? { onboarding: '1' } : {},
          })
        }
        accessibilityRole="button"
      >
        <Card>
          <View style={styles.row}>
            <StepNumber n={3} done={!!s?.payoutAccountName && !!s?.termsAccepted} />
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{t.vendor.mobileMoneyAccount}</Text>
              <Text style={styles.small}>{t.vendor.mobileMoneyHint}</Text>
            </View>
          </View>
        </Card>
      </Pressable>
    </Screen>
  );
}

/** Vérification (F2), étape 2 de l'ouverture : pièces dans un espace privé, vues par le support. */
export default function VerificationScreen() {
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  return (
    <RequireRole role="seller">
      <Verification onboarding={onboarding === '1'} />
    </RequireRole>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.headline, fontWeight: '800', color: colors.text },
  muted: { color: colors.muted, fontSize: font.body, lineHeight: 21 },
  small: { color: colors.muted, fontSize: 12 },
  link: { color: colors.brand, fontWeight: '700', fontSize: font.small },
  footNote: { color: colors.muted, fontSize: 12, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1, gap: 2 },
  cardTitle: { color: colors.text, fontWeight: '700', fontSize: font.body },
  number: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.faint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberDone: { backgroundColor: colors.brand, borderColor: colors.brand },
  numberActive: { borderColor: colors.brand },
  numberText: { color: colors.muted, fontWeight: '800', fontSize: font.small },
  numberTextActive: { color: colors.brand },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    width: '48.5%',
    minHeight: 96,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.faint,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: space.sm,
  },
  tileWide: { width: '100%', minHeight: 60 },
  tileDone: {
    borderStyle: 'solid',
    borderColor: colors.brandBorder,
    backgroundColor: colors.brandSoft,
  },
  tileMain: { alignItems: 'center', gap: 6 },
  tileText: { color: colors.text, fontSize: font.small, fontWeight: '600', textAlign: 'center' },
  library: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
