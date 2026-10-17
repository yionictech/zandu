import { ApiError, unwrap } from '@zandu/api-client';
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { field, mine, userClient, withParam } from '@/lib/api';
import { displayPhone, formatXaf, suggestOperator } from '@/lib/format';
import { GUARANTEE, OPERATORS } from '@/lib/labels';
import { ClearPurchased } from '@/components/ClearPurchased';
import { PaymentWaiting } from '@/components/PaymentWaiting';
import { SubmitButton } from '@/components/SubmitButton';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Paiement', robots: { index: false } };

async function pay(checkoutId: string, form: FormData) {
  'use server';
  const back = `/paiement/${checkoutId}`;
  let paymentId: string;
  try {
    const api = await userClient();
    const payment = unwrap(
      await api.POST('/v1/checkouts/{id}/payments', {
        params: {
          path: { id: checkoutId },
          header: { 'Idempotency-Key': field(form, 'idempotencyKey') },
        },
        body: {
          operator: field(form, 'operator') === 'airtel' ? 'airtel' : 'mtn',
          phone: field(form, 'phone'),
        },
      }),
    );
    paymentId = payment.id;
  } catch (error) {
    // Une demande est déjà en attente (double appui, retour arrière) : on la reprend.
    const pending = error instanceof ApiError && error.code === 'payment_in_progress';
    const existing = pending ? (error.details?.paymentId as string | undefined) : undefined;
    if (existing) redirect(`${back}?p=${existing}`);
    if (error instanceof ApiError && error.status === 401) redirect(`/connexion?suite=${back}`);
    redirect(
      withParam(
        back,
        'erreur',
        error instanceof ApiError ? error.message : 'Pas de connexion, réessayez.',
      ),
    );
  }
  redirect(`${back}?p=${paymentId}`);
}

/**
 * Paiement Mobile Money : opérateur deviné d'après le numéro, montant énorme, puis attente du
 * code PIN avec compte à rebours (docs/ux/02-parcours-et-ecrans.md).
 */
export default async function PaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const back = `/paiement/${id}`;
  const purchased = query.achetes ? query.achetes.split(',') : [];
  const checkout = await mine(back, (api) =>
    api.GET('/v1/checkouts/{id}', { params: { path: { id } } }),
  );

  if (checkout.status === 'paid') {
    const first = checkout.orders[0];
    return (
      <main style={{ maxWidth: 560 }}>
        <ClearPurchased productIds={purchased} />
        <section className="hero success" data-testid="payment-success">
          <div style={{ fontSize: 44, color: 'var(--trust)' }}>✓</div>
          <h1>Paiement reçu</h1>
          <div className="amount">{formatXaf(checkout.grandTotal)}</div>
          {checkout.orders.map((o) => (
            <div key={o.id} className="small">
              {o.publicRef} · {o.seller.shopName}
            </div>
          ))}
        </section>
        <section className="guarantee">
          <strong>🛡 Garantie Zandu.</strong> {GUARANTEE}
        </section>
        <p>
          Le vendeur est prévenu. Votre <strong>code de remise</strong> arrive par SMS : ne le
          donnez au livreur qu’une fois le colis en main.
        </p>
        <Link
          href={checkout.orders.length === 1 && first ? `/commandes/${first.id}` : '/commandes'}
          className="button trust block"
          data-testid="payment-track"
        >
          Suivre ma commande
        </Link>
      </main>
    );
  }

  if (checkout.status === 'expired') {
    return (
      <main style={{ maxWidth: 560 }}>
        <section className="hero waiting">
          <h1>Le délai est passé</h1>
          <p>Ce panier a expiré. Les articles sont remis en vente.</p>
        </section>
        <Link href="/panier" className="button block">
          Recommencer
        </Link>
      </main>
    );
  }

  let failure = query.erreur ?? null;
  if (query.p) {
    const payment = await mine(back, (api) =>
      api.GET('/v1/payments/{id}', { params: { path: { id: query.p! } } }),
    );
    if (payment.status === 'pending' || payment.status === 'created') {
      return (
        <main style={{ maxWidth: 560 }}>
          <ClearPurchased productIds={purchased} />
          <section className="hero waiting" data-testid="payment-waiting">
            <h1>Validez sur votre téléphone</h1>
            <div className="amount">{formatXaf(payment.amount)}</div>
            <div>
              {OPERATORS[payment.operator]} · {displayPhone(payment.msisdn)}
            </div>
            <PaymentWaiting
              paymentId={payment.id}
              expiresAt={payment.expiresAt}
              retryHref={back}
              simulator={process.env.ZANDU_SIMULATOR === '1'}
            />
            <p>Tapez votre code PIN dans la fenêtre qui s’est ouverte sur votre téléphone.</p>
          </section>
          <section className="guarantee">
            <strong>🛡</strong> Votre argent reste bloqué jusqu’à la livraison.
          </section>
          <p className="small muted">
            Pas de fenêtre ? Ouvrez le menu Mobile Money de votre opérateur et validez le paiement
            en attente.
          </p>
        </main>
      );
    }
    // Refus immédiat (solde insuffisant, numéro sans compte…) : message de l'agrégateur.
    failure ??=
      payment.failure?.message ?? (payment.status === 'expired' ? 'La demande a expiré.' : null);
  }

  const me = await mine(back, (api) => api.GET('/v1/me'));
  const phone = displayPhone(me.phone);
  const suggested = suggestOperator(me.phone) ?? 'mtn';
  return (
    <main style={{ maxWidth: 560 }}>
      <ClearPurchased productIds={purchased} />
      <h1>Paiement</h1>
      {failure ? (
        <p className="error" role="alert">
          {failure}
        </p>
      ) : null}
      <section className="card stack">
        <h2>Récapitulatif</h2>
        {checkout.orders.map((o) => (
          <div key={o.id} className="row small">
            <span>
              {o.seller.shopName} ({o.items.reduce((n, i) => n + i.quantity, 0)} art.)
            </span>
            <span>{formatXaf(o.itemsSubtotal)}</span>
          </div>
        ))}
        <div className="row small">
          <span>Livraison</span>
          <span>{formatXaf(checkout.deliveryTotal)}</span>
        </div>
        <div className="row">
          <strong>Total</strong>
          <strong className="price" style={{ fontSize: 22 }}>
            {formatXaf(checkout.grandTotal)}
          </strong>
        </div>
      </section>
      <form action={pay.bind(null, id)} className="card stack">
        <input type="hidden" name="idempotencyKey" value={randomUUID()} />
        <div className="options" role="radiogroup" aria-label="Payer avec">
          {(['mtn', 'airtel'] as const).map((op) => (
            <label key={op} className="option">
              <input type="radio" name="operator" value={op} defaultChecked={op === suggested} />
              {OPERATORS[op]}
            </label>
          ))}
        </div>
        <label>
          Numéro Mobile Money
          <input name="phone" type="tel" defaultValue={phone} required autoComplete="tel" />
        </label>
        <SubmitButton testId="payment-pay">Payer {formatXaf(checkout.grandTotal)}</SubmitButton>
      </form>
      <section className="guarantee">
        <strong>🛡 Garantie Zandu.</strong> {GUARANTEE}
      </section>
    </main>
  );
}
