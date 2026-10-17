import type { Config } from './config.js';
import type { Pool } from './db/pool.js';
import type { Clock } from './lib/clock.js';
import type { NotificationSender } from './modules/notifications/sender.js';
import type { ProviderRegistry } from './modules/payments/provider.js';
import type { ObjectStorage } from './modules/storage/storage.js';

/** Dépendances partagées par les modules : injectées, donc remplaçables en test. */
export interface AppContext {
  config: Config;
  pool: Pool;
  clock: Clock;
  providers: ProviderRegistry;
  notifier: NotificationSender;
  storage: ObjectStorage;
}

/** Qui agit : un utilisateur authentifié avec un rôle, ou le système (tâches de fond, webhooks). */
export interface Actor {
  role: 'buyer' | 'seller' | 'rider' | 'support' | 'admin' | 'system';
  userId: string | null;
  ip?: string;
  userAgent?: string;
}

export const SYSTEM: Actor = { role: 'system', userId: null };
