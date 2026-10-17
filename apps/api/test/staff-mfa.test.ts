import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { base32Decode, totpCode, totpStep } from '../src/lib/totp.js';
import {
  call,
  createTestEnv,
  login,
  resetDatabase,
  type Session,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv({ STAFF_MFA_REQUIRED: 'true' });
});
afterAll(async () => env.close());
beforeEach(async () => {
  await resetDatabase(env.pool);
});

const codeNow = (secret: string) => totpCode(base32Decode(secret), totpStep(env.clock.now()));
const staffQueue = (s: Session) => call(env, s, { method: 'GET', url: '/v1/admin/sellers' });

/** Configure le second facteur d'un membre du personnel ; renvoie le secret. */
async function enrol(session: Session): Promise<string> {
  const setup = await call(env, session, { method: 'POST', url: '/v1/auth/mfa/setup' });
  expect(setup.status).toBe(200);
  const confirmed = await call(env, session, {
    method: 'POST',
    url: '/v1/auth/mfa/confirm',
    payload: { code: codeNow(setup.body.secret) },
  });
  expect(confirmed.status).toBe(204);
  return setup.body.secret;
}

describe('TOTP (RFC 6238)', () => {
  it('reproduit les vecteurs de référence SHA-1', () => {
    const secret = Buffer.from('12345678901234567890');
    expect(totpCode(secret, Math.floor(59 / 30))).toBe('287082');
    expect(totpCode(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpCode(secret, Math.floor(1234567890 / 30))).toBe('005924');
  });
});

describe('Second facteur du personnel', () => {
  it('les routes du support restent fermées tant que le code TOTP n’est pas validé', async () => {
    const admin = await login(env, '06 999 99 99', ['buyer', 'admin']);
    const blocked = await staffQueue(admin);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('mfa_required');

    const setup = await call(env, admin, { method: 'POST', url: '/v1/auth/mfa/setup' });
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\/Zandu%20Back-office/);
    const wrong = await call(env, admin, {
      method: 'POST',
      url: '/v1/auth/mfa/confirm',
      payload: { code: codeNow(setup.body.secret) === '000000' ? '111111' : '000000' },
    });
    expect(wrong.body.error.code).toBe('mfa_invalid');
    await call(env, admin, {
      method: 'POST',
      url: '/v1/auth/mfa/confirm',
      payload: { code: codeNow(setup.body.secret) },
    });
    expect((await staffQueue(admin)).status).toBe(200);
    expect((await call(env, admin, { method: 'GET', url: '/v1/auth/mfa' })).body).toEqual({
      required: true,
      enrolled: true,
      verified: true,
    });

    // Le secret est chiffré en base : ni le secret brut ni sa forme base32 n'y figurent.
    const { rows } = await env.pool.query<{ s: Buffer }>(
      'SELECT totp_secret_encrypted AS s FROM user_mfa',
    );
    expect(rows[0]!.s.includes(base32Decode(setup.body.secret))).toBe(false);
    expect(rows[0]!.s.toString('latin1')).not.toContain(setup.body.secret);

    // Une nouvelle configuration est refusée une fois le second facteur actif.
    const again = await call(env, admin, { method: 'POST', url: '/v1/auth/mfa/setup' });
    expect(again.body.error.code).toBe('mfa_already_enabled');
  });

  it('le secret non confirmé reste le même 10 minutes (page rechargée), puis change', async () => {
    const admin = await login(env, '06 999 99 99', ['buyer', 'admin']);
    const first = await call(env, admin, { method: 'POST', url: '/v1/auth/mfa/setup' });
    env.clock.advanceMinutes(5);
    const reload = await call(env, admin, { method: 'POST', url: '/v1/auth/mfa/setup' });
    expect(reload.body.secret).toBe(first.body.secret);
    env.clock.advanceMinutes(6);
    const expired = await call(env, admin, { method: 'POST', url: '/v1/auth/mfa/setup' });
    expect(expired.body.secret).not.toBe(first.body.secret);
  });

  it('chaque nouvelle session demande un code ; un code déjà utilisé est refusé', async () => {
    const first = await login(env, '06 999 99 99', ['buyer', 'support']);
    const secret = await enrol(first);

    env.clock.advanceMinutes(2); // délai minimal entre deux codes SMS
    const second = await login(env, '06 999 99 99');
    expect((await staffQueue(second)).status).toBe(403);
    const code = codeNow(secret);
    const verified = await call(env, second, {
      method: 'POST',
      url: '/v1/auth/mfa/verify',
      payload: { code },
    });
    expect(verified.status).toBe(204);
    expect((await staffQueue(second)).status).toBe(200);

    // Rejeu du même code (observé par-dessus l'épaule, par exemple) : refusé.
    const replay = await call(env, second, {
      method: 'POST',
      url: '/v1/auth/mfa/verify',
      payload: { code },
    });
    expect(replay.body.error.code).toBe('mfa_invalid');
  });

  it('cinq codes erronés révoquent la session', async () => {
    const first = await login(env, '06 999 99 99', ['buyer', 'support']);
    const secret = await enrol(first);
    env.clock.advanceMinutes(2);
    const session = await login(env, '06 999 99 99');
    const bad = codeNow(secret) === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) {
      const res = await call(env, session, {
        method: 'POST',
        url: '/v1/auth/mfa/verify',
        payload: { code: bad },
      });
      expect(res.body.error.code).toBe('mfa_invalid');
    }
    const last = await call(env, session, {
      method: 'POST',
      url: '/v1/auth/mfa/verify',
      payload: { code: bad },
    });
    expect(last.body.error.code).toBe('mfa_locked');
    expect((await call(env, session, { method: 'GET', url: '/v1/me' })).status).toBe(401);
  });

  it('un acheteur ne peut pas configurer de second facteur', async () => {
    const buyer = await login(env, '05 555 55 55');
    const res = await call(env, buyer, { method: 'POST', url: '/v1/auth/mfa/setup' });
    expect(res.status).toBe(403);
    expect((await call(env, buyer, { method: 'GET', url: '/v1/auth/mfa' })).body.required).toBe(
      false,
    );
  });

  it('téléphone perdu : un administrateur réinitialise, le support reconfigure', async () => {
    const admin = await login(env, '06 999 99 99', ['buyer', 'admin']);
    await enrol(admin);
    const agent = await login(env, '06 777 77 77', ['buyer', 'support']);
    await enrol(agent);

    // Un agent du support ne peut pas réinitialiser (action d'administrateur).
    const denied = await call(env, agent, {
      method: 'POST',
      url: `/v1/admin/users/${admin.userId}/mfa/reset`,
    });
    expect(denied.status).toBe(403);

    const reset = await call(env, admin, {
      method: 'POST',
      url: `/v1/admin/users/${agent.userId}/mfa/reset`,
    });
    expect(reset.status).toBe(204);
    expect((await staffQueue(agent)).body.error.code).toBe('mfa_required');
    env.clock.advanceMinutes(1);
    await enrol(agent);
    expect((await staffQueue(agent)).status).toBe(200);

    const { rows } = await env.pool.query<{ action: string }>(
      `SELECT action FROM audit_logs WHERE action LIKE 'mfa.%' ORDER BY id`,
    );
    expect(rows.map((r) => r.action)).toEqual([
      'mfa.enabled',
      'mfa.enabled',
      'mfa.reset',
      'mfa.enabled',
    ]);
  });
});
