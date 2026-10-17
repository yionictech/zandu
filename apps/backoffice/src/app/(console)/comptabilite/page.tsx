import { load } from '@/lib/api';
import { formatXaf } from '@/lib/format';
import { accountLabel } from '@/lib/labels';
import { PageHeader } from '@/components/ui';

export const metadata = { title: 'Comptabilité' };

/**
 * Contrôle comptable : le grand livre est en partie double, la balance générale vaut toujours 0.
 * Les comptes par vendeur et par livreur sont regroupés.
 */
export default async function AccountingPage() {
  const { trialBalance, accounts } = await load((api) => api.GET('/v1/admin/ledger/balances'));
  const grouped = new Map<string, number>();
  for (const a of accounts) {
    const label = accountLabel(a.code);
    grouped.set(label, (grouped.get(label) ?? 0) + a.balance);
  }
  const balanced = trialBalance === 0;
  return (
    <>
      <PageHeader
        title="Contrôle comptable"
        subtitle="Grand livre en partie double, en écriture seule."
      />
      <section className={`card flash ${balanced ? 'ok' : 'erreur'}`} data-testid="trial-balance">
        {balanced
          ? '✔ Balance générale : 0 FCFA — chaque franc entré est expliqué.'
          : `✖ Balance générale : ${formatXaf(trialBalance)} — écart à investiguer immédiatement.`}
      </section>
      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Compte</th>
              <th className="num">Solde</th>
            </tr>
          </thead>
          <tbody>
            {[...grouped.entries()].map(([label, balance]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="num">{formatXaf(balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
