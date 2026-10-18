/**
 * Application sans réseau (ADR-0017), sur la version web de l'application, contre une API de
 * développement chargée avec `pnpm db:seed:demo` (voir parcours-acheteur.mjs).
 *
 *   API_URL=http://localhost:3998 WEB_URL=http://localhost:8081 SHOTS=./captures \
 *     node e2e/parcours-hors-ligne.mjs
 *
 * Un vendeur (aussi acheteur) parcourt le catalogue et son espace, puis l'API devient
 * injoignable : l'application rouverte garde la session et affiche ce qui a déjà été vu ; une
 * fiche jamais vue le dit. Le vendeur prépare un produit sans réseau ; au retour du réseau, la
 * fiche part toute seule, une seule fois. À la déconnexion, la copie enregistrée est effacée.
 *
 * La coupure bloque les requêtes vers l'API (le serveur de l'application reste joignable pour
 * pouvoir la rouvrir) : c'est ce que vit un téléphone au forfait épuisé.
 */
import { fileURLToPath } from 'node:url';
import {
  API,
  apiLogin,
  e164,
  freshPhone,
  json,
  launchBrowser,
  phone as openPhone,
  sleep,
  WEB,
} from './lib.mjs';

const IMAGES = fileURLToPath(new URL('../../../db/seeds/demo/images/', import.meta.url));
const SELLER = freshPhone('06 4');
const PRODUCT = `Panier tressé hors ligne ${SELLER.slice(-5).replace(' ', '')}`;

const { items } = await json('GET', '/v1/products?limit=12');
if (items.length < 2) throw new Error('Il faut au moins 2 produits publiés (pnpm db:seed:demo)');
const [seen, unseen] = items;

// Vendeur prêt : session ouverte et boutique créée par l'API.
const token = await apiLogin(e164(SELLER));
await json('POST', '/v1/seller/shop', token, {
  shopName: 'Vannerie Loango',
  city: 'Pointe-Noire',
  pickupZoneId: '20000000-0000-4000-8000-000000000003',
  payoutPhone: SELLER,
  payoutOperator: 'mtn',
});

const browser = await launchBrowser();
const { page, shot } = await openPhone(browser, token);
const blockApi = (route) => route.abort('internetdisconnected');
const network = async (on) => {
  if (on) await page.unroute(`${API}/**`, blockApi);
  else await page.route(`${API}/**`, blockApi);
};

// 1. En ligne : accueil, une fiche, ses achats, son espace vendeur. La copie est enregistrée
// une seconde après le dernier chargement (ou dès que l'application passe en arrière-plan).
const settle = () => page.waitForLoadState('networkidle').then(() => sleep(1500));
await page.goto(`${WEB}/`);
await page.getByTestId(`product-${seen.id}`).first().click();
await page.getByText(seen.title).last().waitFor();
await settle();
await page.goto(`${WEB}/commandes`);
await settle();
await page.goto(`${WEB}/vendeur/produits`);
await page.getByText('Pas encore de produit', { exact: false }).waitFor();
await settle();

// 2. Plus de réseau ; l'application est rouverte : session gardée, fiche déjà vue lisible.
await network(false);
await page.goto(`${WEB}/produit/${seen.id}`);
await page.getByTestId('offline-banner').waitFor();
await page.getByText(seen.title).last().waitFor();
await shot('01-fiche-sans-reseau');

await page.goto(`${WEB}/produit/${unseen.id}`);
await page.getByTestId('offline-unsaved').waitFor();
await shot('02-fiche-jamais-vue');

// 3. Produit préparé sans réseau : gardé sur le téléphone.
await page.goto(`${WEB}/vendeur/produit/nouveau`);
const chooser = page.waitForEvent('filechooser');
await page.getByTestId('photo-camera').click();
await (await chooser).setFiles(`${IMAGES}sac-raphia.jpg`);
await page.getByTestId('photo-add').waitFor();
await page.getByTestId('product-title').fill(PRODUCT);
await page.getByTestId('product-price').fill('12000');
await page.getByTestId('product-category-mode').click();
await page.getByText('Envoyer au retour du réseau').waitFor();
await page.getByTestId('product-publish').click();
await page.getByText('la fiche est gardée sur le téléphone', { exact: false }).waitFor();
await page.getByTestId(`queued-${PRODUCT}`).waitFor();
await shot('03-fiche-en-attente');

// 4. Le réseau revient : la fiche part toute seule (l'application interroge l'API).
await network(true);
await page.getByText(`« ${PRODUCT} » est envoyée.`).waitFor({ timeout: 30_000 });
if (await page.getByTestId('offline-banner').count()) throw new Error('Bandeau resté affiché');
await page.getByTestId(`seller-product-${PRODUCT}`).waitFor();
await shot('04-fiche-envoyee');

const { items: mine } = await json('GET', '/v1/seller/products', token);
const sent = mine.filter((p) => p.title === PRODUCT);
if (sent.length !== 1) throw new Error(`${sent.length} fiches créées au lieu d'une`);
if (sent[0].photoCount !== 1 || sent[0].status !== 'pending_review')
  throw new Error(`Fiche envoyée incomplète : ${JSON.stringify(sent[0])}`);

// 5. Déconnexion : plus rien du compte sur le téléphone.
await page.goto(`${WEB}/compte`);
await page.getByText('Se déconnecter').click();
await page.getByText('Se connecter').first().waitFor();
const left = await page.evaluate(() => ({
  cache: localStorage.getItem('zandu.cache.v1'),
  profile: localStorage.getItem('zandu.profile'),
}));
const personal = ['["seller"', '["orders"'].some((k) => left.cache?.includes(k));
if (personal || (left.profile && left.profile !== 'null'))
  throw new Error('Données du compte restées sur le téléphone');

await browser.close();
console.log('Parcours hors connexion (application) : OK');
