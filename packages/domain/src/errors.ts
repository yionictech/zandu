/**
 * Erreur métier : une règle a été enfreinte. Le code est stable (utilisé par l'API et
 * les applications pour afficher le bon message) ; le message est destiné aux développeurs.
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
