import { DemoApi, DEMO_RIDER_PHONE, type EngineDeps } from './engine.js';
import { CATEGORY_BY_SLUG, LUMUMBA, TIE_TIE } from './reference.js';
import type { DemoState, DShop, DUser } from './state.js';

/**
 * Données de départ de la démonstration : les trois boutiques et douze produits de
 * db/seeds/demo, un acheteur, un livreur, et quelques commandes déjà passées pour que chaque
 * espace ait quelque chose à montrer dès l'ouverture.
 */
export const DEMO_ACCOUNTS = {
  buyer: {
    phone: '+242066123498',
    name: 'Prisca Nkounkou',
    label: 'acheteuse',
    detail: 'Prisca Nkounkou',
  },
  seller: {
    phone: '+242061000001',
    name: 'Grâce Mabiala',
    label: 'vendeuse',
    detail: 'Grâce Mabiala · Mama Grâce Électro',
  },
  rider: {
    phone: DEMO_RIDER_PHONE,
    name: 'Junior Mavoungou',
    label: 'livreur',
    detail: 'Junior Mavoungou · Coursiers Ponténégrins',
  },
} as const;

const SHOPS = [
  {
    key: 'electro',
    phone: '+242061000001',
    owner: 'Grâce Mabiala',
    name: 'Mama Grâce Électro',
    operator: 'mtn',
    categories: ['telephones', 'informatique', 'maison'],
  },
  {
    key: 'pagnes',
    phone: '+242061000002',
    owner: 'Mireille Loemba',
    name: 'Pagnes & Style de Tié-Tié',
    operator: 'mtn',
    categories: ['mode', 'beaute'],
  },
  {
    key: 'saveurs',
    phone: '+242051000003',
    owner: 'Albert Mbemba',
    name: 'Saveurs du Kouilou',
    operator: 'airtel',
    categories: ['alimentation'],
  },
] as const;

const PRODUCTS: Array<
  [
    slug: string,
    shop: string,
    category: string,
    title: string,
    price: number,
    stock: number,
    description: string,
  ]
> = [
  [
    'samsung-galaxy-a15',
    'electro',
    'telephones',
    'Téléphone Samsung Galaxy A15 128 Go',
    95000,
    8,
    'Écran 6,5 pouces, double SIM, batterie 5 000 mAh. Garantie vendeur 6 mois. Livré avec chargeur.',
  ],
  [
    'ecouteurs-bluetooth',
    'electro',
    'telephones',
    'Écouteurs Bluetooth sans fil',
    12500,
    25,
    'Autonomie 20 h avec le boîtier, réduction de bruit, compatibles Android et iPhone.',
  ],
  [
    'ventilateur-16',
    'electro',
    'maison',
    'Ventilateur sur pied 16 pouces',
    35000,
    12,
    '3 vitesses, oscillation, silencieux. Idéal pour la saison sèche.',
  ],
  [
    'ordinateur-hp-15',
    'electro',
    'informatique',
    'Ordinateur portable HP 15 pouces reconditionné',
    185000,
    3,
    'Core i5, 8 Go de RAM, SSD 256 Go, Windows 11. Testé et garanti 3 mois.',
  ],
  [
    'fer-a-repasser',
    'electro',
    'maison',
    'Fer à repasser vapeur',
    18000,
    10,
    'Semelle céramique, réservoir 300 ml, arrêt automatique.',
  ],
  [
    'pagne-wax',
    'pagnes',
    'mode',
    'Pagne wax 6 yards',
    12000,
    40,
    'Coton 100 %, motifs vifs, 6 yards. Plusieurs modèles disponibles en boutique.',
  ],
  [
    'robe-wax',
    'pagnes',
    'mode',
    'Robe en wax sur mesure',
    25000,
    6,
    'Cousue à vos mesures en 5 jours. Indiquez vos mesures dans la discussion.',
  ],
  [
    'sac-raphia',
    'pagnes',
    'mode',
    'Sac en raphia tressé main',
    15000,
    9,
    'Fabriqué à la main par des artisanes de Pointe-Noire. Doublure en wax.',
  ],
  [
    'sandales-cuir',
    'pagnes',
    'mode',
    'Sandales en cuir artisanales',
    9000,
    15,
    'Cuir véritable, semelle résistante. Pointures 36 à 45.',
  ],
  [
    'beurre-karite',
    'pagnes',
    'beaute',
    'Beurre de karité pur 500 g',
    4500,
    30,
    'Non raffiné, pour la peau et les cheveux.',
  ],
  [
    'cafe-congo',
    'saveurs',
    'alimentation',
    'Café du Congo moulu 500 g',
    6000,
    20,
    'Torréfié localement, mouture moyenne pour cafetière.',
  ],
  [
    'miel-foret',
    'saveurs',
    'alimentation',
    'Miel de forêt 1 L',
    8000,
    14,
    'Miel naturel récolté dans le Mayombe.',
  ],
];

export function emptyState(): DemoState {
  return {
    version: 1,
    users: [],
    sessions: {},
    challenges: [],
    messages: [],
    notifications: [],
    shops: [],
    products: [],
    reviews: [],
    checkouts: [],
    payments: [],
    orders: [],
    payouts: [],
    uploads: {},
  };
}

/** Construit la démonstration au temps `deps.now()`, avec un historique des derniers jours. */
export function createDemoState(deps: EngineDeps): DemoState {
  const real = deps.now;
  let offset = -4 * 86_400_000;
  const clock: EngineDeps = { ...deps, now: () => new Date(real().getTime() + offset) };
  const advance = (minutes: number) => {
    offset += minutes * 60_000;
  };
  const state = emptyState();
  const api = new DemoApi(state, clock);

  const user = (phone: string, fullName: string, roles: DUser['roles']): DUser => {
    const u: DUser = { id: deps.newId(), phone, fullName, roles, notificationsSeenAt: null };
    state.users.push(u);
    return u;
  };
  user(DEMO_ACCOUNTS.buyer.phone, DEMO_ACCOUNTS.buyer.name, ['buyer']);
  user(DEMO_ACCOUNTS.rider.phone, DEMO_ACCOUNTS.rider.name, ['buyer', 'rider']);
  const shopIds: Record<string, string> = {};
  for (const s of SHOPS) {
    const owner = user(s.phone, s.owner, ['buyer', 'seller']);
    const shop: DShop = {
      id: deps.newId(),
      userId: owner.id,
      shopName: s.name,
      slug: `demo-${s.key}`,
      kind: 'individual',
      city: 'Pointe-Noire',
      pickupZoneId: LUMUMBA,
      payoutPhone: s.phone,
      payoutOperator: s.operator,
      payoutAccountName: s.owner,
      verificationStatus: 'verified',
      isOpen: true,
      defaultPrepMinutes: 60,
      openingHours: 'Lun-Sam 8h-19h',
      weeklyHours: [null, ...Array.from({ length: 6 }, () => ({ open: '08:00', close: '19:00' }))],
      soldCategoryIds: s.categories.map((c) => CATEGORY_BY_SLUG[c]!),
      termsAccepted: true,
      kycDocuments: [],
    };
    state.shops.push(shop);
    shopIds[s.key] = shop.id;
  }
  const productIds: Record<string, string> = {};
  PRODUCTS.forEach(([slug, shop, category, title, price, stock, description], index) => {
    const id = deps.newId();
    productIds[slug] = id;
    const at = new Date(
      clock.now().getTime() - (PRODUCTS.length - index) * 3_600_000,
    ).toISOString();
    state.products.push({
      id,
      sellerId: shopIds[shop]!,
      categoryId: CATEGORY_BY_SLUG[category]!,
      title,
      description,
      price,
      stock,
      condition: slug === 'ordinateur-hp-15' ? 'refurbished' : 'new',
      lowStockThreshold: 3,
      status: 'published',
      city: 'Pointe-Noire',
      // Référence à la photo intégrée : l'état enregistré sur le téléphone reste léger.
      photos: [{ id: deps.newId(), url: `demo-photo:${slug}` }],
      createdAt: at,
      updatedAt: at,
    });
  });

  const home = (recipientName: string, phone: string) => ({
    mode: 'home',
    zoneId: TIE_TIE,
    recipientName,
    phone,
    landmark: "Tié-Tié, derrière l'école Saint-Pierre, portail bleu",
    location: { lat: -4.7612, lng: 11.8735, accuracy: 20 },
  });
  const buyer = DEMO_ACCOUNTS.buyer;
  const seller = state.users.find((u) => u.phone === DEMO_ACCOUNTS.seller.phone)!;
  const sellerToken = api.signIn(seller);
  const pagnes = state.users.find((u) => u.phone === '+242061000002')!;
  const pagnesToken = api.signIn(pagnes);
  const rider = state.users.find((u) => u.phone === DEMO_ACCOUNTS.rider.phone)!;
  const riderToken = api.signIn(rider);
  const call = (token: string, method: string, path: string, body: unknown = null) => {
    const res = api.handle({ method, path, query: new URLSearchParams(), token, body });
    if (res.status >= 400) throw new Error(`${method} ${path} : ${JSON.stringify(res.body)}`);
    return res.body as Record<string, unknown>;
  };
  /** Une commande menée jusqu'à la remise, par le vendeur et le livreur de démonstration. */
  const deliver = (orderId: string, token: string) => {
    call(token, 'POST', `/v1/seller/orders/${orderId}/accept`, { readyInMinutes: 30 });
    advance(35);
    call(token, 'POST', `/v1/seller/orders/${orderId}/ready`);
    advance(20);
    const mission = call(riderToken, 'GET', `/v1/rider/deliveries/${orderId}`);
    call(token, 'POST', `/v1/seller/orders/${orderId}/rider-pickup`, { code: mission.pickupCode });
    call(riderToken, 'POST', `/v1/rider/deliveries/${orderId}/pickup`);
    advance(25);
    const order = state.orders.find((o) => o.id === orderId)!;
    call(riderToken, 'POST', `/v1/rider/deliveries/${orderId}/handover`, {
      code: order.handoverCode,
    });
  };

  // Il y a quatre jours : un pagne, livré, confirmé et noté.
  const pagne = api.placeOrder(
    buyer.phone,
    [{ productId: productIds['pagne-wax']!, quantity: 2 }],
    home(buyer.name, buyer.phone),
  );
  advance(10);
  deliver(pagne, pagnesToken);
  advance(60);
  call(
    api.signIn(state.users.find((u) => u.phone === buyer.phone)!),
    'POST',
    `/v1/orders/${pagne}/confirm-receipt`,
  );
  const pagneOrder = state.orders.find((o) => o.id === pagne)!;
  call(
    api.signIn(state.users.find((u) => u.phone === buyer.phone)!),
    'POST',
    `/v1/order-items/${pagneOrder.items[0]!.itemId}/review`,
    {
      rating: 5,
      comment: 'Tissu de belle qualité, couleurs comme sur la photo. Livré à l’heure.',
      tags: ['conforme', 'livreur_ponctuel'],
    },
  );

  // Il y a deux jours : des écouteurs et un ventilateur, livrés et terminés (vente de Mama Grâce).
  advance(2 * 24 * 60);
  const autre = user('+242055443322', 'Christelle Ngoma', ['buyer']);
  const ecouteurs = api.placeOrder(
    autre.phone,
    [{ productId: productIds['ecouteurs-bluetooth']!, quantity: 1 }],
    home(autre.fullName!, autre.phone),
  );
  deliver(ecouteurs, sellerToken);
  advance(30);
  call(api.signIn(autre), 'POST', `/v1/orders/${ecouteurs}/confirm-receipt`);
  const ecouteursOrder = state.orders.find((o) => o.id === ecouteurs)!;
  call(api.signIn(autre), 'POST', `/v1/order-items/${ecouteursOrder.items[0]!.itemId}/review`, {
    rating: 4,
    comment: 'Bon son, la batterie tient bien.',
    tags: ['conforme'],
  });

  // Ce matin chez Mama Grâce : un ventilateur prêt, que le livreur doit venir chercher, et un
  // téléphone payé par Prisca, à accepter.
  offset = -3 * 3_600_000;
  const ventilo = api.placeOrder(
    autre.phone,
    [{ productId: productIds['ventilateur-16']!, quantity: 1 }],
    home(autre.fullName!, autre.phone),
  );
  advance(15);
  call(sellerToken, 'POST', `/v1/seller/orders/${ventilo}/accept`, { readyInMinutes: 60 });
  advance(55);
  call(sellerToken, 'POST', `/v1/seller/orders/${ventilo}/ready`);
  advance(90);
  api.placeOrder(
    buyer.phone,
    [{ productId: productIds['samsung-galaxy-a15']!, quantity: 1 }],
    home(buyer.name, buyer.phone),
  );

  // Les sessions ouvertes pour construire l'historique ne servent plus.
  state.sessions = {};
  state.messages = [];
  return state;
}
