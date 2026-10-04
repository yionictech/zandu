import { z } from 'zod';
import {
  DEFAULT_ORDER_POLICY,
  DEFAULT_PAYOUT_POLICY,
  type OrderPolicy,
  type PayoutPolicy,
} from '@zandu/domain';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  /** Secret HMAC pour les codes OTP et les codes de remise (≥ 32 caractères, coffre de secrets). */
  APP_SECRET: z.string().min(32),
  PAYMENT_PROVIDER: z.string().default('simulator'),
  SIMULATOR_WEBHOOK_SECRET: z.string().min(16).default('dev-simulator-webhook-secret'),
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
});

export type Env = z.infer<typeof EnvSchema>;

export interface Config {
  env: Env['NODE_ENV'];
  port: number;
  host: string;
  databaseUrl: string;
  appSecret: string;
  paymentProvider: string;
  simulatorWebhookSecret: string;
  supportAlertPhone: string | null;
  workerTickMs: number;
  payments: {
    ttlMinutes: number;
    checkoutMaxMinutes: number;
    pollIntervalSeconds: number;
    pollHorizonMinutes: number;
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
  };
  orderPolicy: OrderPolicy;
  payoutPolicy: PayoutPolicy;
  disputeSlaHours: number;
  handoverMaxAttempts: number;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const env = EnvSchema.parse(source);
  if (env.NODE_ENV === 'production' && env.PAYMENT_PROVIDER === 'simulator') {
    throw new Error('Le simulateur de paiement est interdit en production (PAYMENT_PROVIDER).');
  }
  return {
    env: env.NODE_ENV,
    port: env.PORT,
    host: env.HOST,
    databaseUrl: env.DATABASE_URL,
    appSecret: env.APP_SECRET,
    paymentProvider: env.PAYMENT_PROVIDER,
    simulatorWebhookSecret: env.SIMULATOR_WEBHOOK_SECRET,
    supportAlertPhone: env.SUPPORT_ALERT_PHONE ?? null,
    workerTickMs: env.WORKER_TICK_SECONDS * 1000,
    payments: {
      ttlMinutes: env.PAYMENT_TTL_MINUTES,
      checkoutMaxMinutes: env.CHECKOUT_MAX_MINUTES,
      pollIntervalSeconds: env.PAYMENT_POLL_INTERVAL_SECONDS,
      pollHorizonMinutes: env.PAYMENT_POLL_HORIZON_MINUTES,
    },
    disbursements: { maxAttempts: 3, backoffMinutes: [5, 30, 120], leaseMinutes: 5 },
    auth: {
      otpTtlSeconds: 300,
      otpResendSeconds: 60,
      otpMaxAttempts: 5,
      otpMaxPerPhonePerHour: 5,
      otpMaxPerIpPerHour: 30,
      sessionDays: 30,
      staffSessionHours: 12,
    },
    orderPolicy: {
      sellerAcceptanceHours: env.SELLER_ACCEPT_HOURS,
      disputeWindowHours: env.DISPUTE_WINDOW_HOURS,
    },
    payoutPolicy: { ...DEFAULT_PAYOUT_POLICY, newSellerCapAmount: env.NEW_SELLER_PAYOUT_CAP },
    disputeSlaHours: 72,
    handoverMaxAttempts: 5,
  };
}
