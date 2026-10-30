import type { components } from '@zandu/api-client';

/**
 * État de la démonstration locale (docs/exploitation/demo-locale.md) : toutes les données de
 * l'application vivent dans cet objet, enregistré sur le téléphone. Aucune donnée réelle, aucun
 * serveur. Les formes suivent celles de l'API (contrat docs/api/openapi.yaml).
 */
type S = components['schemas'];

export type Role = S['User']['roles'][number];
export type OrderStatus = S['OrderStatus'];
export type DeliveryStatus = S['DeliveryStatus'];

export interface DUser {
  id: string;
  phone: string;
  fullName: string | null;
  roles: Role[];
  notificationsSeenAt: string | null;
}

export interface DShop {
  id: string;
  userId: string;
  shopName: string;
  slug: string;
  kind: 'individual' | 'business';
  city: string;
  pickupZoneId: string;
  payoutPhone: string;
  payoutOperator: S['Operator'];
  payoutAccountName: string | null;
  verificationStatus: S['VerificationStatus'];
  isOpen: boolean;
  defaultPrepMinutes: S['PrepMinutes'];
  openingHours: string | null;
  weeklyHours: S['WeeklyHours'] | null;
  soldCategoryIds: string[];
  termsAccepted: boolean;
  kycDocuments: Array<{ id: string; type: S['KycDocumentType']; createdAt: string }>;
}

export interface DProduct {
  id: string;
  sellerId: string;
  categoryId: string;
  title: string;
  description: string;
  price: number;
  stock: number;
  condition: S['ProductCondition'];
  lowStockThreshold: number;
  status: S['ProductStatus'];
  city: string;
  photos: Array<{ id: string; url: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface DReview {
  id: string;
  productId: string;
  orderItemId: string;
  sellerId: string;
  authorName: string;
  rating: number;
  comment: string | null;
  tags: S['ReviewTag'][];
  createdAt: string;
  reply: string | null;
  repliedAt: string | null;
}

export interface DItem {
  itemId: string;
  productId: string;
  title: string;
  categoryId: string;
  unitPrice: number;
  quantity: number;
  commission: number;
  reviewed: boolean;
}

export interface DDelivery {
  status: DeliveryStatus;
  riderUserId: string;
  pickupCode: string;
  assignedAt: string;
  pickupConfirmedAt: string | null;
  pickedUpAt: string | null;
  arrivedAt: string | null;
  returnCode: string | null;
  returnConfirmedAt: string | null;
  returnedAt: string | null;
  deliveredAt: string | null;
  failureReason: string | null;
  handoverAttempts: number;
  contacts: Array<{ kind: 'call' | 'sms'; at: string }>;
  position: { lat: number; lng: number; accuracy: number | null; at: string } | null;
}

export interface DDispute {
  id: string;
  reason: S['DisputeReason'];
  description: string;
  status: 'open' | 'resolved';
  createdAt: string;
  sellerChoice: S['DisputeSellerChoice'] | null;
  sellerMessage: string | null;
  sellerRespondedAt: string | null;
  buyerEvidenceCount: number;
  sellerEvidenceCount: number;
}

export interface DOrder {
  id: string;
  publicRef: string;
  checkoutId: string;
  buyerId: string;
  sellerId: string;
  status: OrderStatus;
  items: DItem[];
  deliveryFee: number;
  courierShare: number;
  refundedAmount: number;
  deliveryMode: 'home' | 'pickup_point';
  zoneId: string;
  pickupPointId: string | null;
  shippingAddress: S['ShippingAddress'];
  handoverCode: string;
  sellerAcceptDeadline: string | null;
  readyPromisedAt: string | null;
  disputeWindowEndsAt: string | null;
  createdAt: string;
  paidAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  history: Array<{ status: OrderStatus; event: string; at: string }>;
  delivery: DDelivery | null;
  dispute: DDispute | null;
}

export interface DCheckout {
  id: string;
  buyerId: string;
  orderIds: string[];
  expiresAt: string;
  paidAt: string | null;
  createdAt: string;
}

export interface DPayment {
  id: string;
  checkoutId: string;
  operator: S['Operator'];
  msisdn: string;
  amount: number;
  status: S['Payment']['status'];
  createdAt: string;
  expiresAt: string;
}

export interface DPayout {
  id: string;
  sellerId: string;
  orderId: string;
  amount: number;
  createdAt: string;
}

export interface DNotification {
  id: string;
  userId: string;
  template: string;
  title: string;
  body: string;
  url: string | null;
  createdAt: string;
}

/** Boîte des SMS de démonstration (codes de connexion et de remise), comme /dev/messages. */
export interface DMessage {
  recipient: string;
  channel: 'sms';
  template: string;
  variables: Record<string, string>;
  sentAt: string;
}

export interface DemoState {
  version: 1;
  users: DUser[];
  sessions: Record<string, string>;
  challenges: Array<{ id: string; phone: string; code: string; createdAt: string }>;
  messages: DMessage[];
  notifications: DNotification[];
  shops: DShop[];
  products: DProduct[];
  reviews: DReview[];
  checkouts: DCheckout[];
  payments: DPayment[];
  orders: DOrder[];
  payouts: DPayout[];
  uploads: Record<string, string>;
  /** Messagerie de la commande (absente des démos enregistrées avant elle). */
  chats?: Array<{
    id: string;
    orderId: string;
    authorId: string;
    role: 'buyer' | 'seller' | 'rider';
    body: string;
    createdAt: string;
  }>;
  chatReads?: Record<string, string>;
}
