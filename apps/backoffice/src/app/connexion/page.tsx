import { ApiError, unwrap } from '@zandu/api-client';
import { redirect } from 'next/navigation';
import { apiClient, field, withParam } from '@/lib/api';
import { displayPhone } from '@/lib/format';
import { endSession, pendingChallenge, setChallenge, startSession } from '@/lib/session';
import { SubmitButton } from '@/components/SubmitButton';
import { Flash, readParams, type SearchParams } from '@/components/ui';

export const metadata = { title: 'Connexion' };

const STAFF = ['support', 'admin'];

async function requestCode(form: FormData) {
  'use server';
  const phone = field(form, 'phone');
  try {
    const api = await apiClient(null);
    const sent = unwrap(await api.POST('/v1/auth/otp/request', { body: { phone } }));
    await setChallenge({ id: sent.challengeId, phone });
  } catch (error) {
    redirect(
      withParam(
        '/connexion',
        'erreur',
        error instanceof ApiError ? error.message : 'API injoignable',
      ),
    );
  }
  redirect('/connexion');
}

async function verifyCode(form: FormData) {
  'use server';
  const challenge = await pendingChallenge();
  if (!challenge) redirect('/connexion');
  let next = '/';
  try {
    const anonymous = await apiClient(null);
    const session = unwrap(
      await anonymous.POST('/v1/auth/otp/verify', {
        body: { challengeId: challenge.id, code: field(form, 'code'), deviceLabel: 'Back-office' },
      }),
    );
    const api = await apiClient(session.token);
    if (!session.user.roles.some((role) => STAFF.includes(role))) {
      await api.POST('/v1/auth/logout');
      await setChallenge(null);
      redirect(withParam('/connexion', 'erreur', "Ce compte n'a pas accès au back-office."));
    }
    await startSession(session.token, session.expiresAt);
    await setChallenge(null);
    const mfa = unwrap(await api.GET('/v1/auth/mfa'));
    if (mfa.required) next = mfa.enrolled ? '/connexion/code' : '/connexion/configurer';
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    redirect(withParam('/connexion', 'erreur', error.message));
  }
  redirect(next);
}

async function restart() {
  'use server';
  await setChallenge(null);
  await endSession();
  redirect('/connexion');
}

/** Connexion du personnel : code SMS, puis code de l'application d'authentification. */
export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const { one, erreur } = await readParams(searchParams);
  const challenge = await pendingChallenge();
  return (
    <main className="auth">
      <div className="card">
        <div>
          <h1>Back-office Zandu</h1>
          <p className="muted">Réservé au support et à l'administration.</p>
        </div>
        {one('expiree') ? <Flash erreur="Session terminée : reconnectez-vous." /> : null}
        <Flash erreur={erreur} />
        {challenge ? (
          <>
            <form action={verifyCode} className="stack">
              <label>
                Code reçu par SMS au {displayPhone(challenge.phone)}
                <input
                  name="code"
                  className="code-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  autoFocus
                />
              </label>
              <SubmitButton>Valider</SubmitButton>
            </form>
            <form action={restart}>
              <button type="submit" className="button secondary">
                Changer de numéro
              </button>
            </form>
          </>
        ) : (
          <form action={requestCode} className="stack">
            <label>
              Numéro de téléphone
              <input
                name="phone"
                type="tel"
                placeholder="06 612 34 56"
                autoComplete="tel"
                required
                autoFocus
              />
            </label>
            <SubmitButton>Recevoir le code par SMS</SubmitButton>
          </form>
        )}
      </div>
    </main>
  );
}
