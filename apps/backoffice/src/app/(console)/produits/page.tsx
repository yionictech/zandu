import { TriangleAlert } from 'lucide-react';
import { act, field, load } from '@/lib/api';
import { formatXaf } from '@/lib/format';
import { VERIFICATION } from '@/lib/labels';
import { SubmitButton } from '@/components/SubmitButton';
import { Badge, Empty, Flash, Tabs, readParams, type SearchParams } from '@/components/ui';

export const metadata = { title: 'Catalogue' };

type Status = 'pending_review' | 'rejected' | 'published';
const STATUSES: Array<[Status, string]> = [
  ['pending_review', 'À valider'],
  ['published', 'En ligne'],
  ['rejected', 'Refusés'],
];

const ALERTS = {
  low_price: 'Prix très bas pour la catégorie',
  single_photo: 'Photo unique',
  no_description: 'Description vide',
} as const;

const CONDITION = { new: null, refurbished: 'Reconditionné', used: 'Occasion' } as const;

async function moderate(form: FormData) {
  'use server';
  const id = field(form, 'id');
  const decision = field(form, 'decision') as 'published' | 'rejected';
  const reason = field(form, 'reason');
  await act(
    `/produits?statut=${field(form, 'back')}`,
    decision === 'published' ? 'Produit mis en ligne' : 'Produit refusé, le vendeur voit le motif',
    (api) =>
      api.POST('/v1/admin/products/{id}/moderation', {
        params: { path: { id } },
        body: { decision, ...(reason ? { reason } : {}) },
      }),
  );
}

/**
 * Catalogue (maquette) : les nouveaux produits passent ici avant d'être visibles. Les alertes
 * sont calculées (prix très bas pour la catégorie, photo unique, description vide). On vérifie
 * aussi l'absence de numéro de téléphone ou de lien hors plateforme.
 */
export default async function CatalogPage({ searchParams }: { searchParams: SearchParams }) {
  const { one, ok, erreur } = await readParams(searchParams);
  const status = STATUSES.find(([s]) => s === one('statut'))?.[0] ?? 'pending_review';
  const { items, counts } = await load((api) =>
    api.GET('/v1/admin/products', { params: { query: { status } } }),
  );
  return (
    <>
      <header className="page-header">
        <div>
          <h1>Catalogue</h1>
          <div className="subtitle">
            Les nouveaux produits passent ici avant d'être visibles. Les alertes sont calculées
            automatiquement. Objectif : sous 2 h.
          </div>
        </div>
        <Tabs
          items={STATUSES.map(([s, label]) => ({
            href: `/produits?statut=${s}`,
            label,
            active: s === status,
            count: counts[s],
          }))}
        />
      </header>
      <Flash ok={ok} erreur={erreur} />
      {items.length === 0 ? <Empty>Rien dans cette liste.</Empty> : null}
      <section className="catalog">
        {items.map((p) => {
          const [verification, tone] = VERIFICATION[p.sellerVerification];
          const condition = CONDITION[p.condition];
          return (
            <article
              key={p.id}
              className={`card ${p.alerts.length && status === 'pending_review' ? 'alerted' : ''}`}
              data-testid={`moderation-${p.id}`}
            >
              <div className="cover">
                {p.photos[0] ? (
                  <a href={p.photos[0]} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.photos[0]} alt={p.title} />
                  </a>
                ) : null}
                <Badge>
                  {p.photos.length > 1 ? `${p.photos.length} photos` : `${p.photos.length} photo`}
                </Badge>
              </div>
              <h3>{p.title}</h3>
              <div className="small muted">
                {p.shopName} · <Badge tone={tone}>{verification}</Badge> · {p.category}
                {condition ? ` · ${condition}` : ''}
              </div>
              <div className="price">{formatXaf(p.price)}</div>
              {p.description ? (
                <p className="small muted" style={{ margin: 0 }}>
                  {p.description.length > 140 ? `${p.description.slice(0, 140)}…` : p.description}
                </p>
              ) : null}
              {status === 'pending_review'
                ? p.alerts.map((a) => (
                    <div key={a} className="alert-line">
                      <TriangleAlert size={14} aria-hidden /> {ALERTS[a]}
                    </div>
                  ))
                : null}
              {p.rejectionReason ? (
                <p className="small" style={{ margin: 0 }}>
                  Motif du refus : <strong>{p.rejectionReason}</strong>
                </p>
              ) : null}
              {status !== 'rejected' ? (
                <select
                  name="reason"
                  form={`reject-${p.id}`}
                  required
                  defaultValue=""
                  aria-label="Motif du refus"
                >
                  <option value="" disabled>
                    Motif du refus…
                  </option>
                  <option>Photo floue ou trop sombre</option>
                  <option>Photo prise sur Internet</option>
                  <option>Prix anormal</option>
                  <option>Numéro de téléphone ou lien dans l'annonce</option>
                  <option>Produit interdit à la vente</option>
                </select>
              ) : null}
              <div className="pair">
                {status !== 'rejected' ? (
                  <form action={moderate} id={`reject-${p.id}`}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="back" value={status} />
                    <input type="hidden" name="decision" value="rejected" />
                    <SubmitButton variant="danger">Refuser</SubmitButton>
                  </form>
                ) : null}
                {status !== 'published' ? (
                  <form action={moderate}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="back" value={status} />
                    <input type="hidden" name="decision" value="published" />
                    <SubmitButton>Mettre en ligne</SubmitButton>
                  </form>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>
    </>
  );
}
