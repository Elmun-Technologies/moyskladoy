import { EskizClient, TestMessenger } from '@app/shared';
import type { Messenger } from '@app/shared';
import { Bot } from 'grammy';
import { createDatabase, disconnectPrisma } from '@app/db';
import { GrammyMessenger } from '@app/bot';
import { OutboxSender } from './sender.js';
import { CampaignRunner, SmsSender } from './campaigns.js';
import { scheduleRules } from './reminders.js';
import { createTickDriver } from './queue.js';

async function main(): Promise<void> {
  const log = (l: 'info' | 'warn' | 'error', m: string) => console[l === 'info' ? 'log' : l](`[worker:${l}] ${m}`);
  const { db, mode } = await createDatabase();
  const token = process.env.TELEGRAM_BOT_TOKEN ?? null;
  const msg: Messenger = token ? new GrammyMessenger(new Bot(token)) : new TestMessenger();
  if (!token) log('warn', 'TELEGRAM_BOT_TOKEN yo\'q - yuborishlar qayd etiladi, ammo Telegram\'ga chiqmaydi (demo)');
  const sender = new OutboxSender(db, msg, {
    backoffMs: Number(process.env.OUTBOX_RETRY_BACKOFF_MS ?? 900000),
    maxAttempts: Number(process.env.OUTBOX_MAX_ATTEMPTS ?? 5),
    marketingMaxPerDay: Number(process.env.MARKETING_MAX_PER_DAY ?? 1),
    log,
  });
  const smsGateway = process.env.SMS_USER && process.env.SMS_PASSWORD
    ? new EskizClient({ email: process.env.SMS_USER, password: process.env.SMS_PASSWORD, from: process.env.SMS_FROM ?? '4546' })
    : null;
  if (!smsGateway) log('warn', 'SMS_USER/SMS_PASSWORD yo\'q - SMS kampaniyalari yuborilmaydi');
  const campaignRunner = new CampaignRunner(db, { log });
  const smsSender = new SmsSender(db, smsGateway, { log, smsMaxAttempts: Number(process.env.SMS_MAX_ATTEMPTS ?? 5), smsBackoffMs: Number(process.env.SMS_RETRY_BACKOFF_MS ?? 900000) });
  const driver = await createTickDriver({
    redisUrl: process.env.REDIS_URL ?? null,
    intervalMs: Number(process.env.REMINDER_TICK_MS ?? 60000),
    log: (m) => log('info', m),
  });
  await driver.start(async () => {
    const now = new Date();
    const added = await scheduleRules(db, now);
    const campaigns = await campaignRunner.process(now);
    const sms = await smsSender.process(now);
    const r = await sender.processDue(now);
    const finished = await campaignRunner.process(now);
    if (added || campaigns.queued || campaigns.completed || finished.completed || sms.sent || sms.skipped || sms.failed || r.sent || r.cancelled || r.retried) {
      log('info', `tick: +${added} reminders; campaigns queued=${campaigns.queued},done=${campaigns.completed + finished.completed}; sms sent=${sms.sent},skipped=${sms.skipped},failed=${sms.failed}; outbox sent=${r.sent} retry=${r.retried} cancel=${r.cancelled} defer=${r.deferred} fail=${r.failed}`);
    }
  });
  log('info', `worker started mode=${mode}`);
  const stop = async () => {
    await driver.stop();
    await disconnectPrisma();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  console.error('[worker] FATAL', e);
  process.exit(1);
});

export { OutboxSender, nextWindowStart } from './sender.js';
export { CampaignRunner, SmsSender, renderCampaignText } from './campaigns.js';
export { scheduleRules } from './reminders.js';
export { createTickDriver } from './queue.js';
