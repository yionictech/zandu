import type { Discrepancy } from '@zandu/api-client';
import Link from 'next/link';
import { act, field, load } from '@/lib/api';
import {
  displayPhone,
  formatDateTime,
  formatTime,
  formatXaf,
  plural,
  signedXaf,
} from '@/lib/format';
import { ADJUSTMENTS, DISCREPANCY_KIND } from '@/lib/labels';
import { formatDay, fullDay } from '@/lib/periods';
import { RunBadge } from '@/components/RunBadge';
import { SubmitButton } from '@/components/SubmitButton';
import { Badge, Flash, PageHeader, readParams, type SearchParams } from '@/components/ui';

export const metadata = { title: 'Contrôle de caisse' };

type Adjustment = keyof typeof ADJUSTMENTS;

async function rerun(id: string, date: string) {
  'use server';
  await act(`/rapprochement/${id}`, 'Contrôle relancé', (api) =>
    api.POST('/v1/admin/reconciliation/runs', { body: { date } }),
  );
}

async function resolve(runId: string, discrepancyId: string, form: FormData) {
  'use server';
  const adjustment = field(form, 'adjustment') as Adjustment | '';
  await act(
    `/rapprochement/${runId}`,
    adjustment ? 'Écart clos, écriture de régularisation passée' : 'Écart clos',
    (api) =>
      api.POST('/v1/admin/reconciliation/discrepancies/{id}/resolve', {
        params: { path: { id: discrepancyId } },
        body: { note: field(form, 'note'), ...(adjustment ? { adjustment } : {}) },
      }),
  );
}

/** Écritures possibles pour cet écart, la plus probable en premier. */
function adjustmentChoices(d: Discrepancy): Array<Adjustment | ''> {
  // Un écart de solde se régularise toujours : rien ne l'explique au relevé.
  if (d.kind === 'balance_mismatch')
    return d.difference > 0 ? ['suspense', 'platform_funding'] : ['suspense', 'payment_fees'];
  // Argent en moins, inconnu de Zandu ou en frais : le plus souvent, des frais.
  const likelyFees =
    d.difference < 0 && (d.kind === 'fee_mismatch' || d.kind === 'missing_internal');
  const choices: Array<Adjustment | ''> = likelyFees
    ? ['payment_fees', '', 'suspense']
    : ['', 'suspense', 'payment_fees'];
  if (d.difference > 0) choices.push('platform_funding');
  return choices;
}

function Amounts({ d }: { d: Discrepancy }) {
  return (
    <dl className="kv">
      <dt>Chez l'agrégateur</dt>
      <dd>{signedXaf(d.providerAmount)}</dd>
      <dt>Chez Zandu</dt>
      <dd>{signedXaf(d.internalAmount)}</dd>
      <dt>À régulariser</dt>
      <dd className="big-money">{signedXaf(d.difference)}</dd>
      <dt>Concerne</dt>
      <dd>
        {d.publicRef ? (
          <Link className="ref" href={`/commandes/${d.orderId}`}>
            {d.publicRef}
          </Link>
        ) : null}{' '}
        <span className="ref small muted">
          {d.operationKind === 'balance' ? 'solde de la journée' : (d.providerRef ?? d.reference)}
        </span>
      </dd>
    </dl>
  );
}

function DiscrepancyCard({ d, runId }: { d: Discrepancy; runId: string }) {
  const kind = DISCREPANCY_KIND[d.kind];
  const r = d.resolution;
  return (
    <article
      id={`ecart-${d.id}`}
      className={`card discrepancy ${r ? 'resolved' : ''}`}
      data-testid="discrepancy"
    >
      <header className="discrepancy-head">
        <Badge tone={r ? 'neutral' : 'danger'}>{kind.label}</Badge>
        <strong>{d.message}</strong>
        <span className="small muted">signalé le {formatDateTime(d.createdAt)}</span>
      </header>
      <Amounts d={d} />
      {r ? (
        <p className="resolution">
          ✔ {r.automatic ? 'Résolu automatiquement' : `Clos par ${displayPhone(r.by)}`} le{' '}
          {formatDateTime(r.at)} :{' '}
          {r.automatic ? r.note.replace(/^Résolu automatiquement : /, '') : r.note}
          {r.adjustment ? (
            <>
              <br />
              Écriture : {ADJUSTMENTS[r.adjustment.counterpart]}, {signedXaf(r.adjustment.amount)}{' '}
              sur le compte agrégateur.
            </>
          ) : null}
        </p>
      ) : (
        <form action={resolve.bind(null, runId, d.id)} className="stack">
          <p className="definitions">{kind.help}</p>
          <div className="grid grid-2">
            <label>
              Écriture de régularisation ({signedXaf(d.difference)})
              <select name="adjustment" defaultValue={adjustmentChoices(d)[0]}>
                {adjustmentChoices(d).map((choice) => (
                  <option key={choice || 'none'} value={choice}>
                    {choice ? ADJUSTMENTS[choice] : 'Aucune écriture : écart expliqué'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Explication (journal d'audit)
              <input
                name="note"
                minLength={3}
                maxLength={500}
                required
                placeholder="Ex. Frais de tenue de compte confirmés par l'agrégateur"
              />
            </label>
          </div>
          <SubmitButton confirm="Clore cet écart ? L'écriture choisie sera passée au grand livre.">
            Clore l'écart
          </SubmitButton>
        </form>
      )}
    </article>
  );
}

/**
 * Un contrôle de caisse : ce que l'agrégateur a listé, ce que le grand livre explique (état de
 * rapprochement), et chaque écart avec sa résolution motivée.
 */
export default async function ReconciliationRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { ok, erreur } = await readParams(searchParams);
  const { run, discrepancies } = await load((api) =>
    api.GET('/v1/admin/reconciliation/runs/{id}', { params: { path: { id } } }),
  );
  const s = run.summary;
  const b = s.balance;
  const until =
    run.coveredUntil && !fullDay(run.date, run.coveredUntil)
      ? `jusqu'à ${formatTime(run.coveredUntil)}`
      : 'journée entière';
  return (
    <>
      <PageHeader
        title={`Contrôle du ${formatDay(run.date)}`}
        subtitle={
          <>
            Agrégateur {run.provider} · {until} · <RunBadge run={run} />
            {run.attempts > 1 ? ` · ${run.attempts} passages` : ''}
          </>
        }
      >
        <form action={rerun.bind(null, run.id, run.date)}>
          <SubmitButton variant="secondary">Relancer le contrôle</SubmitButton>
        </form>
      </PageHeader>
      <Flash ok={ok} erreur={erreur} />
      <p>
        <Link href="/rapprochement">← Tous les contrôles</Link>
      </p>

      {s.error ? (
        <section className="card flash erreur">
          Relevé de l'agrégateur indisponible : {s.error}. Nouvelle demande automatique toutes les
          30 minutes.
        </section>
      ) : (
        <section className="grid grid-4">
          <div className="card kpi">
            <span className="label">Mouvements au relevé</span>
            <span className="value">{s.statement?.lines ?? 0}</span>
            <span className="note">
              {s.statement
                ? [
                    plural(s.statement.collections.count, 'paiement'),
                    plural(s.statement.payouts.count, 'reversement'),
                    plural(s.statement.refunds.count, 'remboursement'),
                    plural(s.statement.other.count, 'mouvement propre', 'mouvements propres'),
                  ]
                    .filter(Boolean)
                    .join(', ') || 'aucun'
                : ''}
            </span>
          </div>
          <div className="card kpi">
            <span className="label">Retrouvés à l'identique</span>
            <span className="value" data-testid="matched">
              {s.matched ?? 0}
            </span>
            <span className="note">
              {s.statusesApplied?.count
                ? `dont ${plural(s.statusesApplied.count, 'opération')} conclue${s.statusesApplied.count > 1 ? 's' : ''} d'après le relevé`
                : 'au grand livre'}
            </span>
          </div>
          <div className="card kpi">
            <span className="label">Frais lus au relevé</span>
            <span className="value">{formatXaf(s.feesBooked?.amount ?? 0)}</span>
            <span className="note">comptabilisés par le contrôle</span>
          </div>
          <div className="card kpi">
            <span className="label">Attendus au relevé suivant</span>
            <span className="value">{s.inTransit?.count ?? 0}</span>
            <span className="note">
              {s.inTransit?.count
                ? `${signedXaf(s.inTransit.amount)} enregistrés juste avant minuit`
                : 'aucun mouvement à cheval sur minuit'}
            </span>
          </div>
        </section>
      )}

      {b ? (
        <section className="card table-card">
          <h2>État de rapprochement</h2>
          <table data-testid="balance">
            <tbody>
              <tr>
                <td>Solde du compte agrégateur au grand livre</td>
                <td className="num">{formatXaf(b.ledger)}</td>
              </tr>
              {b.laterAdjustments ? (
                <tr>
                  <td>Régularisations passées depuis pour cette période</td>
                  <td className="num">{signedXaf(b.laterAdjustments)}</td>
                </tr>
              ) : null}
              <tr>
                <td>Comptabilisé chez Zandu, pas encore au relevé</td>
                <td className="num">{signedXaf(-b.notOnStatement)}</td>
              </tr>
              <tr>
                <td>Au relevé, pas comptabilisé chez Zandu</td>
                <td className="num">{signedXaf(b.notInLedger)}</td>
              </tr>
              <tr>
                <td>Écarts de montant</td>
                <td className="num">{signedXaf(b.amountDifferences)}</td>
              </tr>
              <tr>
                <th>Solde attendu chez l'agrégateur</th>
                <th className="num">{formatXaf(b.provider - b.unexplained)}</th>
              </tr>
              <tr>
                <th>Solde annoncé par l'agrégateur</th>
                <th className="num">{formatXaf(b.provider)}</th>
              </tr>
              <tr className={b.unexplained ? 'row-danger' : 'row-ok'}>
                <th>Écart inexpliqué</th>
                <th className="num" data-testid="unexplained">
                  {signedXaf(b.unexplained)}
                </th>
              </tr>
            </tbody>
          </table>
          <p className="definitions">
            On part du grand livre, on ajoute ce que chacun n'a pas encore vu, et l'on doit
            retrouver exactement le solde de l'agrégateur. Les écarts listés ci-dessous expliquent
            les lignes du milieu.
          </p>
        </section>
      ) : null}

      <h2>Écarts ({discrepancies.length})</h2>
      {discrepancies.length ? (
        <div className="discrepancies">
          {discrepancies.map((d) => (
            <DiscrepancyCard key={d.id} d={d} runId={run.id} />
          ))}
        </div>
      ) : (
        <p className="card flash ok">
          ✔ Chaque mouvement du relevé est retrouvé au grand livre, et inversement.
        </p>
      )}
    </>
  );
}
