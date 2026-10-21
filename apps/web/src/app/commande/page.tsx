import { ApiError, unwrap } from '@zandu/api-client';
import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { catalog, field, mine, userClient, withParam } from '@/lib/api';
import { displayPhone } from '@/lib/format';
import { DeliveryForm } from '@/components/DeliveryForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Livraison', robots: { index: false } };

const parseItems = (raw: string): Array<{ productId: string; quantity: number }> => {
  try {
    const items = JSON.parse(raw) as Array<{ productId: string; quantity: number }>;
    return Array.isArray(items)
      ? items
          .filter((i) => typeof i.productId === 'string' && Number.isInteger(i.quantity))
          .slice(0, 50)
      : [];
  } catch {
    return [];
  }
};

async function placeOrder(form: FormData) {
  'use server';
  const items = parseItems(field(form, 'items'));
  const mode = field(form, 'mode') === 'pickup_point' ? 'pickup_point' : 'home';
  const back = '/commande';
  let checkoutId: string;
  try {
    const api = await userClient();
    const checkout = unwrap(
      await api.POST('/v1/checkouts', {
        // Même clé tant que la page n'est pas rechargée : un double envoi ne crée pas deux commandes.
        params: { header: { 'Idempotency-Key': field(form, 'idempotencyKey') } },
        body: {
          items,
          delivery: {
            mode,
            zoneId: field(form, 'zoneId'),
            ...(mode === 'pickup_point' ? { pickupPointId: field(form, 'pickupPointId') } : {}),
            recipientName: field(form, 'recipientName'),
            phone: field(form, 'phone'),
            landmark: field(form, 'landmark'),
          },
        },
      }),
    );
    checkoutId = checkout.id;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect(`/connexion?suite=${back}`);
    const message = error instanceof ApiError ? error.message : 'Pas de connexion, réessayez.';
    redirect(withParam(back, 'erreur', message));
  }
  redirect(`/paiement/${checkoutId}?achetes=${items.map((i) => i.productId).join(',')}`);
}

/** Étape livraison : connexion exigée ici seulement (on a parcouru et choisi sans compte). */
export default async function OrderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const back = params.produits ? `/commande?produits=${params.produits}` : '/commande';
  const me = await mine(back, (api) => api.GET('/v1/me'));
  const zones = await catalog((api) => api.GET('/v1/delivery/zones'));
  return (
    <main style={{ maxWidth: 640 }}>
      <div className="page-title">
        <h1>Livraison</h1>
        <span className="pill-badge">Étape 1 / 2</span>
      </div>
      {params.erreur ? <p className="error">{params.erreur}</p> : null}
      <DeliveryForm
        zones={zones}
        defaultPhone={displayPhone(me.phone)}
        only={params.produits ? params.produits.split(',') : null}
        action={placeOrder}
        idempotencyKey={randomUUID()}
      />
    </main>
  );
}
