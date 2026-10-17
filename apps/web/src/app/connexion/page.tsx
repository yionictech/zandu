import { ApiError, unwrap } from '@zandu/api-client';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { field, safePath, userClient, withParam } from '@/lib/api';
import { displayPhone } from '@/lib/format';
import { pendingChallenge, setChallenge, startSession } from '@/lib/session';
import { SubmitButton } from '@/components/SubmitButton';

export const metadata: Metadata = { title: 'Connexion', robots: { index: false } };

async function requestCode(form: FormData) {
  'use server';
  const suite = safePath(field(form, 'suite'));
  const phone = field(form, 'phone');
  try {
    const api = await userClient(null);
    const sent = unwrap(await api.POST('/v1/auth/otp/request', { body: { phone } }));
    await setChallenge({ id: sent.challengeId, phone });
  } catch (error) {
    const message = error instanceof ApiError ? error.message : 'Pas de connexion, réessayez.';
    redirect(withParam(`/connexion?suite=${encodeURIComponent(suite)}`, 'erreur', message));
  }
  redirect(`/connexion?suite=${encodeURIComponent(suite)}`);
}

async function verifyCode(form: FormData) {
  'use server';
  const suite = safePath(field(form, 'suite'));
  const challenge = await pendingChallenge();
  if (!challenge) redirect(`/connexion?suite=${encodeURIComponent(suite)}`);
  try {
    const api = await userClient(null);
    const session = unwrap(
      await api.POST('/v1/auth/otp/verify', {
        body: { challengeId: challenge.id, code: field(form, 'code'), deviceLabel: 'Site web' },
      }),
    );
    await startSession(session.token, session.expiresAt);
    await setChallenge(null);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    redirect(withParam(`/connexion?suite=${encodeURIComponent(suite)}`, 'erreur', error.message));
  }
  redirect(suite);
}

async function changeNumber(form: FormData) {
  'use server';
  await setChallenge(null);
  redirect(`/connexion?suite=${encodeURIComponent(safePath(field(form, 'suite')))}`);
}

/** Connexion par code SMS : pas de mot de passe, le numéro est l'identité (comme le Mobile Money). */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const suite = safePath(params.suite);
  const challenge = await pendingChallenge();
  return (
    <main style={{ maxWidth: 460 }}>
      <h1>Connexion</h1>
      <p className="muted">Recevez un code par SMS. Pas de mot de passe à retenir.</p>
      {params.erreur ? <p className="error">{params.erreur}</p> : null}
      {challenge ? (
        <>
          <form action={verifyCode} className="card stack">
            <input type="hidden" name="suite" value={suite} />
            <label>
              Code à 6 chiffres envoyé au {displayPhone(challenge.phone)}
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                autoFocus
                data-testid="login-code"
              />
            </label>
            <SubmitButton testId="login-verify">Valider</SubmitButton>
          </form>
          <form action={changeNumber}>
            <input type="hidden" name="suite" value={suite} />
            <button type="submit" className="button ghost block">
              Changer de numéro
            </button>
          </form>
        </>
      ) : (
        <form action={requestCode} className="card stack">
          <input type="hidden" name="suite" value={suite} />
          <label>
            Votre numéro de téléphone
            <input
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="06 612 34 56"
              required
              data-testid="login-phone"
            />
          </label>
          <SubmitButton testId="login-send">Recevoir le code</SubmitButton>
        </form>
      )}
    </main>
  );
}
