import { loadConfig, type Config } from './config.js';
import type { AppContext } from './context.js';
import { createPool } from './db/pool.js';
import { systemClock } from './lib/clock.js';
import {
  DevNotificationSender,
  ExpoPushSender,
  RoutingNotificationSender,
  type NotificationSender,
} from './modules/notifications/sender.js';
import { ProviderRegistry, type PaymentProvider } from './modules/payments/provider.js';
import { SimulatorProvider } from './modules/payments/simulator.js';
import { S3Storage } from './modules/storage/s3-storage.js';
import { MemoryStorage, type ObjectStorage } from './modules/storage/storage.js';

/**
 * Assemble les dépendances réelles. Les adaptateurs de production (agrégateur choisi,
 * fournisseur WhatsApp/SMS) se branchent ici, derrière les mêmes interfaces.
 */
function createMessaging(env: Config['env']): NotificationSender {
  // Recette : pas encore de fournisseur, les SMS restent dans la boîte de réception protégée.
  if (env !== 'production') return new DevNotificationSender();
  // TODO(messagerie) : brancher l'adaptateur WhatsApp Business / passerelle SMS retenu.
  throw new Error('Aucun fournisseur SMS/WhatsApp configuré pour la production');
}

/**
 * Notifications sur le téléphone : service d'Expo dès PUSH_PROVIDER=expo (recette comprise,
 * pour les essayer sur de vrais téléphones) ; sinon elles sont seulement journalisées.
 */
function createNotifier(config: Config): NotificationSender {
  const messaging = createMessaging(config.env);
  const push =
    config.push.provider === 'expo'
      ? new ExpoPushSender(config.push.expoAccessToken)
      : new DevNotificationSender();
  return new RoutingNotificationSender(push, messaging);
}

export function createStorage(config: Config): ObjectStorage {
  if (config.storage.driver === 's3') return new S3Storage(config.storage);
  return new MemoryStorage(config.publicApiUrl, config.storage.dir);
}

export function createContext(): AppContext {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const providers: PaymentProvider[] = [];
  if (config.env !== 'production')
    providers.push(new SimulatorProvider(config.simulatorWebhookSecret, pool, systemClock));
  // TODO(agrégateur) : ajouter l'adaptateur retenu (ex. PawapayProvider) une fois le contrat signé.
  return {
    config,
    pool,
    clock: systemClock,
    providers: new ProviderRegistry(providers, config.paymentProvider),
    notifier: createNotifier(config),
    storage: createStorage(config),
  };
}
