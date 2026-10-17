import { ApiError, unwrap } from '@zandu/api-client';
import { redirect } from 'next/navigation';
import { apiClient, field, load, withParam } from '@/lib/api';
import { endSession } from '@/lib/session';
import { SubmitButton } from '@/components/SubmitButton';
import { Flash, readParams, type SearchParams } from '@/components/ui';

export const metadata = { title: 'Code de sécurité' };

async function verify(form: FormData) {
  'use server';
  try {
    const api = await apiClient();
    unwrap(await api.POST('/v1/auth/mfa/verify', { body: { code: field(form, 'code') } }));
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    // 5 codes erronés : l'API a révoqué la session, on repart de la connexion par SMS.
    if (error.status === 401 && error.code !== 'mfa_invalid') {
      await endSession();
      redirect(withParam('/connexion', 'erreur', error.message));
    }
    redirect(withParam('/connexion/code', 'erreur', error.message));
  }
  redirect('/');
}

export default async function CodePage({ searchParams }: { searchParams: SearchParams }) {
  const { erreur } = await readParams(searchParams);
  const status = await load((api) => api.GET('/v1/auth/mfa'));
  if (!status.enrolled) redirect('/connexion/configurer');
  if (status.verified) redirect('/');
  return (
    <main className="auth">
      <div className="card">
        <div>
          <h1>Code de sécurité</h1>
          <p className="muted">
            Ouvrez votre application d'authentification et saisissez le code Zandu.
          </p>
        </div>
        <Flash erreur={erreur} />
        <form action={verify} className="stack">
          <label>
            Code à 6 chiffres
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
          <SubmitButton>Continuer</SubmitButton>
        </form>
        <p className="small muted">
          Téléphone perdu ? Un administrateur peut réinitialiser votre second facteur.
        </p>
      </div>
    </main>
  );
}
