import { NextResponse, type NextRequest } from 'next/server';
import { safePath } from '@/lib/api';
import { CITIES, CITY_COOKIE } from '@/lib/city';

/**
 * Choix de la ville par un simple lien (`/ville?v=Brazzaville`) : aucun script, le choix est
 * gardé un an dans un cookie et la page d'origine (`suite`, sinon la page précédente du même
 * site) se recharge.
 */
export function GET(request: NextRequest) {
  const city = CITIES.find((c) => c === request.nextUrl.searchParams.get('v'));
  const back = safePath(request.nextUrl.searchParams.get('suite') ?? sameSitePath(request));
  const response = NextResponse.redirect(new URL(back, request.url), 303);
  if (city)
    response.cookies.set(CITY_COOKIE, city, {
      maxAge: 365 * 24 * 3600,
      path: '/',
      sameSite: 'lax',
    });
  return response;
}

function sameSitePath(request: NextRequest): string | null {
  try {
    const referer = new URL(request.headers.get('referer') ?? '');
    return referer.host === request.nextUrl.host ? referer.pathname + referer.search : null;
  } catch {
    return null;
  }
}
