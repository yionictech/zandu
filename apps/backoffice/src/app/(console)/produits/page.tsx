import { act, field, load } from '@/lib/api';
import { formatDateTime, formatXaf } from '@/lib/format';
import { VERIFICATION } from '@/lib/labels';
import { SubmitButton } from '@/components/SubmitButton';
import {
  Badge,
  Empty,
  Flash,
  PageHeader,
  Tabs,
  readParams,
  type SearchParams,
} from '@/components/ui';

export const metadata = { title: 'Modération' };

type Status = 'pending_review' | 'rejected' | 'published';
const STATUSES: Array<[Status, string]> = [
  ['pending_review', 'À modérer'],
  ['rejected', 'Refusés'],
  ['published', 'En ligne'],
];

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
 * Modération (rampe de confiance) : les produits des boutiques non vérifiées passent ici avant
 * d'être en ligne. On vérifie la photo, le prix, et l'absence de contact hors plateforme.
 */
export default async function ModerationPage({ searchParams }: { searchParams: SearchParams }) {
  const { one, ok, erreur } = await readParams(searchParams);
  const status = STATUSES.find(([s]) => s === one('statut'))?.[0] ?? 'pending_review';
  const { items } = await load((api) =>
    api.GET('/v1/admin/products', { params: { query: { status } } }),
  );
  return (
    <>
      <PageHeader
        title="Modération des produits"
        subtitle="Photo réelle et nette, prix plausible, aucun numéro de téléphone ni lien externe. Objectif : sous 2 h."
      />
      <Flash ok={ok} erreur={erreur} />
      <Tabs
        items={STATUSES.map(([s, label]) => ({
          href: `/produits?statut=${s}`,
          label,
          active: s === status,
        }))}
      />
      {items.length === 0 ? <Empty>Rien à modérer. Bravo !</Empty> : null}
      {items.map((p) => {
        const [verification, tone] = VERIFICATION[p.sellerVerification];
        return (
          <article key={p.id} className="card product-card" data-testid={`moderation-${p.id}`}>
            <div className="grid">
              {p.photos[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="cover" src={p.photos[0]} alt={p.title} />
              ) : (
                <div className="cover empty">Aucune photo</div>
              )}
              {p.photos.length > 1 ? (
                <div className="gallery">
                  {p.photos.slice(1).map((url) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={url} src={url} alt="" style={{ width: 64, height: 64 }} />
                  ))}
                </div>
              ) : null}
            </div>
            <div className="grid" style={{ alignContent: 'start' }}>
              <div>
                <h2 style={{ marginBottom: 4 }}>{p.title}</h2>
                <span className="big-money">{formatXaf(p.price)}</span>{' '}
                <span className="muted">
                  · {p.category} · stock {p.stock} · modifié {formatDateTime(p.updatedAt)}
                </span>
              </div>
              <div>
                {p.shopName} <Badge tone={tone}>{verification}</Badge>
              </div>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                {p.description || <span className="muted">Pas de description.</span>}
              </p>
              {p.rejectionReason ? (
                <p className="small" style={{ margin: 0 }}>
                  Motif du refus : <strong>{p.rejectionReason}</strong>
                </p>
              ) : null}
              <div className="decisions">
                {status !== 'published' ? (
                  <form action={moderate}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="back" value={status} />
                    <input type="hidden" name="decision" value="published" />
                    <SubmitButton variant="trust">Mettre en ligne</SubmitButton>
                  </form>
                ) : null}
                {status !== 'rejected' ? (
                  <form action={moderate} className="inline">
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="back" value={status} />
                    <input type="hidden" name="decision" value="rejected" />
                    <select name="reason" required defaultValue="" aria-label="Motif du refus">
                      <option value="" disabled>
                        Motif du refus…
                      </option>
                      <option>Photo floue ou trop sombre</option>
                      <option>Photo prise sur Internet</option>
                      <option>Prix anormal</option>
                      <option>Numéro de téléphone ou lien dans l'annonce</option>
                      <option>Produit interdit à la vente</option>
                    </select>
                    <SubmitButton variant="danger">Refuser</SubmitButton>
                  </form>
                ) : null}
              </div>
            </div>
          </article>
        );
      })}
    </>
  );
}
