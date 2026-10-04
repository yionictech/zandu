import type { Actor } from '../../context.js';
import type { Db } from '../../db/pool.js';

/** Journal d'audit des actions sensibles (F17) — en écriture seule côté base. */
export async function audit(
  db: Db,
  actor: Actor,
  action: string,
  entity: { type: string; id: string },
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, ip, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      actor.userId,
      actor.role,
      action,
      entity.type,
      entity.id,
      actor.ip ?? null,
      actor.userAgent ?? null,
      metadata,
    ],
  );
}
