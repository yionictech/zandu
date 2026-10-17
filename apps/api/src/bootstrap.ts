import { loadConfig, type Config } from './config.js';
import type { AppContext } from './context.js';
import { createPool } from './db/pool.js';
import { systemClock } from './lib/clock.js';
import { DevNotificationSender, type NotificationSender } from './modules/notifications/sender.js';
import { ProviderRegistry, type PaymentProvider } from './modules/payments/provider.js';
import { SimulatorProvider } from './modules/payments/simulator.js';
import { S3Storage } from './modules/storage/s3-storage.js';
import { MemoryStorage, type ObjectStorage } from './modules/storage/storage.js';

/**
 * Assemble les dépendances réelles. Les adaptateurs de production (agrégateur choisi,
 * fournisseur WhatsApp/SMS) se branchent ici, derrière les mêmes interfaces.
 */
function createNotifier(env: string): NotificationSender {
  if (env !== 'production') return new DevNotificationSender();
  // TODO(messagerie) : brancher l'adaptateur WhatsApp Business / passerelle SMS retenu.
  throw new Error('Aucun fournisseur SMS/WhatsApp configuré pour la production');
}

function createStorage(config: Config): ObjectStorage {
  if (config.storage.driver === 's3') return new S3Storage(config.storage);
  return new MemoryStorage(config.publicApiUrl, config.storage.dir);
}

export function createContext(): AppContext {
  const config = loadConfig();
  const providers: PaymentProvider[] = [];
  if (config.env !== 'production')
    providers.push(new SimulatorProvider(config.simulatorWebhookSecret));
  // TODO(agrégateur) : ajouter l'adaptateur retenu (ex. PawapayProvider) une fois le contrat signé.
  return {
    config,
    pool: createPool(config.databaseUrl),
    clock: systemClock,
    providers: new ProviderRegistry(providers, config.paymentProvider),
    notifier: createNotifier(config.env),
    storage: createStorage(config),
  };
}
