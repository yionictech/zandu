import Link from 'next/link';
import { act, field, load } from '@/lib/api';
import { deadline, formatDateTime, formatXaf } from '@/lib/format';
import { DISPUTE_REASON } from '@/lib/labels';
import { SubmitButton } from '@/components/SubmitButton';
import { DisputeList, DisputesHeader } from '@/components/DisputeList';
import { Badge, Flash, readParams, type SearchParams } from '@/components/ui';

export const metadata = { title: 'Litige' };

const SELLER_CHOICE = {
  exchange: 'Propose d’échanger le produit',
  take_back_refund: 'Reprend le produit et accepte le remboursement',
  contest: 'Conteste avec preuves',
} as const;

const RESOLUTIONS = {
  release_to_seller: 'Libéré au vendeur',
  refund_full: 'Acheteur remboursé intégralement',
  refund_partial: 'Remboursement partiel, le reste au vendeur',
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

async function remind(id: string) {
  'use server';
  await act(`/litiges/${id}`, 'Vendeur relancé', (api) =>
    api.POST('/v1/support/disputes/{id}/remind-seller', { params: { path: { id } } }),
  );
}

function Photos({ urls, alt }: { urls: string[]; alt: string }) {
  if (!urls.length) return <p className="small muted">Aucune photo jointe.</p>;
  return (
    <>
      <div className="gallery">
        {urls.map((url) => (
          <a key={url} href={url} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={alt} />
          </a>
        ))}
      </div>
      <p className="small muted">
        {urls.length > 1 ? `${urls.length} photos jointes` : '1 photo jointe'} · liens valables 5
        minutes, consultation journalisée
      </p>
    </>
  );
}

/**
 * Décider d'un litige (F9, F12), maquette « Litiges » : ce que dit l'acheteur, la réponse du
 * vendeur (ou le relancer), puis une décision motivée qui déclenche remboursement et/ou reversement.
 */
export default async function DisputePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { one, ok, erreur } = await readParams(searchParams);
  const [d, list] = await Promise.all([
    load((api) => api.GET('/v1/support/disputes/{id}', { params: { path: { id } } })),
    load((api) => api.GET('/v1/support/disputes', { params: { query: {} } })),
  ]);
  const o = d.order;
  const due = deadline(d.slaDueAt);
  const open = d.status === 'open';
  const buyerEvidence = d.evidence.filter((e) => e.from === 'buyer').map((e) => e.url);
  const sellerEvidence = d.evidence.filter((e) => e.from === 'seller').map((e) => e.url);
  const showResolved = one('vue') === 'resolus' || !open;
  return (
    <>
      <DisputesHeader
        open={list.counts.open}
        resolved={list.counts.resolved}
        showResolved={showResolved}
      />
      <Flash ok={ok} erreur={erreur} />
      <div className="split left">
        <DisputeList status={showResolved ? 'resolved' : 'open'} selected={id} />
        <div className="grid">
          <section className="card panel-head">
            <div>
              <h2 className="ref" style={{ fontSize: 22, margin: 0 }}>
                {o.publicRef}
              </h2>
              <div className="muted">
                {o.shippingAddress.recipientName} contre {o.seller.shopName} · signalé le{' '}
                {formatDateTime(d.createdAt)}
              </div>
              <div className="chips" style={{ marginTop: 8 }}>
                <Badge tone="danger">{DISPUTE_REASON[d.reason]}</Badge>
                <Badge>Remis le {formatDateTime(o.deliveredAt)}</Badge>
                {open ? (
                  <Badge tone={due.late ? 'danger' : 'waiting'}>Échéance {due.label}</Badge>
                ) : (
                  <Badge tone="trust">Tranché</Badge>
                )}
                <Link href={`/commandes/${o.id}`} className="small">
                  Dossier de la commande →
                </Link>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p className="eyebrow" style={{ color: 'var(--waiting)' }}>
                {open ? 'Bloqué' : 'Était bloqué'}
              </p>
              <div className="price" style={{ fontSize: 22 }}>
                {formatXaf(o.total)}
              </div>
            </div>
          </section>

          <section className="grid grid-2">
            <div className="card">
              <p className="eyebrow">Acheteur</p>
              <p style={{ whiteSpace: 'pre-wrap' }}>« {d.description} »</p>
              <Photos urls={buyerEvidence} alt="Preuve envoyée par l'acheteur" />
            </div>
            <div className="card">
              <p className="eyebrow">Vendeur</p>
              {d.sellerChoice ? (
                <>
                  <p>
                    <Badge tone="waiting">{SELLER_CHOICE[d.sellerChoice]}</Badge>{' '}
                    <span className="small muted">{formatDateTime(d.sellerRespondedAt)}</span>
                  </p>
                  {d.sellerMessage ? (
                    <p style={{ whiteSpace: 'pre-wrap' }}>« {d.sellerMessage} »</p>
                  ) : null}
                  <Photos urls={sellerEvidence} alt="Preuve envoyée par le vendeur" />
                </>
              ) : (
                <>
                  <p className="muted">Le vendeur n'a pas encore répondu.</p>
                  {open ? (
                    <form action={remind.bind(null, id)}>
                      <SubmitButton variant="secondary">Relancer le vendeur</SubmitButton>
                    </form>
                  ) : null}
                </>
              )}
            </div>
          </section>

          {open ? (
            <section className="card" style={{ borderColor: 'var(--brand-border)' }}>
              <h2>Décision</h2>
              <form action={resolve.bind(null, id)} className="stack">
                <label>
                  Note de décision (journal d'audit, visible par l'équipe)
                  <textarea
                    name="note"
                    minLength={5}
                    maxLength={2000}
                    required
                    placeholder="Motif de la décision"
                  />
                </label>
                <label>
                  Montant remboursé (remboursement partiel seulement, moins que les articles :{' '}
                  {formatXaf(o.itemsSubtotal)})
                  <input name="refundAmount" inputMode="numeric" placeholder="Ex. 10000" />
                </label>
                <div className="chips">
                  <SubmitButton
                    variant="danger"
                    name="resolution"
                    value="refund_full"
                    confirm="Rembourser intégralement l'acheteur ? L'argent part immédiatement."
                  >
                    Rembourser l'acheteur · {formatXaf(o.total - o.refundedAmount)}
                  </SubmitButton>
                  <SubmitButton
                    variant="secondary"
                    name="resolution"
                    value="refund_partial"
                    confirm="Rembourser ce montant et payer le reste au vendeur ?"
                  >
                    Remboursement partiel
                  </SubmitButton>
                  <SubmitButton
                    variant="secondary"
                    name="resolution"
                    value="release_to_seller"
                    confirm="Libérer l'argent au vendeur ?"
                  >
                    Libérer au vendeur
                  </SubmitButton>
                </div>
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
        </div>
      </div>
    </>
  );
}
