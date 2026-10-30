import { z } from 'zod';
import {
  DEFAULT_ORDER_POLICY,
  DEFAULT_PAYOUT_POLICY,
  parseCongoMobile,
  type OrderPolicy,
  type PayoutPolicy,
} from '@zandu/domain';

const DEV_WEBHOOK_SECRET = 'dev-simulator-webhook-secret';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * Environnement de déploiement (par défaut : NODE_ENV). « recette » applique les règles de la
   * production, mais avec l'agrégateur simulé et la boîte de réception protégée (ADR-0013).
   */
  ZANDU_ENV: z.enum(['development', 'test', 'recette', 'production']).optional(),
  /** Recette : clé exigée pour lire les SMS de test (en-tête x-recette-key), ≥ 24 caractères. */
  RECETTE_KEY: z.string().min(24).optional(),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  /** Secret HMAC pour les codes OTP et les codes de remise (≥ 32 caractères, coffre de secrets). */
  APP_SECRET: z.string().min(32),
  PAYMENT_PROVIDER: z.string().default('simulator'),
  SIMULATOR_WEBHOOK_SECRET: z.string().min(16).default(DEV_WEBHOOK_SECRET),
  SUPPORT_ALERT_PHONE: z.string().optional(),
  PAYMENT_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  CHECKOUT_MAX_MINUTES: z.coerce.number().int().positive().default(30),
  PAYMENT_POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(120),
  PAYMENT_POLL_HORIZON_MINUTES: z.coerce.number().int().positive().default(30),
  SELLER_ACCEPT_HOURS: z.coerce
    .number()
    .positive()
    .default(DEFAULT_ORDER_POLICY.sellerAcceptanceHours),
  DISPUTE_WINDOW_HOURS: z.coerce
    .number()
    .positive()
    .default(DEFAULT_ORDER_POLICY.disputeWindowHours),
  NEW_SELLER_PAYOUT_CAP: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(DEFAULT_PAYOUT_POLICY.newSellerCapAmount),
  WORKER_TICK_SECONDS: z.coerce.number().positive().default(5),
  /** Adresse publique de l'API (liens du stockage de développement). */
  PUBLIC_API_URL: z.string().default('http://localhost:3000'),
  /** Origines web autorisées (CORS), séparées par des virgules. Vide = toutes en développement. */
  CORS_ORIGINS: z.string().default(''),
  STORAGE_DRIVER: z.enum(['memory', 's3']).default('memory'),
  /** Stockage de développement : dossier où conserver les fichiers (sinon en mémoire seulement). */
  LOCAL_STORAGE_DIR: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  /** Adresse du stockage vue des téléphones, quand elle diffère de S3_ENDPOINT (réseau interne). */
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('eu-west-3'),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),
  S3_PUBLIC_BUCKET: z.string().default('zandu-public'),
  S3_PRIVATE_BUCKET: z.string().default('zandu-private'),
  /** CDN devant le compartiment public, ex. https://media.exemple.cg */
  MEDIA_PUBLIC_BASE_URL: z.string().default(''),
  /** Notifications sur le téléphone : `expo` (service d'Expo) ou `none` (rien n'est envoyé). */
  PUSH_PROVIDER: z.enum(['expo', 'none']).default('none'),
  /** Jeton d'accès Expo, si l'envoi sécurisé est activé sur le projet Expo. */
  EXPO_ACCESS_TOKEN: z.string().optional(),
  /** Délai avant de doubler par WhatsApp/SMS une notification importante restée sans suite. */
  PUSH_FALLBACK_MINUTES: z.coerce.number().int().positive().default(15),
  /** Attente chez le client (après « Je suis arrivé ») avant de pouvoir la déclarer absente. */
  RIDER_ABSENT_WAIT_MINUTES: z.coerce.number().int().min(0).default(10),
  /** Second facteur (TOTP) du personnel. Toujours exigé en production ; désactivé par défaut en test. */
  STAFF_MFA_REQUIRED: z.stringbool().optional(),
  /**
   * Compte de revue Google Play / App Store (docs/exploitation/publication-stores.md) :
   * « +242060000000:482915 ». Ce numéro reçoit toujours ce code, sans SMS. Acheteur seulement.
   */
  STORE_REVIEW_ACCOUNT: z
    .string()
    .regex(/^\+?\d{9,15}:\d{6}$/, 'STORE_REVIEW_ACCOUNT : « numéro:code à 6 chiffres »')
    .optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export type DeploymentEnv = NonNullable<Env['ZANDU_ENV']>;

/** Recette et production : vraies adresses, vrais téléphones, mêmes garde-fous. */
export const isDeployed = (env: DeploymentEnv): boolean =>
  env === 'recette' || env === 'production';

export interface Config {
  env: DeploymentEnv;
  port: number;
  host: string;
  databaseUrl: string;
  appSecret: string;
  paymentProvider: string;
  simulatorWebhookSecret: string;
  supportAlertPhone: string | null;
  push: { provider: 'expo' | 'none'; expoAccessToken: string | null };
  pushFallbackMinutes: number;
  /** Recette : clé de la boîte de réception des SMS de test ; null ailleurs. */
  recetteKey: string | null;
  workerTickMs: number;
  payments: {
    ttlMinutes: number;
    checkoutMaxMinutes: number;
    pollIntervalSeconds: number;
    pollHorizonMinutes: number;
  };
  reconciliation: {
    /** Heure du Congo à partir de laquelle la journée de la veille est contrôlée. */
    runAtHour: number;
    /** Mouvement comptabilisé moins de N minutes avant la fin de la période : attendu au relevé suivant. */
    cutoffMinutes: number;
    /** Journées passées rattrapées si le worker a été arrêté. */
    catchUpDays: number;
    /** Délai avant de redemander un relevé indisponible. */
    retryMinutes: number;
  };
  disbursements: {
    maxAttempts: number;
    /** Délais avant nouvelle tentative (reversements et remboursements). */
    backoffMinutes: readonly number[];
    /** Bail : délai avant de revérifier une opération envoyée à l'agrégateur. */
    leaseMinutes: number;
  };
  auth: {
    otpTtlSeconds: number;
    otpResendSeconds: number;
    otpMaxAttempts: number;
    otpMaxPerPhonePerHour: number;
    otpMaxPerIpPerHour: number;
    sessionDays: number;
    staffSessionHours: number;
    /** Routes du support et de l'administration : code TOTP vérifié pour la session. */
    staffMfaRequired: boolean;
    /** Codes TOTP erronés tolérés avant révocation de la session. */
    mfaMaxAttempts: number;
  };
  orderPolicy: OrderPolicy;
  payoutPolicy: PayoutPolicy;
  disputeSlaHours: number;
  handoverMaxAttempts: number;
  riderAbsentWaitMinutes: number;
  publicApiUrl: string;
  /** Compte de revue des stores : code fixe, aucun SMS envoyé. */
  storeReview: { phone: string; code: string } | null;
  /** null = toute origine (développement uniquement). */
  corsOrigins: string[] | null;
  storage:
    | { driver: 'memory'; dir: string | null }
    | {
        driver: 's3';
        endpoint: string | undefined;
        publicEndpoint: string | undefined;
        region: string;
        accessKeyId: string;
        secretAccessKey: string;
        forcePathStyle: boolean;
        buckets: { public: string; private: string };
        publicBaseUrl: string;
      };
}

function parseReviewAccount(value: string | undefined): Config['storeReview'] {
  if (!value) return null;
  const [phone, code] = value.split(':') as [string, string];
  if (/^(\d)\1{5}$/.test(code) || code === '123456')
    throw new Error('STORE_REVIEW_ACCOUNT : choisissez un code moins évident.');
  return { phone: parseCongoMobile(phone).e164, code };
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const env = EnvSchema.parse(source);
  const deployment: DeploymentEnv = env.ZANDU_ENV ?? env.NODE_ENV;
  if (env.NODE_ENV === 'production' && !isDeployed(deployment)) {
    throw new Error(`ZANDU_ENV=${deployment} est incompatible avec NODE_ENV=production.`);
  }
  if (deployment === 'production' && env.PAYMENT_PROVIDER === 'simulator') {
    throw new Error('Le simulateur de paiement est interdit en production (PAYMENT_PROVIDER).');
  }
  if (isDeployed(deployment) && env.STAFF_MFA_REQUIRED === false) {
    throw new Error(
      'Le second facteur du personnel ne peut pas être désactivé hors développement.',
    );
  }
  if (isDeployed(deployment) && (env.STORAGE_DRIVER !== 's3' || !env.CORS_ORIGINS)) {
    throw new Error(
      `En ${deployment} : STORAGE_DRIVER=s3 et CORS_ORIGINS explicites sont obligatoires.`,
    );
  }
  if (deployment === 'recette' && !env.RECETTE_KEY) {
    throw new Error('En recette : RECETTE_KEY (clé de la boîte de réception) est obligatoire.');
  }
  if (deployment === 'recette' && env.SIMULATOR_WEBHOOK_SECRET === DEV_WEBHOOK_SECRET) {
    throw new Error('En recette : SIMULATOR_WEBHOOK_SECRET doit être un secret propre.');
  }
  const corsOrigins = env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return {
    env: deployment,
    port: env.PORT,
    host: env.HOST,
    databaseUrl: env.DATABASE_URL,
    appSecret: env.APP_SECRET,
    paymentProvider: env.PAYMENT_PROVIDER,
    simulatorWebhookSecret: env.SIMULATOR_WEBHOOK_SECRET,
    supportAlertPhone: env.SUPPORT_ALERT_PHONE ?? null,
    storeReview: parseReviewAccount(env.STORE_REVIEW_ACCOUNT),
    push: { provider: env.PUSH_PROVIDER, expoAccessToken: env.EXPO_ACCESS_TOKEN ?? null },
    pushFallbackMinutes: env.PUSH_FALLBACK_MINUTES,
    recetteKey: deployment === 'recette' ? env.RECETTE_KEY! : null,
    workerTickMs: env.WORKER_TICK_SECONDS * 1000,
    payments: {
      ttlMinutes: env.PAYMENT_TTL_MINUTES,
      checkoutMaxMinutes: env.CHECKOUT_MAX_MINUTES,
      pollIntervalSeconds: env.PAYMENT_POLL_INTERVAL_SECONDS,
      pollHorizonMinutes: env.PAYMENT_POLL_HORIZON_MINUTES,
    },
    reconciliation: { runAtHour: 2, cutoffMinutes: 30, catchUpDays: 7, retryMinutes: 30 },
    disbursements: { maxAttempts: 3, backoffMinutes: [5, 30, 120], leaseMinutes: 5 },
    auth: {
      otpTtlSeconds: 300,
      otpResendSeconds: 60,
      otpMaxAttempts: 5,
      otpMaxPerPhonePerHour: 5,
      otpMaxPerIpPerHour: 30,
      sessionDays: 30,
      staffSessionHours: 12,
      staffMfaRequired: env.STAFF_MFA_REQUIRED ?? deployment !== 'test',
      mfaMaxAttempts: 5,
    },
    orderPolicy: {
      sellerAcceptanceHours: env.SELLER_ACCEPT_HOURS,
      disputeWindowHours: env.DISPUTE_WINDOW_HOURS,
    },
    payoutPolicy: { ...DEFAULT_PAYOUT_POLICY, newSellerCapAmount: env.NEW_SELLER_PAYOUT_CAP },
    disputeSlaHours: 72,
    handoverMaxAttempts: 5,
    riderAbsentWaitMinutes: env.RIDER_ABSENT_WAIT_MINUTES,
    publicApiUrl: env.PUBLIC_API_URL.replace(/\/$/, ''),
    corsOrigins: corsOrigins.length ? corsOrigins : null,
    storage:
      env.STORAGE_DRIVER === 'memory'
        ? { driver: 'memory', dir: env.LOCAL_STORAGE_DIR ?? null }
        : {
            driver: 's3',
            endpoint: env.S3_ENDPOINT,
            publicEndpoint: env.S3_PUBLIC_ENDPOINT,
            region: env.S3_REGION,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            forcePathStyle: env.S3_FORCE_PATH_STYLE,
            buckets: { public: env.S3_PUBLIC_BUCKET, private: env.S3_PRIVATE_BUCKET },
            publicBaseUrl: env.MEDIA_PUBLIC_BASE_URL,
          },
  };
}
