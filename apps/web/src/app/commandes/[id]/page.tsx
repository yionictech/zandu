import { ApiError, unwrap, type DisputeReason } from '@zandu/api-client';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { field, mine, userClient, withParam } from '@/lib/api';
import { displayPhone, formatDateTime, formatXaf } from '@/lib/format';
import { DISPUTE_REASONS, STATUS, STATUS_TONE, TIMELINE } from '@/lib/labels';
import { SubmitButton } from '@/components/SubmitButton';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Suivi de commande', robots: { index: false } };

const CODE_PENDING = [
  'paid',
  'preparing',
  'ready_for_pickup',
  'in_delivery',
  'awaiting_collection',
];

type Action = 'confirm' | 'cancel' | 'code' | 'dispute';

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
  const reached = new Map(o.history.map((h) => [h.status, h.at]));
  const action = act.bind(null, id);
  return (
    <main style={{ maxWidth: 680 }}>
      <div className="stack" style={{ gap: 4 }}>
        <span className="small muted">
          {o.publicRef} · {o.seller.shopName}
        </span>
        <h1 className={`status ${STATUS_TONE[o.status] ?? ''}`} data-testid="order-status">
          {STATUS[o.status]}
        </h1>
      </div>
      {query.ok ? <p className="notice">{query.ok}</p> : null}
      {query.erreur ? <p className="error">{query.erreur}</p> : null}

      {o.status === 'delivered' && o.disputeWindowEndsAt ? (
        <section className="guarantee stack">
          <strong>Tout est conforme ?</strong>
          <span className="small">
            Vous pouvez signaler un problème jusqu’au {formatDateTime(o.disputeWindowEndsAt)}.
          </span>
          <form action={action}>
            <input type="hidden" name="action" value="confirm" />
            <SubmitButton variant="trust" testId="order-confirm">
              Oui, tout va bien
            </SubmitButton>
          </form>
          <details>
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
        </section>
      ) : null}

      <section className="card">
        <h2>Suivi</h2>
        <ol className="timeline">
          {TIMELINE.map(([status, label]) => {
            const at = reached.get(status);
            return (
              <li key={status}>
                <span className={`dot ${at ? 'done' : ''}`} />
                <span className={at ? '' : 'muted'}>
                  {label}
                  {at ? <span className="small muted"> · {formatDateTime(at)}</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="card stack">
        {o.items.map((item) => (
          <div key={item.itemId} className="row">
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
        <div className="row">
          <strong>Total</strong>
          <strong>{formatXaf(o.total)}</strong>
        </div>
        {o.refundedAmount ? (
          <div className="row small verified">
            <span>Remboursé</span>
            <span>{formatXaf(o.refundedAmount)}</span>
          </div>
        ) : null}
      </section>

      <section className="card stack">
        <h2>Livraison à</h2>
        <span>
          {o.shippingAddress.recipientName} · {displayPhone(o.shippingAddress.phone)}
        </span>
        <span className="small muted">{o.shippingAddress.landmark}</span>
      </section>

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
