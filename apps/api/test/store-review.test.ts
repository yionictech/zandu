import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { call, createTestEnv, type Session, type TestEnv } from './helpers.js';

const REVIEW = '+242069990011';
let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv({ STORE_REVIEW_ACCOUNT: `${REVIEW}:482915` });
});
afterAll(async () => env.close());

describe('Compte de revue Google Play / App Store', () => {
  it('code fixe, aucun SMS ; les autres numéros gardent un code aléatoire', async () => {
    const asked = await call(env, null, {
      method: 'POST',
      url: '/v1/auth/otp/request',
      payload: { phone: REVIEW },
    });
    expect(asked.status).toBe(202);
    expect(env.notifier.lastTo(REVIEW, 'otp_code')).toBeUndefined();
    const verified = await call(env, null, {
      method: 'POST',
      url: '/v1/auth/otp/verify',
      payload: { challengeId: asked.body.challengeId, code: '482915', deviceLabel: 'Revue' },
    });
    expect(verified.status).toBe(200);
    const session: Session = {
      userId: verified.body.user.id,
      phone: REVIEW,
      headers: { authorization: `Bearer ${verified.body.token}` },
    };
    const me = await call(env, session, { method: 'GET', url: '/v1/me' });
    expect(me.body.roles).toEqual(['buyer']);

    // Suppression testable par les relecteurs : même code, sans SMS.
    const deletion = await call(env, session, { method: 'POST', url: '/v1/me/deletion' });
    expect(deletion.status).toBe(202);
    const confirmed = await call(env, session, {
      method: 'POST',
      url: '/v1/me/deletion/confirm',
      payload: { challengeId: deletion.body.challengeId, code: '482915' },
    });
    expect(confirmed.status).toBe(204);
  });

  it('refuse un code trop évident', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://x',
        APP_SECRET: 'test-secret-test-secret-test-secret-42',
        STORE_REVIEW_ACCOUNT: `${REVIEW}:111111`,
      }),
    ).toThrow(/moins évident/);
  });
});
