/**
 * Repas dans la démonstration locale (sans serveur) : l'acheteuse ouvre « Repas », choisit le
 * restaurant de démonstration, un plat avec sa taille et son accompagnement, et paie.
 *
 *   EXPO_PUBLIC_DEMO=1 EXPO_PUBLIC_SIMULATOR=1 pnpm export:web && node e2e/serve.mjs &
 *   WEB_URL=http://localhost:8081 SHOTS=./captures-repas node e2e/parcours-repas.mjs
 */
import { launchBrowser, phone as openPhone, sleep, WEB } from './lib.mjs';

const browser = await launchBrowser();
const { page, shot } = await openPhone(browser);
await page.goto(`${WEB}/compte`);
await page.getByTestId('demo-buyer').last().click();
await sleep(500);

// 1. Accueil › Repas : les restaurants de la ville
await page.goto(WEB);
await page.getByTestId('service-food').click();
await page.getByTestId('restaurant-demo-resto').waitFor();
await sleep(400);
await shot('01-repas-restaurants');

// 2. Le menu, puis un plat : taille et accompagnement, prix mis à jour
await page.getByTestId('restaurant-demo-resto').click();
await page.getByText('Poulet DG').last().waitFor();
await sleep(400);
await shot('02-repas-menu');
await page.getByText('Poulet DG').last().click();
await page.getByTestId('dish-options').waitFor();
await page.getByTestId('dish-option-0-Grand').click();
await page.getByTestId('dish-option-1-Frites').click();
await page.getByText('6 000').last().waitFor();
await shot('03-repas-plat-options');

// 3. Commande : la ligne garde les choix
await page.getByTestId('buy-now').click();
await page.getByText('Quartier de livraison').waitFor();
await page.getByTestId(/^zone-Tié-Tié/).click();
await page.getByTestId('checkout-name').fill('Prisca Nkounkou');
await page.getByTestId('checkout-phone').fill('06 612 34 98');
await page.getByTestId('checkout-landmark').fill("Tié-Tié, derrière l'école Saint-Pierre");
await page.getByTestId('checkout-continue').click();
await page.getByTestId('payment-pay').click();
await page.getByTestId('payment-success').waitFor({ timeout: 20_000 });
await page.getByTestId('payment-track').click();
await page.getByText('Poulet DG (Grand, Frites)').last().waitFor();
await sleep(400);
await shot('04-repas-commande');

await browser.close();
console.log('Parcours repas : OK (sans serveur)');
