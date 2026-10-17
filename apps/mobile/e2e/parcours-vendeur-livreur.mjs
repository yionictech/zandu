/**
 * Parcours vendeur puis livreur de bout en bout sur la version web de l'application, contre une
 * API de développement chargée avec `pnpm db:seed:demo` (voir parcours-acheteur.mjs).
 *
 *   API_URL=http://localhost:3998 WEB_URL=http://localhost:8081 SHOTS=./captures DATABASE_URL=… \
 *     node e2e/parcours-vendeur-livreur.mjs
 *
 * Un nouveau vendeur ouvre sa boutique, envoie ses pièces, publie un produit « photo d'abord »,
 * accepte et prépare la commande ; le livreur récupère le colis et saisit le code de remise.
 * L'acheteur et le support agissent par l'API.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  apiLogin,
  e164,
  freshPhone,
  json,
  lastMessage,
  launchBrowser,
  phone as openPhone,
  sleep,
  WEB,
} from './lib.mjs';

const IMAGES = fileURLToPath(new URL('../../../db/seeds/demo/images/', import.meta.url));
const SELLER = freshPhone('06 4');
const BUYER = freshPhone('05 7');
const PRODUCT = 'Sac à main en raphia, fait main';

/** Choisit un fichier quand l'application ouvre l'appareil photo ou la galerie. */
async function pickFile(page, trigger, file) {
  const chooser = page.waitForEvent('filechooser');
  await trigger.click();
  await (await chooser).setFiles(`${IMAGES}${file}`);
}

const browser = await launchBrowser();
const seller = await openPhone(browser);
const { page, shot } = seller;

// 1. « Vendre sur Zandu » depuis l'onglet Compte, connexion par SMS
await page.goto(`${WEB}/compte`);
await page.getByText('Se connecter').last().click();
await page.getByTestId('login-phone').fill(SELLER);
const loginStart = Date.now() - 1000;
await page.getByTestId('login-send').click();
const otp = await lastMessage(e164(SELLER), 'otp_code', loginStart);
await page.getByTestId('login-code').fill(otp.variables.code);
await page.getByTestId('login-verify').click();
await page.getByTestId('account-open-shop').last().waitFor();
await shot('01-compte-vendre-sur-zandu');

// 2. Ouvrir ma boutique : un seul écran
await page.getByTestId('account-open-shop').last().click();
await page.getByTestId('shop-name').fill('Atelier Mabiala Raphia');
await page.getByTestId('shop-zone-Tié-Tié').click();
await shot('02-ouvrir-ma-boutique');
await page.getByTestId('shop-create').click();
await page.getByTestId('kyc-banner').waitFor();
await sleep(600);
await shot('03-espace-vendeur');

// 3. Vérification d'identité : pièce + selfie, envoyés dans l'espace privé
await page.getByTestId('kyc-banner').click();
await pickFile(page, page.getByTestId('kyc-id-camera'), 'pagne-wax.jpg');
await page.getByTestId('kyc-id').getByText('Reçu ✔').waitFor();
await pickFile(page, page.getByTestId('kyc-selfie-camera'), 'robe-wax.jpg');
await page.getByText('Dossier complet', { exact: false }).waitFor();
await shot('04-verification-identite');
await page.goBack();

// 4. Nouveau produit : la photo d'abord, puis nom, prix, catégorie → « Vous recevrez »
await page.getByTestId('dashboard-add-product').click();
await page.getByTestId('photo-camera').waitFor();
await shot('05-nouveau-produit-photo-d-abord');
await pickFile(page, page.getByTestId('photo-camera'), 'sac-raphia.jpg');
await page.getByTestId('photo-add').waitFor();
await page.getByTestId('photo-uploading').waitFor({ state: 'detached' });
await page.getByTestId('product-title').fill(PRODUCT);
await page.getByTestId('product-price').fill('15000');
await page.getByTestId('product-category-mode').click();
await page
  .getByLabel('Description (facultatif)')
  .fill('Raphia tressé à Pointe-Noire, doublure coton, 35 × 25 cm.');
await page.getByTestId('earnings').scrollIntoViewIfNeeded();
await shot('06-produit-vous-recevrez');
await page.getByTestId('product-publish').click();
await page.getByText('Produit envoyé', { exact: false }).waitFor();
await sleep(800);
await shot('07-mes-produits-en-verification');

// 5. Support (API) : boutique vérifiée, produit approuvé
const token = await page.evaluate(() => localStorage.getItem('zandu.session'));
const admin = await apiLogin('+242069000000');
const shop = await json('GET', '/v1/seller/shop', token);
await json('POST', `/v1/admin/sellers/${shop.id}/verification`, admin, { decision: 'verified' });
const { items: products } = await json('GET', '/v1/seller/products', token);
const productId = products.find((p) => p.title === PRODUCT).id;
await json('POST', `/v1/admin/products/${productId}/moderation`, admin, { decision: 'published' });

// 6. Un acheteur commande et paie (API + simulateur d'agrégateur)
const buyer = await apiLogin(e164(BUYER));
const once = () => ({ 'idempotency-key': randomUUID() });
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
      phone: BUYER,
      landmark: 'Tié-Tié, rue Mbochi, maison jaune après la boulangerie',
    },
  },
  once(),
);
const payment = await json(
  'POST',
  `/v1/checkouts/${checkout.id}/payments`,
  buyer,
  { operator: 'airtel', phone: BUYER },
  once(),
);
await json('POST', `/dev/simulator/collections/${payment.id}/approve`);
const orderId = checkout.orders[0].id;
const ref = checkout.orders[0].publicRef;

// 7. Le vendeur voit la commande « à traiter », l'accepte, prépare le colis
await page.goto(`${WEB}/vendeur`);
await page.getByTestId(`seller-order-${ref}`).waitFor();
await sleep(600);
await shot('08-a-traiter');
await page.getByTestId(`seller-order-${ref}`).click();
await page.getByTestId('seller-accept').waitFor();
await shot('09-commande-a-accepter');
await page.getByTestId('seller-accept').click();
await page.getByTestId('seller-ready').click();
await page.getByText('Un livreur va passer', { exact: false }).waitFor();
await shot('10-colis-pret');

// 8. Support (API) : un livreur partenaire est assigné
const riderId = execFileSync('psql', [
  process.env.DATABASE_URL,
  '-tAc',
  `SELECT r.id FROM riders r JOIN users u ON u.id = r.user_id WHERE u.phone = '+242068000000'`,
])
  .toString()
  .trim();
await json('POST', `/v1/support/deliveries/${orderId}/assign`, admin, { riderId });

// 9. Le livreur : missions, colis récupéré, code de remise sur le pavé géant
const rider = await openPhone(browser, await apiLogin('+242068000000'));
await rider.page.goto(`${WEB}/livreur`);
await rider.page.getByTestId(`mission-${ref}`).waitFor();
await rider.shot('11-livreur-missions');
await rider.page.getByTestId(`mission-${ref}`).click();
await rider.page.getByTestId('rider-pickup').waitFor();
await rider.shot('12-livreur-a-recuperer');
await rider.page.getByTestId('rider-pickup').click();
await rider.page.getByTestId('rider-handover').waitFor();
const handover = await lastMessage(e164(BUYER), 'buyer_handover_code');
for (const digit of handover.variables.code) await rider.page.getByTestId(`pad-${digit}`).click();
await rider.shot('13-livreur-code-de-remise');
await rider.page.getByTestId('rider-handover').click();
await rider.page.getByTestId('handover-done').waitFor();
await rider.shot('14-livreur-remis');

// 10. L'acheteur confirme : le vendeur est payé automatiquement sur son Mobile Money
await json('POST', `/v1/orders/${orderId}/confirm-receipt`, buyer);
for (let i = 0; i < 30; i++) {
  const balance = await json('GET', '/v1/seller/balance', token);
  if (balance.payouts[0]?.status === 'succeeded') break;
  await sleep(500);
}
await page.goto(`${WEB}/vendeur/argent`);
await page.getByTestId('payout-row').waitFor();
await page.getByText('Versé').first().waitFor();
await shot('15-mon-argent');

const balance = await json('GET', '/v1/seller/balance', token);
console.log(
  `Commande ${ref} : vendeur payé ${balance.payouts[0].amount} FCFA (${balance.payouts[0].status}).`,
);
await browser.close();
