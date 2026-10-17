/**
 * Parcours du support de bout en bout dans le back-office, contre une API de développement
 * chargée avec `pnpm db:seed:demo` (second facteur activé, comme en production).
 *
 *   API_URL=http://localhost:3998 BO_URL=http://localhost:3100 SHOTS=./captures DATABASE_URL=… \
 *     node e2e/parcours-support.mjs
 *
 * Les vendeurs, l'acheteur et le livreur préparent le terrain par l'API ; un nouvel agent du
 * support se connecte (SMS + application d'authentification) et traite chaque file.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  API,
  apiLogin,
  e164,
  freshPhone,
  json,
  lastMessage,
  launchBrowser,
  SHOTS,
  sleep,
  staffLogin,
  totp,
} from '../../mobile/e2e/lib.mjs';

const BO = process.env.BO_URL ?? 'http://localhost:3100';
const IMAGES = fileURLToPath(new URL('../../../db/seeds/demo/images/', import.meta.url));
const psql = (sql) =>
  execFileSync('psql', [process.env.DATABASE_URL, '-tAc', sql]).toString().trim();
const once = () => ({ 'idempotency-key': randomUUID() });

/** Dépôt d'un fichier comme le fait l'application : réservation, PUT sur l'URL signée. */
async function upload(token, purpose, image) {
  const body = await readFile(`${IMAGES}${image}`);
  const reserved = await json('POST', '/v1/uploads', token, {
    purpose,
    contentType: 'image/jpeg',
    sizeBytes: body.length,
  });
  const res = await fetch(reserved.url, { method: 'PUT', headers: reserved.headers, body });
  if (!res.ok) throw new Error(`Dépôt refusé : ${res.status}`);
  return reserved.uploadId;
}

async function buy(buyer, buyerPhone, productId) {
  const checkout = await json(
    'POST',
    '/v1/checkouts',
    buyer,
    {
      items: [{ productId, quantity: 1 }],
      delivery: {
        mode: 'home',
        zoneId: '20000000-0000-4000-8000-000000000003',
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

// ---------------------------------------------------------------------------------------------
// 1. Le terrain : une boutique à vérifier, un produit à modérer, un colis prêt, un litige.
// ---------------------------------------------------------------------------------------------
const newSeller = await apiLogin(e164(freshPhone('06 5')));
const shop = await json('POST', '/v1/seller/shop', newSeller, {
  shopName: 'Boutique Bana Mboka',
  city: 'Pointe-Noire',
  pickupZoneId: '20000000-0000-4000-8000-000000000003',
  payoutPhone: freshPhone('06 5'),
  payoutOperator: 'mtn',
});
for (const [type, image] of [
  ['national_id', 'pagne-wax.jpg'],
  ['selfie', 'robe-wax.jpg'],
]) {
  await json('POST', '/v1/seller/kyc-documents', newSeller, {
    type,
    uploadId: await upload(newSeller, 'kyc_document', image),
  });
}
const draft = await json('POST', '/v1/seller/products', newSeller, {
  categoryId: '10000000-0000-4000-8000-000000000007',
  title: 'Miel de forêt du Mayombe 1 L',
  description: 'Récolté au Mayombe, bouteille en verre. Livraison à Pointe-Noire.',
  price: 9000,
  stock: 10,
  publish: false,
});
await json('POST', `/v1/seller/products/${draft.id}/photos`, newSeller, {
  uploadId: await upload(newSeller, 'product_photo', 'miel-foret.jpg'),
});
await json('PATCH', `/v1/seller/products/${draft.id}`, newSeller, { status: 'published' });

const seller = await apiLogin('+242061000001');
const { items: products } = await json('GET', '/v1/seller/products', seller);
const fan = products.find((p) => p.title === 'Ventilateur sur pied 16 pouces');
const earbuds = products.find((p) => p.title === 'Écouteurs Bluetooth sans fil');
for (const p of [fan, earbuds])
  await json('PATCH', `/v1/seller/products/${p.id}`, seller, { stock: 20 });

const buyerPhone = freshPhone('05 6');
const buyer = await apiLogin(e164(buyerPhone));
const toAssign = await buy(buyer, buyerPhone, earbuds.id);
const toDispute = await buy(buyer, buyerPhone, fan.id);
for (const order of [toAssign, toDispute]) {
  await json('POST', `/v1/seller/orders/${order.id}/accept`, seller);
  await json('POST', `/v1/seller/orders/${order.id}/ready`, seller);
}
const admin = await staffLogin('+242069000000');
const rider = await apiLogin('+242068000000');
const riderId = psql(
  `SELECT r.id FROM riders r JOIN users u ON u.id = r.user_id WHERE u.phone = '+242068000000'`,
);
await json('POST', `/v1/support/deliveries/${toDispute.id}/assign`, admin, { riderId });
await json('POST', `/v1/rider/deliveries/${toDispute.id}/pickup`, rider);
// Le code de remise part par SMS (via le worker) : on attend celui de cette commande.
let handoverCode = null;
for (let i = 0; i < 40 && !handoverCode; i++) {
  const { items } = await json(
    'GET',
    `/dev/messages?recipient=${encodeURIComponent(e164(buyerPhone))}`,
  );
  handoverCode = items.find(
    (m) => m.template === 'buyer_handover_code' && m.variables.ref === toDispute.publicRef,
  )?.variables.code;
  if (!handoverCode) await sleep(500);
}
await json('POST', `/v1/rider/deliveries/${toDispute.id}/handover`, rider, { code: handoverCode });
const dispute = await json('POST', `/v1/orders/${toDispute.id}/disputes`, buyer, {
  reason: 'damaged',
  description: 'Le pied du ventilateur est fendu, il ne tient pas debout.',
});
await json('POST', `/v1/disputes/${dispute.id}/evidence`, buyer, {
  uploadId: await upload(buyer, 'dispute_evidence', 'ventilateur-16.jpg'),
});

// ---------------------------------------------------------------------------------------------
// 2. Un nouvel agent du support se connecte : SMS, puis configuration du second facteur.
// ---------------------------------------------------------------------------------------------
const agentPhone = freshPhone('06 7');
psql(`INSERT INTO users (phone, roles) VALUES ('${e164(agentPhone)}', '{buyer,support}')`);

const browser = await launchBrowser();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  locale: 'fr-FR',
});
const page = await context.newPage();
page.on('dialog', (dialog) => void dialog.accept());
const shot = async (name) => {
  await sleep(300);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  console.log(`📸 ${name}`);
};

await page.goto(BO);
await page.getByLabel('Numéro de téléphone').fill(agentPhone);
await shot('01-connexion');
const since = Date.now() - 1000;
await page.getByRole('button', { name: 'Recevoir le code par SMS' }).click();
const otp = await lastMessage(e164(agentPhone), 'otp_code', since);
await page.getByLabel(/Code reçu par SMS/).fill(otp.variables.code);
await page.getByRole('button', { name: 'Valider' }).click();
await page.getByTestId('totp-secret').waitFor();
await shot('02-second-facteur');
const secret = (await page.getByTestId('totp-secret').innerText()).replace(/\s/g, '');
await page.getByLabel("Code affiché par l'application").fill(totp(secret));
await page.getByRole('button', { name: 'Activer et continuer' }).click();
await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
await shot('03-tableau-de-bord');

// 3. Vérification de la boutique
await page.getByRole('link', { name: /Vérifications/ }).click();
await page.locator(`a[href="/vendeurs/${shop.id}"]`).click();
await page.getByRole('heading', { name: 'Boutique Bana Mboka' }).waitFor();
await page.locator('.gallery img').first().waitFor();
await shot('04-boutique-a-verifier');
await page.getByRole('button', { name: 'Vérifier la boutique' }).click();
await page.getByText('Boutique vérifiée').first().waitFor();

// 4. Modération du produit
await page.getByRole('link', { name: /Modération/ }).click();
await page.getByTestId(`moderation-${draft.id}`).waitFor();
await shot('05-moderation');
await page
  .getByTestId(`moderation-${draft.id}`)
  .getByRole('button', { name: 'Mettre en ligne' })
  .click();
await page.getByText('Produit mis en ligne').waitFor();

// 5. Assignation du livreur
await page.getByRole('link', { name: /Livraisons/ }).click();
const row = page.getByTestId(`delivery-${toAssign.publicRef}`);
await row.waitFor();
await shot('06-livraisons-a-assigner');
await row.getByRole('button', { name: 'Assigner' }).click();
await page.getByText(`Livreur assigné à ${toAssign.publicRef}`).waitFor();

// 6. Litige : preuves, décision de remboursement partiel
await page.getByRole('link', { name: /Litiges/ }).click();
await page.getByTestId(`dispute-${toDispute.publicRef}`).click();
await page.locator('.gallery img').first().waitFor();
await page.getByLabel("Rembourser une partie à l'acheteur, le reste au vendeur").check();
await page.getByLabel(/Montant remboursé/).fill('10000');
await page
  .getByLabel(/Note de décision/)
  .fill("Photo du pied fendu : geste de 10 000 FCFA accepté par l'acheteur au téléphone.");
await shot('07-litige-decision');
await page.getByRole('button', { name: 'Appliquer la décision' }).click();
await page.getByText('Décision appliquée').waitFor();
await shot('08-litige-tranche');

// 7. Dossier de commande retrouvé par le téléphone de l'acheteur
await sleep(4000); // le worker exécute le remboursement et le reversement
await page.getByRole('link', { name: /Commandes/ }).click();
await page.getByLabel('Référence ou téléphone').fill(buyerPhone);
await page.getByRole('button', { name: 'Chercher' }).click();
await page.getByTestId(`order-${toDispute.publicRef}`).click();
await page.getByRole('heading', { name: 'Argent' }).waitFor();
await shot('09-dossier-commande');

// 8. Contrôle comptable
await page.getByRole('link', { name: /Comptabilité/ }).click();
await page.getByTestId('trial-balance').waitFor();
await shot('10-comptabilite');
const balance = await page.getByTestId('trial-balance').innerText();
await browser.close();

if (!balance.includes('0 FCFA')) throw new Error(`Balance générale non nulle : ${balance}`);
console.log(`Parcours support : OK (${API})`);
