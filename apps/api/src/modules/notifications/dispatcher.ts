import { formatXaf } from '@zandu/domain';
import type { AppContext } from '../../context.js';
import { withTx, type Db } from '../../db/pool.js';
import type { Channel } from './sender.js';
import { render } from './templates.js';

interface OutboxRow {
  id: number;
  topic: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  attempts: number;
}

interface Message {
  userId: string | null;
  recipient: string;
  channel: Channel;
  template: string;
  variables: Record<string, string>;
}

const dateFormat = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Brazzaville',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const formatDate = (d: Date | null): string => (d ? dateFormat.format(d) : '');

interface OrderInfo {
  public_ref: string;
  total: number;
  items_subtotal: number;
  commission_total: number;
  refunded_amount: number;
  seller_accept_deadline: Date | null;
  dispute_window_ends_at: Date | null;
  buyer_id: string;
  buyer_phone: string;
  seller_user_id: string;
  seller_phone: string;
}

async function orderInfo(db: Db, orderId: string): Promise<OrderInfo> {
  const { rows } = await db.query<OrderInfo>(
    `SELECT o.public_ref, o.total, o.items_subtotal, o.commission_total, o.refunded_amount,
            o.seller_accept_deadline, o.dispute_window_ends_at,
            b.id AS buyer_id, b.phone AS buyer_phone, su.id AS seller_user_id, su.phone AS seller_phone
     FROM orders o
     JOIN users b ON b.id = o.buyer_id
     JOIN seller_profiles s ON s.id = o.seller_id
     JOIN users su ON su.id = s.user_id
     WHERE o.id = $1`,
    [orderId],
  );
  if (!rows[0]) throw new Error(`Commande ${orderId} introuvable`);
  return rows[0];
}

/** Traduit un événement métier en messages (destinataire, canal, modèle). */
async function messagesFor(ctx: AppContext, db: Db, event: OutboxRow): Promise<Message[]> {
  const toBuyer = (
    o: OrderInfo,
    template: string,
    variables: Record<string, string>,
    channel: Channel = 'whatsapp',
  ): Message => ({
    userId: o.buyer_id,
    recipient: o.buyer_phone,
    channel,
    template,
    variables,
  });
  const toSeller = (
    o: OrderInfo,
    template: string,
    variables: Record<string, string>,
  ): Message => ({
    userId: o.seller_user_id,
    recipient: o.seller_phone,
    channel: 'whatsapp',
    template,
    variables,
  });
  const support = (message: string): Message[] =>
    ctx.config.supportAlertPhone
      ? [
          {
            userId: null,
            recipient: ctx.config.supportAlertPhone,
            channel: 'whatsapp',
            template: 'support_alert',
            variables: { message },
          },
        ]
      : [];

  const p = event.payload;
  if (event.topic.startsWith('order.')) {
    const o = await orderInfo(db, event.aggregate_id);
    const ref = o.public_ref;
    switch (event.topic) {
      case 'order.paid':
        return [
          toBuyer(o, 'buyer_payment_confirmed', { ref, amount: formatXaf(o.total) }),
          toSeller(o, 'seller_new_order', {
            ref,
            amount: formatXaf(o.items_subtotal),
            deadline: formatDate(o.seller_accept_deadline),
          }),
        ];
      case 'order.handover_code':
        // Le code de remise part en SMS : il doit arriver même sans WhatsApp ni données mobiles.
        return [toBuyer(o, 'buyer_handover_code', { ref, code: String(p.code) }, 'sms')];
      case 'order.preparing':
        return [toBuyer(o, 'buyer_order_accepted', { ref })];
      case 'order.in_delivery':
        return [toBuyer(o, 'buyer_in_delivery', { ref })];
      case 'order.awaiting_collection':
        return [toBuyer(o, 'buyer_awaiting_collection', { ref })];
      case 'order.delivered':
        return [
          toBuyer(o, 'buyer_delivered', { ref, deadline: formatDate(o.dispute_window_ends_at) }),
        ];
      case 'order.completed':
        return [
          toSeller(o, 'seller_order_completed', {
            ref,
            amount: formatXaf(Number(p.sellerNet ?? 0)),
          }),
        ];
      case 'order.cancelled': {
        const refund = o.refunded_amount > 0 ? formatXaf(o.refunded_amount) : '';
        return [
          toBuyer(o, 'order_cancelled', { ref, refund }),
          toSeller(o, 'order_cancelled', { ref, refund: '' }),
        ];
      }
      case 'order.disputed':
        return [
          toSeller(o, 'seller_dispute_opened', { ref }),
          ...support(`Litige ouvert sur ${ref}`),
        ];
      case 'order.refunded':
        return [];
      default:
        return [];
    }
  }

  switch (event.topic) {
    case 'payout.succeeded':
    case 'refund.succeeded': {
      const { rows } = await db.query<{ id: string; phone: string }>(
        'SELECT id, phone FROM users WHERE id = $1',
        [p.userId],
      );
      const user = rows[0];
      if (!user) return [];
      const template = event.topic === 'payout.succeeded' ? 'seller_payout_sent' : 'buyer_refunded';
      return [
        {
          userId: user.id,
          recipient: user.phone,
          channel: 'whatsapp',
          template,
          variables: { amount: formatXaf(Number(p.amount)) },
        },
      ];
    }
    case 'payment.late_success': {
      const { rows } = await db.query<{ id: string; phone: string }>(
        'SELECT id, phone FROM users WHERE id = $1',
        [p.buyerId],
      );
      const buyer = rows[0];
      const amount = formatXaf(Number(p.amount));
      return [
        ...(buyer
          ? [
              {
                userId: buyer.id,
                recipient: buyer.phone,
                channel: 'whatsapp' as const,
                template: 'buyer_late_payment',
                variables: { amount },
              },
            ]
          : []),
        ...support(
          `Paiement tardif ${String(p.paymentId)} (${amount}) : remboursement automatique lancé`,
        ),
      ];
    }
    case 'alert.support':
      return support(String(p.message));
    default:
      return [];
  }
}

/** Transforme les événements de l'outbox en notifications à envoyer. */
export async function dispatchOutbox(ctx: AppContext): Promise<number> {
  const now = ctx.clock.now();
  return withTx(ctx.pool, async (tx) => {
    const { rows } = await tx.query<OutboxRow>(
      `SELECT id, topic, aggregate_id, payload, attempts FROM outbox_events
       WHERE processed_at IS NULL AND available_at <= $1
       ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED`,
      [now],
    );
    for (const event of rows) {
      try {
        await tx.query('SAVEPOINT outbox_event');
        for (const m of await messagesFor(ctx, tx, event)) {
          await tx.query(
            `INSERT INTO notifications (user_id, recipient, channel, template, variables, outbox_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [m.userId, m.recipient, m.channel, m.template, m.variables, event.id],
          );
        }
        await tx.query('UPDATE outbox_events SET processed_at = $2 WHERE id = $1', [event.id, now]);
        await tx.query('RELEASE SAVEPOINT outbox_event');
      } catch (error) {
        await tx.query('ROLLBACK TO SAVEPOINT outbox_event');
        const retryAt = new Date(now.getTime() + 60_000 * 2 ** Math.min(event.attempts, 6));
        await tx.query(
          'UPDATE outbox_events SET attempts = attempts + 1, last_error = $2, available_at = $3 WHERE id = $1',
          [event.id, String(error), retryAt],
        );
      }
    }
    return rows.length;
  });
}

/** Envoie les notifications en file. Repli SMS si WhatsApp échoue. */
export async function sendNotifications(ctx: AppContext): Promise<number> {
  const now = ctx.clock.now();
  return withTx(ctx.pool, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      user_id: string | null;
      recipient: string;
      channel: Channel;
      template: string;
      variables: Record<string, string>;
      outbox_id: number | null;
    }>(
      `SELECT id, user_id, recipient, channel, template, variables, outbox_id FROM notifications
       WHERE status = 'queued' ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED`,
    );
    for (const n of rows) {
      try {
        const { providerRef } = await ctx.notifier.send({
          channel: n.channel,
          recipient: n.recipient,
          template: n.template,
          variables: n.variables,
          text: render(n.template, n.variables),
        });
        await tx.query(
          `UPDATE notifications SET status = 'sent', sent_at = $2, provider_ref = $3 WHERE id = $1`,
          [n.id, now, providerRef ?? null],
        );
      } catch (error) {
        await tx.query(`UPDATE notifications SET status = 'failed', error = $2 WHERE id = $1`, [
          n.id,
          String(error),
        ]);
        if (n.channel === 'whatsapp') {
          await tx.query(
            `INSERT INTO notifications (user_id, recipient, channel, template, variables, outbox_id)
             VALUES ($1, $2, 'sms', $3, $4, $5)`,
            [n.user_id, n.recipient, n.template, n.variables, n.outbox_id],
          );
        }
      }
    }
    return rows.length;
  });
}
