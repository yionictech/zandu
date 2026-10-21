import type { OrderPolicy } from '@zandu/domain';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/pool.js';

/**
 * Délais d'acceptation proposés dans le back-office (minutes). La maquette montre 10 min ; la
 * recommandation (docs/ux/03 §4.4) est de commencer à 2 h et de descendre si les vendeurs suivent.
 */
export const ACCEPTANCE_CHOICES = [10, 30, 60, 120, 240, 720, 1440] as const;
export type AcceptanceMinutes = (typeof ACCEPTANCE_CHOICES)[number];

export interface AcceptanceSetting {
  minutes: number;
  /** `default` : valeur de SELLER_ACCEPT_HOURS ; `custom` : choisie dans le back-office. */
  source: 'default' | 'custom';
  updatedAt: Date | null;
  updatedBy: string | null;
}

export async function acceptanceSetting(ctx: AppContext, db: Db): Promise<AcceptanceSetting> {
  const { rows } = await db.query<{ value: number; updated_at: Date; name: string | null }>(
    `SELECT s.value, s.updated_at, coalesce(u.full_name, u.phone) AS name
     FROM platform_settings s LEFT JOIN users u ON u.id = s.updated_by
     WHERE s.key = 'seller_acceptance_minutes'`,
  );
  const row = rows[0];
  return row
    ? {
        minutes: Number(row.value),
        source: 'custom',
        updatedAt: row.updated_at,
        updatedBy: row.name,
      }
    : {
        minutes: Math.round(ctx.config.orderPolicy.sellerAcceptanceHours * 60),
        source: 'default',
        updatedAt: null,
        updatedBy: null,
      };
}

/**
 * Règles des commandes en vigueur : la configuration du serveur, avec le délai d'acceptation
 * réglé dans le back-office s'il l'a été. Le délai s'applique aux commandes payées ensuite.
 */
export async function orderPolicy(ctx: AppContext, db: Db): Promise<OrderPolicy> {
  const { minutes, source } = await acceptanceSetting(ctx, db);
  return source === 'custom'
    ? { ...ctx.config.orderPolicy, sellerAcceptanceHours: minutes / 60 }
    : ctx.config.orderPolicy;
}
