/*
 * Zandu — site acheteurs utilisable quand le réseau coupe (ADR-0016).
 *
 * Pages : réseau d'abord ; sans réseau, la dernière version enregistrée, sinon la page
 * « hors connexion » (produits déjà vus, panier). Jamais de copie pour ce qui engage de
 * l'argent ou une identité : paiement, validation du panier, connexion, routes /api.
 * Les pages de suivi de commande (données personnelles) vont dans un cache à part, vidé dès
 * que le site voit l'acheteur déconnecté.
 * Fichiers de l'application (/_next/static, noms à empreinte), police des titres (/fonts) et
 * photos : cache d'abord.
 */
const VERSION = 'v1';
const PAGES = `zandu-pages-${VERSION}`;
const PRIVATE = 'zandu-prives';
const STATIC = 'zandu-fichiers';
const IMAGES = 'zandu-photos';
const OFFLINE = '/hors-ligne';
const LIMITS = { [PAGES]: 60, [PRIVATE]: 20, [STATIC]: 150, [IMAGES]: 80 };

const NEVER = [/^\/paiement\//, /^\/commande(\/|$)/, /^\/connexion/, /^\/api\//, /^\/recette\//];
const PRIVATE_PAGES = /^\/commandes(\/|$)/;

self.addEventListener('install', (event) => {
  // La page « hors connexion » et ses scripts sont enregistrés d'avance.
  event.waitUntil(
    (async () => {
      const request = new Request(OFFLINE, { cache: 'reload' });
      const response = await fetch(request);
      await (await caches.open(PAGES)).put(request, response.clone());
      await keepAssets(response);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('zandu-pages-') && k !== PAGES)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Garde les N entrées les plus récentes d'un cache (ordre d'insertion). */
async function trim(name) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  const extra = keys.length - LIMITS[name];
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}

async function put(name, request, response) {
  try {
    const cache = await caches.open(name);
    await cache.delete(request); // remise en fin de liste : la plus récente
    await cache.put(request, response);
    await trim(name);
  } catch {
    // Stockage plein ou réponse impossible à garder : la page s'affiche quand même.
  }
}

/**
 * Page enregistrée sans avoir été affichée en entier (lien du site) : ses scripts et styles
 * n'ont peut-être jamais été téléchargés ; sans eux, elle ne s'ouvrirait pas hors connexion.
 */
async function keepAssets(response) {
  const html = await response.text();
  const assets = new Set(html.match(/\/_next\/static\/[^"'\\\s)]+/g) ?? []);
  const cache = await caches.open(STATIC);
  for (const path of assets) {
    if (await cache.match(path)) continue;
    try {
      const asset = await fetch(path);
      if (asset.ok) await put(STATIC, new Request(path), asset);
    } catch {
      return; // réseau perdu : ce sera pour la prochaine fois
    }
  }
}

/** Fenêtres affichant une copie enregistrée : leur état « déconnecté » peut être périmé. */
const fromCache = new Set();

async function page(request, url, remember, clientId) {
  const store = PRIVATE_PAGES.test(url.pathname) ? PRIVATE : PAGES;
  try {
    const response = await fetch(request);
    // Seules les vraies pages réussies sont gardées (pas une redirection vers la connexion).
    const html = (response.headers.get('content-type') ?? '').includes('text/html');
    if (response.ok && html && !response.redirected && response.type === 'basic') {
      await put(store, request, response.clone());
      if (remember) await keepAssets(response.clone());
    }
    return response;
  } catch {
    if (clientId) fromCache.add(clientId);
    const saved = await caches.match(request, { ignoreVary: true });
    if (saved) return saved;
    return (await caches.match(OFFLINE)) ?? Response.error();
  }
}

async function cacheFirst(name, request) {
  const saved = await caches.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  // Photos d'un autre domaine (stockage S3) : réponses opaques, gardées telles quelles.
  if (response.ok || response.type === 'opaque') await put(name, request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // Page ouverte par un lien du site (sans recharger) : le site redemande son HTML pour qu'elle
  // soit enregistrée, avec ses cookies (la requête vient de la page, pas du service worker).
  const remember = request.headers.get('x-zandu-remember') === '1';
  if (request.mode === 'navigate' || remember) {
    if (!sameOrigin) return;
    if (NEVER.some((r) => r.test(url.pathname))) {
      // Argent ou identité : toujours le réseau, jamais de copie ; sans réseau, la page d'aide.
      if (request.mode === 'navigate')
        event.respondWith(fetch(request).catch(() => caches.match(OFFLINE)));
      return;
    }
    event.respondWith(page(request, url, remember, event.resultingClientId));
    return;
  }
  if (
    sameOrigin &&
    (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/fonts/'))
  ) {
    event.respondWith(cacheFirst(STATIC, request));
    return;
  }
  if (request.destination === 'image') {
    event.respondWith(cacheFirst(IMAGES, request).catch(() => Response.error()));
  }
});

/**
 * Déconnexion : le site demande d'oublier les pages personnelles. Une demande venant d'une
 * copie enregistrée avant la connexion est ignorée : elle ne dit rien de la session actuelle.
 */
self.addEventListener('message', (event) => {
  if (event.data !== 'forget-private') return;
  if (event.source && fromCache.has(event.source.id)) return;
  event.waitUntil(caches.delete(PRIVATE));
});
