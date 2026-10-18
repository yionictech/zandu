import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { actor, requireAuth, requireStaff } from '../auth/guards.js';
import {
  addStaff,
  changeRole,
  getStaff,
  listStaff,
  revokeStaff,
  signOutEverywhere,
} from './staff.service.js';

const IdParam = z.object({ id: z.uuid() });
const Role = z.enum(['support', 'admin']);

/** Comptes du personnel (F16), réservés aux administrateurs ; tout est journalisé. */
export function staffRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    app.addHook('preHandler', requireStaff(ctx));

    app.get('/v1/admin/staff', async (request) => {
      actor(request, 'admin');
      return listStaff(ctx);
    });

    app.get('/v1/admin/staff/:id', async (request) => {
      actor(request, 'admin');
      return getStaff(ctx, IdParam.parse(request.params).id);
    });

    app.post('/v1/admin/staff', async (request, reply) => {
      const a = actor(request, 'admin');
      const input = z
        .object({
          phone: z.string().min(8).max(20),
          fullName: z.string().trim().min(2).max(120),
          role: Role,
        })
        .parse(request.body);
      return reply.status(201).send(await addStaff(ctx, a, input));
    });

    app.post('/v1/admin/staff/:id/role', async (request) => {
      const a = actor(request, 'admin');
      const { role } = z.object({ role: Role }).parse(request.body);
      return changeRole(ctx, a, IdParam.parse(request.params).id, role);
    });

    app.post('/v1/admin/staff/:id/revoke', async (request, reply) => {
      const a = actor(request, 'admin');
      const { reason } = z
        .object({ reason: z.string().trim().min(3).max(300) })
        .parse(request.body);
      await revokeStaff(ctx, a, IdParam.parse(request.params).id, reason);
      return reply.status(204).send();
    });

    app.post('/v1/admin/staff/:id/sign-out', async (request) => {
      const a = actor(request, 'admin');
      return signOutEverywhere(ctx, a, IdParam.parse(request.params).id);
    });
  };
}
