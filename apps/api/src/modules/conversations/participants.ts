import type { Db } from '../../db/pool.js';
import { notFound } from '../../lib/errors.js';
import { shortName } from '../orders/orders.routes.js';

export type ParticipantRole = 'buyer' | 'seller' | 'rider';

export interface Participant {
  role: ParticipantRole;
  userId: string;
  /** Nom montré aux autres : prénom et initiale, ou nom de la boutique. */
  name: string;
}

export interface Conversation {
  orderId: string;
  publicRef: string;
  status: string;
  participants: Participant[];
}

/** Tant que la commande vit (payée → remise, litige compris), on peut écrire et appeler. */
const OPEN = [
  'paid',
  'preparing',
  'ready_for_pickup',
  'in_delivery',
  'awaiting_collection',
  'delivered',
  'disputed',
];

export const isOpen = (c: Conversation): boolean => OPEN.includes(c.status);

/**
 * Qui parle sur une commande : l'acheteur, le vendeur (titulaire de la boutique) et le livreur
 * de la course en cours. Un livreur réassigné sort de la conversation.
 */
export async function conversationOf(db: Db, orderId: string): Promise<Conversation> {
  const { rows } = await db.query<{
    public_ref: string;
    status: string;
    buyer_id: string;
    buyer_name: string | null;
    seller_user_id: string;
    shop_name: string;
    rider_user_id: string | null;
    rider_name: string | null;
  }>(
    `SELECT o.public_ref, o.status::text AS status, o.buyer_id, b.full_name AS buyer_name,
            s.user_id AS seller_user_id, s.shop_name, ru.id AS rider_user_id, ru.full_name AS rider_name
     FROM orders o
     JOIN users b ON b.id = o.buyer_id
     JOIN seller_profiles s ON s.id = o.seller_id
     LEFT JOIN deliveries d ON d.order_id = o.id AND d.rider_id IS NOT NULL
     LEFT JOIN riders r ON r.id = d.rider_id
     LEFT JOIN users ru ON ru.id = r.user_id
     WHERE o.id = $1`,
    [orderId],
  );
  const row = rows[0];
  if (!row) throw notFound('Commande');
  const display = (name: string | null, fallback: string) =>
    name?.trim() ? shortName(name.trim()) : fallback;
  const participants: Participant[] = [
    { role: 'buyer', userId: row.buyer_id, name: display(row.buyer_name, 'Client') },
    { role: 'seller', userId: row.seller_user_id, name: row.shop_name },
  ];
  if (row.rider_user_id)
    participants.push({
      role: 'rider',
      userId: row.rider_user_id,
      name: display(row.rider_name, 'Livreur Zandu'),
    });
  return { orderId, publicRef: row.public_ref, status: row.status, participants };
}

/** Le participant correspondant à l'utilisateur, ou une 404 (on ne révèle pas l'existence). */
export function participantIn(c: Conversation, userId: string): Participant {
  const me = c.participants.find((p) => p.userId === userId);
  if (!me) throw notFound('Commande');
  return me;
}
