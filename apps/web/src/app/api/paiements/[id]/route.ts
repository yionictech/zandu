import { NextResponse } from 'next/server';
import { userClient } from '@/lib/api';

/** Relais léger pour l'écran d'attente : le jeton reste sur le serveur. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const api = await userClient();
  const { data, response } = await api.GET('/v1/payments/{id}', { params: { path: { id } } });
  if (!data) return NextResponse.json({ error: 'indisponible' }, { status: response.status });
  return NextResponse.json(
    { status: data.status, failure: data.failure },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
