import { loadConfig } from './config.js';
import type { AppContext } from './context.js';
import { createPool } from './db/pool.js';
import { systemClock } from './lib/clock.js';
import {
  ConsoleNotificationSender,
  type NotificationSender,
} from './modules/notifications/sender.js';
import { ProviderRegistry, type PaymentProvider } from './modules/payments/provider.js';
import { SimulatorProvider } from './modules/payments/simulator.js';

/**
 * Assemble les dépendances réelles. Les adaptateurs de production (agrégateur choisi,
 * fournisseur WhatsApp/SMS) se branchent ici, derrière les mêmes interfaces.
 */
function createNotifier(env: string): NotificationSender {
  if (env !== 'production') return new ConsoleNotificationSender();
  // TODO(messagerie) : brancher l'adaptateur WhatsApp Business / passerelle SMS retenu.
  throw new Error('Aucun fournisseur SMS/WhatsApp configuré pour la production');
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
  };
}
