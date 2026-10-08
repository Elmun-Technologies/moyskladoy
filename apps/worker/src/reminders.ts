// ============================================================================
// Reminder/nurtime scheduler qoidalari (har tick'da):
//  - intro: tanishuv bosqichlarida 24+ soat turganlarga - kuniga 1 marta
//  - lesson: dars havolasini bosgan, lekin "ko'rdim" demagan - +24h
//  - offers: takliflar bosqichida 24+ soat - 1 marta
//  - review: xarid tasdiqlanganlardan 7 kun so'ng - HAYOTIDA BIR marta
//  - nurture: faol marketing roziligi bo'lganlarga dushanba/payshanba
//    `tip_*` bloklaridan - har tip har foydalanuvchiga 1 marta; tugasa - jim
// Barcha navbatlar idempotent (dedupeKey). Eski xabarlarsiz "cheksiz sikl" YO'Q.
// ============================================================================
import { DateTime } from 'luxon';
import type { Database } from '@app/shared';
import { INTRO_STAGES, LESSON_STAGES, OFFER_STAGES, TASHKENT_ZONE, tashkentDayKey } from '@app/shared';
import { nextWindowStart } from './sender.js';

const DAY_MS = 24 * 3600 * 1000;

export async function scheduleRules(db: Database, now: Date = new Date(), limitUsers = 1000): Promise<number> {
  let enqueued = 0;
  const dayKey = tashkentDayKey(now); // nurture uchun saqlanadi (kunlik cheklov)
  const { users } = await db.listUsers({ limit: limitUsers, offset: 0 });
  for (const u of users) {
    const st = u.state;
    if (!st || u.blockedAt) continue;
    if (st.humanHandling) continue;
    if (st.salesStatus === 'in_sales' || st.salesStatus === 'purchased') {
      // xarid tasdiqlangan - 1 marta fikr so'rash (oddiy holat: reminder_review event)
      if (st.salesStatus === 'purchased') {
        const sentBefore = await db.listEventsByType('outbox_sent:reminder_review', now, 1);
        void sentBefore;
        const reviewDedup = `reminder:${u.id}:review:once`;
        const doneEvent = (await db.listEvents(u.id, 200)).some((e) => e.type === 'review_requested');
        if (!doneEvent && st.updatedAt.getTime() < now.getTime() - 7 * DAY_MS) {
          const r = await db.enqueueOutbox({ userId: u.id, type: 'reminder', dedupeKey: reviewDedup, payload: { blockKey: 'reminder_review' }, scheduledFor: clampWindow(now) });
          if (r) { await db.recordEvent('review_requested', { userId: u.id, dedupeKey: `review:${u.id}` }); enqueued++; }
        }
      }
      continue;
    }
    if (!(await db.hasActiveConsent(u.id, 'marketing'))) continue;
    const idleMs = now.getTime() - st.updatedAt.getTime();
    // 1) intro
    if ((INTRO_STAGES as readonly string[]).includes(st.stage) && idleMs >= DAY_MS) {
      enqueued += await push(db, u.id, 'intro', dayKey, 'reminder_intro', now);
    } else if ((LESSON_STAGES as readonly string[]).includes(st.stage) && st.lessonLinkClickedAt && !st.lessonWatchedAt && now.getTime() - st.lessonLinkClickedAt.getTime() >= DAY_MS) {
      enqueued += await push(db, u.id, 'lesson', dayKey, 'reminder_lesson', now);
    } else if ((OFFER_STAGES as readonly string[]).includes(st.stage) && idleMs >= DAY_MS) {
      enqueued += await push(db, u.id, 'offers', dayKey, 'reminder_offers', now);
    } else {
      // nurture: dushanba(1)/payshanba(4), 5+ kundan keyin
      const dow = DateTime.fromJSDate(now, { zone: TASHKENT_ZONE }).weekday;
      if ((dow === 1 || dow === 4) && idleMs >= 5 * DAY_MS) {
        const tips = (await db.listBlocks({ status: 'approved' })).filter((b) => b.key.startsWith('tip_'));
        const userEvents = await db.listEvents(u.id, 500);
        const seen = new Set(userEvents.filter((e) => e.type === 'tip_sent').map((e) => (e.payload as { key?: string } | null)?.key));
        const next = tips.find((t) => !seen.has(t.key));
        if (next) {
          const r = await db.enqueueOutbox({ userId: u.id, type: 'marketing', dedupeKey: `reminder:${u.id}:tip:${next.key}`, payload: { blockKey: next.key }, scheduledFor: clampWindow(now) });
          if (r) { await db.appendEvent(u.id, 'tip_sent', { key: next.key }); enqueued++; }
        }
      }
    }
  }
  return enqueued;
}

async function push(db: Database, userId: string, kind: string, _dayKey: string, blockKey: string, now: Date): Promise<number> {
  // Spec: intro/lesson/offers eslatmalari UMRI BO'YI BIR MARTA (keyin jim).
  const r = await db.enqueueOutbox({ userId, type: 'reminder', dedupeKey: `reminder:${userId}:${kind}:once`, payload: { blockKey }, scheduledFor: clampWindow(now) });
  return r ? 1 : 0;
}

function clampWindow(now: Date): Date {
  const w = nextWindowStart(now);
  return w ?? new Date(now.getTime() + 60 * 1000);
}
