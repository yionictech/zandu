import type { FastifyInstance, InjectOptions } from 'fastify';
import { parseCongoMobile } from '@zandu/domain';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { createPool, type Pool } from '../src/db/pool.js';
import { seedReference } from '../src/db/seed.js';
import { runSweepers } from '../src/jobs/sweepers.js';
import type { Clock } from '../src/lib/clock.js';
import { MemoryNotificationSender } from '../src/modules/notifications/sender.js';
import { ProviderRegistry } from '../src/modules/payments/provider.js';
import { SimulatorProvider } from '../src/modules/payments/simulator.js';
import { MemoryStorage } from '../src/modules/storage/storage.js';
import { TEST_DATABASE_URL } from './global-setup.js';

export const ZONES = {
  lumumba: '20000000-0000-4000-8000-000000000001',
  tieTie: '20000000-0000-4000-8000-000000000003',
  poto: '20000000-0000-4000-8000-000000000013',
};
export const CATEGORIES = {
  telephones: '10000000-0000-4000-8000-000000000002',
  maison: '10000000-0000-4000-8000-000000000006',
};
export const PICKUP_TIE_TIE = '30000000-0000-4000-8000-000000000002';
export const COURIER_PARTNER = '40000000-0000-4000-8000-000000000001';

export class FakeClock implements Clock {
  private current = new Date();
  now(): Date {
    return new Date(this.current);
  }
  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
  advanceHours(hours: number): void {
    this.advanceMinutes(hours * 60);
  }
  set(date: Date): void {
    this.current = new Date(date);
  }
}

export interface TestEnv {
  app: FastifyInstance;
  ctx: AppContext;
  pool: Pool;
  clock: FakeClock;
  simulator: SimulatorProvider;
  notifier: MemoryNotificationSender;
  storage: MemoryStorage;
  close(): Promise<void>;
}

export async function createTestEnv(overrides: Record<string, string> = {}): Promise<TestEnv> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    APP_SECRET: 'test-secret-test-secret-test-secret-42',
    SIMULATOR_WEBHOOK_SECRET: 'test-webhook-secret-123',
    SUPPORT_ALERT_PHONE: '+242060000001',
    ...overrides,
  });
  const pool = createPool(TEST_DATABASE_URL);
  const clock = new FakeClock();
  const simulator = new SimulatorProvider(config.simulatorWebhookSecret, pool, clock);
  const notifier = new MemoryNotificationSender();
  const storage = new MemoryStorage('http://api.test');
  const ctx: AppContext = {
    config,
    pool,
    clock,
    providers: new ProviderRegistry([simulator], 'simulator'),
    notifier,
    storage,
  };
  const app = await buildApp(ctx, { logger: false });
  return {
    app,
    ctx,
    pool,
    clock,
    simulator,
    notifier,
    storage,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

/** Vide toutes les tables (garde-fous TRUNCATE contournés : superutilisateur de test uniquement). */
export async function resetDatabase(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ schemaname: string; tablename: string }>(
      `SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('public', 'simulator')
       AND tablename NOT IN ('schema_migrations', 'order_status_transitions')`,
    );
    await client.query('SET session_replication_role = replica');
    await client.query(
      `TRUNCATE ${rows.map((r) => `"${r.schemaname}"."${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );
    await client.query('SET session_replication_role = DEFAULT');
    await seedReference(client);
  } finally {
    client.release();
  }
}

export interface Session {
  userId: string;
  phone: string;
  headers: Record<string, string>;
}

let keyCounter = 0;
export const idemKey = (): string => `test-key-${Date.now()}-${++keyCounter}`;

export async function call(env: TestEnv, session: Session | null, options: InjectOptions) {
  const res = await env.app.inject({
    ...options,
    headers: { ...(session?.headers ?? {}), ...(options.headers ?? {}) },
  });
  return { status: res.statusCode, body: res.body ? res.json() : null };
}

/** Connexion par code SMS, en lisant le code dans la messagerie simulée. */
export async function login(env: TestEnv, phoneInput: string, roles?: string[]): Promise<Session> {
  const phone = parseCongoMobile(phoneInput).e164;
  if (roles) {
    await env.pool.query(
      `INSERT INTO users (phone, roles) VALUES ($1, $2::user_role[]) ON CONFLICT (phone) DO UPDATE SET roles = EXCLUDED.roles`,
      [phone, roles],
    );
  }
  const requested = await call(env, null, {
    method: 'POST',
    url: '/v1/auth/otp/request',
    payload: { phone: phoneInput },
  });
  if (requested.status !== 202) throw new Error(`OTP : ${JSON.stringify(requested.body)}`);
  const code = env.notifier.lastTo(phone, 'otp_code')!.variables.code;
  const verified = await call(env, null, {
    method: 'POST',
    url: '/v1/auth/otp/verify',
    payload: { challengeId: requested.body.challengeId, code },
  });
  if (verified.status !== 200) throw new Error(`Vérification : ${JSON.stringify(verified.body)}`);
  return {
    userId: verified.body.user.id,
    phone,
    headers: { authorization: `Bearer ${verified.body.token}` },
  };
}

export interface Marketplace {
  admin: Session;
  rider: Session & { riderId: string };
  seller: Session & { sellerId: string };
  buyer: Session;
  productId: string;
}

/** Ouvre une boutique (vérifiée ou non) via l'API, comme le ferait l'application. */
export async function openShop(env: TestEnv, admin: Session, phone: string, verified = true) {
  const seller = await login(env, phone);
  const shop = await call(env, seller, {
    method: 'POST',
    url: '/v1/seller/shop',
    payload: {
      shopName: `Boutique ${phone.slice(-4)}`,
      city: 'Pointe-Noire',
      pickupZoneId: ZONES.lumumba,
      payoutPhone: phone,
      payoutOperator: 'mtn',
    },
  });
  if (shop.status !== 201) throw new Error(JSON.stringify(shop.body));
  if (verified) {
    await call(env, admin, {
      method: 'POST',
      url: `/v1/admin/sellers/${shop.body.id}/verification`,
      payload: { decision: 'verified' },
    });
  }
  return { ...seller, sellerId: shop.body.id as string };
}

export async function addProduct(
  env: TestEnv,
  seller: Session,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await call(env, seller, {
    method: 'POST',
    url: '/v1/seller/products',
    payload: {
      categoryId: CATEGORIES.maison,
      title: 'Ventilateur sur pied 16 pouces',
      description: 'Silencieux, 3 vitesses',
      price: 50_000,
      stock: 5,
      ...overrides,
    },
  });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.id;
}

export async function setupMarketplace(env: TestEnv): Promise<Marketplace> {
  await resetDatabase(env.pool);
  env.notifier.sent.length = 0;
  const admin = await login(env, '06 999 99 99', ['buyer', 'admin']);
  const riderSession = await login(env, '06 888 88 88', ['buyer', 'rider']);
  const { rows } = await env.pool.query<{ id: string }>(
    'INSERT INTO riders (user_id, courier_partner_id) VALUES ($1, $2) RETURNING id',
    [riderSession.userId, COURIER_PARTNER],
  );
  const seller = await openShop(env, admin, '06 111 11 11');
  const productId = await addProduct(env, seller);
  const buyer = await login(env, '05 555 55 55');
  return { admin, rider: { ...riderSession, riderId: rows[0]!.id }, seller, buyer, productId };
}

export interface DeliveryInput {
  mode: 'home' | 'pickup_point';
  zoneId: string;
  pickupPointId?: string;
  recipientName: string;
  phone: string;
  landmark: string;
  location?: { lat: number; lng: number; accuracy?: number };
}

export const homeDelivery: DeliveryInput = {
  mode: 'home',
  zoneId: ZONES.tieTie,
  recipientName: 'Grâce M.',
  phone: '05 555 55 55',
  landmark: "Tié-Tié, derrière l'école Saint-Pierre, portail bleu",
};

export async function checkout(
  env: TestEnv,
  buyer: Session,
  items: Array<{ productId: string; quantity: number }>,
  delivery: DeliveryInput = homeDelivery,
) {
  const res = await call(env, buyer, {
    method: 'POST',
    url: '/v1/checkouts',
    headers: { 'idempotency-key': idemKey() },
    payload: { items, delivery },
  });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body;
}

export async function pay(
  env: TestEnv,
  buyer: Session,
  checkoutId: string,
  operator = 'mtn',
  phone = '05 555 55 55',
) {
  return call(env, buyer, {
    method: 'POST',
    url: `/v1/checkouts/${checkoutId}/payments`,
    headers: { 'idempotency-key': idemKey() },
    payload: { operator, phone },
  });
}

/** L'acheteur valide sur son téléphone ; l'agrégateur envoie un webhook signé. */
export async function approveAndNotify(
  env: TestEnv,
  paymentId: string,
  outcome: 'approve' | 'insufficient_funds' | 'declined' = 'approve',
) {
  const event = await env.simulator.customerResponds(paymentId, outcome);
  const signed = env.simulator.signWebhook(event, env.clock.now());
  return call(env, null, {
    method: 'POST',
    url: '/v1/webhooks/payments/simulator',
    headers: signed.headers,
    payload: signed.body,
  });
}

export const sweep = (env: TestEnv) =>
  runSweepers(env.ctx, (name, error) => {
    throw new Error(`${name}: ${String(error)}`);
  });

export async function balance(env: TestEnv, code: string): Promise<number> {
  const res = await env.pool.query<{ total: number }>(
    `SELECT coalesce(sum(e.amount), 0)::bigint AS total FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE a.code = $1`,
    [code],
  );
  const raw = res.rows[0]!.total;
  return code.startsWith('asset:') || code.startsWith('expense:') ? raw : 0 - raw;
}

export async function trialBalance(env: TestEnv): Promise<number> {
  const res = await env.pool.query<{ total: number }>(
    'SELECT coalesce(sum(amount), 0)::bigint AS total FROM ledger_entries',
  );
  return res.rows[0]!.total;
}

export async function orderStatus(env: TestEnv, orderId: string): Promise<string> {
  const res = await env.pool.query<{ status: string }>('SELECT status FROM orders WHERE id = $1', [
    orderId,
  ]);
  return res.rows[0]!.status;
}

export async function handoverCodeFor(env: TestEnv, buyerPhone: string): Promise<string> {
  await sweep(env); // outbox -> notifications -> envoi
  return env.notifier.lastTo(buyerPhone, 'buyer_handover_code')!.variables.code!;
}

/** Le vendeur saisit le code de retrait que le livreur lui montre (avant la prise en charge). */
export async function confirmPickupCode(
  env: TestEnv,
  rider: Session,
  seller: Session,
  orderId: string,
): Promise<string> {
  const mission = await call(env, rider, { method: 'GET', url: `/v1/rider/deliveries/${orderId}` });
  const code = String(mission.body.pickupCode);
  const confirmed = await call(env, seller, {
    method: 'POST',
    url: `/v1/seller/orders/${orderId}/rider-pickup`,
    payload: { code },
  });
  if (confirmed.status !== 200) throw new Error(JSON.stringify(confirmed.body));
  return code;
}

/** Paie puis livre une commande d'un article (vendeur et livreur du marché de test). */
export async function buyAndDeliver(
  env: TestEnv,
  m: Marketplace,
  productId = m.productId,
): Promise<string> {
  const co = await checkout(env, m.buyer, [{ productId, quantity: 1 }]);
  const payment = await pay(env, m.buyer, co.id);
  await approveAndNotify(env, payment.body.id);
  const orderId: string = co.orders[0].id;
  const code = await handoverCodeFor(env, m.buyer.phone);
  await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${orderId}/accept` });
  await call(env, m.seller, { method: 'POST', url: `/v1/seller/orders/${orderId}/ready` });
  await call(env, m.admin, {
    method: 'POST',
    url: `/v1/support/deliveries/${orderId}/assign`,
    payload: { riderId: m.rider.riderId },
  });
  await confirmPickupCode(env, m.rider, m.seller, orderId);
  await call(env, m.rider, { method: 'POST', url: `/v1/rider/deliveries/${orderId}/pickup` });
  await call(env, m.rider, {
    method: 'POST',
    url: `/v1/rider/deliveries/${orderId}/handover`,
    payload: { code },
  });
  return orderId;
}

/** Envoie un fichier comme le ferait l'application : réservation, dépôt, puis identifiant. */
export async function uploadFile(
  env: TestEnv,
  session: Session,
  purpose: 'product_photo' | 'kyc_document' | 'dispute_evidence',
  options: { contentType?: string; bytes?: number; declaredSize?: number; body?: Buffer } = {},
): Promise<string> {
  const contentType = options.contentType ?? 'image/jpeg';
  const body = options.body ?? Buffer.alloc(options.bytes ?? 2048, 7);
  const reserved = await call(env, session, {
    method: 'POST',
    url: '/v1/uploads',
    payload: { purpose, contentType, sizeBytes: options.declaredSize ?? body.length },
  });
  if (reserved.status !== 201) throw new Error(JSON.stringify(reserved.body));
  const path = new URL(reserved.body.url).pathname;
  const put = await env.app.inject({
    method: 'PUT',
    url: path,
    headers: { 'content-type': contentType },
    payload: body,
  });
  if (put.statusCode !== 200) throw new Error(`Dépôt refusé : ${put.statusCode}`);
  return reserved.body.uploadId;
}
