import type { Campaign, CampaignRecipient, Database, EskizBatchMessage, SmsMessage, SmsMessageStatus } from '@app/shared';
import { isSmsWeeklyLimitAllowed, isWithinSendingWindow, isWithinSmsWindow, transitionCampaignStatus, toPlainText } from '@app/shared';

const DAY_MS = 86_400_000;
const REPORT_EVERY_MS = 60 * 60_000;

export interface SmsGateway {
  sendBatch(messages: EskizBatchMessage[]): Promise<{ id: string; status?: string[] }>;
  reportsByDispatch(dispatchId: string): Promise<{ user_sms_id?: string; status?: string; status_date?: string; total_price?: number }[]>;
}

export interface CampaignWorkerOptions {
  batchSize?: number;
  smsGateway?: SmsGateway | null;
  smsMaxAttempts?: number;
  smsBackoffMs?: number;
  log?: (level: 'info' | 'warn' | 'error', text: string) => void;
}

function campaignText(template: string, recipient: CampaignRecipient): string {
  const name = recipient.user.firstName?.trim() || 'do\'st';
  const stage = recipient.state?.stage ?? 'START';
  return toPlainText(template
    .replace(/\{\{?\s*ism\s*\}?\}/gi, name)
    .replace(/\{\{?\s*bosqich\s*\}?\}/gi, stage))
    .slice(0, 3900);
}

function campaignButtons(campaign: Campaign): { label: string; action: string }[] {
  const buttons = Array.isArray(campaign.buttonsJson) ? campaign.buttonsJson : [];
  const cleaned = buttons.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const button = entry as { label?: unknown; action?: unknown };
    if (typeof button.label !== 'string' || typeof button.action !== 'string') return [];
    if (button.action.length > 64 || button.label.length < 1 || button.label.length > 64) return [];
    return [{ label: button.label, action: button.action }];
  }).slice(0, 10);
  // Trackable callback provides link_opened/campaign_click attribution.
  if (!cleaned.some((b) => b.action === `campaign:${campaign.id}`)) cleaned.push({ label: 'Batafsil', action: `campaign:${campaign.id}` });
  return cleaned;
}

function skippedSms(recipient: CampaignRecipient, campaign: Campaign): Pick<SmsMessage, 'phone' | 'status' | 'lastError' | 'skippedReason'> | null {
  const phone = recipient.phone;
  if (!phone?.phone) return { phone: '', status: 'cancelled', lastError: 'skipped:no_phone', skippedReason: 'no_phone' };
  if (!phone.smsConsent) return { phone: phone.phone, status: 'cancelled', lastError: 'skipped:no_consent', skippedReason: 'no_consent' };
  void campaign;
  return null;
}

export class CampaignRunner {
  private readonly batchSize: number;

  constructor(private readonly db: Database, private readonly opts: CampaignWorkerOptions = {}) {
    this.batchSize = Math.min(500, Math.max(1, opts.batchSize ?? 500));
  }

  private log(level: 'info' | 'warn' | 'error', text: string): void {
    this.opts.log?.(level, text);
  }

  async process(now = new Date()): Promise<{ queued: number; completed: number }> {
    let queued = 0;
    let completed = 0;
    const campaigns = await this.db.listCampaigns(500);
    for (let campaign of campaigns) {
      // SMS dispatch requires an explicit admin confirmation of the latest cost estimate.
      if (campaign.channel === 'sms' && !campaign.smsConfirmedAt) continue;
      if (campaign.status === 'scheduled' && campaign.scheduledFor && campaign.scheduledFor <= now) {
        try {
          const next = transitionCampaignStatus('scheduled', 'running');
          campaign = await this.db.updateCampaign(campaign.id, { status: next, startsAt: now });
        } catch (error) {
          this.log('warn', `campaign ${campaign.id} could not start: ${(error as Error).message}`);
          continue;
        }
      }
      if (campaign.status !== 'running') continue;
      if (campaign.scheduledFor && campaign.scheduledFor > now) continue;
      // A running marketing campaign never bypasses its channel's Tashkent window.
      if (campaign.channel === 'telegram' && !this.isTelegramWindow(now)) continue;
      if (campaign.channel === 'sms' && !isWithinSmsWindow(now)) continue;

      const recipients = await this.db.listSegmentRecipients(campaign.segmentJson, campaign.channel, campaign.id, this.batchSize);
      if (recipients.length) {
        if (campaign.channel === 'telegram') queued += await this.queueTelegram(campaign, recipients, now);
        else queued += await this.queueSms(campaign, recipients);
        const stats = await this.db.getCampaignDeliverySummary(campaign.id);
        await this.db.updateCampaign(campaign.id, { statsCache: stats as unknown as Record<string, unknown> });
        continue;
      }
      const summary = await this.db.getCampaignDeliverySummary(campaign.id);
      await this.db.updateCampaign(campaign.id, { statsCache: summary as unknown as Record<string, unknown> });
      if (summary.pending === 0) {
        try {
          const status = transitionCampaignStatus('running', 'done');
          await this.db.updateCampaign(campaign.id, { status, endsAt: now });
          completed++;
        } catch (error) {
          this.log('warn', `campaign ${campaign.id} could not finish: ${(error as Error).message}`);
        }
      }
    }
    return { queued, completed };
  }

  private isTelegramWindow(now: Date): boolean {
    // Existing marketing rule (Asia/Tashkent 09:00-20:00), shared by sender too.
    return isWithinSendingWindow(now);
  }

  private async queueTelegram(campaign: Campaign, recipients: CampaignRecipient[], now: Date): Promise<number> {
    let created = 0;
    const media = campaign.mediaId ? await this.db.getMedia(campaign.mediaId) : null;
    for (const recipient of recipients) {
      const text = campaignText(campaign.templateText, recipient);
      if (!text) continue;
      const row = await this.db.enqueueOutbox({
        userId: recipient.user.id,
        type: 'marketing',
        dedupeKey: `campaign:${campaign.id}:${recipient.user.id}`,
        campaignId: campaign.id,
        payload: {
          text,
          buttons: campaignButtons(campaign),
          campaignId: campaign.id,
          ...(media?.fileId ? { mediaFileId: media.fileId, mediaType: media.isVideoNote ? 'video_note' : media.mimeType?.startsWith('image/') ? 'image' : 'video' } : {}),
        },
        scheduledFor: now,
      });
      if (row) created++;
    }
    return created;
  }

  private async queueSms(campaign: Campaign, recipients: CampaignRecipient[]): Promise<number> {
    let created = 0;
    for (const recipient of recipients) {
      const text = campaignText(campaign.templateText, recipient).slice(0, 3500);
      let skip = skippedSms(recipient, campaign);
      if (!skip && !(await this.db.hasActiveConsent(recipient.user.id, 'sms_marketing'))) {
        skip = { phone: recipient.phone?.phone ?? '', status: 'cancelled', lastError: 'skipped:no_consent', skippedReason: 'no_consent' };
      }
      const row = await this.db.createSmsMessage({
        campaignId: campaign.id,
        userId: recipient.user.id,
        phone: skip?.phone ?? recipient.phone?.phone ?? '',
        text,
        status: skip?.status ?? 'queued',
        externalId: null,
        lastError: skip?.lastError ?? null,
        skippedReason: skip?.skippedReason ?? null,
        sentAt: null,
        reportedAt: null,
        isTest: false,
      });
      if (row) created++;
    }
    return created;
  }
}

/** Eskiz queue worker: consent/window/2-per-7-day guards run again just before send. */
export class SmsSender {
  private readonly maxAttempts: number;
  private readonly backoffMs: number;

  constructor(private readonly db: Database, private readonly gateway: SmsGateway | null, private readonly opts: CampaignWorkerOptions = {}) {
    this.maxAttempts = opts.smsMaxAttempts ?? 5;
    this.backoffMs = opts.smsBackoffMs ?? 15 * 60_000;
  }

  private log(level: 'info' | 'warn' | 'error', text: string): void {
    this.opts.log?.(level, text);
  }

  async process(now = new Date(), limit = 5000): Promise<{ sent: number; skipped: number; failed: number; reported: number }> {
    const result = { sent: 0, skipped: 0, failed: 0, reported: 0 };
    await this.recoverStale(now);
    let queued = await this.db.listSmsMessages({ status: 'queued', limit: Math.min(limit, 5000) });
    queued = queued.filter((m) => m.attempts === 0 || now.getTime() - m.updatedAt.getTime() >= this.backoffMs);
    if (!queued.length) {
      result.reported = await this.syncReports(now);
      return result;
    }

    const eligible: SmsMessage[] = [];
    const recentByPhone = new Map<string, number>();
    for (const message of queued) {
      if (!isWithinSmsWindow(now)) continue;
      if (!message.isTest && message.campaignId) {
        const campaign = await this.db.getCampaign(message.campaignId);
        if (!campaign || campaign.status === 'cancelled' || campaign.status === 'done') {
          await this.db.updateSmsMessage(message.id, { status: 'cancelled', skippedReason: 'campaign_inactive', lastError: 'skipped:campaign_inactive' });
          result.skipped++;
          continue;
        }
        if (campaign.status !== 'running') continue;
      }
      const phone = message.userId ? await this.db.getUserPhone(message.userId) : null;
      const activeConsent = message.userId ? await this.db.hasActiveConsent(message.userId, 'sms_marketing') : false;
      if (!phone?.smsConsent || !activeConsent) {
        await this.db.updateSmsMessage(message.id, { status: 'cancelled', skippedReason: 'no_consent', lastError: 'skipped:no_consent' });
        result.skipped++;
        continue;
      }
      if (!phone.phone || phone.phone !== message.phone) {
        await this.db.updateSmsMessage(message.id, { status: 'cancelled', skippedReason: 'no_phone', lastError: 'skipped:no_phone' });
        result.skipped++;
        continue;
      }
      if (!/^\+998\d{9}$/.test(message.phone)) {
        await this.db.updateSmsMessage(message.id, { status: 'cancelled', skippedReason: 'no_phone', lastError: 'skipped:no_phone' });
        result.skipped++;
        continue;
      }
      let sentRecently = recentByPhone.get(message.phone);
      if (sentRecently === undefined) {
        sentRecently = await this.db.countSmsSentToPhoneSince(message.phone, new Date(now.getTime() - 7 * DAY_MS));
      }
      if (!isSmsWeeklyLimitAllowed(sentRecently)) {
        await this.db.updateSmsMessage(message.id, { status: 'cancelled', skippedReason: 'weekly_limit', lastError: 'skipped:weekly_limit' });
        result.skipped++;
        continue;
      }
      // Reserve this slot during the current batch so two queued messages
      // cannot both pass a count taken before either is recorded as sent.
      recentByPhone.set(message.phone, sentRecently + 1);
      eligible.push(message);
    }

    if (!eligible.length) {
      result.reported = await this.syncReports(now);
      return result;
    }
    // Do not consume retry attempts when credentials are absent; queued messages
    // remain auditable and can resume after SMS_USER/SMS_PASSWORD are configured.
    if (!this.gateway) return result;

    // Provider docs expose send-batch with user_sms_id; cap every request at 5,000.
    for (let offset = 0; offset < eligible.length; offset += 5000) {
      const batch = eligible.slice(offset, offset + 5000);
      for (const message of batch) await this.db.updateSmsMessage(message.id, { status: 'sending' });
      try {
        const response = await this.gateway.sendBatch(batch.map((m) => ({ user_sms_id: m.id, to: Number(m.phone.replace(/\D/g, '')), text: m.text })));
        for (const [index, message] of batch.entries()) {
          const perMessageStatus = response.status?.[index]?.toLowerCase();
          const immediate = ['delivered', 'delivrd'].includes(perMessageStatus ?? '') ? 'delivered' : 'sent';
          await this.db.updateSmsMessage(message.id, { status: immediate, externalId: `${response.id}:${message.id}`, sentAt: now, lastError: null, skippedReason: null });
          if (!message.isTest) {
            await this.db.recordEvent('campaign_sent', { userId: message.userId ?? undefined, properties: { campaignId: message.campaignId, channel: 'sms', smsMessageId: message.id } }).catch((e) => this.log('warn', `sms analytics failed: ${(e as Error).message.slice(0, 100)}`));
          } else {
            await this.db.recordEvent('campaign_test_sent', { userId: message.userId ?? undefined, properties: { campaignId: message.campaignId, channel: 'sms', smsMessageId: message.id } }).catch((e) => this.log('warn', `sms test analytics failed: ${(e as Error).message.slice(0, 100)}`));
          }
          await this.db.audit({ actorId: null, action: message.isTest ? 'sms.test.send' : 'sms.send', entity: 'sms_message', entityId: message.id, before: null, after: { campaignId: message.campaignId, externalId: response.id }, ip: null }).catch((e) => this.log('warn', `sms audit failed: ${(e as Error).message.slice(0, 100)}`));
          result.sent++;
        }
      } catch (error) {
        const reason = (error as Error).message.slice(0, 180);
        for (const message of batch) {
          const attempts = message.attempts + 1;
          const status: SmsMessageStatus = attempts >= this.maxAttempts ? 'failed' : 'queued';
          await this.db.updateSmsMessage(message.id, { status, attempts, lastError: reason });
          if (status === 'failed') result.failed++;
        }
        this.log('error', `Eskiz batch failed: ${reason}`);
      }
    }
    result.reported = await this.syncReports(now);
    return result;
  }

  private async recoverStale(now: Date): Promise<void> {
    const stale = await this.db.listSmsMessages({ status: 'sending', limit: 1000 });
    for (const row of stale) {
      if (now.getTime() - row.updatedAt.getTime() < 10 * 60_000) continue;
      const attempts = row.attempts + 1;
      await this.db.updateSmsMessage(row.id, { status: attempts >= this.maxAttempts ? 'failed' : 'queued', attempts, lastError: 'stale_sms_sending' });
    }
  }

  private async syncReports(now: Date): Promise<number> {
    if (!this.gateway) return 0;
    const sent = await this.db.listSmsMessages({ status: 'sent', limit: 5000 });
    const due = sent.filter((m) => m.externalId && (!m.reportedAt || now.getTime() - m.reportedAt.getTime() >= REPORT_EVERY_MS));
    const dispatchIds = [...new Set(due.map((m) => m.externalId!.split(':', 1)[0]!))];
    let updated = 0;
    for (const dispatchId of dispatchIds) {
      try {
        const reportRows = await this.gateway.reportsByDispatch(dispatchId);
        const byId = new Map(reportRows.map((r) => [r.user_sms_id, r]));
        for (const message of due.filter((m) => m.externalId?.startsWith(dispatchId + ':'))) {
          const report = byId.get(message.id);
          if (!report?.status) {
            await this.db.updateSmsMessage(message.id, { reportedAt: now });
            continue;
          }
          const raw = report.status.toUpperCase();
          const status: SmsMessageStatus | null = ['DELIVRD', 'DELIVERED'].includes(raw) ? 'delivered' : ['REJECTD', 'UNDELIV', 'FAILED', 'EXPIRED'].includes(raw) ? 'failed' : null;
          await this.db.updateSmsMessage(message.id, {
            ...(status ? { status, ...(status === 'failed' ? { lastError: `provider:${raw}` } : {}) } : {}),
            reportedAt: now,
          });
          await this.db.recordEvent('sms_report', { userId: message.userId ?? undefined, properties: { campaignId: message.campaignId, smsMessageId: message.id, status: raw, totalPrice: report.total_price ?? null } }).catch((e) => this.log('warn', `sms report event failed: ${(e as Error).message.slice(0, 100)}`));
          updated++;
        }
      } catch (error) {
        this.log('warn', `Eskiz report ${dispatchId} failed: ${(error as Error).message.slice(0, 140)}`);
      }
    }
    return updated;
  }
}

export function renderCampaignText(template: string, recipient: CampaignRecipient): string {
  return campaignText(template, recipient);
}
