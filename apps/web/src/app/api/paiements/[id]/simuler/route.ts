import { API_URL } from '@/lib/api';

/** Développement seulement : l'acheteur « tape son PIN » (simulateur d'agrégateur de l'API). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.ZANDU_SIMULATOR !== '1') return new Response(null, { status: 404 });
  const { id } = await params;
  const res = await fetch(`${API_URL}/dev/simulator/collections/${id}/approve`, {
    method: 'POST',
  });
  return new Response(null, { status: res.ok ? 204 : res.status });
}
