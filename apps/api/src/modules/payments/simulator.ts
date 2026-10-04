import { randomUUID } from 'node:crypto';
import { hmac, safeEqualHex } from '../../lib/crypto.js';
import type {
  LookupResult,
  OperationKind,
  PaymentProvider,
  ProviderEvent,
  ProviderResult,
  RefundRequest,
  TransferRequest,
} from './provider.js';

interface SimOperation {
  kind: OperationKind;
  request: TransferRequest;
  result: ProviderResult;
}

/**
 * Agrégateur simulé, pour le développement, les tests et la recette des applications.
 * Interdit en production (voir config.ts). Il reproduit les comportements du cahier §5 :
 *   - un numéro finissant par 99 est refusé d'emblée (pas de compte Mobile Money) ;
 *   - sinon la collecte reste « pending » jusqu'à ce que l'acheteur « réponde »
 *     (customerResponds : approve, insufficient_funds, declined) ou ne réponde jamais ;
 *   - failNextPayouts / failNextRefunds forcent des échecs de reversement ;
 *   - webhooks signés HMAC (en-tête x-simulator-signature: t=<horodatage>,v1=<hex>).
 */
export class SimulatorProvider implements PaymentProvider {
  readonly code = 'simulator';
  private readonly operations = new Map<string, SimOperation>();
  failNextPayouts = 0;
  failNextRefunds = 0;
  /** Quand vrai, reversements et remboursements restent « pending » (confirmation par webhook). */
  asyncDisbursements = false;

  constructor(private readonly webhookSecret: string) {}

  async initiateCollection(request: TransferRequest): Promise<ProviderResult> {
    const existing = this.operations.get(request.reference);
    if (existing) return existing.result; // idempotence par référence
    const result: ProviderResult = request.msisdn.endsWith('99')
      ? { status: 'failed', failureCode: 'invalid_account' }
      : { status: 'pending', providerRef: `SIM-C-${randomUUID().slice(0, 8)}` };
    this.operations.set(request.reference, { kind: 'collection', request, result });
    return result;
  }

  async initiatePayout(request: TransferRequest): Promise<ProviderResult> {
    return this.disburse(
      'payout',
      request,
      () => this.failNextPayouts > 0 && this.failNextPayouts-- > 0,
    );
  }

  async initiateRefund(request: RefundRequest): Promise<ProviderResult> {
    return this.disburse(
      'refund',
      request,
      () => this.failNextRefunds > 0 && this.failNextRefunds-- > 0,
    );
  }

  async lookup(kind: OperationKind, reference: string): Promise<LookupResult> {
    const op = this.operations.get(reference);
    if (!op || op.kind !== kind) return { found: false, status: 'failed' };
    return { found: true, ...op.result };
  }

  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    now: Date,
  ): ProviderEvent | null {
    const header = headers['x-simulator-signature'];
    if (typeof header !== 'string') return null;
    const parts = Object.fromEntries(
      header.split(',').map((p) => p.split('=') as [string, string]),
    );
    const timestamp = Number(parts.t);
    if (!parts.v1 || !Number.isFinite(timestamp)) return null;
    // Rejeu d'un vieux webhook capturé : refusé au-delà de 5 minutes.
    if (Math.abs(now.getTime() / 1000 - timestamp) > 300) return null;
    if (
      !safeEqualHex(hmac(this.webhookSecret, `${timestamp}.${rawBody.toString('utf8')}`), parts.v1)
    )
      return null;
    const body = JSON.parse(rawBody.toString('utf8')) as Omit<ProviderEvent, 'occurredAt'> & {
      occurredAt: string;
    };
    return { ...body, occurredAt: new Date(body.occurredAt) };
  }

  // ---- Commandes de simulation (tests, recette, route /dev en développement) ----

  /** L'acheteur valide (ou non) la demande sur son téléphone. Renvoie l'événement webhook. */
  customerResponds(
    reference: string,
    outcome: 'approve' | 'insufficient_funds' | 'declined',
    fee = 0,
  ): ProviderEvent {
    const op = this.operations.get(reference);
    if (!op || op.kind !== 'collection') throw new Error(`Collecte inconnue : ${reference}`);
    op.result =
      outcome === 'approve'
        ? { status: 'succeeded', providerRef: op.result.providerRef, ...(fee ? { fee } : {}) }
        : { status: 'failed', providerRef: op.result.providerRef, failureCode: outcome };
    return this.eventFor(op);
  }

  /** Confirme un reversement / remboursement resté en attente (mode asyncDisbursements). */
  settle(reference: string, status: 'succeeded' | 'failed' = 'succeeded'): ProviderEvent {
    const op = this.operations.get(reference);
    if (!op) throw new Error(`Opération inconnue : ${reference}`);
    op.result = {
      status,
      providerRef: op.result.providerRef,
      ...(status === 'failed' ? { failureCode: 'provider_error' } : {}),
    };
    return this.eventFor(op);
  }

  /** Produit un webhook signé, prêt à être posté sur /v1/webhooks/payments/simulator. */
  signWebhook(event: ProviderEvent, now: Date): { body: string; headers: Record<string, string> } {
    const body = JSON.stringify(event);
    const t = Math.floor(now.getTime() / 1000);
    return {
      body,
      headers: {
        'content-type': 'application/json',
        'x-simulator-signature': `t=${t},v1=${hmac(this.webhookSecret, `${t}.${body}`)}`,
      },
    };
  }

  private disburse(
    kind: 'payout' | 'refund',
    request: TransferRequest,
    shouldFail: () => boolean,
  ): ProviderResult {
    const existing = this.operations.get(request.reference);
    if (existing && existing.result.status !== 'failed') return existing.result;
    const providerRef = `SIM-${kind === 'payout' ? 'P' : 'R'}-${randomUUID().slice(0, 8)}`;
    const result: ProviderResult = shouldFail()
      ? {
          status: 'failed',
          providerRef,
          failureCode: 'provider_error',
          failureMessage: 'Opérateur indisponible',
        }
      : { status: this.asyncDisbursements ? 'pending' : 'succeeded', providerRef };
    this.operations.set(request.reference, { kind, request, result });
    return result;
  }

  private eventFor(op: SimOperation): ProviderEvent {
    return {
      eventId: randomUUID(),
      kind: op.kind,
      reference: op.request.reference,
      occurredAt: new Date(),
      ...op.result,
    };
  }
}
