// ============================================================================
// Fastify app: sayt formasi (link-token), admin API (sessiya+CSRF+rollar),
// demo bot-simulyatsiya endpointlari. Log'larga P2P ma'lumot yozilmaydi.
// ============================================================================
import { randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { AdminRole, Database, SegmentFilters, Campaign, CampaignChannel, CampaignStatus, SmsMessage, StageFunnelRow } from '@app/shared';
import { CONSENT_TEXT_VERSION, ENGINE_STAGE_ORDER, EskizClient, estimateSmsCost, isWithinAttributionWindow, isWithinSendingWindow, isWithinSmsWindow, maskPhone, normalizeE164, sampleRecipient, SETTING_KEYS, smsSegmentCount, toPlainText, transitionCampaignStatus } from '@app/shared';
import type { ApiConfig } from './config.js';
import { hashIp, validateUploadName } from './security.js';

export interface AppDeps {
  db: Database;
  cfg: ApiConfig;
  /** demo mode: bot engine shu jarayon ichida (Telegram'siz). */
  demoEngine?: {
    simulate: (p: { telegramId: number; chatId?: number; text?: string; data?: string; updateId?: number }) => Promise<void>;
    sent: (tgId: number) => unknown[];
  };
  /** Injected fake Eskiz transport for tests; real credentials are optional. */
  smsApi?: { balance: () => Promise<{ balance: number | null; raw: Record<string, unknown> }> };
}

interface Session {
  adminId: string;
  role: AdminRole;
  email: string;
  csrf: string;
}

const SegmentDateRangeSchema = z.object({
  from: z.string().max(64).optional(),
  to: z.string().max(64).optional(),
}).strict().superRefine((range, ctx) => {
  for (const key of ['from', 'to'] as const) {
    const value = range[key];
    if (value && !Number.isFinite(Date.parse(value))) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'invalid_date' });
  }
  if (range.from && range.to && Date.parse(range.from) > Date.parse(range.to)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'date_range_order' });
  }
});

const SegmentFiltersSchema = z.object({
  stageKey: z.enum(ENGINE_STAGE_ORDER).optional(),
  stuckLongerThanDays: z.number().int().min(1).max(365).optional(),
  anyStageIn: z.array(z.enum(ENGINE_STAGE_ORDER)).max(48).optional(),
  neverReached: z.array(z.enum(ENGINE_STAGE_ORDER)).max(48).optional(),
  consentMarketing: z.boolean().optional(),
  hasPhone: z.boolean().optional(),
  smsConsent: z.boolean().optional(),
  lastActiveBetween: SegmentDateRangeSchema.optional(),
  createdBetween: SegmentDateRangeSchema.optional(),
  leadStatus: z.enum(['new', 'assigned', 'contacting', 'talked', 'later', 'purchased', 'not_fit', 'no_contact']).optional(),
  viewedProductIds: z.array(z.string().min(1).max(100)).max(50).optional(),
  blocked: z.literal(false).optional(),
  languageCode: z.string().min(2).max(16).optional(),
}).strict().superRefine((filters, ctx) => {
  if (filters.stuckLongerThanDays !== undefined && !filters.stageKey) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['stageKey'], message: 'required_for_stuck_filter' });
  }
});

const CampaignButtonSchema = z.object({ label: z.string().trim().min(1).max(64), action: z.string().min(1).max(64) }).strict().superRefine((button, ctx) => {
  const allowed = [
    /^campaign:[A-Za-z0-9_-]{1,80}$/,
    /^goto:[A-Z_]{2,40}$/,
    /^answer:[a-z_]{1,30}=[a-z0-9_]{1,40}$/,
    /^task:[a-z0-9_]{1,20}$/,
    /^lesson:(open|watched|resend|remind_tomorrow)$/,
    /^consent:(grant|grant_marketing|no_reminders|grant_contact|decline|revoke_marketing)$/,
    /^notif:(marketing|lessons|off|on)$/,
    /^contact:(phone|telegram)$/,
    /^submit:(send|edit)$/,
    /^cmd:(menu|stop|ask|back|edit)$/,
  ];
  if (!allowed.some((pattern) => pattern.test(button.action))) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['action'], message: 'button_action_not_allowed' });
});

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',') + '\r\n';
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { db, cfg } = deps;
  const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024 });
  const sessions = new Map<string, Session>();
  const loginAttempts = new Map<string, { count: number; first: number }>();
  const smsConfigured = !!(process.env.SMS_USER && process.env.SMS_PASSWORD);
  const smsApi = deps.smsApi ?? (smsConfigured ? new EskizClient({ email: process.env.SMS_USER!, password: process.env.SMS_PASSWORD!, from: process.env.SMS_FROM ?? '4546' }) : null);
  const smsUnitPrice = Math.max(0, Number(process.env.SMS_PRICE_PER_PART_UZS ?? 95));

  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"] } } });
  await app.register(cookie, { secret: cfg.sessionSecret });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  if (cfg.corsOrigins.length > 0) await app.register(cors, { origin: cfg.corsOrigins, credentials: true });

  // Fly/uptime tekshiruvi uchun (DB'ga yengil probe; ma'lumot chiqarmaydi).
  app.get('/healthz', async (_req, reply) => {
    try {
      await db.getSetting('healthz_probe');
      return { ok: true, mode: cfg.demoMode ? 'demo' : 'prod', ts: new Date().toISOString() };
    } catch {
      reply.code(503);
      return { ok: false };
    }
  });

  // --- sayt formasi ---------------------------------------------------------
  const SiteLeadSchema = z.object({
    name: z.string().trim().min(2).max(100),
    phone: z.string().trim().min(7).max(20).regex(/^[+\d][\d\s\-()]{5,18}$/, 'bad_phone'),
    utmSource: z.string().max(100).optional().nullable(),
    utmMedium: z.string().max(100).optional().nullable(),
    utmCampaign: z.string().max(100).optional().nullable(),
    consentContact: z.literal(true),
    consentMarketing: z.boolean().default(false),
    formStartedAt: z.number().int().positive(),
    website: z.string().max(4).optional(), // honeypot - to'ldirilsa rad
  });

  app.post('/api/site/lead', { config: { rateLimit: { max: cfg.formRateLimitMax, timeWindow: '10 minutes' } } as Record<string, unknown> }, async (req, reply) => {
    const parsed = SiteLeadSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(422).send({ ok: false, error: 'validation' });
    const b = parsed.data;
    if (b.website) return reply.code(422).send({ ok: false, error: 'validation' }); // honeypot
    const age = Date.now() - b.formStartedAt;
    if (!Number.isFinite(age) || age < cfg.formMinFillMs) return reply.code(429).send({ ok: false, error: 'too_fast' });
    const ip = req.ip ?? '';
    const ipHash = hashIp(ip, cfg.ipHashSalt);
    const lead = await db.createSiteLead({
      name: b.name,
      phone: b.phone,
      utmSource: b.utmSource ?? null,
      utmMedium: b.utmMedium ?? null,
      utmCampaign: b.utmCampaign ?? null,
      consentContact: true,
      consentMarketing: b.consentMarketing,
      consentVersion: CONSENT_TEXT_VERSION,
    });
    if (b.consentMarketing) {
      await db.recordEvent('site_marketing_consent_granted', { siteLeadId: lead.id, dedupeKey: `site:${lead.id}:marketing:${CONSENT_TEXT_VERSION}`, properties: { source: 'site', version: CONSENT_TEXT_VERSION } });
      await db.audit({ before: null, actorId: null, action: 'marketing.consent.grant.site', entity: 'site_lead', entityId: lead.id, after: { version: CONSENT_TEXT_VERSION }, ip: ipHash });
    }
    const token = await db.createLinkToken(lead.id, cfg.linkTokenTtlHours);
    await db.recordEvent('site_form_submitted', { siteLeadId: lead.id, dedupeKey: 'sf:' + lead.id, properties: { ipHash, utm: b.utmSource ?? null } });
    let link: string | null = null;
    if (cfg.botUsername) link = 'https://t.me/' + cfg.botUsername + '?start=' + token.token;
    // Linkda faqat random token bor - ism/telefon YO'Q.
    return reply.send({ ok: true, link, token: link ? null : token.token, expiresInHours: cfg.linkTokenTtlHours });
  });

  // --- demo: bot simulyatsiyasi (faqat demoMode) ---------------------------
  if (cfg.demoMode && deps.demoEngine) {
    const de = deps.demoEngine;
    app.post('/api/bot/simulate', async (req, reply) => {
      const b = z.object({ telegramId: z.number().int().positive(), chatId: z.number().int().optional(), text: z.string().max(1000).optional(), data: z.string().max(100).optional(), updateId: z.number().int().optional() }).safeParse(req.body);
      if (!b.success) return reply.code(422).send({ ok: false });
      await de.simulate(b.data);
      return reply.send({ ok: true });
    });
    app.get('/api/bot/sent/:tgId', async (req, reply) => {
      const p = z.object({ tgId: z.coerce.number().int().positive() }).safeParse(req.params);
      if (!p.success) return reply.code(400).send({ error: 'bad' });
      return reply.send({ messages: de.sent(p.data.tgId) });
    });
  }

  // --- auth + CSRF -----------------------------------------------------------
  const LOGIN_MAX = 5;
  const LOGIN_WINDOW_MS = 15 * 60 * 1000;

  app.post('/api/admin/login', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } as Record<string, unknown> }, async (req, reply) => {
    const b = z.object({ email: z.string().email().toLowerCase(), password: z.string().min(8).max(200) }).safeParse(req.body);
    if (!b.success) return reply.code(422).send({ ok: false, error: 'validation' });
    const key = hashIp(req.ip ?? '', cfg.ipHashSalt) + ':' + b.data.email;
    const at = loginAttempts.get(key);
    if (at && at.count >= LOGIN_MAX && Date.now() - at.first < LOGIN_WINDOW_MS) {
      return reply.code(423).send({ ok: false, error: 'locked' });
    }
    const admin = await db.getAdminByEmail(b.data.email);
    const ok = admin ? await bcrypt.compare(b.data.password, admin.passwordHash) : false;
    if (!admin || !ok) {
      const cur = at && Date.now() - at.first < LOGIN_WINDOW_MS ? at.count + 1 : 1;
      loginAttempts.set(key, { count: cur, first: at && Date.now() - at.first < LOGIN_WINDOW_MS ? at.first : Date.now() });
      return reply.code(401).send({ ok: false, error: 'bad_credentials' });
    }
    if (admin.lockedUntil && admin.lockedUntil.getTime() > Date.now()) return reply.code(423).send({ ok: false, error: 'locked' });
    loginAttempts.delete(key);
    if (admin.failedLogins > 0) await db.updateAdmin(admin.id, { failedLogins: 0, lastLoginAt: new Date() });
    const sid = randomUUID();
    const csrf = randomBytes(24).toString('hex');
    sessions.set(sid, { adminId: admin.id, role: admin.role, email: admin.email, csrf });
    reply.header('set-cookie', `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`);
    await db.audit({ before: null, actorId: admin.id, action: 'login', entity: 'admin', entityId: admin.id, ip: hashIp(req.ip ?? '', cfg.ipHashSalt), after: null });;
    return reply.send({ ok: true, role: admin.role, name: admin.name, csrf });
  });

  app.post('/api/admin/logout', async (req, reply) => {
    const sid = req.cookies?.sid;
    if (sid) sessions.delete(sid);
    reply.header('set-cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
    return reply.send({ ok: true });
  });

  app.get('/api/admin/me', async (req, reply) => {
    const s = sessions.get(req.cookies?.sid ?? '');
    if (!s) return reply.code(401).send({ ok: false });
    const admin = await db.getAdminById(s.adminId);
    return reply.send({ ok: true, role: s.role, email: admin?.email ?? null, name: admin?.name ?? null, csrf: s.csrf });
  });

  type Guard = (req: import('fastify').FastifyRequest) => Session | null;
  const guard = (roles: AdminRole[]): Guard => (req) => {
    const s = sessions.get(req.cookies?.sid ?? '');
    if (!s) return null;
    if (!roles.includes(s.role)) return null;
    return s;
  };
  const ALL: AdminRole[] = ['admin', 'sales', 'content_editor'];
  const ADMIN_ONLY: AdminRole[] = ['admin'];
  const NO_EDITOR: AdminRole[] = ['admin', 'sales'];

  async function withAuth<T>(req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply, roles: AdminRole[], write: boolean, fn: (s: Session) => Promise<T>): Promise<T | void> {
    const s = guard(roles)(req);
    if (!s) {
      await reply.code(403).send({ ok: false, error: 'forbidden' });
      return;
    }
    if (write && req.headers['x-csrf-token'] !== s.csrf) {
      await reply.code(403).send({ ok: false, error: 'csrf' });
      return;
    }
    return fn(s);
  }

  async function getCampaignAttribution(campaignId: string) {
    const events = await db.listAnalyticsEvents({ campaignId, types: ['campaign_click', 'campaign_reply', 'link_opened'], limit: 50000 });
    const unique = (type: string) => new Set(events.filter((event) => event.type === type && event.userId).map((event) => event.userId)).size;
    return {
      clicks: events.filter((event) => event.type === 'campaign_click').length,
      uniqueClickers: unique('campaign_click'),
      replies: events.filter((event) => event.type === 'campaign_reply').length,
      uniqueRepliers: unique('campaign_reply'),
      linkOpens: events.filter((event) => event.type === 'link_opened').length,
      uniqueLinkOpeners: unique('link_opened'),
    };
  }

  async function cancelCampaignQueues(campaignId: string): Promise<number> {
    let cancelled = 0;
    const outbox = await db.listOutbox({ campaignId, status: 'pending', limit: 50000 });
    for (const row of outbox) {
      await db.updateOutbox(row.id, { status: 'cancelled', lastError: 'cancelled_by_admin', skippedReason: 'cancelled' });
      cancelled++;
    }
    const smsRows = await db.listSmsMessages({ campaignId, status: 'queued', limit: 50000 });
    for (const row of smsRows) {
      await db.updateSmsMessage(row.id, { status: 'cancelled', lastError: 'cancelled_by_admin', skippedReason: 'cancelled' });
      cancelled++;
    }
    return cancelled;
  }

  function dateWindow(query: { from?: Date; to?: Date }): { from: Date; to: Date } | null {
    const to = query.to ?? new Date();
    const from = query.from ?? new Date(to.getTime() - 30 * 86_400_000);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) return null;
    return { from, to };
  }

  // --- stats -----------------------------------------------------------------
  app.get('/api/admin/stats', async (req, reply) => {
    return withAuth(req, reply, ALL, false, async () => {
      const stages = ['bot_start', 'stage:START', 'stage:EXPERIENCE_VIDEO', 'stage:LESSON_INTRO', 'task_answered', 'lesson_self_reported_watched', 'stage:OFFERS', 'sales_lead_created', 'link_token_claimed'];
      const funnel: Record<string, { total: number; users: number }> = {};
      for (const t of stages) funnel[t] = { total: await db.countEvents(t), users: await db.countUniqueUsers(t) };
      const now = new Date();
      const [users, leads, outbox, smsRows, campaigns, topStages] = await Promise.all([
        db.listUsers({ limit: 50000, offset: 0 }),
        db.listSalesLeads({ limit: 50000, offset: 0 }),
        db.listOutbox({ limit: 50000 }),
        db.listSmsMessages({ limit: 50000 }),
        db.listCampaigns(5),
        db.getStageFunnel(new Date(now.getTime() - 30 * 86_400_000), now),
      ]);
      const byStatus: Record<string, number> = {};
      for (const l of leads.leads) byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
      const windows = [
        ['today', 1], ['7d', 7], ['30d', 30],
      ] as const;
      const periods: Record<string, { newUsers: number; completed: number; conversionPct: number; active: number; leads: number; messagesSent: number }> = {};
      for (const [key, days] of windows) {
        const since = new Date(now.getTime() - days * 86_400_000);
        const newUsers = users.users.filter((u) => u.createdAt >= since).length;
        const completedUsers = new Set((await db.listEventsByType('sales_lead_created', since, 50000)).map((e) => e.userId).filter(Boolean)).size;
        const startUsers = await db.countUniqueUsers('bot_start', since);
        const active = users.users.filter((u) => u.lastSeenAt && u.lastSeenAt >= since).length;
        const leadCount = leads.leads.filter((l) => l.createdAt >= since).length;
        const messageCount = outbox.filter((m) => m.payload.testOnly !== true && m.status === 'sent' && m.sentAt && m.sentAt >= since).length + smsRows.filter((m) => !m.isTest && ['sent', 'delivered'].includes(m.status) && m.sentAt && m.sentAt >= since).length;
        periods[key] = { newUsers, completed: completedUsers, conversionPct: startUsers ? Math.round(completedUsers / startUsers * 10000) / 100 : 0, active, leads: leadCount, messagesSent: messageCount };
      }
      const recentCampaigns = await Promise.all(campaigns.map(async (campaign) => ({ ...campaign, stats: await db.getCampaignDeliverySummary(campaign.id) })));
      return {
        funnel,
        leads: { total: leads.total, byStatus },
        periods,
        topStages: topStages.sort((a, b) => b.viewed - a.viewed).slice(0, 8),
        campaigns: recentCampaigns,
      };
    });
  });

  // --- segments: preview/sample + saved filters -------------------------------
  app.post('/api/admin/segments/preview', async (req, reply) => {
    return withAuth(req, reply, ALL, false, async (s) => {
      const b = z.object({ channel: z.enum(['telegram', 'sms']), filters: SegmentFiltersSchema.default({}) }).strict().safeParse(req.body);
      if (!b.success) return reply.code(422).send({ ok: false, error: 'validation', details: b.error.issues.map((issue) => issue.path.join('.')) });
      const result = await db.previewSegment(b.data.filters, b.data.channel);
      const sample = result.sample.map((recipient) => {
        const row = sampleRecipient(recipient);
        return s.role === 'content_editor' ? { ...row, phone: row.phone ? maskPhone(row.phone) : null } : row;
      });
      return { ok: true, count: result.count, sample, filters: b.data.filters, channel: b.data.channel };
    });
  });

  app.get('/api/admin/segments', async (req, reply) => {
    return withAuth(req, reply, ALL, false, async () => ({ segments: await db.listSavedSegments() }));
  });

  app.post('/api/admin/segments', async (req, reply) => {
    return withAuth(req, reply, ['admin', 'content_editor'], true, async (s) => {
      const b = z.object({ name: z.string().trim().min(1).max(100), filters: SegmentFiltersSchema }).strict().safeParse(req.body);
      if (!b.success) return reply.code(422).send({ ok: false, error: 'validation' });
      const segment = await db.createSavedSegment({ name: b.data.name, ownerId: s.adminId, filtersJson: b.data.filters as SegmentFilters });
      await db.audit({ actorId: s.adminId, action: 'segment.create', entity: 'saved_segment', entityId: segment.id, before: null, after: { name: segment.name }, ip: hashIp(req.ip ?? '', cfg.ipHashSalt) });
      return reply.code(201).send({ ok: true, segment });
    });
  });

  app.delete('/api/admin/segments/:id', async (req, reply) => {
    return withAuth(req, reply, ADMIN_ONLY, true, async (s) => {
      const p = z.object({ id: z.string().min(1).max(100) }).safeParse(req.params);
      if (!p.success) return reply.code(400).send({ ok: false });
      const deleted = await db.deleteSavedSegment(p.data.id);
      if (!deleted) return reply.code(404).send({ ok: false, error: 'not_found' });
      await db.audit({ actorId: s.adminId, action: 'segment.delete', entity: 'saved_segment', entityId: p.data.id, before: null, after: null, ip: hashIp(req.ip ?? '', cfg.ipHashSalt) });
      return reply.send({ ok: true });
    });
  });

  // --- funnel / retention / source and button analytics ------------------------
  app.get('/api/admin/funnel', async (req, reply) => {
    return withAuth(req, reply, ALL, false, async () => {
      const q = z.object({
        from: z.coerce.date().optional(), to: z.coerce.date().optional(),
        by: z.enum(['day', 'week']).default('day'),
        stuckAfterDays: z.coerce.number().int().min(0).max(365).default(7),
        cohort: z.literal('weekly').optional(),
      }).strict().safeParse(req.query);
      if (!q.success) return reply.code(400).send({ ok: false, error: 'bad_query' });
      const window = dateWindow(q.data);
      if (!window) return reply.code(400).send({ ok: false, error: 'bad_date_range' });
      const [tracked, series, cohorts] = await Promise.all([
        db.getStageFunnel(window.from, window.to, q.data.stuckAfterDays),
        db.getStageFunnelSeries(window.from, window.to, q.data.by),
        q.data.cohort === 'weekly' ? db.getRetentionCohorts(window.from, window.to) : Promise.resolve([]),
      ]);
      const trackedByKey = new Map(tracked.map((row) => [row.stageKey, row]));
      const stages: StageFunnelRow[] = ENGINE_STAGE_ORDER.map((stageKey, stepOrder) => trackedByKey.get(stageKey) ?? {
        stageKey, stepOrder, viewed: 0, completed: 0, stuck: 0, conversionPct: 0, medianMinutes: null,
      });
      return { ok: true, from: window.from.toISOString(), to: window.to.toISOString(), by: q.data.by, hasData: tracked.length > 0, stages, series, cohorts };
    });
  });

  app.get('/api/admin/retention', async (req, reply) => {
    return withAuth(req, reply, ALL, false, async () => {
      const q = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }).strict().safeParse(req.query);
      if (!q.success) return reply.code(400).send({ ok: false });
      const window = dateWindow(q.data);
      if (!window) return reply.code(400).send({ ok: false, error: 'bad_date_range' });
      return { ok: true, from: window.from.toISOString(), to: window.to.toISOString(), cohorts: await db.getRetentionCohorts(window.from, window.to) };
    });
  });

  app.get('/api/admin/analytics/sources', async (req, reply) => {
    return withAuth(req, reply, ALL, false, async () => {
      const q = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }).strict().safeParse(req.query);
      if (!q.success) return reply.code(400).send({ ok: false });
      const window = dateWindow(q.data);
      if (!window) return reply.code(400).send({ ok: false, error: 'bad_date_range' });
      const events = await db.listAnalyticsEvents({ types: ['start_source'], from: window.from, to: window.to, limit: 50000 });
      const sources = new Map<string, { starts: number; users: Set<string> }>();
      const leadCache = new Map<string, string>();
      for (const event of events) {
        const raw = event.properties?.source;
        let label = 'organic';
        let mapped: string | undefined;
        if (event.siteLeadId) {
          const key = `lead:${event.siteLeadId}`;
          mapped = leadCache.get(key);
          if (!mapped) {
            const lead = await db.getSiteLeadById(event.siteLeadId);
            mapped = lead?.utmSource ? `utm:${lead.utmSource.slice(0, 40)}` : 'site_form';
            leadCache.set(key, mapped);
          }
        } else if (typeof raw === 'string' && raw) {
          // Legacy event compatibility; new events store the lead relation, not its bearer token.
          mapped = leadCache.get(raw);
          if (!mapped) {
            const token = await db.getLinkToken(raw);
            if (token) {
              const lead = await db.getSiteLeadById(token.siteLeadId);
              mapped = lead?.utmSource ? `utm:${lead.utmSource.slice(0, 40)}` : 'site_form';
              leadCache.set(raw, mapped);
            }
          }
        }
        if (mapped) label = mapped;
        else if (typeof raw === 'string' && raw) {
          if (/^campaign:[A-Za-z0-9_-]{1,80}$/.test(raw)) label = raw;
          else if (raw === 'site_lead_link' || raw === 'deep_link') label = 'deep_link';
          else label = `start:${raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'other'}`;
        }
        const row = sources.get(label) ?? { starts: 0, users: new Set<string>() };
        row.starts++;
        if (event.userId) row.users.add(event.userId);
        sources.set(label, row);
      }
      return { ok: true, sources: [...sources.entries()].map(([source, row]) => ({ source, starts: row.starts, uniqueUsers: row.users.size })).sort((a, b) => b.starts - a.starts) };
    });
  });

  app.get('/api/admin/analytics/buttons', async (req, reply) => {
    return withAuth(req, reply, ALL, false, async () => {
      const q = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }).strict().safeParse(req.query);
      if (!q.success) return reply.code(400).send({ ok: false });
      const window = dateWindow(q.data);
      if (!window) return reply.code(400).send({ ok: false, error: 'bad_date_range' });
      const events = await db.listAnalyticsEvents({ typePrefix: 'button_click:', from: window.from, to: window.to, limit: 50000 });
      const grouped = new Map<string, { stageKey: string; blockId: string; action: string; clicks: number; users: Set<string> }>();
      for (const event of events) {
        const props = event.properties ?? {};
        const blockId = typeof props.blockId === 'string' ? props.blockId : event.type.slice('button_click:'.length);
        const stageKey = typeof props.stageKey === 'string' ? props.stageKey : 'UNKNOWN';
        const action = typeof props.action === 'string' ? props.action : '';
        const key = `${blockId}:${action}`;
        const row = grouped.get(key) ?? { stageKey, blockId, action, clicks: 0, users: new Set<string>() };
        row.clicks++;
        if (event.userId) row.users.add(event.userId);
        grouped.set(key, row);
      }
      return { ok: true, buttons: [...grouped.values()].map(({ users, ...row }) => ({ ...row, uniqueUsers: users.size })).sort((a, b) => b.clicks - a.clicks) };
    });
  });

  // --- Telegram/SMS campaigns --------------------------------------------------
  app.get('/api/admin/campaigns', async (req, reply) => {
    return withAuth(req, reply, ALL, false, async () => {
      const q = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).strict().safeParse(req.query);
      if (!q.success) return reply.code(400).send({ ok: false });
      const campaigns = await db.listCampaigns(q.data.limit);
      return {
        campaigns: await Promise.all(campaigns.map(async (campaign) => ({
          ...campaign,
          stats: await db.getCampaignDeliverySummary(campaign.id),
        }))),
        smsConfigured: !!smsApi,
        smsMissingEnv: smsApi ? [] : ['SMS_USER', 'SMS_PASSWORD'],
      };
    });
  });

  app.post('/api/admin/campaigns', async (req, reply) => {
    return withAuth(req, reply, ADMIN_ONLY, true, async (s) => {
      const b = z.object({
        name: z.string().trim().min(1).max(100),
        channel: z.enum(['telegram', 'sms']),
        filters: SegmentFiltersSchema.default({}),
        templateText: z.string().trim().min(1).max(4000),
        buttons: z.array(CampaignButtonSchema).max(10).default([]),
        mediaId: z.string().min(1).max(100).nullable().optional(),
        scheduledFor: z.string().datetime().nullable().optional(),
      }).strict().safeParse(req.body);
      if (!b.success) return reply.code(422).send({ ok: false, error: 'validation', details: b.error.issues.map((issue) => issue.path.join('.')) });
      if (b.data.channel === 'sms' && (b.data.templateText.length > 3500 || b.data.buttons.length || b.data.mediaId)) {
        return reply.code(422).send({ ok: false, error: 'sms_campaign_content_invalid' });
      }
      const scheduledFor = b.data.scheduledFor ? new Date(b.data.scheduledFor) : null;
      if (scheduledFor && scheduledFor <= new Date()) return reply.code(422).send({ ok: false, error: 'schedule_must_be_future' });
      let mediaId: string | null = null;
      if (b.data.mediaId) {
        if (b.data.channel !== 'telegram') return reply.code(422).send({ ok: false, error: 'sms_media_not_supported' });
        const media = await db.getMedia(b.data.mediaId);
        if (!media?.fileId || media.status !== 'approved') return reply.code(422).send({ ok: false, error: 'media_not_approved' });
        mediaId = media.id;
      }
      const campaign = await db.createCampaign({
        name: b.data.name,
        channel: b.data.channel as CampaignChannel,
        segmentJson: b.data.filters as SegmentFilters,
        templateText: b.data.templateText,
        buttonsJson: b.data.buttons,
        mediaId,
        status: scheduledFor ? 'scheduled' : 'draft',
        scheduledFor,
        smsConfirmedAt: null,
        createdById: s.adminId,
      });
      await db.audit({ actorId: s.adminId, action: 'campaign.create', entity: 'campaign', entityId: campaign.id, before: null, after: { channel: campaign.channel, status: campaign.status, scheduledFor: campaign.scheduledFor?.toISOString() ?? null }, ip: hashIp(req.ip ?? '', cfg.ipHashSalt) });
      return reply.code(201).send({ ok: true, campaign });
    });
  });

  app.get('/api/admin/campaigns/:id', async (req, reply) => {
    return withAuth(req, reply, ALL, false, async () => {
      const p = z.object({ id: z.string().min(1).max(100) }).safeParse(req.params);
      if (!p.success) return reply.code(400).send({ ok: false });
      const campaign = await db.getCampaign(p.data.id);
      if (!campaign) return reply.code(404).send({ ok: false, error: 'not_found' });
      const [stats, attribution] = await Promise.all([
        db.getCampaignDeliverySummary(campaign.id),
        getCampaignAttribution(campaign.id),
      ]);
      return { campaign, stats, attribution };
    });
  });

  app.post('/api/admin/campaigns/:id/start', async (req, reply) => {
    return withAuth(req, reply, ADMIN_ONLY, true, async (s) => {
      const p = z.object({ id: z.string().min(1).max(100) }).safeParse(req.params);
      if (!p.success) return reply.code(400).send({ ok: false });
      const campaign = await db.getCampaign(p.data.id);
      if (!campaign) return reply.code(404).send({ ok: false, error: 'not_found' });
      if (campaign.channel === 'sms' && !campaign.smsConfirmedAt) return reply.code(409).send({ ok: false, error: 'sms_confirmation_required' });
      let status: CampaignStatus;
      try { status = transitionCampaignStatus(campaign.status, 'running'); }
      catch (error) { return reply.code(409).send({ ok: false, error: (error as Error).message }); }
      const updated = await db.updateCampaign(campaign.id, { status, scheduledFor: null, startsAt: campaign.startsAt ?? new Date() });
      await db.audit({ actorId: s.adminId, action: 'campaign.start', entity: 'campaign', entityId: campaign.id, before: { status: campaign.status }, after: { status: updated.status }, ip: hashIp(req.ip ?? '', cfg.ipHashSalt) });
      return reply.send({ ok: true, campaign: updated });
    });
  });

  app.post('/api/admin/campaigns/:id/schedule', async (req, reply) => {
    return withAuth(req, reply, ADMIN_ONLY, true, async (s) => {
      const p = z.object({ id: z.string().min(1).max(100) }).safeParse(req.params);
      const b = z.object({ scheduledFor: z.string().datetime() }).strict().safeParse(req.body);
      if (!p.success || !b.success) return reply.code(400).send({ ok: false, error: 'validation' });
      const when = new Date(b.data.scheduledFor);
      if (when <= new Date()) return reply.code(422).send({ ok: false, error: 'schedule_must_be_future' });
      const campaign = await db.getCampaign(p.data.id);
      if (!campaign) return reply.code(404).send({ ok: false, error: 'not_found' });
      let status: CampaignStatus;
      try { status = transitionCampaignStatus(campaign.status, 'scheduled'); }
      catch (error) { return reply.code(409).send({ ok: false, error: (error as Error).message }); }
      const updated = await db.updateCampaign(campaign.id, { status, scheduledFor: when });
      await db.audit({ actorId: s.adminId, action: 'campaign.schedule', entity: 'campaign', entityId: campaign.id, before: { status: campaign.status }, after: { status: updated.status, scheduledFor: when.toISOString() }, ip: hashIp(req.ip ?? '', cfg.ipHashSalt) });
      return reply.send({ ok: true, campaign: updated });
    });
  });

  app.post('/api/admin/campaigns/:id/pause', async (req, reply) => {
    return withAuth(req, reply, ADMIN_ONLY, true, async (s) => {
      const p = z.object({ id: z.string().min(1).max(100) }).safeParse(req.params);
      if (!p.success) return reply.code(400).send({ ok: false });
      const campaign = await db.getCampaign(p.data.id);
      if (!campaign) return reply.code(404).send({ ok: false, error: 'not_found' });
      let status: CampaignStatus;
      try { status = transitionCampaignStatus(campaign.status, 'paused'); }
      catch (error) { return reply.code(409).send({ ok: false, error: (error as Error).message }); }
      const updated = await db.updateCampaign(campaign.id, { status });
      await db.audit({ actorId: s.adminId, action: 'campaign.pause', entity: 'campaign', entityId: campaign.id, before: { status: campaign.status }, after: { status: updated.status }, ip: hashIp(req.ip ?? '', cfg.ipHashSalt) });
      return reply.send({ ok: true, campaign: updated });
    });
  });

  app.post('/api/admin/campaigns/:id/resume', async (req, reply) => {
    return withAuth(req, reply, ADMIN_ONLY, true, async (s) => {
      const p = z.object({ id: z.string().min(1).max(100) }).safeParse(req.params);
      if (!p.success) return reply.code(400).send({ ok: false });
      const campaign = await db.getCampaign(p.data.id);
      if (!campaign) return reply.code(404).send({ ok: false, error: 'not_found' });
      if (campaign.status !== 'paused') return reply.code(409).send({ ok: false, error: 'campaign_not_paused' });
      if (campaign.channel === 'sms' && !campaign.smsConfirmedAt) return reply.code(409).send({ ok: false, error: 'sms_confirmation_required' });
      const keepScheduled = !!campaign.scheduledFor && campaign.scheduledFor > new Date();
      const nextStatus: CampaignStatus = keepScheduled ? 'scheduled' : 'running';
      const status = transitionCampaignStatus('paused', nextStatus);
      const updated = await db.updateCampaign(campaign.id, { status, scheduledFor: keepScheduled ? campaign.scheduledFor : null, startsAt: campaign.startsAt ?? (keepScheduled ? null : new Date()) });
      await db.audit({ actorId: s.adminId, action: 'campaign.resume', entity: 'campaign', entityId: campaign.id, before: { status: campaign.status }, after: { status: updated.status }, ip: hashIp(req.ip ?? '', cfg.ipHashSalt) });
      return reply.send({ ok: true, campaign: updated });
    });
  });

  app.post('/api/admin/campaigns/:id/cancel', async (req, reply) => {
    return withAuth(req, reply, ADMIN_ONLY, true, async (s) => {
      const p = z.object({ id: z.string().min(1).max(100) }).safeParse(req.params);
      if (!p.success) return reply.code(400).send({ ok: false });
      const campaign = await db.getCampaign(p.data.id);
      if (!campaign) return reply.code(404).send({ ok: false, error: 'not_found' });
      let status: CampaignStatus;
      try { status = transitionCampaignStatus(campaign.status, 'cancelled'); }
      catch (error) { return reply.code(409).send({ ok: false, error: (error as Error).message }); }
      const updated = await db.updateCampaign(campaign.id, { status, endsAt: new Date() });
      const cancelled = await cancelCampaignQueues(campaign.id);
      await db.audit({ actorId: s.adminId, action: 'campaign.cancel', entity: 'campaign', entityId: campaign.id, before: { status: campaign.status }, after: { status: updated.status, queuedCancelled: cancelled }, ip: hashIp(req.ip ?? '', cfg.ipHashSalt) });
      return reply.send({ ok: true, campaign: updated, queuedCancelled: cancelled });
    });
  });

  app.post('/api/admin/campaigns/:id/test', async (req, reply) => {
    return withAuth(req, reply, ADMIN_ONLY, true, async (s) => {
      const p = z.object({ id: z.string().min(1).max(100) }).safeParse(req.params);
      if (!p.success) return reply.code(400).send({ ok: false });
      const campaign = await db.getCampaign(p.data.id);
      if (!campaign) return reply.code(404).send({ ok: false, error: 'not_found' });
      if (campaign.channel === 'telegram') {
        const b = z.object({ telegramId: z.number().int().positive() }).strict().safeParse(req.body);
        if (!b.success) return reply.code(422).send({ ok: false, error: 'telegram_id_required' });
        const user = await db.getUserByTelegramId(b.data.telegramId);
        if (!user) return reply.code(404).send({ ok: false, error: 'test_user_not_found' });
        if (user.blockedAt || !(await db.hasActiveConsent(user.id, 'marketing'))) return reply.code(409).send({ ok: false, error: 'test_recipient_not_eligible' });
        const state = await db.getState(user.id);
        const name = user.firstName?.trim() || 'test';
        const text = toPlainText(campaign.templateText.replace(/\{\{?\s*ism\s*\}?\}/gi, name).replace(/\{\{?\s*bosqich\s*\}?\}/gi, state?.stage ?? 'START')).slice(0, 3900);
        const buttons = (Array.isArray(campaign.buttonsJson) ? campaign.buttonsJson : []).flatMap((entry) => {
          if (!entry || typeof entry !== 'object') return [];
          const button = entry as { label?: unknown; action?: unknown };
          if (typeof button.label !== 'string' || typeof button.action !== 'string' || button.action.startsWith('campaign:')) return [];
          return [{ label: button.label, action: button.action }];
        }).slice(0, 10);
        const media = campaign.mediaId ? await db.getMedia(campaign.mediaId) : null;
        await db.enqueueOutbox({
          userId: user.id,
          type: 'marketing',
          dedupeKey: `campaign-test:${campaign.id}:${randomUUID()}`,
          payload: {
            text, buttons, testOnly: true, chatId: user.telegramId,
            ...(media?.fileId ? { mediaFileId: media.fileId, mediaType: media.isVideoNote ? 'video_note' : media.mimeType?.startsWith('image/') ? 'image' : 'video' } : {}),
          },
          scheduledFor: new Date(),
        });
        await db.audit({ actorId: s.adminId, action: 'campaign.test.send', entity: 'campaign', entityId: campaign.id, before: null, after: { channel: 'telegram', userId: user.id }, ip: hashIp(req.ip ?? '', cfg.ipHashSalt) });
        return reply.code(202).send({ ok: true, queued: true, channel: 'telegram' });
      }
      const b = z.object({ phone: z.string().trim().min(7).max(24) }).strict().safeParse(req.body);
      if (!b.success) return reply.code(422).send({ ok: false, error: 'phone_required' });
      const phone = normalizeE164(b.data.phone);
      if (!phone) return reply.code(422).send({ ok: false, error: 'bad_phone' });
      const recipientPhone = await db.getUserPhoneByPhone(phone);
      if (!recipientPhone?.smsConsent || !(await db.hasActiveConsent(recipientPhone.userId, 'sms_marketing'))) {
        return reply.code(409).send({ ok: false, error: 'test_recipient_not_eligible' });
      }
      const message = await db.createSmsMessage({
        campaignId: null, userId: recipientPhone.userId, phone,
        text: toPlainText(campaign.templateText.replace(/\{\{?\s*ism\s*\}?\}/gi, 'test').replace(/\{\{?\s*bosqich\s*\}?\}/gi, 'START')).slice(0, 3500),
        status: 'queued', externalId: null, lastError: null, skippedReason: null,
        sentAt: null, reportedAt: null, isTest: true,
      });
      if (!message) return reply.code(500).send({ ok: false, error: 'test_queue_failed' });
      await db.audit({ actorId: s.adminId, action: 'campaign.test.send', entity: 'campaign', entityId: campaign.id, before: null, after: { channel: 'sms', smsMessageId: message.id, phone: maskPhone(phone) }, ip: hashIp(req.ip ?? '', cfg.ipHashSalt) });
      return reply.code(202).send({ ok: true, queued: true, channel: 'sms', smsMessageId: message.id, providerConfigured: !!smsApi, missingEnv: smsApi ? [] : ['SMS_USER', 'SMS_PASSWORD'] });
    });
  });

  app.get('/api/admin/campaigns/:id/export.csv', async (req, reply) => {
    return withAuth(req, reply, NO_EDITOR, false, async (s) => {
      const p = z.object({ id: z.string().min(1).max(100) }).safeParse(req.params);
      if (!p.success) return reply.code(400).send({ ok: false });
      const campaign = await db.getCampaign(p.data.id);
      if (!campaign) return reply.code(404).send({ ok: false, error: 'not_found' });
      const summary = await db.getCampaignDeliverySummary(campaign.id);
      await db.audit({ actorId: s.adminId, action: 'campaign.export.csv', entity: 'campaign', entityId: campaign.id, before: null, after: { rows: summary.planned }, ip: hashIp(req.ip ?? '', cfg.ipHashSalt) });
      const stream = Readable.from((async function* () {
        yield csvRow(['userId', 'telegramId', 'status', 'sentAt', 'error']);
        const userIds = new Set<string>();
        for (const message of await db.listOutbox({ campaignId: campaign.id, limit: 50000 })) userIds.add(message.userId);
        for (const message of await db.listSmsMessages({ campaignId: campaign.id, limit: 50000 })) if (!message.isTest && message.userId) userIds.add(message.userId);
        const userMap = new Map<string, number>();
        for (const userId of userIds) {
          const user = await db.getUserById(userId);
          if (user) userMap.set(userId, user.telegramId);
        }
        let offset = 0;
        while (true) {
          const batch = await db.listOutbox({ campaignId: campaign.id, limit: 500, offset });
          if (!batch.length) break;
          for (const message of batch) yield csvRow([message.userId, userMap.get(message.userId) ?? '', message.status, message.sentAt?.toISOString() ?? '', message.lastError ?? message.skippedReason ?? '']);
          offset += batch.length;
          if (batch.length < 500) break;
        }
        offset = 0;
        while (true) {
          const batch = await db.listSmsMessages({ campaignId: campaign.id, limit: 500, offset });
          if (!batch.length) break;
          for (const message of batch) {
            if (message.isTest) continue;
            yield csvRow([message.userId ?? '', message.userId ? userMap.get(message.userId) ?? '' : '', message.status, message.sentAt?.toISOString() ?? '', message.lastError ?? message.skippedReason ?? '']);
          }
          offset += batch.length;
          if (batch.length < 500) break;
        }
      })());
      return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="campaign-${campaign.id}.csv"`).send(stream);
    });
  });

  // --- SMS provider: estimate/confirmation/balance/price/delivery reports -----
  app.get('/api/admin/sms/balance', async (req, reply) => {
    return withAuth(req, reply, NO_EDITOR, false, async () => {
      if (!smsApi) return { ok: true, configured: false, missingEnv: ['SMS_USER', 'SMS_PASSWORD'], balance: null, currency: 'UZS' };
      try {
        const result = await smsApi.balance();
        return { ok: true, configured: true, missingEnv: [], balance: result.balance, currency: 'UZS' };
      } catch {
        return reply.code(502).send({ ok: false, configured: true, error: 'sms_balance_unavailable' });
      }
    });
  });

  app.get('/api/admin/sms/price', async (req, reply) => {
    return withAuth(req, reply, ALL, false, async () => ({ ok: true, unitPriceUzs: smsUnitPrice, source: process.env.SMS_PRICE_PER_PART_UZS ? 'SMS_PRICE_PER_PART_UZS' : 'default_estimate', isAccountQuote: false }));
  });

  app.post('/api/admin/sms/estimate', async (req, reply) => {
    return withAuth(req, reply, ALL, false, async () => {
      const b = z.object({
        campaignId: z.string().min(1).max(100).optional(),
        savedSegmentId: z.string().min(1).max(100).optional(),
        filters: SegmentFiltersSchema.optional(),
        text: z.string().min(1).max(3500).optional(),
      }).strict().safeParse(req.body);
      if (!b.success) return reply.code(422).send({ ok: false, error: 'validation' });
      let filters: SegmentFilters = b.data.filters ?? {};
      let text = b.data.text ?? '';
      if (b.data.savedSegmentId) {
        const segment = (await db.listSavedSegments()).find((item) => item.id === b.data.savedSegmentId);
        if (!segment) return reply.code(404).send({ ok: false, error: 'segment_not_found' });
        if (!b.data.filters) filters = segment.filtersJson;
      }
      if (b.data.campaignId) {
        const campaign = await db.getCampaign(b.data.campaignId);
        if (!campaign) return reply.code(404).send({ ok: false, error: 'campaign_not_found' });
        if (campaign.channel !== 'sms') return reply.code(422).send({ ok: false, error: 'not_sms_campaign' });
        if (!b.data.filters) filters = campaign.segmentJson;
        if (!b.data.text) text = campaign.templateText;
      }
      if (!text) return reply.code(422).send({ ok: false, error: 'text_required' });
      // Price only the currently sendable segment (phone + both consent records).
      const eligible = await db.previewSegment({ ...filters, hasPhone: true, smsConsent: true, blocked: false }, 'sms');
      const parts = smsSegmentCount(toPlainText(text));
      return { ok: true, recipientCount: eligible.count, partsPerRecipient: parts, unitPriceUzs: smsUnitPrice, totalUzs: estimateSmsCost(eligible.count, toPlainText(text), smsUnitPrice), isAccountQuote: false };
    });
  });

  app.post('/api/admin/sms/confirm', async (req, reply) => {
    return withAuth(req, reply, ADMIN_ONLY, true, async (s) => {
      const b = z.object({ campaignId: z.string().min(1).max(100), expectedRecipientCount: z.number().int().min(0), expectedCostUzs: z.number().min(0) }).strict().safeParse(req.body);
      if (!b.success) return reply.code(422).send({ ok: false, error: 'validation' });
      const campaign = await db.getCampaign(b.data.campaignId);
      if (!campaign) return reply.code(404).send({ ok: false, error: 'not_found' });
      if (campaign.channel !== 'sms') return reply.code(422).send({ ok: false, error: 'not_sms_campaign' });
      if (!['draft', 'scheduled'].includes(campaign.status)) return reply.code(409).send({ ok: false, error: 'campaign_not_confirmable' });
      const eligible = await db.previewSegment({ ...campaign.segmentJson, hasPhone: true, smsConsent: true, blocked: false }, 'sms');
      const cost = estimateSmsCost(eligible.count, toPlainText(campaign.templateText), smsUnitPrice);
      if (eligible.count !== b.data.expectedRecipientCount || Math.abs(cost - b.data.expectedCostUzs) > 0.01) {
        return reply.code(409).send({ ok: false, error: 'estimate_changed', estimate: { recipientCount: eligible.count, totalUzs: cost, unitPriceUzs: smsUnitPrice, partsPerRecipient: smsSegmentCount(toPlainText(campaign.templateText)) } });
      }
      const confirmedAt = new Date();
      const updated = await db.updateCampaign(campaign.id, { smsConfirmedAt: confirmedAt });
      await db.audit({ actorId: s.adminId, action: 'sms.estimate.confirm', entity: 'campaign', entityId: campaign.id, before: { smsConfirmedAt: campaign.smsConfirmedAt?.toISOString() ?? null }, after: { smsConfirmedAt: confirmedAt.toISOString(), recipientCount: eligible.count, totalUzs: cost, unitPriceUzs: smsUnitPrice }, ip: hashIp(req.ip ?? '', cfg.ipHashSalt) });
      return reply.send({ ok: true, campaign: updated, estimate: { recipientCount: eligible.count, totalUzs: cost, unitPriceUzs: smsUnitPrice } });
    });
  });

  app.get('/api/admin/sms/reports', async (req, reply) => {
    return withAuth(req, reply, NO_EDITOR, false, async (s) => {
      const q = z.object({ campaignId: z.string().min(1).max(100).optional(), status: z.enum(['queued', 'sending', 'sent', 'delivered', 'failed', 'cancelled']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }).strict().safeParse(req.query);
      if (!q.success) return reply.code(400).send({ ok: false });
      const messages = await db.listSmsMessages(q.data);
      const safeMessages = s.role === 'content_editor' ? messages.map((m) => ({ ...m, phone: maskPhone(m.phone), text: '[yashirilgan]' })) : messages;
      return { messages: safeMessages, limit: q.data.limit, offset: q.data.offset };
    });
  });

  // --- users / leads -----------------------------------------------------------
  app.get('/api/admin/users', async (req, reply) => {
    return withAuth(req, reply, ALL, false, async (s) => {
      const q = z.object({ search: z.string().optional(), stage: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }).safeParse(req.query);
      if (!q.success) return reply.code(400).send({ ok: false });
      const r = await db.listUsers(q.data);
      const mask = s.role === 'content_editor';
      const users = await Promise.all(
        r.users.map(async (u) => {
          const [phone, siteLead] = await Promise.all([
            db.getUserPhone(u.id),
            u.siteLeadId ? db.getSiteLeadById(u.siteLeadId) : Promise.resolve(null),
          ]);
          return {
            id: u.id,
            telegramId: u.telegramId,
            username: u.username,
            firstName: u.firstName,
            blockedAt: u.blockedAt,
            stage: u.state?.stage ?? 'START',
            salesStatus: u.state?.salesStatus ?? 'none',
            phone: mask ? null : phone?.phone ?? siteLead?.phone ?? null,
            phoneVerified: mask ? false : phone?.verified ?? false,
            smsConsent: mask ? false : phone?.smsConsent ?? false,
          };
        }),
      );
      return { users, total: r.total };
    });
  });

  app.get('/api/admin/leads', async (req, reply) => {
    return withAuth(req, reply, ALL, false, async () => {
      const q = z.object({ status: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }).safeParse(req.query);
      if (!q.success) return reply.code(400).send({ ok: false });
      return await db.listSalesLeads(q.data);
    });
  });

  app.post('/api/admin/leads/:id/claim', async (req, reply) => {
    return withAuth(req, reply, NO_EDITOR, true, async (s) => {
      const p = z.object({ id: z.string().min(1) }).safeParse(req.params);
      if (!p.success) return reply.code(400).send({ ok: false });
      const res = await db.claimSalesLead(p.data.id, s.adminId);
      if (res.ok) await db.appendSalesEvent(p.data.id, 'claimed', { via: 'admin' });
      await db.audit({ before: null, actorId: s.adminId, action: 'claim_lead', entity: 'sales_lead', entityId: p.data.id, ip: hashIp(req.ip ?? '', cfg.ipHashSalt), after: null });;
      return reply.send({ ok: res.ok, reason: res.reason ?? null });
    });
  });

  const LEAD_STATUS: import('@app/shared').LeadStatus[] = ['new', 'assigned', 'contacting', 'talked', 'later', 'purchased', 'not_fit', 'no_contact'];
  app.post('/api/admin/leads/:id/status', async (req, reply) => {
    return withAuth(req, reply, NO_EDITOR, true, async (s) => {
      const p = z.object({ id: z.string().min(1) }).safeParse(req.params);
      const b = z.object({ status: z.enum(['new', 'assigned', 'contacting', 'talked', 'later', 'purchased', 'not_fit', 'no_contact']), note: z.string().max(2000).optional() }).safeParse(req.body);
      if (!p.success || !b.success) return reply.code(400).send({ ok: false });
      const lead = await db.getSalesLead(p.data.id);
      if (!lead) return reply.code(404).send({ ok: false });
      await db.updateSalesLead(p.data.id, { status: b.data.status });
      if (b.data.note) await db.appendSalesEvent(p.data.id, 'note', { text: b.data.note.slice(0, 2000) });
      await db.appendSalesEvent(p.data.id, b.data.status === 'purchased' ? 'purchase_confirmed' : 'status_changed', { from: lead.status, to: b.data.status });
      // Xarid tasdiqlansa: bot holati yangilanadi (eski tugmalar endi ishlamaydi),
      // barcha navbatlar to'xtatiladi.
      if (b.data.status === 'purchased') {
        await db.updateState(lead.userId, { salesStatus: 'purchased' });
        await db.cancelPendingOutboxForUser(lead.userId);
      }
      if (['not_fit', 'no_contact', 'later'].includes(b.data.status)) {
        await db.updateState(lead.userId, { salesStatus: 'not_ready' });
      }
      await db.audit({ before: null, actorId: s.adminId, action: 'lead_status', entity: 'sales_lead', entityId: p.data.id, after: { to: b.data.status }, ip: hashIp(req.ip ?? '', cfg.ipHashSalt) });;
      return reply.send({ ok: true });
    });
  });

  // --- content blocks: draft -> preview -> approve (versiyali) ----------------
  app.get('/api/admin/blocks', async (req, reply) => {
    return withAuth(req, reply, ALL, false, async () => {
      const q = z.object({ status: z.enum(['draft', 'approved', 'all']).default('all'), stage: z.string().optional(), search: z.string().optional() }).safeParse(req.query);
      if (!q.success) return reply.code(400).send({ ok: false });
      const blocks = await db.listBlocks(q.data);
      // Admin ogohlantirishi: majburiy media bloklari uchun material yo'qmi?
      const missingMedia = blocks.filter((bl) => bl.requiresMedia && !bl.mediaId && bl.status === 'approved').map((bl) => bl.key);
      return { blocks, missingMedia };
    });
  });

  app.get('/api/admin/blocks/:key/versions', async (req, reply) => {
    return withAuth(req, reply, ALL, false, async () => {
      const p = z.object({ key: z.string().min(1) }).safeParse(req.params);
      if (!p.success) return reply.code(400).send({ ok: false });
      return { versions: await db.listBlockVersions(p.data.key) };
    });
  });

  app.post('/api/admin/blocks', async (req, reply) => {
    return withAuth(req, reply, ['admin', 'content_editor'], true, async (s) => {
      const b = z
        .object({
          key: z.string().min(1).max(64),
          stage: z.string().max(40).nullable().optional(),
          title: z.string().max(120),
          body: z.string().max(4000),
          mediaType: z.enum(['video_note', 'video', 'image', 'text']).nullable().optional(),
          mediaId: z.string().max(200).nullable().optional(),
          mediaSourceUrl: z.string().max(500).nullable().optional(),
          buttons: z
            .array(z.object({ label: z.string().min(1).max(64), action: z.string().min(1).max(64), hidden: z.boolean().optional() }))
            .max(12)
            .optional(),
          requiresMedia: z.boolean().optional(),
          textFallbackAllowed: z.boolean().optional(),
          videoScript: z.string().max(4000).nullable().optional(),
          showCondition: z
            .object({
              lessonLinkRequired: z.boolean().optional(),
              requiresVisibleProducts: z.boolean().optional(),
              requiresAnswer: z.string().max(40).optional(),
              skipIfMarketingConsent: z.boolean().optional(),
              onlyStages: z.array(z.string().max(40)).max(60).optional(),
              requiredSettings: z
                .array(z.string().regex(/^[a-z0-9_]{1,40}$/))
                .max(6)
                .optional(),
            })
            .nullable()
            .optional(),
        })
        .safeParse(req.body);
      if (!b.success) return reply.code(400).send({ ok: false, error: 'validation' });
      const ACTION_PATTERNS: RegExp[] = [
        /^goto:[A-Z_]{2,40}$/,
        /^answer:[a-z_]{1,30}=[a-z0-9_]{1,40}$/,
        /^task:[a-z0-9_]{1,20}$/,
        /^lesson:(open|watched|resend|remind_tomorrow)$/,
        /^consent:(grant|grant_marketing|no_reminders|grant_contact|decline|revoke_marketing)$/,
        /^notif:(marketing|lessons|off|on)$/,
        /^contact:(phone|telegram)$/,
        /^submit:(send|edit)$/,
        /^cmd:(menu|stop|ask|back|edit)$/,
      ];
      const btnErrors: string[] = [];
      for (const btn of b.data.buttons ?? []) {
        const known = ACTION_PATTERNS.some((re2) => re2.test(btn.action));
        if (!known) {
          btnErrors.push("tugma amali ru'xsat etilmagan: " + btn.action.slice(0, 48));
          continue;
        }
        const g = /^goto:([A-Z_]+)$/.exec(btn.action);
        if (g) {
          const target = await db.getBlockByStage(g[1]!, 'approved');
          if (!target) btnErrors.push("goto maqsadida tasdiqlangan blok yo'q: " + btn.action);
        }
      }
      if (btnErrors.length > 0) return reply.code(422).send({ ok: false, error: 'buttons_invalid', details: btnErrors });
      if (b.data.mediaId) {
        const catalog = await db.listMedia();
        if (!catalog.some((m) => m.fileId === b.data.mediaId)) {
          return reply.code(422).send({ ok: false, error: 'media_not_in_catalog', hint: "Avval Media bo'limidan file_id oling yoki fayl yuklang" });
        }
      }
      // Saqlash DRAFT sifatida - faqat approve'dan keyin bot yuboradi.
      const cur = await db.getBlockByKey(b.data.key, 'approved');
      const block = await db.upsertBlock({
        key: b.data.key,
        stage: (b.data.stage ?? cur?.stage ?? null) as never,
        title: b.data.title,
        body: b.data.body,
        mediaType: b.data.mediaType ?? cur?.mediaType ?? 'text',
        mediaId: b.data.mediaId ?? null,
        mediaSourceUrl: b.data.mediaSourceUrl ?? null,
        buttons: b.data.buttons ?? cur?.buttons ?? [],
        videoScript: b.data.videoScript ?? cur?.videoScript ?? null,
        showCondition: (b.data.showCondition !== undefined ? (b.data.showCondition ?? null) : (cur?.showCondition ?? null)) as never,
        status: 'draft',
        textFallbackAllowed: b.data.textFallbackAllowed ?? true,
        requiresMedia: b.data.requiresMedia ?? false,
      });
      await db.audit({ actorId: s.adminId, action: 'block_save_draft', entity: 'content_block', entityId: block.id, before: null, after: { key: block.key, version: block.version, buttons: (block.buttons ?? []).length }, ip: hashIp(req.ip ?? '', cfg.ipHashSalt) });
      return reply.send({ ok: true, id: block.id, version: block.version });
    });
  });

  app.post('/api/admin/blocks/:id/preview', async (req, reply) => {
    return withAuth(req, reply, ['admin', 'content_editor'], false, async () => {
      const p = z.object({ id: z.string().min(1) }).safeParse(req.params);
      if (!p.success) return reply.code(400).send({ ok: false });
      const all = await db.listBlocks({ status: 'all' });
      const bl = all.find((x) => x.id === p.data.id);
      if (!bl) return reply.code(404).send({ ok: false });
      const mediaOk = !bl.requiresMedia || !!bl.mediaId || bl.textFallbackAllowed;
      return reply.send({ ok: true, preview: { text: bl.body, buttons: bl.buttons, media: bl.mediaId ? { type: bl.mediaType, id: bl.mediaId } : null, mediaWarning: !bl.mediaId && bl.requiresMedia ? 'media_missing' : null }, sendable: mediaOk });
    });
  });

  app.post('/api/admin/blocks/:id/approve', async (req, reply) => {
    return withAuth(req, reply, ADMIN_ONLY, true, async (s) => {
      const p = z.object({ id: z.string().min(1) }).safeParse(req.params);
      if (!p.success) return reply.code(400).send({ ok: false });
      const all = await db.listBlocks({ status: 'all' });
      const bl = all.find((x) => x.id === p.data.id);
      if (!bl) return reply.code(404).send({ ok: false });
      if (bl.requiresMedia && !bl.mediaId && !bl.textFallbackAllowed) {
        return reply.code(409).send({ ok: false, error: 'media_required' });
      }
      const updated = await db.upsertBlock({ ...bl, status: 'approved' });
      await db.audit({ before: null, actorId: s.adminId, action: 'block_approve', entity: 'content_block', entityId: bl.id, after: { key: bl.key, version: updated.version }, ip: hashIp(req.ip ?? '', cfg.ipHashSalt) });;
      return reply.send({ ok: true });
    });
  });

  // --- products / prices (narxni faqat admin o'zgartiradi) --------------------
  app.get('/api/admin/products', async (req, reply) => {
    return withAuth(req, reply, ALL, false, async () => ({ products: await db.listProducts(true) }));
  });

  app.post('/api/admin/products', async (req, reply) => {
    return withAuth(req, reply, ADMIN_ONLY, true, async (s) => {
      const b = z
        .object({
          slug: z.string().min(1).max(64),
          kind: z.enum(['course', 'video_lessons', 'service', 'special_offer']),
          name: z.string().max(120),
          description: z.string().max(2000),
          priceType: z.enum(['fixed', 'by_scope', 'unconfirmed']),
          priceUsd: z.number().int().min(0).max(1000000).nullable().optional(),
          pricingText: z.string().max(1000).nullable().optional(),
          visibleToUsers: z.boolean().optional(),
          details: z.record(z.unknown()).optional(),
        })
        .safeParse(req.body);
      if (!b.success) return reply.code(400).send({ ok: false, error: 'validation' });
      const product = await db.upsertProduct({
        slug: b.data.slug,
        kind: b.data.kind,
        name: b.data.name,
        description: b.data.description,
        details: { ...(b.data.details ?? {}), pricingText: b.data.pricingText ?? null },
        priceType: b.data.priceType,
        priceUsd: b.data.priceUsd ?? null,
        currency: 'USD',
        isActive: true,
        visibleToUsers: b.data.visibleToUsers ?? true,
      });
      const version = await db.createProductVersion(product.id, {
        name: b.data.name,
        description: b.data.description,
        details: { pricingText: b.data.pricingText ?? null },
        priceType: b.data.priceType,
        priceUsd: b.data.priceUsd ?? null,
      });
      await db.audit({ before: null, actorId: s.adminId, action: 'product_update', entity: 'product', entityId: product.id, after: { priceType: b.data.priceType, priceUsd: b.data.priceUsd ?? null }, ip: hashIp(req.ip ?? '', cfg.ipHashSalt) });;
      return reply.send({ ok: true, productId: product.id, versionId: version.id });
    });
  });

  // --- help requests -----------------------------------------------------------
  app.get('/api/admin/help', async (req, reply) => {
    return withAuth(req, reply, ALL, false, async () => ({ requests: await db.listHelpRequests({}) }));
  });

  app.post('/api/admin/help/:id/answer', async (req, reply) => {
    return withAuth(req, reply, NO_EDITOR, true, async (s) => {
      const p = z.object({ id: z.string().min(1) }).safeParse(req.params);
      const b = z.object({ answer: z.string().min(1).max(3000) }).safeParse(req.body);
      if (!p.success || !b.success) return reply.code(400).send({ ok: false });
      const hr = await db.updateHelpRequest(p.data.id, { status: 'answered', answer: b.data.answer, answeredById: s.adminId });
      const user = await db.getUserById(hr.userId);
      if (user) await db.enqueueOutbox({ userId: user.id, type: 'notification', dedupeKey: `help:ans:${p.data.id}:${Date.now()}`, payload: { text: 'Jamoavimiz javobi: ' + b.data.answer.slice(0, 2000) }, scheduledFor: new Date() });
      return reply.send({ ok: true });
    });
  });

  // --- settings / consents / outbox / audit / export ----------------------------
  app.get('/api/admin/settings', async (req, reply) => {
    return withAuth(req, reply, ALL, false, async () => ({ settings: await db.listSettings() }));
  });

  app.post('/api/admin/settings', async (req, reply) => {
    return withAuth(req, reply, ADMIN_ONLY, true, async (s) => {
      const b = z.object({ key: z.string().min(1).max(64), value: z.unknown() }).safeParse(req.body);
      if (!b.success) return reply.code(400).send({ ok: false });
      const ALLOWED = new Set<string>([...Object.values(SETTING_KEYS), 'sales_staff']);
      if (!ALLOWED.has(b.data.key)) return reply.code(422).send({ ok: false, error: 'key_forbidden' });
      await db.setSetting(b.data.key, b.data.value);
      await db.audit({ before: null, actorId: s.adminId, action: 'setting_update', entity: 'setting', entityId: b.data.key, after: null, ip: hashIp(req.ip ?? '', cfg.ipHashSalt) });;;
      return reply.send({ ok: true });
    });
  });

  app.get('/api/admin/outbox', async (req, reply) => {
    return withAuth(req, reply, ALL, false, async () => ({ outbox: await db.listOutbox({ limit: 200 }) }));
  });

  app.get('/api/admin/audit', async (req, reply) => {
    return withAuth(req, reply, ADMIN_ONLY, false, async () => ({ entries: await db.listAudit({ limit: 200 }) }));
  });

  app.post('/api/admin/export/contacts', async (req, reply) => {
    return withAuth(req, reply, ADMIN_ONLY, true, async (s) => {
      // Eksport - faqat admin; har safar audit'lanadi.
      const { users } = await db.listUsers({ limit: 5000, offset: 0 });
      const rows: { telegramId: number; name: string; phone: string | null; stage: string }[] = [];
      for (const u of users) {
        const sl = u.siteLeadId ? await db.getSiteLeadById(u.siteLeadId) : null;
        rows.push({ telegramId: u.telegramId, name: sl?.name ?? u.firstName ?? '', phone: sl?.phone ?? null, stage: u.state?.stage ?? 'START' });
      }
      await db.audit({ before: null, actorId: s.adminId, action: 'export_contacts', entity: 'users', entityId: 'all', after: { count: rows.length }, ip: hashIp(req.ip ?? '', cfg.ipHashSalt) });;
      return reply.send({ ok: true, count: rows.length, rows });
    });
  });

  app.post('/api/admin/users/:id/delete', async (req, reply) => {
    return withAuth(req, reply, ADMIN_ONLY, true, async (s) => {
      const p = z.object({ id: z.string().min(1) }).safeParse(req.params);
      if (!p.success) return reply.code(400).send({ ok: false });
      const user = await db.getUserById(p.data.id);
      if (!user) return reply.code(404).send({ ok: false });
      // "o'chirish" = belgilash + navbatlarni to'xtatish (qonuniy saqlash muddati tekshiriladi)
      await db.updateUser(user.id, { blockedAt: new Date() });
      await db.cancelPendingOutboxForUser(user.id);
      await db.audit({ before: null, actorId: s.adminId, action: 'user_delete_request', entity: 'user', entityId: user.id, after: null, ip: hashIp(req.ip ?? '', cfg.ipHashSalt) });;;
      return reply.send({ ok: true, mode: 'soft', note: cfg.retentionDays > 0 ? `hard delete ${cfg.retentionDays} kundan so'ng worker tomonida` : 'hard delete hali yo\'q (RETENTION_DAYS=0)' });
    });
  });

  // --- media katalogi (Telegram file_id boshqaruvi) ---------------------------
  app.get('/api/admin/media', async (req, reply) => {
    return withAuth(req, reply, ALL, false, async () => ({ media: await db.listMedia() }));
  });

  app.post('/api/admin/media', async (req, reply) => {
    return withAuth(req, reply, ['admin', 'content_editor'], true, async (s) => {
      const b = z.object({ originalName: z.string().min(1).max(160), mimeType: z.string().max(80).nullable().optional(), sizeBytes: z.number().int().min(1).nullable().optional(), durationSec: z.number().int().min(0).nullable().optional(), isVideoNote: z.boolean().default(false), fileId: z.string().max(200).nullable().optional(), sourceUrl: z.string().url().max(500).nullable().optional(), status: z.enum(['uploaded', 'approved']).default('uploaded'), formatChecked: z.boolean().default(false) }).safeParse(req.body);
      if (!b.success) return reply.code(400).send({ ok: false, error: 'validation' });
      // Fayl o'lchami cheklovi (yuqorida bodyLimit bor; qo'shimcha tekshiruv):
      const maxBytes = Number(process.env.MEDIA_MAX_BYTES ?? 52428800);
      if (b.data.sizeBytes && b.data.sizeBytes > maxBytes) return reply.code(413).send({ ok: false, error: 'too_large' });
      if (b.data.sourceUrl) {
        try {
          const { assertSafeExternalUrl } = await import('./security.js');
          await assertSafeExternalUrl(b.data.sourceUrl);
        } catch (e) {
          return reply.code(422).send({ ok: false, error: 'ssrf_guard', reason: (e as Error).message.slice(0, 80) });
        }
      }
      const m = await db.createMedia({
        originalName: b.data.originalName,
        mimeType: b.data.mimeType ?? null,
        sizeBytes: b.data.sizeBytes ?? null,
        durationSec: b.data.durationSec ?? null,
        isVideoNote: b.data.isVideoNote,
        fileId: b.data.fileId ?? null,
        sourceUrl: b.data.sourceUrl ?? null,
        status: b.data.status,
        formatChecked: b.data.formatChecked,
        uploadedById: s.adminId,
      });
      await db.audit({ actorId: s.adminId, action: 'media_create', entity: 'media', entityId: m.id, before: null, after: { name: m.originalName }, ip: hashIp(req.ip ?? '', cfg.ipHashSalt) });
      return reply.send({ ok: true, id: m.id });
    });
  });

  // --- media upload: fayl -> (Telegram bo'lsa) file_id; bo'lmasa katalog+disk --
  app.post('/api/admin/media/upload', { bodyLimit: 24 * 1024 * 1024 }, async (req, reply) => {
    return withAuth(req, reply, ['admin', 'content_editor'], true, async (s) => {
      const b = z
        .object({
          originalName: z.string().min(1).max(160),
          mime: z.string().min(3).max(80),
          dataBase64: z.string().min(8).max(32 * 1024 * 1024),
          isVideoNote: z.boolean().default(true),
          targetChatId: z.number().int().nullable().optional(),
        })
        .safeParse(req.body);
      if (!b.success) return reply.code(400).send({ ok: false, error: 'validation' });
      const buf = Buffer.from(b.data.dataBase64, 'base64');
      const maxBytes = Number(process.env.MEDIA_MAX_BYTES ?? 52428800);
      const bad = validateUploadName(b.data.originalName, b.data.mime, buf.length, maxBytes);
      if (bad) return reply.code(422).send({ ok: false, error: bad, hint: "Ruxsat: jpg/png rasm; mp4/mov video. Round video = mp4, 60 sekundgacha" });
      const token = process.env.TELEGRAM_BOT_TOKEN ?? null;
      const chatId = b.data.targetChatId ?? null;
      if (token && chatId) {
        // Haqiqiy Telegram upload: chat'ga yuborib file_id'ni olamiz.
        try {
          const { Bot, InputFile } = await import('grammy');
          const bot = new Bot(token);
          let fileId: string | null = null;
          let durationSec: number | null = null;
          let kind = 'video';
          if (b.data.isVideoNote && /^video\/(mp4|quicktime)$/.test(b.data.mime)) {
            const m = await bot.api.sendVideoNote(chatId, new InputFile(buf, b.data.originalName) as never);
            fileId = (m.video_note as { file_id: string }).file_id;
            kind = 'video_note';
          } else if (b.data.mime.startsWith('image/')) {
            const m = await bot.api.sendPhoto(chatId, new InputFile(buf, b.data.originalName) as never);
            const photos = m.photo as { file_id: string }[];
            fileId = photos[photos.length - 1]!.file_id;
            kind = 'image';
          } else {
            const m = await bot.api.sendVideo(chatId, new InputFile(buf, b.data.originalName) as never);
            const v = m.video as { file_id: string; duration?: number };
            fileId = v.file_id;
            durationSec = v.duration ?? null;
          }
          const media = await db.createMedia({
            originalName: b.data.originalName,
            mimeType: b.data.mime,
            sizeBytes: buf.length,
            durationSec,
            isVideoNote: b.data.isVideoNote && kind === 'video_note',
            fileId,
            sourceUrl: null,
            status: 'approved',
            formatChecked: true,
            uploadedById: s.adminId,
          });
          await db.audit({ actorId: s.adminId, action: 'media_upload_telegram', entity: 'media', entityId: media.id, before: null, after: { kind, size: buf.length }, ip: hashIp(req.ip ?? '', cfg.ipHashSalt) });
          return reply.send({ ok: true, id: media.id, fileId, via: 'telegram' });
        } catch (e) {
          return reply.code(502).send({ ok: false, error: 'telegram_upload_failed', reason: toPlainText((e as Error).message).slice(0, 160), hint: "Bot bilan chat ochiq bo'lishi kerak; format: round=mp4<=60s" });
        }
      }
      // Token/chat yo'q (demo): fayl diskda saqlanadi, file_id keyin bog'lanadi.
      const { writeFile, mkdir } = await import('node:fs/promises');
      const dir = process.env.MEDIA_DIR ?? 'uploads';
      await mkdir(dir, { recursive: true });
      const ext = (b.data.originalName.split('.').pop() ?? 'bin').toLowerCase();
      const stored = 'med_' + randomBytes(6).toString('hex') + '.' + ext;
      await writeFile(dir + '/' + stored, buf);
      const media = await db.createMedia({
        originalName: b.data.originalName,
        mimeType: b.data.mime,
        sizeBytes: buf.length,
        durationSec: null,
        isVideoNote: b.data.isVideoNote,
        fileId: null,
        sourceUrl: 'file://' + dir + '/' + stored,
        status: 'uploaded',
        formatChecked: false,
        uploadedById: s.adminId,
      });
      await db.audit({ actorId: s.adminId, action: 'media_upload_local', entity: 'media', entityId: media.id, before: null, after: { size: buf.length }, ip: hashIp(req.ip ?? '', cfg.ipHashSalt) });
      return reply.send({ ok: true, id: media.id, fileId: null, via: 'local', note: 'TELEGRAM_BOT_TOKEN + targetChatId berilsa file_id avtomatik olinadi' });
    });
  });

  // --- consents / marketing boshqaruvi ---------------------------------------
  app.get('/api/admin/users/:id/consents', async (req, reply) => {
    return withAuth(req, reply, ALL, false, async () => {
      const p = z.object({ id: z.string().min(1) }).safeParse(req.params);
      if (!p.success) return reply.code(400).send({ ok: false });
      return { consents: await db.listConsents(p.data.id) };
    });
  });

  app.post('/api/admin/users/:id/marketing', async (req, reply) => {
    return withAuth(req, reply, ADMIN_ONLY, true, async (s) => {
      const p = z.object({ id: z.string().min(1) }).safeParse(req.params);
      const b = z.object({ action: z.enum(['grant', 'revoke']), note: z.string().max(200).optional() }).safeParse(req.body);
      if (!p.success || !b.success) return reply.code(400).send({ ok: false });
      if (b.data.action === 'grant') await db.grantConsent(p.data.id, 'marketing', CONSENT_TEXT_VERSION);
      else {
        await db.revokeConsent(p.data.id, 'marketing');
        await db.cancelPendingOutboxForUser(p.data.id, ['marketing', 'reminder']);
      }
      await db.audit({ actorId: s.adminId, action: 'marketing_' + b.data.action, entity: 'consent', entityId: p.data.id, before: null, after: { note: b.data.note ?? null }, ip: hashIp(req.ip ?? '', cfg.ipHashSalt) });
      return reply.send({ ok: true });
    });
  });

  app.post('/api/admin/outbox/:id/cancel', async (req, reply) => {
    return withAuth(req, reply, ADMIN_ONLY, true, async (s) => {
      const p = z.object({ id: z.string().min(1) }).safeParse(req.params);
      if (!p.success) return reply.code(400).send({ ok: false });
      await db.updateOutbox(p.data.id, { status: 'cancelled', lastError: 'cancelled by admin' });
      await db.audit({ actorId: s.adminId, action: 'outbox_cancel', entity: 'outbox', entityId: p.data.id, before: null, after: null, ip: hashIp(req.ip ?? '', cfg.ipHashSalt) });
      return reply.send({ ok: true });
    });
  });

  // --- demo sahifa --------------------------------------------------------------
  app.get('/', async (_req, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(DEMO_HTML);
  });

  return app;
}

export const DEMO_HTML = `<!doctype html><html lang="uz"><head><meta charset="utf-8"><title>Moy Sklad - demo</title>
<meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui;max-width:720px;margin:2rem auto;padding:0 1rem">
<h1>Moy Sklad demo</h1>
<p>Bu sahifa local ishlanma uchun: (1) sayt formasi - Telegram link tokenini oladi; (2) bot simulyatori - Telegram'siz funnel'ni sinaydi.</p>
<h2>1. Sayt formasi</h2>
<form id="f"><input type="hidden" name="formStartedAt" id="ts"><input name="name" placeholder="Ism" required><input name="phone" placeholder="+998..." required><input name="website" style="display:none" tabindex="-1" autocomplete="off">
<label><input type="checkbox" id="c1" required> Bog'lanishga roziman</label>
<label><input type="checkbox" id="c2"> Yangilik/eslatmalarga roziman</label>
<button type="submit">Yuborish</button></form>
<pre id="out"></pre>
<h2>2. Bot simulyatori (demo)</h2>
Telegram ID: <input id="tg" type="number" value="123456"> <button id="rst">/start</button>
<div id="kb"></div><input id="txt" placeholder="Xabar..." style="width:60%"><button id="snd">Yuborish</button>
<pre id="log"></pre>
<script>
document.getElementById('ts').value=Date.now();
const log=(m)=>{document.getElementById('log').textContent+=m+'\\n'};
async function sim(body){await fetch('/api/bot/simulate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});await render();}
async function render(){const tg=document.getElementById('tg').value;const r=await fetch('/api/bot/sent/'+tg);const j=await r.json();const ms=j.messages||[];const last=ms[ms.length-1];document.getElementById('kb').innerHTML='';if(last&&last.buttons)last.buttons.flat().forEach(b=>{const el=document.createElement('button');el.textContent=b.label;el.style.margin='2px';el.onclick=()=>sim({telegramId:+tg,data:b.action});document.getElementById('kb').appendChild(el)});document.getElementById('log').textContent=ms.map(m=>'> '+m.text).join('\\n')+'\\n';}
document.getElementById('rst').onclick=()=>{document.getElementById('log').textContent='';sim({telegramId:+document.getElementById('tg').value,text:'/start'})};
document.getElementById('snd').onclick=()=>{sim({telegramId:+document.getElementById('tg').value,text:document.getElementById('txt').value||'salom'})};
document.getElementById('f').onsubmit=async(e)=>{e.preventDefault();const fd=new FormData(e.target);const body={name:fd.get('name'),phone:fd.get('phone'),website:fd.get('website')||undefined,formStartedAt:+document.getElementById('ts').value,consentContact:document.getElementById('c1').checked,consentMarketing:document.getElementById('c2').checked};const r=await fetch('/api/site/lead',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json();document.getElementById('out').textContent=JSON.stringify(j,null,2)+(j.link?'\\n\\nLinkni oching (yangi sahifa o\'rniga): '+j.link:'');};
</script></body></html>`;
