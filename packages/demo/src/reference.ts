/**
 * Données de référence de la démonstration : les mêmes que db/seeds/reference.sql (catégories,
 * quartiers, points relais, tarifs de livraison, commissions), pour que les montants affichés
 * soient ceux de la vraie plateforme.
 */
export const CATEGORIES = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    parentId: null,
    slug: 'electronique',
    name: 'Électronique',
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    parentId: '10000000-0000-4000-8000-000000000001',
    slug: 'telephones',
    name: 'Téléphones et accessoires',
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    parentId: '10000000-0000-4000-8000-000000000001',
    slug: 'informatique',
    name: 'Informatique',
  },
  { id: '10000000-0000-4000-8000-000000000004', parentId: null, slug: 'mode', name: 'Mode' },
  {
    id: '10000000-0000-4000-8000-000000000005',
    parentId: null,
    slug: 'beaute',
    name: 'Beauté et soins',
  },
  {
    id: '10000000-0000-4000-8000-000000000006',
    parentId: null,
    slug: 'maison',
    name: 'Maison et électroménager',
  },
  {
    id: '10000000-0000-4000-8000-000000000007',
    parentId: null,
    slug: 'alimentation',
    name: 'Alimentation et produits locaux',
  },
] as const;

export const CATEGORY_BY_SLUG: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.slug, c.id]),
);

/** Commission : 10 % par défaut, 8 % électronique, 12 % mode et beauté (en points de base). */
const RATES: Record<string, number> = {
  '10000000-0000-4000-8000-000000000001': 800,
  '10000000-0000-4000-8000-000000000004': 1200,
  '10000000-0000-4000-8000-000000000005': 1200,
};
export const DEFAULT_RATE_BPS = 1000;

/** Taux de la catégorie, sinon de sa catégorie parente, sinon le taux par défaut. */
export function commissionRateBps(categoryId: string): number {
  const category = CATEGORIES.find((c) => c.id === categoryId);
  return (
    RATES[categoryId] ??
    (category?.parentId ? RATES[category.parentId] : undefined) ??
    DEFAULT_RATE_BPS
  );
}

export const ZONES = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    city: 'Pointe-Noire',
    name: 'Lumumba (Centre-ville)',
  },
  { id: '20000000-0000-4000-8000-000000000002', city: 'Pointe-Noire', name: 'Mvoumvou' },
  { id: '20000000-0000-4000-8000-000000000003', city: 'Pointe-Noire', name: 'Tié-Tié' },
  { id: '20000000-0000-4000-8000-000000000004', city: 'Pointe-Noire', name: 'Loandjili' },
  { id: '20000000-0000-4000-8000-000000000005', city: 'Pointe-Noire', name: 'Mongo-Mpoukou' },
  { id: '20000000-0000-4000-8000-000000000006', city: 'Pointe-Noire', name: 'Ngoyo' },
  { id: '20000000-0000-4000-8000-000000000011', city: 'Brazzaville', name: 'Makélékélé' },
  { id: '20000000-0000-4000-8000-000000000012', city: 'Brazzaville', name: 'Bacongo' },
  { id: '20000000-0000-4000-8000-000000000013', city: 'Brazzaville', name: 'Poto-Poto' },
  { id: '20000000-0000-4000-8000-000000000014', city: 'Brazzaville', name: 'Moungali' },
  { id: '20000000-0000-4000-8000-000000000015', city: 'Brazzaville', name: 'Ouenzé' },
  { id: '20000000-0000-4000-8000-000000000016', city: 'Brazzaville', name: 'Talangaï' },
] as const;

export const LUMUMBA = '20000000-0000-4000-8000-000000000001';
export const TIE_TIE = '20000000-0000-4000-8000-000000000003';

export const PICKUP_POINTS = [
  {
    id: '30000000-0000-4000-8000-000000000001',
    zoneId: LUMUMBA,
    name: 'Relais Centre-ville',
    landmark: 'Avenue Charles de Gaulle, face au marché central',
    lat: -4.7795,
    lng: 11.8641,
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    zoneId: TIE_TIE,
    name: 'Relais Tié-Tié',
    landmark: 'Rond-point Tié-Tié, boutique à côté de la pharmacie',
    lat: -4.7612,
    lng: 11.8735,
  },
] as const;

/**
 * Tarif de livraison d'une boutique vers un quartier : 1 000 FCFA dans le même quartier, 1 500
 * ailleurs dans la ville, 700 en point relais ; la part du livreur est d'environ 87 %.
 * `null` : pas de livraison d'une ville à l'autre.
 */
export function deliveryRate(
  fromZoneId: string,
  toZoneId: string,
  mode: 'home' | 'pickup_point',
): { price: number; courierShare: number } | null {
  const from = ZONES.find((z) => z.id === fromZoneId);
  const to = ZONES.find((z) => z.id === toZoneId);
  if (!from || !to || from.city !== to.city) return null;
  if (mode === 'pickup_point') return { price: 700, courierShare: 600 };
  return from.id === to.id
    ? { price: 1000, courierShare: 870 }
    : { price: 1500, courierShare: 1300 };
}

export const COURIER_PARTNER = { name: 'Coursiers Ponténégrins (pilote)', phone: '+242061000000' };
