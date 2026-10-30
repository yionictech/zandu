import { ApiError, unwrap } from '@zandu/api-client';
import { ShieldAlert } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { field, loginUrl, userClient, withParam } from '@/lib/api';
import { endSession, sessionToken } from '@/lib/session';
import { SubmitButton } from '@/components/SubmitButton';

export const metadata: Metadata = {
  title: 'Supprimer mon compte',
  description: 'Supprimer son compte Zandu et ses données personnelles.',
};

const PAGE = '/supprimer-mon-compte';
const UUID = /^[0-9a-f-]{36}$/i;

async function askCode() {
  'use server';
  let challengeId: string;
  try {
    const api = await userClient();
    challengeId = unwrap(await api.POST('/v1/me/deletion')).challengeId;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect(loginUrl(PAGE));
    const message = error instanceof ApiError ? error.message : 'Pas de connexion, réessayez.';
    redirect(withParam(PAGE, 'erreur', message));
  }
  redirect(withParam(PAGE, 'demande', challengeId));
}

async function confirmDeletion(form: FormData) {
  'use server';
  const challengeId = field(form, 'demande');
  try {
    const api = await userClient();
    unwrap(
      await api.POST('/v1/me/deletion/confirm', {
        body: { challengeId, code: field(form, 'code') },
      }),
    );
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    redirect(withParam(withParam(PAGE, 'demande', challengeId), 'erreur', error.message));
  }
  await endSession();
  redirect(withParam(PAGE, 'fait', '1'));
}

/**
 * Suppression du compte depuis le site (Google Play exige une adresse web, l'application a le même
 * écran dans Compte). Lisible sans être connecté : ce qui est effacé, ce qui est gardé, comment faire.
 */
export default async function DeleteAccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const token = await sessionToken();
  let status: { possible: boolean; blockers: Array<{ code: string; message: string }> } | null =
    null;
  if (token && !params.fait) {
    try {
      status = unwrap(await (await userClient(token)).GET('/v1/me/deletion'));
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    }
  }
  const challengeId = params.demande && UUID.test(params.demande) ? params.demande : null;

  return (
    <main style={{ maxWidth: 620 }}>
      <span className="app-icon">
        <ShieldAlert className="icon" aria-hidden />
      </span>
      <h1>Supprimer mon compte Zandu</h1>
      {params.fait ? (
        <p className="card" data-testid="deletion-done">
          Votre compte est supprimé. Vous pouvez ouvrir un nouveau compte avec le même numéro quand
          vous le voulez.
        </p>
      ) : null}
      <section className="card stack">
        <p>
          <strong>Ce qui est effacé :</strong> votre nom, votre numéro de téléphone, vos adresses de
          livraison, vos appareils et vos connexions. Votre boutique est fermée et ses produits
          retirés de la vente.
        </p>
        <p>
          <strong>Ce qui est gardé, sans votre nom :</strong> le montant et la date de vos commandes
          et des reversements, que la loi nous oblige à conserver (comptabilité, 10 ans).
        </p>
        <p>
          <strong>Comment faire :</strong> dans l’application, onglet Compte › Supprimer mon compte,
          ou sur cette page après connexion. Un code SMS confirme la demande ; la suppression est
          immédiate et définitive.
        </p>
        <p className="muted small">
          Impossible tant qu’une commande est en cours ou qu’un reversement vous est dû : le support
          règle d’abord la situation. Livreurs et personnel : le compte est fermé par le support.
        </p>
      </section>

      {params.fait ? null : !status ? (
        <a className="button block" href={loginUrl(PAGE)} data-testid="deletion-login">
          Me connecter pour supprimer mon compte
        </a>
      ) : status.blockers.length ? (
        <section className="card stack" data-testid="deletion-blocked">
          <strong>Pas encore possible :</strong>
          {status.blockers.map((b) => (
            <p key={b.code} style={{ margin: 0 }}>
              • {b.message}
            </p>
          ))}
        </section>
      ) : (
        <>
          {params.erreur ? <p className="error">{params.erreur}</p> : null}
          {challengeId ? (
            <form action={confirmDeletion} className="stack">
              <input type="hidden" name="demande" value={challengeId} />
              <label>
                Code reçu par SMS
                <input
                  name="code"
                  className="code-boxes"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  autoFocus
                  data-testid="deletion-code"
                />
              </label>
              <SubmitButton testId="deletion-confirm">Supprimer définitivement</SubmitButton>
            </form>
          ) : (
            <form action={askCode}>
              <SubmitButton testId="deletion-ask">Recevoir le code de confirmation</SubmitButton>
            </form>
          )}
        </>
      )}
    </main>
  );
}
