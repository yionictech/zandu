import { act, field, load } from '@/lib/api';
import { displayPhone, formatDateTime } from '@/lib/format';
import { ORDER_STATUS } from '@/lib/labels';
import { SubmitButton } from '@/components/SubmitButton';
import { Badge, Empty, Flash, PageHeader, readParams, type SearchParams } from '@/components/ui';

export const metadata = { title: 'Livreurs' };

async function assign(form: FormData) {
  'use server';
  const orderId = field(form, 'orderId');
  await act('/livraisons', `Livreur assigné à ${field(form, 'ref')}`, (api) =>
    api.POST('/v1/support/deliveries/{id}/assign', {
      params: { path: { id: orderId } },
      body: { riderId: field(form, 'riderId') },
    }),
  );
}

/** Livraisons à assigner (D15) : colis prêts d'abord ; livreurs les moins chargés en tête. */
export default async function DeliveriesPage({ searchParams }: { searchParams: SearchParams }) {
  const { ok, erreur } = await readParams(searchParams);
  const [deliveries, riders] = await Promise.all([
    load((api) => api.GET('/v1/support/deliveries')),
    load((api) => api.GET('/v1/support/riders')),
  ]);
  return (
    <>
      <PageHeader
        title="Livreurs"
        subtitle="Le livreur reçoit la mission dans son application ; le client garde son code de remise. Inscription et activation des livreurs : avec le modèle livreur (docs/ux/03 §4.1)."
      />
      <Flash ok={ok} erreur={erreur} />
      <section className="grid grid-4">
        <div className="card kpi">
          <span className="label dot" style={{ ['--dot' as string]: 'var(--brand)' }}>
            Livreurs actifs
          </span>
          <span className="value">{riders.items.length}</span>
          <span className="note">
            dont {riders.items.filter((r) => r.activeMissions > 0).length} en course
          </span>
        </div>
        <div className="card kpi">
          <span className="label dot" style={{ ['--dot' as string]: 'var(--danger)' }}>
            À assigner
          </span>
          <span className="value">{deliveries.items.length}</span>
          <span className="note">
            dont {deliveries.items.filter((d) => d.orderStatus === 'ready_for_pickup').length} colis
            prêts
          </span>
        </div>
      </section>
      <h2 style={{ margin: 0 }}>Livraisons à assigner</h2>
      {deliveries.items.length === 0 ? (
        <Empty>Aucun colis en attente de livreur.</Empty>
      ) : (
        <div className="card table-card">
          <table>
            <thead>
              <tr>
                <th>Commande</th>
                <th>État</th>
                <th>Enlèvement</th>
                <th>Destination</th>
                <th className="num">Articles</th>
                <th>Payée</th>
                <th>Livreur</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.items.map((d) => {
                const [label, tone] = ORDER_STATUS[d.orderStatus];
                return (
                  <tr key={d.orderId} data-testid={`delivery-${d.publicRef}`}>
                    <td className="ref">{d.publicRef}</td>
                    <td>
                      <Badge tone={tone}>{label}</Badge>
                    </td>
                    <td>
                      {d.shopName}
                      <div className="small muted">{d.pickupZone}</div>
                    </td>
                    <td>
                      {d.pickupPoint ? `Relais ${d.pickupPoint}` : d.destinationZone}
                      <div className="small muted">{d.city}</div>
                    </td>
                    <td className="num">{d.itemCount}</td>
                    <td>{formatDateTime(d.paidAt)}</td>
                    <td>
                      <form action={assign} className="inline">
                        <input type="hidden" name="orderId" value={d.orderId} />
                        <input type="hidden" name="ref" value={d.publicRef} />
                        <select
                          name="riderId"
                          required
                          defaultValue={riders.items[0]?.id ?? ''}
                          aria-label="Livreur"
                        >
                          {riders.items.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name ?? displayPhone(r.phone)} · {r.activeMissions} en cours
                            </option>
                          ))}
                        </select>
                        <SubmitButton>Assigner</SubmitButton>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <section className="card">
        <h2>Livreurs actifs ({riders.items.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Livreur</th>
              <th>Téléphone</th>
              <th>Partenaire</th>
              <th>Zone</th>
              <th className="num">Missions en cours</th>
            </tr>
          </thead>
          <tbody>
            {riders.items.map((r) => (
              <tr key={r.id}>
                <td>{r.name ?? '—'}</td>
                <td>{displayPhone(r.phone)}</td>
                <td>{r.partner}</td>
                <td>{r.zone ?? 'Toutes'}</td>
                <td className="num">{r.activeMissions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
