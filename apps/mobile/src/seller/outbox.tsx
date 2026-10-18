import { onlineManager } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import {
  api,
  errorCode,
  errorMessage,
  isNetworkError,
  newIdempotencyKey,
  queryClient,
  unwrap,
} from '../api';
import { t } from '../i18n/fr';
import { useSession } from '../session';
import { loadJson, saveJson } from '../storage';
import { LocalPhotoMissingError, uploadImage } from '../upload';
import type { ProductFormValues } from './ProductForm';

/**
 * Fiches produit préparées sans réseau (ADR-0017), gardées sur le téléphone et envoyées dès
 * que l'API répond : création (clé d'idempotence : un renvoi ne fait pas de doublon), envoi et
 * rattachement des photos, puis publication. Chaque étape franchie est enregistrée : une coupure
 * au milieu reprend là où l'envoi s'était arrêté. Une fiche refusée par l'API reste dans la
 * liste avec la raison, pour que le vendeur la corrige ; rien d'autre n'est rejoué.
 */
const OUTBOX_KEY = 'zandu.outbox.products';
/** Brouillon de l'écran « Nouveau produit » (repris pour corriger une fiche refusée). */
export const DRAFT_KEY = 'zandu.productDraft';

export interface QueuedPhoto {
  key: string;
  uri: string;
  uploadId: string | null;
  attached: boolean;
}

export interface QueuedProduct {
  /** Sert aussi de clé d'idempotence à la création. */
  id: string;
  /** Compte qui a préparé la fiche : un téléphone partagé n'envoie pas sous un autre compte. */
  userId: string;
  form: ProductFormValues;
  photos: QueuedPhoto[];
  productId: string | null;
  state: 'waiting' | 'sending' | 'failed';
  error: string | null;
  queuedAt: number;
}

interface OutboxState {
  items: QueuedProduct[];
  /** Fiches envoyées depuis l'ouverture de l'application (pour le dire au vendeur). */
  sent: { title: string; status: string }[];
}

let state: OutboxState = { items: [], sent: [] };
const listeners = new Set<() => void>();
const loaded = loadJson<QueuedProduct[]>(OUTBOX_KEY, []).then((items) => {
  // Un envoi interrompu (application fermée) reprendra au prochain passage.
  state = {
    ...state,
    items: items.map((i) => (i.state === 'sending' ? { ...i, state: 'waiting' } : i)),
  };
  listeners.forEach((l) => l());
});

function commit(next: OutboxState): void {
  state = next;
  void saveJson(OUTBOX_KEY, state.items);
  listeners.forEach((l) => l());
}

function patch(id: string, change: Partial<QueuedProduct>): QueuedProduct {
  commit({ ...state, items: state.items.map((i) => (i.id === id ? { ...i, ...change } : i)) });
  return state.items.find((i) => i.id === id)!;
}

export async function queueProduct(
  userId: string,
  form: ProductFormValues,
  photos: { key: string; uri: string; uploadId: string | null }[],
): Promise<void> {
  await loaded;
  const item: QueuedProduct = {
    id: newIdempotencyKey(),
    userId,
    form,
    photos: photos.map((p) => ({ ...p, attached: false })),
    productId: null,
    state: 'waiting',
    error: null,
    queuedAt: Date.now(),
  };
  commit({ ...state, items: [...state.items, item] });
  if (onlineManager.isOnline()) void flush(userId);
}

export function removeQueued(id: string): void {
  commit({ ...state, items: state.items.filter((i) => i.id !== id) });
}

/**
 * Fiche refusée à corriger : sans produit créé, elle redevient le brouillon de « Nouveau
 * produit » ; sinon, on la corrige sur l'écran de modification. Renvoie le produit créé.
 */
export async function takeBackQueued(id: string): Promise<string | null> {
  const item = state.items.find((i) => i.id === id);
  if (!item) return null;
  if (!item.productId) {
    await saveJson(DRAFT_KEY, {
      form: item.form,
      photos: item.photos.map((p) => ({ key: p.key, uri: p.uri, uploadId: null, state: 'failed' })),
      savedAt: Date.now(),
    });
  }
  removeQueued(id);
  return item.productId;
}

/** Envoi d'une photo puis rattachement ; un envoi trop ancien ou perdu est refait une fois. */
async function sendPhoto(item: QueuedProduct, photo: QueuedPhoto): Promise<QueuedProduct> {
  for (let attempt = 0; ; attempt++) {
    let uploadId = photo.uploadId;
    if (!uploadId) {
      uploadId = await uploadImage('product_photo', photo);
      item = patch(item.id, {
        photos: item.photos.map((p) => (p.key === photo.key ? { ...p, uploadId } : p)),
      });
    }
    try {
      unwrap(
        await api.POST('/v1/seller/products/{id}/photos', {
          params: { path: { id: item.productId! } },
          body: { uploadId },
        }),
      );
      return patch(item.id, {
        photos: item.photos.map((p) =>
          p.key === photo.key ? { ...p, uploadId, attached: true } : p,
        ),
      });
    } catch (error) {
      const code = errorCode(error);
      if (attempt > 0 || (code !== 'upload_expired' && code !== 'upload_missing')) throw error;
      photo = { ...photo, uploadId: null };
      item = patch(item.id, {
        photos: item.photos.map((p) => (p.key === photo.key ? photo : p)),
      });
    }
  }
}

async function send(item: QueuedProduct): Promise<void> {
  item = patch(item.id, { state: 'sending', error: null });
  if (!item.productId) {
    const { form } = item;
    const created = unwrap(
      await api.POST('/v1/seller/products', {
        params: { header: { 'Idempotency-Key': item.id } },
        body: {
          title: form.title.trim(),
          description: form.description.trim(),
          price: Number(form.price),
          stock: form.stock,
          categoryId: form.categoryId!,
          publish: false,
        },
      }),
    );
    item = patch(item.id, { productId: created.id });
  }
  for (const photo of item.photos) {
    if (!photo.attached) item = await sendPhoto(item, photo);
  }
  const published = unwrap(
    await api.PATCH('/v1/seller/products/{id}', {
      params: { path: { id: item.productId! } },
      body: { status: 'published' },
    }),
  );
  commit({
    items: state.items.filter((i) => i.id !== item.id),
    sent: [...state.sent, { title: item.form.title.trim(), status: published.status }],
  });
}

let running = false;

/** Envoie, une par une, les fiches en attente du compte connecté. */
export async function flush(userId: string): Promise<void> {
  await loaded;
  if (running) return;
  running = true;
  try {
    for (const item of state.items.filter((i) => i.userId === userId && i.state === 'waiting')) {
      try {
        await send(item);
      } catch (error) {
        if (isNetworkError(error)) {
          patch(item.id, { state: 'waiting' });
          return; // plus de réseau : la suite attendra son retour
        }
        patch(item.id, {
          state: 'failed',
          error:
            error instanceof LocalPhotoMissingError ? t.seller.photoMissing : errorMessage(error),
        });
      }
    }
  } finally {
    running = false;
    void queryClient.invalidateQueries({ queryKey: ['seller'] });
  }
}

export function useOutbox(): OutboxState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

/** Monté une fois : envoie les fiches en attente à l'ouverture et à chaque retour du réseau. */
export function OutboxRunner() {
  const { user } = useSession();
  const seller = user?.roles.includes('seller') ? user.id : null;
  useEffect(() => {
    if (!seller) return;
    if (onlineManager.isOnline()) void flush(seller);
    return onlineManager.subscribe((online) => {
      if (online) void flush(seller);
    });
  }, [seller]);
  return null;
}
