import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../api';

/** Groupes de statuts des listes vendeur (puces « Toutes, Nouvelles, À préparer, En livraison »). */
export const ORDER_FILTERS = {
  todo: 'paid,preparing',
  new: 'paid',
  prepare: 'preparing,ready_for_pickup',
  shipping: 'in_delivery,awaiting_collection',
  done: 'delivered,completed,disputed,refunded,cancelled',
  all: '',
} as const;
export type OrderFilter = keyof typeof ORDER_FILTERS;

export const sellerKeys = {
  shop: ['seller', 'shop'] as const,
  dashboard: ['seller', 'dashboard'] as const,
  reviews: ['seller', 'reviews'] as const,
  balance: ['seller', 'balance'] as const,
  kyc: ['seller', 'kyc'] as const,
  orders: (filter: OrderFilter) => ['seller', 'orders', filter] as const,
  order: (id: string) => ['seller', 'order', id] as const,
  products: (archived: boolean) => ['seller', 'products', archived] as const,
  product: (id: string) => ['seller', 'product', id] as const,
};

export function useShop() {
  return useQuery({
    queryKey: sellerKeys.shop,
    queryFn: async () => unwrap(await api.GET('/v1/seller/shop')),
  });
}

export function useBalance() {
  return useQuery({
    queryKey: sellerKeys.balance,
    queryFn: async () => unwrap(await api.GET('/v1/seller/balance')),
  });
}

export function useSellerOrders(filter: OrderFilter) {
  return useQuery({
    queryKey: sellerKeys.orders(filter),
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/seller/orders', {
          params: { query: ORDER_FILTERS[filter] ? { status: ORDER_FILTERS[filter] } : {} },
        }),
      ).items,
    refetchInterval: filter === 'todo' ? 30_000 : false,
  });
}

/** Catégories où l'on peut ranger un produit : celles qui n'ont pas de sous-catégorie. */
export function useLeafCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () => unwrap(await api.GET('/v1/categories')),
    staleTime: 3_600_000,
    select: (all) => all.filter((c) => !all.some((child) => child.parentId === c.id)),
  });
}

export function useDashboard() {
  return useQuery({
    queryKey: sellerKeys.dashboard,
    queryFn: async () => unwrap(await api.GET('/v1/seller/dashboard')),
    refetchInterval: 30_000,
  });
}

export function useSellerReviews() {
  return useQuery({
    queryKey: sellerKeys.reviews,
    queryFn: async () => unwrap(await api.GET('/v1/seller/reviews')),
  });
}

/** Produits en vente et masqués (archivés), pour les filtres de « Mes produits ». */
export function useSellerProducts(archived: boolean) {
  return useQuery({
    queryKey: sellerKeys.products(archived),
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/seller/products', {
          params: { query: archived ? { status: 'archived' } : {} },
        }),
      ).items,
  });
}

/** Opérateur lisible : « Airtel Money ». */
export const operatorName = (operator: 'mtn' | 'airtel'): string =>
  operator === 'mtn' ? 'MTN MoMo' : 'Airtel Money';

/** Heure seule : « 14:40 ». */
export const timeOf = (iso: string): string =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Brazzaville',
  });
