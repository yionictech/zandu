import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  call,
  createTestEnv,
  login,
  resetDatabase,
  sweep,
  type Session,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
let admin: Session;

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => env.close());
beforeEach(async () => {
  await resetDatabase(env.pool);
  env.notifier.sent.length = 0;
  admin = await login(env, '06 999 99 99', ['buyer', 'admin']);
});

const staffList = (s: Session = admin) => call(env, s, { method: 'GET', url: '/v1/admin/staff' });
const add = (payload: Record<string, unknown>, s: Session = admin) =>
  call(env, s, { method: 'POST', url: '/v1/admin/staff', payload });
const post = (url: string, payload?: Record<string, unknown>, s: Session = admin) =>
  call(env, s, { method: 'POST', url, ...(payload ? { payload } : {}) });
/** Reconnexion du même numéro : un code SMS par minute au plus (anti-fraude). */
async function relogin(phone: string) {
  env.clock.advanceMinutes(2);
  return login(env, phone);
}
/** Dernier SMS « back-office » reçu par un numéro (après passage du worker). */
async function staffSms(phone: string) {
  await sweep(env);
  return env.notifier.lastTo(phone, 'staff_access');
}

describe('Comptes du personnel', () => {
  it('un administrateur ajoute un agent : compte créé, SMS, accès au back-office', async () => {
    const created = await add({
      phone: '06 123 45 67',
      fullName: 'Grâce Mavoungou',
      role: 'support',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      phone: '+242061234567',
      fullName: 'Grâce Mavoungou',
      role: 'support',
      active: true,
      mfaEnrolled: false,
      activeSessions: 0,
    });
    const sms = await staffSms('+242061234567');
    expect(sms).toMatchObject({ channel: 'sms' });
    expect(sms!.variables.message).toContain('agent du support');

    const agent = await login(env, '06 123 45 67');
    expect((await call(env, agent, { method: 'GET', url: '/v1/support/overview' })).status).toBe(
      200,
    );
    // Un agent n'administre pas le personnel.
    expect((await staffList(agent)).status).toBe(403);
    expect(
      (await add({ phone: '06 000 00 01', fullName: 'X Y', role: 'admin' }, agent)).status,
    ).toBe(403);

    const list = (await staffList()).body.items;
    expect(list.map((m: { role: string }) => m.role)).toEqual(['admin', 'support']);
    expect(list[1]).toMatchObject({ activeSessions: 1, lastSeenAt: expect.any(String) });

    const audit = await env.pool.query(
      `SELECT action, metadata FROM audit_logs WHERE action = 'staff.added'`,
    );
    expect(audit.rows[0].metadata).toEqual({ role: 'support', newAccount: true });
  });

  it("un acheteur existant devient agent : il garde ses rôles, sa session d'acheteur est fermée", async () => {
    const buyer = await login(env, '05 555 55 55');
    const res = await add({ phone: '+242055555555', fullName: 'Prisca Nkounkou', role: 'support' });
    expect(res.status).toBe(201);
    // La session de 30 jours ne sert pas au back-office : reconnexion obligatoire.
    expect((await call(env, buyer, { method: 'GET', url: '/v1/me' })).status).toBe(401);
    const again = await relogin('05 555 55 55');
    const me = await call(env, again, { method: 'GET', url: '/v1/me' });
    expect(me.body.roles).toEqual(['buyer', 'support']);

    const twice = await add({ phone: '05 555 55 55', fullName: 'Prisca', role: 'admin' });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('already_staff');
  });

  it('changement de rôle : sessions fermées, nouveau rôle effectif, journalisé', async () => {
    const { body: member } = await add({
      phone: '06 123 45 67',
      fullName: 'Grâce',
      role: 'support',
    });
    const agent = await login(env, '06 123 45 67');
    const promoted = await post(`/v1/admin/staff/${member.id}/role`, { role: 'admin' });
    expect(promoted.body).toMatchObject({ role: 'admin', activeSessions: 0 });
    expect((await call(env, agent, { method: 'GET', url: '/v1/me' })).status).toBe(401);
    const newAdmin = await relogin('06 123 45 67');
    expect((await staffList(newAdmin)).status).toBe(200);
    expect((await staffSms('+242061234567'))!.variables.message).toContain('administrateur');

    const back = await post(`/v1/admin/staff/${member.id}/role`, { role: 'support' });
    expect(back.body.role).toBe('support');
    const me = await call(env, await relogin('06 123 45 67'), { method: 'GET', url: '/v1/me' });
    expect(me.body.roles).toEqual(['buyer', 'support']);
    const changes = await env.pool.query(
      `SELECT metadata FROM audit_logs WHERE action = 'staff.role_changed' ORDER BY id`,
    );
    expect(changes.rows.map((r) => r.metadata)).toEqual([
      { from: 'support', to: 'admin' },
      { from: 'admin', to: 'support' },
    ]);
  });

  it('retrait d’accès : plus de back-office, second facteur effacé, compte acheteur conservé', async () => {
    const { body: member } = await add({
      phone: '06 123 45 67',
      fullName: 'Grâce',
      role: 'support',
    });
    const agent = await login(env, '06 123 45 67');
    await env.pool.query(
      `INSERT INTO user_mfa (user_id, totp_secret_encrypted, enabled_at) VALUES ($1, '\\x00', now())`,
      [member.id],
    );
    const short = await post(`/v1/admin/staff/${member.id}/revoke`, { reason: 'ok' });
    expect(short.status).toBe(400);
    const revoked = await post(`/v1/admin/staff/${member.id}/revoke`, {
      reason: 'Fin de contrat le 31 octobre',
    });
    expect(revoked.status).toBe(204);
    expect((await call(env, agent, { method: 'GET', url: '/v1/me' })).status).toBe(401);
    expect((await staffSms('+242061234567'))!.variables.message).toContain('retiré');

    const after = await relogin('06 123 45 67');
    expect((await call(env, after, { method: 'GET', url: '/v1/support/overview' })).status).toBe(
      403,
    );
    const { rows } = await env.pool.query(
      `SELECT roles::text[] AS roles, (SELECT count(*)::int FROM user_mfa WHERE user_id = u.id) AS mfa
       FROM users u WHERE id = $1`,
      [member.id],
    );
    expect(rows[0]).toEqual({ roles: ['buyer'], mfa: 0 });
    expect((await staffList()).body.items).toHaveLength(1);
    expect(
      (await call(env, admin, { method: 'GET', url: `/v1/admin/staff/${member.id}` })).status,
    ).toBe(404);
    const audit = await env.pool.query(
      `SELECT metadata FROM audit_logs WHERE action = 'staff.revoked'`,
    );
    expect(audit.rows[0].metadata).toEqual({ reason: 'Fin de contrat le 31 octobre', sessions: 1 });
  });

  it('garde-fous : jamais sur soi-même, jamais le dernier administrateur', async () => {
    const self = await post(`/v1/admin/staff/${admin.userId}/role`, { role: 'support' });
    expect(self.body.error.code).toBe('self_change');
    const selfRevoke = await post(`/v1/admin/staff/${admin.userId}/revoke`, { reason: 'Départ' });
    expect(selfRevoke.body.error.code).toBe('self_change');

    // Un autre administrateur peut retirer le premier…
    const { body: second } = await add({
      phone: '06 222 22 22',
      fullName: 'Second',
      role: 'admin',
    });
    const other = await login(env, '06 222 22 22');
    expect(
      (await post(`/v1/admin/staff/${admin.userId}/revoke`, { reason: 'Départ' }, other)).status,
    ).toBe(204);
    // …mais, resté seul, il ne peut pas se rétrograder : Zandu garde toujours un administrateur.
    const last = await post(`/v1/admin/staff/${second.id}/role`, { role: 'support' }, other);
    expect(last.body.error.code).toBe('self_change');
    const { rows } = await env.pool.query(
      `SELECT count(*)::int AS n FROM users WHERE 'admin' = ANY(roles)`,
    );
    expect(rows[0].n).toBe(1);
  });

  it('déconnexion partout et réinitialisation du second facteur : la personne est prévenue', async () => {
    const { body: member } = await add({
      phone: '06 123 45 67',
      fullName: 'Grâce',
      role: 'support',
    });
    const a1 = await login(env, '06 123 45 67');
    await relogin('06 123 45 67');
    const out = await post(`/v1/admin/staff/${member.id}/sign-out`);
    expect(out.body).toEqual({ sessions: 2 });
    expect((await call(env, a1, { method: 'GET', url: '/v1/me' })).status).toBe(401);
    // Un administrateur peut se déconnecter partout lui-même.
    expect((await post(`/v1/admin/staff/${admin.userId}/sign-out`)).body.sessions).toBe(1);

    admin = await relogin('06 999 99 99');
    await env.pool.query(
      `INSERT INTO user_mfa (user_id, totp_secret_encrypted, enabled_at) VALUES ($1, '\\x00', now())`,
      [member.id],
    );
    expect(
      (await call(env, admin, { method: 'GET', url: `/v1/admin/staff/${member.id}` })).body
        .mfaEnrolled,
    ).toBe(true);
    expect((await post(`/v1/admin/users/${member.id}/mfa/reset`)).status).toBe(204);
    expect((await staffSms('+242061234567'))!.variables.message).toContain('second facteur');

    const detail = await call(env, admin, { method: 'GET', url: `/v1/admin/staff/${member.id}` });
    expect(detail.body.mfaEnrolled).toBe(false);
    const own = await call(env, admin, { method: 'GET', url: `/v1/admin/staff/${admin.userId}` });
    expect(own.body.recentActions.map((x: { action: string }) => x.action)).toEqual([
      'mfa.reset',
      'staff.signed_out',
      'staff.signed_out',
      'staff.added',
    ]);
  });
});
