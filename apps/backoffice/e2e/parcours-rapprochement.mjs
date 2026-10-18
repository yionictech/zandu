/**
 * Rapprochement avec l'agrégateur dans le back-office, de bout en bout, contre une API chargée
 * avec `pnpm db:seed:demo` (voir parcours-support.mjs pour les variables d'environnement).
 *
 *   API_URL=… BO_URL=… SHOTS=./captures DATABASE_URL=… node e2e/parcours-rapprochement.mjs
 *
 * Une vente est menée à son terme (paiement, livraison, reversement au vendeur). L'agrégateur
 * simulé prélève en plus des « frais de tenue de compte » inconnus de Zandu. Un nouvel
 * administrateur contrôle la journée en cours, trouve l'écart, l'enregistre en frais, relance :
 * la caisse est équilibrée.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
const psql = (sql) =>
  execFileSync('psql', [process.env.DATABASE_URL, '-tAc', sql]).toString().trim();
const once = () => ({ 'idempotency-key': randomUUID() });
const RECETTE = process.env.RECETTE_KEY ? { 'x-recette-key': process.env.RECETTE_KEY } : {};

// ---------------------------------------------------------------------------------------------
// 1. Une vente complète : paiement, livraison, confirmation, reversement au vendeur.
// ---------------------------------------------------------------------------------------------
const seller = await apiLogin('+242061000001');
const { items } = await json('GET', '/v1/seller/products', seller);
const product = items.find((p) => p.status === 'published');
await json('PATCH', `/v1/seller/products/${product.id}`, seller, { stock: 50 });

const buyerPhone = freshPhone('05 4');
const buyer = await apiLogin(e164(buyerPhone));
const checkout = await json(
  'POST',
  '/v1/checkouts',
  buyer,
  {
    items: [{ productId: product.id, quantity: 1 }],
    delivery: {
      mode: 'home',
      zoneId: TIE_TIE,
      recipientName: 'Grâce Mavoungou',
      phone: buyerPhone,
      landmark: 'Tié-Tié, avenue de la Base, portail bleu en face de la pharmacie',
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
const order = checkout.orders[0];

const admin = await staffLogin('+242069000000');
const rider = await apiLogin('+242068000000');
const riderId = psql(
  `SELECT r.id FROM riders r JOIN users u ON u.id = r.user_id WHERE u.phone = '+242068000000'`,
);
await json('POST', `/v1/seller/orders/${order.id}/accept`, seller);
await json('POST', `/v1/seller/orders/${order.id}/ready`, seller);
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
// Le worker envoie le reversement : attendu en quelques secondes.
for (let i = 0; i < 60; i++) {
  if (psql(`SELECT status FROM payouts WHERE order_id = '${order.id}'`) === 'succeeded') break;
  await sleep(500);
}
console.log(`Vente ${order.publicRef} : payée, livrée, vendeur payé`);

// 2. L'agrégateur prélève des frais que Zandu ne connaît pas.
const label = `Frais de tenue de compte (essai ${new Date().toISOString().slice(11, 19)})`;
await json(
  'POST',
  '/dev/simulator/account-movements',
  null,
  { amount: -2500, description: label },
  RECETTE,
);
await sleep(1100); // le contrôle porte sur la période qui s'arrête à son lancement

// ---------------------------------------------------------------------------------------------
// 3. Un nouvel administrateur se connecte (SMS + application d'authentification).
// ---------------------------------------------------------------------------------------------
const adminPhone = freshPhone('06 6');
psql(`INSERT INTO users (phone, roles) VALUES ('${e164(adminPhone)}', '{buyer,admin}')`);
const browser = await launchBrowser();
const context = await browser.newContext({
  viewport: { width: 1280, height: 860 },
  locale: 'fr-FR',
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

// 4. Contrôle de la journée en cours : l'écart apparaît.
await page.getByRole('link', { name: /^Rapprochement/ }).click();
await page.getByRole('button', { name: 'Contrôler la journée en cours' }).click();
await page.getByText('Journée en cours contrôlée').waitFor();
const row = page.getByTestId('open-discrepancies').locator('tr', { hasText: label });
await row.waitFor();
await shot('01-ecart-trouve');

// 5. L'écart est examiné puis enregistré en frais de l'agrégateur.
await row.getByRole('link', { name: 'Examiner' }).click();
const card = page.getByTestId('discrepancy').filter({ hasText: label });
await card.waitFor();
const choice = await card.locator('select[name="adjustment"]').inputValue();
if (choice !== 'payment_fees') throw new Error(`Écriture proposée : ${choice}`);
await card
  .getByLabel("Explication (journal d'audit)")
  .fill('Frais de tenue de compte confirmés par l’agrégateur');
await card.getByRole('button', { name: "Clore l'écart" }).click();
await page.getByText('Écart clos, écriture de régularisation passée').waitFor();

// 6. Nouveau contrôle : la caisse est équilibrée.
await page.getByRole('button', { name: 'Relancer le contrôle' }).click();
await page.getByText('Contrôle relancé').waitFor();
const unexplained = (await page.getByTestId('unexplained').innerText()).replace(/\s/g, '');
if (unexplained !== '0FCFA') throw new Error(`Écart inexpliqué : ${unexplained}`);
await page.getByTestId('discrepancy').filter({ hasText: label }).getByText('Écriture').waitFor();
await shot('02-ecart-regularise');

const runId = new URL(page.url()).pathname.split('/').pop();
const run = await json('GET', `/v1/admin/reconciliation/runs/${runId}`, admin);
const open = run.discrepancies.filter((d) => !d.resolution);
if (open.length)
  throw new Error(`Écarts encore ouverts : ${open.map((d) => d.message).join(' | ')}`);
console.log(
  `Contrôle du ${run.run.date} : ${run.run.summary.matched} mouvement(s) retrouvé(s), solde ${run.run.summary.balance.provider} FCFA expliqué`,
);
await browser.close();
console.log('Parcours rapprochement : OK');
