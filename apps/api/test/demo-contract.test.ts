import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  AUTO_PIN_MS,
  createDemoState,
  DEMO_ACCOUNTS,
  DemoApi,
  PICKUP_POINTS,
  TIE_TIE,
} from '@zandu/demo';

/**
 * Démonstration locale de l'application (apps/mobile/src/demo, docs/exploitation/demo-locale.md) :
 * chaque réponse de l'API fictive est validée contre le contrat OpenAPI, comme celles de la vraie
 * API dans contract.test.ts. Si le contrat change, la démonstration doit suivre.
 */
type Doc = {
  paths: Record<string, Record<string, { responses: Record<string, { $ref?: string }> }>>;
};
let doc: Doc;
let ajv: Ajv2020;

beforeAll(async () => {
  doc = parse(
    await readFile(
      fileURLToPath(new URL('../../../docs/api/openapi.yaml', import.meta.url)),
      'utf8',
    ),
  ) as Doc;
  ajv = new Ajv2020({ strict: false, validateSchema: false, allErrors: true });
  (addFormats as unknown as (a: Ajv2020) => void)(ajv);
  ajv.addSchema(doc as object, 'openapi.json');
});

const pointer = (...parts: string[]) =>
  parts.map((p) => p.replace(/~/g, '~0').replace(/\//g, '~1')).join('/');

function expectConforms(path: string, method: string, status: number, body: unknown): void {
  const response = doc.paths[path]?.[method]?.responses[String(status)];
  expect(response, `${method.toUpperCase()} ${path} ${status} absent du contrat`).toBeDefined();
  const ref = response!.$ref
    ? `openapi.json${response!.$ref}/content/application~1json/schema`
    : `openapi.json#/${pointer('paths', path, method, 'responses', String(status), 'content', 'application/json', 'schema')}`;
  if (status === 204 || (status === 202 && body === null)) return;
  const validate = ajv.compile({ $ref: ref });
  expect(
    validate(body),
    `${method.toUpperCase()} ${path} ${status} : ${JSON.stringify(validate.errors)}`,
  ).toBe(true);
}

/** Démonstration à une heure fixe, avec un hasard reproductible. */
function demo() {
  let now = Date.parse('2026-10-29T09:00:00Z');
  let seed = 42;
  const deps = {
    now: () => new Date(now),
    newId: () => randomUUID(),
    random: () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648,
  };
  const api = new DemoApi(createDemoState(deps), deps);
  /** Appel validé contre le contrat ; `path` est le modèle du contrat (« /v1/orders/{id} »). */
  const call = <T = Record<string, any>>(
    token: string | null,
    method: string,
    path: string,
    {
      params = {},
      query = {},
      body = null,
      expect: status,
    }: {
      params?: Record<string, string>;
      query?: Record<string, string>;
      body?: unknown;
      expect?: number;
    } = {},
  ): T => {
    const url = path.replace(/\{(\w+)\}/g, (_m, k: string) => params[k]!);
    const res = api.handle({ method, path: url, query: new URLSearchParams(query), token, body });
    if (status === undefined && res.status >= 400)
      throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(res.body)}`);
    if (status !== undefined) expect(res.status, JSON.stringify(res.body)).toBe(status);
    if (!path.startsWith('/dev/')) expectConforms(path, method.toLowerCase(), res.status, res.body);
    return res.body as T;
  };
  const login = (phone: string): string => {
    const asked = call(null, 'POST', '/v1/auth/otp/request', { body: { phone } });
    const code = api.state.messages.find((m) => m.template === 'otp_code' && m.recipient === phone)!
      .variables.code;
    return call(null, 'POST', '/v1/auth/otp/verify', {
      body: { challengeId: asked.challengeId, code },
    }).token;
  };
  const lastCode = (phone: string, template: string) =>
    api.state.messages.find((m) => m.recipient === phone && m.template === template)!.variables
      .code!;
  return { api, call, login, lastCode, advance: (ms: number) => (now += ms) };
}

const delivery = {
  mode: 'home',
  zoneId: TIE_TIE,
  recipientName: 'Prisca Nkounkou',
  phone: '06 612 34 98',
  landmark: "Tié-Tié, derrière l'école Saint-Pierre",
  location: { lat: -4.7612, lng: 11.8735, accuracy: 20 },
};

describe('Démonstration locale ⇄ contrat OpenAPI', () => {
  it('données de départ : catalogue, boutiques, commandes à traiter dans chaque espace', () => {
    const { call, login } = demo();
    expect(call(null, 'GET', '/v1/categories')).toHaveLength(7);
    const zones = call<any[]>(null, 'GET', '/v1/delivery/zones');
    expect(zones.find((z) => z.id === TIE_TIE).pickupPoints).toHaveLength(1);
    const all = call(null, 'GET', '/v1/products', { query: { limit: '50' } });
    expect(all.items).toHaveLength(12);
    expect(all.items[0].coverImage).toMatch(/^data:image\/jpeg;base64,/);
    const search = call(null, 'GET', '/v1/products', { query: { q: 'ecouteurs' } });
    expect(search.items.map((p: any) => p.title)).toEqual(['Écouteurs Bluetooth sans fil']);
    const detail = call(null, 'GET', '/v1/products/{id}', { params: { id: search.items[0].id } });
    expect(detail.reviews).toEqual({ average: 4, count: 1 });
    call(null, 'GET', '/v1/products/{id}/reviews', { params: { id: search.items[0].id } });
    call(null, 'GET', '/v1/products/{id}', { params: { id: randomUUID() }, expect: 404 });

    const buyer = login(DEMO_ACCOUNTS.buyer.phone);
    expect(call(buyer, 'GET', '/v1/me').fullName).toBe('Prisca Nkounkou');
    const orders = call(buyer, 'GET', '/v1/orders');
    expect(orders.items.map((o: any) => o.status).sort()).toEqual(['completed', 'paid']);
    expect(call(buyer, 'GET', '/v1/me/notifications').unread).toBeGreaterThan(0);

    const seller = login(DEMO_ACCOUNTS.seller.phone);
    const dashboard = call(seller, 'GET', '/v1/seller/dashboard');
    expect(dashboard.toAccept.count).toBe(1);
    const sellerOrders = call(seller, 'GET', '/v1/seller/orders', {
      query: { status: 'paid,preparing,ready_for_pickup' },
    });
    expect(sellerOrders.items.map((o: any) => o.status).sort()).toEqual([
      'paid',
      'ready_for_pickup',
    ]);
    const balance = call(seller, 'GET', '/v1/seller/balance');
    // Écouteurs 12 500 FCFA, commission électronique 8 % (1 000) : 11 500 reversés.
    expect(balance.payouts.map((p: any) => p.amount)).toEqual([11_500]);

    const rider = login(DEMO_ACCOUNTS.rider.phone);
    expect(call(rider, 'GET', '/v1/rider/deliveries').items).toHaveLength(1);
    expect(call(rider, 'GET', '/v1/rider/history', { query: { period: '7d' } }).delivered).toBe(2);
    call(rider, 'GET', '/v1/rider/me');
  });

  it('parcours complet : achat, paiement, vendeur, livreur en route, remise, avis, argent', () => {
    const { api, call, login, lastCode, advance } = demo();
    const buyer = login(DEMO_ACCOUNTS.buyer.phone);
    const products = call(null, 'GET', '/v1/products', { query: { q: 'ventilateur' } });
    const checkout = call(buyer, 'POST', '/v1/checkouts', {
      body: { items: [{ productId: products.items[0].id, quantity: 1 }], delivery },
      expect: 201,
    });
    // Ventilateur 35 000 + livraison Lumumba → Tié-Tié 1 500.
    expect(checkout.grandTotal).toBe(36_500);
    const orderId = checkout.orders[0].id;
    const payment = call(buyer, 'POST', '/v1/checkouts/{id}/payments', {
      params: { id: checkout.id },
      body: { operator: 'mtn', phone: '06 612 34 98' },
      expect: 201,
    });
    expect(call(buyer, 'GET', '/v1/payments/{id}', { params: { id: payment.id } }).status).toBe(
      'pending',
    );
    const again = call(buyer, 'POST', '/v1/checkouts/{id}/payments', {
      params: { id: checkout.id },
      body: { operator: 'mtn', phone: '06 612 34 98' },
      expect: 409,
    });
    expect(again.error.code).toBe('payment_in_progress');
    advance(AUTO_PIN_MS);
    expect(call(buyer, 'GET', '/v1/payments/{id}', { params: { id: payment.id } }).status).toBe(
      'succeeded',
    );
    expect(call(buyer, 'GET', '/v1/checkouts/{id}', { params: { id: checkout.id } }).status).toBe(
      'paid',
    );

    const seller = login(DEMO_ACCOUNTS.seller.phone);
    call(seller, 'GET', '/v1/seller/orders/{id}', { params: { id: orderId } });
    call(seller, 'POST', '/v1/seller/orders/{id}/accept', {
      params: { id: orderId },
      body: { readyInMinutes: 30 },
    });
    call(seller, 'POST', '/v1/seller/orders/{id}/ready', { params: { id: orderId } });

    const rider = login(DEMO_ACCOUNTS.rider.phone);
    const mission = call(rider, 'GET', '/v1/rider/deliveries/{id}', { params: { id: orderId } });
    expect(mission.destination.location).toEqual({ lat: -4.7612, lng: 11.8735, accuracy: 20 });
    expect(
      call(rider, 'POST', '/v1/rider/deliveries/{id}/pickup', {
        params: { id: orderId },
        expect: 409,
      }).error.code,
    ).toBe('pickup_not_confirmed');
    call(seller, 'POST', '/v1/seller/orders/{id}/rider-pickup', {
      params: { id: orderId },
      body: { code: '0000' },
      expect: 422,
    });
    call(seller, 'POST', '/v1/seller/orders/{id}/rider-pickup', {
      params: { id: orderId },
      body: { code: mission.pickupCode },
    });
    call(rider, 'POST', '/v1/rider/deliveries/{id}/pickup', { params: { id: orderId } });
    call(rider, 'POST', '/v1/rider/deliveries/{id}/position', {
      params: { id: orderId },
      body: { lat: -4.7761, lng: 11.8635, accuracy: 15 },
    });
    const tracking = call(buyer, 'GET', '/v1/orders/{id}/tracking', { params: { id: orderId } });
    expect(tracking).toMatchObject({ onTheWay: true, etaMinutes: 10 });
    call(rider, 'POST', '/v1/rider/deliveries/{id}/arrived', { params: { id: orderId } });
    call(rider, 'POST', '/v1/rider/deliveries/{id}/contact-attempt', {
      params: { id: orderId },
      expect: 201,
    });
    call(rider, 'POST', '/v1/rider/deliveries/{id}/incident', {
      params: { id: orderId },
      body: { kind: 'other' },
      expect: 201,
    });
    const wrong = call(rider, 'POST', '/v1/rider/deliveries/{id}/handover', {
      params: { id: orderId },
      body: { code: '000000' },
      expect: 422,
    });
    expect(wrong.error.code).toBe('invalid_handover_code');
    call(buyer, 'POST', '/v1/orders/{id}/handover-code', { params: { id: orderId }, expect: 202 });
    const code = lastCode('+242066123498', 'buyer_handover_code');
    call(rider, 'POST', '/v1/rider/deliveries/{id}/handover', {
      params: { id: orderId },
      body: { code },
    });

    const order = call(buyer, 'GET', '/v1/orders/{id}', { params: { id: orderId } });
    expect(order.history.map((h: any) => h.status)).toEqual([
      'pending_payment',
      'paid',
      'preparing',
      'ready_for_pickup',
      'in_delivery',
      'delivered',
    ]);
    call(buyer, 'POST', '/v1/orders/{id}/confirm-receipt', { params: { id: orderId } });
    call(buyer, 'POST', '/v1/order-items/{id}/review', {
      params: { id: order.items[0].itemId },
      body: { rating: 5, tags: ['conforme'] },
      expect: 201,
    });

    const reviews = call(seller, 'GET', '/v1/seller/reviews');
    call(seller, 'POST', '/v1/seller/reviews/{id}/reply', {
      params: { id: reviews.items[0].id },
      body: { text: 'Merci !' },
    });
    const balance = call(seller, 'GET', '/v1/seller/balance');
    // Ventilateur 35 000 (maison, 10 %) : 31 500 reversés.
    expect(balance.payouts[0].amount).toBe(31_500);
    call(seller, 'GET', '/v1/seller/withdrawals');
    expect(call(rider, 'GET', '/v1/rider/history', { query: { period: '30d' } }).delivered).toBe(3);
    call(buyer, 'GET', '/v1/me/notifications');
    call(buyer, 'POST', '/v1/me/notifications/seen');
    expect(api.state.notifications.some((n) => n.template === 'buyer_delivered')).toBe(true);
  });

  it('vendeur : boutique, produits, photos, commission ; nouvelle boutique vérifiée', () => {
    const { api, call, login, advance } = demo();
    const seller = login(DEMO_ACCOUNTS.seller.phone);
    const shop = call(seller, 'GET', '/v1/seller/shop');
    call(seller, 'PATCH', '/v1/seller/shop', { body: { isOpen: false, defaultPrepMinutes: 30 } });
    expect(call(seller, 'GET', '/v1/seller/shop').isOpen).toBe(false);
    call(seller, 'GET', '/v1/seller/kyc');
    const preview = call(seller, 'GET', '/v1/seller/commission-preview', {
      query: { categoryId: '10000000-0000-4000-8000-000000000002', price: '10000' },
    });
    expect(preview).toEqual({ rateBps: 800, commission: 800, net: 9200 });
    const created = call(seller, 'POST', '/v1/seller/products', {
      body: {
        categoryId: '10000000-0000-4000-8000-000000000002',
        title: 'Chargeur rapide 25 W',
        price: 7000,
        stock: 12,
        publish: true,
      },
      expect: 201,
    });
    expect(created.status).toBe('published');
    const upload = call(seller, 'POST', '/v1/uploads', {
      body: { purpose: 'product_photo', contentType: 'image/jpeg', sizeBytes: 1000 },
      expect: 201,
    });
    api.state.uploads[upload.uploadId] = 'file:///photo.jpg';
    const photos = call(seller, 'POST', '/v1/seller/products/{id}/photos', {
      params: { id: created.id },
      body: { uploadId: upload.uploadId },
      expect: 201,
    });
    call(seller, 'DELETE', '/v1/seller/products/{id}/photos/{photoId}', {
      params: { id: created.id, photoId: photos.photos[0].id },
    });
    call(seller, 'PATCH', '/v1/seller/products/{id}', {
      params: { id: created.id },
      body: { stock: 1, status: 'archived' },
    });
    call(seller, 'GET', '/v1/seller/products/{id}', { params: { id: created.id } });
    expect(
      call(seller, 'GET', '/v1/seller/products', { query: { status: 'archived' } }).items,
    ).toHaveLength(1);
    expect(shop.verificationStatus).toBe('verified');

    // Une acheteuse ouvre sa boutique : pièces envoyées, vérification « d'office » en démonstration.
    const newcomer = login('+242065554433');
    call(newcomer, 'GET', '/v1/seller/shop', { expect: 404 });
    call(newcomer, 'POST', '/v1/seller/shop', {
      body: { shopName: 'Chez Nadia', city: 'Pointe-Noire', pickupZoneId: TIE_TIE },
      expect: 201,
    });
    expect(
      call(newcomer, 'POST', '/v1/seller/shop', {
        body: { shopName: 'Encore', city: 'Pointe-Noire', pickupZoneId: TIE_TIE },
        expect: 409,
      }).error.code,
    ).toBe('shop_exists');
    const draft = call(newcomer, 'POST', '/v1/seller/products', {
      body: {
        categoryId: '10000000-0000-4000-8000-000000000007',
        title: 'Gâteau de manioc',
        price: 2000,
        stock: 5,
        publish: true,
      },
      expect: 201,
    });
    expect(draft.status).toBe('pending_review');
    call(newcomer, 'POST', '/v1/seller/kyc-documents', {
      body: { uploadId: randomUUID(), type: 'national_id' },
      expect: 201,
    });
    expect(
      call(newcomer, 'POST', '/v1/seller/kyc-documents', {
        body: { uploadId: randomUUID(), type: 'selfie' },
        expect: 201,
      }).verificationStatus,
    ).toBe('pending_review');
    advance(20_000);
    expect(call(newcomer, 'GET', '/v1/seller/kyc').verificationStatus).toBe('verified');
    expect(
      call(newcomer, 'GET', '/v1/seller/products/{id}', { params: { id: draft.id } }).status,
    ).toBe('published');
  });

  it('écarts : refus, annulation, retour au vendeur, point relais, litige', () => {
    const { call, login, advance } = demo();
    const buyer = login(DEMO_ACCOUNTS.buyer.phone);
    const seller = login(DEMO_ACCOUNTS.seller.phone);
    const rider = login(DEMO_ACCOUNTS.rider.phone);
    const products = call(null, 'GET', '/v1/products', { query: { q: 'fer' } });
    const buy = (d: Record<string, unknown> = delivery) => {
      const c = call(buyer, 'POST', '/v1/checkouts', {
        body: { items: [{ productId: products.items[0].id, quantity: 1 }], delivery: d },
        expect: 201,
      });
      call(buyer, 'POST', '/v1/checkouts/{id}/payments', {
        params: { id: c.id },
        body: { operator: 'airtel', phone: '05 612 34 98' },
        expect: 201,
      });
      advance(AUTO_PIN_MS);
      return c.orders[0].id as string;
    };
    const ready = (id: string) => {
      call(seller, 'POST', '/v1/seller/orders/{id}/accept', { params: { id } });
      call(seller, 'POST', '/v1/seller/orders/{id}/ready', { params: { id } });
      const m = call(rider, 'GET', '/v1/rider/deliveries/{id}', { params: { id } });
      call(seller, 'POST', '/v1/seller/orders/{id}/rider-pickup', {
        params: { id },
        body: { code: m.pickupCode },
      });
      call(rider, 'POST', '/v1/rider/deliveries/{id}/pickup', { params: { id } });
    };

    expect(call(buyer, 'POST', '/v1/orders/{id}/cancel', { params: { id: buy() } }).status).toBe(
      'refunded',
    );
    expect(
      call(seller, 'POST', '/v1/seller/orders/{id}/reject', {
        params: { id: buy() },
        body: { reason: 'Rupture de stock' },
      }).status,
    ).toBe('refunded');

    const refused = buy();
    ready(refused);
    call(rider, 'POST', '/v1/rider/deliveries/{id}/arrived', { params: { id: refused } });
    const back = call(rider, 'POST', '/v1/rider/deliveries/{id}/return', {
      params: { id: refused },
      body: { reason: 'refused', note: 'mauvaise couleur' },
    });
    expect(back.failureReason).toBe('colis refusé (mauvaise couleur)');
    call(rider, 'POST', '/v1/rider/deliveries/{id}/returned', {
      params: { id: refused },
      expect: 409,
    });
    call(seller, 'POST', '/v1/seller/orders/{id}/rider-return', {
      params: { id: refused },
      body: { code: back.returnCode },
    });
    expect(
      call(rider, 'POST', '/v1/rider/deliveries/{id}/returned', { params: { id: refused } }).status,
    ).toBe('disputed');

    const relay = buy({
      ...delivery,
      mode: 'pickup_point',
      pickupPointId: PICKUP_POINTS[1].id,
      location: undefined,
    });
    ready(relay);
    expect(
      call(rider, 'POST', '/v1/rider/deliveries/{id}/arrived-at-pickup-point', {
        params: { id: relay },
      }).status,
    ).toBe('awaiting_collection');
    expect(
      call(buyer, 'POST', '/v1/orders/{id}/confirm-receipt', { params: { id: relay } }).status,
    ).toBe('completed');

    const disputed = buy();
    ready(disputed);
    const code = call(buyer, 'POST', '/v1/orders/{id}/disputes', {
      params: { id: disputed },
      body: { reason: 'damaged', description: 'Le fer ne chauffe pas du tout.' },
      expect: 201,
    });
    call(buyer, 'POST', '/v1/disputes/{id}/evidence', {
      params: { id: code.id },
      body: { uploadId: randomUUID() },
      expect: 201,
    });
    call(seller, 'POST', '/v1/seller/orders/{id}/dispute-evidence', {
      params: { id: disputed },
      body: { uploadId: randomUUID() },
      expect: 201,
    });
    const answer = call(seller, 'POST', '/v1/seller/orders/{id}/dispute-response', {
      params: { id: disputed },
      body: { choice: 'exchange', message: 'Je vous l’échange.' },
    });
    expect(answer.sellerChoice).toBe('exchange');

    // Numéro Mobile Money finissant par 99 : refusé, comme le simulateur de la recette.
    const c = call(buyer, 'POST', '/v1/checkouts', {
      body: { items: [{ productId: products.items[0].id, quantity: 1 }], delivery },
      expect: 201,
    });
    expect(
      call(buyer, 'POST', '/v1/checkouts/{id}/payments', {
        params: { id: c.id },
        body: { operator: 'mtn', phone: '06 612 34 99' },
        expect: 201,
      }).status,
    ).toBe('failed');
    call(buyer, 'POST', '/v1/auth/logout');
    call(buyer, 'GET', '/v1/me', { expect: 401 });
  });
});
