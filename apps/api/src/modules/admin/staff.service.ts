import { parseCongoMobile } from '@zandu/domain';
import type { Actor, AppContext } from '../../context.js';
import { withTx, type Tx } from '../../db/pool.js';
import { HttpError, notFound } from '../../lib/errors.js';
import { publish } from '../notifications/outbox.js';
import { audit } from './audit.js';

/**
 * Comptes du personnel (back-office) : agents du support et administrateurs. Un administrateur
 * ajoute, change de rôle, déconnecte ou retire l'accès d'un membre, et réinitialise son second
 * facteur. Chaque changement est journalisé, ferme les sessions ouvertes (la suivante sera une
 * session courte du personnel, avec second facteur) et prévient la personne par SMS.
 */
export type StaffRole = 'support' | 'admin';

const ROLE_LABEL: Record<StaffRole, string> = {
  support: 'agent du support',
  admin: 'administrateur',
};

interface StaffRow {
  id: string;
  phone: string;
  full_name: string | null;
  roles: string[];
  status: string;
  mfa_enrolled: boolean;
  last_seen_at: Date | null;
  active_sessions: number;
  created_at: Date;
}

const STAFF_SELECT = `
  SELECT u.id, u.phone, u.full_name, u.roles::text[] AS roles, u.status::text AS status,
         m.enabled_at IS NOT NULL AS mfa_enrolled,
         (SELECT max(last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at,
         (SELECT count(*)::int FROM sessions s
          WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > $1) AS active_sessions,
         u.created_at
  FROM users u LEFT JOIN user_mfa m ON m.user_id = u.id`;

function view(r: StaffRow) {
  return {
    id: r.id,
    phone: r.phone,
    fullName: r.full_name,
    role: (r.roles.includes('admin') ? 'admin' : 'support') as StaffRole,
    active: r.status === 'active',
    mfaEnrolled: r.mfa_enrolled,
    lastSeenAt: r.last_seen_at,
    activeSessions: r.active_sessions,
    createdAt: r.created_at,
  };
}

export async function listStaff(ctx: AppContext) {
  const { rows } = await ctx.pool.query<StaffRow>(
    `${STAFF_SELECT} WHERE u.roles && '{support,admin}'::user_role[]
     ORDER BY 'admin' = ANY(u.roles) DESC, u.full_name NULLS LAST, u.phone`,
    [ctx.clock.now()],
  );
  return { items: rows.map(view) };
}

/** Un membre du personnel, avec ses dernières actions (journal d'audit). */
export async function getStaff(ctx: AppContext, id: string) {
  const { rows } = await ctx.pool.query<StaffRow>(
    `${STAFF_SELECT} WHERE u.id = $2 AND u.roles && '{support,admin}'::user_role[]`,
    [ctx.clock.now(), id],
  );
  if (!rows[0]) throw notFound('Membre du personnel');
  const { rows: actions } = await ctx.pool.query<{
    action: string;
    entity_type: string;
    entity_id: string;
    created_at: Date;
  }>(
    `SELECT action, entity_type, entity_id, created_at FROM audit_logs
     WHERE actor_id = $1 ORDER BY id DESC LIMIT 30`,
    [id],
  );
  return {
    ...view(rows[0]),
    recentActions: actions.map((a) => ({
      action: a.action,
      entityType: a.entity_type,
      entityId: a.entity_id,
      at: a.created_at,
    })),
  };
}

/** Ferme toutes les sessions d'un compte : il faudra se reconnecter (code SMS puis second facteur). */
async function closeSessions(tx: Tx, userId: string, now: Date): Promise<number> {
  const { rowCount } = await tx.query(
    'UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL',
    [userId, now],
  );
  return rowCount ?? 0;
}

/** SMS à la personne concernée (le numéro est relu à l'envoi, jamais copié dans la file). */
async function notify(tx: Tx, user: { id: string }, message: string, now: Date) {
  await publish(
    tx,
    'staff.access',
    { type: 'user', id: user.id },
    { userId: user.id, message },
    now,
  );
}

/** Garde-fous : jamais sur soi-même, jamais le dernier administrateur. */
async function lockMember(
  tx: Tx,
  admin: Actor,
  id: string,
  options: { removesAdmin: boolean; allowSelf?: boolean },
) {
  const { removesAdmin } = options;
  if (id === admin.userId && !options.allowSelf) {
    throw new HttpError(
      409,
      'self_change',
      'Vous ne pouvez pas modifier votre propre accès : demandez à un autre administrateur',
    );
  }
  // Verrou commun : deux retraits simultanés ne peuvent pas laisser zéro administrateur.
  await tx.query(`SELECT pg_advisory_xact_lock(hashtext('staff-admins'))`);
  const { rows } = await tx.query<{ id: string; phone: string; roles: string[] }>(
    `SELECT id, phone, roles::text[] AS roles FROM users
     WHERE id = $1 AND roles && '{support,admin}'::user_role[] FOR UPDATE`,
    [id],
  );
  const member = rows[0];
  if (!member) throw notFound('Membre du personnel');
  if (removesAdmin && member.roles.includes('admin')) {
    const { rows: admins } = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM users WHERE 'admin' = ANY(roles) AND status = 'active'`,
    );
    if (admins[0]!.n <= 1) {
      throw new HttpError(409, 'last_admin', 'Zandu doit garder au moins un administrateur');
    }
  }
  return member;
}

/** Ajoute un membre (compte créé s'il n'existe pas encore) ou lui donne un rôle du personnel. */
export async function addStaff(
  ctx: AppContext,
  admin: Actor,
  input: { phone: string; fullName: string; role: StaffRole },
) {
  const phone = parseCongoMobile(input.phone).e164;
  const now = ctx.clock.now();
  const id = await withTx(ctx.pool, async (tx) => {
    const { rows: existing } = await tx.query<{ roles: string[]; status: string }>(
      'SELECT roles::text[] AS roles, status::text AS status FROM users WHERE phone = $1 FOR UPDATE',
      [phone],
    );
    const current = existing[0];
    if (current?.roles.some((r) => r === 'support' || r === 'admin')) {
      throw new HttpError(409, 'already_staff', 'Ce numéro fait déjà partie du personnel');
    }
    if (current && current.status !== 'active') {
      throw new HttpError(409, 'account_suspended', 'Ce compte est suspendu ou fermé');
    }
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO users (phone, full_name, roles) VALUES ($1, $2, ARRAY['buyer', $3]::user_role[])
       ON CONFLICT (phone) DO UPDATE SET full_name = EXCLUDED.full_name,
         roles = array_append(users.roles, $3::user_role)
       RETURNING id`,
      [phone, input.fullName, input.role],
    );
    const userId = rows[0]!.id;
    // Une session d'acheteur (30 jours) ne devient pas une session du personnel.
    await closeSessions(tx, userId, now);
    await audit(
      tx,
      admin,
      'staff.added',
      { type: 'user', id: userId },
      {
        role: input.role,
        newAccount: !current,
      },
    );
    await notify(
      tx,
      { id: userId },
      `vous avez désormais accès au back-office (${ROLE_LABEL[input.role]}). Connectez-vous avec ce numéro ; le second facteur vous sera demandé.`,
      now,
    );
    return userId;
  });
  return getStaff(ctx, id);
}

export async function changeRole(ctx: AppContext, admin: Actor, id: string, role: StaffRole) {
  const now = ctx.clock.now();
  await withTx(ctx.pool, async (tx) => {
    const member = await lockMember(tx, admin, id, { removesAdmin: role !== 'admin' });
    const from: StaffRole = member.roles.includes('admin') ? 'admin' : 'support';
    if (from === role) return;
    await tx.query(
      `UPDATE users SET roles = array_append(
         array_remove(array_remove(roles, 'support'::user_role), 'admin'::user_role), $2::user_role)
       WHERE id = $1`,
      [id, role],
    );
    await closeSessions(tx, id, now);
    await audit(tx, admin, 'staff.role_changed', { type: 'user', id }, { from, to: role });
    await notify(
      tx,
      member,
      `votre rôle dans le back-office est maintenant : ${ROLE_LABEL[role]}. Reconnectez-vous.`,
      now,
    );
  });
  return getStaff(ctx, id);
}

/** Départ, téléphone volé, abus : plus aucun accès au back-office, sessions fermées. */
export async function revokeStaff(ctx: AppContext, admin: Actor, id: string, reason: string) {
  const now = ctx.clock.now();
  await withTx(ctx.pool, async (tx) => {
    const member = await lockMember(tx, admin, id, { removesAdmin: true });
    await tx.query(
      `UPDATE users SET roles = array_remove(array_remove(roles, 'support'::user_role), 'admin'::user_role)
       WHERE id = $1`,
      [id],
    );
    // Le second facteur disparaît aussi : un retour éventuel repartira d'une configuration neuve.
    await tx.query('DELETE FROM user_mfa WHERE user_id = $1', [id]);
    const sessions = await closeSessions(tx, id, now);
    await audit(tx, admin, 'staff.revoked', { type: 'user', id }, { reason, sessions });
    await notify(tx, member, `votre accès au back-office a été retiré.`, now);
  });
}

/** Déconnexion partout (ordinateur oublié ouvert, doute) ; l'accès lui-même est conservé. */
export async function signOutEverywhere(ctx: AppContext, admin: Actor, id: string) {
  const now = ctx.clock.now();
  return withTx(ctx.pool, async (tx) => {
    await lockMember(tx, admin, id, { removesAdmin: false, allowSelf: true });
    const sessions = await closeSessions(tx, id, now);
    await audit(tx, admin, 'staff.signed_out', { type: 'user', id }, { sessions });
    return { sessions };
  });
}
