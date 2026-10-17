import type { CommissionRule as Rule } from '@zandu/api-client';
import { redirect } from 'next/navigation';
import { act, field, load, withParam } from '@/lib/api';
import { endOfCongoDay, formatRate, startOfCongoDay } from '@/lib/periods';
import { SubmitButton } from '@/components/SubmitButton';
import { Badge, Flash, PageHeader, readParams, type SearchParams } from '@/components/ui';

export const metadata = { title: 'Commissions' };

const dateFormat = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Brazzaville',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
/** Les règles durent des mois : l'année compte. */
const ruleDate = (iso: string | null | undefined): string =>
  iso ? dateFormat.format(new Date(iso)) : '—';

const STATUS: Record<Rule['status'], [string, 'trust' | 'waiting' | 'neutral']> = {
  active: ["s'applique", 'trust'],
  overridden: ['en pause (offre en cours)', 'waiting'],
  scheduled: ['programmée', 'waiting'],
  ended: ['terminée', 'neutral'],
};

const target = (r: Rule): string =>
  r.scope === 'default'
    ? 'Taux par défaut'
    : r.scope === 'category'
      ? `Catégorie : ${r.categoryName}`
      : `Boutique : ${r.shopName}`;

/** « 8,5 » ou « 8.5 » (%) → 850 points de base ; null si hors de 0 à 50 %. */
function parseRate(value: string): number | null {
  const percent = Number(value.replace(',', '.').replace('%', '').trim());
  if (!value.trim() || !Number.isFinite(percent) || percent < 0 || percent > 50) return null;
  return Math.round(percent * 100);
}

async function createRule(form: FormData) {
  'use server';
  const [scope, id] = field(form, 'target').split(':') as [
    'default' | 'category' | 'seller',
    string,
  ];
  const rateBps = parseRate(field(form, 'rate'));
  if (rateBps === null)
    redirect(withParam('/commissions', 'erreur', 'Taux invalide : de 0 à 50 %'));
  const validFrom = startOfCongoDay(field(form, 'from'));
  const validTo = endOfCongoDay(field(form, 'until'));
  await act(
    '/commissions',
    'Nouveau taux enregistré : il s’applique aux prochaines commandes',
    (api) =>
      api.POST('/v1/admin/commission-rules', {
        body: {
          scope,
          ...(scope === 'category' ? { categoryId: id } : {}),
          ...(scope === 'seller' ? { sellerId: id } : {}),
          rateBps,
          ...(validFrom ? { validFrom } : {}),
          ...(validTo ? { validTo } : {}),
          note: field(form, 'note'),
        },
      }),
  );
}

async function endRule(id: string) {
  'use server';
  await act('/commissions', 'Règle terminée : le taux du niveau supérieur s’applique', (api) =>
    api.POST('/v1/admin/commission-rules/{id}/end', { params: { path: { id } } }),
  );
}

/**
 * Règles de commission (décision D8), modifiables par un administrateur : une boutique a la
 * priorité sur sa catégorie, une catégorie sur le taux par défaut. Chaque changement est
 * motivé et journalisé ; les commandes déjà passées gardent leur taux.
 */
export default async function CommissionsPage({ searchParams }: { searchParams: SearchParams }) {
  const { ok, erreur } = await readParams(searchParams);
  const [{ items: rules }, categories, { items: shops }] = await Promise.all([
    load((api) => api.GET('/v1/admin/commission-rules')),
    load((api) => api.GET('/v1/categories')),
    load((api) => api.GET('/v1/admin/sellers', { params: { query: { status: 'verified' } } })),
  ]);
  const current = rules.filter((r) => r.status !== 'ended');
  const past = rules.filter((r) => r.status === 'ended');
  const roots = categories.filter((c) => !c.parentId);
  return (
    <>
      <PageHeader
        title="Commissions"
        subtitle="Priorité : boutique, puis catégorie, puis taux par défaut. Les commandes passées gardent leur taux."
      />
      <Flash ok={ok} erreur={erreur} />

      <section className="card table-card">
        <h2>Taux en vigueur et programmés</h2>
        <table data-testid="rules">
          <thead>
            <tr>
              <th>Pour</th>
              <th className="num">Taux</th>
              <th>Depuis</th>
              <th>Jusqu'au</th>
              <th>Motif</th>
              <th>État</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {current.map((r) => {
              const [label, tone] = STATUS[r.status];
              const endable = r.scope !== 'default' || r.status === 'scheduled';
              return (
                <tr key={r.id} data-testid={`rule-${r.id}`}>
                  <td>{target(r)}</td>
                  <td className="num">
                    <strong>{formatRate(r.rateBps)}</strong>
                  </td>
                  <td>{ruleDate(r.validFrom)}</td>
                  <td>{r.validTo ? ruleDate(r.validTo) : '—'}</td>
                  <td>{r.note ?? '—'}</td>
                  <td>
                    <Badge tone={tone}>{label}</Badge>
                  </td>
                  <td>
                    {endable ? (
                      <form action={endRule.bind(null, r.id)}>
                        <SubmitButton
                          variant="secondary"
                          confirm={
                            r.status === 'scheduled'
                              ? 'Annuler cette règle programmée ?'
                              : 'Terminer cette règle maintenant ?'
                          }
                        >
                          {r.status === 'scheduled' ? 'Annuler' : 'Terminer'}
                        </SubmitButton>
                      </form>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Changer un taux</h2>
        <form action={createRule} className="stack" data-testid="new-rule">
          <div className="grid grid-2">
            <label>
              Pour
              <select name="target" required defaultValue="">
                <option value="" disabled>
                  Choisir…
                </option>
                <option value="default">Taux par défaut (toutes les ventes)</option>
                <optgroup label="Catégories">
                  {roots.flatMap((root) => [
                    <option key={root.id} value={`category:${root.id}`}>
                      {root.name}
                    </option>,
                    ...categories
                      .filter((c) => c.parentId === root.id)
                      .map((c) => (
                        <option key={c.id} value={`category:${c.id}`}>
                          {root.name} › {c.name}
                        </option>
                      )),
                  ])}
                </optgroup>
                <optgroup label="Boutiques vérifiées (offre, partenaire)">
                  {shops.map((shop) => (
                    <option key={shop.id} value={`seller:${shop.id}`}>
                      {shop.shopName}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <label>
              Nouveau taux (%)
              <input name="rate" inputMode="decimal" placeholder="Ex. 8 ou 7,5" required />
            </label>
            <label>
              À partir du (vide : immédiatement)
              <input name="from" type="date" />
            </label>
            <label>
              Jusqu'au, inclus (offre temporaire ; vide : permanent)
              <input name="until" type="date" />
            </label>
          </div>
          <label>
            Motif (journal d'audit)
            <input
              name="note"
              minLength={3}
              maxLength={200}
              required
              placeholder="Ex. Décision du comité du 15 octobre"
            />
          </label>
          <p className="definitions">
            Un taux permanent remplace l'ancien à sa date d'effet. Une offre temporaire passe devant
            le taux habituel, qui reprend seul à la fin de l'offre.
          </p>
          <SubmitButton confirm="Enregistrer ce taux ? Il s'appliquera aux prochaines commandes.">
            Enregistrer le taux
          </SubmitButton>
        </form>
      </section>

      {past.length ? (
        <details className="card">
          <summary>Historique ({past.length})</summary>
          <table>
            <thead>
              <tr>
                <th>Pour</th>
                <th className="num">Taux</th>
                <th>Du</th>
                <th>Au</th>
                <th>Motif</th>
              </tr>
            </thead>
            <tbody>
              {past.map((r) => (
                <tr key={r.id}>
                  <td>{target(r)}</td>
                  <td className="num">{formatRate(r.rateBps)}</td>
                  <td>{ruleDate(r.validFrom)}</td>
                  <td>{ruleDate(r.validTo)}</td>
                  <td>{r.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </>
  );
}
