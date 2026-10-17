import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createZanduClient, unwrap, type ZanduClient } from '@zandu/api-client';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  ZONES,
  approveAndNotify,
  createTestEnv,
  idemKey,
  login,
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
