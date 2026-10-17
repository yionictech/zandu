'use client';

import { useFormStatus } from 'react-dom';

/** Bouton d'envoi désactivé pendant l'envoi : une décision n'est jamais envoyée deux fois. */
export function SubmitButton({
  children,
  variant,
  confirm,
}: {
  children: React.ReactNode;
  variant?: 'trust' | 'danger' | 'secondary';
  /** Question de confirmation avant les décisions irréversibles. */
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`button ${variant ?? ''}`}
      disabled={pending}
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      {pending ? 'Envoi…' : children}
    </button>
  );
}
