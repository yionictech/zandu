import type { FastifyRequest } from 'fastify';
import type { Actor, AppContext } from '../../context.js';
import { HttpError } from '../../lib/errors.js';
import { authenticate, type AuthUser, type Role } from './auth.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: (AuthUser & { sessionId: string }) | null;
  }
}

/** preHandler : exige une session valide (en-tête Authorization: Bearer <jeton>). */
export function requireAuth(ctx: AppContext) {
  return async (request: FastifyRequest): Promise<void> => {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const user = token ? await authenticate(ctx, token) : null;
    if (!user) throw new HttpError(401, 'unauthenticated', 'Connexion requise');
    request.user = user;
  };
}

/** preHandler : exige au moins un des rôles (à placer après requireAuth). */
export function requireRole(...roles: Role[]) {
  return async (request: FastifyRequest): Promise<void> => {
    if (!request.user?.roles.some((r) => roles.includes(r))) {
      throw new HttpError(403, 'forbidden', 'Action réservée à un autre profil');
    }
  };
}

export function currentUser(request: FastifyRequest): AuthUser & { sessionId: string } {
  if (!request.user) throw new HttpError(401, 'unauthenticated', 'Connexion requise');
  return request.user;
}

/** L'acteur au sens du domaine : le rôle sous lequel l'utilisateur agit pour cette requête. */
export function actor(request: FastifyRequest, role: Exclude<Actor['role'], 'system'>): Actor {
  const user = currentUser(request);
  if (!user.roles.includes(role))
    throw new HttpError(403, 'forbidden', 'Action réservée à un autre profil');
  return { role, userId: user.id, ip: request.ip, userAgent: request.headers['user-agent'] ?? '' };
}

/** Pour les actions du support : agit comme « admin » si l'utilisateur l'est, sinon « support ». */
export function staffActor(request: FastifyRequest): Actor {
  return actor(request, currentUser(request).roles.includes('admin') ? 'admin' : 'support');
}
