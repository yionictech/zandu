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
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

const API = process.env.API_URL ?? 'http://localhost:3998';
const WEB = process.env.WEB_URL ?? 'http://localhost:8081';
const SHOTS = process.env.SHOTS ?? './captures';
// Un numéro neuf à chaque exécution : la limite anti-fraude autorise un code par minute et par numéro.
const BUYER =
  process.env.BUYER_PHONE ??
  `05 5${String(Date.now() % 100_000_000)
    .padStart(8, '0')
    .slice(0, 2)} ${String(Date.now()).slice(-4, -2)} ${String(Date.now()).slice(-2)}`;
const buyerE164 = `+242${BUYER.replace(/\s/g, '')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

/** Dernier message reçu par un numéro (boîte de réception de développement). */
async function lastMessage(recipient, template, after = 0) {
  for (let i = 0; i < 40; i++) {
    const { items } = await json('GET', `/dev/messages?recipient=${encodeURIComponent(recipient)}`);
    const found = items.find((m) => m.template === template && Date.parse(m.sentAt) >= after);
    if (found) return found;
    await sleep(500);
  }
  throw new Error(`Aucun message ${template} pour ${recipient}`);
}

// Sessions réutilisées d'une exécution à l'autre : la limite anti-fraude n'autorise que
// 5 codes par heure et par numéro.
const SESSIONS_FILE = `${tmpdir()}/zandu-e2e-sessions.json`;

async function apiLogin(phone) {
  const cache = JSON.parse(await readFile(SESSIONS_FILE, 'utf8').catch(() => '{}'));
  if (cache[phone]) {
    const res = await fetch(`${API}/v1/me`, {
      headers: { authorization: `Bearer ${cache[phone]}` },
    });
    if (res.ok) return cache[phone];
  }
  const since = Date.now() - 1000;
  const { challengeId } = await json('POST', '/v1/auth/otp/request', null, { phone });
  const { variables } = await lastMessage(phone, 'otp_code', since);
  const { token } = await json('POST', '/v1/auth/otp/verify', null, {
    challengeId,
    code: variables.code,
  });
  await writeFile(SESSIONS_FILE, JSON.stringify({ ...cache, [phone]: token }));
  return token;
}

await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
});
const page = await browser.newPage({
  viewport: { width: 360, height: 780 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'fr-FR',
});
const shot = async (name) => {
  await sleep(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  console.log(`📸 ${name}`);
};

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
const [admin, rider] = [await apiLogin('+242069000000'), await apiLogin('+242068000000')];
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
await page.getByText('Terminée').first().waitFor();
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
await page.getByText('Terminée').first().waitFor();
await shot('12-mes-commandes');
await browser.close();
console.log('Parcours acheteur : OK');
