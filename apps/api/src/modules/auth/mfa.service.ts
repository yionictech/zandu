import type { AppContext } from '../../context.js';
import { withTx } from '../../db/pool.js';
import { HttpError } from '../../lib/errors.js';
import {
  base32Encode,
  decryptSecret,
  encryptSecret,
  matchTotp,
  newTotpSecret,
  otpauthUrl,
} from '../../lib/totp.js';
import { audit } from '../admin/audit.js';
import { publish } from '../notifications/outbox.js';
import { STAFF_ROLES, type AuthSession, type AuthUser } from './auth.service.js';

type Staff = AuthUser & AuthSession;

function assertStaff(user: Staff): void {
  if (!user.roles.some((r) => STAFF_ROLES.includes(r))) {
    throw new HttpError(403, 'forbidden', 'Réservé au personnel Zandu');
  }
}

export async function mfaStatus(ctx: AppContext, user: Staff) {
  const { rows } = await ctx.pool.query<{ enabled: boolean }>(
    'SELECT enabled_at IS NOT NULL AS enabled FROM user_mfa WHERE user_id = $1',
    [user.id],
  );
  return {
    required: ctx.config.auth.staffMfaRequired && user.roles.some((r) => STAFF_ROLES.includes(r)),
    enrolled: rows[0]?.enabled ?? false,
    verified: user.mfaVerified,
  };
}

/** Un secret affiché mais pas encore confirmé reste valable ce temps-là (rechargement de la page). */
const PENDING_SECRET_MINUTES = 10;

/**
 * Première configuration : secret à scanner dans l'application d'authentification. Tant qu'il
 * n'est pas confirmé, le même secret est renvoyé pendant 10 minutes (QR code déjà scanné).
 */
export async function setupTotp(ctx: AppContext, user: Staff) {
  assertStaff(user);
  const now = ctx.clock.now();
  const secret = await withTx(ctx.pool, async (tx) => {
    const { rows } = await tx.query<{
      enabled_at: Date | null;
      created_at: Date;
      totp_secret_encrypted: Buffer;
    }>(
      'SELECT enabled_at, created_at, totp_secret_encrypted FROM user_mfa WHERE user_id = $1 FOR UPDATE',
      [user.id],
    );
    const existing = rows[0];
    if (existing?.enabled_at) {
      throw new HttpError(
        409,
        'mfa_already_enabled',
        'Second facteur déjà configuré : demandez une réinitialisation à un administrateur',
      );
    }
    if (
      existing &&
      now.getTime() - existing.created_at.getTime() < PENDING_SECRET_MINUTES * 60_000
    ) {
      return decryptSecret(ctx.config.appSecret, existing.totp_secret_encrypted);
    }
    const fresh = newTotpSecret();
    await tx.query(
      `INSERT INTO user_mfa (user_id, totp_secret_encrypted, created_at) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET totp_secret_encrypted = EXCLUDED.totp_secret_encrypted,
         last_used_step = NULL, created_at = EXCLUDED.created_at`,
      [user.id, encryptSecret(ctx.config.appSecret, fresh), now],
    );
    return fresh;
  });
  return { secret: base32Encode(secret), otpauthUrl: otpauthUrl(secret, user.phone) };
}

/**
 * Vérifie un code TOTP pour la session courante. `enrol` : confirme la configuration en
 * cours ; sinon, le second facteur doit déjà être actif. Trop d'erreurs révoque la session.
 */
export async function verifyTotp(
  ctx: AppContext,
  user: Staff,
  code: string,
  meta: { ip: string; enrol: boolean },
): Promise<void> {
  assertStaff(user);
  const now = ctx.clock.now();
  const outcome = await withTx(ctx.pool, async (tx) => {
    const { rows } = await tx.query<{
      totp_secret_encrypted: Buffer;
      enabled_at: Date | null;
      last_used_step: string | null;
    }>(
      'SELECT totp_secret_encrypted, enabled_at, last_used_step FROM user_mfa WHERE user_id = $1 FOR UPDATE',
      [user.id],
    );
    const mfa = rows[0];
    if (!mfa || (meta.enrol ? mfa.enabled_at !== null : mfa.enabled_at === null)) {
      return meta.enrol ? ('not_started' as const) : ('not_enrolled' as const);
    }
    const { rows: sessions } = await tx.query<{ mfa_failed_attempts: number }>(
      'SELECT mfa_failed_attempts FROM sessions WHERE id = $1 FOR UPDATE',
      [user.sessionId],
    );
    const step = matchTotp(
      decryptSecret(ctx.config.appSecret, mfa.totp_secret_encrypted),
      code,
      now,
      mfa.last_used_step === null ? null : Number(mfa.last_used_step),
    );
    if (step === null) {
      const failures = sessions[0]!.mfa_failed_attempts + 1;
      // Validé (COMMIT) même si la réponse est une erreur : le compteur ne se contourne pas.
      await tx.query(
        `UPDATE sessions SET mfa_failed_attempts = $2::int,
                revoked_at = CASE WHEN $2::int >= $3::int THEN $4::timestamptz ELSE revoked_at END
         WHERE id = $1`,
        [user.sessionId, failures, ctx.config.auth.mfaMaxAttempts, now],
      );
      return failures >= ctx.config.auth.mfaMaxAttempts
        ? ('locked' as const)
        : ('invalid' as const);
    }
    await tx.query(
      `UPDATE user_mfa SET last_used_step = $2, enabled_at = coalesce(enabled_at, $3) WHERE user_id = $1`,
      [user.id, step, now],
    );
    await tx.query(
      'UPDATE sessions SET mfa_verified_at = $2, mfa_failed_attempts = 0 WHERE id = $1',
      [user.sessionId, now],
    );
    if (meta.enrol) {
      await audit(
        tx,
        { role: user.roles.includes('admin') ? 'admin' : 'support', userId: user.id, ip: meta.ip },
        'mfa.enabled',
        { type: 'user', id: user.id },
      );
    }
    return 'ok' as const;
  });

  const errors = {
    not_started: [409, 'mfa_not_started', 'Commencez par configurer le second facteur'],
    not_enrolled: [409, 'mfa_not_enrolled', 'Second facteur non configuré'],
    invalid: [401, 'mfa_invalid', 'Code incorrect'],
    locked: [401, 'mfa_locked', 'Trop de codes erronés : reconnectez-vous'],
  } as const;
  if (outcome !== 'ok') {
    const [status, codeName, message] = errors[outcome];
    throw new HttpError(status, codeName, message);
  }
}

/** Téléphone perdu : un administrateur efface le second facteur d'un membre du personnel. */
export async function resetTotp(
  ctx: AppContext,
  admin: { userId: string; ip: string },
  userId: string,
): Promise<void> {
  await withTx(ctx.pool, async (tx) => {
    const { rowCount } = await tx.query('DELETE FROM user_mfa WHERE user_id = $1', [userId]);
    if (!rowCount) throw new HttpError(404, 'not_found', 'Aucun second facteur pour ce compte');
    // La personne est prévenue : une réinitialisation qu'elle n'a pas demandée doit se voir.
    await publish(
      tx,
      'staff.access',
      { type: 'user', id: userId },
      {
        userId,
        message:
          "votre second facteur a été réinitialisé par un administrateur. À la prochaine connexion, configurez de nouveau votre application d'authentification.",
      },
      ctx.clock.now(),
    );
    // Les sessions ouvertes perdent leur validation : il faudra reconfigurer puis revalider.
    await tx.query(
      'UPDATE sessions SET mfa_verified_at = NULL WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
    await audit(tx, { role: 'admin', userId: admin.userId, ip: admin.ip }, 'mfa.reset', {
      type: 'user',
      id: userId,
    });
  });
}
