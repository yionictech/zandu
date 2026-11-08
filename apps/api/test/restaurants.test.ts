import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addProduct,
  approveAndNotify,
  call,
  createTestEnv,
  homeDelivery,
  idemKey,
  openShop,
  pay,
  setupMarketplace,
  sweep,
  type Marketplace,
  type Session,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
let m: Marketplace;
let chef: Session & { sellerId: string };
let dishId: string;

const REPAS = '10000000-0000-4000-8000-000000000008';
const OPTIONS = [
  {
    name: 'Taille',
    choices: [
      { label: 'Normal', extra: 0 },
      { label: 'Grand', extra: 1500 },
    ],
  },
  {
    name: 'Accompagnement',
    choices: [
      { label: 'Alloco', extra: 0 },
      { label: 'Manioc', extra: 0 },
      { label: 'Frites', extra: 500 },
    ],
  },
];

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => env.close());
beforeEach(async () => {
  m = await setupMarketplace(env);
  chef = await openShop(env, m.admin, '06 222 33 44');
  await call(env, chef, {
    method: 'PATCH',
    url: '/v1/seller/shop',
    payload: { shopType: 'restaurant', defaultPrepMinutes: 30 },
  });
  dishId = await addProduct(env, chef, {
    categoryId: REPAS,
    title: 'Poulet DG',
    description: 'Poulet, plantain, légumes',
    price: 4_000,
    stock: 50,
    options: OPTIONS,
  });
});

const order = (items: object[]) =>
  call(env, m.buyer, {
    method: 'POST',
    url: '/v1/checkouts',
    headers: { 'idempotency-key': idemKey() },
    payload: { items, delivery: homeDelivery },
  });

describe('Restaurants', () => {
  it('rayon Repas : restaurants de la ville, ouverts maintenant, avec plats', async () => {
    const shop = await call(env, chef, { method: 'GET', url: '/v1/seller/shop' });
    expect(shop.body.shopType).toBe('restaurant');
    const list = await call(env, null, { method: 'GET', url: '/v1/restaurants?city=Pointe-Noire' });
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      id: chef.sellerId,
      prepMinutes: 30,
      dishCount: 1,
      openNow: true,
    });
    // Une boutique ordinaire n'y figure pas ; une autre ville non plus.
    const other = await call(env, null, { method: 'GET', url: '/v1/restaurants?city=Brazzaville' });
    expect(other.body.items).toHaveLength(0);

    // Fermé selon les horaires : toujours listé, mais après les ouverts et signalé.
    const localHour = (env.clock.now().getUTCHours() + 1) % 24;
    const day =
      localHour < 12 ? { open: '13:00', close: '23:00' } : { open: '01:00', close: '11:00' };
    await call(env, chef, {
      method: 'PATCH',
      url: '/v1/seller/shop',
      payload: { weeklyHours: Array.from({ length: 7 }, () => day) },
    });
    const later = await call(env, null, { method: 'GET', url: '/v1/restaurants' });
    expect(later.body.items[0].openNow).toBe(false);
  });

  it('plat à options : prix avec suppléments, choix gardés, deux variantes = deux lignes', async () => {
    const detail = await call(env, null, { method: 'GET', url: `/v1/products/${dishId}` });
    expect(detail.body).toMatchObject({ isDish: true, options: OPTIONS });

    const co = await order([
      { productId: dishId, quantity: 2, options: ['Grand', 'Frites'] },
      { productId: dishId, quantity: 1, options: ['Normal', 'Alloco'] },
    ]);
    expect(co.status).toBe(201);
    const items = co.body.orders[0].items;
    const grand = items.find((i: { title: string }) => i.title === 'Poulet DG (Grand, Frites)');
    expect(grand).toMatchObject({ unitPrice: 6_000, quantity: 2, lineTotal: 12_000 });
    expect(grand.options).toEqual([
      { group: 'Taille', choice: 'Grand', extra: 1500 },
      { group: 'Accompagnement', choice: 'Frites', extra: 500 },
    ]);
    expect(co.body.orders[0].itemsSubtotal).toBe(12_000 + 4_000);

    // Restaurant : 15 minutes pour accepter une fois payé.
    const payment = await pay(env, m.buyer, co.body.id);
    await approveAndNotify(env, payment.body.id);
    const { rows } = await env.pool.query<{ minutes: number }>(
      `SELECT round(extract(epoch FROM seller_accept_deadline - paid_at) / 60)::int AS minutes
       FROM orders WHERE id = $1`,
      [co.body.orders[0].id],
    );
    expect(rows[0]!.minutes).toBe(15);
    await sweep(env);
    const stock = await env.pool.query<{ stock: number }>(
      'SELECT stock FROM products WHERE id = $1',
      [dishId],
    );
    expect(stock.rows[0]!.stock).toBe(47);
  });

  it('choix manquant ou inconnu refusé ; options mal formées refusées au restaurant', async () => {
    expect((await order([{ productId: dishId, quantity: 1 }])).body.error.code).toBe(
      'options_required',
    );
    expect(
      (await order([{ productId: dishId, quantity: 1, options: ['Géant', 'Alloco'] }])).body.error
        .code,
    ).toBe('invalid_option_choice');
    // Un produit sans options n'en accepte pas.
    expect(
      (await order([{ productId: m.productId, quantity: 1, options: ['Grand'] }])).body.error.code,
    ).toBe('options_required');

    const bad = await call(env, chef, {
      method: 'PATCH',
      url: `/v1/seller/products/${dishId}`,
      payload: { options: [{ name: 'Sauce', choices: [{ label: 'Pili', extra: 0 }] }] },
    });
    expect(bad.status).toBe(400);
    const cleared = await call(env, chef, {
      method: 'PATCH',
      url: `/v1/seller/products/${dishId}`,
      payload: { options: null },
    });
    expect(cleared.status).toBe(200);
    const mine = await call(env, chef, { method: 'GET', url: `/v1/seller/products/${dishId}` });
    expect(mine.body.options).toBeNull();
  });
});
