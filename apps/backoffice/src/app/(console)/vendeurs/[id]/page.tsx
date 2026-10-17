import { act, field, load } from '@/lib/api';
import { displayPhone, formatDateTime, OPERATORS } from '@/lib/format';
import { DOCUMENTS, VERIFICATION } from '@/lib/labels';
import { SubmitButton } from '@/components/SubmitButton';
import { Badge, Flash, PageHeader, readParams, type SearchParams } from '@/components/ui';

export const metadata = { title: 'Boutique' };

type Params = Promise<{ id: string }>;

async function decide(id: string, form: FormData) {
  'use server';
  const decision = field(form, 'decision') as 'verified' | 'rejected' | 'suspended';
  const reason = field(form, 'reason');
  const labels = {
    verified: 'Boutique vérifiée',
    rejected: 'Dossier refusé',
    suspended: 'Boutique suspendue',
  };
  await act(`/vendeurs/${id}`, labels[decision], (api) =>
    api.POST('/v1/admin/sellers/{id}/verification', {
      params: { path: { id } },
      body: { decision, ...(reason ? { reason } : {}) },
    }),
  );
}

/**
 * Décision de vérification : pièces affichées par URL signées de 5 minutes ; chaque
 * consultation est inscrite au journal d'audit (loi 29-2019).
 */
export default async function SellerPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { ok, erreur } = await readParams(searchParams);
  const [seller, documents] = await Promise.all([
    load((api) => api.GET('/v1/admin/sellers/{id}', { params: { path: { id } } })),
    load((api) => api.GET('/v1/admin/sellers/{id}/kyc-documents', { params: { path: { id } } })),
  ]);
  const [statusLabel, tone] = VERIFICATION[seller.verificationStatus];
  const action = decide.bind(null, id);
  return (
    <>
      <PageHeader title={seller.shopName} subtitle={<Badge tone={tone}>{statusLabel}</Badge>} />
      <Flash ok={ok} erreur={erreur} />
      <section className="grid grid-2">
        <div className="card">
          <h2>Boutique</h2>
          <dl className="kv">
            <dt>Type</dt>
            <dd>{seller.kind === 'business' ? 'Entreprise' : 'Particulier'}</dd>
            <dt>Responsable</dt>
            <dd>{seller.fullName ?? '—'}</dd>
            <dt>Téléphone</dt>
            <dd>{displayPhone(seller.phone)}</dd>
            <dt>Reversements</dt>
            <dd>
              {displayPhone(seller.payoutPhone)} · {OPERATORS[seller.payoutOperator]}
            </dd>
            <dt>Enlèvement</dt>
            <dd>
              {seller.pickupZone}, {seller.city}
            </dd>
            <dt>Ouverte le</dt>
            <dd>{formatDateTime(seller.createdAt)}</dd>
            <dt>Produits / ventes</dt>
            <dd>
              {seller.productCount} / {seller.orderCount}
            </dd>
            {seller.rejectionReason ? (
              <>
                <dt>Dernier motif</dt>
                <dd>{seller.rejectionReason}</dd>
              </>
            ) : null}
          </dl>
        </div>
        <div className="card">
          <h2>Décision</h2>
          <form action={action} className="stack">
            <input type="hidden" name="decision" value="verified" />
            <p className="muted small">
              La pièce est lisible, le selfie correspond, le nom du compte Mobile Money concorde.
            </p>
            <SubmitButton variant="trust">Vérifier la boutique</SubmitButton>
          </form>
          <hr />
          <form action={action} className="stack">
            <label>
              Motif (envoyé au vendeur)
              <select name="reason" required defaultValue="">
                <option value="" disabled>
                  Choisir un motif…
                </option>
                <option>Pièce illisible ou coupée</option>
                <option>Selfie ne correspondant pas à la pièce</option>
                <option>Pièce expirée</option>
                <option>Documents d'entreprise manquants</option>
              </select>
            </label>
            <div className="decisions">
              <button type="submit" name="decision" value="rejected" className="button danger">
                Refuser le dossier
              </button>
              <button type="submit" name="decision" value="suspended" className="button secondary">
                Suspendre la boutique
              </button>
            </div>
          </form>
        </div>
      </section>
      <section className="card">
        <h2>Pièces ({documents.items.length})</h2>
        <p className="small muted">Liens valables 5 minutes ; consultation journalisée.</p>
        <div className="gallery large">
          {documents.items.map((doc) => (
            <figure key={doc.id} style={{ margin: 0 }}>
              <a href={doc.url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={doc.url} alt={DOCUMENTS[doc.type]} />
              </a>
              <figcaption className="small">
                {DOCUMENTS[doc.type]} ·{' '}
                <Badge
                  tone={
                    doc.status === 'accepted'
                      ? 'trust'
                      : doc.status === 'rejected'
                        ? 'danger'
                        : 'waiting'
                  }
                >
                  {doc.status === 'accepted'
                    ? 'acceptée'
                    : doc.status === 'rejected'
                      ? 'refusée'
                      : 'à examiner'}
                </Badge>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    </>
  );
}
