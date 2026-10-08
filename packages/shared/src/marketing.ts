import { DateTime } from 'luxon';
import type { CampaignStatus, SegmentFilters, StageProgress, TelegramUser, UserPhone, ConversationState, CampaignRecipient } from './types.js';

export interface SegmentCandidate {
  user: TelegramUser;
  state?: ConversationState | null;
  stageProgress?: StageProgress[];
  marketingConsent?: boolean;
  smsMarketingConsent?: boolean;
  phone?: UserPhone | null;
  leadStatuses?: string[];
  viewedProductIds?: string[];
}

function dateValue(value: string | Date | undefined): number | null {
  if (value === undefined) return null;
  const n = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(n) ? n : null;
}

function inDateRange(value: Date | null, range: SegmentFilters['lastActiveBetween']): boolean {
  if (!range) return true;
  if (!value) return false;
  const from = dateValue(range.from);
  const to = dateValue(range.to);
  return (from === null || value.getTime() >= from) && (to === null || value.getTime() <= to);
}

/**
 * Segment filtrlari AND bilan tekshiriladi. Kampaniya jo'natishda Telegram
 * bloklagan akkaunt hech qachon mos kelmaydi, hatto blocked=true bo'lsa ham.
 */
export function matchesSegment(candidate: SegmentCandidate, filters: SegmentFilters = {}, channel: 'telegram' | 'sms' = 'telegram', now = new Date()): boolean {
  const { user } = candidate;
  // Campaign audience preview and generation include only recipients legally
  // eligible for the selected channel; sender checks again immediately pre-send.
  if (user.blockedAt || filters.blocked === true) return false;
  if (channel === 'telegram' && !candidate.marketingConsent) return false;
  if (channel === 'sms' && (!candidate.phone?.phone || !candidate.phone.smsConsent || !candidate.smsMarketingConsent)) return false;
  if (filters.languageCode && user.languageCode !== filters.languageCode) return false;
  if (filters.createdBetween && !inDateRange(user.createdAt, filters.createdBetween)) return false;
  if (filters.lastActiveBetween && !inDateRange(user.lastSeenAt, filters.lastActiveBetween)) return false;
  if (filters.consentMarketing !== undefined && !!candidate.marketingConsent !== filters.consentMarketing) return false;

  const phone = candidate.phone ?? null;
  if (filters.hasPhone !== undefined && !!phone !== filters.hasPhone) return false;
  if (filters.smsConsent !== undefined && (!!phone?.smsConsent && !!candidate.smsMarketingConsent) !== filters.smsConsent) return false;
  if (filters.leadStatus && !(candidate.leadStatuses ?? []).includes(filters.leadStatus)) return false;

  const views = new Set(candidate.viewedProductIds ?? []);
  if (filters.viewedProductIds?.length && !filters.viewedProductIds.some((id) => views.has(id))) return false;

  const progress = candidate.stageProgress ?? [];
  const reached = new Set(progress.map((p) => p.stageKey));
  if (filters.anyStageIn?.length && !filters.anyStageIn.some((stage) => reached.has(stage))) return false;
  if (filters.neverReached?.some((stage) => reached.has(stage))) return false;
  if (filters.stageKey) {
    if (filters.stuckLongerThanDays !== undefined) {
      const cutoff = now.getTime() - filters.stuckLongerThanDays * 86_400_000;
      if (!progress.some((p) => p.stageKey === filters.stageKey && !p.completedAt && p.enteredAt.getTime() <= cutoff)) return false;
    } else if (candidate.state?.stage !== filters.stageKey && !progress.some((p) => p.stageKey === filters.stageKey && !p.completedAt)) {
      return false;
    }
  }
  return true;
}

/** +998 E.164 normalizer: Uzbekistan country code, spaces/parentheses/dashes accepted. */
export function normalizeE164(raw: string): string | null {
  const value = raw.trim();
  if (!/^[+\d\s().-]+$/.test(value)) return null;
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('998') && digits.length === 12) return '+' + digits;
  if (digits.length === 9 && /^[3-9]/.test(digits)) return '+998' + digits;
  if (digits.length === 10 && /^[89]/.test(digits)) {
    // Ba'zi operatorlar eski trunk prefiksini 8 yoki 9 bilan kiritadi.
    digits = digits.slice(1);
    return '+998' + digits;
  }
  return null;
}

export function isWithinSmsWindow(now: Date): boolean {
  const local = DateTime.fromJSDate(now, { zone: 'Asia/Tashkent' });
  const minuteOfDay = local.hour * 60 + local.minute;
  return minuteOfDay >= 10 * 60 && minuteOfDay < 20 * 60;
}

export function isSmsWeeklyLimitAllowed(sentInLast7Days: number): boolean {
  return sentInLast7Days < 2;
}

/** 48 soat ichidagi hodisa kampaniyaga tegishli deb olinadi. */
export function isWithinAttributionWindow(sentAt: Date, happenedAt: Date, hours = 48): boolean {
  const delta = happenedAt.getTime() - sentAt.getTime();
  return delta >= 0 && delta <= hours * 3_600_000;
}

/** Campaign'ning ruxsat etilgan holat o'tishlari. */
const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ['scheduled', 'running', 'cancelled'],
  scheduled: ['running', 'paused', 'cancelled'],
  running: ['paused', 'done', 'cancelled'],
  paused: ['scheduled', 'running', 'cancelled'],
  done: [],
  cancelled: [],
};

export function transitionCampaignStatus(from: CampaignStatus, to: CampaignStatus): CampaignStatus {
  if (!CAMPAIGN_TRANSITIONS[from].includes(to)) throw new Error(`invalid_campaign_transition:${from}->${to}`);
  return to;
}

/** Unicode SMS uchun 70/67 GSM uchun 160/153 segment chegaralari. */
export function smsSegmentCount(text: string): number {
  const unicode = /[^\u0000-\u00ff]/u.test(text);
  const single = unicode ? 70 : 160;
  const multipart = unicode ? 67 : 153;
  if (text.length <= single) return 1;
  return Math.ceil(text.length / multipart);
}

export function estimateSmsCost(recipientCount: number, text: string, unitPrice: number): number {
  if (![recipientCount, unitPrice].every(Number.isFinite) || recipientCount < 0 || unitPrice < 0) throw new Error('invalid_sms_estimate');
  return Math.round(recipientCount * smsSegmentCount(text) * unitPrice * 100) / 100;
}

export function sampleRecipient(recipient: CampaignRecipient): { id: string; telegramId: number; firstName: string | null; username: string | null; stage: string; phone: string | null } {
  return {
    id: recipient.user.id,
    telegramId: recipient.user.telegramId,
    firstName: recipient.user.firstName,
    username: recipient.user.username,
    stage: recipient.state?.stage ?? 'START',
    phone: recipient.phone?.phone ?? null,
  };
}
