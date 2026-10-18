import Link from 'next/link';
import { act, load } from '@/lib/api';
import { formatTime, formatXaf, signedXaf } from '@/lib/format';
import { DISCREPANCY_KIND } from '@/lib/labels';
import { formatDay, formatShortDay, fullDay, today } from '@/lib/periods';
import { RunBadge } from '@/components/RunBadge';
import { SubmitButton } from '@/components/SubmitButton';
import { Badge, Empty, Flash, PageHeader, readParams, type SearchParams } from '@/components/ui';

export const metadata = { title: 'Rapprochement' };

async function controlToday() {
  'use server';
  await act('/rapprochement', 'Journée en cours contrôlée jusqu’à maintenant', (api) =>
    api.POST('/v1/admin/reconciliation/runs', { body: { date: today() } }),
  );
}

/**
 * Rapprochement (ADR-0015) : chaque nuit, le relevé de l'agrégateur est comparé au grand livre,
 * opération par opération. Critère de recette : 7 jours de suite sans écart.
 */
export default async function ReconciliationPage({ searchParams }: { searchParams: SearchParams }) {
  const { ok, erreur } = await readParams(searchParams);
  const [{ items: runs, streak, open }, { items: discrepancies }] = await Promise.all([
    load((api) => api.GET('/v1/admin/reconciliation/runs')),
    load((api) => api.GET('/v1/admin/reconciliation/discrepancies')),
  ]);
  const last = runs[0];
  const balance = runs.find((r) => r.summary.balance)?.summary.balance;
  return (
    <>
      <PageHeader
        title="Rapprochement"
        subtitle="Chaque nuit à 2 h, le relevé de l'agrégateur est comparé au grand livre, opération par opération."
      >
        <form action={controlToday}>
          <SubmitButton variant="secondary">Contrôler la journée en cours</SubmitButton>
        </form>
      </PageHeader>
      <Flash ok={ok} erreur={erreur} />

      <section className="grid grid-4">
        <div className="card kpi">
          <span className="label">Jours de suite sans écart</span>
          <span className="value" data-testid="streak">
            {streak}
          </span>
          <span className="note">Objectif de recette : 7</span>
        </div>
        <div className="card kpi">
          <span className="label">Écarts à traiter</span>
          <span className="value" data-testid="open-count">
            {open.count}
          </span>
          <span className="note">{open.count ? formatXaf(open.amount) : 'Aucun'}</span>
        </div>
        <div className="card kpi">
          <span className="label">Dernier contrôle</span>
          <span className="value">{last ? formatShortDay(last.date) : '—'}</span>
          <span className="note">
            {last ? <RunBadge run={last} /> : 'Premier contrôle cette nuit'}
          </span>
        </div>
        <div className="card kpi">
          <span className="label">Solde chez l'agrégateur</span>
          <span className="value">{balance ? formatXaf(balance.provider) : '—'}</span>
          <span className="note">
            {balance
              ? balance.unexplained === 0
                ? 'Entièrement expliqué par le grand livre'
                : `${signedXaf(balance.unexplained)} inexpliqués`
              : 'Selon le dernier relevé'}
          </span>
        </div>
      </section>

      {discrepancies.length ? (
        <section className="card table-card">
          <h2>Écarts à traiter</h2>
          <table data-testid="open-discrepancies">
            <thead>
              <tr>
                <th>Journée</th>
                <th>Écart</th>
                <th>Concerne</th>
                <th className="num">Montant</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {discrepancies.map((d) => (
                <tr key={d.id}>
                  <td>{formatDay(d.date)}</td>
                  <td>
                    <Badge tone="danger">{DISCREPANCY_KIND[d.kind].label}</Badge>
                    <div className="small muted">{d.message}</div>
                  </td>
                  <td>
                    {d.publicRef ? (
                      <Link className="ref" href={`/commandes/${d.orderId}`}>
                        {d.publicRef}
                      </Link>
                    ) : (
                      <span className="ref small muted">{d.providerRef ?? d.reference}</span>
                    )}
                  </td>
                  <td className="num nowrap">{signedXaf(d.difference)}</td>
                  <td>
                    <Link className="nowrap" href={`/rapprochement/${d.runId}#ecart-${d.id}`}>
                      Examiner →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="card table-card">
        <h2>Contrôles</h2>
        {runs.length ? (
          <table data-testid="runs">
            <thead>
              <tr>
                <th>Journée</th>
                <th className="num">Mouvements au relevé</th>
                <th className="num">Retrouvés</th>
                <th className="num">Frais lus au relevé</th>
                <th className="num">Écarts</th>
                <th>État</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const s = run.summary;
                const partial =
                  run.coveredUntil && !fullDay(run.date, run.coveredUntil)
                    ? ` jusqu'à ${formatTime(run.coveredUntil)}`
                    : '';
                return (
                  <tr key={run.id}>
                    <td>
                      <Link href={`/rapprochement/${run.id}`}>{formatDay(run.date)}</Link>
                      {partial ? <span className="small muted">{partial}</span> : null}
                    </td>
                    <td className="num">{s.statement?.lines ?? '—'}</td>
                    <td className="num">{s.matched ?? '—'}</td>
                    <td className="num">{s.feesBooked ? formatXaf(s.feesBooked.amount) : '—'}</td>
                    <td className="num">
                      {s.discrepancies
                        ? s.discrepancies.open
                          ? `${s.discrepancies.open} / ${s.discrepancies.found}`
                          : s.discrepancies.found
                        : '—'}
                    </td>
                    <td>
                      <RunBadge run={run} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty>
            Aucun contrôle pour l'instant : le premier a lieu la nuit qui suit le premier paiement.
          </Empty>
        )}
        <p className="definitions">
          Écarts : encore ouverts / trouvés. « Retrouvés » : mouvements du relevé présents à
          l'identique au grand livre. Les frais que l'agrégateur n'annonce qu'au relevé sont
          comptabilisés par le contrôle, à la date de l'opération.
        </p>
      </section>
    </>
  );
}
