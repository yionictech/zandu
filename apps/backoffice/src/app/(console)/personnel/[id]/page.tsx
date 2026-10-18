import Link from 'next/link';
import { act, field, load } from '@/lib/api';
import { displayPhone, formatDateTime } from '@/lib/format';
import { STAFF_ROLE, auditAction, auditEntity } from '@/lib/labels';
import { SubmitButton } from '@/components/SubmitButton';
import { Badge, Flash, PageHeader, readParams, type SearchParams } from '@/components/ui';

export const metadata = { title: 'Membre du personnel' };

async function changeRole(id: string, form: FormData) {
  'use server';
  const role = field(form, 'role') as 'support' | 'admin';
  await act(`/personnel/${id}`, 'Rôle changé : la personne doit se reconnecter', (api) =>
    api.POST('/v1/admin/staff/{id}/role', { params: { path: { id } }, body: { role } }),
  );
}

async function signOut(id: string) {
  'use server';
  await act(`/personnel/${id}`, 'Toutes ses sessions sont fermées', (api) =>
    api.POST('/v1/admin/staff/{id}/sign-out', { params: { path: { id } } }),
  );
}

async function resetMfa(id: string) {
  'use server';
  await act(
    `/personnel/${id}`,
    'Second facteur réinitialisé : il sera reconfiguré à la prochaine connexion',
    (api) => api.POST('/v1/admin/users/{id}/mfa/reset', { params: { path: { id } } }),
  );
}

async function revoke(id: string, form: FormData) {
  'use server';
  await act('/personnel', 'Accès retiré', (api) =>
    api.POST('/v1/admin/staff/{id}/revoke', {
      params: { path: { id } },
      body: { reason: field(form, 'reason') },
    }),
  );
}

/** Un membre du personnel : rôle, sécurité de son accès, et ce qu'il a fait récemment. */
export default async function StaffMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { ok, erreur } = await readParams(searchParams);
  const [m, me] = await Promise.all([
    load((api) => api.GET('/v1/admin/staff/{id}', { params: { path: { id } } })),
    load((api) => api.GET('/v1/me')),
  ]);
  const self = m.id === me.id;
  const other = m.role === 'admin' ? 'support' : 'admin';
  return (
    <>
      <PageHeader
        title={m.fullName ?? 'Sans nom'}
        subtitle={
          <>
            {displayPhone(m.phone)} ·{' '}
            <Badge tone={m.role === 'admin' ? 'brand' : 'neutral'}>{STAFF_ROLE[m.role]}</Badge>
            {self ? ' · vous' : ''}
          </>
        }
      />
      <Flash ok={ok} erreur={erreur} />
      <p>
        <Link href="/personnel">← Tout le personnel</Link>
      </p>

      <section className="grid grid-2">
        <div className="card">
          <h2>Accès</h2>
          <dl className="kv">
            <dt>Second facteur</dt>
            <dd>{m.mfaEnrolled ? 'configuré' : 'à configurer à la prochaine connexion'}</dd>
            <dt>Dernière activité</dt>
            <dd>{m.lastSeenAt ? formatDateTime(m.lastSeenAt) : 'jamais connecté'}</dd>
            <dt>Sessions ouvertes</dt>
            <dd>{m.activeSessions}</dd>
            <dt>Membre depuis</dt>
            <dd>{formatDateTime(m.createdAt)}</dd>
          </dl>
          <div className="actions">
            <form action={signOut.bind(null, m.id)}>
              <SubmitButton variant="secondary" confirm="Fermer toutes ses sessions ?">
                Déconnecter partout
              </SubmitButton>
            </form>
            {m.mfaEnrolled ? (
              <form action={resetMfa.bind(null, m.id)}>
                <SubmitButton
                  variant="secondary"
                  confirm="Téléphone perdu ? Son second facteur sera effacé et reconfiguré à la prochaine connexion."
                >
                  Réinitialiser le second facteur
                </SubmitButton>
              </form>
            ) : null}
          </div>
        </div>

        <div className="card">
          <h2>Rôle et retrait</h2>
          {self ? (
            <p className="muted">
              Vous ne pouvez pas modifier votre propre accès : demandez à un autre administrateur.
              Zandu garde toujours au moins un administrateur.
            </p>
          ) : (
            <div className="stack-blocks">
              <form action={changeRole.bind(null, m.id)} className="inline">
                <input type="hidden" name="role" value={other} />
                <SubmitButton
                  variant="secondary"
                  confirm={`Passer ${m.fullName ?? 'ce membre'} en ${STAFF_ROLE[other].toLowerCase()} ?`}
                >
                  {other === 'admin' ? 'Nommer administrateur' : 'Repasser agent du support'}
                </SubmitButton>
              </form>
              <form action={revoke.bind(null, m.id)} className="stack" data-testid="revoke">
                <label>
                  Motif du retrait (journal d'audit)
                  <input
                    name="reason"
                    required
                    minLength={3}
                    maxLength={300}
                    placeholder="Ex. Fin de contrat, téléphone volé"
                  />
                </label>
                <SubmitButton
                  variant="danger"
                  confirm="Retirer son accès au back-office ? Ses sessions seront fermées tout de suite."
                >
                  Retirer l'accès
                </SubmitButton>
              </form>
            </div>
          )}
          <p className="definitions">
            Chaque changement ferme ses sessions et lui envoie un SMS. Son éventuel compte
            d'acheteur ou de vendeur est conservé.
          </p>
        </div>
      </section>

      <section className="card table-card">
        <h2>Dernières actions</h2>
        {m.recentActions.length ? (
          <table data-testid="recent-actions">
            <thead>
              <tr>
                <th>Quand</th>
                <th>Action</th>
                <th>Sur</th>
              </tr>
            </thead>
            <tbody>
              {m.recentActions.map((a, i) => (
                <tr key={i}>
                  <td className="nowrap">{formatDateTime(a.at)}</td>
                  <td>{auditAction(a.action)}</td>
                  <td className="small muted">
                    {a.entityType === 'order' ? (
                      <Link href={`/commandes/${a.entityId}`}>commande</Link>
                    ) : (
                      auditEntity(a.entityType)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="definitions">Aucune action enregistrée pour l'instant.</p>
        )}
      </section>
    </>
  );
}
