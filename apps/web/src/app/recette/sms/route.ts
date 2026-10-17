import { createHash, timingSafeEqual } from 'node:crypto';
import { parseCongoMobile } from '@zandu/domain';
import { API_URL, RECETTE } from '@/lib/api';

/**
 * Recette uniquement (ADR-0013) : les SMS ne partent pas encore vers les téléphones. Le testeur
 * ouvre cette page, saisit son numéro et lit le code reçu. Protégée par la clé de recette
 * (mot de passe demandé par le navigateur), qui n'est jamais envoyée au navigateur.
 */
export const dynamic = 'force-dynamic';

const KEY = process.env.ZANDU_RECETTE_KEY ?? '';
const digest = (value: string) => createHash('sha256').update(value).digest();

const LABELS: Record<string, string> = {
  otp_code: 'Code de connexion',
  buyer_handover_code: 'Code de remise au livreur',
};

interface Message {
  template: string;
  variables: Record<string, string>;
  sentAt: string;
}

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

function authorized(request: Request): boolean {
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const password = decoded.slice(decoded.indexOf(':') + 1);
  return timingSafeEqual(digest(password), digest(KEY));
}

function page(phone: string, body: string): Response {
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>SMS de test · Zandu recette</title><style>
body{font:16px/1.4 system-ui,sans-serif;margin:0;background:#f8fafc;color:#0f172a}
main{max-width:480px;margin:0 auto;padding:16px}h1{font-size:20px;margin:8px 0}
p.note{color:#475569;font-size:14px}form{display:flex;gap:8px;margin:16px 0}
input{flex:1;font-size:18px;padding:10px;border:1px solid #cbd5e1;border-radius:8px}
button{font-size:16px;padding:10px 14px;border:0;border-radius:8px;background:#c2410c;color:#fff}
li{list-style:none;background:#fff;border-radius:10px;padding:12px;margin:8px 0;box-shadow:0 1px 2px #0002}
ul{padding:0}.code{font-size:30px;font-weight:700;letter-spacing:4px}.meta{color:#64748b;font-size:13px}
.error{color:#b91c1c}</style></head><body><main>
<h1>SMS de test</h1>
<p class="note">Recette Zandu : les SMS ne partent pas encore vers les téléphones. Saisissez votre numéro pour lire le dernier code reçu, puis revenez dans l’application.</p>
<form method="get"><input name="numero" type="tel" inputmode="tel" placeholder="06 123 45 67" value="${escape(phone)}" aria-label="Numéro de téléphone" autofocus><button>Voir</button></form>
${body}</main></body></html>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  if (!RECETTE || KEY.length < 24) return new Response(null, { status: 404 });
  if (!authorized(request)) {
    return new Response('Mot de passe de recette requis', {
      status: 401,
      headers: { 'www-authenticate': 'Basic realm="Zandu recette", charset="UTF-8"' },
    });
  }
  const phone = new URL(request.url).searchParams.get('numero')?.trim() ?? '';
  if (!phone) return page('', '');
  let e164: string;
  try {
    e164 = parseCongoMobile(phone).e164;
  } catch {
    return page(phone, '<p class="error">Numéro congolais invalide (04, 05 ou 06).</p>');
  }
  const res = await fetch(`${API_URL}/dev/messages?recipient=${encodeURIComponent(e164)}`, {
    headers: { 'x-recette-key': KEY },
    cache: 'no-store',
  });
  if (!res.ok) return page(phone, `<p class="error">Boîte de réception indisponible.</p>`);
  const { items } = (await res.json()) as { items: Message[] };
  if (!items.length) return page(phone, '<p>Aucun message pour ce numéro.</p>');
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString('fr-FR', { timeZone: 'Africa/Brazzaville' });
  const list = items
    .slice(0, 10)
    .map((m) => {
      const code = m.variables.code;
      const label = LABELS[m.template] ?? m.template;
      return `<li>${code ? `<div class="code">${escape(code)}</div>` : ''}
<div>${escape(label)}${m.variables.ref ? ` · ${escape(m.variables.ref)}` : ''}</div>
<div class="meta">reçu à ${time(m.sentAt)}</div></li>`;
    })
    .join('');
  return page(phone, `<ul>${list}</ul>`);
}
