import createClient, { type Middleware } from 'openapi-fetch';
import type { components, paths } from './schema.js';

export type { components, paths };
export type Schemas = components['schemas'];
export type ProductCard = Schemas['ProductCard'];
export type Order = Schemas['Order'];
export type OrderStatus = Schemas['OrderStatus'];
export type Checkout = Schemas['Checkout'];
export type Payment = Schemas['Payment'];
export type User = Schemas['User'];
export type SellerOrder = Schemas['SellerOrder'];
export type SellerProduct = Schemas['SellerProduct'];
export type RiderMission = Schemas['RiderMission'];
export type ProductStatus = Schemas['ProductStatus'];
export type KycDocumentType = Schemas['KycDocumentType'];
export type VerificationStatus = Schemas['VerificationStatus'];
export type SupportOrder = Schemas['SupportOrder'];
export type DisputeReason = Schemas['DisputeReason'];
export type CommissionRule = Schemas['CommissionRule'];
export type ReconciliationRun = Schemas['ReconciliationRun'];
export type Discrepancy = Schemas['Discrepancy'];
export type StaffMember = Schemas['StaffMember'];
export type StaffDetail = Schemas['StaffDetail'];
export type SellerShop = Schemas['SellerShop'];
export type SellerReview = Schemas['SellerReview'];
export type SellerDispute = Schemas['SellerDispute'];
export type ProductCondition = Schemas['ProductCondition'];
export type PrepMinutes = Schemas['PrepMinutes'];
export type DisputeSellerChoice = Schemas['DisputeSellerChoice'];
/** Ligne de « Mes produits ». */
export type SellerProductSummary =
  paths['/v1/seller/products']['get']['responses']['200']['content']['application/json']['items'][number];

export interface ClientOptions {
  baseUrl: string;
  /** Jeton de session courant (lu à chaque requête). */
  getToken?: () => string | null | Promise<string | null>;
  /** Appelé quand l'API répond 401 (session expirée ou révoquée). */
  onUnauthorized?: () => void;
  fetch?: typeof fetch;
}

/**
 * Client typé de l'API Zandu : chemins, paramètres, corps et réponses viennent du contrat
 * OpenAPI (`docs/api/openapi.yaml`). Si le contrat change, `pnpm generate` met les types à jour
 * et le compilateur signale chaque écran à adapter.
 */
export function createZanduClient(options: ClientOptions) {
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const session: Middleware = {
    async onRequest({ request }) {
      const token = await options.getToken?.();
      // Un en-tête donné par l'appelant prime (ex. fermer une ancienne session après déconnexion).
      if (token && !request.headers.has('authorization'))
        request.headers.set('authorization', `Bearer ${token}`);
      return request;
    },
    async onResponse({ response }) {
      if (response.status === 401) options.onUnauthorized?.();
      return response;
    },
  };
  client.use(session);
  return client;
}

export type ZanduClient = ReturnType<typeof createZanduClient>;

/** Erreur renvoyée par l'API, avec son code stable (`out_of_stock`, `otp_invalid`…). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

/** Renvoie les données ou lève une `ApiError` lisible (message en français fourni par l'API). */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.response.ok && result.data !== undefined) return result.data;
  if (result.response.ok) return undefined as T; // 202 / 204 sans corps
  const body = (result.error ?? {}) as ErrorBody;
  throw new ApiError(
    result.response.status,
    body.error?.code ?? 'network_error',
    body.error?.message ?? 'Le service est momentanément indisponible. Réessayez.',
    body.error?.details,
  );
}
