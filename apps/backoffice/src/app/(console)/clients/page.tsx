import { Search } from 'lucide-react';
import Link from 'next/link';
import { act, field, load } from '@/lib/api';
import { displayPhone, formatDateTime, formatF, formatXaf } from '@/lib/format';
import { DISPUTE_REASON, ORDER_SHORT } from '@/lib/labels';
import { SubmitButton } from '@/components/SubmitButton';
import { Badge, Empty, Flash, readParams, type SearchParams } from '@/components/ui';

export const metadata = { title: 'Clients' };

const since = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric' });

/** « 05 ••• •• 77 » : le numéro sans le dévoiler entièrement dans la liste. */
function masked(e164: string): string {
  const d = displayPhone(e164);
  return `${d.slice(0, 2)} ••• •• ${d.slice(-2)}`;
}

const initials = (name: string | null) =>
  (name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

async function setStatus(id: string, back: string, form: FormData) {
  'use server';
  const status = field(form, 'status') as 'active' | 'suspended';
  await act(back, status === 'suspended' ? 'Compte bloqué' : 'Compte débloqué', (api) =>
    api.POST('/v1/support/customers/{id}/status', {
      params: { path: { id } },
      body: { status, reason: field(form, 'reason') },
    }),
  );
}

async function CustomerPanel({ id, back }: { id: string; back: string }) {
  const c = await load((api) =>
    api.GET('/v1/support/customers/{id}', { params: { path: { id } } }),
  );
  const lastDispute = c.recentOrders.find((o) => o.disputeId);
  const zone = c.addresses[0]?.zone;
  return (
    <aside className="card panel" data-testid="customer-panel">
      <div className="identity">
        <span className="avatar" style={{ color: 'var(--danger)' }}>
          {initials(c.name)}
        </span>
        <div>
          <h2 style={{ margin: 0 }}>{c.name ?? 'Client sans nom'}</h2>
          <div className="small muted">
            Client depuis {since.format(new Date(c.createdAt))}
            {zone ? ` · ${zone}` : ''} · {displayPhone(c.phone)}
          </div>
        </div>
      </div>
      <div className="stats">
        <div>
          <span className="small muted">Commandes</span>
          <strong>{c.orders}</strong>
        </div>
        <div>
          <span className="small muted">Payé</span>
          <strong>{formatF(c.paid)}</strong>
        </div>
        <div>
          <span className="small muted">Litiges</span>
          <strong style={{ color: c.disputes ? 'var(--danger)' : undefined }}>{c.disputes}</strong>
        </div>
      </div>
      <p className="eyebrow">Adresses enregistrées</p>
      {c.addresses.length ? (
        c.addresses.map((a) => (
          <div key={`${a.zone}-${a.landmark}`} className="small">
            {a.zone} · {a.landmark ?? '—'}
          </div>
        ))
      ) : (
        <div className="small muted">Aucune livraison à domicile.</div>
      )}
      <p className="eyebrow">Dernières commandes</p>
      {c.recentOrders.slice(0, 4).map((o) => {
        const [label, tone] = ORDER_SHORT[o.status];
        return (
          <div key={o.id} className="panel-head small">
            <Link href={`/commandes?id=${o.id}`} className="ref">
              {o.publicRef}
            </Link>
            <span className="muted">{formatDateTime(o.createdAt)}</span>
            <Badge tone={tone}>{label}</Badge>
          </div>
        );
      })}
      {lastDispute ? (
        <p className="small" style={{ margin: 0 }}>
          Litige sur {lastDispute.publicRef} (
          {lastDispute.disputeReason ? DISPUTE_REASON[lastDispute.disputeReason].toLowerCase() : ''}
          )
        </p>
      ) : null}
      <div className="chips">
        <a className="button secondary" href={`sms:${c.phone}`}>
          Envoyer un SMS
        </a>
        <a className="button secondary" href={`tel:${c.phone}`}>
          Appeler
        </a>
        {lastDispute ? (
          <Link className="button secondary" href={`/litiges/${lastDispute.disputeId}`}>
            Voir le litige
          </Link>
        ) : null}
      </div>
      <form action={setStatus.bind(null, c.id, back)} className="stack">
        <input
          type="hidden"
          name="status"
          value={c.status === 'suspended' ? 'active' : 'suspended'}
        />
        <label>
          Motif (journal d'audit)
          <input name="reason" minLength={5} maxLength={500} required />
        </label>
        <SubmitButton
          variant={c.status === 'suspended' ? 'secondary' : 'danger'}
          confirm={
            c.status === 'suspended'
              ? 'Débloquer ce compte ?'
              : 'Bloquer ce compte ? Ses sessions sont fermées tout de suite.'
          }
        >
          {c.status === 'suspended' ? 'Débloquer le compte' : 'Bloquer le compte'}
        </SubmitButton>
      </form>
    </aside>
  );
}

/** Clients (maquette) : recherche par nom ou numéro, fiche à droite. */
export default async function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  const { one, ok, erreur } = await readParams(searchParams);
  const q = one('q')?.trim() ?? '';
  const selected = one('id');
  const { items } = await load((api) =>
    api.GET('/v1/support/customers', { params: { query: q ? { q } : {} } }),
  );
  const link = (id: string) => `/clients?${new URLSearchParams({ ...(q ? { q } : {}), id })}`;
  return (
    <>
      <header className="page-header">
        <h1>Clients</h1>
        <form className="inline" role="search">
          <Search size={18} className="muted" aria-hidden />
          <input
            name="q"
            defaultValue={q}
            placeholder="Nom ou numéro de téléphone"
            aria-label="Nom ou téléphone"
            size={30}
          />
          <button type="submit" className="button">
            Chercher
          </button>
        </form>
      </header>
      <Flash ok={ok} erreur={erreur} />
      <div className={selected ? 'split' : ''}>
        {items.length === 0 ? (
          <Empty>Aucun client{q ? ` pour « ${q} »` : ''}.</Empty>
        ) : (
          <div className="card table-card">
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Téléphone</th>
                  <th>Ville</th>
                  <th className="num">Commandes</th>
                  <th className="num">Total payé</th>
                  <th className="num">Litiges</th>
                  <th>Compte</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className={c.id === selected ? 'selected' : ''}>
                    <td>
                      <Link
                        href={link(c.id)}
                        scroll={false}
                        data-testid={`customer-${c.phone}`}
                        style={{ color: 'var(--text)' }}
                      >
                        <strong>{c.name ?? 'Sans nom'}</strong>
                      </Link>
                    </td>
                    <td className="muted nowrap">{masked(c.phone)}</td>
                    <td className="muted">{c.city ?? '—'}</td>
                    <td className="num">{c.orders}</td>
                    <td className="num">
                      <strong>{formatXaf(c.paid)}</strong>
                    </td>
                    <td className="num" style={{ color: c.disputes ? 'var(--danger)' : undefined }}>
                      {c.disputes}
                    </td>
                    <td>
                      {c.status === 'active' ? (
                        <Badge>Actif</Badge>
                      ) : (
                        <Badge tone="danger">Bloqué</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {selected ? <CustomerPanel id={selected} back={link(selected)} /> : null}
      </div>
    </>
  );
}
