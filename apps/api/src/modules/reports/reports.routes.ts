import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { HttpError } from '../../lib/errors.js';
import { audit } from '../admin/audit.js';
import { actor, requireAuth, requireStaff } from '../auth/guards.js';
import { activityReport, currentMonth, ordersCsv, type Period } from './reports.service.js';

const MAX_DAYS = 366;

/** Période demandée (deux dates AAAA-MM-JJ incluses), ou le mois en cours. */
function period(ctx: AppContext, request: FastifyRequest): Period {
  const { from, to } = z
    .object({ from: z.iso.date().optional(), to: z.iso.date().optional() })
    .parse(request.query);
  if (!from && !to) return currentMonth(ctx.clock.now());
  if (!from || !to || from > to) {
    throw new HttpError(400, 'invalid_period', 'Indiquez une période : du (from) au (to) inclus');
  }
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
  if (days > MAX_DAYS) {
    throw new HttpError(400, 'invalid_period', `Période limitée à ${MAX_DAYS} jours`);
  }
  return { from, to };
}

/**
 * Rapports d'activité (F16), réservés aux administrateurs : le chiffre d'affaires et les
 * revenus de la plateforme ne concernent pas les agents du support.
 */
export function reportRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    app.addHook('preHandler', requireStaff(ctx));

    app.get('/v1/admin/reports/activity', async (request) => {
      actor(request, 'admin');
      return activityReport(ctx.pool, period(ctx, request));
    });

    /** Export pour le comptable ; chaque export est journalisé (données financières). */
    app.get('/v1/admin/reports/orders.csv', async (request, reply) => {
      const a = actor(request, 'admin');
      const p = period(ctx, request);
      const csv = await ordersCsv(ctx.pool, p);
      await audit(
        ctx.pool,
        a,
        'report.orders_exported',
        { type: 'report', id: 'orders' },
        { ...p },
      );
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header(
          'content-disposition',
          `attachment; filename="zandu-commandes-${p.from}-${p.to}.csv"`,
        )
        .header('cache-control', 'no-store')
        .send(csv);
    });
  };
}
