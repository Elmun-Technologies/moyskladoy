import { beforeEach, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { MemoryDatabase, TestMessenger } from '@app/shared';
import type { Database } from '@app/shared';
import { applySeed } from '@app/db';
import { BotEngine, routeUpdate } from '@app/bot';
import { loadApiConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

let db: Database;
let app: FastifyInstance;
let rec: TestMessenger;

const cfg = { ...loadApiConfig({}), demoMode: true, botUsername: 'demo_bot', formMinFillMs: 0, formRateLimitMax: 100 };

async function setup(): Promise<void> {
  db = new MemoryDatabase();
  await applySeed(db, () => undefined);
  rec = new TestMessenger();
  const engine = new BotEngine(db, rec, { demoMode: true, salesStaffTelegramIds: [] });
  app = await buildApp({
    db,
    cfg,
    demoEngine: {
      simulate: async (p) => {
        const update = p.data
          ? { update_id: p.updateId ?? Date.now() % 100000000, callback_query: { id: 'c' + (p.updateId ?? 0), data: p.data, message: { chat: { id: p.telegramId } }, from: { id: p.telegramId } } }
          : { update_id: p.updateId ?? Date.now() % 100000000, message: { chat: { id: p.telegramId }, from: { id: p.telegramId }, text: p.text ?? '/start' } };
        await routeUpdate(db, engine, update);
      },
      sent: (tgId) => rec.forChat(tgId),
    },
  });
}

beforeEach(setup);

async function admin(email: string, role: 'admin' | 'sales' | 'content_editor'): Promise<void> {
  await db.createAdmin({ email, passwordHash: await bcrypt.hash('password123', 4), name: email.split('@')[0] ?? 'x', role, failedLogins: 0, lockedUntil: null, lastLoginAt: null });
}

async function login(email: string): Promise<{ sid: string; csrf: string }> {
  const r = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { email, password: 'password123' } });
  expect(r.statusCode).toBe(200);
  const cookie = r.headers['set-cookie'] as string;
  const sid = /sid=([^;]+)/.exec(cookie)?.[1] ?? '';
  return { sid, csrf: (r.json() as { csrf: string }).csrf };
}

describe('site form', () => {
  it('valid form -> t.me link with ONLY random token', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/site/lead', payload: { name: 'Ali', phone: '+998901112233', formStartedAt: Date.now() - 5000, consentContact: true, consentMarketing: false, website: '' } });
    expect(r.statusCode).toBe(200);
    const j = r.json() as { ok: boolean; link: string };
    expect(j.ok).toBe(true);
    expect(j.link).toMatch(/^https:\/\/t\.me\/demo_bot\?start=[A-Za-z0-9_-]{6,64}$/);
    expect(j.link).not.toContain('Ali');
    expect(j.link).not.toContain('998901112233');
  });

  it('honeypot filled -> rejected, no lead', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/site/lead', payload: { name: 'Bot', phone: '+998901112233', formStartedAt: Date.now() - 5000, consentContact: true, consentMarketing: false, website: 'spam' } });
    expect(r.statusCode).toBe(422);
    expect((await db.listUsers()).total).toBe(0);
  });

  it('too fast (< minFillMs) -> 429', async () => {
    const strict = { ...cfg, formMinFillMs: 1500 };
    const app2 = await buildApp({ db, cfg: strict });
    const r = await app2.inject({ method: 'POST', url: '/api/site/lead', payload: { name: 'Veli', phone: '+998901112233', formStartedAt: Date.now(), consentContact: true, consentMarketing: false } });
    expect(r.statusCode).toBe(429);
    await app2.close();
  });

  it('no consent -> 422', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/site/lead', payload: { name: 'Veli', phone: '+998901112233', formStartedAt: Date.now() - 5000, consentContact: false, consentMarketing: false } });
    expect(r.statusCode).toBe(422);
  });

  it('link token -> bot start binds user, site data reused', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/site/lead', payload: { name: 'Sana', phone: '+998901112233', formStartedAt: Date.now() - 5000, consentContact: true, consentMarketing: false } });
    const link = (r.json() as { link: string }).link;
    const token = new URL(link).searchParams.get('start')!;
    await app.inject({ method: 'POST', url: '/api/bot/simulate', payload: { telegramId: 901, text: '/start ' + token, updateId: 12345 } });
    const user = await db.getUserByTelegramId(901);
    expect(user?.siteLeadId).not.toBeNull();
  });
});

describe('auth, csrf, roles', () => {
  it('login: wrong password 401; 6th attempt locked 423', async () => {
    await admin('lock@test.uz', 'admin');
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { email: 'lock@test.uz', password: 'wrongpass' } });
      expect(r.statusCode).toBe(401);
    }
    const r6 = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { email: 'lock@test.uz', password: 'password123' } });
    expect(r6.statusCode).toBe(423);
  });

  it('admin API without session -> 403', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/admin/stats' });
    expect(r.statusCode).toBe(403);
  });

  it('CSRF required on writes', async () => {
    await admin('a@test.uz', 'admin');
    const { sid, csrf } = await login('a@test.uz');
    const r = await app.inject({ method: 'POST', url: '/api/admin/settings', headers: { cookie: `sid=${sid}` }, payload: { key: 'lesson_link', value: 'https://x.uz' } });
    expect(r.statusCode).toBe(403);
    const r2 = await app.inject({ method: 'POST', url: '/api/admin/settings', headers: { cookie: `sid=${sid}`, 'x-csrf-token': csrf }, payload: { key: 'lesson_link', value: 'https://x.uz' } });
    expect(r2.statusCode).toBe(200);
  });

  it('content_editor: cannot change prices, can save block drafts, cannot export', async () => {
    await admin('ed@test.uz', 'content_editor');
    const { sid, csrf } = await login('ed@test.uz');
    const h = { cookie: `sid=${sid}`, 'x-csrf-token': csrf };
    const price = await app.inject({ method: 'POST', url: '/api/admin/products', headers: h, payload: { slug: 'course', kind: 'course', name: 'K', description: 'd', priceType: 'fixed', priceUsd: 1 } });
    expect(price.statusCode).toBe(403);
    const block = await app.inject({ method: 'POST', url: '/api/admin/blocks', headers: h, payload: { key: 'welcome', title: 'Kirish', body: 'Yangi matn', buttons: [] } });
    expect(block.statusCode).toBe(200);
    // saqlangan DRAFT - approved versiya o'zgarmagan: bot eski matnni yuboradi
    await app.inject({ method: 'POST', url: '/api/bot/simulate', payload: { telegramId: 902, text: '/start', updateId: 22000 } });
    expect(rec.last(902)?.text).toContain('Xush kelibsiz');
    const exp = await app.inject({ method: 'POST', url: '/api/admin/export/contacts', headers: h });
    expect(exp.statusCode).toBe(403);
  });

  it('sales: cannot change prices but can claim leads', async () => {
    await admin('sales@test.uz', 'sales');
    const { sid, csrf } = await login('sales@test.uz');
    const h = { cookie: `sid=${sid}`, 'x-csrf-token': csrf };
    const price = await app.inject({ method: 'POST', url: '/api/admin/products', headers: h, payload: { slug: 'course', kind: 'course', name: 'K', description: 'd', priceType: 'fixed', priceUsd: 1 } });
    expect(price.statusCode).toBe(403);
    // ariza yaratamiz va claim qilamiz
    await app.inject({ method: 'POST', url: '/api/bot/simulate', payload: { telegramId: 903, text: '/start', updateId: 33000 } });
    await app.inject({ method: 'POST', url: '/api/bot/simulate', payload: { telegramId: 903, data: 'consent:grant', updateId: 33001 } });
    await app.inject({ method: 'POST', url: '/api/bot/simulate', payload: { telegramId: 903, data: 'contact:telegram', updateId: 33002 } });
    await app.inject({ method: 'POST', url: '/api/bot/simulate', payload: { telegramId: 903, data: 'submit:send', updateId: 33003 } });
    const user = await db.getUserByTelegramId(903);
    const lead = await db.getActiveLeadByUser(user!.id);
    expect(lead).not.toBeNull();
    const claim = await app.inject({ method: 'POST', url: `/api/admin/leads/${lead!.id}/claim`, headers: h });
    expect(claim.statusCode).toBe(200);
    expect((await db.getSalesLead(lead!.id))?.assignedToId).not.toBeNull();
  });

  it('admin approve blocked when mandatory media missing', async () => {
    await admin('boss@test.uz', 'admin');
    const { sid, csrf } = await login('boss@test.uz');
    const h = { cookie: `sid=${sid}`, 'x-csrf-token': csrf };
    const save = await app.inject({ method: 'POST', url: '/api/admin/blocks', headers: h, payload: { key: 'new_video', stage: 'START', title: 'T', body: 'b', mediaType: 'video_note', requiresMedia: true, textFallbackAllowed: false, buttons: [] } });
    const id = (save.json() as { id: string }).id;
    const appr = await app.inject({ method: 'POST', url: `/api/admin/blocks/${id}/approve`, headers: h });
    expect(appr.statusCode).toBe(409);
  });
});

describe('demo bot flow through API', () => {
  it('simulate -> sent messages readable; duplicate updateId ignored', async () => {
    const r1 = await app.inject({ method: 'POST', url: '/api/bot/simulate', payload: { telegramId: 950, text: '/start', updateId: 777 } });
    expect(r1.statusCode).toBe(200);
    const r2 = await app.inject({ method: 'GET', url: '/api/bot/sent/950' });
    const j = r2.json() as { messages: { text: string }[] };
    expect(j.messages.length).toBeGreaterThan(0);
    const n = j.messages.length;
    await app.inject({ method: 'POST', url: '/api/bot/simulate', payload: { telegramId: 950, text: '/start', updateId: 777 } });
    const r3 = await app.inject({ method: 'GET', url: '/api/bot/sent/950' });
    expect(((r3.json() as { messages: unknown[] }).messages.length)).toBe(n);
  });
});
