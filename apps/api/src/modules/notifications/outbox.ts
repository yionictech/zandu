import type { Db } from '../../db/pool.js';

/**
 * Publie un événement dans la même transaction que le changement métier (patron « outbox »).
 * Le worker le transforme ensuite en notifications WhatsApp/SMS : si la transaction est
 * annulée, rien ne part ; si l'envoi échoue, l'événement reste et sera retenté.
 */
export async function publish(
  db: Db,
  topic: string,
  aggregate: { type: string; id: string },
  payload: Record<string, unknown>,
  availableAt: Date,
): Promise<void> {
  await db.query(
    `INSERT INTO outbox_events (topic, aggregate_type, aggregate_id, payload, available_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [topic, aggregate.type, aggregate.id, payload, availableAt],
  );
}
