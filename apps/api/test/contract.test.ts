import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createZanduClient, unwrap, type ZanduClient } from '@zandu/api-client';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { base32Decode, totpCode, totpStep } from '../src/lib/totp.js';
import { congoDate } from '../src/modules/reconciliation/reconciliation.service.js';
import {
  ZONES,
  approveAndNotify,
  checkout as checkoutVia,
  createTestEnv,
  idemKey,
  login,
  pay,
  setupMarketplace,
  uploadFile,
  type Marketplace,
  type TestEnv,
} from './helpers.js';

/**
 * Test de contrat : chaque réponse réelle de l'API est validée contre le schéma déclaré dans
 * docs/api/openapi.yaml, en passant par le client généré qu'utilisent les applications.
 */
type Doc = {
  paths: Record<string, Record<string, { responses: Record<string, { $ref?: string }> }>>;
};

let env: TestEnv;
let m: Marketplace;
let doc: Doc;
let ajv: Ajv2020;
let baseUrl: string;

beforeAll(async () => {
  env = await createTestEnv();
  m = await setupMarketplace(env);
  baseUrl = await env.app.listen({ port: 0, host: '127.0.0.1' });
  const raw = await readFile(
    fileURLToPath(new URL('../../../docs/api/openapi.yaml', import.meta.url)),
    'utf8',
  );
  doc = parse(raw) as Doc;
  ajv = new Ajv2020({ strict: false, validateSchema: false, allErrors: true });
  (addFormats as unknown as (a: Ajv2020) => void)(ajv);
  ajv.addSchema(doc as object, 'openapi.json');
});
afterAll(async () => env.close());

const pointer = (...parts: string[]) =>
  parts.map((p) => p.replace(/~/g, '~0').replace(/\//g, '~1')).join('/');

/** Valide un corps de réponse contre le schéma de (chemin, méthode, statut) du contrat. */
function expectConforms(path: string, method: string, status: number, body: unknown): void {
  const operation = doc.paths[path]?.[method];
  expect(operation, `${method.toUpperCase()} ${path} absent du contrat`).toBeDefined();
  const response = operation!.responses[String(status)];
  expect(response, `statut ${status} non documenté pour ${path}`).toBeDefined();
  const ref = response!.$ref
    ? `openapi.json${response!.$ref}/content/application~1json/schema`
    : `openapi.json#/${pointer('paths', path, method, 'responses', String(status), 'content', 'application/json', 'schema')}`;
  const validate = ajv.compile({ $ref: ref });
  const ok = validate(body);
  expect(
    ok,
    `${method.toUpperCase()} ${path} ${status} : ${JSON.stringify(validate.errors, null, 1)}`,
  ).toBe(true);
}

function clientFor(token: string | null): ZanduClient {
  return createZanduClient({ baseUrl, getToken: () => token });
}

async function sessionToken(phone: string): Promise<string> {
  const anonymous = clientFor(null);
  const requested = unwrap(await anonymous.POST('/v1/auth/otp/request', { body: { phone } }));
  expectConforms('/v1/auth/otp/request', 'post', 202, requested);
  const e164 = `+242${phone.replace(/\s/g, '')}`;
  const code = env.notifier.lastTo(e164, 'otp_code')!.variables.code!;
  const verified = unwrap(
    await anonymous.POST('/v1/auth/otp/verify', {
      body: { challengeId: requested.challengeId, code },
    }),
  );
  expectConforms('/v1/auth/otp/verify', 'post', 200, verified);
  return verified.token;
}

describe('Contrat OpenAPI ⇄ API réelle (via le client généré)', () => {
  it('catalogue public', async () => {
    const api = clientFor(null);
    expectConforms('/v1/categories', 'get', 200, unwrap(await api.GET('/v1/categories')));
    const products = unwrap(
      await api.GET('/v1/products', { params: { query: { q: 'ventilateur' } } }),
    );
    expectConforms('/v1/products', 'get', 200, products);
    expect(products.items[0]!.price).toBe(50_000);
    const detail = unwrap(
      await api.GET('/v1/products/{id}', { params: { path: { id: m.productId } } }),
    );
    expectConforms('/v1/products/{id}', 'get', 200, detail);
    expectConforms(
      '/v1/products/{id}/reviews',
      'get',
      200,
      unwrap(await api.GET('/v1/products/{id}/reviews', { params: { path: { id: m.productId } } })),
    );
    expectConforms('/v1/delivery/zones', 'get', 200, unwrap(await api.GET('/v1/delivery/zones')));
    expectConforms(
      '/v1/shops/{slug}',
      'get',
      200,
      unwrap(
        await api.GET('/v1/shops/{slug}', {
          params: { path: { slug: products.items[0]!.seller.slug } },
        }),
      ),
    );
  });

  it('parcours acheteur : connexion, panier, paiement, commande', async () => {
    const api = clientFor(await sessionToken('05 666 66 66'));
    expectConforms('/v1/me', 'get', 200, unwrap(await api.GET('/v1/me')));

    const checkout = unwrap(
      await api.POST('/v1/checkouts', {
        params: { header: { 'Idempotency-Key': idemKey() } },
        body: {
          items: [{ productId: m.productId, quantity: 1 }],
          delivery: {
            mode: 'home',
            zoneId: ZONES.tieTie,
            recipientName: 'Patrick',
            phone: '05 666 66 66',
            landmark: 'Tié-Tié, à côté du marché',
          },
        },
      }),
    );
    expectConforms('/v1/checkouts', 'post', 201, checkout);
    const payment = unwrap(
      await api.POST('/v1/checkouts/{id}/payments', {
        params: { path: { id: checkout.id }, header: { 'Idempotency-Key': idemKey() } },
        body: { operator: 'airtel', phone: '05 666 66 66' },
      }),
    );
    expectConforms('/v1/checkouts/{id}/payments', 'post', 201, payment);
    await approveAndNotify(env, payment.id);
    const paid = unwrap(
      await api.GET('/v1/payments/{id}', { params: { path: { id: payment.id } } }),
    );
    expectConforms('/v1/payments/{id}', 'get', 200, paid);
    expect(paid.status).toBe('succeeded');
    expectConforms(
      '/v1/checkouts/{id}',
      'get',
      200,
      unwrap(await api.GET('/v1/checkouts/{id}', { params: { path: { id: checkout.id } } })),
    );
    expectConforms('/v1/orders', 'get', 200, unwrap(await api.GET('/v1/orders')));
    const order = unwrap(
      await api.GET('/v1/orders/{id}', { params: { path: { id: checkout.orders[0]!.id } } }),
    );
    expectConforms('/v1/orders/{id}', 'get', 200, order);
    expect(order.status).toBe('paid');
  });

  it('espace vendeur et back-office', async () => {
    const seller = clientFor(m.seller.headers.authorization!.slice(7));
    expectConforms('/v1/seller/shop', 'get', 200, unwrap(await seller.GET('/v1/seller/shop')));
    expectConforms(
      '/v1/seller/products',
      'get',
      200,
      unwrap(await seller.GET('/v1/seller/products')),
    );
    expectConforms(
      '/v1/seller/balance',
      'get',
      200,
      unwrap(await seller.GET('/v1/seller/balance')),
    );
    expectConforms('/v1/seller/kyc', 'get', 200, unwrap(await seller.GET('/v1/seller/kyc')));
    expectConforms(
      '/v1/seller/commission-preview',
      'get',
      200,
      unwrap(
        await seller.GET('/v1/seller/commission-preview', {
          params: { query: { categoryId: '10000000-0000-4000-8000-000000000006', price: 50_000 } },
        }),
      ),
    );
    const reserved = unwrap(
      await seller.POST('/v1/uploads', {
        body: { purpose: 'product_photo', contentType: 'image/png', sizeBytes: 10 },
      }),
    );
    expectConforms('/v1/uploads', 'post', 201, reserved);
    const uploadId = await uploadFile(env, m.seller, 'product_photo');
    const photos = unwrap(
      await seller.POST('/v1/seller/products/{id}/photos', {
        params: { path: { id: m.productId } },
        body: { uploadId },
      }),
    );
    expectConforms('/v1/seller/products/{id}/photos', 'post', 201, photos);
    const updated = unwrap(
      await seller.PATCH('/v1/seller/products/{id}', {
        params: { path: { id: m.productId } },
        body: { stock: 12 },
      }),
    );
    expectConforms('/v1/seller/products/{id}', 'patch', 200, updated);

    const admin = clientFor(m.admin.headers.authorization!.slice(7));
    expectConforms(
      '/v1/admin/ledger/balances',
      'get',
      200,
      unwrap(await admin.GET('/v1/admin/ledger/balances')),
    );
    expectConforms('/v1/admin/sellers', 'get', 200, unwrap(await admin.GET('/v1/admin/sellers')));
    expectConforms(
      '/v1/support/disputes',
      'get',
      200,
      unwrap(await admin.GET('/v1/support/disputes')),
    );
  });

  it('applications vendeur et livreur : brouillon, commandes à traiter, missions', async () => {
    const seller = clientFor(m.seller.headers.authorization!.slice(7));
    const draft = unwrap(
      await seller.POST('/v1/seller/products', {
        body: {
          categoryId: '10000000-0000-4000-8000-000000000006',
          title: 'Lampe rechargeable',
          price: 8_000,
          stock: 3,
          publish: false,
        },
      }),
    );
    expectConforms('/v1/seller/products', 'post', 201, draft);
    expect(draft.status).toBe('draft');
    await seller.POST('/v1/seller/products/{id}/photos', {
      params: { path: { id: draft.id } },
      body: { uploadId: await uploadFile(env, m.seller, 'product_photo') },
    });
    const published = unwrap(
      await seller.PATCH('/v1/seller/products/{id}', {
        params: { path: { id: draft.id } },
        body: { status: 'published' },
      }),
    );
    expect(published.status).toBe('published');
    expectConforms(
      '/v1/seller/products/{id}',
      'get',
      200,
      unwrap(await seller.GET('/v1/seller/products/{id}', { params: { path: { id: draft.id } } })),
    );

    const co = await checkoutVia(env, m.buyer, [{ productId: draft.id, quantity: 1 }]);
    await approveAndNotify(env, (await pay(env, m.buyer, co.id)).body.id);
    const orderId: string = co.orders[0].id;
    const todo = unwrap(
      await seller.GET('/v1/seller/orders', { params: { query: { status: 'paid,preparing' } } }),
    );
    expectConforms('/v1/seller/orders', 'get', 200, todo);
    expect(todo.items.map((o) => o.id)).toContain(orderId);
    const accepted = unwrap(
      await seller.POST('/v1/seller/orders/{id}/accept', { params: { path: { id: orderId } } }),
    );
    expectConforms('/v1/seller/orders/{id}/accept', 'post', 200, accepted);
    await seller.POST('/v1/seller/orders/{id}/ready', { params: { path: { id: orderId } } });
    const detail = unwrap(
      await seller.GET('/v1/seller/orders/{id}', { params: { path: { id: orderId } } }),
    );
    expectConforms('/v1/seller/orders/{id}', 'get', 200, detail);
    expect(detail.sellerNet).toBe(7_200);

    const admin = clientFor(m.admin.headers.authorization!.slice(7));
    const assigned = unwrap(
      await admin.POST('/v1/support/deliveries/{id}/assign', {
        params: { path: { id: orderId } },
        body: { riderId: m.rider.riderId },
      }),
    );
    expectConforms('/v1/support/deliveries/{id}/assign', 'post', 200, assigned);
    const rider = clientFor(m.rider.headers.authorization!.slice(7));
    expectConforms(
      '/v1/rider/deliveries',
      'get',
      200,
      unwrap(await rider.GET('/v1/rider/deliveries')),
    );
    const picked = unwrap(
      await rider.POST('/v1/rider/deliveries/{id}/pickup', { params: { path: { id: orderId } } }),
    );
    expectConforms('/v1/rider/deliveries/{id}/pickup', 'post', 200, picked);
    const mission = unwrap(
      await rider.GET('/v1/rider/deliveries/{id}', { params: { path: { id: orderId } } }),
    );
    expectConforms('/v1/rider/deliveries/{id}', 'get', 200, mission);
    expect(mission.status).toBe('picked_up');
  });

  it('back-office : second facteur, files, recherche, dossier de commande, alertes', async () => {
    const admin = clientFor(m.admin.headers.authorization!.slice(7));
    expectConforms('/v1/auth/mfa', 'get', 200, unwrap(await admin.GET('/v1/auth/mfa')));
    const setup = unwrap(await admin.POST('/v1/auth/mfa/setup'));
    expectConforms('/v1/auth/mfa/setup', 'post', 200, setup);
    const confirmed = await admin.POST('/v1/auth/mfa/confirm', {
      body: { code: totpCode(base32Decode(setup.secret), totpStep(env.clock.now())) },
    });
    expect(confirmed.response.status).toBe(204);

    expectConforms(
      '/v1/support/overview',
      'get',
      200,
      unwrap(await admin.GET('/v1/support/overview')),
    );
    expectConforms(
      '/v1/admin/products',
      'get',
      200,
      unwrap(await admin.GET('/v1/admin/products', { params: { query: { status: 'published' } } })),
    );
    expectConforms(
      '/v1/admin/sellers/{id}',
      'get',
      200,
      unwrap(
        await admin.GET('/v1/admin/sellers/{id}', { params: { path: { id: m.seller.sellerId } } }),
      ),
    );
    expectConforms(
      '/v1/admin/sellers/{id}/kyc-documents',
      'get',
      200,
      unwrap(
        await admin.GET('/v1/admin/sellers/{id}/kyc-documents', {
          params: { path: { id: m.seller.sellerId } },
        }),
      ),
    );
    expectConforms(
      '/v1/support/deliveries',
      'get',
      200,
      unwrap(await admin.GET('/v1/support/deliveries')),
    );
    expectConforms('/v1/support/riders', 'get', 200, unwrap(await admin.GET('/v1/support/riders')));
    const found = unwrap(
      await admin.GET('/v1/support/orders', { params: { query: { q: '05 666 66 66' } } }),
    );
    expectConforms('/v1/support/orders', 'get', 200, found);
    expect(found.items.length).toBeGreaterThan(0);
    expectConforms(
      '/v1/support/orders/{id}',
      'get',
      200,
      unwrap(
        await admin.GET('/v1/support/orders/{id}', {
          params: { path: { id: found.items[0]!.id } },
        }),
      ),
    );
    expectConforms('/v1/support/alerts', 'get', 200, unwrap(await admin.GET('/v1/support/alerts')));
    expectConforms(
      '/v1/admin/ledger/balances',
      'get',
      200,
      unwrap(await admin.GET('/v1/admin/ledger/balances')),
    );
    const report = unwrap(await admin.GET('/v1/admin/reports/activity'));
    expectConforms('/v1/admin/reports/activity', 'get', 200, report);
    expect(report.sales.paidOrders).toBeGreaterThan(0);
    const created = unwrap(
      await admin.POST('/v1/admin/commission-rules', {
        body: { scope: 'default', rateBps: 1000, note: 'Contrat' },
      }),
    );
    expectConforms('/v1/admin/commission-rules', 'post', 201, created);
    expectConforms(
      '/v1/admin/commission-rules',
      'get',
      200,
      unwrap(await admin.GET('/v1/admin/commission-rules')),
    );

    // Personnel : ajout, détail, changement de rôle, déconnexion.
    const member = unwrap(
      await admin.POST('/v1/admin/staff', {
        body: { phone: '06 444 55 66', fullName: 'Agent du contrat', role: 'support' },
      }),
    );
    expectConforms('/v1/admin/staff', 'post', 201, member);
    expectConforms('/v1/admin/staff', 'get', 200, unwrap(await admin.GET('/v1/admin/staff')));
    const promoted = unwrap(
      await admin.POST('/v1/admin/staff/{id}/role', {
        params: { path: { id: member.id } },
        body: { role: 'admin' },
      }),
    );
    expectConforms('/v1/admin/staff/{id}/role', 'post', 200, promoted);
    expectConforms(
      '/v1/admin/staff/{id}/sign-out',
      'post',
      200,
      unwrap(
        await admin.POST('/v1/admin/staff/{id}/sign-out', { params: { path: { id: member.id } } }),
      ),
    );

    // Rapprochement : contrôle de la journée en cours, avec un mouvement inconnu à régulariser.
    await env.simulator.addAccountMovement({ amount: -500, description: 'Frais de contrat' });
    env.clock.advanceMinutes(1); // la période contrôlée s'arrête à l'heure du contrôle, exclue
    const run = unwrap(
      await admin.POST('/v1/admin/reconciliation/runs', {
        body: { date: congoDate(env.clock.now()) },
      }),
    );
    expectConforms('/v1/admin/reconciliation/runs', 'post', 200, run);
    expect(run.status).toBe('discrepancies');
    expectConforms(
      '/v1/admin/reconciliation/runs',
      'get',
      200,
      unwrap(await admin.GET('/v1/admin/reconciliation/runs')),
    );
    const detail = unwrap(
      await admin.GET('/v1/admin/reconciliation/runs/{id}', { params: { path: { id: run.id } } }),
    );
    expectConforms('/v1/admin/reconciliation/runs/{id}', 'get', 200, detail);
    expectConforms(
      '/v1/admin/reconciliation/discrepancies',
      'get',
      200,
      unwrap(await admin.GET('/v1/admin/reconciliation/discrepancies')),
    );
    const resolved = unwrap(
      await admin.POST('/v1/admin/reconciliation/discrepancies/{id}/resolve', {
        params: { path: { id: detail.discrepancies[0]!.id } },
        body: { note: 'Frais confirmés', adjustment: 'payment_fees' },
      }),
    );
    expectConforms('/v1/admin/reconciliation/discrepancies/{id}/resolve', 'post', 200, resolved);
  });

  it('notifications : téléphone enregistré, accusé, oubli', async () => {
    const api = clientFor(await sessionToken('05 777 77 71'));
    const token = 'ExponentPushToken[contrat-1]';
    const registered = await api.PUT('/v1/me/devices', { body: { token, platform: 'android' } });
    expect(registered.response.status).toBe(204);
    const ack = await api.POST('/v1/me/notifications/{id}/ack', {
      params: { path: { id: '00000000-0000-4000-8000-000000000000' } },
    });
    expectConforms('/v1/me/notifications/{id}/ack', 'post', 404, ack.error);
    const forgotten = await clientFor(null).POST('/v1/devices/unregister', { body: { token } });
    expect(forgotten.response.status).toBe(204);
    expectConforms(
      '/v1/me/notifications',
      'get',
      200,
      unwrap(await api.GET('/v1/me/notifications')),
    );
    const seen = await api.POST('/v1/me/notifications/seen');
    expect(seen.response.status).toBe(204);
  });

  it('les erreurs suivent le format documenté', async () => {
    const result = await clientFor(null).GET('/v1/products/{id}', {
      params: { path: { id: '00000000-0000-4000-8000-000000000000' } },
    });
    expect(result.response.status).toBe(404);
    expectConforms('/v1/products/{id}', 'get', 404, result.error);
    expect(() => unwrap(result)).toThrow('Produit introuvable');
    await login(env, '05 888 77 66'); // le flux OTP reste utilisable après le test de contrat
  });
});
