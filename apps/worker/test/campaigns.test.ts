import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryDatabase, TestMessenger, isWithinSmsWindow } from '@app/shared';
import type { Database, EskizBatchMessage } from '@app/shared';
import { CampaignRunner, SmsSender, type SmsGateway } from '../src/campaigns.js';
import { OutboxSender } from '../src/sender.js';

const IN_WINDOW = new Date('2026-01-15T10:00:00Z'); // 15:00 Asia/Tashkent
const OUT_WINDOW = new Date('2026-01-15T17:00:00Z'); // 22:00 Asia/Tashkent
let db: Database;

async function makeAdmin(): Promise<string> {
  return (await db.createAdmin({ email: 'worker@test.uz', passwordHash: 'x', name: 'Worker', role: 'admin', failedLogins: 0, lockedUntil: null, lastLoginAt: null })).id;
}
async function campaign(input: { channel: 'telegram' | 'sms'; status?: 'draft' | 'scheduled' | 'running' | 'paused' | 'done' | 'cancelled'; scheduledFor?: Date | null; smsConfirmedAt?: Date | null; filters?: Record<string, unknown> }) {
  return db.createCampaign({
    name: 'Test campaign', channel: input.channel, segmentJson: input.filters ?? {}, templateText: 'Salom, {{ism}}!',
    buttonsJson: null, mediaId: null, status: input.status ?? 'running', scheduledFor: input.scheduledFor ?? null,
    smsConfirmedAt: input.smsConfirmedAt ?? null, createdById: await makeAdmin(),
  });
}

beforeEach(() => { db = new MemoryDatabase(); });

describe('Telegram campaign worker', () => {
  it('creates idempotent outbox rows and records live delivery + audit events', async () => {
    const user = await db.upsertTelegramUser({ telegramId: 881001, firstName: 'Sardor' });
    await db.createState(user.id, 'START');
    await db.grantConsent(user.id, 'marketing', 'v1');
    const camp = await campaign({ channel: 'telegram', filters: { stageKey: 'START' } });
    const runner = new CampaignRunner(db, { batchSize: 10 });

    const [first, concurrent] = await Promise.all([runner.process(IN_WINDOW), runner.process(IN_WINDOW)]);
    const second = await runner.process(IN_WINDOW);
    expect(first.queued + concurrent.queued).toBe(1);
    expect(second.queued).toBe(0);
    const rows = await db.listOutbox({ campaignId: camp.id, limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dedupeKey).toBe(`campaign:${camp.id}:${user.id}`);

    const messenger = new TestMessenger();
    const sender = new OutboxSender(db, messenger, { telegramThrottleMs: 0 });
    const delivered = await sender.processDue(IN_WINDOW);
    expect(delivered.sent).toBe(1);
    expect(messenger.last(user.telegramId)?.text).toContain('Sardor');
    expect((await db.getCampaignDeliverySummary(camp.id)).sent).toBe(1);
    expect((await db.listAnalyticsEvents({ campaignId: camp.id, types: ['campaign_sent'] })).length).toBe(1);
    expect((await db.listAudit({ entity: 'campaign' })).some((entry) => entry.action === 'campaign.send')).toBe(true);
  });

  it('enforces the existing consent and one-per-Tashkent-day limits across campaigns', async () => {
    const user = await db.upsertTelegramUser({ telegramId: 881002, firstName: 'Dilnoza' });
    await db.createState(user.id, 'START');
    await db.grantConsent(user.id, 'marketing', 'v1');
    const noConsent = await db.upsertTelegramUser({ telegramId: 881003, firstName: 'No consent' });
    await db.createState(noConsent.id, 'START');
    const first = await campaign({ channel: 'telegram', filters: { stageKey: 'START' } });
    const second = await campaign({ channel: 'telegram', filters: { stageKey: 'START' } });
    const runner = new CampaignRunner(db);
    await runner.process(IN_WINDOW);
    const messenger = new TestMessenger();
    const sender = new OutboxSender(db, messenger, { telegramThrottleMs: 0 });
    const result = await sender.processDue(IN_WINDOW);
    expect(result.sent).toBe(1);
    expect(result.cancelled).toBe(0); // non-consenting users are excluded before campaign queueing
    expect(result.deferred).toBe(1); // second campaign is deferred for the opted-in user
    const firstUserRow = (await db.listOutbox({ campaignId: first.id, userId: user.id, limit: 10 }))[0];
    expect(firstUserRow?.status).toBe('sent');
    const secondUserRow = (await db.listOutbox({ campaignId: second.id, userId: user.id, limit: 10 }))[0];
    expect(secondUserRow?.status).toBe('pending');
    const noConsentRows = await db.listOutbox({ userId: noConsent.id, limit: 10 });
    expect(noConsentRows).toHaveLength(0);
  });
});

describe('SMS campaigns and fake Eskiz transport', () => {
  it('does not start a scheduled SMS campaign before explicit estimate confirmation', async () => {
    const user = await db.upsertTelegramUser({ telegramId: 882001, firstName: 'Kamola' });
    await db.createState(user.id, 'OFFERS');
    await db.upsertUserPhone(user.id, '+998901234567', { verified: true, smsConsent: true });
    await db.grantConsent(user.id, 'sms_marketing', 'v1');
    const camp = await campaign({ channel: 'sms', status: 'scheduled', scheduledFor: IN_WINDOW });
    const runner = new CampaignRunner(db);
    await runner.process(IN_WINDOW);
    expect((await db.getCampaign(camp.id))?.status).toBe('scheduled');
    expect((await db.listSmsMessages({ campaignId: camp.id, limit: 10 })).length).toBe(0);

    await db.updateCampaign(camp.id, { smsConfirmedAt: new Date(IN_WINDOW.getTime() - 60_000) });
    const [result, concurrent] = await Promise.all([runner.process(IN_WINDOW), runner.process(IN_WINDOW)]);
    expect(result.queued + concurrent.queued).toBe(1);
    expect((await db.getCampaign(camp.id))?.status).toBe('running');
    const rows = await db.listSmsMessages({ campaignId: camp.id, limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('queued');
  });

  it('sends no more than two per phone in seven days, enforces the window and syncs fake reports', async () => {
    expect(isWithinSmsWindow(IN_WINDOW)).toBe(true);
    expect(isWithinSmsWindow(OUT_WINDOW)).toBe(false);
    const user = await db.upsertTelegramUser({ telegramId: 882002, firstName: 'Jasur' });
    await db.createState(user.id, 'START');
    await db.upsertUserPhone(user.id, '+998901112233', { verified: true, smsConsent: true });
    await db.grantConsent(user.id, 'sms_marketing', 'v1');
    const camps = [await campaign({ channel: 'sms', smsConfirmedAt: IN_WINDOW }), await campaign({ channel: 'sms', smsConfirmedAt: IN_WINDOW }), await campaign({ channel: 'sms', smsConfirmedAt: IN_WINDOW })];
    const messageIds: string[] = [];
    for (const camp of camps) {
      const message = await db.createSmsMessage({ campaignId: camp.id, userId: user.id, phone: '+998901112233', text: 'SMS xabar', status: 'queued', externalId: null, lastError: null, skippedReason: null, sentAt: null, reportedAt: null, isTest: false });
      messageIds.push(message!.id);
    }
    const calls: EskizBatchMessage[][] = [];
    const fake: SmsGateway = {
      sendBatch: async (messages) => { calls.push(messages); return { id: `dispatch-${calls.length}`, status: messages.map(() => 'sent') }; },
      reportsByDispatch: async (dispatchId) => calls[Number(dispatchId.split('-')[1])! - 1]!.map((message) => ({ user_sms_id: message.user_sms_id, status: 'DELIVRD', status_date: IN_WINDOW.toISOString() })),
    };
    const sender = new SmsSender(db, fake);
    const result = await sender.process(IN_WINDOW);
    expect(result.sent).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.reported).toBe(2);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(2);
    const rows = await db.listSmsMessages({ limit: 10 });
    expect(rows.filter((row) => row.status === 'delivered')).toHaveLength(2);
    expect(messageIds).toHaveLength(3);
    expect(rows.some((row) => row.skippedReason === 'weekly_limit')).toBe(true);
    expect((await db.listAnalyticsEvents({ types: ['sms_report'] })).length).toBe(2);

    // A later delivery failure does not release the weekly dispatch quota.
    const delivered = rows.find((row) => row.status === 'delivered')!;
    await db.updateSmsMessage(delivered.id, { status: 'failed' });
    expect(await db.countSmsSentToPhoneSince('+998901112233', new Date(IN_WINDOW.getTime() - 7 * 86_400_000))).toBe(2);
    const test = await db.createSmsMessage({ campaignId: null, userId: user.id, phone: '+998901112233', text: 'Test', status: 'queued', externalId: null, lastError: null, skippedReason: null, sentAt: null, reportedAt: null, isTest: true });
    const capped = await sender.process(IN_WINDOW);
    expect(capped.sent).toBe(0);
    expect(capped.skipped).toBe(1);
    expect((await db.getSmsMessage(test!.id))?.skippedReason).toBe('weekly_limit');
  });

  it('keeps queued SMS auditable while provider credentials are absent', async () => {
    const user = await db.upsertTelegramUser({ telegramId: 882003 });
    await db.createState(user.id, 'START');
    await db.upsertUserPhone(user.id, '+998909998877', { smsConsent: true });
    await db.grantConsent(user.id, 'sms_marketing', 'v1');
    const camp = await campaign({ channel: 'sms', smsConfirmedAt: IN_WINDOW });
    const message = await db.createSmsMessage({ campaignId: camp.id, userId: user.id, phone: '+998909998877', text: 'Salom', status: 'queued', externalId: null, lastError: null, skippedReason: null, sentAt: null, reportedAt: null, isTest: false });
    const result = await new SmsSender(db, null).process(IN_WINDOW);
    expect(result.failed).toBe(0);
    expect((await db.getSmsMessage(message!.id))?.status).toBe('queued');
    expect((await db.getSmsMessage(message!.id))?.attempts).toBe(0);
  });
});
