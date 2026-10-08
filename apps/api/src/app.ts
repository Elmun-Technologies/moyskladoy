// ============================================================================
// Fastify app: sayt formasi (link-token), admin API (sessiya+CSRF+rollar),
// demo bot-simulyatsiya endpointlari. Log'larga P2P ma'lumot yozilmaydi.
// ============================================================================
import { randomBytes, randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { AdminRole, Database } from '@app/shared';
import { CONSENT_TEXT_VERSION, SETTING_KEYS, toPlainText } from '@app/shared';
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
}

interface Session {
  adminId: string;
  role: AdminRole;
  email: string;
  csrf: string;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { db, cfg } = deps;
  const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024 });
  const sessions = new Map<string, Session>();
  const loginAttempts = new Map<string, { count: number; first: number }>();

  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"] } } });
  await app.register(cookie, { secret: cfg.sessionSecret });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  if (cfg.corsOrigins.length > 0) await app.register(cors, { origin: cfg.corsOrigins, credentials: true });

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
    if (b.consentMarketing) await db.grantConsent('site:' + lead.id, 'marketing', CONSENT_TEXT_VERSION);
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

  // --- stats -----------------------------------------------------------------
  app.get('/api/admin/stats', async (req, reply) => {
    return withAuth(req, reply, ALL, false, async () => {
            const stages = ['bot_start', 'stage:START', 'stage:EXPERIENCE_VIDEO', 'stage:LESSON_INTRO', 'task_answered', 'lesson_self_reported_watched', 'stage:OFFERS', 'sales_lead_created', 'link_token_claimed'];
      const funnel: Record<string, { total: number; users: number }> = {};
      for (const t of stages) {
        funnel[t] = { total: await db.countEvents(t), users: await db.countUniqueUsers(t) };
      }
      const leads = await db.listSalesLeads({ limit: 1000 });
      const byStatus: Record<string, number> = {};
      for (const l of leads.leads) byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
      return { funnel, leads: { total: leads.total, byStatus } };
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
        r.users.map(async (u) => ({
          id: u.id,
          telegramId: u.telegramId,
          username: u.username,
          firstName: u.firstName,
          blockedAt: u.blockedAt,
          stage: u.state?.stage ?? 'START',
          salesStatus: u.state?.salesStatus ?? 'none',
          phone: mask ? null : u.siteLeadId ? ((await db.getSiteLeadById(u.siteLeadId))?.phone ?? null) : null,
        })),
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
