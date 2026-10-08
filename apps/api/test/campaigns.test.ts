import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { MemoryDatabase, TestMessenger } from '@app/shared';
import type { Database } from '@app/shared';
import { applySeed } from '@app/db';
import { BotEngine, routeUpdate } from '@app/bot';
import { loadApiConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';

const cfg = { ...loadApiConfig({}), demoMode: true, botUsername: 'demo_bot', formMinFillMs: 0, formRateLimitMax: 100 };
let db: Database;
let app: FastifyInstance;

async function admin(email = 'campaign@test.uz') {
  return db.createAdmin({ email, passwordHash: await bcrypt.hash('password123', 4), name: email.split('@')[0]!, role: 'admin', failedLogins: 0, lockedUntil: null, lastLoginAt: null });
}
async function session(email = 'campaign@test.uz', target: FastifyInstance = app) {
  const r = await target.inject({ method: 'POST', url: '/api/admin/login', payload: { email, password: 'password123' } });
  expect(r.statusCode).toBe(200);
  const sid = /sid=([^;]+)/.exec(r.headers['set-cookie'] as string)?.[1] ?? '';
  const csrf = (r.json() as { csrf: string }).csrf;
  return { headers: { cookie: `sid=${sid}`, 'x-csrf-token': csrf } };
}

beforeEach(async () => {
  db = new MemoryDatabase();
  await applySeed(db, () => undefined);
  const messenger = new TestMessenger();
  const engine = new BotEngine(db, messenger, { demoMode: true });
  app = await buildApp({
    db,
    cfg,
    smsApi: { balance: async () => ({ balance: null, raw: { fake: true } }) },
    demoEngine: {
      simulate: async (p) => {
        const update = p.data
          ? { update_id: p.updateId ?? 700000 + p.telegramId, callback_query: { id: 'test', data: p.data, message: { chat: { id: p.telegramId } }, from: { id: p.telegramId } } }
          : { update_id: p.updateId ?? 700000 + p.telegramId, message: { chat: { id: p.telegramId }, from: { id: p.telegramId, first_name: 'Test' }, text: p.text ?? '/start' } };
        await routeUpdate(db, engine, update);
      },
      sent: (telegramId) => messenger.forChat(telegramId),
    },
  });
});
afterEach(async () => { await app.close(); });

describe('segments and Telegram campaigns', () => {
  it('previews, saves, tests, starts, pauses, resumes, cancels and exports without a provider call', async () => {
    await admin();
    const auth = await session();
    const user = await db.upsertTelegramUser({ telegramId: 771001, firstName: 'Aziza' });
    await db.createState(user.id, 'OFFERS');
    await db.grantConsent(user.id, 'marketing', 'v1');
    const noConsent = await db.upsertTelegramUser({ telegramId: 771004, firstName: 'Opt-out' });
    await db.createState(noConsent.id, 'OFFERS');

    const preview = await app.inject({ method: 'POST', url: '/api/admin/segments/preview', headers: auth.headers, payload: { channel: 'telegram', filters: { stageKey: 'OFFERS', consentMarketing: true } } });
    expect(preview.statusCode).toBe(200);
    expect((preview.json() as { count: number; sample: { telegramId: number }[] }).count).toBe(1);
    expect((preview.json() as { sample: { telegramId: number }[] }).sample.map((row) => row.telegramId)).not.toContain(noConsent.telegramId);

    const saved = await app.inject({ method: 'POST', url: '/api/admin/segments', headers: auth.headers, payload: { name: 'Offer consent', filters: { stageKey: 'OFFERS', consentMarketing: true } } });
    expect(saved.statusCode).toBe(201);
    expect((await app.inject({ method: 'GET', url: '/api/admin/segments', headers: auth.headers })).statusCode).toBe(200);

    const created = await app.inject({ method: 'POST', url: '/api/admin/campaigns', headers: auth.headers, payload: {
      name: 'Telegram sinov', channel: 'telegram', filters: { stageKey: 'OFFERS', consentMarketing: true },
      templateText: 'Salom, {{ism}}!', buttons: [{ label: 'Takliflar', action: 'goto:OFFERS' }],
    } });
    expect(created.statusCode).toBe(201);
    const campaign = (created.json() as { campaign: { id: string; status: string } }).campaign;
    expect(campaign.status).toBe('draft');

    const unsafeTest = await app.inject({ method: 'POST', url: `/api/admin/campaigns/${campaign.id}/test`, headers: auth.headers, payload: { telegramId: noConsent.telegramId } });
    expect(unsafeTest.statusCode).toBe(409);
    const testSend = await app.inject({ method: 'POST', url: `/api/admin/campaigns/${campaign.id}/test`, headers: auth.headers, payload: { telegramId: user.telegramId } });
    expect(testSend.statusCode).toBe(202);
    const queuedTest = (await db.listOutbox({ userId: user.id, limit: 10 })).find((row) => row.payload.testOnly === true);
    expect(queuedTest?.campaignId).toBeNull();
    expect(queuedTest?.payload.text).toContain('Aziza');

    expect((await app.inject({ method: 'POST', url: `/api/admin/campaigns/${campaign.id}/start`, headers: auth.headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/admin/campaigns/${campaign.id}/pause`, headers: auth.headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/admin/campaigns/${campaign.id}/resume`, headers: auth.headers })).statusCode).toBe(200);
    const cancel = await app.inject({ method: 'POST', url: `/api/admin/campaigns/${campaign.id}/cancel`, headers: auth.headers });
    expect(cancel.statusCode).toBe(200);
    expect((await db.getCampaign(campaign.id))?.status).toBe('cancelled');
    expect((await db.listAudit({ entity: 'campaign' })).map((row) => row.action)).toContain('campaign.cancel');

    const exportResponse = await app.inject({ method: 'GET', url: `/api/admin/campaigns/${campaign.id}/export.csv`, headers: auth.headers });
    expect(exportResponse.statusCode).toBe(200);
    expect(exportResponse.headers['content-type']).toContain('text/csv');
    expect(exportResponse.body).toContain('"userId","telegramId"');
    const details = await app.inject({ method: 'GET', url: `/api/admin/campaigns/${campaign.id}`, headers: auth.headers });
    expect((details.json() as { attribution: { clicks: number } }).attribution.clicks).toBe(0);
  });

  it('rejects blocked recipients as an exposed segment and unknown filter keys', async () => {
    await admin();
    const auth = await session();
    const blocked = await app.inject({ method: 'POST', url: '/api/admin/segments/preview', headers: auth.headers, payload: { channel: 'sms', filters: { blocked: true } } });
    expect(blocked.statusCode).toBe(422);
    const unknown = await app.inject({ method: 'POST', url: '/api/admin/segments/preview', headers: auth.headers, payload: { channel: 'telegram', filters: { rawSql: '1=1' } } });
    expect(unknown.statusCode).toBe(422);
  });
});

describe('SMS estimate/confirmation and reports', () => {
  it('prices only phone + SMS-consented users, requires confirmation, queues a test and reads fake balance', async () => {
    await admin();
    const auth = await session();
    const user = await db.upsertTelegramUser({ telegramId: 771002, firstName: 'Bek' });
    await db.createState(user.id, 'START');
    await db.upsertUserPhone(user.id, '+998901234567', { verified: true, smsConsent: true });
    await db.grantConsent(user.id, 'sms_marketing', 'v1');

    const created = await app.inject({ method: 'POST', url: '/api/admin/campaigns', headers: auth.headers, payload: {
      name: 'SMS rozilikli', channel: 'sms', filters: {}, templateText: 'Salom!',
    } });
    expect(created.statusCode).toBe(201);
    const campaign = (created.json() as { campaign: { id: string } }).campaign;
    const estimateResponse = await app.inject({ method: 'POST', url: '/api/admin/sms/estimate', headers: auth.headers, payload: { campaignId: campaign.id } });
    expect(estimateResponse.statusCode).toBe(200);
    const estimate = estimateResponse.json() as { recipientCount: number; totalUzs: number; partsPerRecipient: number };
    expect(estimate.recipientCount).toBe(1);
    expect(estimate.partsPerRecipient).toBe(1);
    expect(estimate.totalUzs).toBeGreaterThan(0);
    expect((await app.inject({ method: 'POST', url: `/api/admin/campaigns/${campaign.id}/start`, headers: auth.headers })).statusCode).toBe(409);

    const confirmed = await app.inject({ method: 'POST', url: '/api/admin/sms/confirm', headers: auth.headers, payload: { campaignId: campaign.id, expectedRecipientCount: estimate.recipientCount, expectedCostUzs: estimate.totalUzs } });
    expect(confirmed.statusCode).toBe(200);
    expect((await db.getCampaign(campaign.id))?.smsConfirmedAt).toBeInstanceOf(Date);
    expect((await app.inject({ method: 'POST', url: `/api/admin/campaigns/${campaign.id}/start`, headers: auth.headers })).statusCode).toBe(200);

    const unsafeTest = await app.inject({ method: 'POST', url: `/api/admin/campaigns/${campaign.id}/test`, headers: auth.headers, payload: { phone: '+998901009999' } });
    expect(unsafeTest.statusCode).toBe(409);
    const test = await app.inject({ method: 'POST', url: `/api/admin/campaigns/${campaign.id}/test`, headers: auth.headers, payload: { phone: '90 123 45 67' } });
    expect(test.statusCode).toBe(202);
    const sms = await db.listSmsMessages({ limit: 10 });
    expect(sms.some((row) => row.isTest && row.phone === '+998901234567' && row.userId === user.id && row.campaignId === null)).toBe(true);
    const testOnly = await db.getCampaignDeliverySummary(campaign.id);
    expect(testOnly.planned).toBe(0);

    const fakeApp = await buildApp({ db, cfg, smsApi: { balance: async () => ({ balance: 4321, raw: { fake: true } }) } });
    try {
      const fakeAuth = await session('campaign@test.uz', fakeApp);
      const balance = await fakeApp.inject({ method: 'GET', url: '/api/admin/sms/balance', headers: fakeAuth.headers });
      expect(balance.statusCode).toBe(200);
      expect((balance.json() as { balance: number; configured: boolean }).balance).toBe(4321);
      expect((balance.json() as { configured: boolean }).configured).toBe(true);
    } finally { await fakeApp.close(); }

    const reports = await app.inject({ method: 'GET', url: '/api/admin/sms/reports', headers: auth.headers });
    expect(reports.statusCode).toBe(200);
    expect((reports.json() as { messages: unknown[] }).messages.length).toBe(1);
    const campaignReports = await app.inject({ method: 'GET', url: `/api/admin/sms/reports?campaignId=${campaign.id}`, headers: auth.headers });
    expect((campaignReports.json() as { messages: unknown[] }).messages.length).toBe(0);
  });
});

describe('funnel and marketing source API', () => {
  it('returns a zero-filled stage list then includes StageProgress and organic start attribution', async () => {
    await admin();
    const auth = await session();
    const empty = await app.inject({ method: 'GET', url: '/api/admin/funnel?by=week&cohort=weekly', headers: auth.headers });
    expect(empty.statusCode).toBe(200);
    expect((empty.json() as { stages: unknown[]; hasData: boolean }).stages.length).toBeGreaterThan(40);
    expect((empty.json() as { hasData: boolean }).hasData).toBe(false);

    const start = await app.inject({ method: 'POST', url: '/api/bot/simulate', payload: { telegramId: 771003, text: '/start', updateId: 771003 } });
    expect(start.statusCode).toBe(200);
    const funnel = await app.inject({ method: 'GET', url: '/api/admin/funnel?by=day', headers: auth.headers });
    const rows = (funnel.json() as { stages: { stageKey: string; viewed: number }[]; hasData: boolean }).stages;
    expect((funnel.json() as { hasData: boolean }).hasData).toBe(true);
    expect(rows.find((row) => row.stageKey === 'START')?.viewed).toBe(1);
    const click = await app.inject({ method: 'POST', url: '/api/bot/simulate', payload: { telegramId: 771003, data: 'goto:EXPERIENCE_VIDEO', updateId: 771004 } });
    expect(click.statusCode).toBe(200);
    const sources = await app.inject({ method: 'GET', url: '/api/admin/analytics/sources', headers: auth.headers });
    expect((sources.json() as { sources: { source: string; starts: number }[] }).sources).toContainEqual({ source: 'organic', starts: 1, uniqueUsers: 1 });
    const buttons = await app.inject({ method: 'GET', url: '/api/admin/analytics/buttons', headers: auth.headers });
    expect((buttons.json() as { buttons: { action: string; clicks: number }[] }).buttons).toContainEqual(expect.objectContaining({ action: 'goto:EXPERIENCE_VIDEO', clicks: 1 }));
    const retention = await app.inject({ method: 'GET', url: '/api/admin/retention', headers: auth.headers });
    expect((retention.json() as { cohorts: { users: number }[] }).cohorts.reduce((sum, row) => sum + row.users, 0)).toBe(1);
  });
});
