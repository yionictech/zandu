import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { errorHandler } from '../src/lib/errors.js';
import { devMessagesRoutes } from '../src/modules/notifications/dev.routes.js';
import { DevNotificationSender } from '../src/modules/notifications/sender.js';

const KEY = 'cle-de-recette-longue-et-aleatoire';
/** Configuration minimale d'une recette en ligne (voir deploy/recette/.env.example). */
const RECETTE = {
  NODE_ENV: 'production',
  ZANDU_ENV: 'recette',
  DATABASE_URL: 'postgres://zandu@db/zandu',
  APP_SECRET: 'secret-de-recette-secret-de-recette-42',
  SIMULATOR_WEBHOOK_SECRET: 'webhook-de-recette-123',
  RECETTE_KEY: KEY,
  STORAGE_DRIVER: 's3',
  S3_ENDPOINT: 'http://stockage:8333',
  S3_PUBLIC_ENDPOINT: 'https://media.recette.exemple.cg',
  CORS_ORIGINS: 'https://recette.exemple.cg',
};

describe('Environnements de déploiement', () => {
  it('la recette tourne en production mais avec l’agrégateur simulé et la clé de la boîte', () => {
    const config = loadConfig(RECETTE);
    expect(config.env).toBe('recette');
    expect(config.paymentProvider).toBe('simulator');
    expect(config.recetteKey).toBe(KEY);
    expect(config.auth.staffMfaRequired).toBe(true);
    expect(config.storage).toMatchObject({
      driver: 's3',
      endpoint: 'http://stockage:8333',
      publicEndpoint: 'https://media.recette.exemple.cg',
    });
  });

  it('la recette refuse de démarrer sans ses garde-fous', () => {
    const without = (name: keyof typeof RECETTE) =>
      Object.fromEntries(Object.entries(RECETTE).filter(([key]) => key !== name));
    expect(() => loadConfig(without('RECETTE_KEY'))).toThrow(/RECETTE_KEY/);
    expect(() => loadConfig(without('SIMULATOR_WEBHOOK_SECRET'))).toThrow(
      /SIMULATOR_WEBHOOK_SECRET/,
    );
    expect(() => loadConfig(without('STORAGE_DRIVER'))).toThrow(/STORAGE_DRIVER=s3/);
    expect(() => loadConfig(without('CORS_ORIGINS'))).toThrow(/CORS_ORIGINS/);
    expect(() => loadConfig({ ...RECETTE, STAFF_MFA_REQUIRED: 'false' })).toThrow(/second facteur/);
    expect(() => loadConfig({ ...RECETTE, RECETTE_KEY: 'courte' })).toThrow();
  });

  it('la production interdit le simulateur et ne lit jamais la clé de recette', () => {
    const production = { ...RECETTE, ZANDU_ENV: 'production' };
    expect(() => loadConfig(production)).toThrow(/simulateur/);
    const config = loadConfig({ ...production, PAYMENT_PROVIDER: 'agregateur' });
    expect(config.env).toBe('production');
    expect(config.recetteKey).toBeNull();
  });

  it('NODE_ENV=production ne peut pas être déclaré « développement » par erreur', () => {
    expect(() => loadConfig({ ...RECETTE, ZANDU_ENV: 'development' })).toThrow(/incompatible/);
    expect(loadConfig({ ...RECETTE, ZANDU_ENV: undefined, PAYMENT_PROVIDER: 'x' }).env).toBe(
      'production',
    );
  });
});

describe('Boîte de réception de recette', () => {
  async function inbox() {
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
    } finally {
      console.log = log;
    }
    const app = Fastify();
    app.setErrorHandler(errorHandler);
    const db = { query: async () => ({ rows: [] }) } as never;
    await app.register(devMessagesRoutes(sender, db, KEY));
    return app;
  }

  it('exige la clé de recette, comparée sans fuite de temps', async () => {
    const app = await inbox();
    const url = '/dev/messages?recipient=%2B242061111111';
    for (const headers of [{}, { 'x-recette-key': 'mauvaise-cle' }]) {
      const res = await app.inject({ method: 'GET', url, headers });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('recette_key_required');
    }
    const res = await app.inject({ method: 'GET', url, headers: { 'x-recette-key': KEY } });
    expect(res.statusCode).toBe(200);
    expect(res.json().items[0].variables).toEqual({ code: '123456' });
    await app.close();
  });

  it('se lit numéro par numéro : pas de liste de tous les codes', async () => {
    const app = await inbox();
    const res = await app.inject({
      method: 'GET',
      url: '/dev/messages',
      headers: { 'x-recette-key': KEY },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
