import { redirect } from 'next/navigation';
import { load } from '@/lib/api';
import { DisputeList, DisputesHeader } from '@/components/DisputeList';
import { Flash, readParams, type SearchParams } from '@/components/ui';

export const metadata = { title: 'Litiges' };

/**
 * Litiges (F12) : le plus urgent s'ouvre directement à droite de la liste (maquette) ; le
 * reversement au vendeur reste gelé jusqu'à la décision. Objectif : sous 72 h.
 */
export default async function DisputesPage({ searchParams }: { searchParams: SearchParams }) {
  const { one, ok, erreur } = await readParams(searchParams);
  const resolved = one('vue') === 'resolus';
  const { items, counts } = await load((api) =>
    api.GET('/v1/support/disputes', {
      params: { query: { status: resolved ? 'resolved' : 'open' } },
    }),
  );
  if (items[0] && !ok && !erreur) {
    redirect(`/litiges/${items[0].id}${resolved ? '?vue=resolus' : ''}`);
  }
  return (
    <>
      <DisputesHeader open={counts.open} resolved={counts.resolved} showResolved={resolved} />
      <Flash ok={ok} erreur={erreur} />
      <div className="split left">
        <DisputeList status={resolved ? 'resolved' : 'open'} />
        <div className="card empty">
          {items.length ? 'Choisissez un litige.' : 'Rien à trancher pour le moment.'}
        </div>
      </div>
    </>
  );
}
