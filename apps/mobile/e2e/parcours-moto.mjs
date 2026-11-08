/**
 * Moto-taxi dans la démonstration locale (sans serveur) : l'acheteuse commande une course
 * (départ à sa position, arrivée sur la carte), paie ; le livreur l'accepte dans les courses
 * disponibles ; la passagère saisit son code en montant ; à l'arrivée elle donne son code SMS.
 *
 *   EXPO_PUBLIC_DEMO=1 EXPO_PUBLIC_SIMULATOR=1 pnpm export:web && node e2e/serve.mjs &
 *   WEB_URL=http://localhost:8081 SHOTS=./captures-moto node e2e/parcours-moto.mjs
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

// 1. Commande : départ (ma position), arrivée (sur la carte), prix
await as('buyer', '/');
await page.getByTestId('service-ride').click();
await page.getByTestId('ride-from-pin').click();
await page.getByTestId('ride-from-pin-map').waitFor();
await page.getByTestId(/^ride-from-zone-Lumumba/).click();
await page.getByTestId('ride-from-landmark').fill('Rond-point Lumumba, devant la pharmacie');
await page.getByTestId('ride-to-pin-on-map').click();
await page.getByTestId('ride-to-pin-map').waitFor();
await page.getByTestId(/^ride-to-zone-Tié-Tié/).click();
await page.getByTestId('ride-to-landmark').fill('École Saint-Pierre');
await page.getByTestId('ride-price').getByText('FCFA').waitFor();
await sleep(500);
await shot('01-moto-commande');
await page.getByTestId('ride-continue').click();
await page.getByTestId('payment-ride').waitFor();
await page.getByTestId('payment-pay').click();
await page.getByTestId('payment-success').waitFor({ timeout: 20_000 });
await page.getByTestId('payment-track').click();
await page.getByTestId('parcel-card').waitFor();
const orderId = page.url().split('/').pop();
const ref = (await page.textContent('body')).match(/ZD-[A-Z0-9]{8}/)[0];
await shot('02-moto-en-attente');

// 2. Le livreur accepte la course dans « Courses disponibles »
await as('rider', '/livreur');
await page.getByTestId(`offer-${ref}`).waitFor();
await shot('03-moto-courses-disponibles');
await page.getByTestId(`offer-accept-${ref}`).click();
const pickupCode = (await page.getByTestId('rider-pickup-code').textContent()).replace(/\D/g, '');
await shot('04-moto-conducteur');

// 3. La passagère monte : elle saisit le code du conducteur
await as('buyer', `/commande/${orderId}`);
await page.getByTestId('parcel-code-input').fill(pickupCode);
await page.getByTestId('parcel-code-confirm').click();
await page.getByText('Bon trajet', { exact: false }).waitFor();
await page.getByTestId('parcel-read-recipient-code').click();
const endCode = (await page.getByTestId('parcel-recipient-code').textContent()).match(/(\d{6})/)[1];
await shot('05-moto-a-bord');

// 4. Arrivée : le conducteur saisit le code de fin de course
await as('rider', `/livreur/${orderId}`);
await page.getByTestId('rider-check-0').click();
await page.getByTestId('rider-pickup').click();
await page.getByTestId('rider-arrived').click();
for (const digit of endCode) await page.getByTestId(`pad-${digit}`).click();
await page.getByTestId('rider-handover').click();
await page.getByTestId('handover-done').waitFor();
await shot('06-moto-arrivee');

await browser.close();
console.log(`Parcours moto-taxi : OK (${ref}, sans serveur)`);
