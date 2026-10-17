import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { devMessagesRoutes } from '../src/modules/notifications/dev.routes.js';
import { DevNotificationSender } from '../src/modules/notifications/sender.js';
import { MemoryStorage } from '../src/modules/storage/storage.js';

describe('Outils de développement', () => {
  it('le stockage de développement survit au redémarrage quand un dossier est configuré', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zandu-storage-'));
    try {
      await new MemoryStorage('http://api', dir).put(
        'public',
        'products/u/a.jpg',
        Buffer.from('abc'),
        'image/jpeg',
      );
      const restarted = new MemoryStorage('http://api', dir);
      expect(await restarted.head({ bucket: 'public', key: 'products/u/a.jpg' })).toEqual({
        size: 3,
        contentType: 'image/jpeg',
      });
      await expect(
        restarted.put('public', '../../evade.jpg', Buffer.from('x'), 'image/jpeg'),
      ).rejects.toThrow(/invalide/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('la boîte de réception de développement expose les derniers messages par destinataire', async () => {
    const sender = new DevNotificationSender();
    const log = console.log;
    console.log = () => undefined;
    try {
      await sender.send({
        channel: 'sms',
        recipient: '+242061111111',
        template: 'otp_code',
        variables: { code: '123456' },
        text: 'x',
      });
      await sender.send({
        channel: 'sms',
        recipient: '+242052222222',
        template: 'otp_code',
        variables: { code: '654321' },
        text: 'y',
      });
    } finally {
      console.log = log;
    }
    const app = Fastify();
    const db = {
      query: async () => ({
        rows: [
          {
            recipient: '+242061111111',
            channel: 'sms',
            template: 'buyer_handover_code',
            variables: { code: '482916' },
            created_at: new Date(Date.now() + 1000),
          },
        ],
      }),
    } as never;
    await app.register(devMessagesRoutes(sender, db));
    const res = await app.inject({ method: 'GET', url: '/dev/messages?recipient=%2B242061111111' });
    expect(res.json().items).toEqual([
      expect.objectContaining({ template: 'buyer_handover_code', variables: { code: '482916' } }),
      expect.objectContaining({ template: 'otp_code', variables: { code: '123456' } }),
    ]);
    await app.close();
  });
});

describe('Robustesse HTTP', () => {
  it('accepte un POST sans corps annoncé en JSON, rejette un JSON invalide', async () => {
    const { createTestEnv, setupMarketplace, call } = await import('./helpers.js');
    const env = await createTestEnv();
    try {
      const m = await setupMarketplace(env);
      const empty = await env.app.inject({
        method: 'POST',
        url: '/v1/auth/logout',
        headers: { ...m.buyer.headers, 'content-type': 'application/json' },
      });
      expect(empty.statusCode).toBe(204);
      const invalid = await env.app.inject({
        method: 'POST',
        url: '/v1/auth/otp/request',
        headers: { 'content-type': 'application/json' },
        payload: '{"phone":',
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().error.code).toBe('invalid_json');
      expect((await call(env, null, { method: 'GET', url: '/health' })).status).toBe(200);
    } finally {
      await env.close();
    }
  });
});
