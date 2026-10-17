import { API_URL } from '@/lib/api';
import { pickMonth } from '@/lib/periods';
import { sessionToken } from '@/lib/session';

/**
 * Téléchargement du CSV des commandes du mois : relaie l'API avec le jeton de session, qui
 * reste côté serveur (cookie httpOnly). L'API vérifie le rôle et journalise l'export.
 */
export async function GET(request: Request): Promise<Response> {
  const token = await sessionToken();
  if (!token) return Response.redirect(new URL('/connexion', request.url), 303);
  const month = pickMonth(new URL(request.url).searchParams.get('mois') ?? undefined);
  const res = await fetch(
    `${API_URL}/v1/admin/reports/orders.csv?from=${month.from}&to=${month.to}`,
    { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' },
  );
  if (res.status === 401) return Response.redirect(new URL('/connexion', request.url), 303);
  if (!res.ok) return new Response('Export refusé', { status: res.status });
  return new Response(res.body, {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'text/csv; charset=utf-8',
      'content-disposition':
        res.headers.get('content-disposition') ?? 'attachment; filename="zandu-commandes.csv"',
      'cache-control': 'no-store',
    },
  });
}
