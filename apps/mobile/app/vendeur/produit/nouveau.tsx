import { useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage, isNetworkError, newIdempotencyKey, unwrap } from '../../../src/api';
import { t } from '../../../src/i18n/fr';
import { useOnline } from '../../../src/network';
import { DRAFT_KEY, queueProduct } from '../../../src/seller/outbox';
import {
  emptyProductForm,
  isProductFormValid,
  ProductForm,
  type ProductFormValues,
} from '../../../src/seller/ProductForm';
import { loadJson, saveJson } from '../../../src/storage';
import { CameraPermissionError, pickImage, uploadImage } from '../../../src/upload';
import { Banner } from '../../../src/ui/Banner';
import { Button } from '../../../src/ui/Button';
import { ErrorText } from '../../../src/ui/Form';
import { Loading, Screen, Section } from '../../../src/ui/Layout';
import { PhotoStrip, type PhotoItem } from '../../../src/ui/PhotoStrip';
import { RequireRole } from '../../../src/ui/RequireRole';
import { Eyebrow } from '../../../src/ui/kit';
import { Text } from '../../../src/ui/Text';
import { colors, font, radius, space } from '../../../src/theme';
import { useSession } from '../../../src/session';

const MAX_PHOTOS = 6;
/** Un envoi doit être rattaché sous 24 h (règle de l'API) : au-delà, la photo est à reprendre. */
const DRAFT_PHOTO_TTL_MS = 23 * 3_600_000;

interface DraftPhoto extends PhotoItem {
  uploadId: string | null;
}

interface Draft {
  form: ProductFormValues;
  photos: DraftPhoto[];
  savedAt: number;
}

function NewProduct() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useSession();
  const online = useOnline();
  const [form, setForm] = useState<ProductFormValues>(emptyProductForm);
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [restored, setRestored] = useState<boolean | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);

  // Brouillon repris s'il existe (réseau coupé, appel reçu, application fermée).
  useEffect(() => {
    void loadJson<Draft | null>(DRAFT_KEY, null).then((draft) => {
      const fresh = draft && Date.now() - draft.savedAt < DRAFT_PHOTO_TTL_MS;
      if (draft) {
        setForm(draft.form);
        setPhotos(
          fresh
            ? draft.photos.map((p) => (p.state === 'uploading' ? { ...p, state: 'failed' } : p))
            : [],
        );
      }
      setRestored(!!draft && (draft.form.title !== '' || draft.photos.length > 0));
      loaded.current = true;
    });
  }, []);

  useEffect(() => {
    if (loaded.current) void saveJson(DRAFT_KEY, { form, photos, savedAt: Date.now() });
  }, [form, photos]);

  const update = (key: string, patch: Partial<DraftPhoto>) =>
    setPhotos((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const send = useCallback(async (photo: DraftPhoto) => {
    update(photo.key, { state: 'uploading' });
    try {
      const uploadId = await uploadImage('product_photo', photo);
      update(photo.key, { uploadId, state: 'ready' });
    } catch {
      update(photo.key, { state: 'failed' });
    }
  }, []);

  // Retour du réseau : les photos qui n'avaient pas pu partir sont renvoyées.
  useEffect(() => {
    if (!online) return;
    for (const photo of photos) if (photo.state === 'failed') void send(photo);
  }, [online]); // seulement au retour du réseau, pas à chaque photo

  const add = async (source: 'camera' | 'library') => {
    setError(null);
    setPicking(true);
    try {
      const image = await pickImage(source);
      if (!image) return;
      const photo: DraftPhoto = {
        key: newIdempotencyKey(),
        uri: image.uri,
        uploadId: null,
        state: 'uploading',
      };
      setPhotos((list) => [...list, photo]);
      if (online) void send(photo);
      else update(photo.key, { state: 'failed' });
    } catch (e) {
      setError(e instanceof CameraPermissionError ? t.upload.permission : errorMessage(e));
    } finally {
      setPicking(false);
    }
  };

  const ready = photos.filter((p) => p.state === 'ready' && p.uploadId);
  const uploading = photos.some((p) => p.state === 'uploading');
  // Sans réseau, la fiche est gardée avec ses photos et envoyée au retour du réseau.
  const valid =
    isProductFormValid(form) && !uploading && (online ? ready.length > 0 : photos.length > 0);

  const queue = async () => {
    await queueProduct(
      user!.id,
      form,
      photos.map((p) => ({
        key: p.key,
        uri: p.uri,
        uploadId: p.state === 'ready' ? p.uploadId : null,
      })),
    );
    await saveJson(DRAFT_KEY, null);
    router.replace({ pathname: '/vendeur/produits', params: { notice: 'queued' } });
  };

  /**
   * Brouillon côté serveur, photos rattachées, puis publication : le produit n'apparaît jamais
   * sans photo. En cas de coupure après la création, on reprend sur l'écran de modification.
   */
  const publish = async () => {
    setBusy(true);
    setError(null);
    if (!online) return queue();
    let productId: string | null = null;
    try {
      const created = unwrap(
        await api.POST('/v1/seller/products', {
          body: {
            title: form.title.trim(),
            description: form.description.trim(),
            price: Number(form.price),
            stock: form.stock,
            categoryId: form.categoryId!,
            condition: form.condition ?? 'new',
            lowStockThreshold: form.lowStockThreshold ?? 2,
            publish: false,
          },
        }),
      );
      productId = created.id;
      await saveJson(DRAFT_KEY, null);
      for (const photo of ready) {
        unwrap(
          await api.POST('/v1/seller/products/{id}/photos', {
            params: { path: { id: created.id } },
            body: { uploadId: photo.uploadId! },
          }),
        );
      }
      const published = unwrap(
        await api.PATCH('/v1/seller/products/{id}', {
          params: { path: { id: created.id } },
          body: { status: 'published' },
        }),
      );
      void queryClient.invalidateQueries({ queryKey: ['seller'] });
      router.replace({
        pathname: '/vendeur/produits',
        params: { notice: published.status === 'published' ? 'published' : 'review' },
      });
    } catch (e) {
      if (productId) {
        void queryClient.invalidateQueries({ queryKey: ['seller'] });
        router.replace(`/vendeur/produit/${productId}`);
        return;
      }
      if (isNetworkError(e)) return queue();
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  if (restored === null) return <Loading />;

  return (
    <Screen
      footer={
        <>
          <ErrorText message={error} />
          <Button
            label={uploading ? t.upload.sending : online ? t.seller.publish : t.seller.queueAction}
            onPress={() => void publish()}
            disabled={!valid}
            loading={busy}
            testID="product-publish"
          />
        </>
      }
    >
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => router.back()}
              style={styles.draft}
              accessibilityRole="button"
              accessibilityHint={t.vendor.draftSaved}
            >
              <Text style={styles.draftText}>{t.vendor.draft}</Text>
            </Pressable>
          ),
        }}
      />
      {restored ? <Banner message={t.seller.draftRestored} tone="brand" /> : null}
      <Section>
        <View style={styles.photosHead}>
          <Eyebrow>{t.vendor.photos}</Eyebrow>
          <Text style={styles.muted}>
            {photos.length} / {MAX_PHOTOS}
          </Text>
        </View>
        <PhotoStrip
          photos={photos}
          max={MAX_PHOTOS}
          busy={picking}
          onAdd={(source) => void add(source)}
          onRemove={(key) => setPhotos((list) => list.filter((p) => p.key !== key))}
          onRetry={(key) => {
            const photo = photos.find((p) => p.key === key);
            if (photo) void send(photo);
          }}
        />
        <Text style={styles.muted}>{t.vendor.photoTip}</Text>
      </Section>
      <Section>
        <ProductForm values={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
      </Section>
    </Screen>
  );
}

/** Nouveau produit : la photo d'abord, publié en moins de 5 minutes. */
export default function NewProductScreen() {
  return (
    <RequireRole role="seller">
      <NewProduct />
    </RequireRole>
  );
}

const styles = StyleSheet.create({
  photosHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  muted: { color: colors.muted, fontSize: font.small },
  draft: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    marginRight: space.md,
  },
  draftText: { color: colors.text, fontWeight: '700', fontSize: font.small },
});
