import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  approveAndNotify,
  balance,
  call,
  COURIER_PARTNER,
  createTestEnv,
  idemKey,
  login,
  pay,
  setupMarketplace,
  sweep,
  trialBalance,
  ZONES,
  type Marketplace,
  type Session,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
let m: Marketplace;
let sender: Session;

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => env.close());
beforeEach(async () => {
  m = await setupMarketplace(env);
  sender = await login(env, '06 444 44 44');
});

const RECIPIENT_PHONE = '+242055121212';
const parcelBody = (size = 'medium') => ({
  size,
  description: 'Pagne et documents',
  pickup: {
    name: 'Mireille K.',
    zoneId: ZONES.lumumba,
    phone: '06 444 44 44',
    landmark: 'Lumumba, à côté de la boulangerie du marché',
    location: { lat: -4.7812, lng: 11.8634, accuracy: 12 },
  },
  recipient: {
    name: 'Prisca N.',
    zoneId: ZONES.tieTie,
    phone: '05 512 12 12',
    landmark: "Tié-Tié, derrière l'école Saint-Pierre",
  },
});

async function createParcel(body: object = parcelBody()) {
  return call(env, sender, {
    method: 'POST',
    url: '/v1/parcels',
    headers: { 'idempotency-key': idemKey() },
    payload: body,
  });
}

/** Crée et paie un envoi ; renvoie l'envoi et le code reçu par SMS par le destinataire. */
async function paidParcel() {
  const created = await createParcel();
  expect(created.status).toBe(201);
  const payment = await pay(env, sender, created.body.checkoutId, 'mtn', '06 444 44 44');
  expect(payment.body.amount).toBe(created.body.total);
  await approveAndNotify(env, payment.body.id);
  await sweep(env);
  const sms = env.notifier.lastTo(RECIPIENT_PHONE, 'parcel_recipient_code');
  return { orderId: created.body.orderId as string, total: created.body.total, sms };
}

describe('Envoi de colis entre particuliers', () => {
  it('prix selon les quartiers et la taille, du paiement à la remise et au livreur payé', async () => {
    const small = await call(env, sender, {
      method: 'GET',
      url: `/v1/parcels/quote?fromZoneId=${ZONES.lumumba}&toZoneId=${ZONES.tieTie}&size=small`,
    });
    const medium = await call(env, sender, {
      method: 'GET',
      url: `/v1/parcels/quote?fromZoneId=${ZONES.lumumba}&toZoneId=${ZONES.tieTie}&size=medium`,
    });
    expect(small.status).toBe(200);
    expect(medium.body.price).toBe(small.body.price + 500);

    const { orderId, total, sms } = await paidParcel();
    expect(total).toBe(medium.body.price);
    // Le destinataire n'a pas de compte : son code arrive par SMS, avec le nom de l'expéditeur.
    expect(sms?.channel).toBe('sms');
    expect(sms?.variables.sender).toBe('Mireille K.');
    expect(env.notifier.lastTo(sender.phone, 'parcel_paid')).toBeTruthy();

    // Pas de vendeur : l'envoi est prêt à enlever dès le paiement.
    const mine = await call(env, sender, { method: 'GET', url: '/v1/parcels' });
    expect(mine.body.items[0]).toMatchObject({
      id: orderId,
      kind: 'parcel',
      status: 'ready_for_pickup',
      itemsSubtotal: 0,
      deliveryFee: total,
      parcel: { size: 'medium', description: 'Pagne et documents' },
      pickupAddress: { name: 'Mireille K.', zone: 'Lumumba (Centre-ville)' },
    });

    // File du support : l'envoi attend un livreur, sous le nom de l'expéditeur.
    const queue = await call(env, m.admin, { method: 'GET', url: '/v1/support/deliveries' });
    expect(queue.body.items[0]).toMatchObject({
      orderId,
      kind: 'parcel',
      pickupZone: 'Lumumba (Centre-ville)',
    });
    await call(env, m.admin, {
      method: 'POST',
      url: `/v1/support/deliveries/${orderId}/assign`,
      payload: { riderId: m.rider.riderId },
    });

    // Le livreur voit où enlever (chez l'expéditeur) et ce qu'il transporte.
    const mission = await call(env, m.rider, {
      method: 'GET',
      url: `/v1/rider/deliveries/${orderId}`,
    });
    expect(mission.body).toMatchObject({
      kind: 'parcel',
      parcel: { size: 'medium' },
      pickup: { shopName: 'Mireille K.', zone: 'Lumumba (Centre-ville)', phone: '+242064444444' },
    });

    // Conversation : l'expéditeur et le livreur, pas la boutique de la plateforme.
    const thread = await call(env, sender, {
      method: 'GET',
      url: `/v1/orders/${orderId}/messages`,
    });
    // (la liste donne les autres participants : seulement le livreur)
    expect(thread.body.participants.map((p: { role: string }) => p.role)).toEqual(['rider']);

    // Code de retrait saisi par l'expéditeur, puis enlèvement, puis remise au destinataire.
    expect(
      (
        await call(env, sender, {
          method: 'POST',
          url: `/v1/parcels/${orderId}/rider-pickup`,
          payload: { code: '0000' === mission.body.pickupCode ? '1111' : '0000' },
        })
      ).body.error.code,
    ).toBe('invalid_pickup_code');
    const confirmed = await call(env, sender, {
      method: 'POST',
      url: `/v1/parcels/${orderId}/rider-pickup`,
      payload: { code: mission.body.pickupCode },
    });
    expect(confirmed.status).toBe(200);
    expect(
      (await call(env, sender, { method: 'POST', url: `/v1/parcels/${orderId}/cancel` })).body.error
        .code,
    ).toBe('already_handed_over');
    await call(env, m.rider, { method: 'POST', url: `/v1/rider/deliveries/${orderId}/pickup` });
    await sweep(env);
    expect(env.notifier.lastTo(RECIPIENT_PHONE, 'parcel_recipient_on_way')).toBeTruthy();
    const handed = await call(env, m.rider, {
      method: 'POST',
      url: `/v1/rider/deliveries/${orderId}/handover`,
      payload: { code: sms!.variables.code },
    });
    expect(handed.body.status).toBe('delivered');

    await call(env, sender, { method: 'POST', url: `/v1/orders/${orderId}/confirm-receipt` });
    await sweep(env);
    // Le livreur est payé, Zandu garde la marge ; aucun vendeur crédité, rien ne reste en séquestre.
    const { rows } = await env.pool.query<{ courier_share: number }>(
      'SELECT courier_share::int FROM orders WHERE id = $1',
      [orderId],
    );
    expect(await balance(env, `liability:courier_payable:${COURIER_PARTNER}`)).toBe(
      rows[0]!.courier_share,
    );
    expect(await balance(env, 'revenue:delivery_margin')).toBe(total - rows[0]!.courier_share);
    expect(await balance(env, 'liability:escrow')).toBe(0);
    expect(await env.pool.query('SELECT 1 FROM payouts')).toMatchObject({ rowCount: 0 });
    expect(await trialBalance(env)).toBe(0);
  });

  it("annulé avant l'enlèvement : remboursé en entier, livraison annulée", async () => {
    const { orderId, total } = await paidParcel();
    const cancelled = await call(env, sender, {
      method: 'POST',
      url: `/v1/parcels/${orderId}/cancel`,
    });
    expect(cancelled.body).toEqual({ id: orderId, status: 'cancelled' });
    const { rows } = await env.pool.query<{ amount: number; status: string }>(
      `SELECT r.amount::int AS amount, d.status::text AS status
       FROM refunds r JOIN deliveries d ON d.order_id = r.order_id WHERE r.order_id = $1`,
      [orderId],
    );
    expect(rows[0]).toEqual({ amount: total, status: 'cancelled' });
    // Personne d'autre ne peut toucher à cet envoi.
    const other = await call(env, m.buyer, {
      method: 'POST',
      url: `/v1/parcels/${orderId}/cancel`,
    });
    expect(other.status).toBe(404);
  });

  it('refuse un destinataire au même numéro, un repère hors du Congo, une zone non desservie', async () => {
    const same = parcelBody();
    same.recipient.phone = '06 444 44 44';
    expect((await createParcel(same)).body.error.code).toBe('same_phone');

    const far = parcelBody();
    far.pickup.location = { lat: 48.85, lng: 2.35, accuracy: 10 };
    expect((await createParcel(far)).body.error.code).toBe('location_out_of_area');

    const nowhere = parcelBody();
    nowhere.recipient.zoneId = '20000000-0000-4000-8000-0000000009ff';
    expect((await createParcel(nowhere)).body.error.code).toBe('delivery_unavailable');
  });
});
