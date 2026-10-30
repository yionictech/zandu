import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  customerMessage,
  parseStatementCsv,
  PawapayProvider,
} from '../src/modules/payments/pawapay.js';

/** Réponses tirées des exemples de la documentation pawaPay v2. */
interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeApi(routes: Record<string, (sent: Sent) => [number, unknown] | string>) {
  const sent: Sent[] = [];
  const fetchImpl = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    const request: Sent = {
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    sent.push(request);
    const key = `${request.method} ${new URL(url).pathname}`;
    const route = routes[key];
    if (!route) throw new Error(`Route non prévue : ${key}`);
    const answer = route(request);
    if (typeof answer === 'string') return new Response(answer, { status: 200 });
    return new Response(JSON.stringify(answer[1]), { status: answer[0] });
  }) as typeof fetch;
  return { sent, fetchImpl };
}

const REF = '1b4c6f2e-8a8e-4d7a-9c51-0f0e8a7d2b11';
const DEPOSIT = '6f1d2b7a-3c4e-4f5a-9b8c-1d2e3f4a5b6c';
const request = {
  reference: REF,
  amount: 15000,
  currency: 'XAF' as const,
  msisdn: '+242061234567',
  operator: 'mtn' as const,
  description: 'Commande Zandu n° 42 — Pagne wax',
};

const provider = (fetchImpl: typeof fetch, extra: object = {}) =>
  new PawapayProvider({
    apiToken: 'jeton-de-bac-a-sable-123456',
    baseUrl: 'https://api.sandbox.pawapay.io',
    callbackUrl: 'https://api.recette.zandu.cg/v1/webhooks/payments/pawapay',
    fetch: fetchImpl,
    statementPollMs: 0,
    ...extra,
  });

describe('Adaptateur pawaPay (D1)', () => {
  it('collecte : numéro sans « + », opérateur du Congo, montant entier, message nettoyé', async () => {
    const api = fakeApi({
      'POST /v2/deposits': () => [
        200,
        { depositId: REF, status: 'ACCEPTED', created: '2026-10-30T07:38:56Z' },
      ],
    });
    expect(await provider(api.fetchImpl).initiateCollection(request)).toEqual({
      status: 'pending',
    });
    expect(api.sent[0]!.body).toEqual({
      depositId: REF,
      amount: '15000',
      currency: 'XAF',
      payer: {
        type: 'MMO',
        accountDetails: { phoneNumber: '242061234567', provider: 'MTN_MOMO_COG' },
      },
      customerMessage: 'Commande Zandu n 42 Pa',
    });
    expect(api.sent[0]!.headers.authorization).toBe('Bearer jeton-de-bac-a-sable-123456');
  });

  it('refus, doublon et erreur inconnue', async () => {
    let answer: [number, unknown] = [200, { status: 'DUPLICATE_IGNORED' }];
    const api = fakeApi({ 'POST /v2/payouts': () => answer });
    const p = provider(api.fetchImpl);
    const payout = { ...request, operator: 'airtel' as const };
    expect(await p.initiatePayout(payout)).toEqual({ status: 'pending' });
    expect((api.sent[0]!.body as { recipient: unknown }).recipient).toEqual({
      type: 'MMO',
      accountDetails: { phoneNumber: '242061234567', provider: 'AIRTEL_COG' },
    });
    answer = [
      200,
      {
        status: 'REJECTED',
        failureReason: { failureCode: 'AMOUNT_OUT_OF_BOUNDS', failureMessage: 'Hors limites' },
      },
    ];
    expect(await p.initiatePayout(payout)).toEqual({
      status: 'failed',
      failureCode: 'limit_exceeded',
      failureMessage: 'Hors limites',
    });
    // UNKNOWN_ERROR (500) : l'opération a peut-être été créée, on relira son état.
    answer = [500, { failureReason: { failureCode: 'UNKNOWN_ERROR' } }];
    expect(await p.initiatePayout(payout)).toEqual({ status: 'pending' });
    // Erreur technique : jamais un échec silencieux.
    answer = [401, { status: 'REJECTED', failureReason: { failureCode: 'AUTHENTICATION_ERROR' } }];
    await expect(p.initiatePayout(payout)).rejects.toThrow(/AUTHENTICATION_ERROR/);
  });

  it('remboursement de la collecte d’origine', async () => {
    const api = fakeApi({ 'POST /v2/refunds': () => [200, { refundId: REF, status: 'ACCEPTED' }] });
    await provider(api.fetchImpl).initiateRefund({ ...request, originalReference: DEPOSIT });
    expect(api.sent[0]!.body).toEqual({
      refundId: REF,
      depositId: DEPOSIT,
      amount: '15000',
      currency: 'XAF',
    });
  });

  it('état : terminé, échoué (code traduit), en cours, introuvable', async () => {
    let data: unknown = {
      depositId: REF,
      status: 'COMPLETED',
      providerTransactionId: 'MP261030.1234',
    };
    let found = 'FOUND';
    const api = fakeApi({ [`GET /v2/deposits/${REF}`]: () => [200, { status: found, data }] });
    const p = provider(api.fetchImpl);
    expect(await p.lookup('collection', REF)).toEqual({
      found: true,
      status: 'succeeded',
      providerRef: 'MP261030.1234',
    });
    data = { status: 'FAILED', failureReason: { failureCode: 'INSUFFICIENT_BALANCE' } };
    expect(await p.lookup('collection', REF)).toMatchObject({
      status: 'failed',
      failureCode: 'insufficient_funds',
    });
    data = { status: 'IN_RECONCILIATION' };
    expect(await p.lookup('collection', REF)).toEqual({ found: true, status: 'pending' });
    found = 'NOT_FOUND';
    expect(await p.lookup('collection', REF)).toEqual({ found: false, status: 'failed' });
  });

  it('rappel : le contenu n’est pas cru, l’état est relu chez pawaPay', async () => {
    const api = fakeApi({
      [`GET /v2/payouts/${REF}`]: () => [
        200,
        {
          status: 'FOUND',
          data: { status: 'FAILED', failureReason: { failureCode: 'RECIPIENT_NOT_FOUND' } },
        },
      ],
    });
    const p = provider(api.fetchImpl);
    const now = new Date('2026-10-30T08:00:00Z');
    // Faux rappel « COMPLETED » : l'état lu chez pawaPay (échec) l'emporte.
    const forged = Buffer.from(JSON.stringify({ payoutId: REF, status: 'COMPLETED' }));
    expect(await p.parseWebhook(forged, {}, now)).toEqual({
      status: 'failed',
      failureCode: 'invalid_account',
      eventId: `payout:${REF}:failed`,
      kind: 'payout',
      reference: REF,
      occurredAt: now,
    });
    expect(await p.parseWebhook(Buffer.from('{"statementId":"x"}'), {}, now)).toBe('ignored');
    expect(await p.parseWebhook(Buffer.from('pas du json'), {}, now)).toBeNull();
    expect(await p.parseWebhook(Buffer.from('{"depositId":"../admin"}'), {}, now)).toBeNull();
  });

  it('signature RFC 9421 vérifiable avec la clé publique déclarée chez pawaPay', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const api = fakeApi({ 'POST /v2/deposits': () => [200, { status: 'ACCEPTED' }] });
    await provider(api.fetchImpl, {
      signingKey: {
        pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        keyId: 'ZANDU_1',
      },
    }).initiateCollection(request);
    const h = api.sent[0]!.headers;
    const raw = JSON.stringify(api.sent[0]!.body);
    expect(h['content-digest']).toBe(
      `sha-512=:${createHash('sha512').update(raw).digest('base64')}:`,
    );
    const params = h['signature-input']!.replace(/^sig-pp=/, '');
    expect(params).toContain('keyid="ZANDU_1"');
    const base = [
      '"@method": POST',
      '"@authority": api.sandbox.pawapay.io',
      '"@path": /v2/deposits',
      `"signature-date": ${h['signature-date']}`,
      `"content-digest": ${h['content-digest']}`,
      '"content-type": application/json; charset=UTF-8',
      `"@signature-params": ${params}`,
    ].join('\n');
    const signature = Buffer.from(h.signature!.slice('sig-pp=:'.length, -1), 'base64');
    expect(verify('sha256', Buffer.from(base), publicKey, signature)).toBe(true);
  });

  it('relevé : génération attendue, frais rattachés, reversement échoué effacé', async () => {
    let polls = 0;
    const csv = [
      'Creation date,MSISDN,Transaction ID,Amount,MNO,Type,Balance,Reason,Metadata',
      `2026-10-29 08:00:00,242061234567,${DEPOSIT},15000,MTN_MOMO_COG,Deposit,15000,,`,
      `2026-10-29 08:00:01,,${DEPOSIT},-150,MTN_MOMO_COG,Deposit PawaPay fees,14850,,`,
      `2026-10-29 12:00:00,242061234567,${REF},-12000,MTN_MOMO_COG,Payout,2850,,`,
      `2026-10-29 12:00:05,242061234567,${REF},12000,MTN_MOMO_COG,Failed payout refund,14850,,`,
      '2026-10-29 18:00:00,,,-500,,Adjustment - Collections not credited,14350,"Correction, double crédit",',
      `2026-10-30 01:00:00,242061234567,${REF},-1,MTN_MOMO_COG,Payout,14349,,`,
    ].join('\n');
    const api = fakeApi({
      'POST /v2/statements': () => [
        200,
        { statementId: 'f4401bd2-1568-4140-bf2d-eb77d2b2b639', status: 'ACCEPTED' },
      ],
      'GET /v2/statements/f4401bd2-1568-4140-bf2d-eb77d2b2b639': () =>
        ++polls < 2
          ? [200, { status: 'FOUND', data: { status: 'PROCESSING' } }]
          : [
              200,
              {
                status: 'FOUND',
                data: { status: 'COMPLETED', downloadUrl: 'https://files.pawapay.io/releve.csv' },
              },
            ],
      'GET /releve.csv': () => csv,
    });
    const from = new Date('2026-10-29T00:00:00Z');
    const to = new Date('2026-10-30T00:00:00Z');
    const statement = await provider(api.fetchImpl).fetchStatement(from, to);
    expect(api.sent[0]!.body).toMatchObject({
      wallet: { country: 'COG', currency: 'XAF' },
      startDate: '2026-10-29T00:00:00',
      endDate: '2026-10-29T23:59:59',
    });
    expect(statement.lines).toEqual([
      {
        kind: 'collection',
        reference: DEPOSIT,
        providerRef: DEPOSIT,
        amount: 15000,
        fee: 150,
        occurredAt: new Date('2026-10-29T08:00:00Z'),
      },
      {
        kind: 'other',
        reference: null,
        providerRef: 'Adjustment - Collections not credited:2026-10-29 18:00:00',
        amount: -500,
        fee: 0,
        occurredAt: new Date('2026-10-29T18:00:00Z'),
        description: 'Adjustment - Collections not credited : Correction, double crédit',
      },
    ]);
    expect(statement.closingBalance).toBe(14350);
  });

  it('message du reçu : 4 à 22 caractères permis', () => {
    expect(customerMessage('Reversement — Boutique Grâce & Fils')).toBe('Reversement Boutique G');
    expect(customerMessage('é!')).toBe('Zandu');
  });

  it('relevé aux colonnes inattendues : erreur claire plutôt qu’un rapprochement faux', () => {
    expect(() => parseStatementCsv('Date,Montant\n', new Date(0), new Date())).toThrow(
      /colonnes inattendues/,
    );
  });
});
