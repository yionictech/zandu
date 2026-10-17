import type { ProductStatus } from '@zandu/api-client';
import { colors } from './theme';

/** Couleur d'un statut de commande : vert = argent en sécurité ou livré, rouge = problème. */
export const statusColor = (status: string): string =>
  ({
    completed: colors.trust,
    delivered: colors.trust,
    disputed: colors.danger,
    cancelled: colors.muted,
    refunded: colors.muted,
  })[status] ?? colors.waiting;

export const productStatusColor = (status: ProductStatus): string =>
  ({
    published: colors.trust,
    pending_review: colors.waiting,
    draft: colors.muted,
    rejected: colors.danger,
    archived: colors.muted,
  })[status];
