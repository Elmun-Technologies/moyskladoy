import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryDatabase, TestMessenger, isWithinSendingWindow } from '@app/shared';
import type { Database } from '@app/shared';
import { applySeed } from '@app/db';
import { OutboxSender, nextWindowStart } from '../src/sender.js';
import { scheduleRules } from '../src/reminders.js';

let db: Database;
let msg: TestMessenger;
let sender: OutboxSender;

// 15:00 Toshkent = 10:00 UTC (oyna ichida)
const IN_WINDOW = new Date('2026-01-15T10:00:00Z');
// 22:00 Toshkent = 17:00 UTC (oyna tashqarisida)
const OUT_WINDOW = new Date('2026-01-15T17:00:00Z');

async function makeUser(telegramId: number, stage: string, createdAtAgoMs = 25 * 3600 * 1000): Promise<string> {
  const u = await db.upsertTelegramUser({ telegramId, firstName: 'U' + telegramId });
  const st = await db.createState(u.id, stage);
  await db.updateState(u.id, { updatedAt: new Date(IN_WINDOW.getTime() - createdAtAgoMs) });
  void st;
  return u.id;
}

beforeEach(async () => {
  db = new MemoryDatabase();
  await applySeed(db, () => undefined);
  msg = new TestMessenger();
  sender = new OutboxSender(db, msg, { backoffMs: 900000, maxAttempts: 5, marketingMaxPerDay: 1 });
});

describe('reminder scheduling', () => {
  it('1. intro 24+ soat + rozilik -> kuniga bitta eslatma (dedupe)', async () => {
    const uid = await makeUser(501, 'START');
    await db.grantConsent(uid, 'marketing', 'v1');
    const n1 = await scheduleRules(db, IN_WINDOW);
    expect(n1).toBe(1);
    const n2 = await scheduleRules(db, IN_WINDOW);
    expect(n2).toBe(0); // shu kun uchun dedupe
  });

  it('2. rozilik yo\'q - eslatma navbatga qo\'yilmaydi', async () => {
    await makeUser(502, 'START');
    expect(await scheduleRules(db, IN_WINDOW)).toBe(0);
  });

  it('3. yuborishdan oldin qayta tekshiruv: revoke bo\'lsa - cancel', async () => {
    const uid = await makeUser(503, 'START');
    await db.grantConsent(uid, 'marketing', 'v1');
    await db.enqueueOutbox({ userId: uid, type: 'reminder', dedupeKey: 'r-x', payload: { blockKey: 'reminder_intro' }, scheduledFor: new Date(IN_WINDOW.getTime() - 1000) });
    await db.revokeConsent(uid, 'marketing'); // yuborishdan oldin bekor qilindi
    const r = await sender.processDue(IN_WINDOW);
    expect(r.cancelled).toBe(1);
    expect(r.sent).toBe(0);
  });

  it('4. sotuv bosqichi/xarid - reminderlar to\'xtaydi', async () => {
    const uid = await makeUser(504, 'START');
    await db.grantConsent(uid, 'marketing', 'v1');
    await db.updateState(uid, { salesStatus: 'in_sales' });
    await db.enqueueOutbox({ userId: uid, type: 'reminder', dedupeKey: 'r-s', payload: { blockKey: 'reminder_intro' }, scheduledFor: new Date(IN_WINDOW.getTime() - 1000) });
    const r = await sender.processDue(IN_WINDOW);
    expect(r.cancelled).toBe(1);
  });

  it('5. oyna tashqarisida - yuborilmaydi, ertangi oynaga qoldiriladi', async () => {
    const uid = await makeUser(505, 'START');
    await db.grantConsent(uid, 'marketing', 'v1');
    expect(isWithinSendingWindow(OUT_WINDOW)).toBe(false);
    await db.enqueueOutbox({ userId: uid, type: 'marketing', dedupeKey: 'm-w', payload: { blockKey: 'tip_cash_reconciliation' }, scheduledFor: OUT_WINDOW });
    const r = await sender.processDue(OUT_WINDOW);
    expect(r.deferred).toBe(1);
    const items = await db.listOutbox({ userId: uid });
    const item = items[0]!;
    expect(item.status).toBe('pending');
    expect(item.scheduledFor.getTime()).toBeGreaterThan(OUT_WINDOW.getTime());
    expect(isWithinSendingWindow(item.scheduledFor)).toBe(true);
  });

  it('6. xatoda retry/backoff, limitda failed', async () => {
    const uid = await makeUser(506, 'START');
    await db.enqueueOutbox({ userId: uid, type: 'notification', dedupeKey: 'n-f', payload: { chatId: 999, text: 'salom' }, scheduledFor: new Date(IN_WINDOW.getTime() - 1000) });
    msg.nextResult = { ok: false, error: 'telegram 500', ambiguous: false };
    const r1 = await sender.processDue(IN_WINDOW);
    expect(r1.retried).toBe(1);
    let item = (await db.listOutbox({ userId: uid }))[0]!;
    expect(item.attempts).toBe(1);
    expect(item.nextAttemptAt!.getTime() - IN_WINDOW.getTime()).toBeGreaterThanOrEqual(900000 - 5000);
    for (let i = 0; i < 4; i++) {
      await db.updateOutbox(item.id, { attempts: 4 + i, nextAttemptAt: new Date(IN_WINDOW.getTime() - 1000), scheduledFor: new Date(IN_WINDOW.getTime() - 2000) });
      msg.nextResult = { ok: false, error: 'still down', ambiguous: false };
      await sender.processDue(IN_WINDOW);
      item = (await db.listOutbox({ userId: uid }))[0]!;
    }
    expect(item.status).toBe('failed');
  });

  it('7. nurture: har tip bir marta; tugaganida jim', async () => {
    const uid = await makeUser(507, 'MENU', 6 * 24 * 3600 * 1000);
    await db.grantConsent(uid, 'marketing', 'v1');
    // 4 ta tip bor - 4 hafta mobaynida 4 marta, keyin 0
    let total = 0;
    const Mondays = ['2026-01-19T10:00:00Z', '2026-01-26T10:00:00Z', '2026-02-02T10:00:00Z', '2026-02-09T10:00:00Z', '2026-02-16T10:00:00Z'].map((d) => new Date(d));
    for (const mon of Mondays) {
      await db.updateState(uid, { updatedAt: new Date(mon.getTime() - 6 * 24 * 3600 * 1000) });
      total += await scheduleRules(db, mon);
      // yuborib yuboramiz (oyna ichida)
      await sender.processDue(mon);
    }
    expect(total).toBe(4);
  });

  it('8. nextWindowStart: oyna ichida null; tashqarida ertangi 09:00 Toshkent', () => {
    expect(nextWindowStart(IN_WINDOW)).toBeNull();
    const w = nextWindowStart(OUT_WINDOW);
    expect(w).not.toBeNull();
    expect(isWithinSendingWindow(w!)).toBe(true);
    expect(w!.getTime()).toBeGreaterThan(OUT_WINDOW.getTime());
  });
});
