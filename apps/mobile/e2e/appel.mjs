/**
 * Appel internet dans l'application, de bout en bout : l'acheteuse appelle la boutique depuis la
 * messagerie de sa commande, la vendeuse (autre téléphone) voit l'appel arriver, décroche, les
 * deux parlent (micro simulé), puis l'acheteuse raccroche.
 *
 * Il faut un serveur LiveKit (docker run livekit/livekit-server …) et l'API lancée avec
 * LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, la base chargée avec `pnpm db:seed:demo`.
 *
 *   API_URL=http://localhost:3998 WEB_URL=http://localhost:8081 SHOTS=./captures DATABASE_URL=… \
 *     node e2e/appel.mjs
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  apiLogin,
  e164,
  freshPhone,
  json,
  launchBrowser,
  phone as openPhone,
  WEB,
} from './lib.mjs';

const BUYER = freshPhone('05 6');
const buyer = await apiLogin(e164(BUYER));
const once = () => ({ 'idempotency-key': randomUUID() });

// Commande payée chez une boutique de démonstration.
const { items } = await json('GET', '/v1/products?limit=1');
const product = items[0];
const checkout = await json(
  'POST',
  '/v1/checkouts',
  buyer,
  {
    items: [{ productId: product.id, quantity: 1 }],
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
  { operator: 'mtn', phone: BUYER },
  once(),
);
await json('POST', `/dev/simulator/collections/${payment.id}/approve`);
const orderId = checkout.orders[0].id;
const sellerPhone = execFileSync(
  'psql',
  [
    process.env.DATABASE_URL,
    '-tAc',
    `SELECT u.phone FROM users u JOIN seller_profiles s ON s.user_id = u.id WHERE s.id = '${product.seller.id}'`,
  ],
  { encoding: 'utf8' },
).trim();
const seller = await apiLogin(sellerPhone);

const browser = await launchBrowser();
const a = await openPhone(browser, buyer);
const b = await openPhone(browser, seller);

// La vendeuse a l'application ouverte, ailleurs.
await b.page.goto(`${WEB}/vendeur`);
// L'acheteuse ouvre la messagerie de sa commande et appelle.
await a.page.goto(`${WEB}/messages/${orderId}`);
await a.page.getByTestId('messages-call').last().click();
await a.page.getByTestId('call-status').waitFor();
await a.shot('appel-01-acheteuse-ca-sonne');

// Chez la vendeuse : l'écran d'appel s'ouvre tout seul.
await b.page.getByTestId('call-accept').waitFor({ timeout: 15_000 });
await b.shot('appel-02-vendeuse-appel-entrant');
await b.page.getByTestId('call-accept').click();

// Les deux sont en ligne : le compteur tourne des deux côtés.
await a.page
  .getByTestId('call-status')
  .getByText(/^0:0[1-9]$/)
  .waitFor({ timeout: 20_000 });
await b.page
  .getByTestId('call-status')
  .getByText(/^0:0[1-9]$/)
  .waitFor({ timeout: 20_000 });
await b.page.getByTestId('call-mute').click();
await b.shot('appel-03-vendeuse-en-ligne-micro-coupe');
await a.shot('appel-04-acheteuse-en-ligne');

// L'acheteuse raccroche ; la vendeuse voit la fin de l'appel.
await a.page.getByTestId('call-hang-up').click();
await b.page.getByTestId('call-status').getByText('Appel terminé').waitFor({ timeout: 15_000 });
await b.shot('appel-05-vendeuse-appel-termine');
const call = (await json('GET', `/v1/me/calls/incoming`, seller)).items;
if (call.length) throw new Error('Un appel sonne encore');
await browser.close();
console.log('Appel dans l’application : OK');
