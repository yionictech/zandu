/**
 * Rapports et commissions dans le back-office, de bout en bout, contre une API chargée avec
 * `pnpm db:seed:demo` (voir parcours-support.mjs pour les variables d'environnement).
 *
 *   API_URL=… BO_URL=… SHOTS=./captures DATABASE_URL=… node e2e/parcours-rapports.mjs
 *
 * Des acheteurs commandent dans trois boutiques ; une partie des commandes est livrée et
 * confirmée. Un nouvel administrateur lit le rapport du mois, exporte le CSV pour le comptable,
 * puis change le taux de la catégorie Mode : la commande suivante l'applique.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  apiLogin,
  e164,
  freshPhone,
  inbox,
  json,
  lastMessage,
  launchBrowser,
  SHOTS,
  sleep,
  staffLogin,
  totp,
} from '../../mobile/e2e/lib.mjs';

const BO = process.env.BO_URL ?? 'http://localhost:3100';
const TIE_TIE = '20000000-0000-4000-8000-000000000003';
const MODE = '10000000-0000-4000-8000-000000000004';
const psql = (sql) =>
  execFileSync('psql', [process.env.DATABASE_URL, '-tAc', sql]).toString().trim();
const once = () => ({ 'idempotency-key': randomUUID() });

// ---------------------------------------------------------------------------------------------
// 1. Des ventes : trois boutiques de démonstration, trois catégories.
// ---------------------------------------------------------------------------------------------
const shops = [];
for (const phone of ['+242061000001', '+242061000002', '+242051000003']) {
  const token = await apiLogin(phone);
  const { items } = await json('GET', '/v1/seller/products', token);
  const products = items.filter((p) => p.status === 'published').slice(0, 2);
  for (const p of products)
    await json('PATCH', `/v1/seller/products/${p.id}`, token, { stock: 50 });
  shops.push({ token, products });
}

const buyerPhone = freshPhone('05 4');
const buyer = await apiLogin(e164(buyerPhone));
async function buy(productId) {
  const checkout = await json(
    'POST',
    '/v1/checkouts',
    buyer,
    {
      items: [{ productId, quantity: 1 }],
      delivery: {
        mode: 'home',
        zoneId: TIE_TIE,
        recipientName: 'Prisca Nkounkou',
        phone: buyerPhone,
        landmark: 'Tié-Tié, rue Mbochi, maison jaune après la boulangerie',
      },
    },
    once(),
  );
  const payment = await json(
    'POST',
    `/v1/checkouts/${checkout.id}/payments`,
    buyer,
    { operator: 'mtn', phone: buyerPhone },
    once(),
  );
  await json('POST', `/dev/simulator/collections/${payment.id}/approve`);
  return checkout.orders[0];
}

const admin = await staffLogin('+242069000000');
const rider = await apiLogin('+242068000000');
const riderId = psql(
  `SELECT r.id FROM riders r JOIN users u ON u.id = r.user_id WHERE u.phone = '+242068000000'`,
);
/** Livraison complète jusqu'à la confirmation : commission acquise, vendeur payé. */
async function deliver(shop, order) {
  await json('POST', `/v1/seller/orders/${order.id}/accept`, shop.token);
  await json('POST', `/v1/seller/orders/${order.id}/ready`, shop.token);
  await json('POST', `/v1/support/deliveries/${order.id}/assign`, admin, { riderId });
  await json('POST', `/v1/rider/deliveries/${order.id}/pickup`, rider);
  let code = null;
  for (let i = 0; i < 40 && !code; i++) {
    code = (await inbox(e164(buyerPhone))).find(
      (m) => m.template === 'buyer_handover_code' && m.variables.ref === order.publicRef,
    )?.variables.code;
    if (!code) await sleep(500);
  }
  await json('POST', `/v1/rider/deliveries/${order.id}/handover`, rider, { code });
  await json('POST', `/v1/orders/${order.id}/confirm-receipt`, buyer);
}

let orders = 0;
for (const [index, shop] of shops.entries()) {
  for (const product of shop.products) {
    const order = await buy(product.id);
    orders++;
    if (index < 2) await deliver(shop, order); // la dernière boutique reste au séquestre
  }
}
console.log(`${orders} commandes passées pour le rapport`);

// ---------------------------------------------------------------------------------------------
// 2. Un nouvel administrateur se connecte (SMS + application d'authentification).
// ---------------------------------------------------------------------------------------------
const adminPhone = freshPhone('06 6');
psql(`INSERT INTO users (phone, roles) VALUES ('${e164(adminPhone)}', '{buyer,admin}')`);

const browser = await launchBrowser();
const context = await browser.newContext({
  viewport: { width: 1280, height: 860 },
  locale: 'fr-FR',
  acceptDownloads: true,
});
const page = await context.newPage();
page.on('dialog', (dialog) => void dialog.accept());
const shot = async (name) => {
  await sleep(300);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  console.log(`📸 ${name}`);
};

await page.goto(BO);
await page.getByLabel('Numéro de téléphone').fill(adminPhone);
const since = Date.now() - 1000;
await page.getByRole('button', { name: 'Recevoir le code par SMS' }).click();
const otp = await lastMessage(e164(adminPhone), 'otp_code', since);
await page.getByLabel(/Code reçu par SMS/).fill(otp.variables.code);
await page.getByRole('button', { name: 'Valider' }).click();
await page.getByTestId('totp-secret').waitFor();
const secret = (await page.getByTestId('totp-secret').innerText()).replace(/\s/g, '');
await page.getByLabel("Code affiché par l'application").fill(totp(secret));
await page.getByRole('button', { name: 'Activer et continuer' }).click();
await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();

// 3. Rapport du mois : indicateurs, ventes par jour (survol), catégories, boutiques.
await page.getByRole('link', { name: 'Rapports' }).click();
await page.getByTestId('kpi-gmv').waitFor();
await page.locator('.chart-hit').last().hover();
await page.locator('.chart-tooltip').waitFor();
await shot('01-rapport-du-mois');
const categoryRows = await page.getByTestId('categories').locator('tbody tr').count();
if (categoryRows < 3) throw new Error(`Rapport : ${categoryRows} catégorie(s) au lieu de 3`);

// 4. Export CSV pour le comptable.
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByTestId('export-csv').click(),
]);
const csv = await readFile(await download.path(), 'utf8');
const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
if (!lines[0].startsWith('Référence;Payée le;Boutique')) throw new Error('En-tête CSV inattendu');
if (lines.length - 1 < orders) throw new Error(`CSV : ${lines.length - 1} lignes`);
console.log(`Export CSV : ${download.suggestedFilename()} — ${lines.length - 1} commandes`);

// 5. Commissions : la catégorie Mode passe de 12 % à 15 %.
await page.getByRole('link', { name: 'Commissions' }).click();
await page.getByTestId('rules').waitFor();
await page.locator('select[name="target"]').selectOption(`category:${MODE}`);
await page.getByLabel('Nouveau taux (%)').fill('15');
await page
  .getByLabel("Motif (journal d'audit)")
  .fill('Essai de recette : hausse temporaire de la Mode');
await page.getByRole('button', { name: 'Enregistrer le taux' }).click();
await page.getByText('Nouveau taux enregistré').waitFor();
await shot('02-commissions');

const pagnes = shops[1];
const fashion = pagnes.products.find((p) => p.categoryId === MODE);
const order = await buy(fashion.id);
const rate = psql(
  `SELECT round(commission_total * 100.0 / items_subtotal) FROM orders WHERE id = '${order.id}'`,
);
if (rate !== '15') throw new Error(`Commission appliquée : ${rate} % au lieu de 15 %`);
console.log('Nouvelle commande Mode : commission de 15 % appliquée');

// Retour au taux habituel, pour les parcours suivants.
await json('POST', '/v1/admin/commission-rules', admin, {
  scope: 'category',
  categoryId: MODE,
  rateBps: 1200,
  note: 'Fin de l’essai de recette',
});
await browser.close();
console.log('Parcours rapports : OK');
