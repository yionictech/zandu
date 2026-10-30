import { randomUUID } from 'node:crypto';
import { parseCongoMobile } from '@zandu/domain';
import type { AppContext } from '../../context.js';
import { withTx } from '../../db/pool.js';
import { addHours, addSeconds } from '../../lib/clock.js';
import { hmac, randomDigits, randomToken, safeEqualHex, sha256 } from '../../lib/crypto.js';
import { HttpError } from '../../lib/errors.js';
import { render } from '../notifications/templates.js';

export type Role = 'buyer' | 'seller' | 'rider' | 'support' | 'admin';

export interface AuthUser {
  id: string;
  phone: string;
  fullName: string | null;
  roles: Role[];
}

export const STAFF_ROLES: Role[] = ['support', 'admin'];

export interface AuthSession {
  sessionId: string;
  /** Code TOTP vérifié pour cette session (personnel uniquement). */
  mfaVerified: boolean;
}

const otpHash = (ctx: AppContext, challengeId: string, code: string): string =>
  hmac(ctx.config.appSecret, `otp:${challengeId}:${code}`);

/** Compte de revue des stores : code fixe connu des testeurs d'Apple et de Google, pas de SMS. */
export const isReviewAccount = (ctx: AppContext, phone: string): boolean =>
  ctx.config.storeReview?.phone === phone;

/**
 * Envoie un code à 6 chiffres. Limites strictes : le « SMS pumping » (bots qui déclenchent
 * des milliers de SMS surtaxés) est une fraude courante qui vide un budget SMS en une nuit.
 */
export async function requestOtp(ctx: AppContext, phoneInput: string, ip: string | null) {
  const phone = parseCongoMobile(phoneInput).e164;
  const now = ctx.clock.now();
  const { otpTtlSeconds, otpResendSeconds, otpMaxPerPhonePerHour, otpMaxPerIpPerHour } =
    ctx.config.auth;
  const hourAgo = addHours(now, -1);

  const review = isReviewAccount(ctx, phone);
  const code = review ? ctx.config.storeReview!.code : randomDigits(6);
  const challengeId = await withTx(ctx.pool, async (tx) => {
    // Sérialise les demandes pour un même numéro (verrou consultatif transactionnel).
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [phone]);
    const { rows } = await tx.query<{ per_phone: number; per_ip: number; last: Date | null }>(
      `SELECT count(*) FILTER (WHERE phone = $1)::bigint AS per_phone,
              count(*) FILTER (WHERE requested_ip = $2::inet)::bigint AS per_ip,
              max(created_at) FILTER (WHERE phone = $1) AS last
       FROM otp_challenges WHERE created_at > $3 AND (phone = $1 OR requested_ip = $2::inet)`,
      [phone, ip, hourAgo],
    );
    const stats = rows[0]!;
    if (stats.last && now.getTime() - stats.last.getTime() < otpResendSeconds * 1000) {
      throw new HttpError(
        429,
        'otp_resend_too_soon',
        'Patientez avant de demander un nouveau code',
        {
          retryAfterSeconds: Math.ceil(
            (stats.last.getTime() + otpResendSeconds * 1000 - now.getTime()) / 1000,
          ),
        },
      );
    }
    if (stats.per_phone >= otpMaxPerPhonePerHour || stats.per_ip >= otpMaxPerIpPerHour) {
      throw new HttpError(429, 'otp_rate_limited', 'Trop de demandes de code, réessayez plus tard');
    }
    const id = randomUUID();
    await tx.query(
      `INSERT INTO otp_challenges (id, phone, purpose, code_hash, expires_at, requested_ip, created_at)
       VALUES ($1, $2, 'login', $3, $4, $5::inet, $6)`,
      [id, phone, otpHash(ctx, id, code), addSeconds(now, otpTtlSeconds), ip, now],
    );
    return id;
  });

  if (!review)
    await ctx.notifier.send({
      channel: 'sms',
      recipient: phone,
      template: 'otp_code',
      variables: { code },
      text: render('otp_code', { code }),
    });
  return { challengeId, expiresInSeconds: otpTtlSeconds, resendAfterSeconds: otpResendSeconds };
}

/** Vérifie le code ; crée le compte au premier passage ; ouvre une session révocable. */
export async function verifyOtp(
  ctx: AppContext,
  challengeId: string,
  code: string,
  meta: { ip: string | null; deviceLabel?: string | undefined },
): Promise<{ token: string; expiresAt: Date; user: AuthUser }> {
  const now = ctx.clock.now();
  const outcome = await withTx(ctx.pool, async (tx) => {
    const { rows } = await tx.query<{
      phone: string;
      code_hash: string;
      attempts: number;
      expires_at: Date;
      consumed_at: Date | null;
    }>(
      'SELECT phone, code_hash, attempts, expires_at, consumed_at FROM otp_challenges WHERE id = $1 FOR UPDATE',
      [challengeId],
    );
    const challenge = rows[0];
    if (!challenge || challenge.consumed_at || challenge.expires_at <= now)
      return { ok: false as const, error: 'otp_invalid' as const };
    if (challenge.attempts >= ctx.config.auth.otpMaxAttempts)
      return { ok: false as const, error: 'otp_locked' as const };
    if (!safeEqualHex(challenge.code_hash, otpHash(ctx, challengeId, code))) {
      // L'incrément est validé (COMMIT) même si la réponse est une erreur.
      await tx.query('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1', [
        challengeId,
      ]);
      return { ok: false as const, error: 'otp_invalid' as const };
    }
    await tx.query('UPDATE otp_challenges SET consumed_at = $2 WHERE id = $1', [challengeId, now]);

    const { rows: users } = await tx.query<{
      id: string;
      phone: string;
      full_name: string | null;
      roles: Role[];
      status: string;
    }>(
      `INSERT INTO users (phone) VALUES ($1)
       ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
       RETURNING id, phone, full_name, roles::text[] AS roles, status`,
      [challenge.phone],
    );
    const user = users[0]!;
    if (user.status !== 'active')
      return { ok: false as const, error: 'account_suspended' as const };

    const token = randomToken();
    const isStaff = user.roles.some((r) => STAFF_ROLES.includes(r));
    const expiresAt = isStaff
      ? addHours(now, ctx.config.auth.staffSessionHours)
      : addHours(now, ctx.config.auth.sessionDays * 24);
    await tx.query(
      `INSERT INTO sessions (user_id, token_hash, device_label, ip, expires_at, created_at, last_seen_at)
       VALUES ($1, $2, $3, $4::inet, $5, $6, $6)`,
      [user.id, sha256(token), meta.deviceLabel ?? null, meta.ip, expiresAt, now],
    );
    return {
      ok: true as const,
      token,
      expiresAt,
      user: { id: user.id, phone: user.phone, fullName: user.full_name, roles: user.roles },
    };
  });

  if (!outcome.ok) {
    const messages = {
      otp_invalid: [401, 'Code incorrect ou expiré'],
      otp_locked: [429, 'Trop de tentatives : demandez un nouveau code'],
      account_suspended: [403, 'Compte suspendu : contactez le support'],
    } as const;
    const [status, message] = messages[outcome.error];
    throw new HttpError(status, outcome.error, message);
  }
  const { ok: _ok, ...session } = outcome;
  return session;
}

export async function authenticate(
  ctx: AppContext,
  token: string,
): Promise<(AuthUser & AuthSession) | null> {
  const now = ctx.clock.now();
  const { rows } = await ctx.pool.query<{
    session_id: string;
    mfa_verified: boolean;
    last_seen_at: Date;
    id: string;
    phone: string;
    full_name: string | null;
    roles: Role[];
  }>(
    `SELECT s.id AS session_id, s.mfa_verified_at IS NOT NULL AS mfa_verified, s.last_seen_at,
            u.id, u.phone, u.full_name, u.roles::text[] AS roles
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2 AND u.status = 'active'`,
    [sha256(token), now],
  );
  const r = rows[0];
  if (!r) return null;
  // Dernière activité, à la minute près : « Personnel » et le secours des notifications s'en servent.
  if (now.getTime() - r.last_seen_at.getTime() >= 60_000) {
    await ctx.pool.query('UPDATE sessions SET last_seen_at = $2 WHERE id = $1', [
      r.session_id,
      now,
    ]);
  }
  return {
    sessionId: r.session_id,
    mfaVerified: r.mfa_verified,
    id: r.id,
    phone: r.phone,
    fullName: r.full_name,
    roles: r.roles,
  };
}

export async function revokeSession(ctx: AppContext, sessionId: string): Promise<void> {
  await ctx.pool.query('UPDATE sessions SET revoked_at = $2 WHERE id = $1', [
    sessionId,
    ctx.clock.now(),
  ]);
}
