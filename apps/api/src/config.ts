export interface ApiConfig {
  port: number;
  host: string;
  publicUrl: string;
  botUsername: string | null;
  linkTokenTtlHours: number;
  formRateLimitMax: number;
  formMinFillMs: number;
  ipHashSalt: string;
  sessionSecret: string;
  corsOrigins: string[];
  demoMode: boolean;
  retentionDays: number;
  telegramWebhookSecret: string | null;
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    port: Number(env.API_PORT ?? 4000),
    host: env.API_HOST ?? '0.0.0.0',
    publicUrl: env.PUBLIC_URL ?? 'http://localhost:4000',
    botUsername: env.BOT_USERNAME ?? null,
    linkTokenTtlHours: Number(env.LINK_TOKEN_TTL_HOURS ?? 24),
    formRateLimitMax: Number(env.FORM_RATE_LIMIT_MAX ?? 5),
    formMinFillMs: Number(env.FORM_MIN_FILL_MS ?? 1500),
    ipHashSalt: env.IP_HASH_SALT ?? 'dev-only-insecure-salt',
    sessionSecret: env.SESSION_SECRET ?? 'dev-only-insecure-session',
    corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    demoMode: env.DEMO_MODE === 'true' || !env.DATABASE_URL,
    retentionDays: Number(env.RETENTION_DAYS ?? 0),
    telegramWebhookSecret: env.TELEGRAM_WEBHOOK_SECRET ?? null,
  };
}
