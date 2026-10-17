import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { act, field, load } from '@/lib/api';
import { SubmitButton } from '@/components/SubmitButton';
import { Flash, readParams, type SearchParams } from '@/components/ui';

export const metadata = { title: 'Second facteur' };

async function confirm(form: FormData) {
  'use server';
  await act('/connexion/configurer', 'Second facteur activé', (api) =>
    api.POST('/v1/auth/mfa/confirm', { body: { code: field(form, 'code') } }),
  );
}

/**
 * Première connexion du personnel : l'application d'authentification (Google Authenticator,
 * Microsoft Authenticator, Aegis…) scanne le QR code, puis donne un code toutes les 30 s.
 */
export default async function SetupPage({ searchParams }: { searchParams: SearchParams }) {
  const { ok, erreur } = await readParams(searchParams);
  if (ok) redirect('/');
  const status = await load((api) => api.GET('/v1/auth/mfa'));
  if (status.enrolled) redirect(status.verified ? '/' : '/connexion/code');
  const setup = await load((api) => api.POST('/v1/auth/mfa/setup'));
  const qr = await QRCode.toString(setup.otpauthUrl, { type: 'svg', margin: 1 });
  return (
    <main className="auth">
      <div className="card">
        <div>
          <h1>Protéger votre compte</h1>
          <p className="muted">
            Scannez ce QR code avec une application d'authentification sur votre téléphone (Google
            Authenticator, Microsoft Authenticator, Aegis…). Elle vous donnera un code à chaque
            connexion.
          </p>
        </div>
        <Flash erreur={erreur} />
        {/* SVG produit par la bibliothèque qrcode à partir de notre propre URL otpauth. */}
        <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} />
        <p className="small muted">
          Pas d'appareil photo ? Saisissez cette clé dans l'application :
        </p>
        <div className="secret" data-testid="totp-secret">
          {setup.secret.match(/.{1,4}/g)?.join(' ')}
        </div>
        <form action={confirm} className="stack">
          <label>
            Code affiché par l'application
            <input
              name="code"
              className="code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
            />
          </label>
          <SubmitButton>Activer et continuer</SubmitButton>
        </form>
      </div>
    </main>
  );
}
