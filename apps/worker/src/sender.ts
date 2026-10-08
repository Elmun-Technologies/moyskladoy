// ============================================================================
// OutboxSender: muddati kelgan xabarlarni yuboradi. Yuborishdan OLDIN
// har safar qayta tekshiriladi: bloklanganmi, rozilik bormi, sotuv
// bosqichidami, inson shug'ullanayotgami, Tashkent oynasi, kunlik limit.
// Xatoda: attempts+1, nextAttemptAt += backoff; limitdan oshsa failed.
// (Bu "exactly-once" degan da'vo EMAS - idempotent enqueue + holat kuzatuvi.)
// ============================================================================
import { DateTime } from 'luxon';
import type { Database, Messenger, OutboxMessage } from '@app/shared';
import { MARKETING_WINDOW, TASHKENT_ZONE, isWithinSendingWindow, toPlainText } from '@app/shared';

export interface SenderOptions {
  backoffMs?: number;
  maxAttempts?: number;
  marketingMaxPerDay?: number;
  log?: (level: 'info' | 'warn' | 'error', m: string) => void;
}

export interface ProcessResult {
  sent: number;
  cancelled: number;
  retried: number;
  failed: number;
  deferred: number;
}

function dayStartTashkent(now: Date): Date {
  return DateTime.fromJSDate(now, { zone: TASHKENT_ZONE }).startOf('day').toJSDate();
}

/** Keyingi ruxsat etilgan oynaning boshlanishi (agar hozir tashqarida bo'lsa). */
export function nextWindowStart(now: Date): Date | null {
  if (isWithinSendingWindow(now)) return null;
  const dt = DateTime.fromJSDate(now, { zone: 'Asia/Tashkent' });
  const [sh = 9] = MARKETING_WINDOW.start.split(':').map(Number);
  let target = dt.set({ hour: sh, minute: 0, second: 0, millisecond: 0 });
  if (target <= dt) target = target.plus({ days: 1 });
  return target.toJSDate();
}

export class OutboxSender {
  private readonly backoffMs: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly db: Database,
    private readonly msg: Messenger,
    private readonly opts: SenderOptions = {},
  ) {
    this.backoffMs = opts.backoffMs ?? 15 * 60 * 1000;
    this.maxAttempts = opts.maxAttempts ?? 5;
  }

  private log(l: 'info' | 'warn' | 'error', m: string): void {
    this.opts.log?.(l, m);
  }

  async processDue(now: Date = new Date(), limit = 50): Promise<ProcessResult> {
    const res: ProcessResult = { sent: 0, cancelled: 0, retried: 0, failed: 0, deferred: 0 };
    const due = await this.db.listDueOutbox(now, limit);
    for (const m of due) {
      try {
        await this.processOne(m, now, res);
      } catch (e) {
        this.log('error', `outbox ${m.id} processing error: ${(e as Error).message.slice(0, 160)}`);
        const attempts = m.attempts + 1;
        await this.db.updateOutbox(m.id, { attempts, status: attempts >= this.maxAttempts ? 'failed' : 'pending', nextAttemptAt: new Date(now.getTime() + this.backoffMs), lastError: toPlainText((e as Error).message).slice(0, 200) });
        attempts >= this.maxAttempts ? res.failed++ : res.retried++;
      }
    }
    return res;
  }

  private async processOne(m: OutboxMessage, now: Date, res: ProcessResult): Promise<void> {
    const user = await this.db.getUserById(m.userId);
    const state = await this.db.getState(m.userId);
    const isMarketingish = m.type === 'marketing' || m.type === 'reminder';
    if (isMarketingish) {
      if (!user || user.blockedAt) return this.cancel(m, res, 'user blocked');
      if (!state) return this.cancel(m, res, 'no state');
      if (state.humanHandling) return this.cancel(m, res, 'human handling');
      if (state.salesStatus === 'in_sales' || state.salesStatus === 'purchased') return this.cancel(m, res, 'sales stage');
      if (!(await this.db.hasActiveConsent(user.id, 'marketing'))) return this.cancel(m, res, 'no consent');
      const winStart = nextWindowStart(now);
      if (winStart) {
        await this.db.updateOutbox(m.id, { scheduledFor: winStart, nextAttemptAt: winStart });
        res.deferred++;
        return;
      }
      if (m.type === 'marketing') {
        const sentToday = await this.db.countOutboxSentToUserSince(user.id, 'marketing', dayStartTashkent(now));
        const max = this.opts.marketingMaxPerDay ?? 1;
        if (sentToday >= max) {
          const w = nextWindowStart(new Date(now.getTime() + 20 * 3600 * 1000)) ?? new Date(now.getTime() + 24 * 3600 * 1000);
          await this.db.updateOutbox(m.id, { scheduledFor: w, nextAttemptAt: w });
          res.deferred++;
          return;
        }
      }
    }
    // Matn: payload.blockKey -> approved blok; bo'lmasa payload.text.
    let text = typeof m.payload.text === 'string' ? m.payload.text : '';
    const blockKey = typeof m.payload.blockKey === 'string' ? m.payload.blockKey : null;
    let buttons: { label: string; action: string }[] = Array.isArray(m.payload.buttons) ? (m.payload.buttons as { label: string; action: string }[]) : [];
    let fileId: string | null = null;
    let mediaType: string | null = null;
    if (blockKey) {
      const block = await this.db.getBlockByKey(blockKey, 'approved');
      if (!block) return this.cancel(m, res, 'content missing/not approved: ' + blockKey);
      text = block.body;
      buttons = block.buttons.length ? block.buttons : buttons;
      fileId = block.mediaId;
      mediaType = block.mediaType;
    }
    const chatId = typeof m.payload.chatId === 'number' ? m.payload.chatId : user?.telegramId;
    if (!chatId || !text) return this.cancel(m, res, 'no chat or text');
    await this.db.updateOutbox(m.id, { status: 'sending' });
    const r = fileId && mediaType === 'video_note' ? await this.msg.sendVideoNote(chatId, fileId) : fileId && mediaType === 'video' ? await this.msg.sendVideo(chatId, fileId) : await this.msg.sendText(chatId, text, buttons);
    if (r.ok) {
      await this.db.updateOutbox(m.id, { status: 'sent', sentAt: new Date() });
      res.sent++;
      if (blockKey) await this.db.recordEvent('outbox_sent:' + blockKey, { userId: m.userId, dedupeKey: `outbox:${m.id}` });
      return;
    }
    if (r.ambiguous) {
      // Yetgan-yetmagani noma'lum: failed deb belgilamaymiz - qayta tekshiramiz.
      this.log('warn', `outbox ${m.id} ambiguous delivery result`);
    }
    const attempts = m.attempts + 1;
    const status = attempts >= this.maxAttempts ? 'failed' : 'pending';
    await this.db.updateOutbox(m.id, { status, attempts, nextAttemptAt: new Date(Date.now() + this.backoffMs), lastError: (r.error ?? 'send_failed').slice(0, 200) });
    if (status === 'failed') res.failed++;
    else res.retried++;
  }

  private async cancel(m: OutboxMessage, res: ProcessResult, reason: string): Promise<void> {
    await this.db.updateOutbox(m.id, { status: 'cancelled', lastError: reason.slice(0, 200) });
    res.cancelled++;
    this.log('info', `outbox ${m.id} cancelled: ${reason}`);
  }
}
