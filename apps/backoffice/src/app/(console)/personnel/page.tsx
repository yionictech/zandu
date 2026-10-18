import Link from 'next/link';
import { act, field, load } from '@/lib/api';
import { displayPhone, formatDateTime } from '@/lib/format';
import { STAFF_ROLE } from '@/lib/labels';
import { SubmitButton } from '@/components/SubmitButton';
import { Badge, Flash, PageHeader, readParams, type SearchParams } from '@/components/ui';

export const metadata = { title: 'Personnel' };

async function addMember(form: FormData) {
  'use server';
  const role = field(form, 'role') as 'support' | 'admin';
  await act('/personnel', 'Membre ajouté : il a reçu un SMS et peut se connecter', (api) =>
    api.POST('/v1/admin/staff', {
      body: { phone: field(form, 'phone'), fullName: field(form, 'fullName'), role },
    }),
  );
}

/**
 * Comptes du personnel (administrateurs) : qui a accès au back-office, avec quel rôle, et s'il
 * a configuré son second facteur. Chaque changement est journalisé et prévient la personne.
 */
export default async function StaffPage({ searchParams }: { searchParams: SearchParams }) {
  const { ok, erreur } = await readParams(searchParams);
  const [{ items }, me] = await Promise.all([
    load((api) => api.GET('/v1/admin/staff')),
    load((api) => api.GET('/v1/me')),
  ]);
  return (
    <>
      <PageHeader
        title="Personnel"
        subtitle="Accès au back-office : agents du support et administrateurs. Connexion par code SMS puis second facteur."
      />
      <Flash ok={ok} erreur={erreur} />

      <section className="card table-card">
        <h2>Membres ({items.length})</h2>
        <table data-testid="staff">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Téléphone</th>
              <th>Rôle</th>
              <th>Second facteur</th>
              <th>Dernière activité</th>
              <th className="num">Sessions ouvertes</th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id}>
                <td>
                  <Link href={`/personnel/${m.id}`}>{m.fullName ?? 'Sans nom'}</Link>
                  {m.id === me.id ? <span className="small muted"> (vous)</span> : null}
                </td>
                <td className="nowrap">{displayPhone(m.phone)}</td>
                <td>
                  <Badge tone={m.role === 'admin' ? 'brand' : 'neutral'}>
                    {STAFF_ROLE[m.role]}
                  </Badge>
                </td>
                <td>
                  {m.mfaEnrolled ? (
                    <Badge tone="trust">configuré</Badge>
                  ) : (
                    <Badge tone="waiting">à la 1re connexion</Badge>
                  )}
                </td>
                <td>{m.lastSeenAt ? formatDateTime(m.lastSeenAt) : 'jamais connecté'}</td>
                <td className="num">{m.activeSessions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Ajouter un membre</h2>
        <form action={addMember} className="stack" data-testid="add-staff">
          <div className="grid grid-2">
            <label>
              Nom complet
              <input name="fullName" required minLength={2} maxLength={120} />
            </label>
            <label>
              Numéro de téléphone
              <input name="phone" required inputMode="tel" placeholder="06 123 45 67" />
            </label>
            <label>
              Rôle
              <select name="role" defaultValue="support">
                <option value="support">{STAFF_ROLE.support} : files de travail, litiges</option>
                <option value="admin">
                  {STAFF_ROLE.admin} : en plus, rapports, taux, caisse, personnel
                </option>
              </select>
            </label>
          </div>
          <p className="definitions">
            La personne reçoit un SMS. À sa première connexion, elle configure son application
            d'authentification. Si ce numéro a déjà un compte d'acheteur ou de vendeur, il est
            conservé ; ses sessions ouvertes sont fermées.
          </p>
          <SubmitButton>Ajouter</SubmitButton>
        </form>
      </section>
    </>
  );
}
