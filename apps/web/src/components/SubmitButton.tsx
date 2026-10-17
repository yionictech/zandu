'use client';

import { useFormStatus } from 'react-dom';

/** Bouton d'envoi désactivé pendant l'envoi : pas de double commande ni de double paiement. */
export function SubmitButton({
  children,
  variant,
  confirm,
  testId,
}: {
  children: React.ReactNode;
  variant?: 'trust' | 'secondary' | 'ghost';
  confirm?: string;
  testId?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`button block ${variant ?? ''}`}
      disabled={pending}
      data-testid={testId}
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      {pending ? 'Un instant…' : children}
    </button>
  );
}
