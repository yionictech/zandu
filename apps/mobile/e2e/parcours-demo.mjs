/**
 * Démonstration locale (docs/exploitation/demo-locale.md) : la version web de l'application
 * construite avec EXPO_PUBLIC_DEMO=1, sans aucun serveur. Une commande suivie de bout en bout sur
 * un seul téléphone, en passant d'un rôle à l'autre par « Mon compte » : l'acheteuse achète, la
 * vendeuse accepte et prépare, le livreur récupère et remet, l'acheteuse confirme et note.
 *
 *   EXPO_PUBLIC_DEMO=1 EXPO_PUBLIC_SIMULATOR=1 pnpm export:web && node e2e/serve.mjs &
 *   WEB_URL=http://localhost:8081 SHOTS=./captures-demo node e2e/parcours-demo.mjs
 */
import { launchBrowser, phone as openPhone, sleep, WEB } from './lib.mjs';

const browser = await launchBrowser();
// Le téléphone est à Pointe-Noire, rond-point Lumumba (position partagée par le livreur).
const { page, shot } = await openPhone(browser, undefined, {
  geolocation: { latitude: -4.7761, longitude: 11.8635, accuracy: 15 },
});
const as = async (role, path) => {
  await page.goto(`${WEB}/compte`);
  await page.getByTestId(`demo-${role}`).last().click();
  await sleep(500);
  if (path) await page.goto(`${WEB}${path}`);
};

// 1. Ouverture : bandeau de démonstration, catalogue fictif avec ses photos
await page.goto(WEB);
await page.getByTestId('demo-banner').waitFor();
await page.getByText('Ventilateur sur pied 16 pouces').first().waitFor();
await sleep(600);
await shot('01-demo-accueil');
await page.getByTestId('demo-banner').click();
await page.getByTestId('demo-panel').last().waitFor();
await shot('02-demo-choisir-un-role');

// 2. L'acheteuse achète des écouteurs chez Mama Grâce Électro
await as('buyer', '/');
await page.getByText('Écouteurs Bluetooth sans fil').first().click();
await page.getByTestId('buy-now').click();
await page.getByText('Quartier de livraison').waitFor();
await page.getByTestId('zone-Tié-Tié').click();
await page.getByTestId('checkout-name').fill('Prisca Nkounkou');
await page.getByTestId('checkout-phone').fill('06 612 34 98');
await page.getByTestId('checkout-landmark').fill("Tié-Tié, derrière l'école Saint-Pierre");
await page.getByTestId('checkout-pin').click();
await page.getByTestId('checkout-pin-map').waitFor();
await shot('03-demo-livraison');
await page.getByTestId('checkout-continue').click();
await page.getByTestId('payment-pay').click();
await page.getByTestId('payment-waiting').waitFor();
await shot('04-demo-attente-pin');
// Le « PIN » de démonstration se valide tout seul en quelques secondes.
await page.getByTestId('payment-success').waitFor({ timeout: 20_000 });
await shot('05-demo-paiement-recu');
await page.getByTestId('payment-track').click();
await page.getByTestId('order-status').waitFor();
const orderId = page.url().split('/').pop();
const ref = (await page.textContent('body')).match(/ZD-[A-Z0-9]{8}/)[0];

// 3. La vendeuse accepte et prépare
await as('seller', '/vendeur');
await page.getByTestId('dashboard-new-orders').waitFor();
await shot('06-demo-vendeuse-tableau-de-bord');
await page.goto(`${WEB}/vendeur/commande/${orderId}`);
await page.getByTestId('ready-in-60').click();
await page.getByTestId('seller-accept').click();
await page.getByTestId('seller-ready').click();
await page.getByTestId('seller-order-status').getByText('Prête').waitFor();
await shot('07-demo-vendeuse-colis-pret');

// 4. Le livreur montre son code de retrait, la vendeuse le saisit
await as('rider', '/livreur');
await page.getByTestId(`mission-${ref}`).click();
const pickupCode = (await page.getByTestId('rider-pickup-code').textContent()).replace(/\D/g, '');
await shot('08-demo-livreur-code-de-retrait');
await as('seller', `/vendeur/commande/${orderId}`);
await page.getByTestId('seller-pickup-code').fill(pickupCode);
await page.getByTestId('seller-pickup-confirm').click();
await page.getByText('Code confirmé', { exact: false }).waitFor();

// 5. Le livreur prend le colis et part ; le client le voit arriver
await as('rider', `/livreur/${orderId}`);
await page.getByTestId('rider-check-0').click();
await page.getByTestId('rider-check-1').click();
await page.getByTestId('rider-pickup').click();
await page.getByTestId('rider-arrived').waitFor();
await page.getByTestId('destination-map').waitFor();
await sleep(1500); // première position partagée
await shot('09-demo-livreur-en-route');
await as('buyer', `/commande/${orderId}`);
await page.getByTestId('rider-on-the-way').waitFor();
await shot('10-demo-acheteuse-livreur-en-route');

// 3 bis. Messagerie de la commande : l'acheteuse écrit au livreur, qui répond.
await page.getByTestId('open-messages').last().click();
await page.getByTestId('message-input').last().fill('Je suis au portail bleu, derrière l’école.');
await page.getByTestId('message-send').last().click();
await page.getByTestId('message-mine').last().waitFor();
await as('rider', `/messages/${orderId}`);
await page.getByTestId('message-theirs').last().waitFor();
// Réponse rapide du livreur, d'une touche ; « Vu » quand l'acheteuse a lu.
await page.getByTestId('message-quick').getByText('Je suis en route').last().click();
await page.getByTestId('message-mine').last().waitFor();
await sleep(400);
await shot('10b-demo-messagerie-livreur');
await as('buyer', `/commande/${orderId}`);

// 6. Le code de remise arrive dans les notifications de l'acheteuse ; le livreur le saisit
await page.goto(`${WEB}/notifications`);
const message = page.getByText('Code de remise de la commande', { exact: false }).first();
await message.waitFor();
const handover = (await message.textContent()).match(/(\d{6})/)[1];
await shot('11-demo-code-de-remise');
await as('rider', `/livreur/${orderId}`);
await page.getByTestId('rider-arrived').click();
for (const digit of handover) await page.getByTestId(`pad-${digit}`).click();
await page.getByTestId('rider-handover').click();
await page.getByTestId('handover-done').waitFor();
await shot('12-demo-livraison-reussie');

// 7. L'acheteuse confirme et note ; la vendeuse est payée
await as('buyer', `/commande/${orderId}`);
await page.getByTestId('order-confirm').click();
await page.getByText('Notez votre achat').last().waitFor();
await page.getByLabel('5 étoiles').first().click();
await page.getByText('Publier mon avis').click();
await page.getByText('Merci pour votre avis !').waitFor();
// … et le livreur (vu de lui et du support seulement).
await page.getByTestId('rider-star-5').click();
await page.getByText('Ponctuel').last().click();
await page.getByTestId('rider-review-send').click();
await page.getByTestId('rider-review-done').waitFor();
await shot('13-demo-avis');
await as('seller', '/vendeur');
await sleep(800);
await shot('14-demo-vendeuse-apres-vente');

// 8. Les statistiques de la vendeuse : vues, ventes de la semaine, conseils
await page.goto(`${WEB}/vendeur/statistiques`);
await page.getByTestId('stats-tips').waitFor();
await shot('15-demo-vendeuse-statistiques');

await browser.close();
console.log(`Parcours démonstration : OK (commande ${ref}, sans serveur)`);
