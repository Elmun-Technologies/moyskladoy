import { TestMessenger } from '@app/shared';
import { createDatabase, applySeed, disconnectPrisma } from '@app/db';
import { BotEngine, routeUpdate } from '@app/bot';
import type { TgSimPayload } from '@app/bot';
import { loadApiConfig } from './config.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const cfg = loadApiConfig();
  const { db, mode } = await createDatabase();
  if (mode === 'memory') await applySeed(db, (m) => console.log(m));

  let demoEngine: Parameters<typeof buildApp>[0]['demoEngine'];
  if (cfg.demoMode) {
    // Demo: bot engine shu jarayon ichida, TestMessenger orqali (Telegram yo'q).
    const rec = new TestMessenger();
    const engine = new BotEngine(db, rec, { demoMode: true, salesStaffTelegramIds: [], log: (l, m) => console.log(`[bot:${l}] ${m}`) });
    demoEngine = {
      simulate: async (p) => {
        const update = p.data
          ? { update_id: p.updateId ?? Date.now() % 1e9, callback_query: { id: 'c' + Date.now(), data: p.data, message: { chat: { id: p.chatId ?? p.telegramId } }, from: { id: p.telegramId } } }
          : { update_id: p.updateId ?? Date.now() % 1e9, message: { chat: { id: p.chatId ?? p.telegramId }, from: { id: p.telegramId }, text: p.text ?? '/start' } };
        await routeUpdate(db, engine, update as TgSimPayload);
      },
      sent: (tgId) => rec.forChat(tgId).map((s) => ({ kind: s.kind, text: s.text ?? s.caption ?? '', buttons: s.buttons ?? [] })),
    };
  }

  const app = await buildApp({ db, cfg, demoEngine });
  await app.listen({ port: cfg.port, host: cfg.host });
  console.log(`[api] listening :${cfg.port} mode=${mode}${cfg.demoMode ? ' (demo: bot simulyatsiya yoqilgan)' : ''}`);

  const shutdown = async () => {
    await app.close();
    await disconnectPrisma();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[api] FATAL', e);
  process.exit(1);
});
