import Link from 'next/link';
import { act, field, load } from '@/lib/api';
import { formatF, formatTime, formatDateTime, formatXaf, OPERATORS } from '@/lib/format';
import { MONEY_STATUS } from '@/lib/labels';
import { SubmitButton } from '@/components/SubmitButton';
import { Badge, Empty, Flash, Tabs, readParams, type SearchParams } from '@/components/ui';

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

async function decide(id: string, form: FormData) {
  'use server';
  const decision = field(form, 'decision') === 'approve' ? 'approve' : 'reject';
  await act(
    '/paiements',
    decision === 'approve' ? 'Retrait validé : il part vers le vendeur' : 'Retrait refusé',
    (api) =>
      api.POST('/v1/support/withdrawals/{id}/decision', {
        params: { path: { id } },
        body: { decision, note: field(form, 'note') },
      }),
  );
}

/**
 * Paiements (maquette) : encaissé, en séquestre, libéré, échecs ; répartition MTN / Airtel ;
 * « Retraits à contrôler » quand le retrait à la demande est actif (§4.3) ; mouvements.
 */
export default async function PaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  const { one, ok, erreur } = await readParams(searchParams);
  const period = (PERIODS.find(([p]) => p === one('periode'))?.[0] ?? 'today') as Period;
  const kind = (KINDS.find(([k]) => k === one('type'))?.[0] ?? 'all') as Kind;
  const [p, me, review] = await Promise.all([
    load((api) => api.GET('/v1/support/payments', { params: { query: { period, kind } } })),
    load((api) => api.GET('/v1/me')),
    load((api) => api.GET('/v1/support/withdrawals')),
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

      <Flash ok={ok} erreur={erreur} />
      {review.items.length ? (
        <section className="card" data-testid="withdrawals-review">
          <h2>Retraits à contrôler</h2>
          <p className="small muted">
            Au-delà du seuil réglé dans Paramètres. Le montant est réservé : il part à la
            validation, ou revient sur le solde du vendeur en cas de refus.
          </p>
          <table>
            <thead>
              <tr>
                <th>Demandé</th>
                <th>Boutique</th>
                <th>Compte Mobile Money</th>
                <th className="num">Montant</th>
                <th>{admin ? 'Décision' : ''}</th>
              </tr>
            </thead>
            <tbody>
              {review.items.map((w) => (
                <tr key={w.id}>
                  <td className="nowrap">{formatDateTime(w.createdAt)}</td>
                  <td>
                    <Link href={`/vendeurs/${w.sellerId}`}>{w.shopName}</Link>
                  </td>
                  <td>
                    {OPERATORS[w.operator]} · {w.phone}
                    <div className="small muted">{w.accountName ?? 'Titulaire non renseigné'}</div>
                  </td>
                  <td className="num">
                    <strong>{formatXaf(w.amount)}</strong>
                  </td>
                  <td>
                    {admin ? (
                      <form action={decide.bind(null, w.id)} className="inline">
                        <input
                          name="note"
                          required
                          minLength={3}
                          maxLength={300}
                          placeholder="Motif"
                          aria-label="Motif"
                        />
                        <SubmitButton name="decision" value="approve">
                          Valider
                        </SubmitButton>
                        <SubmitButton variant="danger" name="decision" value="reject">
                          Refuser
                        </SubmitButton>
                      </form>
                    ) : (
                      <span className="small muted">Décision des administrateurs</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

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
