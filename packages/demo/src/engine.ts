import type { components, paths } from '@zandu/api-client';
import {
  arrivalMinutes,
  distanceMeters,
  isInCongo,
  lineCommission,
  parseCongoMobile,
} from '@zandu/domain';
import {
  CATEGORIES,
  commissionRateBps,
  COURIER_PARTNER,
  deliveryRate,
  PICKUP_POINTS,
  ZONES,
} from './reference.js';
import { DEMO_PHOTOS } from './photos.js';
import type { DCheckout, DemoState, DOrder, DProduct, DShop, DUser, OrderStatus } from './state.js';

/**
 * API de démonstration (docs/exploitation/demo-locale.md) : répond aux mêmes routes que l'API
 * Zandu, avec les mêmes formes de réponse, mais sur des données fictives gardées dans le
 * téléphone. Elle reprend les règles visibles du parcours (commission, frais de livraison, codes
 * de retrait et de remise, séquestre) sans serveur, base ni Mobile Money.
 *
 * Simplifications assumées : le support n'existe pas (la course est confiée d'office au livreur
 * de démonstration quand la commande est prête), le code de paiement Mobile Money est validé tout
 * seul au bout de quelques secondes, et les pièces d'identité sont acceptées d'office.
 */
type S = components['schemas'];
type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
/** Corps de réponse JSON d'une route, tel que le contrat le décrit. */
type Ok<P extends keyof paths, M extends Method, C extends number = 200> = paths[P][M] extends {
  responses: infer R;
}
  ? C extends keyof R
    ? R[C] extends { content: { 'application/json': infer T } }
      ? T
      : never
    : never
  : never;

export interface EngineDeps {
  now(): Date;
  newId(): string;
  random(): number;
}

export interface DemoRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  token: string | null;
  body: unknown;
}

export interface DemoResponse {
  status: number;
  body: unknown;
}

export class DemoError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const notFound = (what: string) => new DemoError(404, 'not_found', `${what} introuvable`);
const conflict = (code: string, message: string) => new DemoError(409, code, message);

/** Délai avant que le « PIN Mobile Money » de démonstration soit validé tout seul. */
export const AUTO_PIN_MS = 5_000;
const PAYMENT_TTL_MS = 10 * 60_000;
const ACCEPT_HOURS = 24;
const DISPUTE_WINDOW_HOURS = 48;
const ABSENT_WAIT_MINUTES = 10;
const HANDOVER_MAX_ATTEMPTS = 5;
/** Le livreur de démonstration, à qui les courses sont confiées. */
export const DEMO_RIDER_PHONE = '+242068000000';
const ESCROW: OrderStatus[] = [
  'paid',
  'preparing',
  'ready_for_pickup',
  'in_delivery',
  'awaiting_collection',
  'delivered',
  'disputed',
];

type Handler = (r: Ctx) => unknown;
interface Ctx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
  token: string | null;
  user(): DUser;
}

export class DemoApi {
  private readonly routes: Array<{
    method: string;
    pattern: RegExp;
    keys: string[];
    run: Handler;
    status: number;
  }> = [];

  constructor(
    public state: DemoState,
    private readonly deps: EngineDeps,
  ) {
    this.register();
  }

  // ---------------------------------------------------------------- outils

  private now(): Date {
    return this.deps.now();
  }
  private iso(offsetMs = 0): string {
    return new Date(this.now().getTime() + offsetMs).toISOString();
  }
  private digits(n: number): string {
    let out = '';
    for (let i = 0; i < n; i++) out += Math.floor(this.deps.random() * 10);
    return out;
  }
  private publicRef(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = 'ZD-';
    for (let i = 0; i < 8; i++) out += alphabet[Math.floor(this.deps.random() * alphabet.length)];
    return out;
  }

  private on(method: string, path: string, run: Handler, status = 200): void {
    const keys: string[] = [];
    const pattern = new RegExp(
      `^${path.replace(/\{(\w+)\}/g, (_m, key: string) => {
        keys.push(key);
        return '([^/]+)';
      })}$`,
    );
    this.routes.push({ method, pattern, keys, run, status });
  }

  /** Traite une requête comme le ferait l'API : réponse JSON ou erreur au format du contrat. */
  handle(request: DemoRequest): DemoResponse {
    this.tick();
    const route = this.routes.find(
      (r) => r.method === request.method.toUpperCase() && r.pattern.test(request.path),
    );
    if (!route)
      return error(
        new DemoError(404, 'not_found', `Pas disponible en démonstration : ${request.path}`),
      );
    const match = route.pattern.exec(request.path)!;
    const params = Object.fromEntries(
      route.keys.map((k, i) => [k, decodeURIComponent(match[i + 1]!)]),
    );
    const ctx: Ctx = {
      params,
      query: request.query,
      body: (request.body ?? {}) as Record<string, unknown>,
      token: request.token,
      user: () => {
        const userId = request.token ? this.state.sessions[request.token] : undefined;
        const user = this.state.users.find((u) => u.id === userId);
        if (!user) throw new DemoError(401, 'unauthorized', 'Connectez-vous pour continuer');
        return user;
      },
    };
    try {
      const body = route.run(ctx);
      return {
        status: body === undefined && route.status === 200 ? 204 : route.status,
        body: body ?? null,
      };
    } catch (e) {
      if (e instanceof DemoError) return error(e);
      if (e instanceof Error && 'code' in e)
        return error(new DemoError(422, String((e as { code: unknown }).code), e.message));
      throw e;
    }
  }

  // ------------------------------------------------------- temps qui passe

  /**
   * Ce qu'un vrai serveur ferait en arrière-plan, rattrapé à chaque appel : validation du PIN de
   * démonstration, paiements expirés, fin du délai de réclamation, vérification des pièces.
   */
  tick(): void {
    const now = this.now().getTime();
    for (const p of this.state.payments) {
      if (p.status !== 'pending') continue;
      if (now - Date.parse(p.createdAt) >= AUTO_PIN_MS) this.paymentSucceeded(p.id);
      else if (now > Date.parse(p.expiresAt)) p.status = 'expired';
    }
    for (const o of this.state.orders) {
      if (o.status === 'paid' && o.sellerAcceptDeadline && now > Date.parse(o.sellerAcceptDeadline))
        this.cancel(o, 'seller_timeout', 'Le vendeur n’a pas accepté à temps', true);
      if (
        o.status === 'delivered' &&
        o.disputeWindowEndsAt &&
        now > Date.parse(o.disputeWindowEndsAt)
      )
        this.complete(o, 'dispute_window_elapsed');
    }
    for (const s of this.state.shops) {
      if (s.verificationStatus !== 'pending_review') continue;
      const last = s.kycDocuments.at(-1);
      if (last && now - Date.parse(last.createdAt) > 15_000) {
        s.verificationStatus = 'verified';
        for (const p of this.state.products)
          if (p.sellerId === s.id && p.status === 'pending_review') p.status = 'published';
      }
    }
  }

  // ---------------------------------------------------------- recherches

  private shopOf(user: DUser): DShop {
    const shop = this.state.shops.find((s) => s.userId === user.id);
    if (!shop) throw new DemoError(404, 'no_shop', "Vous n'avez pas encore de boutique");
    return shop;
  }
  private shop(id: string): DShop {
    return this.state.shops.find((s) => s.id === id)!;
  }
  private product(id: string): DProduct {
    const p = this.state.products.find((x) => x.id === id);
    if (!p) throw notFound('Produit');
    return p;
  }
  private userById(id: string): DUser | undefined {
    return this.state.users.find((u) => u.id === id);
  }
  private zone(id: string) {
    return ZONES.find((z) => z.id === id)!;
  }
  private userByPhone(phone: string, create = true): DUser {
    let user = this.state.users.find((u) => u.phone === phone);
    if (!user && create) {
      user = {
        id: this.deps.newId(),
        phone,
        fullName: null,
        roles: ['buyer'],
        notificationsSeenAt: null,
      };
      this.state.users.push(user);
    }
    return user!;
  }

  private notify(
    userId: string,
    template: string,
    title: string,
    body: string,
    url: string | null,
  ) {
    this.state.notifications.unshift({
      id: this.deps.newId(),
      userId,
      template,
      title,
      body,
      url,
      createdAt: this.iso(),
    });
  }
  private sms(recipient: string, template: string, variables: Record<string, string>) {
    this.state.messages.unshift({
      recipient,
      channel: 'sms',
      template,
      variables,
      sentAt: this.iso(),
    });
    this.state.messages.length = Math.min(this.state.messages.length, 60);
  }
  private moveTo(o: DOrder, status: OrderStatus, event: string) {
    o.status = status;
    o.history.push({ status, event, at: this.iso() });
  }

  // ------------------------------------------------------------- calculs

  private subtotal(o: DOrder): number {
    return o.items.reduce((n, i) => n + i.unitPrice * i.quantity, 0);
  }
  private commission(o: DOrder): number {
    return o.items.reduce((n, i) => n + i.commission, 0);
  }
  private sellerNet(o: DOrder): number {
    return this.subtotal(o) - this.commission(o);
  }
  private shopRating(shopId: string): { avg: number | null; count: number } {
    const reviews = this.state.reviews.filter((r) => r.sellerId === shopId);
    if (!reviews.length) return { avg: null, count: 0 };
    return {
      avg: round1(reviews.reduce((n, r) => n + r.rating, 0) / reviews.length),
      count: reviews.length,
    };
  }

  // --------------------------------------------------------------- vues

  private card(p: DProduct): S['ProductCard'] {
    const shop = this.shop(p.sellerId);
    const rating = this.shopRating(shop.id);
    return {
      id: p.id,
      condition: p.condition,
      title: p.title,
      price: p.price,
      compareAtPrice: null,
      stock: p.stock,
      city: p.city,
      categoryId: p.categoryId,
      coverImage: p.photos[0] ? photoUrl(p.photos[0].url) : null,
      seller: {
        id: shop.id,
        shopName: shop.shopName,
        slug: shop.slug,
        verified: shop.verificationStatus === 'verified',
        open: shop.isOpen,
        ratingAvg: rating.avg,
        ratingCount: rating.count,
      },
    };
  }

  private core(o: DOrder): S['OrderCore'] {
    const itemsSubtotal = this.subtotal(o);
    return {
      id: o.id,
      publicRef: o.publicRef,
      checkoutId: o.checkoutId,
      status: o.status,
      seller: { id: o.sellerId, shopName: this.shop(o.sellerId).shopName },
      items: o.items.map((i) => ({
        itemId: i.itemId,
        productId: i.productId,
        title: i.title,
        unitPrice: i.unitPrice,
        quantity: i.quantity,
        lineTotal: i.unitPrice * i.quantity,
        reviewed: i.reviewed,
      })),
      itemsSubtotal,
      deliveryFee: o.deliveryFee,
      total: itemsSubtotal + o.deliveryFee,
      refundedAmount: o.refundedAmount,
      currency: 'XAF',
      deliveryMode: o.deliveryMode,
      sellerAcceptDeadline: o.sellerAcceptDeadline,
      disputeWindowEndsAt: o.disputeWindowEndsAt,
      createdAt: o.createdAt,
      paidAt: o.paidAt,
      deliveredAt: o.deliveredAt,
      completedAt: o.completedAt,
      cancelledAt: o.cancelledAt,
      cancelReason: o.cancelReason,
    };
  }

  private orderView(o: DOrder): S['Order'] {
    return { ...this.core(o), shippingAddress: o.shippingAddress };
  }

  private sellerOrderView(o: DOrder): S['SellerOrder'] {
    const zone = this.zone(o.zoneId);
    return {
      ...this.core(o),
      readyPromisedAt: o.readyPromisedAt,
      commission: this.commission(o),
      sellerNet: this.sellerNet(o),
      destination: {
        city: zone.city,
        zone: zone.name,
        pickupPoint: PICKUP_POINTS.find((p) => p.id === o.pickupPointId)?.name ?? null,
      },
    };
  }

  private destinationPoint(o: DOrder): S['GeoPoint'] | null {
    if (o.pickupPointId) {
      const point = PICKUP_POINTS.find((p) => p.id === o.pickupPointId);
      return point ? { lat: point.lat, lng: point.lng } : null;
    }
    return o.shippingAddress.location ?? null;
  }

  private mission(o: DOrder): S['RiderMission'] {
    const d = o.delivery!;
    const shop = this.shop(o.sellerId);
    const seller = this.userById(shop.userId)!;
    const zone = this.zone(o.zoneId);
    const point = PICKUP_POINTS.find((p) => p.id === o.pickupPointId);
    return {
      orderId: o.id,
      status: d.status,
      orderStatus: o.status,
      publicRef: o.publicRef,
      deliveryMode: o.deliveryMode,
      recipient: o.shippingAddress,
      pickup: {
        shopName: shop.shopName,
        phone: seller.phone,
        city: shop.city,
        zone: this.zone(shop.pickupZoneId).name,
      },
      destination: {
        city: zone.city,
        zone: zone.name,
        location: this.destinationPoint(o),
        pickupPoint: point ? { name: point.name, landmark: point.landmark } : null,
      },
      itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
      handoverAttemptsLeft: Math.max(0, HANDOVER_MAX_ATTEMPTS - d.handoverAttempts),
      assignedAt: d.assignedAt,
      pickedUpAt: d.pickedUpAt,
      items: o.items.map((i) => ({ title: i.title, quantity: i.quantity })),
      pickupCode: d.status === 'assigned' ? d.pickupCode : null,
      pickupConfirmedAt: d.pickupConfirmedAt,
      arrivedAt: d.arrivedAt,
      absentAllowedAt: d.arrivedAt
        ? new Date(Date.parse(d.arrivedAt) + ABSENT_WAIT_MINUTES * 60_000).toISOString()
        : null,
      returnCode: d.status === 'returning' ? d.returnCode : null,
      returnConfirmedAt: d.returnConfirmedAt,
      deliveredAt: d.deliveredAt,
      returnedAt: d.returnedAt,
      failureReason: d.failureReason,
      contacts: d.contacts,
    };
  }

  private checkoutView(c: DCheckout): S['Checkout'] {
    const orders = c.orderIds.map((id) => this.state.orders.find((o) => o.id === id)!);
    const itemsTotal = orders.reduce((n, o) => n + this.subtotal(o), 0);
    const deliveryTotal = orders.reduce((n, o) => n + o.deliveryFee, 0);
    return {
      id: c.id,
      status: c.paidAt
        ? 'paid'
        : this.now().getTime() > Date.parse(c.expiresAt)
          ? 'expired'
          : 'awaiting_payment',
      itemsTotal,
      deliveryTotal,
      grandTotal: itemsTotal + deliveryTotal,
      currency: 'XAF',
      expiresAt: c.expiresAt,
      paidAt: c.paidAt,
      orders: orders.map((o) => this.orderView(o)),
    };
  }

  private paymentView(id: string): S['Payment'] {
    const p = this.state.payments.find((x) => x.id === id);
    if (!p) throw notFound('Paiement');
    return {
      id: p.id,
      checkoutId: p.checkoutId,
      status: p.status,
      operator: p.operator,
      msisdn: p.msisdn,
      amount: p.amount,
      currency: 'XAF',
      expiresAt: p.expiresAt,
      lateSuccess: false,
      failure:
        p.status === 'failed'
          ? { code: 'invalid_account', message: 'Compte Mobile Money introuvable pour ce numéro' }
          : p.status === 'expired'
            ? { code: 'expired', message: 'Délai de validation dépassé' }
            : null,
    };
  }

  private shopView(s: DShop): S['SellerShop'] {
    const rating = this.shopRating(s.id);
    return {
      id: s.id,
      shopName: s.shopName,
      slug: s.slug,
      kind: s.kind,
      city: s.city,
      pickupZoneId: s.pickupZoneId,
      pickupZoneName: this.zone(s.pickupZoneId).name,
      payoutPhone: s.payoutPhone,
      payoutOperator: s.payoutOperator,
      payoutAccountName: s.payoutAccountName,
      verificationStatus: s.verificationStatus,
      ratingAvg: rating.avg,
      ratingCount: rating.count,
      isOpen: s.isOpen,
      defaultPrepMinutes: s.defaultPrepMinutes,
      openingHours: s.openingHours,
      weeklyHours: s.weeklyHours,
      soldCategoryIds: s.soldCategoryIds,
      termsAccepted: s.termsAccepted,
    };
  }

  private kycView(s: DShop): Ok<'/v1/seller/kyc', 'get'> {
    const types = new Set(s.kycDocuments.map((d) => d.type));
    const missing: S['KycDocumentType'][] = [];
    if (!types.has('national_id') && !types.has('passport')) missing.push('national_id');
    if (!types.has('selfie')) missing.push('selfie');
    if (s.kind === 'business') {
      if (!types.has('rccm')) missing.push('rccm');
      if (!types.has('niu')) missing.push('niu');
    }
    return {
      verificationStatus: s.verificationStatus,
      rejectionReason: null,
      documents: s.kycDocuments.map((d) => ({
        id: d.id,
        type: d.type,
        status: s.verificationStatus === 'verified' ? 'accepted' : 'pending',
        createdAt: d.createdAt,
      })),
      missing,
    };
  }

  private sellerProductView(p: DProduct): S['SellerProduct'] {
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      price: p.price,
      stock: p.stock,
      status: p.status,
      categoryId: p.categoryId,
      condition: p.condition,
      lowStockThreshold: p.lowStockThreshold,
      rejectionReason: null,
      updatedAt: p.updatedAt,
      photos: this.photoList(p).photos,
    };
  }

  private photoList(p: DProduct): Ok<'/v1/seller/products/{id}/photos', 'post', 201> {
    return {
      photos: p.photos.map((ph, position) => ({ id: ph.id, position, url: photoUrl(ph.url) })),
    };
  }

  // ------------------------------------------------- cycle d'une commande

  private paymentSucceeded(paymentId: string): void {
    const payment = this.state.payments.find((p) => p.id === paymentId)!;
    const checkout = this.state.checkouts.find((c) => c.id === payment.checkoutId)!;
    payment.status = 'succeeded';
    if (checkout.paidAt) return;
    checkout.paidAt = this.iso();
    for (const id of checkout.orderIds) {
      const o = this.state.orders.find((x) => x.id === id)!;
      o.paidAt = this.iso();
      o.sellerAcceptDeadline = this.iso(ACCEPT_HOURS * 3_600_000);
      for (const item of o.items) {
        const p = this.state.products.find((x) => x.id === item.productId);
        if (p) p.stock = Math.max(0, p.stock - item.quantity);
      }
      this.moveTo(o, 'paid', 'payment_succeeded');
      const buyer = this.userById(o.buyerId)!;
      this.notify(
        buyer.id,
        'buyer_payment_confirmed',
        'Paiement reçu',
        `Votre paiement pour la commande ${o.publicRef} est bloqué en sécurité jusqu’à la livraison.`,
        `/commande/${o.id}`,
      );
      const shop = this.shop(o.sellerId);
      this.notify(
        shop.userId,
        'seller_new_order',
        'Nouvelle commande',
        `Commande ${o.publicRef} payée : acceptez-la avant 24 h.`,
        `/vendeur/commande/${o.id}`,
      );
    }
  }

  private cancel(o: DOrder, event: string, reason: string, refund: boolean): void {
    o.cancelledAt = this.iso();
    o.cancelReason = reason;
    for (const item of o.items) {
      const p = this.state.products.find((x) => x.id === item.productId);
      if (p) p.stock += item.quantity;
    }
    this.moveTo(o, 'cancelled', event);
    if (refund && o.paidAt) {
      o.refundedAmount = this.subtotal(o) + o.deliveryFee;
      this.moveTo(o, 'refunded', 'refund_succeeded');
      this.notify(
        o.buyerId,
        'buyer_refunded',
        'Remboursement envoyé',
        `Commande ${o.publicRef} : ${o.refundedAmount} FCFA renvoyés sur votre compte Mobile Money.`,
        `/commande/${o.id}`,
      );
    }
  }

  private complete(o: DOrder, event: string): void {
    o.completedAt = this.iso();
    this.moveTo(o, 'completed', event);
    const amount = this.sellerNet(o);
    this.state.payouts.unshift({
      id: this.deps.newId(),
      sellerId: o.sellerId,
      orderId: o.id,
      amount,
      createdAt: this.iso(),
    });
    const shop = this.shop(o.sellerId);
    this.notify(
      shop.userId,
      'seller_order_completed',
      'Argent crédité',
      `Commande ${o.publicRef} : ${amount} FCFA envoyés sur votre compte Mobile Money.`,
      `/vendeur/commande/${o.id}`,
    );
  }

  private sendHandoverCode(o: DOrder): void {
    o.handoverCode = this.digits(6);
    const buyer = this.userById(o.buyerId)!;
    this.sms(buyer.phone, 'buyer_handover_code', { code: o.handoverCode, ref: o.publicRef });
    this.notify(
      buyer.id,
      'buyer_handover_code',
      'Votre code de remise',
      `Code de remise de la commande ${o.publicRef} : ${o.handoverCode}. Donnez-le au livreur seulement quand vous avez le colis.`,
      `/commande/${o.id}`,
    );
  }

  private assignRider(o: DOrder): void {
    const rider = this.userByPhone(DEMO_RIDER_PHONE);
    o.delivery = {
      status: 'assigned',
      riderUserId: rider.id,
      pickupCode: this.digits(4),
      assignedAt: this.iso(),
      pickupConfirmedAt: null,
      pickedUpAt: null,
      arrivedAt: null,
      returnCode: null,
      returnConfirmedAt: null,
      returnedAt: null,
      deliveredAt: null,
      failureReason: null,
      handoverAttempts: 0,
      contacts: [],
      position: null,
    };
  }

  // --------------------------------------------------- appels internes

  /** Commande complète passée et payée, pour les données de départ et les tests. */
  placeOrder(
    buyerPhone: string,
    lines: Array<{ productId: string; quantity: number }>,
    delivery: Record<string, unknown>,
  ): string {
    const user = this.userByPhone(buyerPhone);
    const token = this.signIn(user);
    const checkout = this.handle({
      method: 'POST',
      path: '/v1/checkouts',
      query: new URLSearchParams(),
      token,
      body: { items: lines, delivery },
    });
    if (checkout.status !== 201) throw new Error(JSON.stringify(checkout.body));
    const c = checkout.body as S['Checkout'];
    const pay = this.handle({
      method: 'POST',
      path: `/v1/checkouts/${c.id}/payments`,
      query: new URLSearchParams(),
      token,
      body: { operator: 'mtn', phone: buyerPhone },
    });
    this.paymentSucceeded((pay.body as S['Payment']).id);
    return c.orders[0]!.id;
  }

  /** Ouvre une session sans code (sélecteur de rôle de la démonstration). */
  signIn(user: DUser): string {
    const token = `demo-${this.deps.newId()}`;
    this.state.sessions[token] = user.id;
    return token;
  }

  userView(user: DUser): S['User'] {
    return { id: user.id, phone: user.phone, fullName: user.fullName, roles: user.roles };
  }

  // ------------------------------------------------------------- routes

  private register(): void {
    this.on('GET', '/health', () => ({ status: 'ok' }));
    // Catalogue -----------------------------------------------------------
    this.on('GET', '/v1/categories', (): Ok<'/v1/categories', 'get'> =>
      CATEGORIES.map(({ id, parentId, slug, name }) => ({ id, parentId, slug, name })),
    );
    this.on('GET', '/v1/delivery/zones', (): Ok<'/v1/delivery/zones', 'get'> =>
      ZONES.map((z) => ({
        id: z.id,
        city: z.city,
        name: z.name,
        pickupPoints: PICKUP_POINTS.filter((p) => p.zoneId === z.id).map(
          ({ id, name, landmark }) => ({ id, name, landmark }),
        ),
      })),
    );
    this.on('GET', '/v1/products', ({ query }): Ok<'/v1/products', 'get'> => {
      const q = normalize(query.get('q') ?? '');
      const categoryId = query.get('categoryId');
      const city = query.get('city');
      const sellerId = query.get('sellerId');
      const min = Number(query.get('minPrice') ?? 0);
      const max = Number(query.get('maxPrice') ?? Infinity);
      const verified = query.get('verified') === 'true';
      let items = this.state.products.filter((p) => {
        const shop = this.shop(p.sellerId);
        const category = CATEGORIES.find((c) => c.id === p.categoryId);
        return (
          p.status === 'published' &&
          (!q || normalize(`${p.title} ${p.description} ${shop.shopName}`).includes(q)) &&
          (!categoryId || p.categoryId === categoryId || category?.parentId === categoryId) &&
          (!city || p.city === city) &&
          (!sellerId || p.sellerId === sellerId) &&
          p.price >= min &&
          p.price <= max &&
          (!verified || shop.verificationStatus === 'verified')
        );
      });
      const sort = query.get('sort') ?? 'relevance';
      items = [...items].sort((a, b) =>
        sort === 'price_asc'
          ? a.price - b.price
          : sort === 'price_desc'
            ? b.price - a.price
            : b.createdAt.localeCompare(a.createdAt),
      );
      const offset = Number(query.get('offset') ?? 0);
      const limit = Number(query.get('limit') ?? 20);
      return { items: items.slice(offset, offset + limit).map((p) => this.card(p)) };
    });
    this.on('GET', '/v1/products/{id}', ({ params }): Ok<'/v1/products/{id}', 'get'> => {
      const p = this.product(params.id!);
      if (p.status !== 'published') throw notFound('Produit');
      const reviews = this.state.reviews.filter((r) => r.productId === p.id);
      return {
        ...this.card(p),
        description: p.description,
        media: p.photos.map((ph) => ({ url: photoUrl(ph.url), width: 600, height: 600 })),
        shareImage: null,
        reviews: {
          average: reviews.length
            ? round1(reviews.reduce((n, r) => n + r.rating, 0) / reviews.length)
            : null,
          count: reviews.length,
        },
      };
    });
    this.on(
      'GET',
      '/v1/products/{id}/reviews',
      ({ params }): Ok<'/v1/products/{id}/reviews', 'get'> => ({
        items: this.state.reviews
          .filter((r) => r.productId === params.id)
          .map((r) => ({
            id: r.id,
            rating: r.rating,
            comment: r.comment,
            tags: r.tags,
            createdAt: r.createdAt,
            authorName: r.authorName,
            sellerReply: r.reply,
          })),
      }),
    );

    // Connexion -----------------------------------------------------------
    this.on(
      'POST',
      '/v1/auth/otp/request',
      ({ body }): Ok<'/v1/auth/otp/request', 'post', 202> => {
        const phone = parseCongoMobile(String(body.phone ?? '')).e164;
        const code = this.digits(6);
        const id = this.deps.newId();
        this.state.challenges.unshift({ id, phone, code, createdAt: this.iso() });
        this.state.challenges.length = Math.min(this.state.challenges.length, 20);
        this.sms(phone, 'otp_code', { code });
        return { challengeId: id, expiresInSeconds: 300, resendAfterSeconds: 60 };
      },
      202,
    );
    this.on('POST', '/v1/auth/otp/verify', ({ body }): Ok<'/v1/auth/otp/verify', 'post'> => {
      const challenge = this.state.challenges.find((c) => c.id === body.challengeId);
      if (!challenge || challenge.code !== body.code)
        throw new DemoError(401, 'otp_invalid', 'Code incorrect ou expiré');
      this.state.challenges = this.state.challenges.filter((c) => c.id !== challenge.id);
      const user = this.userByPhone(challenge.phone);
      return {
        token: this.signIn(user),
        expiresAt: this.iso(30 * 86_400_000),
        user: this.userView(user),
      };
    });
    this.on('POST', '/v1/auth/logout', ({ token }) => {
      if (token) delete this.state.sessions[token];
      return undefined;
    });
    this.on('GET', '/v1/me', ({ user }): Ok<'/v1/me', 'get'> => this.userView(user()));
    this.on('PUT', '/v1/me/devices', ({ user }) => (user(), undefined));
    this.on('POST', '/v1/devices/unregister', () => undefined);
    this.on('GET', '/v1/me/notifications', ({ user }): Ok<'/v1/me/notifications', 'get'> => {
      const me = user();
      const items = this.state.notifications
        .filter((n) => n.userId === me.id)
        .slice(0, 50)
        .map((n) => ({
          id: n.id,
          template: n.template,
          title: n.title,
          body: n.body,
          url: n.url,
          createdAt: n.createdAt,
          unread: !me.notificationsSeenAt || n.createdAt > me.notificationsSeenAt,
        }));
      return { items, unread: items.filter((i) => i.unread).length };
    });
    this.on('POST', '/v1/me/notifications/seen', ({ user }) => {
      user().notificationsSeenAt = this.iso();
      return undefined;
    });

    // Achat ---------------------------------------------------------------
    this.on(
      'POST',
      '/v1/checkouts',
      ({ user, body }): Ok<'/v1/checkouts', 'post', 201> => {
        const buyer = user();
        const lines = (body.items as Array<{ productId: string; quantity: number }>) ?? [];
        const d = (body.delivery ?? {}) as {
          mode: 'home' | 'pickup_point';
          zoneId: string;
          pickupPointId?: string;
          recipientName: string;
          phone: string;
          landmark: string;
          location?: S['GeoPoint'];
        };
        if (!lines.length) throw new DemoError(400, 'validation_error', 'Panier vide');
        const recipientPhone = parseCongoMobile(d.phone).e164;
        if (d.mode === 'home' && d.location && !isInCongo(d.location))
          throw new DemoError(
            422,
            'location_out_of_area',
            'Le repère sur la carte est hors du Congo',
          );
        if (
          d.mode === 'pickup_point' &&
          !PICKUP_POINTS.some((p) => p.id === d.pickupPointId && p.zoneId === d.zoneId)
        )
          throw new DemoError(
            422,
            'pickup_point_invalid',
            'Point relais introuvable dans ce quartier',
          );
        const bySeller = new Map<string, Array<{ product: DProduct; quantity: number }>>();
        for (const line of lines) {
          const product = this.product(line.productId);
          const shop = this.shop(product.sellerId);
          if (product.status !== 'published')
            throw conflict('product_unavailable', `« ${product.title} » n’est plus en vente`);
          if (!shop.isOpen) throw conflict('shop_closed', 'Cette boutique est en congé');
          if (shop.userId === buyer.id)
            throw conflict('own_product', 'Vous ne pouvez pas acheter vos propres produits');
          if (product.stock < line.quantity) throw conflict('out_of_stock', 'Stock insuffisant');
          bySeller.set(product.sellerId, [
            ...(bySeller.get(product.sellerId) ?? []),
            { product, quantity: line.quantity },
          ]);
        }
        const checkout: DCheckout = {
          id: this.deps.newId(),
          buyerId: buyer.id,
          orderIds: [],
          expiresAt: this.iso(PAYMENT_TTL_MS),
          paidAt: null,
          createdAt: this.iso(),
        };
        const address: S['ShippingAddress'] = {
          recipientName: d.recipientName.trim(),
          phone: recipientPhone,
          landmark: d.landmark.trim(),
          ...(d.mode === 'home' && d.location
            ? {
                location: {
                  lat: d.location.lat,
                  lng: d.location.lng,
                  ...(d.location.accuracy !== undefined
                    ? { accuracy: Math.round(d.location.accuracy) }
                    : {}),
                },
              }
            : {}),
        };
        const orders: DOrder[] = [];
        for (const [sellerId, sellerLines] of bySeller) {
          const shop = this.shop(sellerId);
          const rate = deliveryRate(shop.pickupZoneId, d.zoneId, d.mode);
          if (!rate)
            throw new DemoError(422, 'delivery_unavailable', 'Zone de livraison non desservie');
          orders.push({
            id: this.deps.newId(),
            publicRef: this.publicRef(),
            checkoutId: checkout.id,
            buyerId: buyer.id,
            sellerId,
            status: 'pending_payment',
            items: sellerLines.map(({ product, quantity }) => ({
              itemId: this.deps.newId(),
              productId: product.id,
              title: product.title,
              categoryId: product.categoryId,
              unitPrice: product.price,
              quantity,
              commission: lineCommission(
                product.price * quantity,
                commissionRateBps(product.categoryId),
              ),
              reviewed: false,
            })),
            deliveryFee: rate.price,
            courierShare: rate.courierShare,
            refundedAmount: 0,
            deliveryMode: d.mode,
            zoneId: d.zoneId,
            pickupPointId: d.mode === 'pickup_point' ? d.pickupPointId! : null,
            shippingAddress: address,
            handoverCode: '',
            sellerAcceptDeadline: null,
            readyPromisedAt: null,
            disputeWindowEndsAt: null,
            createdAt: this.iso(),
            paidAt: null,
            deliveredAt: null,
            completedAt: null,
            cancelledAt: null,
            cancelReason: null,
            history: [{ status: 'pending_payment', event: 'checkout_created', at: this.iso() }],
            delivery: null,
            dispute: null,
          });
        }
        checkout.orderIds = orders.map((o) => o.id);
        this.state.orders.unshift(...orders);
        this.state.checkouts.unshift(checkout);
        return this.checkoutView(checkout);
      },
      201,
    );
    this.on('GET', '/v1/checkouts/{id}', ({ user, params }): Ok<'/v1/checkouts/{id}', 'get'> => {
      const c = this.state.checkouts.find((x) => x.id === params.id && x.buyerId === user().id);
      if (!c) throw notFound('Commande');
      return this.checkoutView(c);
    });
    this.on(
      'POST',
      '/v1/checkouts/{id}/payments',
      ({ user, params, body }): Ok<'/v1/checkouts/{id}/payments', 'post', 201> => {
        const c = this.state.checkouts.find((x) => x.id === params.id && x.buyerId === user().id);
        if (!c) throw notFound('Commande');
        const view = this.checkoutView(c);
        if (view.status !== 'awaiting_payment')
          throw conflict('checkout_not_payable', 'Cette commande ne peut plus être payée');
        const pending = this.state.payments.find(
          (p) => p.checkoutId === c.id && p.status === 'pending',
        );
        if (pending)
          throw new DemoError(409, 'payment_in_progress', 'Un paiement est déjà en cours', {
            paymentId: pending.id,
          });
        const msisdn = parseCongoMobile(String(body.phone ?? '')).e164;
        const id = this.deps.newId();
        this.state.payments.unshift({
          id,
          checkoutId: c.id,
          operator: body.operator === 'airtel' ? 'airtel' : 'mtn',
          msisdn,
          amount: view.grandTotal,
          // Comme le simulateur de la recette : un numéro finissant par 99 est refusé.
          status: msisdn.endsWith('99') ? 'failed' : 'pending',
          createdAt: this.iso(),
          expiresAt: this.iso(PAYMENT_TTL_MS),
        });
        return this.paymentView(id);
      },
      201,
    );
    this.on(
      'GET',
      '/v1/payments/{id}',
      ({ user, params }): Ok<'/v1/payments/{id}', 'get'> => (user(), this.paymentView(params.id!)),
    );
    this.on('POST', '/dev/simulator/collections/{id}/{outcome}', ({ params }) => {
      const p = this.state.payments.find((x) => x.id === params.id);
      if (!p) throw notFound('Paiement');
      if (p.status === 'pending') {
        if (params.outcome === 'approve') this.paymentSucceeded(p.id);
        else p.status = 'failed';
      }
      return { ok: true };
    });
    this.on('GET', '/dev/messages', ({ query }) => ({
      items: this.state.messages.filter(
        (m) => !query.get('recipient') || m.recipient === query.get('recipient'),
      ),
    }));

    // Commandes de l'acheteur ---------------------------------------------
    const myOrder = (ctx: Ctx): DOrder => {
      const me = ctx.user();
      const o = this.state.orders.find((x) => x.id === ctx.params.id && x.buyerId === me.id);
      if (!o) throw notFound('Commande');
      return o;
    };
    this.on('GET', '/v1/orders', ({ user }): Ok<'/v1/orders', 'get'> => {
      const me = user();
      return {
        items: this.state.orders
          .filter((o) => o.buyerId === me.id && o.status !== 'pending_payment')
          .map((o) => this.orderView(o)),
      };
    });
    this.on('GET', '/v1/orders/{id}', (ctx): Ok<'/v1/orders/{id}', 'get'> => {
      const o = myOrder(ctx);
      return { ...this.orderView(o), history: o.history };
    });
    this.on('GET', '/v1/orders/{id}/tracking', (ctx): Ok<'/v1/orders/{id}/tracking', 'get'> => {
      const o = myOrder(ctx);
      const onTheWay = o.delivery?.status === 'picked_up';
      const rider = onTheWay ? this.userById(o.delivery!.riderUserId) : undefined;
      const p = o.delivery?.position;
      const fresh =
        onTheWay && p && this.now().getTime() - Date.parse(p.at) <= 10 * 60_000 ? p : null;
      const destination = this.destinationPoint(o);
      const dest = destination ? { lat: destination.lat, lng: destination.lng } : null;
      return {
        onTheWay,
        rider: rider
          ? { name: shortName(rider.fullName) ?? 'Livreur Zandu', phone: rider.phone }
          : null,
        position: fresh ?? null,
        destination: dest,
        distanceMeters: fresh && dest ? distanceMeters(fresh, dest) : null,
        etaMinutes: fresh && dest ? arrivalMinutes(fresh, dest) : null,
      };
    });
    this.on('POST', '/v1/orders/{id}/cancel', (ctx): Ok<'/v1/orders/{id}/cancel', 'post'> => {
      const o = myOrder(ctx);
      if (o.status !== 'paid')
        throw conflict(
          'invalid_transition',
          'Le vendeur a déjà accepté : la commande ne peut plus être annulée',
        );
      this.cancel(o, 'buyer_cancelled', 'Annulée par l’acheteur', true);
      this.notify(
        this.shop(o.sellerId).userId,
        'order_cancelled',
        'Commande annulée',
        `L’acheteur a annulé la commande ${o.publicRef}.`,
        `/vendeur/commande/${o.id}`,
      );
      return { id: o.id, status: o.status };
    });
    this.on(
      'POST',
      '/v1/orders/{id}/confirm-receipt',
      (ctx): Ok<'/v1/orders/{id}/confirm-receipt', 'post'> => {
        const o = myOrder(ctx);
        if (o.status !== 'delivered' && o.status !== 'awaiting_collection')
          throw conflict('invalid_transition', 'Commande pas encore remise');
        if (o.status === 'awaiting_collection') {
          o.deliveredAt = this.iso();
          this.moveTo(o, 'delivered', 'collected');
        }
        this.complete(o, 'buyer_confirmed_receipt');
        return { id: o.id, status: o.status };
      },
    );
    this.on(
      'POST',
      '/v1/orders/{id}/handover-code',
      (ctx) => {
        const o = myOrder(ctx);
        if (!['ready_for_pickup', 'in_delivery', 'awaiting_collection'].includes(o.status))
          throw conflict('invalid_transition', 'Pas de code de remise à ce stade');
        this.sendHandoverCode(o);
        return undefined;
      },
      202,
    );
    this.on(
      'POST',
      '/v1/orders/{id}/disputes',
      (ctx): Ok<'/v1/orders/{id}/disputes', 'post', 201> => {
        const o = myOrder(ctx);
        if (!['delivered', 'in_delivery', 'awaiting_collection'].includes(o.status))
          throw conflict('invalid_transition', 'Réclamation impossible à ce stade');
        o.dispute = {
          id: this.deps.newId(),
          reason: ctx.body.reason as S['DisputeReason'],
          description: String(ctx.body.description ?? ''),
          status: 'open',
          createdAt: this.iso(),
          sellerChoice: null,
          sellerMessage: null,
          sellerRespondedAt: null,
          buyerEvidenceCount: 0,
          sellerEvidenceCount: 0,
        };
        this.moveTo(o, 'disputed', 'dispute_opened');
        this.notify(
          this.shop(o.sellerId).userId,
          'seller_dispute_opened',
          'Litige ouvert',
          `L’acheteur signale un problème sur la commande ${o.publicRef}. Répondez sous 48 h.`,
          `/vendeur/commande/${o.id}`,
        );
        return { id: o.dispute.id, status: 'open' };
      },
      201,
    );
    this.on(
      'POST',
      '/v1/disputes/{id}/evidence',
      ({ params }): Ok<'/v1/disputes/{id}/evidence', 'post', 201> => {
        const o = this.state.orders.find((x) => x.dispute?.id === params.id);
        if (!o) throw notFound('Litige');
        o.dispute!.buyerEvidenceCount += 1;
        return { disputeId: params.id };
      },
      201,
    );
    this.on(
      'POST',
      '/v1/order-items/{id}/review',
      ({ user, params, body }): Ok<'/v1/order-items/{id}/review', 'post', 201> => {
        const me = user();
        const o = this.state.orders.find(
          (x) => x.buyerId === me.id && x.items.some((i) => i.itemId === params.id),
        );
        const item = o?.items.find((i) => i.itemId === params.id);
        if (!o || !item) throw notFound('Article');
        if (!['delivered', 'completed'].includes(o.status))
          throw conflict('not_reviewable', 'Notez après la remise');
        if (item.reviewed) throw conflict('already_reviewed', 'Vous avez déjà noté cet article');
        item.reviewed = true;
        const id = this.deps.newId();
        this.state.reviews.unshift({
          id,
          productId: item.productId,
          orderItemId: item.itemId,
          sellerId: o.sellerId,
          authorName:
            shortName(me.fullName) ?? shortName(o.shippingAddress.recipientName) ?? 'Client Zandu',
          rating: Math.min(5, Math.max(1, Number(body.rating))),
          comment:
            typeof body.comment === 'string' && body.comment.trim() ? body.comment.trim() : null,
          tags: (body.tags as S['ReviewTag'][]) ?? [],
          createdAt: this.iso(),
          reply: null,
          repliedAt: null,
        });
        return { id };
      },
      201,
    );

    // Envoi de photos ------------------------------------------------------
    this.on(
      'POST',
      '/v1/uploads',
      ({ user }): Ok<'/v1/uploads', 'post', 201> => {
        user();
        const id = this.deps.newId();
        return {
          uploadId: id,
          method: 'PUT',
          url: `demo://uploads/${id}`,
          fields: {},
          headers: {},
          expiresAt: this.iso(15 * 60_000),
          maxBytes: 8_000_000,
        };
      },
      201,
    );

    // Vendeur --------------------------------------------------------------
    this.registerSeller();
    // Livreur --------------------------------------------------------------
    this.registerRider();
  }

  private registerSeller(): void {
    const sellerOrder = (ctx: Ctx): DOrder => {
      const shop = this.shopOf(ctx.user());
      const o = this.state.orders.find(
        (x) => x.id === ctx.params.id && x.sellerId === shop.id && x.status !== 'pending_payment',
      );
      if (!o) throw notFound('Commande');
      return o;
    };
    this.on('GET', '/v1/seller/shop', ({ user }): Ok<'/v1/seller/shop', 'get'> =>
      this.shopView(this.shopOf(user())),
    );
    this.on(
      'POST',
      '/v1/seller/shop',
      ({ user, body }): Ok<'/v1/seller/shop', 'post', 201> => {
        const me = user();
        if (this.state.shops.some((s) => s.userId === me.id))
          throw conflict('shop_exists', 'Vous avez déjà une boutique');
        const name = String(body.shopName ?? '').trim();
        if (name.length < 2)
          throw new DemoError(400, 'validation_error', 'Nom de boutique trop court');
        const id = this.deps.newId();
        this.state.shops.push({
          id,
          userId: me.id,
          shopName: name,
          slug: `${slugify(name)}-${id.slice(0, 4)}`,
          kind: body.kind === 'business' ? 'business' : 'individual',
          city: String(body.city ?? 'Pointe-Noire'),
          pickupZoneId: String(body.pickupZoneId),
          payoutPhone: body.payoutPhone
            ? parseCongoMobile(String(body.payoutPhone)).e164
            : me.phone,
          payoutOperator: body.payoutOperator === 'airtel' ? 'airtel' : 'mtn',
          payoutAccountName: null,
          verificationStatus: 'unverified',
          isOpen: true,
          defaultPrepMinutes: 60,
          openingHours: (body.openingHours as string) ?? null,
          weeklyHours: (body.weeklyHours as S['WeeklyHours']) ?? null,
          soldCategoryIds: (body.soldCategoryIds as string[]) ?? [],
          termsAccepted: false,
          kycDocuments: [],
        });
        if (!me.roles.includes('seller')) me.roles.push('seller');
        return { id };
      },
      201,
    );
    this.on('PATCH', '/v1/seller/shop', ({ user, body }): Ok<'/v1/seller/shop', 'patch'> => {
      const shop = this.shopOf(user());
      const b = body as Partial<S['SellerShop']> & { payoutPhone?: string; acceptTerms?: true };
      if (b.shopName !== undefined) shop.shopName = b.shopName.trim();
      if (b.city !== undefined) shop.city = b.city;
      if (b.pickupZoneId !== undefined) shop.pickupZoneId = b.pickupZoneId;
      if (b.soldCategoryIds !== undefined) shop.soldCategoryIds = b.soldCategoryIds;
      if (b.openingHours !== undefined) shop.openingHours = b.openingHours;
      if (b.weeklyHours !== undefined) shop.weeklyHours = b.weeklyHours;
      if (b.isOpen !== undefined) shop.isOpen = b.isOpen;
      if (b.defaultPrepMinutes !== undefined) shop.defaultPrepMinutes = b.defaultPrepMinutes;
      if (b.payoutPhone !== undefined) shop.payoutPhone = parseCongoMobile(b.payoutPhone).e164;
      if (b.payoutOperator !== undefined) shop.payoutOperator = b.payoutOperator;
      if (b.payoutAccountName !== undefined) shop.payoutAccountName = b.payoutAccountName;
      if (b.acceptTerms) shop.termsAccepted = true;
      return this.shopView(shop);
    });
    this.on('GET', '/v1/seller/kyc', ({ user }): Ok<'/v1/seller/kyc', 'get'> =>
      this.kycView(this.shopOf(user())),
    );
    this.on(
      'POST',
      '/v1/seller/kyc-documents',
      ({ user, body }): Ok<'/v1/seller/kyc-documents', 'post', 201> => {
        const shop = this.shopOf(user());
        shop.kycDocuments.push({
          id: this.deps.newId(),
          type: body.type as S['KycDocumentType'],
          createdAt: this.iso(),
        });
        if (shop.verificationStatus !== 'verified' && this.kycView(shop).missing.length === 0)
          shop.verificationStatus = 'pending_review';
        return this.kycView(shop);
      },
      201,
    );

    this.on('GET', '/v1/seller/dashboard', ({ user }): Ok<'/v1/seller/dashboard', 'get'> => {
      const shop = this.shopOf(user());
      const today = congoDay(this.now());
      const mine = this.state.orders.filter((o) => o.sellerId === shop.id && o.paidAt);
      const todays = mine.filter(
        (o) =>
          congoDay(new Date(o.paidAt!)) === today &&
          o.status !== 'cancelled' &&
          o.status !== 'refunded',
      );
      const toAccept = mine
        .filter((o) => o.status === 'paid')
        .sort((a, b) => a.sellerAcceptDeadline!.localeCompare(b.sellerAcceptDeadline!));
      const products = this.state.products.filter(
        (p) => p.sellerId === shop.id && p.status !== 'archived',
      );
      return {
        todaySales: todays.reduce((n, o) => n + this.subtotal(o), 0),
        todayOrders: todays.length,
        toAccept: {
          count: toAccept.length,
          nextDeadline: toAccept[0]?.sellerAcceptDeadline ?? null,
        },
        lowStock: products
          .filter((p) => p.status === 'published' && p.stock <= p.lowStockThreshold)
          .map((p) => ({
            id: p.id,
            title: p.title,
            stock: p.stock,
            lowStockThreshold: p.lowStockThreshold,
          })),
        productCount: products.length,
      };
    });
    this.on('GET', '/v1/seller/orders', ({ user, query }): Ok<'/v1/seller/orders', 'get'> => {
      const shop = this.shopOf(user());
      const wanted = query.get('status')?.split(',').filter(Boolean);
      return {
        items: this.state.orders
          .filter(
            (o) =>
              o.sellerId === shop.id &&
              o.status !== 'pending_payment' &&
              (!wanted || wanted.includes(o.status)),
          )
          .map((o) => this.sellerOrderView(o)),
      };
    });
    this.on('GET', '/v1/seller/orders/{id}', (ctx): Ok<'/v1/seller/orders/{id}', 'get'> => {
      const o = sellerOrder(ctx);
      const d = o.delivery;
      const rider = d ? this.userById(d.riderUserId) : undefined;
      const buyer = this.userById(o.buyerId);
      return {
        ...this.sellerOrderView(o),
        history: o.history,
        rider: rider ? { name: shortName(rider.fullName) ?? 'Livreur Zandu' } : null,
        delivery: d
          ? {
              status: d.status,
              pickupConfirmedAt: d.pickupConfirmedAt,
              returnConfirmedAt: d.returnConfirmedAt,
              returnedAt: d.returnedAt,
              failureReason: d.failureReason,
            }
          : null,
        dispute: o.dispute
          ? {
              id: o.dispute.id,
              reason: o.dispute.reason,
              description: o.dispute.description,
              status: o.dispute.status,
              resolution: null,
              slaDueAt: new Date(Date.parse(o.dispute.createdAt) + 48 * 3_600_000).toISOString(),
              sellerChoice: o.dispute.sellerChoice,
              sellerMessage: o.dispute.sellerMessage,
              sellerRespondedAt: o.dispute.sellerRespondedAt,
              buyerName:
                shortName(buyer?.fullName ?? null) ??
                shortName(o.shippingAddress.recipientName) ??
                'Client',
              buyerEvidenceCount: o.dispute.buyerEvidenceCount,
              sellerEvidenceCount: o.dispute.sellerEvidenceCount,
            }
          : null,
        reviews: this.state.reviews
          .filter((r) => o.items.some((i) => i.itemId === r.orderItemId))
          .map((r) => ({
            id: r.id,
            rating: r.rating,
            comment: r.comment,
            tags: r.tags,
            createdAt: r.createdAt,
            authorName: r.authorName,
            reply: r.reply,
          })),
      };
    });
    this.on(
      'POST',
      '/v1/seller/orders/{id}/accept',
      (ctx): Ok<'/v1/seller/orders/{id}/accept', 'post'> => {
        const o = sellerOrder(ctx);
        if (o.status !== 'paid') throw conflict('invalid_transition', 'Commande déjà traitée');
        const minutes = Number(ctx.body.readyInMinutes ?? this.shop(o.sellerId).defaultPrepMinutes);
        o.readyPromisedAt = this.iso(minutes * 60_000);
        this.moveTo(o, 'preparing', 'seller_accepted');
        this.notify(
          o.buyerId,
          'buyer_order_accepted',
          'Commande en préparation',
          `Le vendeur prépare votre commande ${o.publicRef}.`,
          `/commande/${o.id}`,
        );
        return { id: o.id, status: o.status };
      },
    );
    this.on(
      'POST',
      '/v1/seller/orders/{id}/reject',
      (ctx): Ok<'/v1/seller/orders/{id}/reject', 'post'> => {
        const o = sellerOrder(ctx);
        if (o.status !== 'paid') throw conflict('invalid_transition', 'Commande déjà traitée');
        this.cancel(
          o,
          'seller_rejected',
          String(ctx.body.reason ?? 'Refusée par le vendeur'),
          true,
        );
        this.notify(
          o.buyerId,
          'order_cancelled',
          'Commande annulée',
          `Le vendeur n’a pas pu honorer la commande ${o.publicRef}. Vous êtes remboursé.`,
          `/commande/${o.id}`,
        );
        return { id: o.id, status: o.status };
      },
    );
    this.on(
      'POST',
      '/v1/seller/orders/{id}/ready',
      (ctx): Ok<'/v1/seller/orders/{id}/ready', 'post'> => {
        const o = sellerOrder(ctx);
        if (o.status !== 'preparing')
          throw conflict('invalid_transition', 'Acceptez d’abord la commande');
        this.moveTo(o, 'ready_for_pickup', 'seller_marked_ready');
        // Pas de support en démonstration : la course part tout de suite au livreur de démonstration.
        this.assignRider(o);
        const rider = this.userByPhone(DEMO_RIDER_PHONE);
        this.notify(
          rider.id,
          'rider_new_mission',
          'Nouvelle course',
          `Course ${o.publicRef} : à récupérer chez ${this.shop(o.sellerId).shopName}.`,
          `/livreur/${o.id}`,
        );
        return { id: o.id, status: o.status };
      },
    );
    this.on(
      'POST',
      '/v1/seller/orders/{id}/rider-pickup',
      (ctx): Ok<'/v1/seller/orders/{id}/rider-pickup', 'post'> => {
        const o = sellerOrder(ctx);
        const d = o.delivery;
        if (!d || d.status !== 'assigned')
          throw conflict('no_rider', 'Aucun livreur attendu pour cette commande');
        if (ctx.body.code !== d.pickupCode)
          throw new DemoError(422, 'invalid_pickup_code', 'Code du livreur incorrect');
        d.pickupConfirmedAt = this.iso();
        return { orderId: o.id, pickupConfirmedAt: d.pickupConfirmedAt };
      },
    );
    this.on(
      'POST',
      '/v1/seller/orders/{id}/rider-return',
      (ctx): Ok<'/v1/seller/orders/{id}/rider-return', 'post'> => {
        const o = sellerOrder(ctx);
        const d = o.delivery;
        if (!d || d.status !== 'returning')
          throw conflict('not_returning', 'Aucun retour en cours');
        if (ctx.body.code !== d.returnCode)
          throw new DemoError(422, 'invalid_return_code', 'Code de retour incorrect');
        d.returnConfirmedAt = this.iso();
        return { orderId: o.id, returnConfirmedAt: d.returnConfirmedAt };
      },
    );
    this.on(
      'POST',
      '/v1/seller/orders/{id}/dispute-response',
      (ctx): Ok<'/v1/seller/orders/{id}/dispute-response', 'post'> => {
        const o = sellerOrder(ctx);
        if (!o.dispute) throw conflict('no_dispute', 'Pas de litige sur cette commande');
        o.dispute.sellerChoice = ctx.body.choice as S['DisputeSellerChoice'];
        o.dispute.sellerMessage = (ctx.body.message as string) ?? null;
        o.dispute.sellerRespondedAt = this.iso();
        const view = this.handle({
          method: 'GET',
          path: `/v1/seller/orders/${o.id}`,
          query: new URLSearchParams(),
          token: ctx.token,
          body: null,
        });
        return (view.body as Ok<'/v1/seller/orders/{id}', 'get'>).dispute!;
      },
    );
    this.on(
      'POST',
      '/v1/seller/orders/{id}/dispute-evidence',
      (ctx): Ok<'/v1/seller/orders/{id}/dispute-evidence', 'post', 201> => {
        const o = sellerOrder(ctx);
        if (!o.dispute) throw conflict('no_dispute', 'Pas de litige sur cette commande');
        o.dispute.sellerEvidenceCount += 1;
        return { orderId: o.id };
      },
      201,
    );

    // Produits -------------------------------------------------------------
    const myProduct = (ctx: Ctx): DProduct => {
      const shop = this.shopOf(ctx.user());
      const p = this.state.products.find((x) => x.id === ctx.params.id && x.sellerId === shop.id);
      if (!p) throw notFound('Produit');
      return p;
    };
    this.on('GET', '/v1/seller/products', ({ user, query }): Ok<'/v1/seller/products', 'get'> => {
      const shop = this.shopOf(user());
      const archived = query.get('status') === 'archived';
      return {
        items: this.state.products
          .filter(
            (p) =>
              p.sellerId === shop.id &&
              (archived ? p.status === 'archived' : p.status !== 'archived'),
          )
          .map((p) => ({
            id: p.id,
            title: p.title,
            price: p.price,
            stock: p.stock,
            status: p.status,
            categoryId: p.categoryId,
            condition: p.condition,
            lowStockThreshold: p.lowStockThreshold,
            rejectionReason: null,
            updatedAt: p.updatedAt,
            coverImage: p.photos[0] ? photoUrl(p.photos[0].url) : null,
            photoCount: p.photos.length,
          })),
      };
    });
    this.on('GET', '/v1/seller/products/{id}', (ctx): Ok<'/v1/seller/products/{id}', 'get'> =>
      this.sellerProductView(myProduct(ctx)),
    );
    this.on(
      'POST',
      '/v1/seller/products',
      ({ user, body }): Ok<'/v1/seller/products', 'post', 201> => {
        const shop = this.shopOf(user());
        const title = String(body.title ?? '').trim();
        if (title.length < 3) throw new DemoError(400, 'validation_error', 'Titre trop court');
        const status = body.publish
          ? shop.verificationStatus === 'verified'
            ? 'published'
            : 'pending_review'
          : 'draft';
        const id = this.deps.newId();
        this.state.products.unshift({
          id,
          sellerId: shop.id,
          categoryId: String(body.categoryId),
          title,
          description: String(body.description ?? ''),
          price: Number(body.price),
          stock: Number(body.stock),
          condition: (body.condition as S['ProductCondition']) ?? 'new',
          lowStockThreshold: Number(body.lowStockThreshold ?? 2),
          status,
          city: shop.city,
          photos: [],
          createdAt: this.iso(),
          updatedAt: this.iso(),
        });
        return { id, status };
      },
      201,
    );
    this.on('PATCH', '/v1/seller/products/{id}', (ctx): Ok<'/v1/seller/products/{id}', 'patch'> => {
      const p = myProduct(ctx);
      const b = ctx.body;
      if (b.categoryId !== undefined) p.categoryId = String(b.categoryId);
      if (b.title !== undefined) p.title = String(b.title).trim();
      if (b.description !== undefined) p.description = String(b.description);
      if (b.price !== undefined) p.price = Number(b.price);
      if (b.stock !== undefined) p.stock = Number(b.stock);
      if (b.condition !== undefined) p.condition = b.condition as S['ProductCondition'];
      if (b.lowStockThreshold !== undefined) p.lowStockThreshold = Number(b.lowStockThreshold);
      if (b.status === 'archived') p.status = 'archived';
      if (b.status === 'published')
        p.status =
          this.shop(p.sellerId).verificationStatus === 'verified' ? 'published' : 'pending_review';
      p.updatedAt = this.iso();
      return { id: p.id, title: p.title, price: p.price, stock: p.stock, status: p.status };
    });
    this.on(
      'POST',
      '/v1/seller/products/{id}/photos',
      (ctx): Ok<'/v1/seller/products/{id}/photos', 'post', 201> => {
        const p = myProduct(ctx);
        const url = this.state.uploads[String(ctx.body.uploadId)];
        if (!url) throw new DemoError(422, 'upload_missing', 'Photo introuvable, reprenez-la');
        if (p.photos.length >= 8) throw conflict('too_many_photos', '8 photos au plus');
        p.photos.push({ id: this.deps.newId(), url });
        p.updatedAt = this.iso();
        return this.photoList(p);
      },
      201,
    );
    this.on(
      'DELETE',
      '/v1/seller/products/{id}/photos/{photoId}',
      (ctx): Ok<'/v1/seller/products/{id}/photos/{photoId}', 'delete'> => {
        const p = myProduct(ctx);
        p.photos = p.photos.filter((ph) => ph.id !== ctx.params.photoId);
        return this.photoList(p);
      },
    );
    this.on(
      'GET',
      '/v1/seller/commission-preview',
      ({ user, query }): Ok<'/v1/seller/commission-preview', 'get'> => {
        this.shopOf(user());
        const rateBps = commissionRateBps(String(query.get('categoryId')));
        const price = Number(query.get('price') ?? 0);
        const commission = lineCommission(price, rateBps);
        return { rateBps, commission, net: price - commission };
      },
    );

    // Avis et argent -------------------------------------------------------
    this.on('GET', '/v1/seller/reviews', ({ user }): Ok<'/v1/seller/reviews', 'get'> => {
      const shop = this.shopOf(user());
      const reviews = this.state.reviews.filter((r) => r.sellerId === shop.id);
      const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const r of reviews) distribution[r.rating as 1 | 2 | 3 | 4 | 5] += 1;
      return {
        average: reviews.length
          ? round1(reviews.reduce((n, r) => n + r.rating, 0) / reviews.length)
          : null,
        count: reviews.length,
        distribution,
        items: reviews.map((r) => ({
          id: r.id,
          rating: r.rating,
          comment: r.comment,
          tags: r.tags,
          createdAt: r.createdAt,
          authorName: r.authorName,
          productTitle: this.state.products.find((p) => p.id === r.productId)?.title ?? '',
          reply: r.reply,
          repliedAt: r.repliedAt,
        })),
      };
    });
    this.on(
      'POST',
      '/v1/seller/reviews/{id}/reply',
      ({ user, params, body }): Ok<'/v1/seller/reviews/{id}/reply', 'post'> => {
        const shop = this.shopOf(user());
        const r = this.state.reviews.find((x) => x.id === params.id && x.sellerId === shop.id);
        if (!r) throw notFound('Avis');
        r.reply = String(body.text ?? '').trim();
        r.repliedAt = this.iso();
        return { id: r.id, reply: r.reply, repliedAt: r.repliedAt };
      },
    );
    this.on('GET', '/v1/seller/balance', ({ user }): Ok<'/v1/seller/balance', 'get'> => {
      const shop = this.shopOf(user());
      const orders = this.state.orders.filter((o) => o.sellerId === shop.id);
      const payouts = this.state.payouts.filter((p) => p.sellerId === shop.id);
      const ref = (id: string) => orders.find((o) => o.id === id)?.publicRef ?? null;
      const movements: Ok<'/v1/seller/balance', 'get'>['movements'] = [];
      for (const o of orders) {
        if (o.paidAt)
          movements.push({
            kind: 'held',
            publicRef: o.publicRef,
            amount: this.sellerNet(o),
            at: o.paidAt,
          });
        if (o.completedAt)
          movements.push({
            kind: 'released',
            publicRef: o.publicRef,
            amount: this.sellerNet(o),
            at: o.completedAt,
          });
      }
      for (const p of payouts)
        movements.push({
          kind: 'paid_out',
          publicRef: ref(p.orderId),
          amount: p.amount,
          at: p.createdAt,
        });
      movements.sort((a, b) => b.at.localeCompare(a.at));
      return {
        payoutMode: 'automatic',
        available: 0,
        inEscrow: orders
          .filter((o) => ESCROW.includes(o.status))
          .reduce((n, o) => n + this.sellerNet(o), 0),
        payouts: payouts.map((p) => ({
          id: p.id,
          amount: p.amount,
          status: 'succeeded',
          orderId: p.orderId,
          publicRef: ref(p.orderId),
          createdAt: p.createdAt,
          succeededAt: p.createdAt,
        })),
        payoutAccount: { operator: shop.payoutOperator, phone: shop.payoutPhone },
        movements: movements.slice(0, 50),
      };
    });
    this.on('GET', '/v1/seller/withdrawals', ({ user }): Ok<'/v1/seller/withdrawals', 'get'> => {
      this.shopOf(user());
      return {
        mode: 'automatic',
        withdrawable: 0,
        blockedReason: 'no_balance',
        minimum: 1000,
        reviewAbove: 200_000,
        items: [],
      };
    });
    this.on('POST', '/v1/seller/withdrawals', () => {
      throw conflict('withdrawals_disabled', 'Votre argent vous est reversé automatiquement');
    });
    this.on('POST', '/v1/seller/withdrawals/confirm', () => {
      throw conflict('withdrawals_disabled', 'Votre argent vous est reversé automatiquement');
    });
  }

  private registerRider(): void {
    const riderOrder = (ctx: Ctx): DOrder => {
      const me = ctx.user();
      if (!me.roles.includes('rider'))
        throw new DemoError(403, 'not_a_rider', "Vous n'êtes pas livreur partenaire");
      const o = this.state.orders.find(
        (x) => x.id === ctx.params.id && x.delivery?.riderUserId === me.id,
      );
      if (!o) throw notFound('Livraison');
      return o;
    };
    const riderUser = (ctx: Ctx): DUser => {
      const me = ctx.user();
      if (!me.roles.includes('rider'))
        throw new DemoError(403, 'not_a_rider', "Vous n'êtes pas livreur partenaire");
      return me;
    };
    const mine = (me: DUser) => this.state.orders.filter((o) => o.delivery?.riderUserId === me.id);

    this.on('GET', '/v1/rider/me', (ctx): Ok<'/v1/rider/me', 'get'> => {
      const me = riderUser(ctx);
      const deliveries = mine(me).map((o) => o.delivery!);
      const today = congoDay(this.now());
      return {
        fullName: me.fullName,
        phone: me.phone,
        partnerName: COURIER_PARTNER.name,
        partnerPhone: COURIER_PARTNER.phone,
        zone: 'Lumumba (Centre-ville)',
        city: 'Pointe-Noire',
        deliveredTotal: deliveries.filter((d) => d.status === 'delivered').length,
        deliveredToday: deliveries.filter(
          (d) =>
            d.status === 'delivered' &&
            d.deliveredAt &&
            congoDay(new Date(d.deliveredAt)) === today,
        ).length,
        inProgress: deliveries.filter((d) =>
          ['assigned', 'picked_up', 'returning'].includes(d.status),
        ).length,
      };
    });
    this.on('GET', '/v1/rider/deliveries', (ctx): Ok<'/v1/rider/deliveries', 'get'> => ({
      items: mine(riderUser(ctx))
        .filter((o) => ['assigned', 'picked_up', 'returning'].includes(o.delivery!.status))
        .sort((a, b) => a.delivery!.assignedAt.localeCompare(b.delivery!.assignedAt))
        .map((o) => this.mission(o)),
    }));
    this.on('GET', '/v1/rider/deliveries/{id}', (ctx): Ok<'/v1/rider/deliveries/{id}', 'get'> =>
      this.mission(riderOrder(ctx)),
    );
    this.on('GET', '/v1/rider/history', (ctx): Ok<'/v1/rider/history', 'get'> => {
      const days = ctx.query.get('period') === '30d' ? 30 : 7;
      const since = this.now().getTime() - days * 86_400_000;
      const done = mine(riderUser(ctx)).filter((o) => {
        const at = o.delivery!.deliveredAt ?? o.delivery!.returnedAt;
        return at && Date.parse(at) >= since;
      });
      const items = done
        .map((o) => {
          const d = o.delivery!;
          const at = (d.deliveredAt ?? d.returnedAt)!;
          return {
            orderId: o.id,
            publicRef: o.publicRef,
            from: this.shop(o.sellerId).shopName,
            to: this.zone(o.zoneId).name,
            outcome:
              d.status === 'delivered'
                ? ('delivered' as const)
                : d.returnedAt
                  ? ('returned' as const)
                  : ('failed' as const),
            at,
            minutes: d.pickedUpAt
              ? Math.round((Date.parse(at) - Date.parse(d.pickedUpAt)) / 60_000)
              : null,
            reason: d.failureReason,
          };
        })
        .sort((a, b) => b.at.localeCompare(a.at));
      const delivered = items.filter((i) => i.outcome === 'delivered');
      const minutes = delivered.map((i) => i.minutes).filter((m): m is number => m !== null);
      return {
        delivered: delivered.length,
        returned: items.filter((i) => i.outcome === 'returned').length,
        averageMinutes: minutes.length
          ? Math.round(minutes.reduce((n, m) => n + m, 0) / minutes.length)
          : null,
        items,
      };
    });
    this.on(
      'POST',
      '/v1/rider/deliveries/{id}/pickup',
      (ctx): Ok<'/v1/rider/deliveries/{id}/pickup', 'post'> => {
        const o = riderOrder(ctx);
        const d = o.delivery!;
        if (d.status !== 'assigned') throw conflict('invalid_transition', 'Colis déjà pris');
        if (!d.pickupConfirmedAt)
          throw conflict(
            'pickup_not_confirmed',
            'Le vendeur doit d’abord saisir votre code de retrait',
          );
        d.status = 'picked_up';
        d.pickedUpAt = this.iso();
        this.moveTo(o, 'in_delivery', 'rider_picked_up');
        this.notify(
          o.buyerId,
          'buyer_in_delivery',
          'Commande en route',
          `Votre commande ${o.publicRef} est en route.`,
          `/commande/${o.id}`,
        );
        this.sendHandoverCode(o);
        return { id: o.id, status: o.status };
      },
    );
    this.on('POST', '/v1/rider/deliveries/{id}/position', (ctx) => {
      const o = riderOrder(ctx);
      const d = o.delivery!;
      if (d.status !== 'picked_up')
        throw conflict('not_on_the_way', 'Position partagée seulement pendant la course');
      d.position = {
        lat: Number(ctx.body.lat),
        lng: Number(ctx.body.lng),
        accuracy: ctx.body.accuracy === undefined ? null : Math.round(Number(ctx.body.accuracy)),
        at: this.iso(),
      };
      return undefined;
    });
    this.on(
      'POST',
      '/v1/rider/deliveries/{id}/arrived',
      (ctx): Ok<'/v1/rider/deliveries/{id}/arrived', 'post'> => {
        const o = riderOrder(ctx);
        const d = o.delivery!;
        if (d.status !== 'picked_up')
          throw conflict('invalid_transition', 'Prenez d’abord le colis');
        d.arrivedAt ??= this.iso();
        if (!d.contacts.some((c) => c.kind === 'sms'))
          d.contacts.push({ kind: 'sms', at: this.iso() });
        this.notify(
          o.buyerId,
          'buyer_rider_arrived',
          'Votre livreur est arrivé',
          `Le livreur de la commande ${o.publicRef} est devant chez vous.`,
          `/commande/${o.id}`,
        );
        return {
          arrivedAt: d.arrivedAt,
          absentAllowedAt: new Date(
            Date.parse(d.arrivedAt) + ABSENT_WAIT_MINUTES * 60_000,
          ).toISOString(),
        };
      },
    );
    this.on(
      'POST',
      '/v1/rider/deliveries/{id}/contact-attempt',
      (ctx): Ok<'/v1/rider/deliveries/{id}/contact-attempt', 'post', 201> => {
        const d = riderOrder(ctx).delivery!;
        if (!d.arrivedAt) throw conflict('not_arrived', 'Indiquez d’abord que vous êtes arrivé');
        d.contacts.push({ kind: 'call', at: this.iso() });
        return { recorded: true };
      },
      201,
    );
    this.on(
      'POST',
      '/v1/rider/deliveries/{id}/handover',
      (ctx): Ok<'/v1/rider/deliveries/{id}/handover', 'post'> => {
        const o = riderOrder(ctx);
        const d = o.delivery!;
        if (d.status !== 'picked_up')
          throw conflict('invalid_transition', 'Pas de remise à ce stade');
        if (d.handoverAttempts >= HANDOVER_MAX_ATTEMPTS)
          throw new DemoError(423, 'handover_locked', 'Trop de codes erronés : appelez le support');
        if (ctx.body.code !== o.handoverCode) {
          d.handoverAttempts += 1;
          throw new DemoError(422, 'invalid_handover_code', 'Code de remise incorrect');
        }
        d.status = 'delivered';
        d.deliveredAt = this.iso();
        d.position = null;
        o.deliveredAt = this.iso();
        o.disputeWindowEndsAt = this.iso(DISPUTE_WINDOW_HOURS * 3_600_000);
        this.moveTo(o, 'delivered', 'handover_confirmed');
        this.notify(
          o.buyerId,
          'buyer_delivered',
          'Commande remise',
          `Commande ${o.publicRef} remise. Vous avez 48 h pour signaler un problème.`,
          `/commande/${o.id}`,
        );
        return { id: o.id, status: o.status };
      },
    );
    this.on(
      'POST',
      '/v1/rider/deliveries/{id}/arrived-at-pickup-point',
      (ctx): Ok<'/v1/rider/deliveries/{id}/arrived-at-pickup-point', 'post'> => {
        const o = riderOrder(ctx);
        const d = o.delivery!;
        if (o.deliveryMode !== 'pickup_point' || d.status !== 'picked_up')
          throw new DemoError(
            422,
            'invalid_transition',
            'Cette course n’est pas pour un point relais',
          );
        d.status = 'at_pickup_point';
        d.position = null;
        this.moveTo(o, 'awaiting_collection', 'arrived_at_pickup_point');
        this.notify(
          o.buyerId,
          'buyer_awaiting_collection',
          'Colis au point relais',
          `Votre commande ${o.publicRef} vous attend au point relais.`,
          `/commande/${o.id}`,
        );
        return { id: o.id, status: o.status };
      },
    );
    this.on(
      'POST',
      '/v1/rider/deliveries/{id}/return',
      (ctx): Ok<'/v1/rider/deliveries/{id}/return', 'post'> => {
        const o = riderOrder(ctx);
        const d = o.delivery!;
        if (d.status !== 'picked_up' || !d.arrivedAt)
          throw conflict('invalid_transition', 'Indiquez d’abord que vous êtes arrivé');
        const absent = ctx.body.reason === 'absent';
        if (absent && this.now().getTime() < Date.parse(d.arrivedAt) + ABSENT_WAIT_MINUTES * 60_000)
          throw conflict(
            'absent_wait',
            `Attendez ${ABSENT_WAIT_MINUTES} minutes avant de déclarer le client absent`,
          );
        const note =
          typeof ctx.body.note === 'string' && ctx.body.note.trim()
            ? ` (${ctx.body.note.trim()})`
            : '';
        d.status = 'returning';
        d.returnCode = this.digits(4);
        d.position = null;
        d.failureReason = absent ? 'cliente absente' : `colis refusé${note}`;
        this.notify(
          o.buyerId,
          'buyer_delivery_returning',
          'Livraison manquée',
          `Le colis de la commande ${o.publicRef} repart chez le vendeur.`,
          `/commande/${o.id}`,
        );
        return this.mission(o);
      },
    );
    this.on(
      'POST',
      '/v1/rider/deliveries/{id}/returned',
      (ctx): Ok<'/v1/rider/deliveries/{id}/returned', 'post'> => {
        const o = riderOrder(ctx);
        const d = o.delivery!;
        if (d.status !== 'returning' || !d.returnConfirmedAt)
          throw conflict(
            'return_not_confirmed',
            'Le vendeur doit d’abord saisir le code de retour',
          );
        d.status = 'failed';
        d.returnedAt = this.iso();
        o.dispute = {
          id: this.deps.newId(),
          reason: 'not_received',
          description: `Livraison impossible : ${d.failureReason}, colis rendu au vendeur`,
          status: 'open',
          createdAt: this.iso(),
          sellerChoice: null,
          sellerMessage: null,
          sellerRespondedAt: null,
          buyerEvidenceCount: 0,
          sellerEvidenceCount: 0,
        };
        this.moveTo(o, 'disputed', 'delivery_failed');
        return { id: o.id, status: o.status };
      },
    );
    this.on(
      'POST',
      '/v1/rider/deliveries/{id}/incident',
      (ctx): Ok<'/v1/rider/deliveries/{id}/incident', 'post', 201> => {
        riderOrder(ctx);
        return { recorded: true };
      },
      201,
    );
  }
}

// ------------------------------------------------------------- utilitaires

function error(e: DemoError): DemoResponse {
  return {
    status: e.status,
    body: {
      error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) },
    },
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** « demo-photo:pagne-wax » → photo intégrée à l'application ; sinon l'adresse telle quelle. */
function photoUrl(url: string): string {
  return url.startsWith('demo-photo:') ? (DEMO_PHOTOS[url.slice(11)] ?? url) : url;
}

/** « Grâce Mabiala » → « Grâce M. ». */
function shortName(full: string | null): string | null {
  const parts = full?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0]! : `${parts[0]} ${parts.at(-1)![0]}.`;
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function slugify(text: string): string {
  return (
    normalize(text)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'boutique'
  );
}

/** Jour calendaire à Brazzaville (UTC+1), pour « ventes du jour ». */
function congoDay(date: Date): string {
  return new Date(date.getTime() + 3_600_000).toISOString().slice(0, 10);
}
