import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { forbidden } from '../../lib/errors.js';
import { currentUser, requireAuth } from '../auth/guards.js';
import { getPayment, initiatePayment, paymentView } from '../payments/payments.service.js';
import { checkoutView, createCheckout } from './checkout.service.js';

const CheckoutBody = z.object({
  items: z
    .array(z.object({ productId: z.uuid(), quantity: z.int().min(1).max(100) }))
    .min(1)
    .max(50),
  delivery: z.object({
    mode: z.enum(['home', 'pickup_point']),
    zoneId: z.uuid(),
    pickupPointId: z.uuid().optional(),
    recipientName: z.string().trim().min(2).max(80),
    phone: z.string().min(8).max(20),
    landmark: z.string().trim().min(5).max(300),
  }),
});

const idempotencyKey = (request: FastifyRequest): string | undefined => {
  const value = request.headers['idempotency-key'];
  return typeof value === 'string' ? value : undefined;
};

export function checkoutRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));

    app.post('/v1/checkouts', async (request, reply) => {
      const buyer = currentUser(request);
      const id = await createCheckout(
        ctx,
        buyer.id,
        CheckoutBody.parse(request.body),
        idempotencyKey(request),
      );
      return reply.status(201).send(await checkoutView(ctx.pool, id, buyer.id));
    });

    app.get('/v1/checkouts/:id', async (request) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      return checkoutView(ctx.pool, id, currentUser(request).id);
    });

    /** Lance la demande de paiement sur le téléphone (MTN MoMo ou Airtel Money). */
    app.post('/v1/checkouts/:id/payments', async (request, reply) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      const body = z
        .object({ operator: z.enum(['mtn', 'airtel']), phone: z.string().min(8).max(20) })
        .parse(request.body);
      const payment = await initiatePayment(
        ctx,
        currentUser(request).id,
        id,
        body,
        idempotencyKey(request),
      );
      return reply.status(201).send(paymentView(payment));
    });

    /** Interrogé par l'écran d'attente « Validez le paiement sur votre téléphone ». */
    app.get('/v1/payments/:id', async (request) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      const payment = await getPayment(ctx.pool, id);
      if (payment.buyer_id !== currentUser(request).id) throw forbidden();
      return paymentView(payment);
    });
  };
}
