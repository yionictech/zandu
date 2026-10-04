import { parseCongoMobile } from '@zandu/domain';
import { createPool } from '../db/pool.js';

/**
 * Attribue un rôle (support, admin, rider) à un utilisateur existant.
 * Usage : pnpm user:grant-role <téléphone> <rôle> [partenaire-livraison-id]
 */
const [phoneArg, role, partnerId] = process.argv.slice(2);
if (!phoneArg || !role || !['support', 'admin', 'rider'].includes(role)) {
  console.error('Usage : grant-role <téléphone> <support|admin|rider> [courier_partner_id]');
  process.exit(1);
}
const phone = parseCongoMobile(phoneArg).e164;
const pool = createPool(process.env.DATABASE_URL ?? 'postgres://zandu:zandu@localhost:5432/zandu');
const { rows } = await pool.query<{ id: string }>(
  `UPDATE users SET roles = array_append(roles, $2::user_role)
   WHERE phone = $1 AND NOT $2::user_role = ANY(roles) RETURNING id`,
  [phone, role],
);
if (role === 'rider' && rows[0]) {
  if (!partnerId) throw new Error('Un livreur doit être rattaché à un partenaire de livraison');
  await pool.query('INSERT INTO riders (user_id, courier_partner_id) VALUES ($1, $2)', [
    rows[0].id,
    partnerId,
  ]);
}
await pool.query(
  `INSERT INTO audit_logs (actor_role, action, entity_type, entity_id, metadata)
   SELECT 'system', 'user.role_granted', 'user', id::text, jsonb_build_object('role', $2::text) FROM users WHERE phone = $1`,
  [phone, role],
);
console.log(
  rows[0]
    ? `Rôle ${role} attribué à ${phone}.`
    : `Aucun changement (utilisateur absent ou rôle déjà présent).`,
);
await pool.end();
