import { ADJUSTMENT_COUNTERPARTS, type AdjustmentCounterpart } from '@zandu/domain';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { audit } from '../admin/audit.js';
import { actor, requireAuth, requireStaff } from '../auth/guards.js';
import {
  assertControllable,
  getRun,
  listDiscrepancies,
  listRuns,
  reconcileDay,
  resolveDiscrepancy,
} from './reconciliation.service.js';

const IdParam = z.object({ id: z.uuid() });

/**
 * Rapprochement avec l'agrégateur (ADR-0015), réservé aux administrateurs : c'est la caisse.
 * Le contrôle de nuit tourne dans le worker ; ces routes le consultent, le relancent et
 * enregistrent la résolution des écarts (journal d'audit).
 */
export function reconciliationRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    app.addHook('preHandler', requireStaff(ctx));

    app.get('/v1/admin/reconciliation/runs', async (request) => {
      actor(request, 'admin');
      const { limit } = z
        .object({ limit: z.coerce.number().int().min(1).max(366).default(60) })
        .parse(request.query);
      return listRuns(ctx.pool, limit);
    });

    app.get('/v1/admin/reconciliation/runs/:id', async (request) => {
      actor(request, 'admin');
      return getRun(ctx.pool, IdParam.parse(request.params).id);
    });

    /** Contrôle (ou recontrôle) d'une journée ; la journée en cours s'arrête à maintenant. */
    app.post('/v1/admin/reconciliation/runs', async (request) => {
      const a = actor(request, 'admin');
      const input = z
        .object({
          date: z.iso.date(),
          provider: z.string().max(40).default(ctx.providers.defaultCode),
        })
        .parse(request.body ?? {});
      await assertControllable(ctx, input.provider, input.date);
      const run = await reconcileDay(ctx, input.provider, input.date, a.userId);
      await audit(
        ctx.pool,
        a,
        'reconciliation.run_requested',
        {
          type: 'reconciliation_run',
          id: run.id,
        },
        { ...input },
      );
      return run;
    });

    app.get('/v1/admin/reconciliation/discrepancies', async (request) => {
      actor(request, 'admin');
      const { status } = z
        .object({ status: z.enum(['open', 'all']).default('open') })
        .parse(request.query);
      return listDiscrepancies(ctx.pool, status);
    });

    app.post('/v1/admin/reconciliation/discrepancies/:id/resolve', async (request) => {
      const a = actor(request, 'admin');
      const input = z
        .object({
          note: z.string().trim().min(3).max(500),
          adjustment: z
            .enum(Object.keys(ADJUSTMENT_COUNTERPARTS) as [AdjustmentCounterpart])
            .optional(),
        })
        .parse(request.body);
      return resolveDiscrepancy(ctx, a, IdParam.parse(request.params).id, input);
    });
  };
}
