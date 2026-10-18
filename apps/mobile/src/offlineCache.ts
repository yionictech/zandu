import { dehydrate, hydrate, type Query, type QueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

/**
 * Données déjà affichées gardées sur le téléphone (ADR-0017) : catalogue, fiches, achats,
 * missions et espace vendeur restent lisibles sans réseau, même après avoir fermé l'application.
 * Jamais de copie de ce qui engage de l'argent en cours (panier validé, paiement) : ces écrans
 * redemandent toujours l'API. Les données personnelles sont liées au compte et effacées à la
 * déconnexion ; une copie de plus de 7 jours n'est pas reprise.
 */
const CACHE_KEY = 'zandu.cache.v1';
const MAX_AGE_MS = 7 * 24 * 3_600_000;
/** Fiches produit gardées (les plus récentes) : AsyncStorage sur Android est limité à quelques Mo. */
const MAX_PRODUCTS = 40;
const SAVE_DELAY_MS = 1_000;

/** Données du catalogue, valables quel que soit le compte. */
const PUBLIC = new Set(['categories', 'products', 'product', 'zones']);
/** Données d'un compte : achats, missions, espace vendeur. */
const PERSONAL = new Set(['orders', 'order', 'rider', 'seller']);

interface Saved {
  userId: string | null;
  savedAt: number;
  state: ReturnType<typeof dehydrate>;
}

const root = (query: Query) => String(query.queryKey[0]);
const isSearch = (query: Query) => root(query) === 'products' && query.queryKey[1] === 'search';

function keep(query: Query, userId: string | null): boolean {
  if (query.state.status !== 'success' || isSearch(query)) return false;
  return PUBLIC.has(root(query)) || (userId !== null && PERSONAL.has(root(query)));
}

/** Au démarrage, une fois le compte connu : reprend la copie enregistrée. */
export async function restoreCache(client: QueryClient, userId: string | null): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Saved;
    if (Date.now() - saved.savedAt > MAX_AGE_MS) return;
    const sameAccount = saved.userId === userId;
    hydrate(client, {
      ...saved.state,
      queries: saved.state.queries.filter(
        (q) => PUBLIC.has(String(q.queryKey[0])) || (sameAccount && userId !== null),
      ),
    });
  } catch {
    // Copie illisible : l'application recharge simplement depuis l'API.
  }
}

/** Enregistre la copie peu après chaque changement ; renvoie de quoi arrêter. */
export function persistCache(client: QueryClient, userId: string | null): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    timer = null;
    const products = client
      .getQueryCache()
      .findAll({ queryKey: ['product'] })
      .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
      .slice(0, MAX_PRODUCTS);
    const state = dehydrate(client, {
      shouldDehydrateQuery: (q) =>
        keep(q, userId) && (root(q) !== 'product' || products.includes(q)),
      shouldDehydrateMutation: () => false,
    });
    const saved: Saved = { userId, savedAt: Date.now(), state };
    AsyncStorage.setItem(CACHE_KEY, JSON.stringify(saved)).catch(() => undefined);
  };
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    if (!timer) timer = setTimeout(save, SAVE_DELAY_MS);
  });
  // Application mise en arrière-plan (puis peut-être fermée) : enregistrée tout de suite.
  const background = AppState.addEventListener('change', (next) => {
    if (next !== 'active' && timer) {
      clearTimeout(timer);
      save();
    }
  });
  return () => {
    unsubscribe();
    background.remove();
    if (timer) clearTimeout(timer);
  };
}

/** Déconnexion : plus rien du compte ne reste sur le téléphone. */
export async function forgetCache(): Promise<void> {
  await AsyncStorage.removeItem(CACHE_KEY).catch(() => undefined);
}
