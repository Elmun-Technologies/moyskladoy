import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryDatabase, SETTING_KEYS, TestMessenger } from '@app/shared';
import type { Database } from '@app/shared';
import { applySeed } from '@app/db';
import { BotEngine } from '../src/engine.js';

let db: Database;
let engine: BotEngine;
let seq = 99000;
const telegramId = 990001;

beforeEach(async () => {
  db = new MemoryDatabase();
  await applySeed(db, () => undefined);
  engine = new BotEngine(db, new TestMessenger(), { demoMode: true });
  seq++;
});

describe('stage and campaign attribution instrumentation', () => {
  it('records organic /start, stage viewed and StageProgress without changing the initial stage', async () => {
    await engine.handleStart({ updateId: seq++, chatId: telegramId, telegramId }, { firstName: 'Instrumented' });
    const user = await db.getUserByTelegramId(telegramId);
    expect(user).not.toBeNull();
    expect((await db.getState(user!.id))?.stage).toBe('START');
    const progress = await db.listStageProgress({ userIds: [user!.id] });
    expect(progress.some((row) => row.stageKey === 'START' && row.stepOrder === 0)).toBe(true);
    const events = await db.listAnalyticsEvents({ userIds: [user!.id], types: ['start_source', 'stage_viewed'] });
    expect(events.some((event) => event.type === 'start_source' && event.properties?.sourceKind === 'organic')).toBe(true);
    expect(events.some((event) => event.type === 'stage_viewed' && event.properties?.stageKey === 'START')).toBe(true);
    const firstEntry = progress.find((row) => row.stageKey === 'START')!;
    const completedAt = new Date(firstEntry.enteredAt.getTime() + 60_000);
    await db.completeStageProgress(user!.id, 'START', completedAt);
    await db.upsertStageProgress(user!.id, 'START', 0, new Date(completedAt.getTime() + 60_000));
    const revisited = (await db.listStageProgress({ userIds: [user!.id] })).find((row) => row.stageKey === 'START')!;
    expect(revisited.enteredAt).toEqual(firstEntry.enteredAt);
    expect(revisited.completedAt).toEqual(completedAt);
  });

  it('records a claimed site deep-link open, transfers only Telegram consent, and audits explicit SMS opt-in', async () => {
    const lead = await db.createSiteLead({ name: 'Site lead', phone: '+998901112233', utmSource: 'instagram', consentContact: true, consentMarketing: true, consentVersion: 'v1' });
    const token = await db.createLinkToken(lead.id, 24);
    await engine.handleStart({ updateId: seq++, chatId: telegramId, telegramId }, { firstName: 'Linked' }, token.token);
    const user = await db.getUserByTelegramId(telegramId);
    expect(user?.siteLeadId).toBe(lead.id);
    expect(await db.hasActiveConsent(user!.id, 'marketing')).toBe(true);
    expect(await db.hasActiveConsent(user!.id, 'sms_marketing')).toBe(false);
    const phone = await db.getUserPhone(user!.id);
    expect(phone?.phone).toBe('+998901112233');
    expect(phone?.smsConsent).toBe(false);
    const events = await db.listAnalyticsEvents({ userIds: [user!.id], types: ['link_opened', 'start_source'] });
    expect(events.some((event) => event.type === 'link_opened' && event.properties?.source === 'site_lead_link')).toBe(true);
    const startSource = events.find((event) => event.type === 'start_source');
    expect(startSource?.properties?.sourceKind).toBe('deep_link');
    expect(startSource?.properties?.source).toBe('site_lead_link');
    expect(JSON.stringify(startSource?.properties)).not.toContain(token.token);

    await engine.handleCallback({ updateId: seq++, chatId: telegramId, telegramId, callbackId: 'contact-choice', data: 'answer:contact=phone' });
    expect((await db.getState(user!.id))?.answers.sms_consent_asked).toBe('1');
    await engine.handleCallback({ updateId: seq++, chatId: telegramId, telegramId, callbackId: 'sms-opt-in', data: 'smsconsent:grant' });
    expect(await db.hasActiveConsent(user!.id, 'sms_marketing')).toBe(true);
    expect((await db.getUserPhone(user!.id))?.smsConsent).toBe(true);
    expect((await db.listAudit({ entity: 'user_phone' })).some((entry) => entry.action === 'sms.consent.grant')).toBe(true);
    await db.setSetting(SETTING_KEYS.lessonLink, 'https://example.test/lesson');
    await db.updateState(user!.id, { stage: 'LESSON_INTRO' });
    await engine.handleCallback({ updateId: seq++, chatId: telegramId, telegramId, callbackId: 'lesson-open', data: 'lesson:open' });
    const openedLinks = await db.listAnalyticsEvents({ userIds: [user!.id], types: ['link_opened'] });
    expect(openedLinks.some((event) => event.properties?.source === 'lesson')).toBe(true);
  });

  it('attributes an incoming reply once to the most recent campaign sent within 48 hours', async () => {
    await engine.handleStart({ updateId: seq++, chatId: telegramId, telegramId }, { firstName: 'Reply' });
    const user = await db.getUserByTelegramId(telegramId);
    const owner = await db.createAdmin({ email: 'reply@test.uz', passwordHash: 'x', name: 'Reply', role: 'admin', failedLogins: 0, lockedUntil: null, lastLoginAt: null });
    const campaign = await db.createCampaign({
      name: 'Reply attribution', channel: 'telegram', segmentJson: {}, templateText: 'Salom', buttonsJson: null, mediaId: null,
      status: 'running', scheduledFor: null, createdById: owner.id,
    });
    const row = await db.enqueueOutbox({ userId: user!.id, type: 'marketing', dedupeKey: 'reply-outbox', campaignId: campaign.id, payload: { text: 'Salom' }, scheduledFor: new Date() });
    await db.updateOutbox(row!.id, { status: 'sent', sentAt: new Date(Date.now() - 60 * 60_000) });

    await engine.handleText({ updateId: seq++, chatId: telegramId, telegramId }, 'Batafsil ayting');
    await engine.handleText({ updateId: seq++, chatId: telegramId, telegramId }, 'Yana savol');
    const replies = await db.listAnalyticsEvents({ userIds: [user!.id], types: ['campaign_reply'] });
    expect(replies).toHaveLength(1);
    expect(replies[0]?.properties?.campaignId).toBe(campaign.id);
  });
});
