#!/usr/bin/env node
/**
 * Vérification d'une recette en ligne, depuis n'importe quel poste avec Node 22 :
 *
 *   node deploy/recette/verifier.mjs            # lit deploy/recette/.env
 *   node deploy/recette/verifier.mjs autre.env
 *
 * Contrôle ce qu'un testeur et un attaquant verraient : HTTPS partout, services en vie,
 * aperçu WhatsApp d'un produit, site non indexé, back-office protégé, stockage privé fermé,
 * boîte de réception des SMS de test fermée sans la clé. Code de sortie 1 au moindre échec.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = process.argv[2] ?? fileURLToPath(new URL('.env', import.meta.url));
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n')
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]),
);
const SITE = `https://${env.SITE_HOST}`;
const API = `https://${env.API_HOST}`;
const BO = `https://${env.BACKOFFICE_HOST}`;
const MEDIA = `https://${env.MEDIA_HOST}`;

let failures = 0;
async function check(label, test) {
  try {
    const detail = await test();
    console.log(`✔ ${label}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    failures++;
    console.log(`✘ ${label} — ${error instanceof Error ? error.message : error}`);
  }
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}
const get = (url, init) => fetch(url, { redirect: 'manual', ...init });

await check('HTTP redirige vers HTTPS', async () => {
  const res = await get(`http://${env.SITE_HOST}/`);
  const location = res.headers.get('location') ?? '';
  expect(res.status >= 300 && res.status < 400 && location.startsWith('https://'), `${res.status}`);
});

await check('API en vie (base de données comprise)', async () => {
  const res = await get(`${API}/health`);
  expect(res.ok, `${res.status}`);
});

await check('Site : accueil, en-têtes de sécurité', async () => {
  const res = await get(`${SITE}/`);
  expect(res.ok, `${res.status}`);
  expect(res.headers.get('strict-transport-security'), 'HSTS absent');
  expect(res.headers.get('x-content-type-options') === 'nosniff', 'nosniff absent');
});

await check('Site de recette non indexé par les moteurs de recherche', async () => {
  const robots = await (await get(`${SITE}/robots.txt`)).text();
  expect(/Disallow: \/\s*$/m.test(robots), 'robots.txt autorise l’indexation');
});

await check('Fiche produit : aperçu WhatsApp et photo', async () => {
  const { items } = await (await get(`${API}/v1/products?limit=1`)).json();
  if (!items.length) return 'aucun produit en ligne (données de démonstration non chargées ?)';
  const html = await (await get(`${SITE}/produit/${items[0].id}`)).text();
  const meta = (name) => html.match(new RegExp(`property="og:${name}" content="([^"]*)"`))?.[1];
  expect(meta('title')?.includes('FCFA'), 'og:title sans prix');
  const image = await get(meta('image') ?? '');
  expect(image.ok && image.headers.get('content-type')?.startsWith('image/'), 'photo illisible');
  return meta('title');
});

await check('Back-office : en ligne, jamais indexé', async () => {
  const res = await get(`${BO}/connexion`);
  if (res.status === 403) return 'filtré par adresse IP (BACKOFFICE_ALLOWED_IPS)';
  expect(res.ok, `${res.status}`);
  expect(res.headers.get('x-robots-tag')?.includes('noindex'), 'X-Robots-Tag absent');
});

await check('Stockage : aucun compartiment listable, pièces privées fermées', async () => {
  for (const bucket of ['zandu-public', 'zandu-private']) {
    const res = await get(`${MEDIA}/${bucket}/`);
    expect(res.status === 403, `${bucket} listable (${res.status})`);
  }
});

await check('SMS de test : fermés sans la clé de recette', async () => {
  const path = '/dev/messages?recipient=%2B242069000000';
  expect((await get(`${API}${path}`)).status === 401, 'boîte de réception ouverte');
  const page = await get(`${SITE}/recette/sms`);
  expect(page.status === 401, `page des SMS ouverte (${page.status})`);
  if (env.RECETTE_KEY) {
    const res = await get(`${API}${path}`, { headers: { 'x-recette-key': env.RECETTE_KEY } });
    expect(res.ok, `refusés avec la clé (${res.status})`);
  }
});

console.log(
  failures ? `\n${failures} contrôle(s) en échec.` : '\nRecette en ligne : tout est en ordre.',
);
process.exitCode = failures ? 1 : 0;
