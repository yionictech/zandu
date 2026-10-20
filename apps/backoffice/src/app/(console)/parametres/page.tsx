import Link from 'next/link';
import { load } from '@/lib/api';
import { displayPhone, formatDateTime, formatXaf } from '@/lib/format';
import { STAFF_ROLE } from '@/lib/labels';
import { Badge } from '@/components/ui';

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
const range = (min: number, max: number) =>
  min === max ? formatXaf(min) : `${formatXaf(min)} – ${formatXaf(max)}`;

/**
 * Paramètres (maquette) : réglages en vigueur et équipe. Ils se lisent ici ; ils se changent
 * aujourd'hui par la configuration du serveur (délais), les règles de commission et les tarifs
 * de livraison. Le réglage à l'écran viendra avec le délai d'acceptation (docs/ux/03 §4.4).
 */
export default async function SettingsPage() {
  const [settings, staff] = await Promise.all([
    load((api) => api.GET('/v1/admin/settings')),
    load((api) => api.GET('/v1/admin/staff')),
  ]);
  const { money, delays } = settings;
  return (
    <>
      <header className="page-header">
        <div>
          <h1>Paramètres</h1>
          <div className="subtitle">
            Réglages en vigueur, en lecture. Les délais se changent dans la configuration du serveur
            ; les commissions, dans leur page.
          </div>
        </div>
        <Link className="button" href="/commissions">
          Modifier les commissions
        </Link>
      </header>
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
          <Row
            label="Acceptation par le vendeur"
            hint="Sinon la commande est annulée et remboursée"
            value={hours(delays.sellerAcceptanceHours)}
          />
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
