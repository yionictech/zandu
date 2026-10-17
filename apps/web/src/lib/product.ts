import { ApiError } from '@zandu/api-client';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { catalog } from './api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Fiche produit, partagée entre les métadonnées (aperçu WhatsApp) et la page : un seul appel. */
export const loadProduct = cache(async (id: string) => {
  if (!UUID.test(id)) notFound();
  try {
    return await catalog((api) => api.GET('/v1/products/{id}', { params: { path: { id } } }));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
});
