import Link from 'next/link';
import { act, field, load } from '@/lib/api';
import { deadline, displayPhone, formatDateTime, formatXaf } from '@/lib/format';
import { DISPUTE_REASON, ORDER_STATUS } from '@/lib/labels';
import { SubmitButton } from '@/components/SubmitButton';
import { Badge, Flash, PageHeader, readParams, type SearchParams } from '@/components/ui';

export const metadata = { title: 'Litige' };

const RESOLUTIONS = {
  release_to_seller: "Payer le vendeur (l'acheteur n'a pas raison)",
  refund_full: "Rembourser intégralement l'acheteur",
  refund_partial: "Rembourser une partie à l'acheteur, le reste au vendeur",
} as const;

async function resolve(id: string, form: FormData) {
  'use server';
  const resolution = field(form, 'resolution') as keyof typeof RESOLUTIONS;
  const amount = Number(field(form, 'refundAmount').replace(/\D/g, ''));
  await act(`/litiges/${id}`, 'Décision appliquée : argent en route', (api) =>
    api.POST('/v1/support/disputes/{id}/resolve', {
      params: { path: { id } },
      body: {
        resolution,
        note: field(form, 'note'),
        ...(resolution === 'refund_partial' ? { refundAmount: amount } : {}),
      },
    }),
  );
}

/**
 * Décider d'un litige (F9, F12) : preuves de l'acheteur (URL signées, consultation journalisée),
 * commande, puis décision motivée qui déclenche automatiquement remboursement et/ou reversement.
 */
export default async function DisputePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { ok, erreur } = await readParams(searchParams);
  const d = await load((api) => api.GET('/v1/support/disputes/{id}', { params: { path: { id } } }));
  const o = d.order;
  const [orderLabel, orderTone] = ORDER_STATUS[o.status];
  const due = deadline(d.slaDueAt);
  return (
    <>
      <PageHeader
        title={`Litige ${o.publicRef}`}
        subtitle={
          <>
            {DISPUTE_REASON[d.reason]} · ouvert le {formatDateTime(d.createdAt)} ·{' '}
            {d.status === 'open' ? (
              <Badge tone={due.late ? 'danger' : 'waiting'}>échéance {due.label}</Badge>
            ) : (
              <Badge tone="trust">tranché</Badge>
            )}
          </>
        }
      >
        <Link href={`/commandes/${o.id}`}>Dossier complet de la commande →</Link>
      </PageHeader>
      <Flash ok={ok} erreur={erreur} />
      <section className="grid grid-2">
        <div className="card">
          <h2>Ce que dit l'acheteur</h2>
          <p style={{ whiteSpace: 'pre-wrap', marginTop: 0 }}>{d.description}</p>
          <div className="gallery large">
            {d.evidence.map((e) => (
              <a key={e.id} href={e.url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={e.url} alt="Preuve envoyée par l'acheteur" />
              </a>
            ))}
            {d.evidence.length === 0 ? <p className="muted">Aucune photo jointe.</p> : null}
          </div>
        </div>
        <div className="card">
          <h2>Commande</h2>
          <dl className="kv">
            <dt>Statut</dt>
            <dd>
              <Badge tone={orderTone}>{orderLabel}</Badge>
            </dd>
            <dt>Boutique</dt>
            <dd>{o.seller.shopName}</dd>
            <dt>Articles</dt>
            <dd>
              {o.items.map((i) => (
                <div key={i.itemId}>
                  {i.quantity} × {i.title} — {formatXaf(i.lineTotal)}
                </div>
              ))}
            </dd>
            <dt>Livraison</dt>
            <dd>{formatXaf(o.deliveryFee)}</dd>
            <dt>Total payé</dt>
            <dd className="big-money">{formatXaf(o.total)}</dd>
            <dt>Destinataire</dt>
            <dd>
              {o.shippingAddress.recipientName} · {displayPhone(o.shippingAddress.phone)}
            </dd>
            <dt>Remise</dt>
            <dd>{formatDateTime(o.deliveredAt)}</dd>
          </dl>
        </div>
      </section>
      {d.status === 'open' ? (
        <section className="card">
          <h2>Décision</h2>
          <form action={resolve.bind(null, id)} className="stack">
            {Object.entries(RESOLUTIONS).map(([value, label], index) => (
              <label key={value} className="radio">
                <input
                  type="radio"
                  name="resolution"
                  value={value}
                  defaultChecked={index === 0}
                  required
                />
                {label}
              </label>
            ))}
            <label>
              Montant remboursé (remboursement partiel seulement, moins que les articles :{' '}
              {formatXaf(o.itemsSubtotal)})
              <input name="refundAmount" inputMode="numeric" placeholder="Ex. 10000" />
            </label>
            <label>
              Note de décision (visible dans le journal d'audit)
              <textarea name="note" minLength={5} maxLength={2000} required />
            </label>
            <SubmitButton confirm="Appliquer cette décision ? L'argent part immédiatement.">
              Appliquer la décision
            </SubmitButton>
          </form>
        </section>
      ) : (
        <section className="card">
          <h2>Décision prise</h2>
          <dl className="kv">
            <dt>Décision</dt>
            <dd>{d.resolution ? RESOLUTIONS[d.resolution] : '—'}</dd>
            {d.refundAmount ? (
              <>
                <dt>Remboursé</dt>
                <dd>{formatXaf(d.refundAmount)}</dd>
              </>
            ) : null}
            <dt>Note</dt>
            <dd>{d.decisionNote}</dd>
          </dl>
        </section>
      )}
    </>
  );
}
