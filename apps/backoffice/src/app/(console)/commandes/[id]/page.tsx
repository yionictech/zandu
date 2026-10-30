import Link from 'next/link';
import { act, field, load } from '@/lib/api';
import { displayPhone, formatDateTime, formatXaf, OPERATORS } from '@/lib/format';
import { MONEY_STATUS, ORDER_STATUS, refundReason, VERIFICATION } from '@/lib/labels';
import { SubmitButton } from '@/components/SubmitButton';
import { Badge, Flash, PageHeader, readParams, type SearchParams } from '@/components/ui';

export const metadata = { title: 'Commande' };

const FINAL = ['completed', 'refunded', 'cancelled'];

async function cancel(id: string, form: FormData) {
  'use server';
  await act(`/commandes/${id}`, 'Commande annulée, remboursement lancé', (api) =>
    api.POST('/v1/support/orders/{id}/cancel', {
      params: { path: { id } },
      body: { reason: field(form, 'reason') },
    }),
  );
}

async function writeMessage(id: string, form: FormData) {
  'use server';
  await act(`/commandes/${id}`, 'Message envoyé aux participants', (api) =>
    api.POST('/v1/support/orders/{id}/messages', {
      params: { path: { id } },
      body: { body: field(form, 'body') },
    }),
  );
}

const ROLE: Record<string, string> = {
  buyer: 'acheteur',
  seller: 'vendeur',
  rider: 'livreur',
  support: 'support',
};

function MoneyBadge({ status }: { status: string }) {
  const [label, tone] = MONEY_STATUS[status] ?? [status, 'neutral' as const];
  return <Badge tone={tone}>{label}</Badge>;
}

/** Dossier d'une commande : tout le circuit de l'argent et de la livraison, pour répondre au client. */
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { ok, erreur } = await readParams(searchParams);
  const o = await load((api) => api.GET('/v1/support/orders/{id}', { params: { path: { id } } }));
  const chat = await load((api) =>
    api.GET('/v1/support/orders/{id}/messages', { params: { path: { id } } }),
  );
  const [label, tone] = ORDER_STATUS[o.status];
  const [verification, verificationTone] = VERIFICATION[o.sellerContact.verificationStatus];
  return (
    <>
      <PageHeader
        title={o.publicRef}
        subtitle={
          <>
            <Badge tone={tone}>{label}</Badge> · créée le {formatDateTime(o.createdAt)}
          </>
        }
      >
        {o.dispute ? <Link href={`/litiges/${o.dispute.id}`}>Voir le litige →</Link> : null}
      </PageHeader>
      <Flash ok={ok} erreur={erreur} />
      <section className="grid grid-2">
        <div className="card">
          <h2>Articles et montants</h2>
          <table>
            <tbody>
              {o.items.map((i) => (
                <tr key={i.itemId}>
                  <td>
                    {i.quantity} × {i.title}
                  </td>
                  <td className="num">{formatXaf(i.lineTotal)}</td>
                </tr>
              ))}
              <tr>
                <td className="muted">Livraison</td>
                <td className="num">{formatXaf(o.deliveryFee)}</td>
              </tr>
              <tr>
                <td>
                  <strong>Total payé</strong>
                </td>
                <td className="num big-money">{formatXaf(o.total)}</td>
              </tr>
              {o.refundedAmount ? (
                <tr>
                  <td>Remboursé</td>
                  <td className="num">{formatXaf(o.refundedAmount)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>Personnes</h2>
          <dl className="kv">
            <dt>Acheteur</dt>
            <dd>
              {o.buyer.name ? `${o.buyer.name} · ` : ''}
              {displayPhone(o.buyer.phone)}
            </dd>
            <dt>Destinataire</dt>
            <dd>
              {o.shippingAddress.recipientName} · {displayPhone(o.shippingAddress.phone)}
            </dd>
            <dt>Repère</dt>
            <dd>
              {o.shippingAddress.landmark}
              {o.shippingAddress.location ? (
                <>
                  {' '}
                  ·{' '}
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${o.shippingAddress.location.lat}&mlon=${o.shippingAddress.location.lng}#map=18/${o.shippingAddress.location.lat}/${o.shippingAddress.location.lng}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Repère sur la carte
                  </a>
                </>
              ) : null}
            </dd>
            <dt>Boutique</dt>
            <dd>
              {o.seller.shopName} · {displayPhone(o.sellerContact.phone)}{' '}
              <Badge tone={verificationTone}>{verification}</Badge>
            </dd>
            <dt>Livreur</dt>
            <dd>
              {o.delivery?.riderPhone
                ? `${o.delivery.riderName ?? ''} ${displayPhone(o.delivery.riderPhone)}`
                : 'Pas encore assigné'}
            </dd>
            <dt>Mode</dt>
            <dd>{o.deliveryMode === 'home' ? 'À domicile' : 'Point relais'}</dd>
          </dl>
        </div>
      </section>
      <section className="card">
        <h2>Argent</h2>
        <table>
          <thead>
            <tr>
              <th>Mouvement</th>
              <th>Détail</th>
              <th>Statut</th>
              <th className="num">Montant</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {o.payments.map((p) => (
              <tr key={p.id}>
                <td>Paiement {p.lateSuccess ? '(tardif, remboursé)' : ''}</td>
                <td>
                  {OPERATORS[p.operator]} · {displayPhone(p.msisdn)}
                  {p.failureMessage ? <div className="small muted">{p.failureMessage}</div> : null}
                </td>
                <td>
                  <MoneyBadge status={p.status} />
                </td>
                <td className="num">{formatXaf(p.amount)}</td>
                <td>{formatDateTime(p.succeededAt ?? p.createdAt)}</td>
              </tr>
            ))}
            {o.refunds.map((r) => (
              <tr key={r.id}>
                <td>Remboursement</td>
                <td>
                  {refundReason(r.reason)}
                  {r.lastError ? <div className="small muted">{r.lastError}</div> : null}
                </td>
                <td>
                  <MoneyBadge status={r.status} />
                </td>
                <td className="num">{formatXaf(r.amount)}</td>
                <td>{formatDateTime(r.succeededAt ?? r.createdAt)}</td>
              </tr>
            ))}
            {o.payouts.map((p) => (
              <tr key={p.id}>
                <td>Reversement vendeur</td>
                <td>
                  {OPERATORS[p.operator]} · {displayPhone(p.msisdn)} · {p.attempts} tentative(s)
                  {p.lastError ? <div className="small muted">{p.lastError}</div> : null}
                </td>
                <td>
                  <MoneyBadge status={p.status} />
                </td>
                <td className="num">{formatXaf(p.amount)}</td>
                <td>{formatDateTime(p.succeededAt ?? p.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="grid grid-2">
        <div className="card">
          <h2>Historique</h2>
          <table>
            <tbody>
              {o.history.map((h, index) => (
                <tr key={`${h.status}-${index}`}>
                  <td>{ORDER_STATUS[h.status][0]}</td>
                  <td className="small muted">{h.event}</td>
                  <td>{formatDateTime(h.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!FINAL.includes(o.status) && o.status !== 'disputed' ? (
          <div className="card">
            <h2>Annuler la commande</h2>
            <p className="muted small">
              L'acheteur est remboursé intégralement ; le vendeur et le livreur sont prévenus.
            </p>
            <form action={cancel.bind(null, id)} className="stack">
              <label>
                Motif (journal d'audit)
                <input name="reason" minLength={3} maxLength={300} required />
              </label>
              <SubmitButton
                variant="danger"
                confirm="Annuler cette commande et rembourser l'acheteur ?"
              >
                Annuler et rembourser
              </SubmitButton>
            </form>
          </div>
        ) : null}
      </section>
      <section className="card" data-testid="order-messages">
        <h2>Messages ({chat.items.length})</h2>
        <p className="muted small">
          Conversation entre{' '}
          {chat.participants.map((p) => `${p.name} (${ROLE[p.role]})`).join(', ')}. Un message du
          support est vu par tous et journalisé.
        </p>
        {chat.items.length ? (
          <table>
            <tbody>
              {chat.items.map((m) => (
                <tr key={m.id}>
                  <td className="small">
                    <strong>{m.name}</strong>
                    <br />
                    <span className="muted">{ROLE[m.role]}</span>
                  </td>
                  <td style={{ whiteSpace: 'pre-wrap' }}>{m.body}</td>
                  <td className="small muted">{formatDateTime(m.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">Aucun message.</p>
        )}
        {FINAL.includes(o.status) ? null : (
          <form action={writeMessage.bind(null, id)} className="stack">
            <label>
              Écrire au nom du support
              <textarea name="body" minLength={1} maxLength={1000} rows={3} required />
            </label>
            <SubmitButton>Envoyer</SubmitButton>
          </form>
        )}
      </section>
    </>
  );
}
