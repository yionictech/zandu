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
import {
  CopySender,
  InfobipSmsSender,
  MessagingSender,
  WhatsAppCloudSender,
} from './modules/notifications/messaging.js';
import { PawapayProvider } from './modules/payments/pawapay.js';
import { SimulatorProvider } from './modules/payments/simulator.js';
import { S3Storage } from './modules/storage/s3-storage.js';
import { MemoryStorage, type ObjectStorage } from './modules/storage/storage.js';

/**
 * Assemble les dépendances réelles. Les adaptateurs de production (agrégateur choisi,
 * fournisseur WhatsApp/SMS) se branchent ici, derrière les mêmes interfaces.
 */
/**
 * SMS et WhatsApp (D16). Sans fournisseur : boîte de réception de développement (recette
 * comprise) ; la production refuse de démarrer. En recette avec fournisseur, les messages partent
 * pour de vrai et restent aussi lisibles dans la boîte de réception des testeurs.
 */
function createMessaging(config: Config): NotificationSender {
  const { sms, whatsapp } = config.messaging;
  if (!sms) {
    if (config.env !== 'production') return new DevNotificationSender();
    throw new Error(
      'Production : fournisseur SMS obligatoire (INFOBIP_BASE_URL, INFOBIP_API_KEY).',
    );
  }
  const real = new MessagingSender(
    new InfobipSmsSender(sms),
    whatsapp ? new WhatsAppCloudSender(whatsapp) : null,
    (error, message) =>
      console.warn(`WhatsApp refusé (${message.template}), envoi par SMS :`, String(error)),
  );
  return config.env === 'production' ? real : new CopySender(real, new DevNotificationSender());
}

/**
 * Notifications sur le téléphone : service d'Expo dès PUSH_PROVIDER=expo (recette comprise,
 * pour les essayer sur de vrais téléphones) ; sinon elles sont seulement journalisées.
 */
function createNotifier(config: Config): NotificationSender {
  const messaging = createMessaging(config);
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
  if (config.pawapay)
    providers.push(
      new PawapayProvider({
        ...config.pawapay,
        callbackUrl: `${config.publicApiUrl}/v1/webhooks/payments/pawapay`,
      }),
    );
  return {
    config,
    pool,
    clock: systemClock,
    providers: new ProviderRegistry(providers, config.paymentProvider),
    notifier: createNotifier(config),
    storage: createStorage(config),
  };
}
