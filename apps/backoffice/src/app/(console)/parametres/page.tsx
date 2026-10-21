import type { paths } from '@zandu/api-client';
import Link from 'next/link';
import { act, field, load } from '@/lib/api';
import { displayPhone, formatDateTime, formatXaf } from '@/lib/format';
import { STAFF_ROLE } from '@/lib/labels';
import { SubmitButton } from '@/components/SubmitButton';
import { Badge, Flash, readParams, type SearchParams } from '@/components/ui';

export const metadata = { title: 'Paramètres' };

function Row({ label, hint, value }: { label: string; hint?: string; value: string }) {
  return (
    <div className="panel-head" style={{ alignItems: 'center' }}>
      <div>
        <div>{label}</div>
        {hint ? <div className="small muted">{hint}</div> : null}
      </div>
      <span className="card" style={{ padding: '8px 14px', minWidth: 120, textAlign: 'right' }}>
        <strong>{value}</strong>
      </span>
    </div>
  );
}

const hours = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${h} h`);
const minutes = (m: number) => hours(m / 60);

type AcceptanceMinutes =
  paths['/v1/admin/settings']['patch']['requestBody']['content']['application/json']['sellerAcceptanceMinutes'];

async function saveAcceptance(form: FormData) {
  'use server';
  await act('/parametres', 'Délai d’acceptation enregistré', (api) =>
    api.PATCH('/v1/admin/settings', {
      body: {
        sellerAcceptanceMinutes: Number(field(form, 'minutes')) as AcceptanceMinutes,
        acceptanceOpenHoursOnly: form.get('openHours') === 'on',
        reason: field(form, 'reason'),
      },
    }),
  );
}
const range = (min: number, max: number) =>
  min === max ? formatXaf(min) : `${formatXaf(min)} – ${formatXaf(max)}`;

/**
 * Paramètres (maquette) : réglages en vigueur et équipe. Le délai d'acceptation du vendeur se
 * règle ici (docs/ux/03 §4.4) ; les autres délais viennent de la configuration du serveur, les
 * commissions de leur page.
 */
export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const { ok, erreur } = await readParams(searchParams);
  const [settings, staff] = await Promise.all([
    load((api) => api.GET('/v1/admin/settings')),
    load((api) => api.GET('/v1/admin/staff')),
  ]);
  const { money, delays } = settings;
  const acceptance = delays.sellerAcceptance;
  return (
    <>
      <header className="page-header">
        <div>
          <h1>Paramètres</h1>
          <div className="subtitle">
            Le délai d’acceptation se règle ici. Les autres délais viennent de la configuration du
            serveur ; les commissions se changent dans leur page.
          </div>
        </div>
        <Link className="button" href="/commissions">
          Modifier les commissions
        </Link>
      </header>
      <Flash ok={ok} erreur={erreur} />
      <section className="grid grid-2">
        <div className="card grid" data-testid="settings-money">
          <h2>Argent</h2>
          <Row
            label="Commission vendeur"
            hint="Taux par défaut ; des taux par catégorie ou par boutique peuvent s'appliquer"
            value={
              money.defaultCommissionBps === null
                ? '—'
                : `${(money.defaultCommissionBps / 100).toLocaleString('fr-FR')} %`
            }
          />
          {money.deliveryRates.map((r) => (
            <Row
              key={`${r.city}-${r.mode}`}
              label={`${r.mode === 'home' ? 'Livraison à domicile' : 'Point relais'} · ${r.city}`}
              value={range(r.min, r.max)}
            />
          ))}
          <Row
            label="Plafond de reversement d'un nouveau vendeur"
            hint="Au-delà, l'argent attend la suite de la rampe de confiance"
            value={formatXaf(money.newSellerPayoutCap)}
          />
        </div>
        <div className="card grid" data-testid="settings-delays">
          <h2>Délais</h2>
          <form action={saveAcceptance} className="stack" data-testid="settings-acceptance">
            <div className="panel-head" style={{ alignItems: 'center' }}>
              <div>
                <div>Acceptation par le vendeur</div>
                <div className="small muted">
                  Sinon la commande est annulée et remboursée. S’applique aux commandes payées
                  ensuite.
                </div>
              </div>
              <select
                name="minutes"
                defaultValue={acceptance.minutes}
                aria-label="Délai d’acceptation"
                style={{ minWidth: 120 }}
              >
                {acceptance.choices.map((m) => (
                  <option key={m} value={m}>
                    {minutes(m)}
                  </option>
                ))}
              </select>
            </div>
            <label className="check">
              <input type="checkbox" name="openHours" defaultChecked={acceptance.openHoursOnly} />
              Ne compter que les heures d’ouverture de la boutique (si elle les a renseignées jour
              par jour)
            </label>
            <div className="small muted">
              {acceptance.source === 'custom' && acceptance.updatedAt
                ? `Réglé le ${formatDateTime(acceptance.updatedAt)}${acceptance.updatedBy ? ` par ${displayPhone(acceptance.updatedBy)}` : ''}`
                : 'Valeur du serveur (SELLER_ACCEPT_HOURS). Recommandation : 2 h pour commencer.'}
            </div>
            <div className="inline">
              <input
                name="reason"
                required
                minLength={5}
                maxLength={300}
                placeholder="Motif (journal d’audit)"
                aria-label="Motif"
              />
              <SubmitButton variant="secondary">Enregistrer</SubmitButton>
            </div>
          </form>
          <Row
            label="Réclamation de l'acheteur"
            hint="Après la remise du colis ; ensuite, libération automatique au vendeur"
            value={hours(delays.disputeWindowHours)}
          />
          <Row
            label="Décision sur un litige"
            hint="Objectif du support"
            value={hours(delays.disputeSlaHours)}
          />
          <Row
            label="Relance par WhatsApp puis SMS"
            hint="Si la notification de l'application n'est pas ouverte"
            value={`${delays.pushFallbackMinutes} min`}
          />
        </div>
      </section>
      <section className="grid">
        <div className="page-header">
          <h2 style={{ margin: 0 }}>Équipe et accès</h2>
          <Link className="button secondary" href="/personnel">
            Inviter un membre
          </Link>
        </div>
        <div className="card table-card">
          <table>
            <thead>
              <tr>
                <th>Membre</th>
                <th>Rôle</th>
                <th>Peut faire</th>
                <th>Dernière connexion</th>
              </tr>
            </thead>
            <tbody>
              {staff.items.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link href={`/personnel/${m.id}`} style={{ color: 'var(--text)' }}>
                      <strong>{m.fullName ?? displayPhone(m.phone)}</strong>
                    </Link>
                  </td>
                  <td>
                    <Badge tone={m.role === 'admin' ? 'brand' : 'waiting'}>
                      {STAFF_ROLE[m.role]}
                    </Badge>
                  </td>
                  <td className="muted">
                    {m.role === 'admin'
                      ? 'Tout, y compris rapports, commissions et équipe'
                      : 'Commandes, litiges, vendeurs, clients, catalogue, paiements'}
                  </td>
                  <td className="muted">
                    {m.lastSeenAt ? formatDateTime(m.lastSeenAt) : 'Jamais'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
