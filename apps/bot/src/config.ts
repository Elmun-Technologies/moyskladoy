/**
 * Bot konfiguratsiyasi - faqat env orqali. Hech qanday maxfiy qiymat
 * kod ichida yo'q. Log'larga telefon/token yozilmaydi (sanitize qilingan).
 */
export interface BotConfig {
  botToken: string | null;
  botUsername: string | null;
  mode: 'webhook' | 'polling' | 'headless';
  webhookSecret: string | null;
  port: number;
  demoMode: boolean;
  salesStaffTelegramIds: number[];
  publicUrl: string;
}

export function loadBotConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const mode = (env.BOT_MODE === 'polling' ? 'polling' : env.BOT_MODE === 'headless' ? 'headless' : 'webhook') as BotConfig['mode'];
  const staff = (env.SALES_STAFF_TELEGRAM_IDS ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return {
    botToken: env.TELEGRAM_BOT_TOKEN ?? null,
    botUsername: env.BOT_USERNAME ?? null,
    mode,
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET ?? null,
    port: Number(env.BOT_PORT ?? 4100),
    demoMode: env.DEMO_MODE === 'true' || !env.DATABASE_URL,
    salesStaffTelegramIds: staff,
    publicUrl: env.PUBLIC_URL ?? 'http://localhost:4000',
  };
}
