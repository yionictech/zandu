import Fastify, { type FastifyInstance } from 'fastify';
import type { AppContext } from './context.js';
import { errorHandler } from './lib/errors.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { catalogRoutes } from './modules/catalog/catalog.routes.js';
import { checkoutRoutes } from './modules/checkout/checkout.routes.js';
import { orderRoutes } from './modules/orders/orders.routes.js';
import { SimulatorProvider } from './modules/payments/simulator.js';
import { simulatorDevRoutes, webhookRoutes } from './modules/payments/webhooks.routes.js';

export async function buildApp(
  ctx: AppContext,
  options: { logger?: boolean } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: ctx.config.env === 'production' ? 'info' : 'debug',
            // Jamais de jeton de session ni de code dans les journaux.
            redact: ['req.headers.authorization', 'req.headers["x-simulator-signature"]'],
          },
    trustProxy: true,
    bodyLimit: 256 * 1024,
  });
  app.decorateRequest('user', null);
  app.setErrorHandler(errorHandler);

  app.get('/health', async () => {
    await ctx.pool.query('SELECT 1');
    return { status: 'ok' };
  });

  await app.register(authRoutes(ctx));
  await app.register(catalogRoutes(ctx));
  await app.register(checkoutRoutes(ctx));
  await app.register(orderRoutes(ctx));
  await app.register(adminRoutes(ctx));
  await app.register(webhookRoutes(ctx));

  if (ctx.config.env !== 'production' && ctx.providers.has('simulator')) {
    const simulator = ctx.providers.get('simulator');
    if (simulator instanceof SimulatorProvider)
      await app.register(simulatorDevRoutes(ctx, simulator));
  }
  return app;
}
