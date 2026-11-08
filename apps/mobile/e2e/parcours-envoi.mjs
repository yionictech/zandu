/**
 * Envoi de colis dans la démonstration locale (sans serveur) : l'acheteuse envoie un colis à
 * une amie, paie, donne le colis au livreur contre son code de retrait ; le livreur le remet à
 * la destinataire contre le code reçu par SMS.
 *
 *   EXPO_PUBLIC_DEMO=1 EXPO_PUBLIC_SIMULATOR=1 pnpm export:web && node e2e/serve.mjs &
 *   WEB_URL=http://localhost:8081 SHOTS=./captures-envoi node e2e/parcours-envoi.mjs
 */
import { launchBrowser, phone as openPhone, sleep, WEB } from './lib.mjs';

const browser = await launchBrowser();
const { page, shot } = await openPhone(browser, undefined, {
  geolocation: { latitude: -4.7761, longitude: 11.8635, accuracy: 15 },
});
const as = async (role, path) => {
  await page.goto(`${WEB}/compte`);
  await page.getByTestId(`demo-${role}`).last().click();
  await sleep(500);
  if (path) await page.goto(`${WEB}${path}`);
};

// 1. Accueil : la rangée « Services »
await as('buyer', '/');
await page.getByTestId('service-parcel').waitFor();
await shot('01-envoi-accueil-services');

// 2. Formulaire : taille, contenu, enlèvement, destinataire ; le prix s'affiche
await page.getByTestId('service-parcel').click();
await page.getByTestId('parcel-size-medium').click();
await page.getByTestId('parcel-description').fill('Pagne et documents');
await shot('02a-envoi-taille');
await page.getByTestId('parcel-from-name').fill('Prisca Nkounkou');
await page.getByTestId(/^parcel-from-zone-Lumumba/).click();
await page.getByTestId('parcel-from-landmark').fill('Lumumba, à côté de la boulangerie du marché');
await page.getByTestId('parcel-to-name').fill('Grâce Mabiala');
await page.getByTestId('parcel-to-phone').fill('05 512 12 12');
await page.getByTestId(/^parcel-to-zone-Tié-Tié/).click();
await page.getByTestId('parcel-to-landmark').fill("Tié-Tié, derrière l'école Saint-Pierre");
await page.getByTestId('parcel-price').getByText('FCFA').waitFor();
await shot('02-envoi-formulaire');
await page.getByTestId('parcel-continue').click();

// 3. Paiement Mobile Money, comme un achat
await page.getByTestId('payment-parcel').waitFor();
await shot('03-envoi-paiement');
await page.getByTestId('payment-pay').click();
await page.getByTestId('payment-success').waitFor({ timeout: 20_000 });
await page.getByTestId('payment-track').click();
await page.getByTestId('parcel-card').waitFor();
const orderId = page.url().split('/').pop();
const ref = (await page.textContent('body')).match(/ZD-[A-Z0-9]{8}/)[0];

// 4. Le livreur (désigné tout de suite en démonstration) montre son code de retrait
await as('rider', '/livreur');
await page.getByTestId(`mission-${ref}`).click();
const pickupCode = (await page.getByTestId('rider-pickup-code').textContent()).replace(/\D/g, '');
await shot('04-envoi-livreur-chez-expediteur');

// 5. L'expéditrice saisit le code et donne le colis
await as('buyer', `/commande/${orderId}`);
await page.getByTestId('parcel-code').waitFor();
await page.getByTestId('parcel-code-input').fill(pickupCode);
await shot('05-envoi-code-du-livreur');
await page.getByTestId('parcel-code-confirm').click();
await page.getByText('Colis remis au livreur.').waitFor();

// 6. Le livreur vérifie, part, et remet le colis avec le code SMS de la destinataire
await as('rider', `/livreur/${orderId}`);
await page.getByTestId('rider-check-0').click();
await page.getByTestId('rider-check-1').click();
await page.getByTestId('rider-pickup').click();
await page.getByTestId('rider-arrived').waitFor();
await as('buyer', `/commande/${orderId}`);
await page.getByTestId('parcel-read-recipient-code').click();
const handover = (await page.getByTestId('parcel-recipient-code').textContent()).match(
  /(\d{6})/,
)[1];
await shot('06-envoi-suivi-expediteur');
await as('rider', `/livreur/${orderId}`);
await page.getByTestId('rider-arrived').click();
for (const digit of handover) await page.getByTestId(`pad-${digit}`).click();
await page.getByTestId('rider-handover').click();
await page.getByTestId('handover-done').waitFor();
await shot('07-envoi-remis');

// 7. L'expéditrice voit l'envoi remis
await as('buyer', `/commande/${orderId}`);
await page.getByTestId('order-confirm').waitFor();
await shot('08-envoi-remis-cote-expediteur');

await browser.close();
console.log(`Parcours envoi de colis : OK (${ref}, sans serveur)`);
