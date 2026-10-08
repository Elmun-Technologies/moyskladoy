import type { Database, CreateSalesLeadInput, CreateSiteLeadInput, CreateUserInput, BlockStatusFilter } from '@app/shared';
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
} from '@app/shared';
import type { PrismaClientLike } from './client.js';

// ============================================================================
// PrismaDatabase - Database interfeysi'ning PostgreSQL implementatsiyasi.
//
// Muhim atomar operatsiyalar tranzaktsiya ichida bajariladi:
//  - claimLinkToken: token bir marta, bir user'ga biriktiriladi
//  - claimSalesLead: "O'zimga olish" - shartli UPDATE (assignedToId IS NULL)
// ============================================================================

type AnyRecord = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  return typeof v === 'bigint' ? Number(v) : Number(v);
}

function toDate(v: unknown): Date {
  return v instanceof Date ? v : new Date(String(v));
}

function decToNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return Number(v);
}

export class PrismaDatabase implements Database {
  constructor(private readonly prisma: PrismaClientLike) {}

  // --- Foydalanuvchilar ---------------------------------------------------

  async upsertTelegramUser(input: CreateUserInput): Promise<TelegramUser> {
    const u = await this.prisma.telegramUser.upsert({
      where: { telegramId: BigInt(input.telegramId) },
      create: {
        telegramId: BigInt(input.telegramId),
        username: input.username ?? null,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        languageCode: input.languageCode ?? null,
      },
      update: {
        username: input.username ?? undefined,
        firstName: input.firstName ?? undefined,
        lastName: input.lastName ?? undefined,
        languageCode: input.languageCode ?? undefined,
      },
    });
    return this.mapUser(u);
  }

  private mapUser(u: AnyRecord): TelegramUser {
    return {
      id: u.id,
      telegramId: toNum(u.telegramId),
      username: u.username,
      firstName: u.firstName,
      lastName: u.lastName,
      languageCode: u.languageCode,
      blockedAt: u.blockedAt ? toDate(u.blockedAt) : null,
      lastSeenAt: u.lastSeenAt ? toDate(u.lastSeenAt) : null,
      siteLeadId: u.siteLeadId,
      createdAt: toDate(u.createdAt),
      updatedAt: toDate(u.updatedAt),
    };
  }

  async getUserByTelegramId(telegramId: number): Promise<TelegramUser | null> {
    const u = await this.prisma.telegramUser.findUnique({ where: { telegramId: BigInt(telegramId) } });
    return u ? this.mapUser(u) : null;
  }

  async getUserById(id: string): Promise<TelegramUser | null> {
    const u = await this.prisma.telegramUser.findUnique({ where: { id } });
    return u ? this.mapUser(u) : null;
  }

  async updateUser(id: string, patch: Partial<TelegramUser>): Promise<TelegramUser> {
    const data: AnyRecord = {};
    if (patch.blockedAt !== undefined) data.blockedAt = patch.blockedAt;
    if (patch.lastSeenAt !== undefined) data.lastSeenAt = patch.lastSeenAt;
    if (patch.siteLeadId !== undefined) data.siteLeadId = patch.siteLeadId;
    if (patch.username !== undefined) data.username = patch.username;
    if (patch.firstName !== undefined) data.firstName = patch.firstName;
    if (patch.lastName !== undefined) data.lastName = patch.lastName;
    const u = await this.prisma.telegramUser.update({ where: { id }, data });
    return this.mapUser(u);
  }

  async listUsers(filter?: { search?: string; stage?: string; limit?: number; offset?: number }) {
    const where: AnyRecord = {};
    if (filter?.search) {
      where.OR = [
        { firstName: { contains: filter.search, mode: 'insensitive' } },
        { lastName: { contains: filter.search, mode: 'insensitive' } },
        { username: { contains: filter.search, mode: 'insensitive' } },
      ];
    }
    if (filter?.stage) where.state = { stage: filter.stage };
    const [rows, total] = await Promise.all([
      this.prisma.telegramUser.findMany({
        where,
        include: { state: true },
        orderBy: { createdAt: 'desc' },
        skip: filter?.offset ?? 0,
        take: filter?.limit ?? 50,
      }),
      this.prisma.telegramUser.count({ where }),
    ]);
    return {
      users: rows.map((u: AnyRecord) => ({ ...this.mapUser(u), state: u.state ? this.mapState(u.state) : null })),
      total,
    };
  }

  // --- Sayt so'rovlari va tokenlar ------------------------------------------

  async createSiteLead(input: CreateSiteLeadInput): Promise<SiteLead> {
    const l = await this.prisma.siteLead.create({
      data: {
        name: input.name,
        phone: input.phone,
        utmSource: input.utmSource ?? null,
        utmMedium: input.utmMedium ?? null,
        utmCampaign: input.utmCampaign ?? null,
        consentContact: input.consentContact,
        consentMarketing: input.consentMarketing,
        consentVersion: input.consentVersion,
        ipHash: input.ipHash ?? null,
      },
    });
    return this.mapSiteLead(l);
  }

  private mapSiteLead(l: AnyRecord): SiteLead {
    return {
      id: l.id,
      name: l.name,
      phone: l.phone,
      utmSource: l.utmSource,
      utmMedium: l.utmMedium,
      utmCampaign: l.utmCampaign,
      consentContact: l.consentContact,
      consentMarketing: l.consentMarketing,
      consentVersion: l.consentVersion,
      ipHash: l.ipHash,
      createdAt: toDate(l.createdAt),
    };
  }

  async getSiteLeadById(id: string): Promise<SiteLead | null> {
    const l = await this.prisma.siteLead.findUnique({ where: { id } });
    return l ? this.mapSiteLead(l) : null;
  }

  async createLinkToken(siteLeadId: string, ttlHours: number): Promise<LinkToken> {
    const { randomUUID } = await import('node:crypto');
    const t = await this.prisma.linkToken.create({
      data: {
        token: randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 8),
        siteLeadId,
        expiresAt: new Date(Date.now() + ttlHours * 3600_000),
      },
    });
    return this.mapLinkToken(t);
  }

  private mapLinkToken(t: AnyRecord): LinkToken {
    return {
      id: t.id,
      token: t.token,
      siteLeadId: t.siteLeadId,
      telegramUserId: t.telegramUserId,
      expiresAt: toDate(t.expiresAt),
      usedAt: t.usedAt ? toDate(t.usedAt) : null,
      createdAt: toDate(t.createdAt),
    };
  }

  async getLinkToken(token: string): Promise<LinkToken | null> {
    const t = await this.prisma.linkToken.findUnique({ where: { token } });
    return t ? this.mapLinkToken(t) : null;
  }

  async claimLinkToken(tokenStr: string, telegramUserId: string, now = new Date()) {
    return this.prisma.$transaction(async (tx: PrismaClientLike) => {
      const t = await tx.linkToken.findUnique({ where: { token: tokenStr } });
      if (!t) return { ok: false as const, reason: 'not_found' as const };
      if (t.telegramUserId && t.telegramUserId !== telegramUserId) {
        return { ok: false as const, reason: 'taken' as const, token: this.mapLinkToken(t) };
      }
      if (!t.telegramUserId && t.expiresAt.getTime() <= now.getTime()) {
        return { ok: false as const, reason: 'expired' as const, token: this.mapLinkToken(t) };
      }
      const updated = await tx.linkToken.update({
        where: { token: tokenStr },
        data: { telegramUserId, usedAt: t.telegramUserId ? t.usedAt : now },
      });
      // Foydalanuvchini sayt so'roviga bog'lash (agar bog'lanmagan bo'lsa)
      await tx.telegramUser.updateMany({
        where: { id: telegramUserId, siteLeadId: null },
        data: { siteLeadId: t.siteLeadId },
      });
      return { ok: true as const, token: this.mapLinkToken(updated) };
    });
  }

  // --- Suhbat holati -------------------------------------------------------

  private mapState(s: AnyRecord): ConversationState {
    return {
      id: s.id,
      userId: s.userId,
      stage: s.stage,
      answers: (s.answers ?? {}) as ConversationState['answers'],
      interestedProductId: s.interestedProductId,
      lessonLinkClickedAt: s.lessonLinkClickedAt ? toDate(s.lessonLinkClickedAt) : null,
      lessonWatchedAt: s.lessonWatchedAt ? toDate(s.lessonWatchedAt) : null,
      taskAnswer: s.taskAnswer,
      contactMethod: s.contactMethod,
      preferredTime: s.preferredTime,
      contactConsentGivenAt: s.contactConsentGivenAt ? toDate(s.contactConsentGivenAt) : null,
      salesStatus: s.salesStatus,
      humanHandling: s.humanHandling,
      lastReminderAt: s.lastReminderAt ? toDate(s.lastReminderAt) : null,
      createdAt: toDate(s.createdAt),
      updatedAt: toDate(s.updatedAt),
    };
  }

  async getState(userId: string): Promise<ConversationState | null> {
    const s = await this.prisma.conversationState.findUnique({ where: { userId } });
    return s ? this.mapState(s) : null;
  }

  async createState(userId: string, stage = 'START'): Promise<ConversationState> {
    const s = await this.prisma.conversationState.upsert({
      where: { userId },
      create: { userId, stage },
      update: {},
    });
    return this.mapState(s);
  }

  async updateState(userId: string, patch: Partial<ConversationState>): Promise<ConversationState> {
    const data: AnyRecord = {};
    for (const [k, v] of Object.entries(patch)) {
      if (['id', 'userId', 'createdAt', 'updatedAt'].includes(k)) continue;
      data[k] = v === undefined ? undefined : v;
    }
    const s = await this.prisma.conversationState.update({ where: { userId }, data });
    return this.mapState(s);
  }

  async appendEvent(userId: string, type: string, payload?: Record<string, unknown>): Promise<ConversationEvent> {
    const e = await this.prisma.conversationEvent.create({ data: { userId, type, payload: payload ?? null } });
    return { id: e.id, userId: e.userId, type: e.type, payload: e.payload ?? null, createdAt: toDate(e.createdAt) };
  }

  async listEvents(userId: string, limit = 100): Promise<ConversationEvent[]> {
    const rows = await this.prisma.conversationEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((e: AnyRecord) => ({
      id: e.id,
      userId: e.userId,
      type: e.type,
      payload: e.payload ?? null,
      createdAt: toDate(e.createdAt),
    }));
  }

  // --- Roziliklar -----------------------------------------------------------

  private mapConsent(c: AnyRecord): Consent {
    return {
      id: c.id,
      userId: c.userId,
      type: c.type,
      version: c.version,
      grantedAt: toDate(c.grantedAt),
      revokedAt: c.revokedAt ? toDate(c.revokedAt) : null,
    };
  }

  async grantConsent(userId: string, type: Consent['type'], version: string): Promise<Consent> {
    return this.prisma.$transaction(async (tx: PrismaClientLike) => {
      await tx.consent.updateMany({ where: { userId, type, revokedAt: null }, data: { revokedAt: new Date() } });
      const c = await tx.consent.create({ data: { userId, type, version } });
      return this.mapConsent(c);
    });
  }

  async revokeConsent(userId: string, type: Consent['type']): Promise<void> {
    await this.prisma.consent.updateMany({ where: { userId, type, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async hasActiveConsent(userId: string, type: Consent['type']): Promise<boolean> {
    const n = await this.prisma.consent.count({ where: { userId, type, revokedAt: null } });
    return n > 0;
  }

  async listConsents(userId: string): Promise<Consent[]> {
    const rows = await this.prisma.consent.findMany({ where: { userId }, orderBy: { grantedAt: 'desc' } });
    return rows.map((c: AnyRecord) => this.mapConsent(c));
  }

  // --- Mahsulotlar -----------------------------------------------------------

  private mapProduct(p: AnyRecord): Product {
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      kind: p.kind,
      description: p.description,
      details: (p.details ?? {}) as Product['details'],
      priceType: p.priceType,
      priceUsd: decToNum(p.priceUsd),
      currency: p.currency,
      isActive: p.isActive,
      visibleToUsers: p.visibleToUsers,
      currentVersionId: p.currentVersionId,
      createdAt: toDate(p.createdAt),
      updatedAt: toDate(p.updatedAt),
    };
  }

  async upsertProduct(
    product: Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'currentVersionId'> & { id?: string },
  ): Promise<Product> {
    const data: AnyRecord = {
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
    };
    const p = product.id
      ? await this.prisma.product.update({ where: { id: product.id }, data })
      : await this.prisma.product.upsert({ where: { slug: product.slug }, create: data, update: data });
    return this.mapProduct(p);
  }

  async getProductBySlug(slug: string): Promise<Product | null> {
    const p = await this.prisma.product.findUnique({ where: { slug } });
    return p ? this.mapProduct(p) : null;
  }

  async getProductById(id: string): Promise<Product | null> {
    const p = await this.prisma.product.findUnique({ where: { id } });
    return p ? this.mapProduct(p) : null;
  }

  async listProducts(includeHidden = false): Promise<Product[]> {
    const rows = await this.prisma.product.findMany({
      where: includeHidden ? {} : { visibleToUsers: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((p: AnyRecord) => this.mapProduct(p));
  }

  private mapProductVersion(v: AnyRecord): ProductVersion {
    return {
      id: v.id,
      productId: v.productId,
      version: v.version,
      name: v.name,
      description: v.description,
      details: (v.details ?? {}) as ProductVersion['details'],
      priceType: v.priceType,
      priceUsd: decToNum(v.priceUsd),
      createdAt: toDate(v.createdAt),
    };
  }

  async createProductVersion(
    productId: string,
    data: Omit<ProductVersion, 'id' | 'productId' | 'version' | 'createdAt'>,
  ): Promise<ProductVersion> {
    return this.prisma.$transaction(async (tx: PrismaClientLike) => {
      const last = await tx.productVersion.findFirst({ where: { productId }, orderBy: { version: 'desc' } });
      const pv = await tx.productVersion.create({
        data: {
          productId,
          version: (last?.version ?? 0) + 1,
          name: data.name,
          description: data.description,
          details: data.details,
          priceType: data.priceType,
          priceUsd: data.priceUsd,
        },
      });
      await tx.product.update({
        where: { id: productId },
        data: {
          currentVersionId: pv.id,
          name: data.name,
          description: data.description,
          details: data.details,
          priceType: data.priceType,
          priceUsd: data.priceUsd,
        },
      });
      return this.mapProductVersion(pv);
    });
  }

  async getProductVersion(id: string): Promise<ProductVersion | null> {
    const v = await this.prisma.productVersion.findUnique({ where: { id } });
    return v ? this.mapProductVersion(v) : null;
  }

  async listProductVersions(productId: string): Promise<ProductVersion[]> {
    const rows = await this.prisma.productVersion.findMany({ where: { productId }, orderBy: { version: 'asc' } });
    return rows.map((v: AnyRecord) => this.mapProductVersion(v));
  }

  async recordProductView(userId: string, productId: string, productVersionId: string): Promise<LeadProductView> {
    const v = await this.prisma.leadProductView.create({ data: { userId, productId, productVersionId } });
    return { id: v.id, userId: v.userId, productId: v.productId, productVersionId: v.productVersionId, viewedAt: toDate(v.viewedAt) };
  }

  async listProductViews(userId: string): Promise<LeadProductView[]> {
    const rows = await this.prisma.leadProductView.findMany({ where: { userId }, orderBy: { viewedAt: 'asc' } });
    return rows.map((v: AnyRecord) => ({
      id: v.id,
      userId: v.userId,
      productId: v.productId,
      productVersionId: v.productVersionId,
      viewedAt: toDate(v.viewedAt),
    }));
  }

  // --- Kontent bloklari -------------------------------------------------------

  private mapBlock(b: AnyRecord): ContentBlock {
    return {
      id: b.id,
      key: b.key,
      version: b.version,
      stage: b.stage,
      title: b.title,
      body: b.body,
      mediaType: b.mediaType,
      mediaId: b.mediaId,
      mediaSourceUrl: b.mediaSourceUrl,
      buttons: (b.buttons ?? []) as ContentBlock['buttons'],
      videoScript: (b.videoScript as string | null) ?? null,
      showCondition: b.showCondition ?? null,
      status: b.status,
      textFallbackAllowed: b.textFallbackAllowed,
      requiresMedia: b.requiresMedia,
      createdAt: toDate(b.createdAt),
      updatedAt: toDate(b.updatedAt),
    };
  }

  async upsertBlock(
    block: Omit<ContentBlock, 'id' | 'version' | 'createdAt' | 'updatedAt'> & { id?: string; version?: number },
  ): Promise<ContentBlock> {
    if (block.id) {
      const b = await this.prisma.contentBlock.update({
        where: { id: block.id },
        data: {
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
        },
      });
      return this.mapBlock(b);
    }
    const last = await this.prisma.contentBlock.findFirst({ where: { key: block.key }, orderBy: { version: 'desc' } });
    const b = await this.prisma.contentBlock.create({
      data: {
        key: block.key,
        version: block.version ?? (last?.version ?? 0) + 1,
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
      },
    });
    return this.mapBlock(b);
  }

  async getBlockByKey(key: string, status?: ContentBlock['status']): Promise<ContentBlock | null> {
    const b = await this.prisma.contentBlock.findFirst({
      where: { key, ...(status ? { status } : {}) },
      orderBy: { version: 'desc' },
    });
    return b ? this.mapBlock(b) : null;
  }

  async getBlockByStage(stage: string, status?: ContentBlock['status']): Promise<ContentBlock | null> {
    const b = await this.prisma.contentBlock.findFirst({
      where: { stage, ...(status ? { status } : {}) },
      orderBy: { version: 'desc' },
    });
    return b ? this.mapBlock(b) : null;
  }

  async listBlocks(filter?: { status?: BlockStatusFilter; stage?: string; search?: string }): Promise<ContentBlock[]> {
    const where: AnyRecord = {};
    if (filter?.status && filter.status !== 'all') where.status = filter.status;
    else where.status = { in: ['draft', 'approved'] };
    // Faqat so'nggi versiyani ko'rsatamiz
    const rows = await this.prisma.contentBlock.findMany({
      where: filter?.stage ? { ...where, stage: filter.stage } : where,
      orderBy: [{ key: 'asc' }, { version: 'desc' }],
    });
    const latest = new Map<string, AnyRecord>();
    for (const r of rows) if (!latest.has(r.key)) latest.set(r.key, r);
    let list = [...latest.values()];
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      list = list.filter((b) => b.key.toLowerCase().includes(q) || b.title.toLowerCase().includes(q) || b.body.toLowerCase().includes(q));
    }
    return list.map((b) => this.mapBlock(b));
  }

  async listBlockVersions(key: string): Promise<ContentBlock[]> {
    const rows = await this.prisma.contentBlock.findMany({ where: { key }, orderBy: { version: 'asc' } });
    return rows.map((b: AnyRecord) => this.mapBlock(b));
  }

  // --- Media -------------------------------------------------------------------

  private mapMedia(m: AnyRecord): Media {
    return {
      id: m.id,
      fileId: m.fileId,
      sourceUrl: m.sourceUrl,
      originalName: m.originalName,
      mimeType: m.mimeType,
      sizeBytes: m.sizeBytes,
      durationSec: m.durationSec,
      isVideoNote: m.isVideoNote,
      status: m.status,
      formatChecked: m.formatChecked,
      uploadedById: m.uploadedById,
      createdAt: toDate(m.createdAt),
    };
  }

  async createMedia(media: Omit<Media, 'id' | 'createdAt'>): Promise<Media> {
    const m = await this.prisma.media.create({
      data: {
        fileId: media.fileId,
        sourceUrl: media.sourceUrl,
        originalName: media.originalName,
        mimeType: media.mimeType,
        sizeBytes: media.sizeBytes,
        durationSec: media.durationSec,
        isVideoNote: media.isVideoNote,
        status: media.status,
        formatChecked: media.formatChecked,
        uploadedById: media.uploadedById,
      },
    });
    return this.mapMedia(m);
  }

  async updateMedia(id: string, patch: Partial<Media>): Promise<Media> {
    const data: AnyRecord = {};
    for (const [k, v] of Object.entries(patch)) if (k !== 'id' && k !== 'createdAt' && v !== undefined) data[k] = v;
    const m = await this.prisma.media.update({ where: { id }, data });
    return this.mapMedia(m);
  }

  async getMedia(id: string): Promise<Media | null> {
    const m = await this.prisma.media.findUnique({ where: { id } });
    return m ? this.mapMedia(m) : null;
  }

  async listMedia(filter?: { status?: string }): Promise<Media[]> {
    const rows = await this.prisma.media.findMany({
      where: filter?.status ? { status: filter.status } : {},
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((m: AnyRecord) => this.mapMedia(m));
  }

  // --- Sotuv --------------------------------------------------------------------

  private mapLead(l: AnyRecord): SalesLead {
    return {
      id: l.id,
      userId: l.userId,
      siteLeadId: l.siteLeadId,
      productId: l.productId,
      productVersionId: l.productVersionId,
      task: l.task,
      problem: l.problem,
      businessType: l.businessType,
      decisionMaker: l.decisionMaker,
      timeline: l.timeline,
      contactMethod: l.contactMethod,
      preferredTime: l.preferredTime,
      contactConsent: l.contactConsent,
      openQuestion: l.openQuestion,
      status: l.status,
      assignedToId: l.assignedToId,
      claimedAt: l.claimedAt ? toDate(l.claimedAt) : null,
      createdAt: toDate(l.createdAt),
      updatedAt: toDate(l.updatedAt),
    };
  }

  async createSalesLead(input: CreateSalesLeadInput): Promise<SalesLead> {
    return this.prisma.$transaction(async (tx: PrismaClientLike) => {
      const existing = await tx.salesLead.findFirst({
        where: {
          userId: input.userId,
          productId: input.productId ?? null,
          status: { notIn: ['purchased', 'not_fit', 'no_contact'] },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) return this.mapLead(existing);
      const lead = await tx.salesLead.create({
        data: {
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
        },
      });
      await tx.salesEvent.create({ data: { leadId: lead.id, type: 'created', payload: { productId: lead.productId } } });
      return this.mapLead(lead);
    });
  }

  async getSalesLead(id: string): Promise<SalesLead | null> {
    const l = await this.prisma.salesLead.findUnique({ where: { id } });
    return l ? this.mapLead(l) : null;
  }

  async getActiveLeadByUser(userId: string): Promise<SalesLead | null> {
    const l = await this.prisma.salesLead.findFirst({
      where: { userId, status: { notIn: ['purchased', 'not_fit', 'no_contact'] } },
      orderBy: { createdAt: 'desc' },
    });
    return l ? this.mapLead(l) : null;
  }

  async listSalesLeads(filter?: { status?: string; assignedToId?: string; limit?: number; offset?: number }) {
    const where: AnyRecord = {};
    if (filter?.status) where.status = filter.status;
    if (filter?.assignedToId) where.assignedToId = filter.assignedToId;
    const [rows, total] = await Promise.all([
      this.prisma.salesLead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter?.offset ?? 0,
        take: filter?.limit ?? 50,
      }),
      this.prisma.salesLead.count({ where }),
    ]);
    return { leads: rows.map((l: AnyRecord) => this.mapLead(l)), total };
  }

  async updateSalesLead(id: string, patch: Partial<SalesLead>): Promise<SalesLead> {
    const before = await this.prisma.salesLead.findUnique({ where: { id } });
    if (!before) throw new Error(`lead not found: ${id}`);
    const data: AnyRecord = {};
    for (const [k, v] of Object.entries(patch)) {
      if (['id', 'userId', 'createdAt', 'updatedAt'].includes(k) || v === undefined) continue;
      data[k] = v;
    }
    const l = await this.prisma.salesLead.update({ where: { id }, data });
    if (patch.status && patch.status !== before.status) {
      await this.prisma.salesEvent.create({
        data: { leadId: id, type: 'status_changed', payload: { from: before.status, to: patch.status } },
      });
    }
    return this.mapLead(l);
  }

  async claimSalesLead(leadId: string, adminId: string, now = new Date()) {
    return this.prisma.$transaction(async (tx: PrismaClientLike) => {
      // Shartli yangilash - bir vaqtda ikki xodim bir vaqtda bosganda faqat bittasi o'tadi
      const res = await tx.salesLead.updateMany({
        where: { id: leadId, assignedToId: null },
        data: { assignedToId: adminId, claimedAt: now, status: 'assigned' },
      });
      if (res.count === 0) {
        const existing = await tx.salesLead.findUnique({ where: { id: leadId } });
        if (!existing) return { ok: false as const, reason: 'not_found' as const };
        return { ok: false as const, reason: 'already_claimed' as const, lead: this.mapLead(existing) };
      }
      const lead = await tx.salesLead.findUnique({ where: { id: leadId } });
      await tx.salesEvent.create({ data: { leadId, type: 'claimed', payload: { adminId } } });
      return { ok: true as const, lead: this.mapLead(lead) };
    });
  }

  async appendSalesEvent(leadId: string, type: SalesEvent['type'], payload?: Record<string, unknown>): Promise<SalesEvent> {
    const e = await this.prisma.salesEvent.create({ data: { leadId, type, payload: payload ?? null } });
    return { id: e.id, leadId: e.leadId, type: e.type, payload: e.payload ?? null, createdAt: toDate(e.createdAt) };
  }

  async listSalesEvents(leadId: string): Promise<SalesEvent[]> {
    const rows = await this.prisma.salesEvent.findMany({ where: { leadId }, orderBy: { createdAt: 'asc' } });
    return rows.map((e: AnyRecord) => ({
      id: e.id,
      leadId: e.leadId,
      type: e.type,
      payload: e.payload ?? null,
      createdAt: toDate(e.createdAt),
    }));
  }

  // --- Yordam ----------------------------------------------------------------

  private mapHelp(h: AnyRecord): HelpRequest {
    return {
      id: h.id,
      userId: h.userId,
      question: h.question,
      status: h.status,
      answer: h.answer,
      answeredById: h.answeredById,
      createdAt: toDate(h.createdAt),
      updatedAt: toDate(h.updatedAt),
    };
  }

  async createHelpRequest(userId: string, question: string): Promise<HelpRequest> {
    const h = await this.prisma.helpRequest.create({ data: { userId, question } });
    return this.mapHelp(h);
  }

  async listHelpRequests(filter?: { status?: string }): Promise<HelpRequest[]> {
    const rows = await this.prisma.helpRequest.findMany({
      where: filter?.status ? { status: filter.status } : {},
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((h: AnyRecord) => this.mapHelp(h));
  }

  async updateHelpRequest(id: string, patch: Partial<HelpRequest>): Promise<HelpRequest> {
    const data: AnyRecord = {};
    for (const [k, v] of Object.entries(patch)) if (k !== 'id' && v !== undefined) data[k] = v;
    const h = await this.prisma.helpRequest.update({ where: { id }, data });
    return this.mapHelp(h);
  }

  // --- Admin ----------------------------------------------------------------

  private mapAdmin(a: AnyRecord): AdminUser {
    return {
      id: a.id,
      email: a.email,
      passwordHash: a.passwordHash,
      name: a.name,
      role: a.role,
      failedLogins: a.failedLogins,
      lockedUntil: a.lockedUntil ? toDate(a.lockedUntil) : null,
      lastLoginAt: a.lastLoginAt ? toDate(a.lastLoginAt) : null,
      createdAt: toDate(a.createdAt),
    };
  }

  async getAdminByEmail(email: string): Promise<AdminUser | null> {
    const a = await this.prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
    return a ? this.mapAdmin(a) : null;
  }

  async getAdminById(id: string): Promise<AdminUser | null> {
    const a = await this.prisma.adminUser.findUnique({ where: { id } });
    return a ? this.mapAdmin(a) : null;
  }

  async createAdmin(data: Omit<AdminUser, 'id' | 'createdAt'>): Promise<AdminUser> {
    const a = await this.prisma.adminUser.create({
      data: {
        email: data.email.toLowerCase(),
        passwordHash: data.passwordHash,
        name: data.name,
        role: data.role,
        failedLogins: data.failedLogins ?? 0,
        lockedUntil: data.lockedUntil ?? null,
        lastLoginAt: data.lastLoginAt ?? null,
      },
    });
    return this.mapAdmin(a);
  }

  async updateAdmin(id: string, patch: Partial<AdminUser>): Promise<AdminUser> {
    const data: AnyRecord = {};
    for (const [k, v] of Object.entries(patch)) if (k !== 'id' && k !== 'createdAt' && v !== undefined) data[k] = v;
    if (data.email) data.email = String(data.email).toLowerCase();
    const a = await this.prisma.adminUser.update({ where: { id }, data });
    return this.mapAdmin(a);
  }

  async listAdmins(): Promise<AdminUser[]> {
    const rows = await this.prisma.adminUser.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map((a: AnyRecord) => this.mapAdmin(a));
  }

  // --- Outbox ---------------------------------------------------------------

  private mapOutbox(m: AnyRecord): OutboxMessage {
    return {
      id: m.id,
      userId: m.userId,
      type: m.type,
      dedupeKey: m.dedupeKey,
      payload: (m.payload ?? {}) as OutboxMessage['payload'],
      scheduledFor: toDate(m.scheduledFor),
      status: m.status,
      attempts: m.attempts,
      nextAttemptAt: m.nextAttemptAt ? toDate(m.nextAttemptAt) : null,
      lastError: m.lastError,
      sentAt: m.sentAt ? toDate(m.sentAt) : null,
      createdAt: toDate(m.createdAt),
    };
  }

  async enqueueOutbox(
    msg: Omit<OutboxMessage, 'id' | 'status' | 'attempts' | 'nextAttemptAt' | 'lastError' | 'sentAt' | 'createdAt'>,
  ): Promise<OutboxMessage | null> {
    try {
      const m = await this.prisma.outboxMessage.create({
        data: {
          userId: msg.userId,
          type: msg.type,
          dedupeKey: msg.dedupeKey,
          payload: msg.payload,
          scheduledFor: msg.scheduledFor,
        },
      });
      return this.mapOutbox(m);
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (e?.code === 'P2002') return null; // dedupeKey takrorlangan - idempotent
      throw e;
    }
  }

  async listDueOutbox(now: Date, limit = 100): Promise<OutboxMessage[]> {
    const rows = await this.prisma.outboxMessage.findMany({
      where: { status: 'pending', scheduledFor: { lte: now } },
      orderBy: { scheduledFor: 'asc' },
      take: limit,
    });
    return rows.map((m: AnyRecord) => this.mapOutbox(m));
  }

  async updateOutbox(id: string, patch: Partial<OutboxMessage>): Promise<OutboxMessage> {
    const data: AnyRecord = {};
    for (const [k, v] of Object.entries(patch)) if (k !== 'id' && v !== undefined) data[k] = v;
    const m = await this.prisma.outboxMessage.update({ where: { id }, data });
    return this.mapOutbox(m);
  }

  async cancelPendingOutboxForUser(userId: string, types?: OutboxMessage['type'][]): Promise<number> {
    const res = await this.prisma.outboxMessage.updateMany({
      where: { userId, status: 'pending', ...(types ? { type: { in: types } } : {}) },
      data: { status: 'cancelled' },
    });
    return res.count;
  }

  async countOutboxSentToUserSince(userId: string, type: OutboxMessage['type'], since: Date): Promise<number> {
    return this.prisma.outboxMessage.count({ where: { userId, type, status: 'sent', sentAt: { gte: since } } });
  }

  async listOutbox(filter?: { userId?: string; status?: string; limit?: number }): Promise<OutboxMessage[]> {
    const rows = await this.prisma.outboxMessage.findMany({
      where: {
        ...(filter?.userId ? { userId: filter.userId } : {}),
        ...(filter?.status ? { status: filter.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: filter?.limit ?? 100,
    });
    return rows.map((m: AnyRecord) => this.mapOutbox(m));
  }

  // --- Tahlil ---------------------------------------------------------------

  private mapAnalytics(e: AnyRecord): AnalyticsEvent {
    return {
      id: e.id,
      type: e.type,
      userId: e.userId,
      siteLeadId: e.siteLeadId,
      dedupeKey: e.dedupeKey,
      properties: e.properties ?? null,
      createdAt: toDate(e.createdAt),
    };
  }

  async recordEvent(
    type: string,
    data: { userId?: string; siteLeadId?: string; dedupeKey?: string; properties?: Record<string, unknown> },
  ): Promise<AnalyticsEvent | null> {
    try {
      const e = await this.prisma.analyticsEvent.create({
        data: {
          type,
          userId: data.userId ?? null,
          siteLeadId: data.siteLeadId ?? null,
          dedupeKey: data.dedupeKey ?? null,
          properties: data.properties ?? null,
        },
      });
      return this.mapAnalytics(e);
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (err?.code === 'P2002') return null;
      throw err;
    }
  }

  async countEvents(type: string, since?: Date): Promise<number> {
    return this.prisma.analyticsEvent.count({ where: { type, ...(since ? { createdAt: { gte: since } } : {}) } });
  }

  async countUniqueUsers(type: string, since?: Date): Promise<number> {
    const rows = await this.prisma.analyticsEvent.findMany({
      where: { type, userId: { not: null }, ...(since ? { createdAt: { gte: since } } : {}) },
      select: { userId: true },
      distinct: ['userId'],
    });
    return rows.length;
  }

  async listEventsByType(type: string, since?: Date, limit = 1000): Promise<AnalyticsEvent[]> {
    const rows = await this.prisma.analyticsEvent.findMany({
      where: { type, ...(since ? { createdAt: { gte: since } } : {}) },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map((e: AnyRecord) => this.mapAnalytics(e));
  }

  // --- Audit ----------------------------------------------------------------

  async audit(entry: Omit<AuditLogEntry, 'id' | 'createdAt'>): Promise<AuditLogEntry> {
    const a = await this.prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        before: entry.before ?? null,
        after: entry.after ?? null,
        ip: entry.ip ?? null,
      },
    });
    return {
      id: a.id,
      actorId: a.actorId,
      action: a.action,
      entity: a.entity,
      entityId: a.entityId,
      before: a.before ?? null,
      after: a.after ?? null,
      ip: a.ip,
      createdAt: toDate(a.createdAt),
    };
  }

  async listAudit(filter?: { actorId?: string; entity?: string; limit?: number }): Promise<AuditLogEntry[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(filter?.actorId ? { actorId: filter.actorId } : {}),
        ...(filter?.entity ? { entity: filter.entity } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: filter?.limit ?? 200,
    });
    return rows.map((a: AnyRecord) => ({
      id: a.id,
      actorId: a.actorId,
      action: a.action,
      entity: a.entity,
      entityId: a.entityId,
      before: a.before ?? null,
      after: a.after ?? null,
      ip: a.ip,
      createdAt: toDate(a.createdAt),
    }));
  }

  // --- Sozlamalar -----------------------------------------------------------

  async getSetting(key: string): Promise<unknown | null> {
    const s = await this.prisma.setting.findUnique({ where: { key } });
    return s ? s.value : null;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.prisma.setting.upsert({ where: { key }, create: { key, value: value as AnyRecord }, update: { value: value as AnyRecord } });
  }

  async listSettings(): Promise<Record<string, unknown>> {
    const rows = await this.prisma.setting.findMany();
    const out: Record<string, unknown> = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  // --- Idempotency ----------------------------------------------------------

  async markUpdateProcessed(updateId: number): Promise<boolean> {
    try {
      await this.prisma.processedUpdate.create({ data: { updateId: BigInt(updateId) } });
      return true;
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (e?.code === 'P2002') return false;
      throw e;
    }
  }
}
