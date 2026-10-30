import { createHash, createPrivateKey, sign, type KeyObject } from 'node:crypto';
import type { MobileOperator } from '@zandu/domain';
import type {
  LookupResult,
  OperationKind,
  PaymentProvider,
  ProviderEvent,
  ProviderResult,
  ProviderStatement,
  RefundRequest,
  StatementLine,
  TransferRequest,
  WebhookOutcome,
} from './provider.js';

/**
 * Adaptateur pawaPay, API v2 (docs.pawapay.io/v2, décision D1). Le Congo y est couvert par
 * MTN_MOMO_COG et AIRTEL_COG, en XAF sans décimales, avec validation par code PIN sur le
 * téléphone (PROVIDER_AUTH) : exactement le parcours de Zandu.
 *
 * - Nos références (UUID) servent de depositId / payoutId / refundId : pawaPay ignore un doublon
 *   (DUPLICATE_IGNORED), l'argent ne bouge jamais deux fois.
 * - Rappels (callbacks) : leur contenu n'est jamais cru. On n'en retient que l'identifiant et on
 *   relit l'état chez pawaPay ; un faux rappel ne peut au pire que déclencher une lecture.
 * - Signature des demandes de paiement (RFC 9421, facultative mais recommandée) : si une clé
 *   privée est fournie, chaque collecte, reversement et remboursement est signé ; pawaPay refuse
 *   alors toute demande non signée, même avec un jeton volé.
 * - Relevé : fichier CSV généré par pawaPay (POST /v2/statements), attendu par interrogation.
 *
 * À valider sur le bac à sable avant la production (docs/exploitation/points-bloquants.md) :
 * colonnes et signes du relevé, codes d'échec réellement renvoyés au Congo.
 */
export interface PawapayOptions {
  apiToken: string;
  /** https://api.sandbox.pawapay.io (bac à sable) ou https://api.pawapay.io (production). */
  baseUrl: string;
  /** Adresse où pawaPay poste ses rappels (relevés compris) : …/v1/webhooks/payments/pawapay. */
  callbackUrl: string;
  /** Clé privée EC P-256 (PEM) et son identifiant déclaré dans le tableau de bord pawaPay. */
  signingKey?: { pem: string; keyId: string } | null;
  fetch?: typeof fetch;
  /** Attente entre deux lectures de l'état du relevé (tests : 0). */
  statementPollMs?: number;
  statementMaxPolls?: number;
}

const PROVIDERS: Record<MobileOperator, string> = { mtn: 'MTN_MOMO_COG', airtel: 'AIRTEL_COG' };

const PATHS: Record<OperationKind, string> = {
  collection: '/v2/deposits',
  payout: '/v2/payouts',
  refund: '/v2/refunds',
};
const ID_FIELD: Record<OperationKind, string> = {
  collection: 'depositId',
  payout: 'payoutId',
  refund: 'refundId',
};

/** Codes pawaPay → codes internes (messages à l'acheteur : provider.ts, failureMessage). */
const FAILURES: Record<string, string> = {
  INSUFFICIENT_BALANCE: 'insufficient_funds',
  PAYMENT_NOT_APPROVED: 'declined',
  PAYER_NOT_FOUND: 'invalid_account',
  RECIPIENT_NOT_FOUND: 'invalid_account',
  INVALID_PHONE_NUMBER: 'invalid_account',
  WALLET_LIMIT_REACHED: 'limit_exceeded',
  AMOUNT_OUT_OF_BOUNDS: 'limit_exceeded',
  PROVIDER_TEMPORARILY_UNAVAILABLE: 'provider_error',
  PAWAPAY_WALLET_OUT_OF_FUNDS: 'provider_balance_insufficient',
};

interface PawapayFailure {
  failureCode?: string;
  failureMessage?: string;
}

interface PawapayPayment {
  status: string;
  providerTransactionId?: string;
  failureReason?: PawapayFailure;
}

const msisdn = (e164: string) => e164.replace(/^\+/, '');

/** Message affiché sur le reçu de l'opérateur : 4 à 22 lettres, chiffres ou espaces. */
export function customerMessage(description: string): string {
  const clean = description
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 22)
    .trim();
  return clean.length >= 4 ? clean : 'Zandu';
}

function failed(failure: PawapayFailure | undefined): ProviderResult {
  const code = failure?.failureCode ?? 'UNKNOWN_ERROR';
  return {
    status: 'failed',
    failureCode: FAILURES[code] ?? code.toLowerCase(),
    ...(failure?.failureMessage ? { failureMessage: failure.failureMessage } : {}),
  };
}

/** État pawaPay → état interne. ACCEPTED, ENQUEUED, PROCESSING, IN_RECONCILIATION : en cours. */
function statusOf(payment: PawapayPayment): ProviderResult {
  if (payment.status === 'COMPLETED')
    return {
      status: 'succeeded',
      ...(payment.providerTransactionId ? { providerRef: payment.providerTransactionId } : {}),
    };
  if (payment.status === 'FAILED') return failed(payment.failureReason);
  return { status: 'pending' };
}

export class PawapayProvider implements PaymentProvider {
  readonly code = 'pawapay';
  private readonly fetchImpl: typeof fetch;
  private readonly key: { object: KeyObject; id: string } | null;

  constructor(private readonly options: PawapayOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.key = options.signingKey
      ? { object: createPrivateKey(options.signingKey.pem), id: options.signingKey.keyId }
      : null;
  }

  initiateCollection(request: TransferRequest): Promise<ProviderResult> {
    return this.initiate('collection', {
      depositId: request.reference,
      amount: String(request.amount),
      currency: request.currency,
      payer: this.account(request),
      customerMessage: customerMessage(request.description),
    });
  }

  initiatePayout(request: TransferRequest): Promise<ProviderResult> {
    return this.initiate('payout', {
      payoutId: request.reference,
      amount: String(request.amount),
      currency: request.currency,
      recipient: this.account(request),
      customerMessage: customerMessage(request.description),
    });
  }

  initiateRefund(request: RefundRequest): Promise<ProviderResult> {
    return this.initiate('refund', {
      refundId: request.reference,
      depositId: request.originalReference,
      amount: String(request.amount),
      currency: request.currency,
    });
  }

  async lookup(kind: OperationKind, reference: string): Promise<LookupResult> {
    const res = await this.call('GET', `${PATHS[kind]}/${encodeURIComponent(reference)}`);
    const body = (await res.json()) as { status: string; data?: PawapayPayment };
    if (body.status !== 'FOUND' || !body.data) return { found: false, status: 'failed' };
    return { found: true, ...statusOf(body.data) };
  }

  /**
   * Rappel de pawaPay : on relit l'opération chez pawaPay et l'état lu fait foi. Les rappels de
   * relevé et les états intermédiaires sont acquittés sans effet.
   */
  async parseWebhook(rawBody: Buffer, _headers: unknown, now: Date): Promise<WebhookOutcome> {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (typeof body.statementId === 'string') return 'ignored';
    const kind = (Object.keys(ID_FIELD) as OperationKind[]).find(
      (k) => typeof body[ID_FIELD[k]] === 'string',
    );
    if (!kind) return null;
    const reference = body[ID_FIELD[kind]] as string;
    if (!/^[0-9a-f-]{36}$/i.test(reference)) return null;
    const found = await this.lookup(kind, reference);
    if (!found.found || found.status === 'pending') return 'ignored';
    const { found: _found, ...result } = found;
    return {
      ...result,
      eventId: `${kind}:${reference}:${result.status}`,
      kind,
      reference,
      occurredAt: now,
    } satisfies ProviderEvent;
  }

  /**
   * Relevé du portefeuille XAF du Congo : demande de génération, attente, puis lecture du CSV.
   * Les frais (lignes « … fees » / « … fee ») sont rattachés à l'opération de même identifiant ;
   * un reversement échoué puis restitué (« Failed payout refund ») n'apparaît pas.
   */
  async fetchStatement(from: Date, to: Date): Promise<ProviderStatement> {
    const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, '');
    const created = await this.call('POST', '/v2/statements', {
      wallet: { country: 'COG', currency: 'XAF' },
      callbackUrl: this.options.callbackUrl,
      startDate: iso(from),
      endDate: iso(new Date(to.getTime() - 1000)),
      compressed: false,
    });
    const accepted = (await created.json()) as {
      status: string;
      statementId?: string;
      failureReason?: PawapayFailure;
    };
    if (accepted.status !== 'ACCEPTED' || !accepted.statementId)
      throw new Error(`Relevé pawaPay refusé : ${accepted.failureReason?.failureCode ?? '?'}`);

    const pollMs = this.options.statementPollMs ?? 15_000;
    const maxPolls = this.options.statementMaxPolls ?? 40;
    for (let attempt = 0; attempt < maxPolls; attempt++) {
      const res = await this.call('GET', `/v2/statements/${accepted.statementId}`);
      const found = (await res.json()) as {
        data?: { status: string; downloadUrl?: string };
      };
      if (found.data?.status === 'COMPLETED' && found.data.downloadUrl) {
        const file = await this.fetchImpl(found.data.downloadUrl);
        if (!file.ok) throw new Error(`Relevé pawaPay : téléchargement ${file.status}`);
        return parseStatementCsv(await file.text(), from, to);
      }
      if (found.data?.status === 'FAILED') throw new Error('Relevé pawaPay : génération échouée');
      if (pollMs > 0) await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    throw new Error('Relevé pawaPay : toujours en préparation, nouvel essai plus tard');
  }

  private account(request: TransferRequest) {
    return {
      type: 'MMO',
      accountDetails: {
        phoneNumber: msisdn(request.msisdn),
        provider: PROVIDERS[request.operator],
      },
    };
  }

  private async initiate(kind: OperationKind, body: object): Promise<ProviderResult> {
    const res = await this.call('POST', PATHS[kind], body);
    if (res.status >= 500) return { status: 'pending' }; // UNKNOWN_ERROR : l'état se relira
    const answer = (await res.json()) as { status?: string; failureReason?: PawapayFailure };
    if (res.ok && (answer.status === 'ACCEPTED' || answer.status === 'DUPLICATE_IGNORED'))
      return { status: 'pending' };
    if (res.ok && answer.status === 'REJECTED') return failed(answer.failureReason);
    // Erreur technique (jeton, signature, paramètre) : rien n'a bougé, c'est à corriger chez nous.
    throw new Error(
      `pawaPay ${res.status} : ${answer.failureReason?.failureCode ?? 'réponse inattendue'}`,
    );
  }

  private call(method: 'GET' | 'POST', path: string, body?: object): Promise<Response> {
    const url = new URL(path, this.options.baseUrl);
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.options.apiToken}`,
      accept: 'application/json',
    };
    let payload: string | undefined;
    if (body) {
      payload = JSON.stringify(body);
      headers['content-type'] = 'application/json; charset=UTF-8';
      if (this.key && path !== '/v2/statements') Object.assign(headers, this.sign(url, payload));
    }
    return this.fetchImpl(url, { method, headers, body: payload });
  }

  /** Signature RFC 9421 (ecdsa-p256-sha256), comme l'exemple de pawaPay. */
  private sign(url: URL, payload: string): Record<string, string> {
    const key = this.key!;
    const digest = `sha-512=:${createHash('sha512').update(payload).digest('base64')}:`;
    const date = new Date().toISOString();
    const created = Math.floor(Date.now() / 1000);
    const contentType = 'application/json; charset=UTF-8';
    const params = `("@method" "@authority" "@path" "signature-date" "content-digest" "content-type");alg="ecdsa-p256-sha256";keyid="${key.id}";created=${created};expires=${created + 60}`;
    const base = [
      `"@method": POST`,
      `"@authority": ${url.host}`,
      `"@path": ${url.pathname}`,
      `"signature-date": ${date}`,
      `"content-digest": ${digest}`,
      `"content-type": ${contentType}`,
      `"@signature-params": ${params}`,
    ].join('\n');
    const signature = sign('sha256', Buffer.from(base), key.object).toString('base64');
    return {
      'content-digest': digest,
      'signature-date': date,
      signature: `sig-pp=:${signature}:`,
      'signature-input': `sig-pp=${params}`,
    };
  }
}

/** Découpe une ligne CSV (guillemets doublés, virgules dans les champs). */
function csvRow(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      cells.push(cell);
      cell = '';
    } else cell += c;
  }
  cells.push(cell);
  return cells.map((v) => v.trim());
}

type Movement = { kind: OperationKind | 'other'; sign: 1 | -1 } | 'fee' | 'reversal';

/** Types de mouvement du relevé pawaPay (tableau de bord › Statements › Transaction types). */
function movementOf(type: string): Movement {
  const t = type.toLowerCase();
  if (t.includes('fee')) return 'fee';
  if (t === 'failed payout refund' || t === 'failed refund reversal') return 'reversal';
  if (t === 'deposit') return { kind: 'collection', sign: 1 };
  if (t === 'payout') return { kind: 'payout', sign: -1 };
  if (t === 'refund') return { kind: 'refund', sign: -1 };
  if (t.startsWith('top up') || t === 'cancelled withdrawal reversal')
    return { kind: 'other', sign: 1 };
  return { kind: 'other', sign: -1 };
}

/**
 * Relevé CSV pawaPay → lignes internes. Colonnes : Creation date, MSISDN, Transaction ID, Amount,
 * MNO, Type, Balance, Reason, Metadata. Le montant est pris en valeur absolue et signé par le type,
 * sauf pour les ajustements manuels, où le signe du fichier fait foi.
 */
export function parseStatementCsv(csv: string, from: Date, to: Date): ProviderStatement {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const header = csvRow(lines[0] ?? '').map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const at = { date: col('creation date'), id: col('transaction id'), amount: col('amount') };
  const type = col('type');
  const balance = col('balance');
  const reason = col('reason');
  if ([at.date, at.id, at.amount, type].some((i) => i < 0))
    throw new Error(`Relevé pawaPay : colonnes inattendues (${header.join(', ')})`);

  const operations = new Map<string, StatementLine>();
  const fees = new Map<string, number>();
  const reversed = new Set<string>();
  const others: StatementLine[] = [];
  let closingBalance: number | null = null;

  for (const raw of lines.slice(1)) {
    const cells = csvRow(raw);
    const occurredAt = new Date(`${cells[at.date]!.replace(' ', 'T').replace(/Z?$/, 'Z')}`);
    if (Number.isNaN(occurredAt.getTime()) || occurredAt < from || occurredAt >= to) continue;
    const value = Number(cells[at.amount]!.replace(/[\s ]/g, ''));
    if (!Number.isFinite(value)) continue;
    const amount = Math.round(Math.abs(value));
    const id = cells[at.id] || null;
    const movement = movementOf(cells[type] ?? '');
    if (balance >= 0 && cells[balance]) closingBalance = Math.round(Number(cells[balance]));

    if (movement === 'fee') {
      if (id) fees.set(id, (fees.get(id) ?? 0) + amount);
      else
        others.push({
          kind: 'other',
          reference: null,
          providerRef: `fee:${cells[at.date]}`,
          amount: -amount,
          fee: 0,
          occurredAt,
        });
    } else if (movement === 'reversal') {
      if (id) reversed.add(id);
    } else if (movement.kind !== 'other' && id) {
      operations.set(id, {
        kind: movement.kind,
        reference: id,
        providerRef: id,
        amount: movement.sign * amount,
        fee: 0,
        occurredAt,
      });
    } else {
      const adjustment = (cells[type] ?? '').toLowerCase().startsWith('adjustment');
      others.push({
        kind: 'other',
        reference: null,
        providerRef: id ?? `${cells[type]}:${cells[at.date]}`,
        amount: adjustment ? Math.round(value) : movement.sign * amount,
        fee: 0,
        occurredAt,
        description: [cells[type], reason >= 0 ? cells[reason] : ''].filter(Boolean).join(' : '),
      });
    }
  }

  const result: StatementLine[] = [];
  for (const [id, line] of operations) {
    if (reversed.has(id)) continue;
    result.push({ ...line, fee: fees.get(id) ?? 0 });
    fees.delete(id);
  }
  // Frais sans opération sur la période (opération de la veille) : mouvement du compte.
  for (const [id, fee] of fees)
    result.push({
      kind: 'other',
      reference: null,
      providerRef: `fee:${id}`,
      amount: 0,
      fee,
      occurredAt: to,
    });
  return { lines: [...result, ...others], closingBalance };
}
