import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { withTx } from '../../db/pool.js';
import { HttpError, notFound } from '../../lib/errors.js';
import { actor, requireAuth, requireStaff } from '../auth/guards.js';
import { audit } from './audit.js';

interface RuleRow {
  id: string;
  scope: 'default' | 'category' | 'seller';
  categoryId: string | null;
  categoryName: string | null;
  sellerId: string | null;
  shopName: string | null;
  rateBps: number;
  validFrom: Date;
  validTo: Date | null;
  note: string | null;
  createdAt: Date;
}

const NewRule = z
  .object({
    scope: z.enum(['default', 'category', 'seller']),
    categoryId: z.uuid().optional(),
    sellerId: z.uuid().optional(),
    /** Points de base : 1 000 = 10 %. Plafond du domaine : 50 %. */
    rateBps: z.number().int().min(0).max(5000),
    validFrom: z.iso.datetime({ offset: true }).optional(),
    validTo: z.iso.datetime({ offset: true }).optional(),
    note: z.string().trim().min(3).max(200),
  })
  .refine(
    (r) =>
      (r.scope === 'default' && !r.categoryId && !r.sellerId) ||
      (r.scope === 'category' && r.categoryId && !r.sellerId) ||
      (r.scope === 'seller' && r.sellerId && !r.categoryId),
    { message: 'Cible incohérente avec la portée de la règle' },
  );

/**
 * Règles de commission (décision D8) : modifiables par un administrateur sans développeur.
 * Une règle n'est jamais réécrite. Une règle permanente prend effet à sa date et termine
 * l'ancienne à cette même date ; une règle temporaire (offre) passe devant sans rien terminer :
 * à son expiration, la règle habituelle s'applique de nouveau. Les commandes passées gardent
 * le taux figé au moment de l'achat.
 */
export function commissionRuleRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    app.addHook('preHandler', requireStaff(ctx));

    app.get('/v1/admin/commission-rules', async (request) => {
      actor(request, 'admin');
      const now = ctx.clock.now();
      const { rows } = await ctx.pool.query<RuleRow>(
        `SELECT r.id, r.scope, r.category_id AS "categoryId", c.name AS "categoryName",
                r.seller_id AS "sellerId", s.shop_name AS "shopName", r.rate_bps AS "rateBps",
                r.valid_from AS "validFrom", r.valid_to AS "validTo", r.note, r.created_at AS "createdAt"
         FROM commission_rules r
         LEFT JOIN categories c ON c.id = r.category_id
         LEFT JOIN seller_profiles s ON s.id = r.seller_id
         ORDER BY array_position(ARRAY['default', 'category', 'seller'], r.scope::text),
                  coalesce(c.name, s.shop_name), r.valid_from DESC`,
      );
      const inForce = (r: RuleRow) => r.validFrom <= now && (!r.validTo || r.validTo > now);
      const targetOf = (r: RuleRow) => `${r.scope}:${r.categoryId ?? ''}:${r.sellerId ?? ''}`;
      // Pour chaque cible, la règle en vigueur la plus récente s'applique (comme au paiement).
      const applying = new Map<string, RuleRow>();
      for (const r of rows.filter(inForce)) {
        const best = applying.get(targetOf(r));
        if (!best || r.validFrom > best.validFrom) applying.set(targetOf(r), r);
      }
      return {
        items: rows.map((r) => ({
          ...r,
          status:
            r.validFrom > now
              ? ('scheduled' as const)
              : !inForce(r)
                ? ('ended' as const)
                : applying.get(targetOf(r)) === r
                  ? ('active' as const)
                  : ('overridden' as const),
        })),
      };
    });

    app.post('/v1/admin/commission-rules', async (request, reply) => {
      const a = actor(request, 'admin');
      const body = NewRule.parse(request.body);
      const now = ctx.clock.now();
      const validFrom = body.validFrom ? new Date(body.validFrom) : now;
      const validTo = body.validTo ? new Date(body.validTo) : null;
      // Une minute de tolérance : l'horloge du poste de l'administrateur peut avancer.
      if (validFrom.getTime() < now.getTime() - 60_000) {
        throw new HttpError(422, 'rule_in_past', 'Une règle ne peut pas commencer dans le passé');
      }
      if (validTo && validTo <= validFrom) {
        throw new HttpError(422, 'invalid_validity', 'La fin doit suivre le début');
      }
      if (validTo && body.scope === 'default') {
        throw new HttpError(422, 'default_rule_required', 'Le taux par défaut ne peut pas expirer');
      }
      const target = [body.scope, body.categoryId ?? null, body.sellerId ?? null] as const;
      const created = await withTx(ctx.pool, async (tx) => {
        if (body.categoryId) {
          const found = await tx.query('SELECT 1 FROM categories WHERE id = $1', [body.categoryId]);
          if (!found.rowCount) throw notFound('Catégorie');
        }
        if (body.sellerId) {
          const found = await tx.query('SELECT 1 FROM seller_profiles WHERE id = $1', [
            body.sellerId,
          ]);
          if (!found.rowCount) throw notFound('Boutique');
        }
        const sameTarget = `scope = $1::commission_scope AND category_id IS NOT DISTINCT FROM $2::uuid
                            AND seller_id IS NOT DISTINCT FROM $3::uuid`;
        const scheduled = await tx.query(
          `SELECT 1 FROM commission_rules WHERE ${sameTarget} AND valid_from >= $4 FOR UPDATE`,
          [...target, validFrom],
        );
        if (scheduled.rowCount) {
          throw new HttpError(
            409,
            'rule_already_scheduled',
            'Une règle est déjà programmée pour cette cible : annulez-la d’abord',
          );
        }
        // Règle permanente : celle en vigueur à la date d'effet se termine à cette date.
        // Règle temporaire : elle passe devant, la règle habituelle reprend à son expiration.
        const ended = validTo
          ? { rows: [] as Array<{ rate_bps: number }> }
          : await tx.query<{ rate_bps: number }>(
              `UPDATE commission_rules SET valid_to = $4
               WHERE ${sameTarget} AND valid_from < $4 AND (valid_to IS NULL OR valid_to > $4)
               RETURNING rate_bps`,
              [...target, validFrom],
            );
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO commission_rules (scope, category_id, seller_id, rate_bps, valid_from, valid_to, note, created_by)
           VALUES ($1::commission_scope, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [...target, body.rateBps, validFrom, validTo, body.note, a.userId],
        );
        const id = rows[0]!.id;
        await audit(
          tx,
          a,
          'commission_rule.created',
          { type: 'commission_rule', id },
          {
            scope: body.scope,
            categoryId: body.categoryId ?? null,
            sellerId: body.sellerId ?? null,
            rateBps: body.rateBps,
            previousRateBps: ended.rows[0]?.rate_bps ?? null,
            validFrom: validFrom.toISOString(),
            validTo: validTo?.toISOString() ?? null,
            note: body.note,
          },
        );
        return id;
      });
      return reply.status(201).send({ id: created });
    });

    /**
     * Termine maintenant une règle de catégorie ou de boutique (retour au taux du niveau
     * supérieur), ou annule une règle programmée qui n'a encore servi à aucune commande.
     */
    app.post('/v1/admin/commission-rules/:id/end', async (request, reply) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      const a = actor(request, 'admin');
      const now = ctx.clock.now();
      await withTx(ctx.pool, async (tx) => {
        const { rows } = await tx.query<{
          scope: string;
          category_id: string | null;
          seller_id: string | null;
          valid_from: Date;
          valid_to: Date | null;
          rate_bps: number;
        }>(
          `SELECT scope, category_id, seller_id, valid_from, valid_to, rate_bps
           FROM commission_rules WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const rule = rows[0];
        if (!rule) throw notFound('Règle');
        if (rule.valid_to && rule.valid_to <= now) {
          throw new HttpError(409, 'rule_already_ended', 'Cette règle est déjà terminée');
        }
        // Pas encore commencée (ou commencée à l'instant) : aucune commande ne l'a utilisée.
        const scheduled = rule.valid_from >= now;
        if (scheduled) {
          await tx.query('DELETE FROM commission_rules WHERE id = $1', [id]);
          // La règle qu'elle devait remplacer reste en vigueur.
          await tx.query(
            `UPDATE commission_rules SET valid_to = NULL
             WHERE scope = $1::commission_scope AND category_id IS NOT DISTINCT FROM $2::uuid
               AND seller_id IS NOT DISTINCT FROM $3::uuid AND valid_to = $4`,
            [rule.scope, rule.category_id, rule.seller_id, rule.valid_from],
          );
        } else if (rule.scope === 'default') {
          throw new HttpError(
            409,
            'default_rule_required',
            'Le taux par défaut se remplace, il ne se termine pas',
          );
        } else {
          await tx.query('UPDATE commission_rules SET valid_to = $2 WHERE id = $1', [id, now]);
        }
        await audit(
          tx,
          a,
          scheduled ? 'commission_rule.cancelled' : 'commission_rule.ended',
          { type: 'commission_rule', id },
          { rateBps: rule.rate_bps },
        );
      });
      return reply.status(204).send();
    });
  };
}
