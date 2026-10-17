import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { HttpError } from '../../lib/errors.js';
import { handleProviderEvent } from './payments.service.js';
import { SimulatorProvider } from './simulator.js';

/**
 * Webhooks des agrégateurs. Le corps brut est conservé pour vérifier la signature HMAC :
 * seule une requête signée par l'agrégateur peut faire bouger de l'argent.
 */
export function webhookRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.removeContentTypeParser('application/json');
    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) =>
      done(null, body),
    );

    app.post('/v1/webhooks/payments/:provider', async (request, reply) => {
      const { provider: code } = z.object({ provider: z.string().max(40) }).parse(request.params);
      if (!ctx.providers.has(code))
        throw new HttpError(404, 'unknown_provider', 'Agrégateur inconnu');
      const event = ctx.providers
        .get(code)
        .parseWebhook(request.body as Buffer, request.headers, ctx.clock.now());
      if (!event) {
        request.log.warn({ provider: code }, 'Webhook à signature invalide rejeté');
        throw new HttpError(401, 'invalid_signature', 'Signature invalide');
      }
      const outcome = await handleProviderEvent(ctx, code, event);
      return reply.status(200).send({ outcome });
    });
  };
}

/**
 * Routes de développement : simulent la réponse de l'acheteur sur son téléphone, pour que
 * les équipes mobile et web testent l'écran d'attente sans argent réel. Jamais en production.
 */
export function simulatorDevRoutes(
  ctx: AppContext,
  simulator: SimulatorProvider,
): FastifyPluginAsync {
  return async (app) => {
    app.post('/dev/simulator/collections/:reference/:outcome', async (request) => {
      const { reference, outcome } = z
        .object({
          reference: z.uuid(),
          outcome: z.enum(['approve', 'insufficient_funds', 'declined']),
        })
        .parse(request.params);
      const event = simulator.customerResponds(reference, outcome);
      return { outcome: await handleProviderEvent(ctx, simulator.code, event) };
    });
  };
}
