import { DomainError } from '@zandu/domain';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/** Erreur destinée au client : statut HTTP + code stable + message lisible. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (what = 'Ressource'): HttpError =>
  new HttpError(404, 'not_found', `${what} introuvable`);
export const forbidden = (message = 'Accès refusé'): HttpError =>
  new HttpError(403, 'forbidden', message);

const DOMAIN_STATUS: Record<string, number> = {
  forbidden_actor: 403,
  invalid_transition: 409,
  deadline_not_reached: 409,
  dispute_window_closed: 409,
  payment_status_conflict: 409,
};

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof HttpError) {
    void reply
      .status(error.status)
      .send({ error: { code: error.code, message: error.message, details: error.details } });
    return;
  }
  if (error instanceof DomainError) {
    const status = DOMAIN_STATUS[error.code] ?? 422;
    void reply
      .status(status)
      .send({ error: { code: error.code, message: error.message, details: error.details } });
    return;
  }
  if (error instanceof ZodError) {
    void reply.status(400).send({
      error: {
        code: 'validation_error',
        message: 'Requête invalide',
        details: {
          issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      },
    });
    return;
  }
  const fastifyError = error as FastifyError;
  if (fastifyError.statusCode && fastifyError.statusCode < 500) {
    void reply
      .status(fastifyError.statusCode)
      .send({ error: { code: fastifyError.code ?? 'bad_request', message: error.message } });
    return;
  }
  request.log.error({ err: error }, 'Erreur non gérée');
  if (process.env.DEBUG_ERRORS) console.error(error); // utile en test, où le logger est coupé
  void reply
    .status(500)
    .send({ error: { code: 'internal_error', message: 'Erreur interne, réessayez plus tard' } });
}
