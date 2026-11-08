/**
 * Points fidélité dans la démonstration locale (sans serveur) : l'acheteuse voit ses points
 * (gagnés avec sa commande terminée) et son code de parrainage, puis paie un achat en partie
 * avec ses points.
 *
 *   EXPO_PUBLIC_DEMO=1 EXPO_PUBLIC_SIMULATOR=1 pnpm export:web && node e2e/serve.mjs &
 *   WEB_URL=http://localhost:8081 SHOTS=./captures-fidelite node e2e/parcours-fidelite.mjs
 */
import { launchBrowser, phone as openPhone, sleep, WEB } from './lib.mjs';

const browser = await launchBrowser();
const { page, shot } = await openPhone(browser);
await page.goto(`${WEB}/compte`);
await page.getByTestId('demo-buyer').last().click();
await sleep(500);

// 1. Accueil › Mes points : solde, règles, code à partager
await page.goto(WEB);
await page.getByTestId('service-loyalty').click();
await page.getByTestId('loyalty-balance').waitFor();
await page.getByTestId('loyalty-code').waitFor();
await sleep(400);
await shot('01-fidelite-mes-points');

// 2. Un achat payé en partie avec les points
await page.goto(WEB);
await page.getByText('Ventilateur sur pied 16 pouces').first().click();
await page.getByTestId('buy-now').last().click();
await page.getByText('Quartier de livraison').waitFor();
await page.getByTestId(/^zone-Tié-Tié/).click();
await page.getByTestId('checkout-name').fill('Prisca Nkounkou');
await page.getByTestId('checkout-phone').fill('06 612 34 98');
await page.getByTestId('checkout-landmark').fill("Tié-Tié, derrière l'école Saint-Pierre");
await page.getByTestId('checkout-points').scrollIntoViewIfNeeded();
await page.getByTestId('checkout-points').click();
await shot('02-fidelite-utiliser-mes-points');
await page.getByTestId('checkout-continue').click();
await page.getByTestId('payment-points').waitFor();
await shot('03-fidelite-paiement');

await browser.close();
console.log('Parcours fidélité : OK (sans serveur)');
