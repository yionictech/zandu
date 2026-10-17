import {
  DomainError,
  applyPaymentSignal,
  captureLatePayment,
  capturePayment,
  parseCongoMobile,
  recordProviderFee,
  type MobileOperator,
  type PaymentSignal,
  type PaymentStatus,
} from '@zandu/domain';
import { SYSTEM, type AppContext } from '../../context.js';
import { withTx, type Db, type Tx } from '../../db/pool.js';
import { addMinutes, addSeconds } from '../../lib/clock.js';
import { HttpError, notFound } from '../../lib/errors.js';
import { claimIdempotency, completeIdempotency } from '../../lib/idempotency.js';
import { postJournal } from '../ledger/ledger.repository.js';
import { publish } from '../notifications/outbox.js';
import { applyOrderEvent } from '../orders/orders.service.js';
import { applyDisbursementResult } from '../payouts/disbursements.js';
import { payoutSpec } from '../payouts/payouts.service.js';
import { failureMessage, type ProviderEvent, type ProviderResult } from './provider.js';
import { createRefund, refundSpec } from './refunds.service.js';

export interface PaymentRow {
  id: string;
  checkout_id: string;
  buyer_id: string;
  provider: string;
  operator: MobileOperator;
  msisdn: string;
  amount: number;
  status: PaymentStatus;
  provider_ref: string | null;
  failure_code: string | null;
  late_success: boolean;
  expires_at: Date;
  created_at: Date;
}

export function paymentView(row: PaymentRow) {
  return {
    id: row.id,
    checkoutId: row.checkout_id,
    status: row.status,
    operator: row.operator,
    msisdn: row.msisdn,
    amount: row.amount,
    currency: 'XAF',
    expiresAt: row.expires_at,
    lateSuccess: row.late_success,
    failure: row.failure_code
      ? { code: row.failure_code, message: failureMessage(row.failure_code) }
      : null,
  };
}

export async function getPayment(db: Db, paymentId: string): Promise<PaymentRow> {
  const { rows } = await db.query<PaymentRow>('SELECT * FROM payments WHERE id = $1', [paymentId]);
  if (!rows[0]) throw notFound('Paiement');
  return rows[0];
}

/**
 * Lance un paiement Mobile Money pour un checkout. La demande arrive sur le téléphone de
 * l'acheteur, qui valide avec son code PIN ; le résultat revient par webhook (ou par
 * interrogation si le webhook se perd).
 */
export async function initiatePayment(
  ctx: AppContext,
  buyerId: string,
  checkoutId: string,
  input: { operator: MobileOperator; phone: string },
  idempotencyKey: string | undefined,
): Promise<PaymentRow> {
  const phone = parseCongoMobile(input.phone);
  const now = ctx.clock.now();
  const { ttlMinutes, checkoutMaxMinutes, pollIntervalSeconds, pollHorizonMinutes } =
    ctx.config.payments;
  const provider = ctx.providers.default;

  const { paymentId, replay } = await withTx(ctx.pool, async (tx) => {
    const previous = await claimIdempotency(tx, {
      userId: buyerId,
      key: idempotencyKey,
      method: 'POST',
      path: `/v1/checkouts/${checkoutId}/payments`,
      body: input,
    });
    if (previous) return { paymentId: previous, replay: true };

    const { rows } = await tx.query<{
      status: string;
      grand_total: number;
      expires_at: Date;
      created_at: Date;
    }>(
      'SELECT status, grand_total, expires_at, created_at FROM checkouts WHERE id = $1 AND buyer_id = $2 FOR UPDATE',
      [checkoutId, buyerId],
    );
    const checkout = rows[0];
    if (!checkout) throw notFound('Panier');
    if (checkout.status !== 'awaiting_payment') {
      throw new HttpError(409, 'checkout_not_payable', 'Ce panier est déjà payé ou a expiré');
    }
    const active = await tx.query<{ id: string }>(
      `SELECT id FROM payments WHERE checkout_id = $1 AND status IN ('created', 'pending')`,
      [checkoutId],
    );
    if (active.rows[0]) {
      throw new HttpError(
        409,
        'payment_in_progress',
        'Un paiement est déjà en attente de validation',
        {
          paymentId: active.rows[0].id,
        },
      );
    }
    // Chaque tentative dispose de 10 min, sans dépasser la durée de vie maximale du panier.
    const expiresAt = new Date(
      Math.min(
        addMinutes(now, ttlMinutes).getTime(),
        addMinutes(checkout.created_at, checkoutMaxMinutes).getTime(),
      ),
    );
    if (checkout.expires_at <= now || expiresAt <= now) {
      throw new HttpError(409, 'checkout_expired', 'Le délai de paiement de ce panier est dépassé');
    }

    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO payments (checkout_id, buyer_id, idempotency_key, provider, operator, msisdn, amount,
                             expires_at, poll_until, next_poll_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [
        checkoutId,
        buyerId,
        idempotencyKey,
        provider.code,
        input.operator,
        phone.e164,
        checkout.grand_total,
        expiresAt,
        addMinutes(now, pollHorizonMinutes),
        addSeconds(now, pollIntervalSeconds),
        now,
      ],
    );
    const id = inserted.rows[0]!.id;
    await tx.query('UPDATE checkouts SET expires_at = greatest(expires_at, $2) WHERE id = $1', [
      checkoutId,
      expiresAt,
    ]);
    await completeIdempotency(tx, buyerId, idempotencyKey!, id);
    return { paymentId: id, replay: false };
  });

  if (!replay) {
    const payment = await getPayment(ctx.pool, paymentId);
    let result: ProviderResult | null = null;
    try {
      result = await provider.initiateCollection({
        reference: payment.id,
        amount: payment.amount,
        currency: 'XAF',
        msisdn: payment.msisdn,
        operator: payment.operator,
        description: `Zandu ${checkoutId.slice(0, 8)}`,
      });
    } catch {
      // Issue inconnue : le paiement reste « created », l'interrogation périodique tranchera.
    }
    if (result) {
      const signal = result;
      await withTx(ctx.pool, (tx) =>
        applyCollectionSignal(ctx, tx, paymentId, signal.status, signal),
      );
    }
  }
  return getPayment(ctx.pool, paymentId);
}

/**
 * Applique une information sur une collecte (webhook, interrogation, expiration).
 * Idempotent et tolérant au désordre. C'est ICI que l'argent entre en séquestre.
 */
export async function applyCollectionSignal(
  ctx: AppContext,
  tx: Tx,
  paymentId: string,
  signal: PaymentSignal,
  details: ProviderResult = { status: 'pending' },
): Promise<void> {
  const { rows } = await tx.query<PaymentRow>('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [
    paymentId,
  ]);
  const payment = rows[0];
  if (!payment) throw notFound('Paiement');
  const now = ctx.clock.now();

  let change;
  try {
    change = applyPaymentSignal(payment.status, signal);
  } catch (error) {
    if (error instanceof DomainError && error.code === 'payment_status_conflict') {
      await publish(
        tx,
        'alert.support',
        { type: 'payment', id: paymentId },
        {
          message: `Conflit de statut sur le paiement ${paymentId} : succès contredit par l'agrégateur`,
        },
        now,
      );
      return;
    }
    throw error;
  }
  if (!change.changed) return;

  const terminal = change.status === 'succeeded' || change.status === 'failed';
  await tx.query(
    `UPDATE payments SET status = $2::payment_status, provider_ref = coalesce($3, provider_ref),
            failure_code = CASE WHEN $2::payment_status IN ('failed', 'expired') THEN $4 ELSE failure_code END,
            failure_message = CASE WHEN $2::payment_status IN ('failed', 'expired') THEN $5 ELSE failure_message END,
            succeeded_at = CASE WHEN $2::payment_status = 'succeeded' THEN $6::timestamptz ELSE succeeded_at END,
            failed_at = CASE WHEN $2::payment_status IN ('failed', 'expired') THEN $6::timestamptz ELSE failed_at END,
            next_poll_at = CASE WHEN $7::boolean THEN NULL ELSE next_poll_at END
     WHERE id = $1`,
    [
      paymentId,
      change.status,
      details.providerRef ?? null,
      change.status === 'expired' ? 'expired' : (details.failureCode ?? 'failed'),
      details.failureMessage ?? null,
      now,
      terminal,
    ],
  );

  if (change.status !== 'succeeded') return;

  if (details.fee && details.fee > 0) {
    await postJournal(
      tx,
      recordProviderFee({ provider: payment.provider, reference: payment.id, amount: details.fee }),
      ctx.clock.now(),
    );
  }

  const { rows: checkouts } = await tx.query<{ status: string }>(
    'SELECT status FROM checkouts WHERE id = $1 FOR UPDATE',
    [payment.checkout_id],
  );
  if (!change.lateSuccess && checkouts[0]?.status === 'awaiting_payment') {
    await tx.query(`UPDATE checkouts SET status = 'paid', paid_at = $2 WHERE id = $1`, [
      payment.checkout_id,
      now,
    ]);
    const { rows: orders } = await tx.query<{ id: string; total: number }>(
      'SELECT id, total FROM orders WHERE checkout_id = $1 ORDER BY id FOR UPDATE',
      [payment.checkout_id],
    );
    await postJournal(
      tx,
      capturePayment({
        paymentId,
        provider: payment.provider,
        orders: orders.map((o) => ({ orderId: o.id, total: o.total })),
      }),
      ctx.clock.now(),
    );
    for (const order of orders) {
      await applyOrderEvent(ctx, tx, order.id, { type: 'payment_succeeded' }, SYSTEM);
    }
    return;
  }

  // Succès tardif : la commande n'existe plus. L'argent est reçu, on le rend aussitôt.
  await tx.query('UPDATE payments SET late_success = true WHERE id = $1', [paymentId]);
  await postJournal(
    tx,
    captureLatePayment({ paymentId, provider: payment.provider, amount: payment.amount }),
    ctx.clock.now(),
  );
  await createRefund(ctx, tx, {
    paymentId,
    orderId: null,
    amount: payment.amount,
    reason: 'late_payment',
    decidedBy: null,
  });
  await publish(
    tx,
    'payment.late_success',
    { type: 'payment', id: paymentId },
    {
      paymentId,
      buyerId: payment.buyer_id,
      amount: payment.amount,
    },
    now,
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Traite un webhook vérifié. Dédoublonné par (agrégateur, identifiant d'événement). */
export async function handleProviderEvent(
  ctx: AppContext,
  providerCode: string,
  event: ProviderEvent,
): Promise<'processed' | 'duplicate' | 'ignored'> {
  return withTx(ctx.pool, async (tx) => {
    const now = ctx.clock.now();
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO provider_events (provider, event_id, event_type, payload, received_at)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`,
      [providerCode, event.eventId, `${event.kind}.${event.status}`, event, now],
    );
    const eventRowId = rows[0]?.id;
    if (!eventRowId) return 'duplicate';

    const markProcessed = (error: string | null) =>
      tx.query(
        'UPDATE provider_events SET processed_at = $2, processing_error = $3 WHERE id = $1',
        [eventRowId, now, error],
      );

    if (!UUID.test(event.reference)) {
      await markProcessed('unknown_reference');
      return 'ignored';
    }
    const table =
      event.kind === 'collection' ? 'payments' : event.kind === 'payout' ? 'payouts' : 'refunds';
    const { rows: owner } = await tx.query<{ provider: string }>(
      `SELECT provider FROM ${table} WHERE id = $1`,
      [event.reference],
    );
    if (owner[0]?.provider !== providerCode) {
      await markProcessed('unknown_reference');
      return 'ignored';
    }

    if (event.kind === 'collection') {
      await applyCollectionSignal(ctx, tx, event.reference, event.status, event);
    } else if (event.kind === 'payout') {
      await applyDisbursementResult(ctx, tx, payoutSpec, event.reference, event);
    } else {
      await applyDisbursementResult(ctx, tx, refundSpec, event.reference, event);
    }
    await markProcessed(null);
    return 'processed';
  });
}

// ---------------------------------------------------------------------------
// Tâches de fond (appelées par le worker)
// ---------------------------------------------------------------------------

/** Un paiement sans confirmation sous 10 min expire (après une dernière vérification). */
export async function expirePayments(ctx: AppContext): Promise<number> {
  const now = ctx.clock.now();
  const { rows } = await ctx.pool.query<{ id: string; provider: string }>(
    `SELECT id, provider FROM payments WHERE status IN ('created', 'pending') AND expires_at <= $1
     ORDER BY expires_at LIMIT 50`,
    [now],
  );
  for (const { id, provider } of rows) {
    let signal: PaymentSignal = 'expired';
    let details: ProviderResult = { status: 'pending' };
    try {
      const found = await ctx.providers.get(provider).lookup('collection', id);
      if (found.found && found.status !== 'pending') {
        signal = found.status;
        details = found;
      }
    } catch {
      // Agrégateur injoignable : on expire ; un succès ultérieur sera remboursé.
    }
    await withTx(ctx.pool, (tx) => applyCollectionSignal(ctx, tx, id, signal, details));
  }
  return rows.length;
}

/** Webhook perdu : interrogation de l'agrégateur toutes les 2 min pendant 30 min. */
export async function pollPayments(ctx: AppContext): Promise<number> {
  const now = ctx.clock.now();
  const claimed = await withTx(ctx.pool, async (tx) => {
    await tx.query(
      'UPDATE payments SET next_poll_at = NULL WHERE next_poll_at IS NOT NULL AND poll_until <= $1',
      [now],
    );
    const { rows } = await tx.query<{
      id: string;
      provider: string;
      status: PaymentStatus;
      created_at: Date;
    }>(
      `UPDATE payments p SET next_poll_at = $2, poll_attempts = p.poll_attempts + 1
       FROM (SELECT id FROM payments
             WHERE status IN ('created', 'pending', 'expired') AND next_poll_at <= $1 AND poll_until > $1
             ORDER BY next_poll_at LIMIT 50 FOR UPDATE SKIP LOCKED) due
       WHERE p.id = due.id
       RETURNING p.id, p.provider, p.status, p.created_at`,
      [now, addSeconds(now, ctx.config.payments.pollIntervalSeconds)],
    );
    return rows;
  });

  for (const payment of claimed) {
    try {
      const found = await ctx.providers.get(payment.provider).lookup('collection', payment.id);
      if (!found.found) {
        // Jamais parvenu à l'agrégateur (plantage entre l'enregistrement et l'envoi).
        if (
          payment.status === 'created' &&
          now.getTime() - payment.created_at.getTime() > 120_000
        ) {
          await withTx(ctx.pool, (tx) =>
            applyCollectionSignal(ctx, tx, payment.id, 'failed', {
              status: 'failed',
              failureCode: 'not_submitted',
            }),
          );
        }
        continue;
      }
      await withTx(ctx.pool, (tx) =>
        applyCollectionSignal(ctx, tx, payment.id, found.status, found),
      );
    } catch {
      // Prochaine passe.
    }
  }
  return claimed.length;
}

/** Panier non payé à l'échéance : commandes annulées, stock libéré. */
export async function expireCheckouts(ctx: AppContext): Promise<number> {
  const now = ctx.clock.now();
  const { rows } = await ctx.pool.query<{ id: string }>(
    `SELECT c.id FROM checkouts c
     WHERE c.status = 'awaiting_payment' AND c.expires_at <= $1
       AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.checkout_id = c.id AND p.status IN ('created', 'pending'))
     ORDER BY c.expires_at LIMIT 100`,
    [now],
  );
  let expired = 0;
  for (const { id } of rows) {
    await withTx(ctx.pool, async (tx) => {
      const locked = await tx.query<{ status: string }>(
        'SELECT status FROM checkouts WHERE id = $1 FOR UPDATE',
        [id],
      );
      const active = await tx.query(
        `SELECT 1 FROM payments WHERE checkout_id = $1 AND status IN ('created', 'pending')`,
        [id],
      );
      if (locked.rows[0]?.status !== 'awaiting_payment' || active.rowCount) return;
      await tx.query(`UPDATE checkouts SET status = 'expired' WHERE id = $1`, [id]);
      const { rows: orders } = await tx.query<{ id: string }>(
        'SELECT id FROM orders WHERE checkout_id = $1 ORDER BY id',
        [id],
      );
      for (const order of orders)
        await applyOrderEvent(ctx, tx, order.id, { type: 'checkout_expired' }, SYSTEM);
      expired++;
    });
  }
  return expired;
}
