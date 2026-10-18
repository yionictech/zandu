/**
 * Site web sans réseau (ADR-0016) : l'acheteur parcourt le site, puis perd le réseau.
 *
 *   API_URL=… SITE_URL=… SHOTS=./captures DATABASE_URL=… \
 *   OFFLINE_CMD='…' ONLINE_CMD='…' node e2e/parcours-hors-ligne.mjs
 *
 * Les pages déjà vues (accueil, fiches, panier, achats) restent lisibles ; une page jamais vue
 * mène à la page « hors connexion » (produits vus récemment, panier) ; la validation du panier
 * n'est jamais servie depuis le téléphone ; après déconnexion, les achats ne sont plus lisibles.
 *
 * Le mode « hors ligne » du navigateur ne coupe pas le réseau du service worker : la coupure
 * réelle se fait par OFFLINE_CMD / ONLINE_CMD, par exemple arrêter puis relancer Caddy en recette :
 *   OFFLINE_CMD='docker compose … stop caddy'  ONLINE_CMD='docker compose … start caddy'
 */
import { execSync } from 'node:child_process';
import {
  e164,
  freshPhone,
  json,
  lastMessage,
  launchBrowser,
  phone,
  sleep,
} from '../../mobile/e2e/lib.mjs';

const SITE = process.env.SITE_URL ?? 'http://localhost:3200';
const BUYER = freshPhone('05 7');
if (!process.env.OFFLINE_CMD || !process.env.ONLINE_CMD)
  throw new Error('OFFLINE_CMD et ONLINE_CMD sont nécessaires (voir en tête du fichier)');

const { items } = await json('GET', '/v1/products?limit=12');
if (items.length < 3) throw new Error('Il faut au moins 3 produits publiés (pnpm db:seed:demo)');
const [a, b, unseen] = items;

const browser = await launchBrowser();
const { page, shot } = await phone(browser);
const visit = async (path) => {
  await page.goto(`${SITE}${path}`);
  await page.waitForLoadState('networkidle').catch(() => undefined);
};

/** Coupe (ou rétablit) vraiment le réseau : site injoignable et navigateur hors ligne. */
async function network(on) {
  execSync(on ? process.env.ONLINE_CMD : process.env.OFFLINE_CMD, { stdio: 'ignore' });
  await page.context().setOffline(!on);
  for (let i = 0; on && i < 60; i++) {
    if (
      await fetch(SITE).then(
        (r) => r.ok,
        () => false,
      )
    )
      break;
    await sleep(1000);
  }
}

// 1. En ligne : le service worker s'installe, l'acheteur parcourt et remplit son panier.
await visit('/');
await page.evaluate(() => navigator.serviceWorker.ready);
// Fiche ouverte par un lien du site (sans recharger) : elle doit aussi être enregistrée.
await page.getByTestId(`tile-${a.title}`).first().click();
await page.getByRole('heading', { name: a.title }).waitFor();
await page.getByRole('button', { name: 'Ajouter au panier' }).click();
await page.getByText('Ajouté au panier.').waitFor();
await visit(`/produit/${b.id}`);
await visit('/panier');
await visit('/');

// Connexion, puis la page « Mes achats » (personnelle).
await visit('/connexion?suite=/commandes');
await page.getByTestId('login-phone').fill(BUYER);
const since = Date.now() - 1000;
await page.getByTestId('login-send').click();
const otp = await lastMessage(e164(BUYER), 'otp_code', since);
await page.getByTestId('login-code').fill(otp.variables.code);
await page.getByTestId('login-verify').click();
await page.getByRole('heading', { name: 'Mes achats' }).waitFor();
await page.waitForLoadState('networkidle');
await sleep(2000); // le service worker enregistre la page en arrière-plan

// 2. Plus de réseau.
await network(false);
await visit(`/produit/${a.id}`);
await page.getByRole('heading', { name: a.title }).waitFor();
await page.getByTestId('offline-banner').waitFor();
await shot('01-fiche-sans-reseau');

await visit('/panier');
await page.getByTestId('cart-total').waitFor();
await visit('/commandes');
await page.getByRole('heading', { name: 'Mes achats' }).waitFor();

await visit(`/produit/${unseen.id}`);
await page.getByRole('heading', { name: 'Pas de réseau pour le moment' }).waitFor();
const recent = await page.getByTestId('recent-products').innerText();
if (!recent.includes(a.title) || !recent.includes(b.title))
  throw new Error(`Produits vus récemment incomplets : ${recent}`);
await shot('02-page-hors-connexion');

// La validation du panier (argent) n'est jamais servie depuis le téléphone.
await visit('/commande');
await page.getByRole('heading', { name: 'Pas de réseau pour le moment' }).waitFor();

// 3. Le réseau revient : le bandeau disparaît.
await network(true);
await visit('/');
if (await page.getByTestId('offline-banner').count()) throw new Error('Bandeau resté affiché');

// 4. Déconnexion : les pages personnelles sont oubliées.
await visit('/commandes');
await page.getByRole('button', { name: 'Se déconnecter' }).click();
await page.waitForURL(`${SITE}/`);
await page.waitForLoadState('networkidle');
await sleep(500);
await network(false);
await visit('/commandes');
await page.getByRole('heading', { name: 'Pas de réseau pour le moment' }).waitFor();
await network(true);

await browser.close();
console.log('Parcours hors connexion : OK');
