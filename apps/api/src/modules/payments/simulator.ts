import { randomUUID } from 'node:crypto';
import type { Db } from '../../db/pool.js';
import type { Clock } from '../../lib/clock.js';
import { hmac, safeEqualHex } from '../../lib/crypto.js';
import type {
  LookupResult,
  OperationKind,
  PaymentProvider,
  ProviderEvent,
  ProviderResult,
  ProviderStatement,
  ProviderStatus,
  RefundRequest,
  TransferRequest,
} from './provider.js';

interface OperationRow {
  provider_ref: string;
  reference: string | null;
  kind: OperationKind | 'other';
  amount: number;
  fee: number;
  fee_announced: boolean;
  status: ProviderStatus;
  failure_code: string | null;
}

/** Frais par type d'opération, en points de base (150 = 1,5 %). */
export type SimulatorFees = Record<OperationKind, number>;

const shortId = () => randomUUID().slice(0, 8);

function resultOf(op: OperationRow): ProviderResult {
  return {
    status: op.status,
    providerRef: op.provider_ref,
    ...(op.failure_code ? { failureCode: op.failure_code } : {}),
    ...(op.failure_code === 'provider_error' ? { failureMessage: 'Opérateur indisponible' } : {}),
    ...(op.fee_announced && op.fee > 0 ? { fee: op.fee } : {}),
  };
}

/**
 * Agrégateur simulé, pour le développement, les tests et la recette des applications.
 * Interdit en production (voir config.ts). Il reproduit les comportements du cahier §5 :
 *   - un numéro finissant par 99 est refusé d'emblée (pas de compte Mobile Money) ;
 *   - sinon la collecte reste « pending » jusqu'à ce que l'acheteur « réponde »
 *     (customerResponds : approve, insufficient_funds, declined) ou ne réponde jamais ;
 *   - failNextPayouts / failNextRefunds forcent des échecs de reversement ;
 *   - webhooks signés HMAC (en-tête x-simulator-signature: t=<horodatage>,v1=<hex>).
 * Il tient ses propres comptes (schéma `simulator`), indépendants des nôtres : l'API et le
 * worker les partagent, et son relevé quotidien sert au rapprochement (ADR-0015).
 */
export class SimulatorProvider implements PaymentProvider {
  readonly code = 'simulator';
  failNextPayouts = 0;
  failNextRefunds = 0;
  /** Quand vrai, reversements et remboursements restent « pending » (confirmation par webhook). */
  asyncDisbursements = false;
  /** Frais prélevés sur les opérations réussies, visibles au relevé seulement (comme souvent en vrai). */
  feeBps: SimulatorFees = { collection: 0, payout: 0, refund: 0 };

  constructor(
    private readonly webhookSecret: string,
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  async initiateCollection(request: TransferRequest): Promise<ProviderResult> {
    const refused = request.msisdn.endsWith('99');
    // Idempotence par référence : une seconde demande renvoie la première.
    await this.db.query(
      `INSERT INTO simulator.operations
         (provider_ref, reference, kind, amount, msisdn, status, failure_code, created_at)
       VALUES ($1, $2, 'collection', $3, $4, $5, $6, $7) ON CONFLICT (reference) DO NOTHING`,
      [
        `SIM-C-${shortId()}`,
        request.reference,
        request.amount,
        request.msisdn,
        refused ? 'failed' : 'pending',
        refused ? 'invalid_account' : null,
        this.clock.now(),
      ],
    );
    return resultOf((await this.find(request.reference))!);
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
    const op = await this.find(reference);
    if (!op || op.kind !== kind) return { found: false, status: 'failed' };
    return { found: true, ...resultOf(op) };
  }

  async fetchStatement(from: Date, to: Date): Promise<ProviderStatement> {
    const { rows } = await this.db.query<
      Pick<OperationRow, 'provider_ref' | 'reference' | 'kind' | 'amount' | 'fee'> & {
        settled_at: Date;
        description: string | null;
      }
    >(
      `SELECT provider_ref, reference, kind, amount, fee, settled_at, description
       FROM simulator.operations
       WHERE status = 'succeeded' AND listed AND settled_at >= $1 AND settled_at < $2
       ORDER BY settled_at, provider_ref`,
      [from, to],
    );
    const { rows: balance } = await this.db.query<{ total: number }>(
      `SELECT coalesce(sum(amount - fee), 0)::bigint AS total FROM simulator.operations
       WHERE status = 'succeeded' AND settled_at < $1`,
      [to],
    );
    return {
      lines: rows.map((r) => ({
        kind: r.kind,
        reference: r.reference,
        providerRef: r.provider_ref,
        amount: r.amount,
        fee: r.fee,
        occurredAt: r.settled_at,
        ...(r.description ? { description: r.description } : {}),
      })),
      closingBalance: balance[0]!.total,
    };
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

  // ---- Commandes de simulation (tests, recette, routes /dev hors production) ----

  /**
   * L'acheteur valide (ou non) la demande sur son téléphone. Renvoie l'événement webhook.
   * `fee` : frais annoncés dans le webhook (sinon, ceux du barème n'apparaissent qu'au relevé).
   */
  async customerResponds(
    reference: string,
    outcome: 'approve' | 'insufficient_funds' | 'declined',
    fee?: number,
  ): Promise<ProviderEvent> {
    const op = await this.find(reference);
    if (!op || op.kind !== 'collection') throw new Error(`Collecte inconnue : ${reference}`);
    return this.eventFor(
      outcome === 'approve'
        ? await this.conclude(op, 'succeeded', null, fee)
        : await this.conclude(op, 'failed', outcome),
    );
  }

  /** Confirme un reversement / remboursement resté en attente (mode asyncDisbursements). */
  async settle(
    reference: string,
    status: 'succeeded' | 'failed' = 'succeeded',
  ): Promise<ProviderEvent> {
    const op = await this.find(reference);
    if (!op) throw new Error(`Opération inconnue : ${reference}`);
    return this.eventFor(
      await this.conclude(op, status, status === 'failed' ? 'provider_error' : null),
    );
  }

  /**
   * Mouvement propre à l'agrégateur, sans référence Zandu (frais de tenue de compte, apport
   * de fonds). `listed: false` : il pèse sur le solde sans figurer au relevé détaillé.
   */
  async addAccountMovement(input: {
    amount: number;
    description: string;
    listed?: boolean;
  }): Promise<string> {
    const providerRef = `SIM-X-${shortId()}`;
    const now = this.clock.now();
    await this.db.query(
      `INSERT INTO simulator.operations
         (provider_ref, kind, amount, status, listed, description, settled_at, created_at)
       VALUES ($1, 'other', $2, 'succeeded', $3, $4, $5, $5)`,
      [providerRef, input.amount, input.listed ?? true, input.description, now],
    );
    return providerRef;
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

  private async find(reference: string): Promise<OperationRow | null> {
    const { rows } = await this.db.query<OperationRow>(
      'SELECT * FROM simulator.operations WHERE reference = $1',
      [reference],
    );
    return rows[0] ?? null;
  }

  private feeFor(kind: OperationKind, amount: number): number {
    return Math.round((Math.abs(amount) * this.feeBps[kind]) / 10_000);
  }

  /** Issue d'une opération : l'argent bouge (et les frais tombent) au succès seulement. */
  private async conclude(
    op: OperationRow,
    status: 'succeeded' | 'failed',
    failureCode: string | null,
    announcedFee?: number,
  ): Promise<OperationRow> {
    const succeeded = status === 'succeeded';
    const fee = succeeded ? (announcedFee ?? this.feeFor(op.kind as OperationKind, op.amount)) : 0;
    const { rows } = await this.db.query<OperationRow>(
      `UPDATE simulator.operations SET status = $2, failure_code = $3, fee = $4,
              fee_announced = $5, settled_at = $6
       WHERE provider_ref = $1 RETURNING *`,
      [
        op.provider_ref,
        status,
        failureCode,
        fee,
        succeeded && announcedFee !== undefined,
        succeeded ? this.clock.now() : null,
      ],
    );
    return rows[0]!;
  }

  private async disburse(
    kind: 'payout' | 'refund',
    request: TransferRequest,
    shouldFail: () => boolean,
  ): Promise<ProviderResult> {
    const existing = await this.find(request.reference);
    if (existing && existing.status !== 'failed') return resultOf(existing);
    const status = shouldFail() ? 'failed' : this.asyncDisbursements ? 'pending' : 'succeeded';
    const now = this.clock.now();
    // Après un échec, la même référence peut être renvoyée : nouvelle opération chez l'agrégateur.
    await this.db.query(
      `INSERT INTO simulator.operations
         (provider_ref, reference, kind, amount, fee, msisdn, status, failure_code, settled_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (reference) DO UPDATE SET provider_ref = EXCLUDED.provider_ref,
         status = EXCLUDED.status, failure_code = EXCLUDED.failure_code, fee = EXCLUDED.fee,
         settled_at = EXCLUDED.settled_at, created_at = EXCLUDED.created_at
       WHERE simulator.operations.status = 'failed'`,
      [
        `SIM-${kind === 'payout' ? 'P' : 'R'}-${shortId()}`,
        request.reference,
        kind,
        -request.amount,
        status === 'succeeded' ? this.feeFor(kind, request.amount) : 0,
        request.msisdn,
        status,
        status === 'failed' ? 'provider_error' : null,
        status === 'succeeded' ? now : null,
        now,
      ],
    );
    return resultOf((await this.find(request.reference))!);
  }

  private eventFor(op: OperationRow): ProviderEvent {
    return {
      eventId: randomUUID(),
      kind: op.kind as OperationKind,
      reference: op.reference!,
      occurredAt: this.clock.now(),
      ...resultOf(op),
    };
  }
}
