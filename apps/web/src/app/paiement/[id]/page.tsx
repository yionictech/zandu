import { ApiError, unwrap } from '@zandu/api-client';
import type { Metadata } from 'next';
import { Check, Lock, Package, ShieldCheck, Wallet } from 'lucide-react';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { field, mine, userClient, withParam } from '@/lib/api';
import { displayPhone, formatXaf, suggestOperator } from '@/lib/format';
import { GUARANTEE, OPERATORS } from '@/lib/labels';
import { ClearPurchased } from '@/components/ClearPurchased';
import { PaymentWaiting } from '@/components/PaymentWaiting';
import { Price } from '@/components/Price';
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
        <section className="hero" data-testid="payment-success">
          <span className="success-mark">
            <Check className="icon" aria-hidden strokeWidth={3} />
          </span>
          <h1>Paiement reçu</h1>
          <Price value={checkout.grandTotal} size="xl" />
          {checkout.orders.map((o) => (
            <div key={o.id} className="small muted">
              {o.publicRef} · {o.seller.shopName}
            </div>
          ))}
        </section>
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Où est votre argent ?</h2>
          <div className="money-steps">
            {(
              [
                [Lock, 'Bloqué chez Zandu'],
                [Package, 'Vous recevez le colis'],
                [Wallet, 'Le vendeur est payé'],
              ] as const
            ).map(([Icon, label], i) => (
              <div key={label} className={i === 0 ? 'on' : ''}>
                <span className="icon-box">
                  <Icon className="icon" aria-hidden />
                </span>
                {label}
              </div>
            ))}
          </div>
          <span className="small muted">
            Le vendeur est payé seulement quand vous avez reçu votre colis.
          </span>
        </section>
        <p className="note">
          <Lock className="icon" aria-hidden />
          Votre code de remise arrive par SMS : ne le donnez au livreur qu’une fois le colis en
          main.
        </p>
        <Link
          href={checkout.orders.length === 1 && first ? `/commandes/${first.id}` : '/commandes'}
          className="button block"
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
      const operator = OPERATORS[payment.operator];
      return (
        <main style={{ maxWidth: 560 }}>
          <ClearPurchased productIds={purchased} />
          <section className="hero" data-testid="payment-waiting">
            <PaymentWaiting
              paymentId={payment.id}
              expiresAt={payment.expiresAt}
              retryHref={back}
              simulator={process.env.ZANDU_SIMULATOR === '1'}
            />
            <h1>Validez sur votre téléphone</h1>
            <Price value={payment.amount} size="lg" />
            <div className="small muted">
              {operator} · {displayPhone(payment.msisdn)}
            </div>
          </section>
          <ol className="steps-list card">
            <li>Une fenêtre {operator} s’ouvre sur votre téléphone</li>
            <li>Tapez votre code PIN Mobile Money</li>
            <li>Revenez ici : la confirmation s’affiche toute seule</li>
          </ol>
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
  const prefix = phone.slice(0, 2);
  const lines = checkout.orders.flatMap((o) =>
    o.items.map((i) => ({ ...i, shopName: o.seller.shopName })),
  );
  return (
    <main style={{ maxWidth: 560 }}>
      <ClearPurchased productIds={purchased} />
      <div className="page-title">
        <h1>Paiement</h1>
        <span className="pill-badge">Étape 2 / 2</span>
      </div>
      {failure ? (
        <p className="error" role="alert">
          {failure}
        </p>
      ) : null}
      <section className="card stack">
        {lines.slice(0, 3).map((l) => (
          <div key={l.itemId} className="info-row">
            <span className="icon-box">
              <Package className="icon" aria-hidden />
            </span>
            <div style={{ minWidth: 0 }}>
              <strong className="tile-title" style={{ minHeight: 0 }}>
                {l.title}
              </strong>
              <div className="small muted">
                {l.shopName} · {l.quantity} article{l.quantity > 1 ? 's' : ''}
              </div>
            </div>
          </div>
        ))}
        <div className="row small">
          <span className="muted">Articles</span>
          <span>{formatXaf(checkout.itemsTotal)}</span>
        </div>
        <div className="row small">
          <span className="muted">Livraison</span>
          <span>{formatXaf(checkout.deliveryTotal)}</span>
        </div>
        <div className="row" style={{ alignItems: 'baseline' }}>
          <strong>Total</strong>
          <Price value={checkout.grandTotal} size="md" />
        </div>
      </section>
      <form action={pay.bind(null, id)} className="stack">
        <input type="hidden" name="idempotencyKey" value={randomUUID()} />
        <p className="eyebrow">Payer avec</p>
        <div className="choices" role="radiogroup" aria-label="Payer avec">
          {(['mtn', 'airtel'] as const).map((op) => (
            <label key={op} className="choice" data-testid={`operator-${op}`}>
              <input type="radio" name="operator" value={op} defaultChecked={op === suggested} />
              {OPERATORS[op]}
              {op === suggested ? (
                <small className="detected">Détecté ({prefix})</small>
              ) : (
                <small>{op === 'mtn' ? 'Numéros 06' : 'Numéros 04 et 05'}</small>
              )}
            </label>
          ))}
        </div>
        <label>
          Numéro Mobile Money
          <input name="phone" type="tel" defaultValue={phone} required autoComplete="tel" />
        </label>
        <section className="guarantee-card">
          <ShieldCheck className="icon" aria-hidden />
          <div>
            <strong>Garantie Zandu</strong>
            <span>{GUARANTEE}</span>
          </div>
        </section>
        <SubmitButton testId="payment-pay">Payer {formatXaf(checkout.grandTotal)}</SubmitButton>
      </form>
    </main>
  );
}
