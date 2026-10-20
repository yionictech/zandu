import Link from 'next/link';
import { load } from '@/lib/api';
import { deadline, formatXaf } from '@/lib/format';
import { DISPUTE_REASON } from '@/lib/labels';
import { Badge, Tabs } from '@/components/ui';

/** Colonne de gauche de « Litiges » (maquette) : une carte par litige, la sélection en citron. */
export async function DisputeList({
  status,
  selected,
}: {
  status: 'open' | 'resolved';
  selected?: string;
}) {
  const { items } = await load((api) =>
    api.GET('/v1/support/disputes', { params: { query: { status } } }),
  );
  if (items.length === 0)
    return (
      <div className="card empty">
        {status === 'open' ? 'Aucun litige ouvert.' : 'Aucun litige résolu.'}
      </div>
    );
  return (
    <div className="grid" style={{ gap: 10 }}>
      {items.map((d) => {
        const due = deadline(d.slaDueAt);
        return (
          <Link
            key={d.id}
            href={`/litiges/${d.id}${status === 'resolved' ? '?vue=resolus' : ''}`}
            className={`card dispute-card ${d.id === selected ? 'active' : ''}`}
            data-testid={`dispute-${d.publicRef}`}
          >
            <div className="panel-head">
              <span className="ref">{d.publicRef}</span>
              {status === 'resolved' ? (
                <Badge>Tranché</Badge>
              ) : d.sellerChoice ? (
                <Badge tone={due.late ? 'danger' : 'brand'}>À trancher</Badge>
              ) : (
                <Badge tone={due.late ? 'danger' : 'waiting'}>Attente vendeur</Badge>
              )}
            </div>
            <strong>{DISPUTE_REASON[d.reason]}</strong>
            <div className="panel-head small muted">
              <span>
                {d.buyerName ?? 'Acheteur'} · {d.shopName}
              </span>
              <span>{formatXaf(d.total)}</span>
            </div>
            {status === 'open' ? (
              <span className={`small ${due.late ? 'alert-line' : 'muted'}`}>
                Décision {due.late ? due.label : `à rendre ${due.label}`}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

/** En-tête de « Litiges » : onglets Ouverts / Résolus. */
export function DisputesHeader({
  open,
  resolved,
  showResolved,
}: {
  open: number;
  resolved: number;
  showResolved: boolean;
}) {
  return (
    <header className="page-header">
      <h1>Litiges</h1>
      <Tabs
        items={[
          { href: '/litiges', label: 'Ouverts', count: open, active: !showResolved },
          { href: '/litiges?vue=resolus', label: 'Résolus', count: resolved, active: showResolved },
        ]}
      />
    </header>
  );
}
