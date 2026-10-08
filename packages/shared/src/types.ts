// ============================================================================
// Umumiy domain tiplari - bot, api, worker va admin hammasi shu tiplardan foydalanadi.
// ============================================================================

/** Suhbat bosqichlari (state machine). */
export type Stage =
  | 'START'
  | 'EXPERIENCE_VIDEO'
  | 'CLIENT_REVIEW'
  | 'METHOD_VIDEO'
  | 'SURVEY_ROLE'
  | 'SURVEY_ROLE_TEXT'
  | 'SURVEY_PROBLEM'
  | 'SURVEY_PROBLEM_TEXT'
  | 'SURVEY_PATH'
  | 'BUSINESS_TYPE'
  | 'PATH_SELF'
  | 'PATH_EMPLOYEE'
  | 'PATH_UNSURE'
  | 'LESSON_INTRO'
  | 'TASK'
  | 'TASK_CORRECT'
  | 'TASK_WRONG'
  | 'AFTER_LESSON_VIDEO'
  | 'STUDENT_REVIEW'
  | 'CONSENT_REMINDERS'
  | 'OFFERS'
  | 'OFFER_COURSE'
  | 'OFFER_VIDEOS'
  | 'OFFER_SERVICE'
  | 'COMPARE'
  | 'OBJECTION_TIME'
  | 'OBJECTION_EMPLOYEE'
  | 'OBJECTION_PRICE'
  | 'OBJECTION_START'
  | 'ASK_QUESTION'
  | 'ANSWER_FOLLOWUP'
  | 'READINESS'
  | 'TIMELINE'
  | 'DECISION_MAKER'
  | 'DECISION_LEADER'
  | 'PREFLIGHT_VIDEO'
  | 'CONSENT_CONTACT'
  | 'CONTACT_METHOD'
  | 'PREFERRED_TIME'
  | 'REVIEW_SUBMIT'
  | 'SUBMITTED'
  | 'NOT_READY'
  | 'MENU'
  | 'NOTIF_SETTINGS'
  | 'REMINDERS_OFF'
  | 'TECH_HELP'
  | 'UNKNOWN'
  | 'PURCHASE_START';

export type SalesStatus =
  | 'none' // sotuvga o'tmagan
  | 'learning' // o'rganmoqda / hali sotuvga topshirilmagan
  | 'not_ready' // hali tayor emas
  | 'in_sales' // sotuvda (in sales)
  | 'purchased' // sotuv tasdiqlangan
  | 'not_fit' // mos emas
  | 'no_contact'; // bog'lanib bo'lmadi

export type ProductKind = 'course' | 'video_lessons' | 'service' | 'special_offer';

/** fixed - qat'iy narx; by_scope - ish haqiga qarab; unconfirmed - tasdiqlanmagan (foydalanuvchiga ko'rsatilmaz). */
export type PriceType = 'fixed' | 'by_scope' | 'unconfirmed';

export type ConsentType = 'marketing' | 'lessons' | 'sms_marketing';

export type AdminRole = 'admin' | 'sales' | 'content_editor';

export type MediaType = 'video_note' | 'video' | 'image' | 'text';

export type BlockStatus = 'draft' | 'approved';

export interface ButtonDef {
  /** Callback action: goto:STAGE | answer:field=value | cmd:menu | lesson:open | task:11 | submit:send ... */
  action: string;
  label: string;
  /** Panel'dan o'chirilgan (off) tugma - bot uni YUBORMAYDI, lekin saqlanadi. */
  hidden?: boolean;
}

/** Ko'rsatish sharti - engine blokni ko'rsatishdan oldin tekshiradi. */
export interface ShowCondition {
  /** Agar true - settings'da sinus dersi havolasi sozlangan bo'lishi shart */
  lessonLinkRequired?: boolean;
  /** Kamida bitta ko'rinadigan Mahsulot (visibleToUsers && !unconfirmed) bo'lishi shart */
  requiresVisibleProducts?: boolean;
  /** Foydalanuvchi mana shu stage'da bo'lmasa - blok ko'rsatilmaydi */
  onlyStages?: Stage[];
/** Javob maydoni - question berkitilmasa blok ko'rsatilmaydi */
  requiresAnswer?: string;
  /** Settings'da shu kalitlar to'ldirilgan bo'lishi shart - bo'lmasa bo'lim ishga tushmaydi */
  requiredSettings?: string[];
  /** Marketing roziligi bo'lsa bu bosqich o'tkaziladi (18-qoida: so'ralgan bo'lsa qayta so'rolmaydi) */
  skipIfMarketingConsent?: boolean;
}

export interface ContentBlock {
  id: string;
  /** Unikal kalit: welcome, survey_role, offers ... */
  key: string;
  version: number;
  stage: Stage | null;
  title: string;
  body: string;
  mediaType: MediaType | null;
  /** Telegram file_id yoki tasdiqlangan manba */
  mediaId: string | null;
  mediaSourceUrl: string | null;
  buttons: ButtonDef[];
  /** Kamera uchun tayyor matn (video skripti) - bot uni yubormaydi, faqat panel. */
  videoScript?: string | null;
  showCondition: ShowCondition | null;
  status: BlockStatus;
/** Agar media bo'lmasa - faqat matn yuborish mumkinmi */
  textFallbackAllowed: boolean;
/** Agar media yetishmasa - bu bosqichni umuman yubormaslik (majburiy material) */
  requiresMedia: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TelegramUser {
  id: string;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
  blockedAt: Date | null;
  lastSeenAt: Date | null;
  siteLeadId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SiteLead {
  id: string;
  name: string;
  phone: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  consentContact: boolean;
  consentMarketing: boolean;
  consentVersion: string;
  ipHash: string | null;
  createdAt: Date;
}

export interface LinkToken {
  id: string;
  token: string;
  siteLeadId: string;
  telegramUserId: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface Consent {
  id: string;
  userId: string;
  type: ConsentType;
  version: string;
  grantedAt: Date;
  revokedAt: Date | null;
}

export type Answers = Record<string, string>;

export interface ConversationState {
  id: string;
  userId: string;
  stage: Stage;
  answers: Answers;
  interestedProductId: string | null;
  lessonLinkClickedAt: Date | null;
  /** Foydalanuvchi o'zi "ko'rdim" deb belgilagan vaqti (self-report) */
  lessonWatchedAt: Date | null;
  taskAnswer: string | null;
  contactMethod: string | null;
  preferredTime: string | null;
  contactConsentGivenAt: Date | null;
  salesStatus: SalesStatus;
  /** Inson javob berayotganda - eslatmalar va marketing to'xtatiladi */
  humanHandling: boolean;
  lastReminderAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationEvent {
  id: string;
  userId: string;
  type: string;
  payload: Record<string, unknown> | null;
  createdAt: Date;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  kind: ProductKind;
  description: string;
/** Kurs tafsilotlari: davomiyligi, qollab-quvvatlash, kafolat, kirish muddati, bolib tolov - admin paneldan tahrirlanadi. */
  details: Record<string, unknown>;
  priceType: PriceType;
  priceUsd: number | null;
  currency: string;
  isActive: boolean;
  /** Foydalanuvchiga ko'rsatiladimi - $800 taklifi "tasdiqlanmagan" bo'lsa - false */
  visibleToUsers: boolean;
  currentVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductVersion {
  id: string;
  productId: string;
  version: number;
  name: string;
  description: string;
  details: Record<string, unknown>;
  priceType: PriceType;
  priceUsd: number | null;
  createdAt: Date;
}

export interface LeadProductView {
  id: string;
  userId: string;
  productId: string;
  productVersionId: string;
  viewedAt: Date;
}

export type LeadStatus =
  | 'new'
  | 'assigned'
  | 'contacting'
  | 'talked'
  | 'later'
  | 'purchased'
  | 'not_fit'
  | 'no_contact';

export interface SalesLead {
  id: string;
  userId: string;
  siteLeadId: string | null;
  productId: string | null;
  productVersionId: string | null;
  task: string | null;
  problem: string | null;
  businessType: string | null;
  decisionMaker: string | null;
  timeline: string | null;
  contactMethod: string | null;
  preferredTime: string | null;
  contactConsent: boolean;
  openQuestion: string | null;
  status: LeadStatus;
  assignedToId: string | null;
  claimedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SalesEvent {
  id: string;
  leadId: string;
  type: 'created' | 'notified' | 'notify_failed' | 'claimed' | 'status_changed' | 'note' | 'purchase_confirmed';
  payload: Record<string, unknown> | null;
  createdAt: Date;
}

export interface HelpRequest {
  id: string;
  userId: string;
  question: string;
  status: 'open' | 'answered' | 'closed';
  answer: string | null;
  answeredById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminUser {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: AdminRole;
  failedLogins: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export type OutboxType = 'reminder' | 'marketing' | 'notification';
export type OutboxStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';

export interface OutboxMessage {
  id: string;
  userId: string;
  type: OutboxType;
/** Qayta enqueue rad etilmaydi - unikal (idempotent) */
  dedupeKey: string;
  payload: Record<string, unknown>;
  campaignId: string | null;
  skippedReason: string | null;
  scheduledFor: Date;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
}

export type CampaignChannel = 'telegram' | 'sms';
export type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'done' | 'cancelled';
export type StageExitReason = 'completed' | 'dropped' | 'blocked';

export interface StageProgress {
  id: string;
  userId: string;
  stageKey: string;
  stepOrder: number;
  enteredAt: Date;
  completedAt: Date | null;
  exitReason: StageExitReason | null;
}

export interface SegmentDateRange {
  from?: string | Date;
  to?: string | Date;
}

/** Segment filtrlari AND bilan qo'llanadi; noma'lum kalitlar rad etiladi. */
export interface SegmentFilters {
  stageKey?: string;
  stuckLongerThanDays?: number;
  anyStageIn?: string[];
  neverReached?: string[];
  consentMarketing?: boolean;
  hasPhone?: boolean;
  smsConsent?: boolean;
  lastActiveBetween?: SegmentDateRange;
  createdBetween?: SegmentDateRange;
  leadStatus?: string;
  viewedProductIds?: string[];
  blocked?: boolean;
  languageCode?: string;
}

export interface UserPhone {
  id: string;
  userId: string;
  phone: string;
  verified: boolean;
  smsConsent: boolean;
  updatedAt: Date;
}

export interface Campaign {
  id: string;
  name: string;
  channel: CampaignChannel;
  segmentJson: SegmentFilters;
  templateText: string;
  buttonsJson: unknown[] | null;
  mediaId: string | null;
  status: CampaignStatus;
  scheduledFor: Date | null;
  /** SMS campaigns remain gated until an admin confirms the current estimate. */
  smsConfirmedAt?: Date | null;
  createdById: string;
  startsAt: Date | null;
  endsAt: Date | null;
  statsCache: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SmsMessageStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'cancelled';
export interface SmsMessage {
  id: string;
  campaignId: string | null;
  userId: string | null;
  phone: string;
  text: string;
  status: SmsMessageStatus;
  externalId: string | null;
  lastError: string | null;
  skippedReason: string | null;
  attempts: number;
  sentAt: Date | null;
  reportedAt: Date | null;
  isTest: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SavedSegment {
  id: string;
  name: string;
  ownerId: string | null;
  filtersJson: SegmentFilters;
  createdAt: Date;
}

export interface CampaignRecipient {
  user: TelegramUser;
  state: ConversationState | null;
  phone: UserPhone | null;
}

export interface StageFunnelRow {
  stageKey: string;
  stepOrder: number;
  viewed: number;
  completed: number;
  stuck: number;
  conversionPct: number;
  medianMinutes: number | null;
}

export interface StageFunnelPoint extends StageFunnelRow {
  bucket: string;
}

export interface RetentionCohort {
  bucket: string;
  users: number;
  d1: number;
  d7: number;
  d30: number;
}

export interface CampaignDeliverySummary {
  planned: number;
  sent: number;
  pending: number;
  failed: number;
  skipped: Record<string, number>;
}

export interface Media {
  id: string;
  fileId: string | null;
  sourceUrl: string | null;
  originalName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  durationSec: number | null;
  isVideoNote: boolean;
  status: 'uploaded' | 'processing' | 'approved' | 'rejected';
  formatChecked: boolean;
  uploadedById: string | null;
  createdAt: Date;
}

export interface AnalyticsEvent {
  id: string;
  type: string;
  userId: string | null;
  siteLeadId: string | null;
  dedupeKey: string | null;
  properties: Record<string, unknown> | null;
  createdAt: Date;
}

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  createdAt: Date;
}

/** Tahlil hodisalari - konversiya funnel'ida ayirish uchun */
export type AnalyticsEventType =
  | 'site_form_submitted'
  | 'bot_started'
  | 'intro_continue'
  | 'survey_answered'
  | 'lesson_link_clicked'
  | 'lesson_watched_self_reported'
  | 'task_answered'
  | 'offer_opened'
  | 'sales_ready'
  | 'lead_submitted'
  | 'sales_talk'
  | 'purchase_confirmed'
  | 'consent_revoked'
  | 'bot_blocked'
  | 'notification_sent'
  | 'nurture_tip_sent'
  | 'stage_viewed'
  | 'stage_completed'
  | 'start_source'
  | `button_click:${string}`
  | 'link_opened'
  | 'site_marketing_consent_granted'
  | 'sms_consent_granted'
  | 'sms_consent_revoked'
  | 'campaign_sent'
  | 'campaign_test_sent'
  | 'campaign_click'
  | 'campaign_reply'
  | 'sms_report';

/** Yuborish adapterining natijasi - "xabar yetgan-yetmagani" malumoti. */
export interface SendResult {
  ok: boolean;
  messageId?: number;
  /** ok=false bo'lsa - xato xabari (log'ga telefon/token yozilmaydi) */
  error?: string;
  /** Tarmoq noaniqligi - xabar yetgan-yetmagani noma'lum */
  ambiguous?: boolean;
}

export interface MessengerButton {
  label: string;
  /** Ichki action: goto:STAGE | answer:k=v | cmd:menu | ... */
  action: string;
}

/**
 * Xabar yuborish adapteri. Production'da - grammY (Telegram Bot API),
 * testlarda - TestMessenger (xabarlarni xotiraga yozadi, hech kimga yubormaydi).
 */
export interface Messenger {
  sendText(chatId: number, text: string, buttons?: MessengerButton[]): Promise<SendResult>;
  sendVideoNote(chatId: number, fileId: string, buttons?: MessengerButton[]): Promise<SendResult>;
  sendVideo(chatId: number, fileId: string, buttons?: MessengerButton[]): Promise<SendResult>;
  sendPhoto(chatId: number, fileId: string, caption?: string, buttons?: MessengerButton[]): Promise<SendResult>;
  /** Foydalanuvchiga telefon ulash so'rovi (kontaktni so'rash) */
  requestContact(chatId: number, text: string): Promise<SendResult>;
  answerCallback(callbackQueryId: string, text?: string): Promise<void>;
}
