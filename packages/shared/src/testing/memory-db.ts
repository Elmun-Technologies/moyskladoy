import { randomUUID } from 'node:crypto';
import type { Database, CreateSalesLeadInput, CreateSiteLeadInput, CreateUserInput, BlockStatusFilter } from '../database.js';
import type {
  AdminUser,
  AnalyticsEvent,
  AuditLogEntry,
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
} from '../types.js';

// ============================================================================
// MemoryDatabase - in-memory implementatsiya.
//  - Testlar uchun (tez, izolyatsiyalangan, tashqi bog'liq emas)
//  - Demo rejimi uchun (DATABASE_URL bo'lmasa)
// Eslatma: claimSalesLead va claimLinkToken operatsiyalari bu yerda
// sinxron (atomar). Prisma implementatsiyasida - tranzaksiya + shartli UPDATE.
// ============================================================================

let idSeq = 0;
function nid(prefix: string): string {
  idSeq += 1;
  return `${prefix}_${randomUUID().slice(0, 8)}${idSeq}`;
}

function clone<T>(v: T): T {
  // structuredClone Date'larni saqlaydi (JSON round-trip ularni buzardi).
  if (v === undefined) return v;
  try {
    return structuredClone(v);
  } catch {
    return JSON.parse(JSON.stringify(v)) as T;
  }
}

export class MemoryDatabase implements Database {
  readonly users = new Map<string, TelegramUser>();
  readonly usersByTelegramId = new Map<number, string>();
  readonly siteLeads = new Map<string, SiteLead>();
  readonly linkTokens = new Map<string, LinkToken>(); // by token string
  readonly states = new Map<string, ConversationState>(); // by userId
  readonly events: ConversationEvent[] = [];
  readonly consents: Consent[] = [];
  readonly products = new Map<string, Product>();
  readonly productVersions = new Map<string, ProductVersion>();
  readonly productViews: LeadProductView[] = [];
  readonly blocks = new Map<string, ContentBlock>(); // by key -> latest
  readonly blockVersions = new Map<string, ContentBlock[]>(); // by key -> all versions
  readonly media = new Map<string, Media>();
  readonly salesLeads = new Map<string, SalesLead>();
  readonly salesEvents: SalesEvent[] = [];
  readonly helpRequests = new Map<string, HelpRequest>();
  readonly admins = new Map<string, AdminUser>();
  readonly outbox: OutboxMessage[] = [];
  readonly analytics: AnalyticsEvent[] = [];
  readonly auditLog: AuditLogEntry[] = [];
  readonly settings = new Map<string, unknown>();
  readonly processedUpdates = new Set<number>();

  // --- Foydalanuvchilar ---------------------------------------------------

  async upsertTelegramUser(input: CreateUserInput): Promise<TelegramUser> {
    const existingId = this.usersByTelegramId.get(input.telegramId);
    const now = new Date();
    if (existingId) {
      const u = this.users.get(existingId)!;
      u.username = input.username ?? u.username;
      u.firstName = input.firstName ?? u.firstName;
      u.lastName = input.lastName ?? u.lastName;
      u.languageCode = input.languageCode ?? u.languageCode;
      u.updatedAt = now;
      return clone(u);
    }
    const user: TelegramUser = {
      id: nid('user'),
      telegramId: input.telegramId,
      username: input.username ?? null,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      languageCode: input.languageCode ?? null,
      blockedAt: null,
      lastSeenAt: null,
      siteLeadId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(user.id, user);
    this.usersByTelegramId.set(user.telegramId, user.id);
    return clone(user);
  }

  async getUserByTelegramId(telegramId: number): Promise<TelegramUser | null> {
    const id = this.usersByTelegramId.get(telegramId);
    return id ? clone(this.users.get(id)!) : null;
  }

  async getUserById(id: string): Promise<TelegramUser | null> {
    const u = this.users.get(id);
    return u ? clone(u) : null;
  }

  async updateUser(id: string, patch: Partial<TelegramUser>): Promise<TelegramUser> {
    const u = this.users.get(id);
    if (!u) throw new Error(`user not found: ${id}`);
    if (patch.blockedAt !== undefined) u.blockedAt = patch.blockedAt;
    if (patch.lastSeenAt !== undefined) u.lastSeenAt = patch.lastSeenAt;
    if (patch.siteLeadId !== undefined) u.siteLeadId = patch.siteLeadId;
    if (patch.username !== undefined) u.username = patch.username;
    if (patch.firstName !== undefined) u.firstName = patch.firstName;
    if (patch.lastName !== undefined) u.lastName = patch.lastName;
    u.updatedAt = new Date();
    return clone(u);
  }

  async listUsers(filter?: { search?: string; stage?: string; limit?: number; offset?: number }) {
    let list = [...this.users.values()];
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      list = list.filter(
        (u) =>
          u.firstName?.toLowerCase().includes(q) ||
          u.lastName?.toLowerCase().includes(q) ||
          u.username?.toLowerCase().includes(q) ||
          String(u.telegramId).includes(q),
      );
    }
    if (filter?.stage) {
      list = list.filter((u) => this.states.get(u.id)?.stage === filter.stage);
    }
    const total = list.length;
    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? 50;
    list = list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(offset, offset + limit);
    return {
      users: list.map((u) => ({ ...clone(u), state: this.states.get(u.id) ? clone(this.states.get(u.id)!) : null })),
      total,
    };
  }

  // --- Sayt murojaatlari va tokenlar ---------------------------------------

  async createSiteLead(input: CreateSiteLeadInput): Promise<SiteLead> {
    const lead: SiteLead = {
      id: nid('site'),
      name: input.name,
      phone: input.phone,
      utmSource: input.utmSource ?? null,
      utmMedium: input.utmMedium ?? null,
      utmCampaign: input.utmCampaign ?? null,
      consentContact: input.consentContact,
      consentMarketing: input.consentMarketing,
      consentVersion: input.consentVersion,
      ipHash: input.ipHash ?? null,
      createdAt: new Date(),
    };
    this.siteLeads.set(lead.id, lead);
    return clone(lead);
  }

  async getSiteLeadById(id: string): Promise<SiteLead | null> {
    const l = this.siteLeads.get(id);
    return l ? clone(l) : null;
  }

  async createLinkToken(siteLeadId: string, ttlHours: number): Promise<LinkToken> {
    const token: LinkToken = {
      id: nid('tok'),
      token: randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 8),
      siteLeadId,
      telegramUserId: null,
      expiresAt: new Date(Date.now() + ttlHours * 3600_000),
      usedAt: null,
      createdAt: new Date(),
    };
    this.linkTokens.set(token.token, token);
    return clone(token);
  }

  async getLinkToken(token: string): Promise<LinkToken | null> {
    const t = this.linkTokens.get(token);
    return t ? clone(t) : null;
  }

  async claimLinkToken(tokenStr: string, telegramUserId: string, now = new Date()) {
    const t = this.linkTokens.get(tokenStr);
    if (!t) return { ok: false as const, reason: 'not_found' as const };
    if (t.telegramUserId && t.telegramUserId !== telegramUserId) {
      return { ok: false as const, reason: 'taken' as const, token: clone(t) };
    }
    if (!t.telegramUserId && t.expiresAt.getTime() <= now.getTime()) {
      return { ok: false as const, reason: 'expired' as const, token: clone(t) };
    }
    if (!t.telegramUserId) {
      t.telegramUserId = telegramUserId;
      t.usedAt = now;
      // Foydalanuvchini sayt so'roviga bog'lash
      const u = this.users.get(telegramUserId);
      if (u && !u.siteLeadId) {
        u.siteLeadId = t.siteLeadId;
      }
    }
    return { ok: true as const, token: clone(t) };
  }

  // --- Suhbat holati -------------------------------------------------------

  async getState(userId: string): Promise<ConversationState | null> {
    const s = this.states.get(userId);
    return s ? clone(s) : null;
  }

  async createState(userId: string, stage = 'START'): Promise<ConversationState> {
    const existing = this.states.get(userId);
    if (existing) return clone(existing);
    const now = new Date();
    const s: ConversationState = {
      id: nid('state'),
      userId,
      stage: stage as ConversationState['stage'],
      answers: {},
      interestedProductId: null,
      lessonLinkClickedAt: null,
      lessonWatchedAt: null,
      taskAnswer: null,
      contactMethod: null,
      preferredTime: null,
      contactConsentGivenAt: null,
      salesStatus: 'none',
      humanHandling: false,
      lastReminderAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.states.set(userId, s);
    return clone(s);
  }

  async updateState(userId: string, patch: Partial<ConversationState>): Promise<ConversationState> {
    let s = this.states.get(userId);
    if (!s) s = (await this.createState(userId)) as ConversationState;
    const target = this.states.get(userId)!;
    Object.assign(target, clone(patch), { updatedAt: (patch as { updatedAt?: Date }).updatedAt ?? new Date() }); // testlar uchun explicit updatedAt ruxsat etiladi
    void s;
    return clone(target);
  }

  async appendEvent(userId: string, type: string, payload?: Record<string, unknown>): Promise<ConversationEvent> {
    const e: ConversationEvent = { id: nid('evt'), userId, type, payload: payload ?? null, createdAt: new Date() };
    this.events.push(e);
    return clone(e);
  }

  async listEvents(userId: string, limit = 100): Promise<ConversationEvent[]> {
    return this.events.filter((e) => e.userId === userId).slice(-limit).map(clone);
  }

  // --- Roziliklar -----------------------------------------------------------

  async grantConsent(userId: string, type: Consent['type'], version: string): Promise<Consent> {
    // Avvalgi aktiv rozilikni bekor qilish
    for (const c of this.consents) {
      if (c.userId === userId && c.type === type && !c.revokedAt) {
        c.revokedAt = new Date();
      }
    }
    const c: Consent = { id: nid('consent'), userId, type, version, grantedAt: new Date(), revokedAt: null };
    this.consents.push(c);
    return clone(c);
  }

  async revokeConsent(userId: string, type: Consent['type']): Promise<void> {
    for (const c of this.consents) {
      if (c.userId === userId && c.type === type && !c.revokedAt) {
        c.revokedAt = new Date();
      }
    }
  }

  async hasActiveConsent(userId: string, type: Consent['type']): Promise<boolean> {
    return this.consents.some((c) => c.userId === userId && c.type === type && !c.revokedAt);
  }

  async listConsents(userId: string): Promise<Consent[]> {
    return this.consents.filter((c) => c.userId === userId).map(clone);
  }

  // --- Mahsulotlar -----------------------------------------------------------

  async upsertProduct(
    product: Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'currentVersionId'> & { id?: string },
  ): Promise<Product> {
    const now = new Date();
    const existing = product.id ? this.products.get(product.id) : [...this.products.values()].find((p) => p.slug === product.slug);
    if (existing) {
      Object.assign(existing, clone(product), { updatedAt: now });
      return clone(existing);
    }
    const p: Product = {
      id: nid('prod'),
      slug: product.slug,
      name: product.name,
      kind: product.kind,
      description: product.description,
      details: product.details,
      priceType: product.priceType,
      priceUsd: product.priceUsd,
      currency: product.currency,
      isActive: product.isActive,
      visibleToUsers: product.visibleToUsers,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.products.set(p.id, p);
    return clone(p);
  }

  async getProductBySlug(slug: string): Promise<Product | null> {
    const p = [...this.products.values()].find((x) => x.slug === slug);
    return p ? clone(p) : null;
  }

  async getProductById(id: string): Promise<Product | null> {
    const p = this.products.get(id);
    return p ? clone(p) : null;
  }

  async listProducts(includeHidden = false): Promise<Product[]> {
    return [...this.products.values()]
      .filter((p) => includeHidden || p.visibleToUsers)
      .map(clone);
  }

  async createProductVersion(
    productId: string,
    data: Omit<ProductVersion, 'id' | 'productId' | 'version' | 'createdAt'>,
  ): Promise<ProductVersion> {
    const product = this.products.get(productId);
    if (!product) throw new Error(`product not found: ${productId}`);
    const version = (product.currentVersionId
      ? (this.productVersions.get(product.currentVersionId)?.version ?? 0)
      : 0) + 1;
    const pv: ProductVersion = {
      id: nid('pv'),
      productId,
      version,
      name: data.name,
      description: data.description,
      details: data.details,
      priceType: data.priceType,
      priceUsd: data.priceUsd,
      createdAt: new Date(),
    };
    this.productVersions.set(pv.id, pv);
    product.currentVersionId = pv.id;
    product.name = data.name;
    product.description = data.description;
    product.details = data.details;
    product.priceType = data.priceType;
    product.priceUsd = data.priceUsd;
    product.updatedAt = new Date();
    return clone(pv);
  }

  async getProductVersion(id: string): Promise<ProductVersion | null> {
    const v = this.productVersions.get(id);
    return v ? clone(v) : null;
  }

  async listProductVersions(productId: string): Promise<ProductVersion[]> {
    return [...this.productVersions.values()].filter((v) => v.productId === productId).map(clone);
  }

  async recordProductView(userId: string, productId: string, productVersionId: string): Promise<LeadProductView> {
    const view: LeadProductView = { id: nid('view'), userId, productId, productVersionId, viewedAt: new Date() };
    this.productViews.push(view);
    return clone(view);
  }

  async listProductViews(userId: string): Promise<LeadProductView[]> {
    return this.productViews.filter((v) => v.userId === userId).map(clone);
  }

  // --- Kontent bloklari -------------------------------------------------------

  async upsertBlock(
    block: Omit<ContentBlock, 'id' | 'version' | 'createdAt' | 'updatedAt'> & { id?: string; version?: number },
  ): Promise<ContentBlock> {
    const now = new Date();
    const versions = this.blockVersions.get(block.key) ?? [];
    // id bilan kelsa - o'sha versiya qatorini joyida yangilaymiz (Prisma semantikasi).
    if (block.id) {
      const idx = versions.findIndex((v) => v.id === block.id);
      if (idx >= 0) {
        const upd: ContentBlock = {
          ...versions[idx]!,
          stage: block.stage,
          title: block.title,
          body: block.body,
          mediaType: block.mediaType,
          mediaId: block.mediaId,
          mediaSourceUrl: block.mediaSourceUrl,
          buttons: block.buttons,
          videoScript: block.videoScript ?? null,
          showCondition: block.showCondition,
          status: block.status,
          textFallbackAllowed: block.textFallbackAllowed,
          requiresMedia: block.requiresMedia,
          updatedAt: now,
        };
        versions[idx] = upd;
        this.blocks.set(block.key, upd);
        return clone(upd);
      }
    }
    const version = block.version ?? (versions.length ? Math.max(...versions.map((v) => v.version)) + 1 : 1);
    const b: ContentBlock = {
      id: block.id ?? nid('blk'),
      key: block.key,
      version,
      stage: block.stage,
      title: block.title,
      body: block.body,
      mediaType: block.mediaType,
      mediaId: block.mediaId,
      mediaSourceUrl: block.mediaSourceUrl,
      buttons: block.buttons,
      videoScript: block.videoScript ?? null,
      showCondition: block.showCondition,
      status: block.status,
      textFallbackAllowed: block.textFallbackAllowed,
      requiresMedia: block.requiresMedia,
      createdAt: now,
      updatedAt: now,
    };
    versions.push(b);
    versions.sort((a, c) => a.version - c.version);
    this.blockVersions.set(block.key, versions);
    this.blocks.set(block.key, b);
    return clone(b);
  }

  async getBlockByKey(key: string, status?: ContentBlock['status']): Promise<ContentBlock | null> {
    const versions = this.blockVersions.get(key);
    if (!versions || versions.length === 0) return null;
    const list = status ? versions.filter((v) => v.status === status) : versions;
    const found = list[list.length - 1];
    return found ? clone(found) : null;
  }

  async getBlockByStage(stage: string, status?: ContentBlock['status']): Promise<ContentBlock | null> {
    // Barcha kalitlarning barcha versiyalari ko'rib chiqiladi: yangi DRAFT
    // mavjud bo'lsa ham, oxirgi APPROVED topiladi (Prisma semanticsiga mos).
    let found: ContentBlock | null = null;
    for (const versions of this.blockVersions.values()) {
      for (const b of versions) {
        if (b.stage !== stage) continue;
        if (status && b.status !== status) continue;
        if (!found || b.version > found.version) found = b;
      }
    }
    return found ? clone(found) : null;
  }

  async listBlocks(filter?: { status?: BlockStatusFilter; stage?: string; search?: string }): Promise<ContentBlock[]> {
    let list = [...this.blocks.values()];
    if (filter?.status && filter.status !== 'all') list = list.filter((b) => b.status === filter.status);
    if (filter?.stage) list = list.filter((b) => b.stage === filter.stage);
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      list = list.filter((b) => b.key.toLowerCase().includes(q) || b.title.toLowerCase().includes(q) || b.body.toLowerCase().includes(q));
    }
    return list.sort((a, b) => a.key.localeCompare(b.key)).map(clone);
  }

  async listBlockVersions(key: string): Promise<ContentBlock[]> {
    return (this.blockVersions.get(key) ?? []).map(clone);
  }

  // --- Media -------------------------------------------------------------------

  async createMedia(media: Omit<Media, 'id' | 'createdAt'>): Promise<Media> {
    const m: Media = { ...clone(media), id: nid('media'), createdAt: new Date() };
    this.media.set(m.id, m);
    return clone(m);
  }

  async updateMedia(id: string, patch: Partial<Media>): Promise<Media> {
    const m = this.media.get(id);
    if (!m) throw new Error(`media not found: ${id}`);
    Object.assign(m, clone(patch));
    return clone(m);
  }

  async getMedia(id: string): Promise<Media | null> {
    const m = this.media.get(id);
    return m ? clone(m) : null;
  }

  async listMedia(filter?: { status?: string }): Promise<Media[]> {
    let list = [...this.media.values()];
    if (filter?.status) list = list.filter((m) => m.status === filter.status);
    return list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(clone);
  }

  // --- Sotuv --------------------------------------------------------------------

  async createSalesLead(input: CreateSalesLeadInput): Promise<SalesLead> {
    // Idempotent: bir userda Shu product bo'yicha "faol" murojaat bo'lsa - uni qaytarish
    const existing = [...this.salesLeads.values()].find(
      (l) =>
        l.userId === input.userId &&
        (l.productId ?? null) === (input.productId ?? null) &&
        !['purchased', 'not_fit', 'no_contact'].includes(l.status),
    );
    if (existing) return clone(existing);
    const lead: SalesLead = {
      id: nid('lead'),
      userId: input.userId,
      siteLeadId: input.siteLeadId ?? null,
      productId: input.productId ?? null,
      productVersionId: input.productVersionId ?? null,
      task: input.task ?? null,
      problem: input.problem ?? null,
      businessType: input.businessType ?? null,
      decisionMaker: input.decisionMaker ?? null,
      timeline: input.timeline ?? null,
      contactMethod: input.contactMethod ?? null,
      preferredTime: input.preferredTime ?? null,
      contactConsent: input.contactConsent,
      openQuestion: input.openQuestion ?? null,
      status: 'new',
      assignedToId: null,
      claimedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.salesLeads.set(lead.id, lead);
    await this.appendSalesEvent(lead.id, 'created', { productId: lead.productId });
    return clone(lead);
  }

  async getSalesLead(id: string): Promise<SalesLead | null> {
    const l = this.salesLeads.get(id);
    return l ? clone(l) : null;
  }

  async getActiveLeadByUser(userId: string): Promise<SalesLead | null> {
    const l = [...this.salesLeads.values()]
      .filter((x) => x.userId === userId && !['purchased', 'not_fit', 'no_contact'].includes(x.status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return l ? clone(l) : null;
  }

  async listSalesLeads(filter?: { status?: string; assignedToId?: string; limit?: number; offset?: number }) {
    let list = [...this.salesLeads.values()];
    if (filter?.status) list = list.filter((l) => l.status === filter.status);
    if (filter?.assignedToId) list = list.filter((l) => l.assignedToId === filter.assignedToId);
    const total = list.length;
    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? 50;
    list = list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(offset, offset + limit);
    return { leads: list.map(clone), total };
  }

  async updateSalesLead(id: string, patch: Partial<SalesLead>): Promise<SalesLead> {
    const l = this.salesLeads.get(id);
    if (!l) throw new Error(`lead not found: ${id}`);
    const before = clone(l);
    Object.assign(l, clone(patch), { updatedAt: new Date() });
    if (patch.status && patch.status !== before.status) {
      await this.appendSalesEvent(id, 'status_changed', { from: before.status, to: patch.status });
    }
    return clone(l);
  }

  async claimSalesLead(leadId: string, adminId: string, now = new Date()) {
    const l = this.salesLeads.get(leadId);
    if (!l) return { ok: false as const, reason: 'not_found' as const };
    if (l.assignedToId) {
      return { ok: false as const, reason: 'already_claimed' as const, lead: clone(l) };
    }
    l.assignedToId = adminId;
    l.claimedAt = now;
    l.status = 'assigned';
    l.updatedAt = now;
    await this.appendSalesEvent(leadId, 'claimed', { adminId });
    return { ok: true as const, lead: clone(l) };
  }

  async appendSalesEvent(leadId: string, type: SalesEvent['type'], payload?: Record<string, unknown>): Promise<SalesEvent> {
    const e: SalesEvent = { id: nid('se'), leadId, type, payload: payload ?? null, createdAt: new Date() };
    this.salesEvents.push(e);
    return clone(e);
  }

  async listSalesEvents(leadId: string): Promise<SalesEvent[]> {
    return this.salesEvents.filter((e) => e.leadId === leadId).map(clone);
  }

  // --- Yordam ----------------------------------------------------------------

  async createHelpRequest(userId: string, question: string): Promise<HelpRequest> {
    const h: HelpRequest = {
      id: nid('help'),
      userId,
      question,
      status: 'open',
      answer: null,
      answeredById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.helpRequests.set(h.id, h);
    return clone(h);
  }

  async listHelpRequests(filter?: { status?: string }): Promise<HelpRequest[]> {
    let list = [...this.helpRequests.values()];
    if (filter?.status) list = list.filter((h) => h.status === filter.status);
    return list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(clone);
  }

  async updateHelpRequest(id: string, patch: Partial<HelpRequest>): Promise<HelpRequest> {
    const h = this.helpRequests.get(id);
    if (!h) throw new Error(`help request not found: ${id}`);
    Object.assign(h, clone(patch), { updatedAt: new Date() });
    return clone(h);
  }

  // --- Admin ----------------------------------------------------------------

  async getAdminByEmail(email: string): Promise<AdminUser | null> {
    const a = [...this.admins.values()].find((x) => x.email.toLowerCase() === email.toLowerCase());
    return a ? clone(a) : null;
  }

  async getAdminById(id: string): Promise<AdminUser | null> {
    const a = this.admins.get(id);
    return a ? clone(a) : null;
  }

  async createAdmin(data: Omit<AdminUser, 'id' | 'createdAt'>): Promise<AdminUser> {
    const a: AdminUser = { ...clone(data), id: nid('adm'), createdAt: new Date() };
    this.admins.set(a.id, a);
    return clone(a);
  }

  async updateAdmin(id: string, patch: Partial<AdminUser>): Promise<AdminUser> {
    const a = this.admins.get(id);
    if (!a) throw new Error(`admin not found: ${id}`);
    Object.assign(a, clone(patch));
    return clone(a);
  }

  async listAdmins(): Promise<AdminUser[]> {
    return [...this.admins.values()].map(clone);
  }

  // --- Outbox ---------------------------------------------------------------

  async enqueueOutbox(
    msg: Omit<OutboxMessage, 'id' | 'status' | 'attempts' | 'nextAttemptAt' | 'lastError' | 'sentAt' | 'createdAt'>,
  ): Promise<OutboxMessage | null> {
    if (this.outbox.some((m) => m.dedupeKey === msg.dedupeKey)) return null; // idempotent
    const m: OutboxMessage = {
      id: nid('out'),
      userId: msg.userId,
      type: msg.type,
      dedupeKey: msg.dedupeKey,
      payload: msg.payload,
      scheduledFor: msg.scheduledFor,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      sentAt: null,
      createdAt: new Date(),
    };
    this.outbox.push(m);
    return clone(m);
  }

  async listDueOutbox(now: Date, limit = 100): Promise<OutboxMessage[]> {
    return this.outbox
      .filter((m) => m.status === 'pending' && m.scheduledFor.getTime() <= now.getTime())
      .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime())
      .slice(0, limit)
      .map(clone);
  }

  async updateOutbox(id: string, patch: Partial<OutboxMessage>): Promise<OutboxMessage> {
    const m = this.outbox.find((x) => x.id === id);
    if (!m) throw new Error(`outbox message not found: ${id}`);
    Object.assign(m, clone(patch));
    return clone(m);
  }

  async cancelPendingOutboxForUser(userId: string, types?: OutboxMessage['type'][]): Promise<number> {
    let n = 0;
    for (const m of this.outbox) {
      if (m.userId === userId && m.status === 'pending' && (!types || types.includes(m.type))) {
        m.status = 'cancelled';
        n += 1;
      }
    }
    return n;
  }

  async countOutboxSentToUserSince(userId: string, type: OutboxMessage['type'], since: Date): Promise<number> {
    return this.outbox.filter(
      (m) => m.userId === userId && m.type === type && m.status === 'sent' && m.sentAt && m.sentAt.getTime() >= since.getTime(),
    ).length;
  }

  async listOutbox(filter?: { userId?: string; status?: string; limit?: number }): Promise<OutboxMessage[]> {
    let list = [...this.outbox];
    if (filter?.userId) list = list.filter((m) => m.userId === filter.userId);
    if (filter?.status) list = list.filter((m) => m.status === filter.status);
    return list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, filter?.limit ?? 100).map(clone);
  }

  // --- Tahlil ---------------------------------------------------------------

  async recordEvent(
    type: string,
    data: { userId?: string; siteLeadId?: string; dedupeKey?: string; properties?: Record<string, unknown> },
  ): Promise<AnalyticsEvent | null> {
    if (data.dedupeKey && this.analytics.some((e) => e.dedupeKey === data.dedupeKey)) return null;
    const e: AnalyticsEvent = {
      id: nid('an'),
      type,
      userId: data.userId ?? null,
      siteLeadId: data.siteLeadId ?? null,
      dedupeKey: data.dedupeKey ?? null,
      properties: data.properties ?? null,
      createdAt: new Date(),
    };
    this.analytics.push(e);
    return clone(e);
  }

  async countEvents(type: string, since?: Date): Promise<number> {
    return this.analytics.filter((e) => e.type === type && (!since || e.createdAt >= since)).length;
  }

  async countUniqueUsers(type: string, since?: Date): Promise<number> {
    const set = new Set(
      this.analytics
        .filter((e) => e.type === type && (!since || e.createdAt >= since) && e.userId)
        .map((e) => e.userId as string),
    );
    return set.size;
  }

  async listEventsByType(type: string, since?: Date, limit = 1000): Promise<AnalyticsEvent[]> {
    return this.analytics
      .filter((e) => e.type === type && (!since || e.createdAt >= since))
      .slice(0, limit)
      .map(clone);
  }

  // --- Audit ----------------------------------------------------------------

  async audit(entry: Omit<AuditLogEntry, 'id' | 'createdAt'>): Promise<AuditLogEntry> {
    const a: AuditLogEntry = { ...clone(entry), id: nid('audit'), createdAt: new Date() };
    this.auditLog.push(a);
    return clone(a);
  }

  async listAudit(filter?: { actorId?: string; entity?: string; limit?: number }): Promise<AuditLogEntry[]> {
    let list = [...this.auditLog];
    if (filter?.actorId) list = list.filter((a) => a.actorId === filter.actorId);
    if (filter?.entity) list = list.filter((a) => a.entity === filter.entity);
    return list.slice(-(filter?.limit ?? 200)).reverse().map(clone);
  }

  // --- Sozlamalar -----------------------------------------------------------

  async getSetting(key: string): Promise<unknown | null> {
    return this.settings.has(key) ? clone(this.settings.get(key)) : null;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    this.settings.set(key, clone(value));
  }

  async listSettings(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of this.settings) out[k] = clone(v);
    return out;
  }

  // --- Idempotency ----------------------------------------------------------

  async markUpdateProcessed(updateId: number): Promise<boolean> {
    if (this.processedUpdates.has(updateId)) return false;
    this.processedUpdates.add(updateId);
    return true;
  }
}
