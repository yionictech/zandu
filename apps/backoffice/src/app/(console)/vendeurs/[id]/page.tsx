import { IdCard, UserRound } from 'lucide-react';
import Link from 'next/link';
import { act, field, load } from '@/lib/api';
import { displayPhone, formatDateTime, OPERATORS } from '@/lib/format';
import { DOCUMENTS, VERIFICATION } from '@/lib/labels';
import { SubmitButton } from '@/components/SubmitButton';
import { Badge, Flash, readParams, type SearchParams } from '@/components/ui';

export const metadata = { title: 'Boutique' };

type Params = Promise<{ id: string }>;

async function decide(id: string, form: FormData) {
  'use server';
  const decision = field(form, 'decision') as 'verified' | 'rejected' | 'suspended';
  const reason = field(form, 'reason');
  const labels = {
    verified: 'Boutique vérifiée',
    rejected: 'Demande envoyée au vendeur',
    suspended: 'Boutique suspendue',
  };
  await act(`/vendeurs/${id}`, labels[decision], (api) =>
    api.POST('/v1/admin/sellers/{id}/verification', {
      params: { path: { id } },
      body: { decision, ...(reason ? { reason } : {}) },
    }),
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/**
 * Vérification d'une boutique (maquette « Vendeurs ») : identité et compte Mobile Money à gauche,
 * pièces et contrôles à droite. Pièces par URL signées de 5 minutes, consultation journalisée.
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
  const live = documents.items.filter((d) => d.status !== 'rejected');
  const idDoc = live.find((d) => d.type === 'national_id' || d.type === 'passport');
  const selfie = live.find((d) => d.type === 'selfie');
  const others = live.filter((d) => d !== idDoc && d !== selfie);
  const canDecide = ['pending_review', 'unverified', 'rejected'].includes(
    seller.verificationStatus,
  );
  return (
    <>
      <header className="page-header">
        <div>
          <Link href="/vendeurs" className="small">
            ← Vendeurs
          </Link>
          <h1>{seller.shopName}</h1>
        </div>
        <Badge tone={tone}>{statusLabel}</Badge>
      </header>
      <Flash ok={ok} erreur={erreur} />
      <section className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="card grid">
          <div className="identity">
            <span className="avatar">{initials(seller.shopName)}</span>
            <div>
              <strong>{seller.shopName}</strong>
              <div className="small muted">
                Gérant : {seller.fullName ?? '—'} · {seller.city}, {seller.pickupZone}
              </div>
            </div>
          </div>
          <dl className="kv">
            <dt>Type</dt>
            <dd>{seller.kind === 'business' ? 'Entreprise' : 'Particulier'}</dd>
            <dt>Téléphone</dt>
            <dd>{displayPhone(seller.phone)}</dd>
            <dt>Mobile Money de paiement</dt>
            <dd>
              {OPERATORS[seller.payoutOperator]} · {displayPhone(seller.payoutPhone)}
            </dd>
            <dt>Nom sur le compte</dt>
            <dd>{seller.payoutAccountName ?? <span className="muted">Non renseigné</span>}</dd>
            <dt>NIU / RCCM</dt>
            <dd>
              {[seller.niu, seller.rccm].filter(Boolean).join(' · ') || (
                <span className="muted">Non renseigné</span>
              )}
            </dd>
            <dt>Catégories prévues</dt>
            <dd>{seller.soldCategories.join(', ') || <span className="muted">—</span>}</dd>
            <dt>Horaires</dt>
            <dd>{seller.openingHours ?? <span className="muted">—</span>}</dd>
            <dt>Produits / ventes</dt>
            <dd>
              {seller.productCount} / {seller.orderCount}
            </dd>
            <dt>Ouverte le</dt>
            <dd>{formatDateTime(seller.createdAt)}</dd>
            {seller.rejectionReason ? (
              <>
                <dt>Dernier motif</dt>
                <dd>{seller.rejectionReason}</dd>
              </>
            ) : null}
          </dl>
        </div>

        <div className="card grid">
          <p className="eyebrow">Pièces fournies</p>
          <div className="thumbs">
            {[
              [idDoc, 'Pièce d’identité', IdCard],
              [selfie, 'Selfie avec la pièce', UserRound],
            ].map(([doc, label, Icon]) => {
              const d = doc as (typeof live)[number] | undefined;
              const Glyph = Icon as typeof IdCard;
              return (
                <figure key={label as string}>
                  {d ? (
                    <a href={d.url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={d.url} alt={label as string} />
                    </a>
                  ) : (
                    <span className="missing">
                      <Glyph size={22} aria-hidden />
                    </span>
                  )}
                  <figcaption className="small">
                    <strong>{label as string}</strong> {d ? '' : '· manquante'}
                  </figcaption>
                </figure>
              );
            })}
            {others.map((d) => (
              <figure key={d.id}>
                <a href={d.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={d.url} alt={DOCUMENTS[d.type]} />
                </a>
                <figcaption className="small">
                  <strong>{DOCUMENTS[d.type]}</strong>
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Liens valables 5 minutes ; consultation journalisée.
          </p>

          {canDecide ? (
            <>
              <form action={action} className="stack">
                <input type="hidden" name="decision" value="verified" />
                <label className="check">
                  <input type="checkbox" required />
                  Le nom de la pièce correspond au compte Mobile Money
                </label>
                <label className="check">
                  <input type="checkbox" required />
                  Le selfie correspond à la pièce
                </label>
                <SubmitButton>Approuver la boutique</SubmitButton>
              </form>
              <form action={action} className="stack">
                <label>
                  Motif (envoyé au vendeur)
                  <select name="reason" required defaultValue="">
                    <option value="" disabled>
                      Choisir un motif…
                    </option>
                    <option>Verso de la pièce manquant</option>
                    <option>Pièce illisible ou coupée</option>
                    <option>Selfie ne correspondant pas à la pièce</option>
                    <option>Nom du compte Mobile Money différent de la pièce</option>
                    <option>Pièce expirée</option>
                    <option>Documents d'entreprise manquants</option>
                  </select>
                </label>
                <div className="chips">
                  <button
                    type="submit"
                    name="decision"
                    value="rejected"
                    className="button secondary"
                  >
                    Demander un document
                  </button>
                  <button type="submit" name="decision" value="suspended" className="button danger">
                    Refuser et suspendre
                  </button>
                </div>
              </form>
            </>
          ) : seller.verificationStatus === 'verified' ? (
            <form action={action} className="stack">
              <label>
                Motif de la suspension (envoyé au vendeur)
                <input name="reason" minLength={3} maxLength={300} required />
              </label>
              <button type="submit" name="decision" value="suspended" className="button danger">
                Suspendre la boutique
              </button>
            </form>
          ) : null}
        </div>
      </section>
    </>
  );
}
