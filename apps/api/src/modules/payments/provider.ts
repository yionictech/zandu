import type { MobileOperator } from '@zandu/domain';

/**
 * Port vers l'agrégateur Mobile Money (pawaPay, CinetPay, accord direct MTN/Airtel…).
 * Le reste du code ne connaît que cette interface : changer d'agrégateur = écrire un
 * nouvel adaptateur, sans toucher aux règles de séquestre (ADR-0004).
 *
 * Règle d'or : la `reference` que nous envoyons est notre identifiant interne (UUID) et
 * sert de clé d'idempotence chez l'agrégateur. Renvoyer une demande avec la même référence
 * ne doit jamais déplacer l'argent deux fois.
 */
export type ProviderStatus = 'pending' | 'succeeded' | 'failed';
export type OperationKind = 'collection' | 'payout' | 'refund';

export interface TransferRequest {
  reference: string;
  amount: number;
  currency: 'XAF';
  msisdn: string;
  operator: MobileOperator;
  description: string;
}

export interface RefundRequest extends TransferRequest {
  /** Référence de la collecte d'origine (certains agrégateurs remboursent une collecte). */
  originalReference: string;
}

export interface ProviderResult {
  status: ProviderStatus;
  providerRef?: string;
  failureCode?: string;
  failureMessage?: string;
  /** Frais prélevés par l'agrégateur, quand il les communique. */
  fee?: number;
}

export interface LookupResult extends ProviderResult {
  found: boolean;
}

/** Notification reçue par webhook, déjà vérifiée et traduite au format interne. */
export interface ProviderEvent extends ProviderResult {
  eventId: string;
  kind: OperationKind;
  reference: string;
  occurredAt: Date;
}

export interface PaymentProvider {
  readonly code: string;
  /** Envoie la demande de paiement sur le téléphone de l'acheteur (validation par code PIN). */
  initiateCollection(request: TransferRequest): Promise<ProviderResult>;
  initiatePayout(request: TransferRequest): Promise<ProviderResult>;
  initiateRefund(request: RefundRequest): Promise<ProviderResult>;
  lookup(kind: OperationKind, reference: string): Promise<LookupResult>;
  /**
   * Vérifie la signature (et la fraîcheur) d'un webhook puis le traduit.
   * Renvoie null si la signature est invalide : la requête est rejetée.
   */
  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    now: Date,
  ): ProviderEvent | null;
}

export class ProviderRegistry {
  private readonly providers = new Map<string, PaymentProvider>();

  constructor(
    providers: PaymentProvider[],
    readonly defaultCode: string,
  ) {
    for (const p of providers) this.providers.set(p.code, p);
    if (!this.providers.has(defaultCode))
      throw new Error(`Agrégateur par défaut inconnu : ${defaultCode}`);
  }

  get(code: string): PaymentProvider {
    const provider = this.providers.get(code);
    if (!provider) throw new Error(`Agrégateur inconnu : ${code}`);
    return provider;
  }

  get default(): PaymentProvider {
    return this.get(this.defaultCode);
  }

  has(code: string): boolean {
    return this.providers.has(code);
  }
}

/** Messages affichés à l'acheteur selon le motif d'échec renvoyé par l'opérateur. */
export function failureMessage(code: string | null | undefined): string {
  switch (code) {
    case 'insufficient_funds':
      return 'Solde Mobile Money insuffisant. Rechargez votre compte ou payez avec un autre numéro ou opérateur.';
    case 'declined':
      return 'Paiement refusé sur le téléphone. Vous pouvez réessayer.';
    case 'invalid_account':
      return "Ce numéro n'a pas de compte Mobile Money actif chez cet opérateur.";
    case 'limit_exceeded':
      return 'Plafond de transaction dépassé chez votre opérateur. Essayez un autre compte.';
    case 'expired':
      return 'La demande a expiré sans validation du code PIN. Vous pouvez réessayer.';
    default:
      return "Le paiement n'a pas abouti. Vous pouvez réessayer.";
  }
}
