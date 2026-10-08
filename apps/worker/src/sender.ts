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
  telegramThrottleMs?: number;
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
  private lastTelegramSentAt = 0;

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

  /**
   * Worker 'sending' holatida o'lsa - xabar shu yerda qotib qolardi.
   * Har tick boshida eskirgan (staleMs+) 'sending' yozuvlarini topib,
   * pending'ga qaytaramiz (attempts+1 bilan - zaqor xabar cheksiz aylanmaydi).
   * E'tibor: bu "duplicate bo'lishi mumkin" ehtimolini ochiq qoldiradi -
   * biz hech qachon exactly-once deb da'vo qilmaymiz.
   */
  async recoverStaleSending(now: Date, staleMs = 10 * 60 * 1000): Promise<number> {
    let recovered = 0;
    const items = await this.db.listOutbox({ status: 'sending', limit: 100 });
    for (const m of items) {
      const age = now.getTime() - (m.scheduledFor?.getTime?.() ?? 0);
      if (age < staleMs) continue;
      const attempts = m.attempts + 1;
      await this.db.updateOutbox(m.id, {
        status: attempts >= this.maxAttempts ? 'failed' : 'pending',
        attempts,
        scheduledFor: now,
        nextAttemptAt: now,
        lastError: 'stale_sending_recovered',
      });
      recovered++;
    }
    if (recovered) this.log('warn', `recovered ${recovered} stale 'sending' outbox rows`);
    return recovered;
  }

  private async waitForTelegramSlot(): Promise<void> {
    const spacing = Math.max(0, this.opts.telegramThrottleMs ?? 50);
    const wait = Math.max(0, this.lastTelegramSentAt + spacing - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastTelegramSentAt = Date.now();
  }

  private retryDelay(error: string): number {
    const is429 = /(?:429|too many requests)/i.test(error);
    const retryAfter = /retry[_ ]after\s*[:=]?\s*(\d+)/i.exec(error);
    const providerDelay = retryAfter ? Number(retryAfter[1]) * 1000 : 0;
    return is429 ? Math.max(this.backoffMs * 2, providerDelay) : this.backoffMs;
  }

  async processDue(now: Date = new Date(), limit = 50): Promise<ProcessResult> {
    const res: ProcessResult = { sent: 0, cancelled: 0, retried: 0, failed: 0, deferred: 0 };
    await this.recoverStaleSending(now);
    const due = await this.db.listDueOutbox(now, limit);
    for (const m of due) {
      try {
        await this.processOne(m, now, res);
      } catch (e) {
        this.log('error', `outbox ${m.id} processing error: ${(e as Error).message.slice(0, 160)}`);
        const attempts = m.attempts + 1;
        const retryAt = new Date(now.getTime() + this.retryDelay((e as Error).message));
        await this.db.updateOutbox(m.id, { attempts, status: attempts >= this.maxAttempts ? 'failed' : 'pending', scheduledFor: retryAt, nextAttemptAt: retryAt, lastError: toPlainText((e as Error).message).slice(0, 200) });
        attempts >= this.maxAttempts ? res.failed++ : res.retried++;
      }
    }
    return res;
  }

  private async processOne(m: OutboxMessage, now: Date, res: ProcessResult): Promise<void> {
    if (m.campaignId) {
      const campaign = await this.db.getCampaign(m.campaignId);
      if (!campaign || campaign.status === 'cancelled' || campaign.status === 'done') {
        return this.cancel(m, res, 'campaign inactive');
      }
      if (campaign.status !== 'running') {
        const retryAt = new Date(now.getTime() + 60_000);
        await this.db.updateOutbox(m.id, { scheduledFor: retryAt, nextAttemptAt: retryAt });
        res.deferred++;
        return;
      }
    }
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
    } else if (typeof m.payload.mediaFileId === 'string') {
      fileId = m.payload.mediaFileId;
      mediaType = typeof m.payload.mediaType === 'string' ? m.payload.mediaType : null;
    }
    const chatId = typeof m.payload.chatId === 'number' ? m.payload.chatId : user?.telegramId;
    if (!chatId || !text) return this.cancel(m, res, 'no chat or text');
    await this.db.updateOutbox(m.id, { status: 'sending' });
    await this.waitForTelegramSlot();
    const r = fileId && mediaType === 'video_note' ? await this.msg.sendVideoNote(chatId, fileId, buttons)
      : fileId && mediaType === 'video' ? await this.msg.sendVideo(chatId, fileId, buttons)
        : fileId && mediaType === 'image' ? await this.msg.sendPhoto(chatId, fileId, text, buttons)
          : await this.msg.sendText(chatId, text, buttons);
    if (r.ok) {
      const sentAt = new Date();
      await this.db.updateOutbox(m.id, { status: 'sent', sentAt });
      res.sent++;
      if (blockKey) await this.db.recordEvent('outbox_sent:' + blockKey, { userId: m.userId, dedupeKey: `outbox:${m.id}` }).catch((e) => this.log('warn', `outbox analytics failed: ${(e as Error).message.slice(0, 120)}`));
      if (m.campaignId) {
        await this.db.recordEvent('campaign_sent', { userId: m.userId, properties: { campaignId: m.campaignId, outboxId: m.id, sentAt: sentAt.toISOString() } }).catch((e) => this.log('warn', `campaign analytics failed: ${(e as Error).message.slice(0, 120)}`));
        await this.db.audit({ actorId: null, action: 'campaign.send', entity: 'campaign', entityId: m.campaignId, before: null, after: { outboxId: m.id, userId: m.userId }, ip: null }).catch((e) => this.log('warn', `campaign audit failed: ${(e as Error).message.slice(0, 120)}`));
      }
      return;
    }
    if (r.ambiguous) {
      // Yetgan-yetmagani noma'lum: failed deb belgilamaymiz - qayta tekshiramiz.
      this.log('warn', `outbox ${m.id} ambiguous delivery result`);
    }
    const attempts = m.attempts + 1;
    const status = attempts >= this.maxAttempts ? 'failed' : 'pending';
    const retryAt = new Date(now.getTime() + this.retryDelay(r.error ?? 'send_failed'));
    await this.db.updateOutbox(m.id, { status, attempts, scheduledFor: retryAt, nextAttemptAt: retryAt, lastError: (r.error ?? 'send_failed').slice(0, 200) });
    if (status === 'failed') res.failed++;
    else res.retried++;
  }

  private async cancel(m: OutboxMessage, res: ProcessResult, reason: string): Promise<void> {
    let skippedReason: string | null = null;
    if (/blocked/i.test(reason)) skippedReason = 'blocked';
    else if (/consent/i.test(reason)) skippedReason = 'consent';
    else if (/sales|human handling|no state/i.test(reason)) skippedReason = 'not_eligible';
    await this.db.updateOutbox(m.id, { status: 'cancelled', lastError: reason.slice(0, 200), skippedReason });
    res.cancelled++;
    this.log('info', `outbox ${m.id} cancelled: ${reason}`);
  }
}
