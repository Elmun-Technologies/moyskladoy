import type {
  AdminUser,
  AnalyticsEvent,
  AuditLogEntry,
  Campaign,
  CampaignChannel,
  CampaignDeliverySummary,
  CampaignRecipient,
  RetentionCohort,
  SavedSegment,
  SegmentFilters,
  SmsMessage,
  SmsMessageStatus,
  StageFunnelPoint,
  StageFunnelRow,
  StageProgress,
  UserPhone,
  Consent,
  ContentBlock,
  ConversationEvent,
  ConversationState,
  HelpRequest,
  LeadProductView,
  LinkToken,
  Media,
  OutboxMessage,
  Product,
  ProductVersion,
  SalesEvent,
  SalesLead,
  SiteLead,
  TelegramUser,
} from './types.js';

// ============================================================================
// Database interfeysi. Ikki implementatsiya:
//  - PrismaDatabase (packages/db) -(real PostgreSQL)
//  - MemoryDatabase (shared/testing) - testlar va demo rejimi
// ============================================================================

export interface CreateUserInput {
  telegramId: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  languageCode?: string | null;
}

export interface CreateSiteLeadInput {
  name: string;
  phone: string;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  consentContact: boolean;
  consentMarketing: boolean;
  consentVersion: string;
  ipHash?: string | null;
}

export interface CreateSalesLeadInput {
  userId: string;
  siteLeadId?: string | null;
  productId?: string | null;
  productVersionId?: string | null;
  task?: string | null;
  problem?: string | null;
  businessType?: string | null;
  decisionMaker?: string | null;
  timeline?: string | null;
  contactMethod?: string | null;
  preferredTime?: string | null;
  contactConsent: boolean;
  openQuestion?: string | null;
}

export interface Database {
  // --- Foydalanuvchilar ---------------------------------------------------
  upsertTelegramUser(input: CreateUserInput): Promise<TelegramUser>;
  getUserByTelegramId(telegramId: number): Promise<TelegramUser | null>;
  getUserById(id: string): Promise<TelegramUser | null>;
  updateUser(id: string, patch: Partial<Pick<TelegramUser, 'blockedAt' | 'lastSeenAt' | 'siteLeadId' | 'username' | 'firstName' | 'lastName'>>): Promise<TelegramUser>;
  listUsers(filter?: { search?: string; stage?: string; limit?: number; offset?: number }): Promise<{ users: (TelegramUser & { state: ConversationState | null })[]; total: number }>;
  upsertUserPhone(userId: string, phone: string, patch?: { verified?: boolean; smsConsent?: boolean }): Promise<UserPhone>;
  getUserPhone(userId: string): Promise<UserPhone | null>;
  getUserPhoneByPhone(phone: string): Promise<UserPhone | null>;
  updateUserPhone(userId: string, patch: Partial<Pick<UserPhone, 'phone' | 'verified' | 'smsConsent'>>): Promise<UserPhone>;
  countSmsSentToPhoneSince(phone: string, since: Date): Promise<number>;

  // --- Sayt murojaatlari va bog'lash tokenlari -----------------------------
  createSiteLead(input: CreateSiteLeadInput): Promise<SiteLead>;
  getSiteLeadById(id: string): Promise<SiteLead | null>;
  createLinkToken(siteLeadId: string, ttlHours: number): Promise<LinkToken>;
  getLinkToken(token: string): Promise<LinkToken | null>;
  /**
   * Tokenni foydalanuvchi ilk bor ishlatganda biriktiriladi. Atomar:
   *  - muddati o'tgan -> { ok: false, reason: 'expired' }
   *  - boshqa user ishlatgan -> { ok: false, reason: 'taken' }
   *  - shu user o'zi qayta ochsa - ok (xavfsiz davom)
   */
  claimLinkToken(token: string, telegramUserId: string, now?: Date): Promise<{ ok: boolean; reason?: 'expired' | 'taken' | 'not_found'; token?: LinkToken }>;

  // --- Suhbat holati -------------------------------------------------------
  getState(userId: string): Promise<ConversationState | null>;
  createState(userId: string, stage?: string): Promise<ConversationState>;
  updateState(userId: string, patch: Partial<ConversationState>): Promise<ConversationState>;
  appendEvent(userId: string, type: string, payload?: Record<string, unknown>): Promise<ConversationEvent>;
  listEvents(userId: string, limit?: number): Promise<ConversationEvent[]>;
  upsertStageProgress(userId: string, stageKey: string, stepOrder: number, enteredAt?: Date): Promise<StageProgress>;
  completeStageProgress(userId: string, stageKey: string, completedAt?: Date, reason?: StageProgress['exitReason']): Promise<StageProgress | null>;
  listStageProgress(filter?: { userIds?: string[]; stageKey?: string; from?: Date; to?: Date; limit?: number }): Promise<StageProgress[]>;
  getStageFunnel(from: Date, to: Date, stuckAfterDays?: number): Promise<StageFunnelRow[]>;
  getStageFunnelSeries(from: Date, to: Date, by: 'day' | 'week'): Promise<StageFunnelPoint[]>;
  getRetentionCohorts(from: Date, to: Date): Promise<RetentionCohort[]>;

  // --- Roziliklar -----------------------------------------------------------
  grantConsent(userId: string, type: Consent['type'], version: string): Promise<Consent>;
  revokeConsent(userId: string, type: Consent['type']): Promise<void>;
  hasActiveConsent(userId: string, type: Consent['type']): Promise<boolean>;
  listConsents(userId: string): Promise<Consent[]>;

  // --- Mahsulotlar -----------------------------------------------------------
  upsertProduct(product: Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'currentVersionId'> & { id?: string }): Promise<Product>;
  getProductBySlug(slug: string): Promise<Product | null>;
  getProductById(id: string): Promise<Product | null>;
  listProducts(includeHidden?: boolean): Promise<Product[]>;
  /** Narx/o'zgarish - yangi ProductVersion yaratadi, eskisi saqlanadi. */
  createProductVersion(productId: string, data: Omit<ProductVersion, 'id' | 'productId' | 'version' | 'createdAt'>): Promise<ProductVersion>;
  getProductVersion(id: string): Promise<ProductVersion | null>;
  listProductVersions(productId: string): Promise<ProductVersion[]>;
  /** Foydalanuvchi ko'rgan narx - TARIXIY, hech qachon o'chirilmaydi. */
  recordProductView(userId: string, productId: string, productVersionId: string): Promise<LeadProductView>;
  listProductViews(userId: string): Promise<LeadProductView[]>;

  // --- Kontent bloklari -------------------------------------------------------
  upsertBlock(block: Omit<ContentBlock, 'id' | 'version' | 'createdAt' | 'updatedAt'> & { id?: string; version?: number }): Promise<ContentBlock>;
  getBlockByKey(key: string, status?: ContentBlock['status']): Promise<ContentBlock | null>;
  getBlockByStage(stage: string, status?: ContentBlock['status']): Promise<ContentBlock | null>;
  listBlocks(filter?: { status?: BlockStatusFilter; stage?: string; search?: string }): Promise<ContentBlock[]>;
  listBlockVersions(key: string): Promise<ContentBlock[]>;

  // --- Media -------------------------------------------------------------------
  createMedia(media: Omit<Media, 'id' | 'createdAt'>): Promise<Media>;
  updateMedia(id: string, patch: Partial<Media>): Promise<Media>;
  getMedia(id: string): Promise<Media | null>;
  listMedia(filter?: { status?: string }): Promise<Media[]>;

  // --- Sotuv --------------------------------------------------------------------
  /**
   * Murojaat yaratish - idempotent: bir userda bir muslim product bo'yicha
   * "faol" (purchased/not_fit/no_contact bo'lmagan) murojaat bo'lsa - uni qaytaradi.
   */
  createSalesLead(input: CreateSalesLeadInput): Promise<SalesLead>;
  getSalesLead(id: string): Promise<SalesLead | null>;
  getActiveLeadByUser(userId: string): Promise<SalesLead | null>;
  listSalesLeads(filter?: { status?: string; assignedToId?: string; limit?: number; offset?: number }): Promise<{ leads: SalesLead[]; total: number }>;
  updateSalesLead(id: string, patch: Partial<SalesLead>): Promise<SalesLead>;
  /**
 * "O'zimga olish" - atomar. Ikki xodim bir Yakka bosganda faqat bittasi olishi mumkin.
   * Muvaffaqiyatli - { ok: true }, aks - { ok: false, reason: 'already_claimed' }.
   */
  claimSalesLead(leadId: string, adminId: string, now?: Date): Promise<{ ok: boolean; reason?: 'already_claimed' | 'not_found'; lead?: SalesLead }>;
  appendSalesEvent(leadId: string, type: SalesEvent['type'], payload?: Record<string, unknown>): Promise<SalesEvent>;
  listSalesEvents(leadId: string): Promise<SalesEvent[]>;

  // --- Yordam ----------------------------------------------------------------
  createHelpRequest(userId: string, question: string): Promise<HelpRequest>;
  listHelpRequests(filter?: { status?: string }): Promise<HelpRequest[]>;
  updateHelpRequest(id: string, patch: Partial<HelpRequest>): Promise<HelpRequest>;

  // --- Segmentlar / kampaniyalar / SMS -------------------------------------
  previewSegment(filters: SegmentFilters, channel: CampaignChannel): Promise<{ count: number; sample: CampaignRecipient[] }>;
  listSegmentRecipients(filters: SegmentFilters, channel: CampaignChannel, campaignId: string, limit?: number): Promise<CampaignRecipient[]>;
  listSavedSegments(): Promise<SavedSegment[]>;
  createSavedSegment(input: Omit<SavedSegment, 'id' | 'createdAt'>): Promise<SavedSegment>;
  deleteSavedSegment(id: string): Promise<boolean>;
  createCampaign(input: Omit<Campaign, 'id' | 'startsAt' | 'endsAt' | 'statsCache' | 'createdAt' | 'updatedAt'>): Promise<Campaign>;
  getCampaign(id: string): Promise<Campaign | null>;
  listCampaigns(limit?: number): Promise<Campaign[]>;
  updateCampaign(id: string, patch: Partial<Campaign>): Promise<Campaign>;
  getCampaignDeliverySummary(campaignId: string): Promise<CampaignDeliverySummary>;
  createSmsMessage(input: Omit<SmsMessage, 'id' | 'attempts' | 'createdAt' | 'updatedAt'>): Promise<SmsMessage | null>;
  getSmsMessage(id: string): Promise<SmsMessage | null>;
  updateSmsMessage(id: string, patch: Partial<SmsMessage>): Promise<SmsMessage>;
  listSmsMessages(filter?: { campaignId?: string; status?: SmsMessageStatus; limit?: number; offset?: number }): Promise<SmsMessage[]>;
  listAnalyticsEvents(filter?: { types?: string[]; typePrefix?: string; campaignId?: string; userIds?: string[]; from?: Date; to?: Date; limit?: number }): Promise<AnalyticsEvent[]>;
  listConversationEventsForUsers(userIds: string[], from: Date, to: Date): Promise<ConversationEvent[]>;

  // --- Admin ----------------------------------------------------------------
  getAdminByEmail(email: string): Promise<AdminUser | null>;
  getAdminById(id: string): Promise<AdminUser | null>;
  createAdmin(data: Omit<AdminUser, 'id' | 'createdAt'>): Promise<AdminUser>;
  updateAdmin(id: string, patch: Partial<AdminUser>): Promise<AdminUser>;
  listAdmins(): Promise<AdminUser[]>;

  // --- Outbox (navbatdagi xabarlar) -----------------------------------------
  enqueueOutbox(msg: Omit<OutboxMessage, 'id' | 'status' | 'attempts' | 'nextAttemptAt' | 'lastError' | 'sentAt' | 'createdAt' | 'campaignId' | 'skippedReason'> & { campaignId?: string | null; skippedReason?: string | null }): Promise<OutboxMessage | null>;
  /** null - dedupeKey takrorlangan (idempotent). */
  listDueOutbox(now: Date, limit?: number): Promise<OutboxMessage[]>;
  updateOutbox(id: string, patch: Partial<OutboxMessage>): Promise<OutboxMessage>;
  /** Rozilik bekor qilinganda / sotuv / blok - rejalashtirilgan xabarlarni to'xtatish. */
  cancelPendingOutboxForUser(userId: string, types?: OutboxMessage['type'][]): Promise<number>;
  countOutboxSentToUserSince(userId: string, type: OutboxMessage['type'], since: Date): Promise<number>;
  listOutbox(filter?: { userId?: string; status?: string; campaignId?: string; limit?: number; offset?: number }): Promise<OutboxMessage[]>;

  // --- Tahlil ---------------------------------------------------------------
  recordEvent(type: string, data: { userId?: string; siteLeadId?: string; dedupeKey?: string; properties?: Record<string, unknown> }): Promise<AnalyticsEvent | null>;
  countEvents(type: string, since?: Date): Promise<number>;
  countUniqueUsers(type: string, since?: Date): Promise<number>;
  listEventsByType(type: string, since?: Date, limit?: number): Promise<AnalyticsEvent[]>;

  // --- Audit ----------------------------------------------------------------
  audit(entry: Omit<AuditLogEntry, 'id' | 'createdAt'>): Promise<AuditLogEntry>;
  listAudit(filter?: { actorId?: string; entity?: string; limit?: number }): Promise<AuditLogEntry[]>;

  // --- Sozlamalar -----------------------------------------------------------
  getSetting(key: string): Promise<unknown | null>;
  setSetting(key: string, value: unknown): Promise<void>;
  listSettings(): Promise<Record<string, unknown>>;

  // --- Idempotency ----------------------------------------------------------
  /** Telegram update takroran kelsa - false qaytaradi. */
  markUpdateProcessed(updateId: number): Promise<boolean>;
}

export type BlockStatusFilter = 'draft' | 'approved' | 'all';
