import { describe, expect, it } from 'vitest';
import { maskPhone, maskToken, toPlainText, escapeHtml } from '../src/sanitize.js';
import { isWithinSendingWindow, tashkentDayKey, hoursAgo } from '../src/time.js';
import { MemoryDatabase } from '../src/testing/memory-db.js';

describe('sanitize', () => {
  it("maskPhone yashiradi, token trim qilinadi, boshqaruv belgilari ochadi", () => {
    expect(maskPhone('+998901234567')).toMatch(/\*+4567$/);
    expect(maskToken('123456:AAAAAA-BBBBBB')).toContain('***');
    expect(toPlainText('salom\u0000\u0007')).toBe('salom');
    expect(escapeHtml('<b>&')).toBe('&lt;b&gt;&amp;');
  });
});

describe('time', () => {
  it('Toshkent oynasi va kun kaliti', () => {
    expect(isWithinSendingWindow(new Date('2026-01-15T04:00:00Z'))).toBe(true);
    expect(isWithinSendingWindow(new Date('2026-01-15T03:00:00Z'))).toBe(false);
    expect(tashkentDayKey(new Date('2026-01-14T20:00:00Z'))).toBe('2026-01-15');
    expect(hoursAgo(new Date('2026-01-15T12:00:00Z'), 3).toISOString()).toBe('2026-01-15T09:00:00.000Z');
  });
});

describe('MemoryDatabase primitivelari', () => {
  it('markUpdateProcessed dublikatni ushlaydi; outbox dedupe; claim atomik', async () => {
    const db = new MemoryDatabase();
    expect(await db.markUpdateProcessed(1)).toBe(true);
    expect(await db.markUpdateProcessed(1)).toBe(false);
    const u = await db.upsertTelegramUser({ telegramId: 42 });
    const o1 = await db.enqueueOutbox({ userId: u.id, type: 'reminder', dedupeKey: 'k1', payload: {}, scheduledFor: new Date() });
    const o2 = await db.enqueueOutbox({ userId: u.id, type: 'reminder', dedupeKey: 'k1', payload: {}, scheduledFor: new Date() });
    expect(o1).not.toBeNull();
    expect(o2).toBeNull();
    const lead = await db.createSalesLead({ userId: u.id, contactConsent: true });
    const a = db.claimSalesLead(lead.id, 'adminA');
    const b = db.claimSalesLead(lead.id, 'adminB');
    const [ra, rb] = await Promise.all([a, b]);
    expect([ra.ok, rb.ok].filter(Boolean).length).toBe(1);
  });
});
