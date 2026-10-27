import { ApiError, unwrap, type DisputeReason } from '@zandu/api-client';
import { Check, Package, Phone, Star } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { field, mine, userClient, withParam } from '@/lib/api';
import { displayPhone, formatDateTime, formatTime, formatXaf } from '@/lib/format';
import {
  DISPUTE_REASONS,
  headline,
  REVIEW_TAGS,
  STATUS_SHORT,
  STATUS_TONE,
  TIMELINE,
} from '@/lib/labels';
import { Price } from '@/components/Price';
import { RiderMap } from '@/components/RiderMap';
import { SubmitButton } from '@/components/SubmitButton';

type ReviewTag = keyof typeof REVIEW_TAGS;

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Suivi de commande', robots: { index: false } };

const CODE_PENDING = [
  'paid',
  'preparing',
  'ready_for_pickup',
  'in_delivery',
  'awaiting_collection',
];

type Action = 'confirm' | 'cancel' | 'code' | 'dispute' | 'review';

async function act(id: string, form: FormData) {
  'use server';
  const kind = field(form, 'action') as Action;
  const back = `/commandes/${id}`;
  const params = { params: { path: { id } } };
  const done = {
    confirm: 'Merci ! Le vendeur est payé.',
    cancel: 'Commande annulée : vous êtes remboursé intégralement.',
    code: 'Nouveau code envoyé par SMS.',
    dispute: 'Problème signalé : le support vous répond sous 72 h.',
    review: 'Merci pour votre avis !',
  }[kind];
  try {
    const api = await userClient();
    const result =
      kind === 'confirm'
        ? await api.POST('/v1/orders/{id}/confirm-receipt', params)
        : kind === 'cancel'
          ? await api.POST('/v1/orders/{id}/cancel', params)
          : kind === 'code'
            ? await api.POST('/v1/orders/{id}/handover-code', params)
            : kind === 'review'
              ? await api.POST('/v1/order-items/{id}/review', {
                  params: { path: { id: field(form, 'itemId') } },
                  body: {
                    rating: Number(field(form, 'rating')),
                    ...(field(form, 'comment') ? { comment: field(form, 'comment') } : {}),
                    tags: form
                      .getAll('tags')
                      .map(String)
                      .filter((t): t is ReviewTag => t in REVIEW_TAGS),
                  },
                })
              : await api.POST('/v1/orders/{id}/disputes', {
                  ...params,
                  body: {
                    reason: field(form, 'reason') as DisputeReason,
                    description: field(form, 'description'),
                  },
                });
    unwrap<unknown>(result);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : 'Pas de connexion, réessayez.';
    redirect(withParam(back, 'erreur', message));
  }
  redirect(withParam(back, 'ok', done ?? 'Fait.'));
}

/** Suivi « à la Amazon » : frise, code de remise, « tout est conforme ? », problème. */
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const o = await mine(`/commandes/${id}`, (api) =>
    api.GET('/v1/orders/{id}', { params: { path: { id } } }),
  );
  const tracking =
    o.status === 'in_delivery'
      ? await mine(`/commandes/${id}`, (api) =>
          api.GET('/v1/orders/{id}/tracking', { params: { path: { id } } }),
        )
      : null;
  const reached = new Map(o.history.map((h) => [h.status, h.at]));
  const action = act.bind(null, id);
  const tone =
    o.status === 'disputed' ? 'danger' : STATUS_TONE[o.status] === 'trust' ? '' : 'waiting';
  const lastAt = o.history.at(-1)?.at;
  const toReview =
    o.status === 'delivered' || o.status === 'completed' ? o.items.filter((i) => !i.reviewed) : [];
  return (
    <main style={{ maxWidth: 680 }}>
      <section className={`status-card ${tone}`}>
        <p className="eyebrow">{STATUS_SHORT[o.status]}</p>
        <h1 data-testid="order-status">{headline(o.status, o.seller.shopName)}</h1>
        <span className="small muted">
          {o.publicRef} · {o.seller.shopName}
          {lastAt ? ` · ${formatDateTime(lastAt)}` : ''}
        </span>
      </section>
      {query.ok ? <p className="notice">{query.ok}</p> : null}
      {query.erreur ? <p className="error">{query.erreur}</p> : null}

      {o.status === 'delivered' && o.disputeWindowEndsAt ? (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Tout est conforme ?</h2>
          <span className="small muted">
            Vous pouvez signaler un problème jusqu’au {formatDateTime(o.disputeWindowEndsAt)}.
          </span>
          <div className="pair">
            <a href="#probleme" className="button secondary">
              Un problème
            </a>
            <form action={action}>
              <input type="hidden" name="action" value="confirm" />
              <SubmitButton testId="order-confirm">Oui, tout va bien</SubmitButton>
            </form>
          </div>
        </section>
      ) : null}

      {toReview.map((item) => (
        <form key={item.itemId} action={action} className="card stack">
          <input type="hidden" name="action" value="review" />
          <input type="hidden" name="itemId" value={item.itemId} />
          <div className="info-row">
            <span className="icon-box">
              <Package className="icon" aria-hidden />
            </span>
            <div style={{ minWidth: 0 }}>
              <strong>Notez votre achat</strong>
              <div className="small muted tile-title" style={{ minHeight: 0 }}>
                {item.title}
              </div>
            </div>
          </div>
          <fieldset className="stars" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small muted">Votre note</legend>
            {[5, 4, 3, 2, 1].map((n) => (
              <label key={n} aria-label={`${n} étoile${n > 1 ? 's' : ''}`}>
                <input type="radio" name="rating" value={n} required />
                <Star className="icon" aria-hidden />
              </label>
            ))}
          </fieldset>
          <div className="pills">
            {Object.entries(REVIEW_TAGS).map(([value, label]) => (
              <label key={value} className="pill">
                <input type="checkbox" name="tags" value={value} />
                {label}
              </label>
            ))}
          </div>
          <textarea name="comment" maxLength={2000} placeholder="Votre avis (facultatif)" />
          <SubmitButton variant="secondary">Publier mon avis</SubmitButton>
        </form>
      ))}

      {tracking?.onTheWay && tracking.rider ? (
        <section className="card stack" data-testid="rider-on-the-way">
          <div className="row" style={{ alignItems: 'center' }}>
            <div>
              <p className="eyebrow" style={{ color: 'var(--waiting)' }}>
                Votre livreur arrive
              </p>
              <strong>{tracking.rider.name}</strong>
            </div>
            <a className="button small" href={`tel:${tracking.rider.phone}`}>
              <Phone className="icon" aria-hidden /> Appeler
            </a>
          </div>
          {tracking.position ? (
            <>
              {tracking.etaMinutes ? (
                <strong data-testid="rider-eta">
                  Arrivée dans {tracking.etaMinutes} min environ
                </strong>
              ) : null}
              <RiderMap
                lat={tracking.position.lat}
                lng={tracking.position.lng}
                home={tracking.destination}
              />
              <span className="small muted">
                Position du livreur à {formatTime(tracking.position.at)} ·{' '}
                <a href={`/commandes/${id}`}>Actualiser</a>
              </span>
            </>
          ) : (
            <span className="small muted">
              Sa position s’affichera ici dès qu’il partage sa localisation.
            </span>
          )}
        </section>
      ) : null}

      <section className="card">
        <ol className="track">
          {TIMELINE.map(([status, label]) => {
            const at = reached.get(status);
            return (
              <li key={status} className={at ? 'done' : ''}>
                <span className="mark">
                  {at ? <Check className="icon" aria-hidden strokeWidth={3} /> : null}
                </span>
                <span>
                  <strong>{label}</strong>
                  {at ? <span className="small muted">{formatDateTime(at)}</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="card stack">
        <p className="eyebrow">Livraison à</p>
        <strong>
          {o.shippingAddress.recipientName} · {displayPhone(o.shippingAddress.phone)}
        </strong>
        <span className="small muted">{o.shippingAddress.landmark}</span>
      </section>

      <section className="card stack">
        {o.items.map((item) => (
          <div key={item.itemId} className="row small">
            <span>
              {item.quantity} × {item.title}
            </span>
            <strong>{formatXaf(item.lineTotal)}</strong>
          </div>
        ))}
        <div className="row small">
          <span className="muted">Livraison</span>
          <span>{formatXaf(o.deliveryFee)}</span>
        </div>
        <div className="row" style={{ alignItems: 'baseline' }}>
          <strong>Total</strong>
          <Price value={o.total} size="md" />
        </div>
        {o.refundedAmount ? (
          <div className="row small verified">
            <span>Remboursé</span>
            <span>{formatXaf(o.refundedAmount)}</span>
          </div>
        ) : null}
      </section>

      {o.status === 'delivered' && o.disputeWindowEndsAt ? (
        <details className="card" id="probleme">
          <summary className="button ghost block">Signaler un problème</summary>
          <form action={action} className="stack" style={{ marginTop: 10 }}>
            <input type="hidden" name="action" value="dispute" />
            <label>
              Que s’est-il passé ?
              <select name="reason" required defaultValue="">
                <option value="" disabled>
                  Choisir…
                </option>
                {Object.entries(DISPUTE_REASONS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Expliquez en quelques mots
              <textarea name="description" minLength={10} maxLength={2000} required />
            </label>
            <SubmitButton>Envoyer au support</SubmitButton>
          </form>
        </details>
      ) : null}

      {CODE_PENDING.includes(o.status) ? (
        <form action={action}>
          <input type="hidden" name="action" value="code" />
          <SubmitButton variant="ghost">Recevoir un nouveau code de remise par SMS</SubmitButton>
        </form>
      ) : null}
      {o.status === 'paid' ? (
        <form action={action}>
          <input type="hidden" name="action" value="cancel" />
          <SubmitButton
            variant="ghost"
            confirm="Annuler cette commande ? Vous serez remboursé intégralement."
          >
            Annuler la commande
          </SubmitButton>
        </form>
      ) : null}
    </main>
  );
}
