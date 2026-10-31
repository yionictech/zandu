import type { ProductCondition, SellerProduct } from '@zandu/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Text } from '../../../src/ui/Text';
import { api, errorMessage, newIdempotencyKey, unwrap } from '../../../src/api';
import { t } from '../../../src/i18n/fr';
import {
  isProductFormValid,
  ProductForm,
  type ProductFormValues,
} from '../../../src/seller/ProductForm';
import { sellerKeys } from '../../../src/seller/queries';
import { productStatusColor } from '../../../src/status';
import { font } from '../../../src/theme';
import { CameraPermissionError, pickImage, uploadImage } from '../../../src/upload';
import { Banner } from '../../../src/ui/Banner';
import { Button } from '../../../src/ui/Button';
import { ErrorText } from '../../../src/ui/Form';
import { Failure, Loading, Screen, Section } from '../../../src/ui/Layout';
import { PhotoStrip, type PhotoItem } from '../../../src/ui/PhotoStrip';
import { RequireRole } from '../../../src/ui/RequireRole';
import { SaleCard } from '../../../src/seller/SaleCard';

const MAX_PHOTOS = 6;

const toForm = (p: SellerProduct): ProductFormValues => ({
  title: p.title,
  price: String(p.price),
  stock: p.stock,
  categoryId: p.categoryId,
  description: p.description,
  condition: p.condition,
  lowStockThreshold: p.lowStockThreshold,
});

/** Champs réellement modifiés : seuls ceux-là sont envoyés (un vendeur non vérifié qui ne
 * change que le prix ou le stock ne repasse pas en modération). */
function changes(before: ProductFormValues, after: ProductFormValues) {
  const patch: {
    title?: string;
    price?: number;
    stock?: number;
    categoryId?: string;
    description?: string;
    condition?: ProductCondition;
    lowStockThreshold?: number;
  } = {};
  if (after.title.trim() !== before.title) patch.title = after.title.trim();
  if (after.price !== before.price) patch.price = Number(after.price);
  if (after.stock !== before.stock) patch.stock = after.stock;
  if (after.categoryId && after.categoryId !== before.categoryId)
    patch.categoryId = after.categoryId;
  if (after.description.trim() !== before.description) patch.description = after.description.trim();
  if (after.condition && after.condition !== before.condition) patch.condition = after.condition;
  if (after.lowStockThreshold !== undefined && after.lowStockThreshold !== before.lowStockThreshold)
    patch.lowStockThreshold = after.lowStockThreshold;
  return patch;
}

function EditProduct({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ProductFormValues | null>(null);
  const [pending, setPending] = useState<PhotoItem[]>([]);
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const product = useQuery({
    queryKey: sellerKeys.product(id),
    queryFn: async () =>
      unwrap(await api.GET('/v1/seller/products/{id}', { params: { path: { id } } })),
  });
  useEffect(() => {
    if (product.data && !form) setForm(toForm(product.data));
  }, [product.data, form]);

  const setPhotos = (photos: SellerProduct['photos']) =>
    queryClient.setQueryData<SellerProduct>(sellerKeys.product(id), (p) =>
      p ? { ...p, photos } : p,
    );

  const add = async (source: 'camera' | 'library') => {
    setPhotoError(null);
    setPicking(true);
    let key: string | null = null;
    try {
      const image = await pickImage(source);
      if (!image) return;
      key = newIdempotencyKey();
      setPending((list) => [...list, { key: key!, uri: image.uri, state: 'uploading' }]);
      const uploadId = await uploadImage('product_photo', image);
      const attached = unwrap(
        await api.POST('/v1/seller/products/{id}/photos', {
          params: { path: { id } },
          body: { uploadId },
        }),
      );
      setPhotos(attached.photos);
      void queryClient.invalidateQueries({ queryKey: sellerKeys.product(id) });
    } catch (e) {
      setPhotoError(e instanceof CameraPermissionError ? t.upload.permission : errorMessage(e));
    } finally {
      if (key) setPending((list) => list.filter((p) => p.key !== key));
      setPicking(false);
    }
  };

  const remove = useMutation({
    mutationFn: async (photoId: string) =>
      unwrap(
        await api.DELETE('/v1/seller/products/{id}/photos/{photoId}', {
          params: { path: { id, photoId } },
        }),
      ),
    onSuccess: (result) => setPhotos(result.photos),
  });

  const save = useMutation({
    mutationFn: async (status?: 'published' | 'archived') => {
      const body = { ...changes(toForm(product.data!), form!), ...(status ? { status } : {}) };
      if (Object.keys(body).length === 0) return null;
      return unwrap(
        await api.PATCH('/v1/seller/products/{id}', { params: { path: { id } }, body }),
      );
    },
    onSuccess: async (result, status) => {
      if (result) {
        setNotice(
          status === 'published'
            ? result.status === 'published'
              ? t.seller.published
              : t.seller.sentToReview
            : t.seller.saved,
        );
      }
      // Reprendre la version du serveur (statut, champs normalisés).
      await queryClient.invalidateQueries({ queryKey: ['seller'] });
      const fresh = queryClient.getQueryData<SellerProduct>(sellerKeys.product(id));
      if (fresh) setForm(toForm(fresh));
    },
  });

  if (product.isPending || !form) return <Loading />;
  if (product.isError)
    return <Failure message={errorMessage(product.error)} onRetry={() => void product.refetch()} />;
  const p = product.data;
  const photos: PhotoItem[] = [
    ...p.photos.map((photo) => ({ key: photo.id, uri: photo.url, state: 'ready' as const })),
    ...pending,
  ];
  const valid = isProductFormValid(form) && p.photos.length > 0;
  const primary =
    p.status === 'draft'
      ? { label: t.seller.publish, status: 'published' as const }
      : p.status === 'rejected'
        ? { label: t.seller.resubmit, status: 'published' as const }
        : { label: t.seller.save, status: undefined };

  return (
    <Screen
      footer={
        <>
          <ErrorText message={save.error ? errorMessage(save.error) : null} />
          <Button
            label={primary.label}
            onPress={() => save.mutate(primary.status)}
            disabled={!valid}
            loading={save.isPending}
            testID="product-save"
          />
          {p.status === 'archived' ? (
            <Button
              label={t.seller.unarchive}
              variant="secondary"
              onPress={() => save.mutate('published')}
            />
          ) : p.status !== 'draft' ? (
            <Button
              label={t.seller.archive}
              variant="ghost"
              onPress={() => save.mutate('archived')}
            />
          ) : null}
        </>
      }
    >
      <Stack.Screen options={{ title: t.seller.editProduct }} />
      <Text
        style={[styles.status, { color: productStatusColor(p.status) }]}
        testID="product-status"
      >
        ● {t.seller.productStatus[p.status]}
      </Text>
      {notice ? <Banner message={notice} tone="trust" /> : null}
      {p.status === 'rejected' && p.rejectionReason ? (
        <Banner message={t.seller.rejectedBecause(p.rejectionReason)} tone="danger" />
      ) : null}
      {p.photos.length === 0 ? <Banner message={t.seller.photoRequired} /> : null}
      <Section>
        <PhotoStrip
          photos={photos}
          max={MAX_PHOTOS}
          busy={picking}
          onAdd={(source) => void add(source)}
          onRemove={(key) => {
            // Une photo encore en cours d'envoi n'existe pas côté serveur.
            if (p.photos.some((photo) => photo.id === key)) remove.mutate(key);
          }}
        />
        <ErrorText message={photoError ?? (remove.error ? errorMessage(remove.error) : null)} />
      </Section>
      <Section>
        <ProductForm values={form} onChange={(patch) => setForm((f) => ({ ...f!, ...patch }))} />
      </Section>
      {p.status === 'published' ? (
        <SaleCard
          productId={id}
          price={p.price}
          compareAtPrice={p.compareAtPrice}
          saleEndsAt={p.saleEndsAt}
          onChange={() => {
            void (async () => {
              await queryClient.invalidateQueries({ queryKey: ['seller'] });
              const fresh = queryClient.getQueryData<SellerProduct>(sellerKeys.product(id));
              if (fresh) setForm(toForm(fresh));
              setNotice(t.promo.saved);
            })();
          }}
        />
      ) : null}
    </Screen>
  );
}

export default function EditProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <RequireRole role="seller">
      <EditProduct id={id} />
    </RequireRole>
  );
}

const styles = StyleSheet.create({
  status: { fontSize: font.body, fontWeight: '800' },
});
