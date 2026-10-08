// ============================================================================
// Bot entry. BOT_MODE=webhook|polling|demo.
//  - webhook: o'z HTTP serveri, POST /telegram/webhook, secret tekshiruvi
//  - polling: grammY long-polling (ixtiyoriy)
//  - demo: Telegram'siz simulyatsiya - POST /simulate orqali foydalanuvchi
//    sifatida xabar yuborish, GET /sent/:telegramId bilan o'qish.
// Update dedupe: har update_id faqat BIR marta qayta ishlanadi.
// ============================================================================
import http from 'node:http';
import { Bot } from 'grammy';
import { TestMessenger } from '@app/shared';
import type { Database, Messenger } from '@app/shared';
import { createDatabase, disconnectPrisma, applySeed } from '@app/db';
import { loadBotConfig } from './config.js';
import { GrammyMessenger } from './messenger-grammy.js';
import { BotEngine } from './engine.js';

import type { TgUpdate } from './index-types.js';

export async function routeUpdate(db: Database, engine: BotEngine, update: TgUpdate): Promise<void> {
  if (!Number.isFinite(update.update_id)) return;
  const fresh = await db.markUpdateProcessed(update.update_id);
  if (!fresh) return; // dublikat - Telegram qayta yuborgan
  if (update.callback_query?.data && update.callback_query.message) {
    await engine.handleCallback({
      updateId: update.update_id,
      chatId: update.callback_query.message.chat.id,
      telegramId: update.callback_query.from.id,
      callbackId: update.callback_query.id,
      data: update.callback_query.data,
    });
    return;
  }
  const m = update.message;
  if (!m || !m.from) return;
  const meta = { updateId: update.update_id, chatId: m.chat.id, telegramId: m.from.id };
  const tg = { username: m.from.username, firstName: m.from.first_name, languageCode: m.from.language_code };
  if (typeof m.text === 'string' && (m.text === '/start' || m.text.startsWith('/start '))) {
    await engine.handleStart(meta, tg, m.text.slice(7).trim() || undefined);
    return;
  }
  if (m.contact?.phone_number) {
    await engine.handleText(meta, '', { phone: m.contact.phone_number, verified: m.contact.user_id === m.from.id });
    return;
  }
  if (m.text?.startsWith('/menu')) {
    await engine.handleCallback({ ...meta, callbackId: '', data: 'cmd:menu' });
    return;
  }
  if (m.text?.startsWith('/stop')) {
    await engine.handleCallback({ ...meta, callbackId: '', data: 'cmd:stop' });
    return;
  }
  if (m.text) {
    await engine.handleText(meta, m.text);
  }
}

async function main(): Promise<void> {
  const cfg = loadBotConfig();
  const { db, mode } = await createDatabase();
  if (mode === 'memory') await applySeed(db, (m) => console.log(m));
  const engineLogger = (level: 'info' | 'warn' | 'error', m: string) => console[level === 'info' ? 'log' : level](`[bot:${level}] ${m}`);

  const mkEngine = (m: Messenger) => new BotEngine(db, m, { demoMode: cfg.demoMode, salesStaffTelegramIds: cfg.salesStaffTelegramIds, log: engineLogger });
  let engine: BotEngine;
  let recorder: TestMessenger | null = null;
  if (cfg.botToken && cfg.mode === 'polling') {
    const bot = new Bot(cfg.botToken);
    engine = mkEngine(new GrammyMessenger(bot));
    const handle = (update: TgUpdate) => routeUpdate(db, engine, update);
    bot.on('message', (ctx) => handle(ctx.update as unknown as TgUpdate));
    bot.on('callback_query', (ctx) => handle(ctx.update as unknown as TgUpdate));
    await bot.start();
    return;
  }
  if (cfg.botToken) {
    const bot = new Bot(cfg.botToken);
    engine = mkEngine(new GrammyMessenger(bot));
  } else {
    recorder = new TestMessenger();
    engine = mkEngine(recorder);
    console.log('[bot] TELEGRAM_BOT_TOKEN yo\'q - DEMO simulyatsiya rejimi (Telegram\'ga hech narsa yuborilmaydi)');
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/telegram/webhook') {
      if (cfg.webhookSecret && req.headers['x-telegram-bot-api-secret-token'] !== cfg.webhookSecret) {
        res.writeHead(403).end('forbidden');
        return;
      }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          await routeUpdate(db, engine, JSON.parse(body) as TgUpdate);
          res.writeHead(200).end('ok');
        } catch (e) {
          console.error('[bot] webhook error', (e as Error).message.slice(0, 160));
          res.writeHead(500).end('error');
        }
      });
      return;
    }
    if (recorder && req.method === 'POST' && url.pathname === '/simulate') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const p = JSON.parse(body) as { telegramId: number; chatId?: number; text?: string; data?: string; updateId?: number };
          const chatId = p.chatId ?? p.telegramId;
          const update: TgUpdate = p.data
            ? { update_id: p.updateId ?? Math.floor(Math.random() * 1e9), callback_query: { id: 'c' + Date.now(), data: p.data, message: { chat: { id: chatId } }, from: { id: p.telegramId } } }
            : { update_id: p.updateId ?? Math.floor(Math.random() * 1e9), message: { chat: { id: chatId }, from: { id: p.telegramId }, text: p.text ?? '/start' } };
          await routeUpdate(db, engine, update);
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(500).end(JSON.stringify({ ok: false, error: (e as Error).message.slice(0, 160) }));
        }
      });
      return;
    }
    if (recorder && req.method === 'GET' && url.pathname.startsWith('/sent/')) {
      const tgId = Number(url.pathname.slice('/sent/'.length));
      const items = recorder.forChat(tgId).map((s) => ({ kind: s.kind, text: s.text ?? s.caption ?? '', buttons: s.buttons ?? [], fileId: s.fileId ?? null }));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ messages: items }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/healthz') {
      res.writeHead(200).end('ok');
      return;
    }
    res.writeHead(404).end('not found');
  });

  server.listen(cfg.port, '0.0.0.0', () => console.log(`[bot] listening :${cfg.port} mode=${cfg.botToken ? cfg.mode : 'demo-sim'}`));
}

if (process.argv[1] && process.argv[1].endsWith('index.ts')) {
  main().catch((e) => {
    console.error('[bot] FATAL', e);
    process.exit(1);
  });
}

export { BotEngine } from './engine.js';
export { GrammyMessenger } from './messenger-grammy.js';
export type { TgUpdate as TgSimPayload } from './index-types.js';
