import Link from 'next/link';
import { load } from '@/lib/api';
import { formatF, formatTime, formatDateTime, formatXaf, OPERATORS } from '@/lib/format';
import { MONEY_STATUS } from '@/lib/labels';
import { Badge, Empty, Tabs, readParams, type SearchParams } from '@/components/ui';

export const metadata = { title: 'Paiements' };

const PERIODS = [
  ['today', 'Aujourd’hui'],
  ['7d', '7 jours'],
  ['30d', '30 jours'],
] as const;
type Period = (typeof PERIODS)[number][0];

const KINDS = [
  ['all', 'Tous'],
  ['in', 'Encaissements'],
  ['out', 'Sorties'],
] as const;
type Kind = (typeof KINDS)[number][0];

const KIND_LABEL = {
  collection: 'Encaissement',
  payout: 'Reversement vendeur',
  refund: 'Remboursement',
} as const;

/** Statut d'un mouvement : un encaissement réussi est « bloqué » (séquestre). */
function statusBadge(kind: keyof typeof KIND_LABEL, status: string) {
  if (kind === 'collection' && status === 'succeeded') return <Badge tone="waiting">Bloqué</Badge>;
  if (kind === 'refund' && status === 'succeeded') return <Badge tone="danger">Remboursé</Badge>;
  const [label, tone] = MONEY_STATUS[status] ?? [status, 'neutral' as const];
  return <Badge tone={tone}>{label}</Badge>;
}

function Kpi({
  label,
  value,
  note,
  dot,
}: {
  label: string;
  value: string;
  note: string;
  dot: string;
}) {
  return (
    <div className="card kpi">
      <span className="label dot" style={{ ['--dot' as string]: dot }}>
        {label}
      </span>
      <span className="value">{value}</span>
      <span className="note">{note}</span>
    </div>
  );
}

/**
 * Paiements (maquette) : encaissé, en séquestre, libéré, échecs ; répartition MTN / Airtel ;
 * mouvements. Les retraits à la demande attendent la décision du §4.3 (versement automatique
 * aujourd'hui) : la carte « Retrait à contrôler » devient celle des versements en échec.
 */
export default async function PaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  const { one } = await readParams(searchParams);
  const period = (PERIODS.find(([p]) => p === one('periode'))?.[0] ?? 'today') as Period;
  const kind = (KINDS.find(([k]) => k === one('type'))?.[0] ?? 'all') as Kind;
  const [p, me] = await Promise.all([
    load((api) => api.GET('/v1/support/payments', { params: { query: { period, kind } } })),
    load((api) => api.GET('/v1/me')),
  ]);
  const admin = me.roles.includes('admin');
  const total = p.byOperator.reduce((n, o) => n + o.amount, 0);
  const share = (op: 'mtn' | 'airtel') =>
    total
      ? Math.round(((p.byOperator.find((o) => o.operator === op)?.amount ?? 0) / total) * 100)
      : 0;
  const link = (params: Record<string, string>) =>
    `/paiements?${new URLSearchParams({ periode: period, type: kind, ...params })}`;
  const periodLabel =
    period === 'today' ? 'aujourd’hui' : `sur ${period === '7d' ? '7' : '30'} jours`;

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Paiements</h1>
          <div className="subtitle">Mobile Money : encaissé, bloqué en séquestre, reversé.</div>
        </div>
        <div className="chips">
          <Tabs
            items={PERIODS.map(([key, label]) => ({
              href: link({ periode: key }),
              label,
              active: key === period,
            }))}
          />
          {admin ? (
            <Link className="button secondary" href="/rapports">
              Rapports et export
            </Link>
          ) : null}
        </div>
      </header>

      <section className="grid grid-4">
        <Kpi
          label={`Encaissé ${periodLabel}`}
          value={formatF(p.collected.amount)}
          note={`${p.collected.count} paiement${p.collected.count > 1 ? 's' : ''} Mobile Money`}
          dot="var(--brand)"
        />
        <Kpi
          label="En séquestre"
          value={formatF(p.escrow)}
          note="Libéré à chaque remise confirmée"
          dot="var(--waiting)"
        />
        <Kpi
          label={`Reversé ${periodLabel}`}
          value={formatF(p.released.amount)}
          note={`Vers ${p.released.sellers} vendeur${p.released.sellers > 1 ? 's' : ''}`}
          dot="var(--accent)"
        />
        <Kpi
          label="Versements en attente"
          value={String(p.payoutsPending)}
          note={p.failures ? `Dont ${p.failures} en échec à reprendre` : 'Aucun échec'}
          dot="var(--danger)"
        />
      </section>

      <section className="grid grid-2">
        <div className="card grid">
          <h2>Encaissements par opérateur</h2>
          <div className="split-bar" aria-hidden>
            <span style={{ width: `${share('mtn')}%` }} />
            <span style={{ width: `${share('airtel')}%` }} />
          </div>
          <div className="panel-head small">
            <span className="kpi">
              <span className="label dot" style={{ ['--dot' as string]: 'var(--brand)' }}>
                MTN MoMo · {share('mtn')} %
              </span>
            </span>
            <span className="kpi">
              <span className="label dot" style={{ ['--dot' as string]: 'var(--accent)' }}>
                Airtel Money · {share('airtel')} %
              </span>
            </span>
          </div>
        </div>
        <div className="card grid">
          <div className="panel-head">
            <h2 style={{ margin: 0 }}>Argent à surveiller</h2>
            {p.failures ? (
              <Badge tone="danger">{p.failures} en échec</Badge>
            ) : (
              <Badge tone="trust">RAS</Badge>
            )}
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Reversements et remboursements en échec après 3 tentatives : l'argent est revenu sur le
            bon compte, il faut joindre la personne. Les retraits à la demande (et leur contrôle)
            attendent la décision sur le retrait (docs/ux/03 §4.3).
          </p>
          <div className="chips">
            <Link className="button secondary" href="/alertes">
              Voir les alertes
            </Link>
            <Link className="button secondary" href="/comptabilite">
              Contrôle comptable
            </Link>
            {admin ? (
              <Link className="button secondary" href="/rapprochement">
                Rapprochement
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid">
        <div className="page-header">
          <h2 style={{ margin: 0 }}>Mouvements</h2>
          <Tabs
            items={KINDS.map(([key, label]) => ({
              href: link({ type: key }),
              label,
              active: key === kind,
            }))}
          />
        </div>
        {p.movements.length === 0 ? (
          <Empty>Aucun mouvement.</Empty>
        ) : (
          <div className="card table-card">
            <table data-testid="movements">
              <thead>
                <tr>
                  <th>Heure</th>
                  <th>Type</th>
                  <th>Commande / bénéficiaire</th>
                  <th>Opérateur</th>
                  <th className="num">Montant</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {p.movements.map((m, i) => (
                  <tr key={`${m.kind}-${m.reference}-${i}`}>
                    <td className="muted nowrap">
                      {period === 'today' ? formatTime(m.at) : formatDateTime(m.at)}
                    </td>
                    <td>
                      <strong>{KIND_LABEL[m.kind]}</strong>
                    </td>
                    <td>
                      <span className="ref">{m.reference ?? '—'}</span>
                      {m.beneficiary ? <span className="muted"> → {m.beneficiary}</span> : null}
                    </td>
                    <td className="muted">{OPERATORS[m.operator]}</td>
                    <td className={`num ${m.amount > 0 ? 'amount-in' : 'amount-out'}`}>
                      <strong>
                        {m.amount > 0 ? '+' : '−'}
                        {formatXaf(Math.abs(m.amount)).replace(' FCFA', '')}
                      </strong>
                    </td>
                    <td>{statusBadge(m.kind, m.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
