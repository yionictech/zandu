/**
 * Parcours acheteur de bout en bout sur la version web de l'application, contre une API de
 * développement (simulateur d'agrégateur) chargée avec `pnpm db:seed:demo`.
 *
 *   API_URL=http://localhost:3998 WEB_URL=http://localhost:8081 SHOTS=./captures node e2e/parcours-acheteur.mjs
 *
 * Le vendeur, le support et le livreur agissent par l'API ; l'acheteur, par l'interface.
 * Des captures d'écran sont prises à chaque étape (format téléphone Android 360 × 780).
 */
import { execFileSync } from 'node:child_process';
import {
  apiLogin,
  e164,
  freshPhone,
  json,
  lastMessage,
  launchBrowser,
  phone as openPhone,
  sleep,
  staffLogin,
  WEB,
} from './lib.mjs';

const BUYER = process.env.BUYER_PHONE ?? freshPhone('05 5');
const buyerE164 = e164(BUYER);

const browser = await launchBrowser();
const { page, shot } = await openPhone(browser);

// 0. Le vendeur réapprovisionne le produit de démonstration (les produits en rupture sont masqués).
const seller = await apiLogin('+242061000001');
const { items: sellerProducts } = await json('GET', '/v1/seller/products', seller);
const phone = sellerProducts.find((p) => p.title === 'Téléphone Samsung Galaxy A15 128 Go');
await json('PATCH', `/v1/seller/products/${phone.id}`, seller, { stock: 8 });

// 1. Découvrir
await page.goto(WEB);
await page.getByText('Ventilateur sur pied 16 pouces').first().waitFor();
await sleep(800); // chargement des photos
await shot('01-accueil');

// 2. Chercher, avec une faute de frappe
await page.getByRole('search').click();
await page.getByTestId('search-input').fill('samsumg');
// Les écrans d'onglets restent montés : l'élément au premier plan est le dernier du document.
const result = page.getByText('Téléphone Samsung Galaxy A15 128 Go').last();
await result.waitFor();
await sleep(600);
await shot('02-recherche');

// 3. Fiche produit
await result.click();
await page.getByText('Garantie Zandu').first().waitFor();
await sleep(600);
await shot('03-fiche-produit');

// 4. Acheter maintenant → connexion par SMS
await page.getByTestId('buy-now').click();
await page.getByTestId('login-phone').fill(BUYER);
const loginStart = Date.now() - 1000;
await page.getByTestId('login-send').click();
const otp = await lastMessage(buyerE164, 'otp_code', loginStart);
await page.getByTestId('login-code').fill(otp.variables.code);
await shot('04-connexion-code-sms');
await page.getByTestId('login-verify').click();

// 5. Livraison : quartier, repère
await page.getByText('Quartier de livraison').waitFor();
await page.getByTestId('zone-Tié-Tié').click();
await page.getByTestId('checkout-name').fill('Grâce Mabiala');
await page.getByTestId('checkout-phone').fill(BUYER);
await page
  .getByTestId('checkout-landmark')
  .fill("Tié-Tié, derrière l'école Saint-Pierre, portail bleu");
await shot('05-livraison');
await page.getByTestId('checkout-continue').click();

// 6. Paiement Mobile Money
await page.getByTestId('payment-pay').waitFor();
await sleep(500);
await shot('06-paiement');
await page.getByTestId('payment-pay').click();
await page.getByTestId('payment-waiting').waitFor();
await sleep(2200);
await shot('07-attente-validation-pin');
await page.getByTestId('payment-simulate').click();
await page.getByTestId('payment-success').waitFor();
await shot('08-paiement-recu');
await page.getByTestId('payment-track').click();
await page.getByTestId('order-status').waitFor();
await shot('09-suivi-commande');
const orderId = page.url().split('/').pop();

// 7. Vendeur, support et livreur font avancer la commande (API)
const [admin, rider] = [await staffLogin('+242069000000'), await apiLogin('+242068000000')];
await json('POST', `/v1/seller/orders/${orderId}/accept`, seller);
await json('POST', `/v1/seller/orders/${orderId}/ready`, seller);
const riderId = execFileSync('psql', [
  process.env.DATABASE_URL,
  '-tAc',
  'SELECT id FROM riders LIMIT 1',
])
  .toString()
  .trim();
await json('POST', `/v1/support/deliveries/${orderId}/assign`, admin, { riderId });
await json('POST', `/v1/rider/deliveries/${orderId}/pickup`, rider);
const handover = await lastMessage(buyerE164, 'buyer_handover_code');
await json('POST', `/v1/rider/deliveries/${orderId}/handover`, rider, {
  code: handover.variables.code,
});

// 8. L'acheteur confirme la réception et note l'article
await page.reload();
await page.getByText('Tout est conforme ?', { exact: true }).waitFor();
await shot('10-remise-tout-est-conforme');
await page.getByTestId('order-confirm').click();
await page.getByText('Notez votre achat').last().waitFor();
await page.getByLabel('5 étoiles').first().click();
await page.getByLabel('Votre avis (facultatif)').fill('Téléphone conforme, livré en 24 h. Merci !');
await page.getByText('Publier mon avis').click();
await page.getByText('Merci pour votre avis !').waitFor();
await shot('11-terminee-avis');

// 9. Reversement automatique au vendeur (worker)
let balance;
for (let i = 0; i < 20; i++) {
  balance = await json('GET', '/v1/seller/balance', seller);
  if (balance.payouts[0]?.status === 'succeeded') break; // le plus récent : celui de cette commande
  await sleep(500);
}
console.log(
  `Vendeur : disponible ${balance.available} FCFA, en séquestre ${balance.inEscrow} FCFA, reversements ${JSON.stringify(balance.payouts.map((p) => [p.amount, p.status]))}`,
);

await page.goto(`${WEB}/commandes`);
// La liste s'ouvre sur « En cours » quand d'autres commandes sont en route.
await page.getByText(/^Terminées · /).click();
await page.getByText('Terminée').first().waitFor();
await shot('12-mes-commandes');
await browser.close();
console.log('Parcours acheteur : OK');
