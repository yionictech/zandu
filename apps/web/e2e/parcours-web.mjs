/**
 * Site web de bout en bout : aperçu du lien partagé (Open Graph), budget de performance en 3G,
 * puis achat complet sans application (connexion SMS, livraison, Mobile Money, suivi, réception).
 *
 *   API_URL=http://localhost:3998 SITE_URL=http://localhost:3200 SHOTS=./captures DATABASE_URL=… \
 *     node e2e/parcours-web.mjs
 *
 * Le site doit tourner avec ZANDU_SIMULATOR=1 (bouton « Simuler la validation du PIN »).
 */
import { execFileSync } from 'node:child_process';
import {
  apiLogin,
  e164,
  freshPhone,
  json,
  lastMessage,
  launchBrowser,
  SHOTS,
  sleep,
  staffLogin,
} from '../../mobile/e2e/lib.mjs';

const SITE = process.env.SITE_URL ?? 'http://localhost:3200';
const BUYER = freshPhone('05 8');
/** Budgets de docs/architecture/06-exigences-non-fonctionnelles.md §6.2 (fiche produit web). */
const BUDGET = { totalKb: 300, jsKb: 170, loadSeconds: 2.5 };

// 0. Le vendeur de démonstration réapprovisionne le produit (les produits épuisés sont masqués).
const seller = await apiLogin('+242061000001');
const { items: own } = await json('GET', '/v1/seller/products', seller);
const product = own.find((p) => p.title === 'Téléphone Samsung Galaxy A15 128 Go');
await json('PATCH', `/v1/seller/products/${product.id}`, seller, { stock: 8 });
const productUrl = `${SITE}/produit/${product.id}`;

// 1. L'aperçu WhatsApp : ce que lit le robot de WhatsApp dans le HTML, sans JavaScript. Le worker
//    décline les photos en quelques secondes (ADR-0014) : l'aperçu doit utiliser le JPEG de partage.
//    Le site garde la fiche 60 s en cache : on attend que l'aperçu soit à jour.
let html = '';
const og = (name) => html.match(new RegExp(`<meta property="og:${name}" content="([^"]*)"`))?.[1];
for (let i = 0; i < 45; i++) {
  html = await (await fetch(productUrl)).text();
  if (/-share\d+\.jpg$/.test(og('image') ?? '')) break;
  await sleep(2000);
}
for (const name of ['title', 'description', 'image', 'url']) {
  if (!og(name)) throw new Error(`Balise og:${name} absente de la fiche produit`);
}
if (!/FCFA/.test(og('title'))) throw new Error(`Prix absent de l'aperçu : ${og('title')}`);
if (!/-share\d+\.jpg$/.test(og('image'))) {
  throw new Error(`Aperçu sans JPEG de partage : ${og('image')}`);
}
if (!html.includes('"@type":"Product"')) throw new Error('Données structurées Product absentes');
console.log(`Aperçu WhatsApp : « ${og('title')} » — image ${og('image')}`);

const browser = await launchBrowser();

// 2. Budget de performance : fiche produit, cache vide, réseau 3G simulé.
{
  const context = await browser.newContext({
    viewport: { width: 360, height: 780 },
    isMobile: true,
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 300, // 3G « ordinaire » : 300 ms aller-retour, 750 kbit/s descendant
    downloadThroughput: (750 * 1024) / 8,
    uploadThroughput: (250 * 1024) / 8,
  });
  const types = new Map();
  let total = 0;
  let js = 0;
  cdp.on('Network.responseReceived', (e) => types.set(e.requestId, e.type));
  cdp.on('Network.loadingFinished', (e) => {
    total += e.encodedDataLength;
    if (types.get(e.requestId) === 'Script') js += e.encodedDataLength;
  });
  const start = Date.now();
  await page.goto(productUrl, { waitUntil: 'load' });
  const loadSeconds = (Date.now() - start) / 1000;
  await sleep(500);
  // Premier affichage (texte, prix) et plus grand élément (la photo) : ce que voit l'acheteur.
  const paint = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0;
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          resolve({ fcp, lcp: entries[entries.length - 1]?.startTime ?? 0 });
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      }),
  );
  const kb = (n) => Math.round(n / 1024);
  const s = (ms) => (ms / 1000).toFixed(1);
  console.log(
    `Fiche produit en 3G : ${kb(total)} Ko au total (budget ${BUDGET.totalKb}), JavaScript ${kb(js)} Ko (budget ${BUDGET.jsKb}) ; ` +
      `premier affichage ${s(paint.fcp)} s, photo affichée ${s(paint.lcp)} s, page interactive ${loadSeconds.toFixed(1)} s (budget ${BUDGET.loadSeconds} s)`,
  );
  if (kb(total) > BUDGET.totalKb || kb(js) > BUDGET.jsKb) {
    throw new Error('Budget de poids dépassé sur la fiche produit');
  }
  await context.close();
}

// 3. Le parcours d'achat, au format téléphone.
const context = await browser.newContext({
  viewport: { width: 360, height: 780 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'fr-FR',
});
const page = await context.newPage();
page.on('dialog', (dialog) => void dialog.accept());
const shot = async (name) => {
  await sleep(300);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  console.log(`📸 ${name}`);
};

await page.goto(SITE);
await page.getByRole('heading', { name: 'Nouveautés' }).waitFor();
await sleep(600);
await shot('01-accueil');

await page.getByLabel('Rechercher').fill('samsumg');
await page.getByLabel('Lancer la recherche').click();
await page.getByTestId('tile-Téléphone Samsung Galaxy A15 128 Go').waitFor();
await sleep(400);
await page.getByTestId('filter-verified').click();
await page.getByTestId('tile-Téléphone Samsung Galaxy A15 128 Go').waitFor();
await shot('02-recherche-faute-de-frappe');

await page.getByTestId('tile-Téléphone Samsung Galaxy A15 128 Go').click();
await page.getByTestId('product-price').waitFor();
await sleep(400);
await shot('03-fiche-produit');
await page.getByTestId('share-whatsapp').scrollIntoViewIfNeeded();
await shot('04-partager-sur-whatsapp');

await page.getByTestId('buy-now').click();
await page.getByTestId('login-phone').fill(BUYER);
const since = Date.now() - 1000;
await page.getByTestId('login-send').click();
const otp = await lastMessage(e164(BUYER), 'otp_code', since);
await page.getByTestId('login-code').fill(otp.variables.code);
await shot('05-code-sms');
await page.getByTestId('login-verify').click();

await page.getByTestId('zone-Tié-Tié').click();
await page.getByTestId('recipient').fill('Grâce Mabiala');
await page.getByTestId('landmark').fill("Tié-Tié, derrière l'école Saint-Pierre, portail bleu");
await shot('06-livraison');
await page.getByTestId('checkout-continue').click();

await page.getByTestId('payment-pay').waitFor();
await shot('07-paiement');
await page.getByTestId('payment-pay').click();
await page.getByTestId('payment-waiting').waitFor();
await sleep(1500);
await shot('08-attente-validation-pin');
await page.getByTestId('payment-simulate').click();
await page.getByTestId('payment-success').waitFor({ timeout: 15_000 });
await shot('09-paiement-recu');
await page.getByTestId('payment-track').click();
await page.getByTestId('order-status').waitFor();
const orderId = page.url().split('/').pop();
await shot('10-suivi');

// 4. Vendeur, support et livreur font avancer la commande (API).
const admin = await staffLogin('+242069000000');
const rider = await apiLogin('+242068000000');
await json('POST', `/v1/seller/orders/${orderId}/accept`, seller);
await json('POST', `/v1/seller/orders/${orderId}/ready`, seller);
const riderId = execFileSync('psql', [
  process.env.DATABASE_URL,
  '-tAc',
  `SELECT r.id FROM riders r JOIN users u ON u.id = r.user_id WHERE u.phone = '+242068000000'`,
])
  .toString()
  .trim();
await json('POST', `/v1/support/deliveries/${orderId}/assign`, admin, { riderId });
// Le vendeur saisit le code de retrait que le livreur lui montre.
await json('POST', `/v1/seller/orders/${orderId}/rider-pickup`, seller, {
  code: (await json('GET', `/v1/rider/deliveries/${orderId}`, rider)).pickupCode,
});
await json('POST', `/v1/rider/deliveries/${orderId}/pickup`, rider);
// Le livreur partage sa position : l'acheteur le voit arriver sur le site.
await json('POST', `/v1/rider/deliveries/${orderId}/position`, rider, {
  lat: -4.7761,
  lng: 11.8635,
  accuracy: 15,
});
await page.reload();
await page.getByTestId('rider-on-the-way').waitFor();
await shot('10b-livreur-en-route');
const handover = await lastMessage(e164(BUYER), 'buyer_handover_code');
await json('POST', `/v1/rider/deliveries/${orderId}/handover`, rider, {
  code: handover.variables.code,
});

// 5. L'acheteur confirme la réception : le vendeur est payé.
await page.reload();
await page.getByText('Tout est conforme ?').waitFor();
await shot('11-tout-est-conforme');
await page.getByTestId('order-confirm').click();
await page.getByText('Le vendeur est payé').waitFor();
await shot('12-terminee-noter');

// 6. L'avis (étoiles et étiquettes, sans script), puis « Mes commandes » : Terminées, Racheter.
await page.locator('.stars label').first().click();
await page.getByText('Livreur ponctuel').click();
await page.getByText('Publier mon avis').click();
await page.getByText('Merci pour votre avis').waitFor();
await page.goto(`${SITE}/commandes?vue=terminees`);
await page.getByText('Racheter').first().waitFor();
await shot('13-mes-commandes');
await page.getByText('Racheter').first().click();
await page.getByTestId('cart-total').waitFor();

// 7. La vitrine de la boutique, à partager dans les groupes WhatsApp.
await page.goto(`${SITE}/produit/${product.id}`);
await page.getByTestId('shop-link').click();
await page.getByRole('heading', { name: 'Mama Grâce Électro' }).waitFor();
await sleep(400);
await shot('14-vitrine-boutique');

await browser.close();
console.log('Parcours site web : OK');
