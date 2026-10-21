import type { OrderPolicy, WeeklyHours } from '@zandu/domain';
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
  /** Ne compter que les heures d'ouverture des boutiques qui les ont renseignées jour par jour. */
  openHoursOnly: boolean;
}

export async function acceptanceSetting(ctx: AppContext, db: Db): Promise<AcceptanceSetting> {
  const { rows } = await db.query<{
    key: string;
    value: number | boolean;
    updated_at: Date;
    name: string | null;
  }>(
    `SELECT s.key, s.value, s.updated_at, coalesce(u.full_name, u.phone) AS name
     FROM platform_settings s LEFT JOIN users u ON u.id = s.updated_by
     WHERE s.key IN ('seller_acceptance_minutes', 'seller_acceptance_open_hours_only')
     ORDER BY s.updated_at DESC`,
  );
  const minutes = rows.find((r) => r.key === 'seller_acceptance_minutes');
  const openHours = rows.find((r) => r.key === 'seller_acceptance_open_hours_only');
  const last = rows[0];
  return {
    minutes: minutes
      ? Number(minutes.value)
      : Math.round(ctx.config.orderPolicy.sellerAcceptanceHours * 60),
    source: minutes ? 'custom' : 'default',
    updatedAt: last?.updated_at ?? null,
    updatedBy: last?.name ?? null,
    openHoursOnly: openHours?.value === true,
  };
}

/**
 * Ce qu'il faut pour fixer l'échéance d'acceptation d'une commande payée : les règles en
 * vigueur et, si l'option est active et la boutique a renseigné ses horaires, sa semaine.
 */
export async function acceptanceRules(
  ctx: AppContext,
  db: Db,
  sellerId: string,
): Promise<{ policy: OrderPolicy; sellerHours: WeeklyHours | null }> {
  const setting = await acceptanceSetting(ctx, db);
  const policy =
    setting.source === 'custom'
      ? { ...ctx.config.orderPolicy, sellerAcceptanceHours: setting.minutes / 60 }
      : ctx.config.orderPolicy;
  if (!setting.openHoursOnly) return { policy, sellerHours: null };
  const { rows } = await db.query<{ weekly_hours: WeeklyHours | null }>(
    'SELECT weekly_hours FROM seller_profiles WHERE id = $1',
    [sellerId],
  );
  return { policy, sellerHours: rows[0]?.weekly_hours ?? null };
}
