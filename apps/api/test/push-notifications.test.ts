import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ExpoPushSender, PushTokenInvalidError } from '../src/modules/notifications/sender.js';
import {
  approveAndNotify,
  call,
  checkout,
  createTestEnv,
  login,
  pay,
  setupMarketplace,
  sweep,
  type Marketplace,
  type Session,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
let m: Marketplace;

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => env.close());
beforeEach(async () => {
  m = await setupMarketplace(env);
});

const SELLER_PHONE = '+242061111111';
const BUYER_PHONE = '+242055555555';
const SELLER_TOKEN = 'ExponentPushToken[vendeur-1]';
const BUYER_TOKEN = 'ExponentPushToken[acheteur-1]';

const register = (who: Session, token: string) =>
  call(env, who, {
    method: 'PUT',
    url: '/v1/me/devices',
    payload: { token, platform: 'android' },
  });

/** Commande payée par l'acheteur du marché de test ; messages distribués. */
async function paidOrder(): Promise<string> {
  const co = await checkout(env, m.buyer, [{ productId: m.productId, quantity: 1 }]);
  const payment = await pay(env, m.buyer, co.id);
  await approveAndNotify(env, payment.body.id);
  await sweep(env);
  return co.orders[0].id;
}

const sentTo = (recipient: string, template: string) =>
  env.notifier.sent.filter((s) => s.recipient === recipient && s.template === template);

describe('Notifications sur le téléphone (ADR-0018)', () => {
  it('nouvelle commande : notification au vendeur, avec l’écran à ouvrir ; le code reste en SMS', async () => {
    expect((await register(m.seller, SELLER_TOKEN)).status).toBe(204);
    const orderId = await paidOrder();

    const [push] = sentTo(SELLER_TOKEN, 'seller_new_order');
    expect(push).toMatchObject({ channel: 'push', title: 'Nouvelle commande' });
    expect(push!.text).toMatch(/^nouvelle commande ZD-/);
    expect(push!.data).toMatchObject({ url: `/vendeur/commande/${orderId}` });
    expect(push!.data!.notificationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(sentTo(SELLER_PHONE, 'seller_new_order')).toHaveLength(0);
    // Sans téléphone enregistré, l'acheteur reçoit WhatsApp ; son code de remise, toujours en SMS.
    expect(sentTo(BUYER_PHONE, 'buyer_payment_confirmed')[0]!.channel).toBe('whatsapp');
    expect(sentTo(BUYER_PHONE, 'buyer_handover_code')[0]!.channel).toBe('sms');
  });

  it('restée sans suite 15 minutes : doublée par WhatsApp', async () => {
    await register(m.seller, SELLER_TOKEN);
    await paidOrder();
    env.clock.advanceMinutes(14);
    await sweep(env);
    expect(sentTo(SELLER_PHONE, 'seller_new_order')).toHaveLength(0);
    env.clock.advanceMinutes(2);
    await sweep(env);
    expect(sentTo(SELLER_PHONE, 'seller_new_order')).toMatchObject([{ channel: 'whatsapp' }]);
    env.clock.advanceMinutes(30);
    await sweep(env);
    expect(sentTo(SELLER_PHONE, 'seller_new_order')).toHaveLength(1); // une seule fois
  });

  it('touchée, ou le vendeur est revenu dans l’application : pas de doublon', async () => {
    await register(m.seller, SELLER_TOKEN);
    await paidOrder();
    const id = sentTo(SELLER_TOKEN, 'seller_new_order')[0]!.data!.notificationId!;
    // Seul le destinataire peut la marquer comme reçue.
    expect(
      (await call(env, m.buyer, { method: 'POST', url: `/v1/me/notifications/${id}/ack` })).status,
    ).toBe(404);
    expect(
      (await call(env, m.seller, { method: 'POST', url: `/v1/me/notifications/${id}/ack` })).status,
    ).toBe(204);
    env.clock.advanceMinutes(20);
    await sweep(env);
    expect(sentTo(SELLER_PHONE, 'seller_new_order')).toHaveLength(0);

    // Deuxième commande : pas touchée, mais le vendeur ouvre l'application entre-temps.
    await paidOrder();
    env.clock.advanceMinutes(3);
    await call(env, m.seller, { method: 'GET', url: '/v1/seller/orders' });
    env.clock.advanceMinutes(15);
    await sweep(env);
    expect(sentTo(SELLER_PHONE, 'seller_new_order')).toHaveLength(0);
  });

  it('simple nouvelle : jamais doublée ; message important à l’acheteur : doublé', async () => {
    await register(m.buyer, BUYER_TOKEN);
    const orderId = await paidOrder();
    await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${orderId}/accept` });
    await sweep(env);
    expect(sentTo(BUYER_TOKEN, 'buyer_order_accepted')).toHaveLength(1);
    expect(sentTo(BUYER_TOKEN, 'buyer_order_accepted')[0]!.data!.url).toBe(`/commande/${orderId}`);
    await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${orderId}/ready` });
    await call(env, m.admin, {
      method: 'POST',
      url: `/v1/support/deliveries/${orderId}/assign`,
      payload: { riderId: m.rider.riderId },
    });
    await call(env, m.rider, { method: 'POST', url: `/v1/rider/deliveries/${orderId}/pickup` });
    await sweep(env);
    expect(sentTo(BUYER_TOKEN, 'buyer_in_delivery')).toHaveLength(1);
    env.clock.advanceMinutes(16);
    await sweep(env);
    expect(sentTo(BUYER_PHONE, 'buyer_order_accepted')).toHaveLength(0);
    expect(sentTo(BUYER_PHONE, 'buyer_in_delivery')).toMatchObject([{ channel: 'whatsapp' }]);
  });

  it('jeton refusé par le service : téléphone oublié, WhatsApp tout de suite', async () => {
    await register(m.seller, SELLER_TOKEN);
    env.notifier.invalidTokens.add(SELLER_TOKEN);
    await paidOrder();
    await sweep(env); // le message de secours part à la passe suivante du worker
    expect(sentTo(SELLER_PHONE, 'seller_new_order')).toMatchObject([{ channel: 'whatsapp' }]);
    const { rows } = await env.pool.query('SELECT disabled_at FROM push_devices');
    expect(rows[0].disabled_at).not.toBeNull();
    // Commande suivante : plus de tentative vers ce téléphone.
    env.notifier.invalidTokens.clear();
    await paidOrder();
    await sweep(env);
    expect(sentTo(SELLER_TOKEN, 'seller_new_order')).toHaveLength(0);
    expect(sentTo(SELLER_PHONE, 'seller_new_order')).toHaveLength(2);
  });

  it('déconnexion ou téléphone passé à un autre compte : plus rien du compte précédent', async () => {
    await register(m.seller, SELLER_TOKEN);
    await call(env, m.seller, { method: 'POST', url: '/v1/auth/logout' });
    await paidOrder();
    expect(sentTo(SELLER_TOKEN, 'seller_new_order')).toHaveLength(0);
    expect(sentTo(SELLER_PHONE, 'seller_new_order')).toHaveLength(1);

    // Le même téléphone, connecté par l'acheteur : il reçoit les messages de l'acheteur seulement.
    env.clock.advanceMinutes(2); // un code SMS par minute
    const seller = await login(env, '06 111 11 11');
    await register(seller, SELLER_TOKEN);
    await register(m.buyer, SELLER_TOKEN);
    const orderId = await paidOrder();
    await call(env, seller, { method: 'POST', url: `/v1/seller/orders/${orderId}/accept` });
    await sweep(env);
    expect(sentTo(SELLER_TOKEN, 'seller_new_order')).toHaveLength(0);
    expect(sentTo(SELLER_TOKEN, 'buyer_order_accepted')).toHaveLength(1);

    // Déconnexion faite sans réseau, renvoyée plus tard : le jeton suffit.
    expect(
      (
        await call(env, null, {
          method: 'POST',
          url: '/v1/devices/unregister',
          payload: { token: SELLER_TOKEN },
        })
      ).status,
    ).toBe(204);
    expect((await env.pool.query('SELECT 1 FROM push_devices')).rowCount).toBe(0);
    expect((await register(m.buyer, 'pas-un-jeton')).status).toBe(400);
  });
});

describe('Service de notifications d’Expo', () => {
  const message = {
    channel: 'push' as const,
    recipient: SELLER_TOKEN,
    template: 'seller_new_order',
    variables: {},
    text: 'nouvelle commande ZD-1 payée.',
    title: 'Nouvelle commande',
    data: { url: '/vendeur/commande/1', notificationId: 'n1' },
  };
  const answering = (body: unknown, calls: RequestInit[] = []) =>
    (async (_url: unknown, init?: RequestInit) => {
      calls.push(init!);
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;

  it('envoie titre, texte, écran à ouvrir, canal Android prioritaire', async () => {
    const calls: RequestInit[] = [];
    const sender = new ExpoPushSender(
      'jeton-expo',
      answering({ data: { status: 'ok', id: 't1' } }, calls),
    );
    expect(await sender.send(message)).toEqual({ providerRef: 't1' });
    expect(JSON.parse(String(calls[0]!.body))).toMatchObject({
      to: SELLER_TOKEN,
      title: 'Nouvelle commande',
      body: 'nouvelle commande ZD-1 payée.',
      data: { url: '/vendeur/commande/1' },
      channelId: 'commandes',
      priority: 'high',
    });
    expect((calls[0]!.headers as Record<string, string>).authorization).toBe('Bearer jeton-expo');
  });

  it('application désinstallée : jeton signalé invalide', async () => {
    const sender = new ExpoPushSender(
      null,
      answering({ data: { status: 'error', details: { error: 'DeviceNotRegistered' } } }),
    );
    await expect(sender.send(message)).rejects.toBeInstanceOf(PushTokenInvalidError);
  });
});
