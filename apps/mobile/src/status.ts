import type { ProductStatus } from '@zandu/api-client';
import { colors } from './theme';

/**
 * Couleur d'un statut de commande (maquettes) : cyan tant que l'argent attend (payée, en route),
 * citron quand le vendeur s'en occupe ou que le colis est remis, corail pour un problème.
 */
export const statusColor = (status: string): string =>
  ({
    preparing: colors.brand,
    ready_for_pickup: colors.brand,
    completed: colors.trust,
    delivered: colors.trust,
    disputed: colors.danger,
    cancelled: colors.muted,
    refunded: colors.muted,
  })[status] ?? colors.waiting;

/** Avancement d'une commande en cours (barre à 5 segments de « Mes commandes »). */
export const orderProgress = (status: string): number =>
  ({ paid: 1, preparing: 2, ready_for_pickup: 3, in_delivery: 4, awaiting_collection: 4 })[
    status
  ] ?? 5;

export const productStatusColor = (status: ProductStatus): string =>
  ({
    published: colors.trust,
    pending_review: colors.waiting,
    draft: colors.muted,
    rejected: colors.danger,
    archived: colors.muted,
  })[status];
