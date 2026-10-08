// ============================================================================
// BotEngine - DB-driven state machine (51 bo'limli yangi spec).
// NO grammY import here: yagona chiqish - Messenger interfeysi orqali.
// Qoidalar:
//  - Har bir update updateId bo'yicha bir marta qayta ishlanadi (dedupe).
//  - Har bir foydalanuvchi uchun xabarlar ketma-ket (per-user queue) ishlaydi.
//  - Eski/takror bosilgan tugmalar sales status'ni orqaga qaytarmaydi.
//  - Media yo'q va majburiy bo'lsa - blok o'tkazib yuboriladi; havola
//    (requiredSettings) to'ldirilmagan bo'lsa - bo'lim umuman ochilmaydi.
//  - Tasdiqlanmagan narx (special-800) foydalanuvchiga HECH QACHON
//    ko'rsatilmaydi.
//  - Noto'g'ri javob darsdan chetlashtirmaydi (15-qoida).
//  - Dars havolasini ochish = ko'rilgan emas; "ko'rdim" - faqat self-report.
//  - "Sotuvga uzatildi" tasdig'i faqat uzatish AMALGA OSHSA yuboriladi.
// ============================================================================
import type {
  Answers,
  ButtonDef,
  ContentBlock,
  ConversationState,
  Database,
  Messenger,
  Stage,
  TelegramUser,
} from '@app/shared';
import {
  FREE_TEXT_STAGES,
  SETTING_KEYS,
  maskPhone,
  tashkentDayKey,
  toPlainText,
} from '@app/shared';
import { DateTime } from 'luxon';

export interface EngineOptions {
  demoMode?: boolean;
  salesStaffTelegramIds?: number[];
  /** Log uchun (sanitizatsiyalangan) yozuv. */
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

export interface BotMessageMeta {
  updateId?: number;
  chatId: number;
  telegramId: number;
}

/** Sotuvga kirgan foydalanuvchi orqaga qaytaradigan bosqichlar (lock). */
const SALES_LOCKED: Stage[] = [
  'READINESS',
  'TIMELINE',
  'DECISION_MAKER',
  'DECISION_LEADER',
  'PREFLIGHT_VIDEO',
  'CONSENT_CONTACT',
  'CONTACT_METHOD',
  'PREFERRED_TIME',
  'REVIEW_SUBMIT',
  'SUBMITTED',
];

/** Sessiya oxiri deb hisoblanadigan bosqichlar - rozilik shu yerda so'raladi. */
const SESSION_END_STAGES: Stage[] = ['AFTER_LESSON_VIDEO', 'STUDENT_REVIEW', 'ANSWER_FOLLOWUP'];

/** Ko'rib chiqish so'raladigan yo'nalishlar (18-qoida: sessiya oxiri). */
const CONSENT_GATE_TARGETS: Stage[] = ['OFFERS', 'NOT_READY'];

const PATH_STAGES: Stage[] = ['PATH_SELF', 'PATH_EMPLOYEE', 'PATH_UNSURE'];

/** Muhim blok kalitlari. */
const K = {
  menu: 'menu',
  submitted: 'submitted',
  submittedPending: 'submitted_pending',
  sectionSoon: 'section_soon',
  reviewSubmit: 'review_submit',
  consentReminders: 'consent_reminders',
  purchaseStart: 'purchase_start',
  clientReview: 'client_review',
  studentReview: 'student_review',
  lessonIntro: 'lesson_intro',
  reminderLesson: 'reminder_lesson',
} as const;

/** answer: maydoni javobdan keyin qaysi bosqichga o'tadi. */
const NEXT_AFTER_ANSWER: Partial<Record<string, Stage>> = {
  role: 'SURVEY_PROBLEM',
  problem: 'SURVEY_PATH',
  timeline: 'DECISION_MAKER',
};

const OFFER_SLUG: Partial<Record<Stage, string>> = {
  OFFER_COURSE: 'course',
  OFFER_VIDEOS: 'video-lessons',
  OFFER_SERVICE: 'service',
};

export class BotEngine {
  private readonly queues = new Map<number, Promise<void>>();

  constructor(
    private readonly db: Database,
    private readonly msg: Messenger,
    private readonly opts: EngineOptions = {},
  ) {}

  private log(level: 'info' | 'warn' | 'error', m: string): void {
    this.opts.log?.(level, m);
  }

  /** Per-user ketma-ketlik: bir foydalanuvchi bo'yicha ishlar parallel emas. */
  enqueue(telegramId: number, task: () => Promise<void>): Promise<void> {
    const prev = this.queues.get(telegramId) ?? Promise.resolve();
    const next = prev.then(task, task).catch((e) => {
      this.log('error', `user task failed: ${(e as Error).message.slice(0, 200)}`);
    });
    this.queues.set(telegramId, next);
    return next;
  }

  private async ensureUser(meta: BotMessageMeta, tg?: { username?: string; firstName?: string; languageCode?: string }): Promise<TelegramUser> {
    const user = await this.db.upsertTelegramUser({
      telegramId: meta.telegramId,
      username: tg?.username ?? null,
      firstName: tg?.firstName ?? null,
      languageCode: tg?.languageCode ?? null,
    });
    let state = await this.db.getState(user.id);
    if (!state) state = await this.db.createState(user.id, 'START');
    return user;
  }

  private setState(userId: string, patch: Partial<ConversationState>): Promise<ConversationState> {
    return this.db.updateState(userId, patch);
  }

  private async setting(key: string): Promise<unknown> {
    return this.db.getSetting(key);
  }

  // ==========================================================================
  // Blok render: shartlar tekshiruvi + placeholderlar + media + tugmalar
  // ==========================================================================

  private async renderStage(user: TelegramUser, meta: BotMessageMeta): Promise<void> {
    const state = await this.db.getState(user.id);
    if (!state) return;
    for (let guard = 0; guard < 8; guard++) {
      const block = await this.db.getBlockByStage(state.stage, 'approved');
      if (!block) {
        this.log('warn', `no approved block for stage ${state.stage}; held at menu`);
        const menu = await this.db.getBlockByKey(K.menu, 'approved');
        if (menu && state.stage !== 'MENU') await this.sendBlock(user, state, menu, meta);
        return;
      }
      // Shart: settings'dagi to'ldirilgan kalitlar - bo'lim faqat shunda ochiladi.
      if (!(await this.settingsGateOk(block))) {
        const soon = await this.db.getBlockByKey(K.sectionSoon, 'approved');
        if (soon) await this.sendBlock(user, state, soon, meta);
        return;
      }
      // 18-qoida: rozilik allaqachon berilgan bo'lsa - so'ralmaydi.
      if (block.showCondition?.skipIfMarketingConsent) {
        if (await this.db.hasActiveConsent(user.id, 'marketing')) {
          const nxt = this.firstGoto(block);
          if (!nxt) return;
          await this.setState(user.id, { stage: nxt });
          continue;
        }
      }
      const ok = await this.sendBlock(user, state, block, meta);
      if (ok) {
        await this.db.recordEvent(`stage:${state.stage}`, {
          userId: user.id,
          dedupeKey: `${user.id}:stage:${state.stage}:${this.dayStamp()}`,
        });
        return;
      }
      // Media yo'q va fallback yo'q - bo'lim o'tkazib yuboriladi (17/03 qoida).
      const nxt = this.firstGoto(block);
      if (!nxt) return;
      await this.setState(user.id, { stage: nxt });
    }
    this.log('warn', 'renderStage guard loop exceeded');
  }

  private firstGoto(block: ContentBlock): Stage | null {
    for (const b of block.buttons) {
      const m = b.action.match(/^goto:([A-Z_]+)$/);
      const g = m?.[1];
      if (g && this.isStage(g)) return g as Stage;
      if (m) return null;
    }
    return null;
  }

  private isStage(s: string): boolean {
    return /^[A-Z][A-Z_]{2,29}$/.test(s) && KNOWN_STAGES.has(s);
  }

  private dayStamp(): string {
    return DateTime.now().setZone('Asia/Tashkent').toFormat('yyyyLLdd');
  }

  private async settingsGateOk(block: ContentBlock): Promise<boolean> {
    const keys = block.showCondition?.requiredSettings;
    if (!keys || keys.length === 0) return true;
    for (const k of keys) {
      const v = await this.setting(k);
      if (typeof v !== 'string' || !v.trim()) return false;
    }
    return true;
  }

  /** @returns true - xabar yuborildi; false - blok o'tkazib yuborildi. */
  private async sendBlock(user: TelegramUser, state: ConversationState, block: ContentBlock, meta: BotMessageMeta): Promise<boolean> {
    let body = await this.renderBody(user, state, block.body);
    let buttons = await this.filterButtons(user, state, block);
    // Tugma yorlig'idagi {{user.phone}} - foydalanuvchining o'ziga ko'rsatiladi.
    if (buttons.some((b) => b.label.includes('{{user.phone}}'))) {
      const ph = (await this.userPhone(user)) ?? '';
      buttons = buttons
        .map((b) => (b.label.includes('{{user.phone}}') ? { ...b, label: b.label.replace('{{user.phone}}', ph ? '+' + ph : "telefon yo'q") } : b))
        .filter((b) => !b.label.includes('{{user.phone}}') || ph !== '');
    }

    // Dars havolasi qo'shimcha - endi body ichidagi {{settings:lesson_link}} orqali.
    const hasMedia = !!block.mediaId;
    if (hasMedia) {
      const r =
        block.mediaType === 'video_note' && block.mediaId
          ? await this.msg.sendVideoNote(meta.chatId, block.mediaId, buttons)
          : block.mediaType === 'video' && block.mediaId
            ? await this.msg.sendVideo(meta.chatId, block.mediaId, buttons)
            : block.mediaType === 'image' && block.mediaId
              ? await this.msg.sendPhoto(meta.chatId, block.mediaId, body, buttons)
              : await this.msg.sendText(meta.chatId, body, buttons);
      if (r.ok) return true;
      this.log('warn', `media send failed (${block.key}): ${(r.error ?? 'unknown').slice(0, 160)}`);
    }
    if (block.requiresMedia && !block.textFallbackAllowed) {
      return false; // majburiy material yo'q - blok yuborilmaydi
    }
    const r = await this.msg.sendText(meta.chatId, body, buttons);
    return r.ok;
  }

  // ==========================================================================
  // Placeholder render: {{settings:k}}, {{user.phone}}, {{products:chosen}},
  // {{review:card}}, {{purchase:info}}
  // ==========================================================================

  private async renderBody(user: TelegramUser, state: ConversationState, body: string): Promise<string> {
    let out = body;
    // {{settings:key}} - faqat oq ro'yxatdagi kalitlar.
    const allowedSettings = new Set<string>(Object.values(SETTING_KEYS));
    out = out.replace(/\{\{settings:([a-z0-9_]+)\}\}/g, (_m, k: string) => {
      void allowedSettings; // kalit nomlari quyida async o'qiladi
      return `\u0000SET:${k}\u0000`;
    });
    const setMatches = [...out.matchAll(/\u0000SET:([a-z0-9_]+)\u0000/g)].map((m) => m[1] as string);
    for (const k of setMatches) {
      const allowed = Object.values(SETTING_KEYS).includes(k as (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS]);
      let v = 'tez orada beriladi';
      if (allowed) {
        const raw = await this.setting(k);
        if (typeof raw === 'string' && raw.trim()) v = raw.trim();
        if (typeof raw === 'number') v = String(raw);
      }
      out = out.split(`\u0000SET:${k}\u0000`).join(v);
    }
    if (out.includes('{{user.phone}}')) {
      const ph = await this.userPhone(user);
      out = out.split('{{user.phone}}').join(ph ?? '-');
    }
    if (out.includes('{{products:chosen}}')) {
      out = out.replace('{{products:chosen}}', await this.productsSummary(state));
    }
    if (out.includes('{{review:card}}')) {
      out = out.replace('{{review:card}}', await this.reviewCard(user, state));
    }
    if (out.includes('{{purchase:info}}')) {
      const info = (await this.setting('purchase_start_message')) as string | null;
      out = out.replace('{{purchase:info}}', typeof info === 'string' && info.trim() ? info.trim() : "Boshlash ma'lumoti sotuv bo'limi tomonidan yuboriladi.");
    }
    // qoldiq placeholder bo'lsa - xavfsiz o'chiramiz
    return out.replace(/\{\{[^}]{0,60}\}\}/g, '');
  }

  private async userPhone(user: TelegramUser): Promise<string | null> {
    if (!user.siteLeadId) return null;
    const site = await this.db.getSiteLeadById(user.siteLeadId);
    return site?.phone ? site.phone : null;
  }

  private async productsSummary(state: ConversationState): Promise<string> {
    const all = await this.db.listProducts(true);
    const visible = all.filter((p) => p.visibleToUsers && p.isActive && p.priceType !== 'unconfirmed');
    const chosen = state.interestedProductId ? visible.filter((p) => p.id === state.interestedProductId) : visible;
    if (chosen.length === 0) return 'Narx va shartlar hozircha tasdiqlanmagan - suhbatda aniqlaymiz.';
    const lines: string[] = [];
    for (const p of chosen) {
      lines.push('* ' + p.name);
      if (p.priceType === 'fixed' && p.priceUsd !== null) {
        lines.push(`  Narxi: ${p.priceUsd.toLocaleString('en-US')} ${p.currency}`);
      } else {
        const dt = (p.details?.pricingText as string | undefined) ?? (await this.setting(SETTING_KEYS.servicePricingText));
        lines.push('  ' + (typeof dt === 'string' && dt ? dt : 'Narx suhbatda aniqlanadi.'));
      }
    }
    lines.push('Taklif shartlari admin tomonidan tasdiqlangan holda yuqoridagi havolalarda.');
    return lines.join('\n');
  }

  private async reviewCard(user: TelegramUser, state: ConversationState): Promise<string> {
    const parts: string[] = [];
    parts.push(`Telegram: ${user.username ? '@' + user.username : String(user.telegramId)}`);
    const phone = await this.userPhone(user);
    parts.push(`Telefon: ${phone ? maskPhone(phone) : "belgilanmagan"}`);
    if (state.answers.business) parts.push('Biznes: ' + state.answers.business.slice(0, 80));
    if (state.answers.problem) parts.push('Muammo: ' + this.problemLabel(state.answers.problem));
    const prod = state.interestedProductId ? (await this.db.listProducts(true)).find((p) => p.id === state.interestedProductId) : null;
    if (prod) {
      const price = prod.priceType === 'fixed' && prod.priceUsd !== null ? `${prod.priceUsd.toLocaleString('en-US')} ${prod.currency}` : 'kelishilgan narx';
      parts.push(`Taklif: ${prod.name} (${price})`);
    } else {
      parts.push('Taklif: aniqlanmagan');
    }
    parts.push('Tayyorgarlik: ' + (state.answers.readiness ?? 'suhbatda'));
    if (state.answers.decision) parts.push('Qaror: ' + state.answers.decision);
    if (state.answers.timeline) parts.push('Muddat: ' + this.timelineLabel(state.answers.timeline));
    if (state.answers.question) parts.push('Savol: ' + state.answers.question.slice(0, 120));
    parts.push(`Aloqa roziligi: ${state.contactConsentGivenAt ? 'bor' : "yo'q"}`);
    if (state.contactMethod) parts.push('Aloqa usuli: ' + state.contactMethod);
    if (state.preferredTime) parts.push('Qulay vaqt: ' + state.preferredTime);
    parts.push("Darsni ko'rdi (o'zi belgiladi): " + (state.lessonWatchedAt ? 'ha' : 'yo\'q'));
    return parts.join('\n');
  }

  private problemLabel(v: string): string {
    const map: Record<string, string> = {
      stock: "tovar qoldig'i",
      payments: 'qarz va to\'lovlar',
      staff: 'xodimlar ishi',
      docs: 'kirim-chiqim hujjatlari',
      production: 'ishlab chiqarish xarajatlari',
    };
    return map[v] ?? v.slice(0, 80);
  }

  private timelineLabel(v: string): string {
    const map: Record<string, string> = {
      '2weeks': '1-2 hafta',
      month: 'bir oy ichida',
      unsure: 'aniq emas',
      later: 'keyinroq',
    };
    return map[v] ?? v;
  }

  /** Test/API uchun: blokni placeholderlar bilan render qilib yuborish. */
  async sendBlockPublic(userId: string, block: ContentBlock, chatId: number): Promise<void> {
    const user = await this.db.getUserById(userId);
    const state = await this.db.getState(userId);
    if (!user || !state) return;
    await this.sendBlock(user, state, block, { chatId, telegramId: user.telegramId });
  }

  private async filterButtons(user: TelegramUser, state: ConversationState, block: ContentBlock): Promise<ButtonDef[]> {
    // Panel'dan o'chirilgan (hidden) tugmalar yuborilmaydi.
    let buttons = block.buttons.filter((b) => b.hidden !== true);
    const cond = block.showCondition;
    if (cond?.requiresVisibleProducts) {
      const visible = (await this.db.listProducts(true)).filter((p) => p.visibleToUsers && p.priceType !== 'unconfirmed');
      if (visible.length === 0) buttons = buttons.filter((b) => !b.action.startsWith('goto:OFFER_'));
    }
    // Mijoz/o'quvchi videosi yo'q bo'lsa - "ko'rish" tugmalari ko'rsatilmaydi.
    if (buttons.some((b) => b.action === 'goto:CLIENT_REVIEW' || b.action === 'goto:STUDENT_REVIEW')) {
      for (const [act, key] of [
        ['goto:CLIENT_REVIEW', K.clientReview],
        ['goto:STUDENT_REVIEW', K.studentReview],
      ] as const) {
        const target = await this.db.getBlockByKey(key, 'approved');
        if (!target || (target.requiresMedia && !target.mediaId)) {
          buttons = buttons.filter((b) => b.action !== act);
        }
      }
    }
    // Telefon allaqachon ma'lum - qayta so'ralmaydi (33-qoida).
    if (block.stage === 'CONTACT_METHOD') {
      const ph = await this.userPhone(user);
      if (!ph) buttons = buttons.filter((b) => b.action !== 'answer:contact=phone');
      else buttons = buttons.filter((b) => b.action !== 'contact:phone');
    }
    // Sotuvga topshirilgan/xarid qilingan - sales tugmalari kerak emas.
    if (state.salesStatus === 'in_sales' || state.salesStatus === 'purchased') {
      buttons = buttons.filter((b) => !['goto:READINESS', 'submit:send', "goto:TIMELINE"].includes(b.action));
    }
    if (state.salesStatus === 'purchased') {
      buttons = buttons.filter((b) => !b.action.startsWith('goto:OFFER') && !b.action.startsWith('goto:LESSON'));
    }
    return buttons;
  }

  // ==========================================================================
  // /start - link-token bog'lash (tokenda shaxsiy ma'lumot YO'Q)
  // ==========================================================================

  async handleStart(meta: BotMessageMeta, tg: { username?: string; firstName?: string; languageCode?: string }, startParam?: string): Promise<void> {
    return this.enqueue(meta.telegramId, async () => {
      const user = await this.ensureUser(meta, tg);
      if (startParam && startParam.length >= 6 && startParam.length <= 64) {
        const claim = await this.db.claimLinkToken(startParam, user.id);
        if (claim.ok && claim.token) {
          const lead = await this.db.getSiteLeadById(claim.token.siteLeadId);
          if (lead) await this.db.updateUser(user.id, { siteLeadId: lead.id });
          await this.db.recordEvent('link_token_claimed', { userId: user.id, siteLeadId: lead?.id, dedupeKey: `${user.id}:link_claimed` });
        } else {
          this.log('info', `link token not usable: ${claim.reason ?? 'invalid'} for user ${user.id}`);
        }
      }
      await this.db.recordEvent('bot_start', { userId: user.id, dedupeKey: `${user.id}:first_start` });
      const state = await this.db.getState(user.id);
      if (state && state.stage !== 'START') {
        const menu = await this.db.getBlockByKey(K.menu, 'approved');
        if (menu) await this.sendBlock(user, state, menu, meta);
      } else {
        await this.renderStage(user, meta);
      }
    });
  }

  // ==========================================================================
  // Callback tugmalar
  // ==========================================================================

  async handleCallback(meta: BotMessageMeta & { callbackId: string; data: string }): Promise<void> {
    return this.enqueue(meta.telegramId, async () => {
      const [kind, ...rest] = meta.data.split(':');
      const arg = rest.join(':');
      let user = await this.db.getUserByTelegramId(meta.telegramId);
      if (!user && kind === 'claim') {
        user = await this.db.upsertTelegramUser({ telegramId: meta.telegramId, firstName: 'Staff' });
      }
      if (!user) return;
      if (kind === 'claim') {
        await this.handleClaim(user, meta, arg);
        return;
      }
      const state = await this.db.getState(user.id);
      if (!state) return;
      try {
        switch (kind) {
          case 'goto':
            await this.handleGoto(user, state, arg, meta);
            break;
          case 'answer': {
            const [field = '', value = ''] = arg.split('=');
            await this.handleAnswer(user, state, field, value, meta);
            break;
          }
          case 'task':
            await this.handleTask(user, state, arg, meta);
            break;
          case 'lesson':
            await this.handleLesson(user, state, arg, meta);
            break;
          case 'consent':
            await this.handleConsent(user, state, arg, meta);
            break;
          case 'notif':
            await this.handleNotif(user, state, arg, meta);
            break;
          case 'contact':
            await this.handleContactChoice(user, state, arg, meta);
            break;
          case 'submit':
            await this.handleSubmit(user, state, arg, meta);
            break;
          case 'cmd':
            await this.handleCommandAction(user, state, arg, meta);
            break;
          default:
            await this.safeAnswer(meta.callbackId);
            await this.renderStage(user, meta);
        }
      } catch (e) {
        this.log('error', `callback ${kind} failed: ${(e as Error).message.slice(0, 200)}`);
        await this.safeAnswer(meta.callbackId, "Kechirasiz, xatolik. Qayta urinib ko'ring.");
      }
    });
  }

  private async safeAnswer(callbackId: string, text?: string): Promise<void> {
    try {
      await this.msg.answerCallback(callbackId, text);
    } catch {
      /* callback javobi muvaffaqiyatsiz - jiddiy emas */
    }
  }

  // ==========================================================================
  // Goto + sessiya oxiri rozilik darvozasi + biznes turi savoli
  // ==========================================================================

  private async handleGoto(user: TelegramUser, state: ConversationState, target: string, meta: BotMessageMeta): Promise<void> {
    if (!this.isStage(target)) return;
    let stage = target as Stage;
    if (state.salesStatus === 'purchased') {
      const blk = await this.db.getBlockByKey(K.menu, 'approved');
      if (blk) await this.sendBlock(user, state, blk, meta);
      return;
    }
    if (state.salesStatus === 'in_sales' && SALES_LOCKED.includes(stage)) {
      await this.renderStage(user, meta); // orqaga qaytarilmaydi
      return;
    }
    // 08-qoida: biznes turi yo'q bo'lsa, yo'l sahifasidan oldin bir so'raladi.
    if (PATH_STAGES.includes(stage) && !state.answers.business) {
      await this.setState(user.id, { answers: { ...state.answers, pending_path: stage }, stage: 'BUSINESS_TYPE' });
      await this.renderStage(user, meta);
      return;
    }
    // 18-qoida: sessiya oxirida eslatma roziligi (site'dan bo'lsa - so'ralmaydi).
    const lateish = SESSION_END_STAGES.includes(state.stage) || ['LESSON_INTRO', 'TASK', 'TASK_CORRECT', 'TASK_WRONG'].includes(state.stage);
    const needsConsentGate =
      (stage === 'NOT_READY' || (stage === 'OFFERS' && lateish)) &&
      !(await this.consentDecided(user)) &&
      state.answers.consent_asked !== '1';
    if (needsConsentGate) {
      const gate = await this.db.getBlockByKey(K.consentReminders, 'approved');
      if (gate) {
        await this.setState(user.id, { answers: { ...state.answers, consent_asked: '1', consent_pending: stage }, stage: 'CONSENT_REMINDERS' });
        await this.renderStage(user, meta);
        return;
      }
    }
    await this.setState(user.id, { stage });
    await this.noteProductInterest(user, stage);
    await this.renderStage(user, meta);
  }

  private async consentDecided(user: TelegramUser): Promise<boolean> {
    if (await this.db.hasActiveConsent(user.id, 'marketing')) return true;
    const list = await this.db.listConsents(user.id);
    return list.some((c) => c.type === 'marketing');
  }

  private async noteProductInterest(user: TelegramUser, stage: Stage): Promise<void> {
    const slug = OFFER_SLUG[stage];
    if (!slug) return;
    const p = await this.db.getProductBySlug(slug);
    if (!p || !p.visibleToUsers || p.priceType === 'unconfirmed') return;
    await this.setState(user.id, { interestedProductId: p.id });
    if (p.currentVersionId) await this.db.recordProductView(user.id, p.id, p.currentVersionId);
  }

  // ==========================================================================
  // Javoblar (survey, muddat, aloqa usuli)
  // ==========================================================================

  private async handleAnswer(user: TelegramUser, state: ConversationState, field: string, value: string, meta: BotMessageMeta): Promise<void> {
    if (!field || !value || field.length > 40 || value.length > 60) return;
    const answers = { ...state.answers, [field]: value };
    if (field === 'contact') {
      await this.setState(user.id, { answers, contactMethod: value === 'phone' ? 'phone' : 'telegram' });
      if (value === 'phone') {
        // saytdan telefon bor - darhol ko'rib chiqishga o'tamiz
        await this.setState(user.id, { stage: 'PREFERRED_TIME' });
        await this.renderStage(user, meta);
        return;
      }
      await this.setState(user.id, { stage: 'REVIEW_SUBMIT' });
      await this.renderStage(user, meta);
      return;
    }
    if (field === 'readiness') {
      await this.setState(user.id, { answers, stage: 'TIMELINE' });
      await this.renderStage(user, meta);
      return;
    }
    if (field === 'decision') {
      await this.setState(user.id, { answers, stage: 'PREFLIGHT_VIDEO' });
      await this.renderStage(user, meta);
      return;
    }
    const stage = NEXT_AFTER_ANSWER[field] ?? null;
    if (!stage) {
      await this.setState(user.id, { answers });
      return;
    }
    await this.setState(user.id, { answers, stage });
    await this.renderStage(user, meta);
  }

  // ==========================================================================
  // Task (13-15): noto'g'ri javob chetlashtirmaydi
  // ==========================================================================

  private async handleTask(user: TelegramUser, state: ConversationState, arg: string, meta: BotMessageMeta): Promise<void> {
    const stage: Stage = arg === 'right' ? 'TASK_CORRECT' : 'TASK_WRONG';
    await this.setState(user.id, { taskAnswer: arg.slice(0, 10), stage });
    await this.db.recordEvent('task_answered', { userId: user.id, dedupeKey: `${user.id}:task:${this.dayStamp()}`, properties: { right: arg === 'right' } });
    await this.renderStage(user, meta);
  }

  // ==========================================================================
  // Dars (12): ochish != ko'rish; "ko'rdim" - self-report; eslatma ertaga
  // ==========================================================================

  private async handleLesson(user: TelegramUser, state: ConversationState, action: string, meta: BotMessageMeta): Promise<void> {
    const link = (await this.setting(SETTING_KEYS.lessonLink)) as string | null;
    if (action === 'open') {
      if (!link) return;
      await this.setState(user.id, { lessonLinkClickedAt: new Date() });
      await this.db.recordEvent('lesson_link_clicked', { userId: user.id, dedupeKey: `${user.id}:lesson_clicked:${this.dayStamp()}` });
      await this.msg.sendText(meta.chatId, "Havolani ochdingiz. Ochish - ko'rish emas: darsni ko'rib bo'lgach \"Ko'rdim\" tugmasini bosing.");
      return;
    }
    if (action === 'watched') {
      await this.setState(user.id, { lessonWatchedAt: new Date(), stage: 'TASK' });
      await this.db.recordEvent('lesson_self_reported_watched', { userId: user.id, dedupeKey: `${user.id}:lesson_watched` });
      await this.renderStage(user, meta);
      return;
    }
    if (action === 'resend') {
      if (link) await this.msg.sendText(meta.chatId, 'Sinov darsi havolasi:\n' + link);
      else {
        const soon = await this.db.getBlockByKey(K.sectionSoon, 'approved');
        if (soon) await this.sendBlock(user, state, soon, meta);
      }
      return;
    }
    if (action === 'remind_tomorrow') {
      const tz = DateTime.now().setZone('Asia/Tashkent');
      const when = tz.plus({ days: 1 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
      const r = await this.db.enqueueOutbox({
        userId: user.id,
        type: 'reminder',
        dedupeKey: `reminder:${user.id}:lesson_tomorrow:${tashkentDayKey(when.toJSDate())}`,
        payload: { blockKey: K.reminderLesson },
        scheduledFor: when.toJSDate(),
      });
      await this.msg.sendText(meta.chatId, r ? "Ertaga soat 10:00'da eslatib qo'yaman." : 'Eslatma allaqachon rejalashtirilgan.');
    }
  }

  // ==========================================================================
  // Roziliklar (18/32) va bildirishnoma sozlamalari (47/48)
  // ==========================================================================

  private async handleConsent(user: TelegramUser, state: ConversationState, action: string, meta: BotMessageMeta): Promise<void> {
    if (action === 'grant_marketing') {
      const version = ((await this.setting(SETTING_KEYS.consentTextVersion)) as string) || 'v1';
      await this.db.grantConsent(user.id, 'marketing', version);
      await this.setState(user.id, { answers: { ...state.answers, consent: 'yes' } });
      await this.msg.sendText(meta.chatId, 'Rahmat - eslatmalar yuboriladi. Buni istalgan payt bildrishnoma sozlamalaridan to\'xtatishingiz mumkin.');
      await this.afterConsentAnswer(user, meta);
      return;
    }
    if (action === 'no_reminders') {
      await this.db.revokeConsent(user.id, 'marketing');
      await this.setState(user.id, { answers: { ...state.answers, consent: 'no' } });
      await this.db.cancelPendingOutboxForUser(user.id, ['marketing', 'reminder']);
      await this.msg.sendText(meta.chatId, 'Tushunarli - eslatma yuborilmaydi. Kerak bo\'lganda o\'zingiz qaytasiz.');
      await this.afterConsentAnswer(user, meta);
      return;
    }
    if (action === 'grant_contact') {
      await this.setState(user.id, { contactConsentGivenAt: new Date(), stage: 'CONTACT_METHOD' });
      await this.db.recordEvent('contact_consent_granted', { userId: user.id, dedupeKey: `${user.id}:contact_consent` });
      await this.renderStage(user, meta);
      return;
    }
    if (action === 'decline') {
      await this.setState(user.id, { answers: { ...state.answers, contact_refused: '1' }, stage: 'ASK_QUESTION' });
      await this.renderStage(user, meta);
    }
    if (action === 'revoke_marketing') {
      await this.db.revokeConsent(user.id, 'marketing');
      const n = await this.db.cancelPendingOutboxForUser(user.id, ['marketing', 'reminder']);
      this.log('info', `marketing revoked; cancelled ${n} queued for ${user.id}`);
      await this.msg.sendText(meta.chatId, 'Tushunarli - eslatmalar yuborilmaydi.');
    }
  }

  /** Rozilik javobidan keyin kutilayotgan bosqichga o'tamiz (gate davomi). */
  private async afterConsentAnswer(user: TelegramUser, meta: BotMessageMeta): Promise<void> {
    const st = await this.db.getState(user.id);
    if (!st) return;
    const pending = st.answers.consent_pending;
    const answers = { ...st.answers };
    delete answers.consent_pending;
    if (pending && this.isStage(pending)) {
      await this.setState(user.id, { answers, stage: pending as Stage });
      await this.renderStage(user, meta);
      return;
    }
    await this.setState(user.id, { answers, stage: 'MENU' });
    const menu = await this.db.getBlockByKey(K.menu, 'approved');
    if (menu) {
      const fresh = await this.db.getState(user.id);
      if (fresh) await this.sendBlock(user, fresh, menu, meta);
    }
  }

  private async handleNotif(user: TelegramUser, state: ConversationState, action: string, meta: BotMessageMeta): Promise<void> {
    const version = ((await this.setting(SETTING_KEYS.consentTextVersion)) as string) || 'v1';
    const answers = { ...state.answers };
    if (action === 'marketing') {
      await this.db.grantConsent(user.id, 'marketing', version);
      delete answers.notif_scope;
      await this.setState(user.id, { answers, stage: 'MENU' });
      await this.msg.sendText(meta.chatId, 'Sozlandi: maslahat va eslatmalar yuboriladi.');
    } else if (action === 'lessons') {
      await this.db.grantConsent(user.id, 'marketing', version);
      answers.notif_scope = 'lessons';
      await this.setState(user.id, { answers, stage: 'MENU' });
      await this.msg.sendText(meta.chatId, "Sozlandi: faqat sinov darsi va amaliy eslatmalar yuboriladi (marketing maslahatlari yo'q).");
    } else if (action === 'off') {
      await this.db.revokeConsent(user.id, 'marketing');
      await this.db.cancelPendingOutboxForUser(user.id, ['marketing', 'reminder']);
      await this.setState(user.id, { answers, stage: 'REMINDERS_OFF' });
      await this.renderStage(user, meta);
      return;
    } else if (action === 'on') {
      await this.db.grantConsent(user.id, 'marketing', version);
      delete answers.notif_scope;
      await this.setState(user.id, { answers, stage: 'MENU' });
      await this.msg.sendText(meta.chatId, 'Eslatmalar yoqildi.');
    } else return;
    const fresh = await this.db.getState(user.id);
    const menu = await this.db.getBlockByKey(K.menu, 'approved');
    if (fresh && menu) await this.sendBlock(user, fresh, menu, meta);
  }

  // ==========================================================================
  // Aloqa usuli (33)
  // ==========================================================================

  private async handleContactChoice(user: TelegramUser, state: ConversationState, method: string, meta: BotMessageMeta): Promise<void> {
    if (method === 'phone') {
      await this.setState(user.id, { contactMethod: 'phone', stage: 'PREFERRED_TIME' });
      const phone = await this.userPhone(user);
      if (!phone) {
        await this.msg.requestContact(meta.chatId, "Telefon raqamingizni yuboring (yoki o'zingiz yozing).");
      }
      await this.renderStage(user, meta);
      return;
    }
    await this.setState(user.id, { contactMethod: 'telegram', stage: 'REVIEW_SUBMIT' });
    await this.renderStage(user, meta);
  }

  // ==========================================================================
  // Sotuvga topshirish - uzatish bo'lmasa tasdiq YO'Q (35/36)
  // ==========================================================================

  private async handleSubmit(user: TelegramUser, state: ConversationState, action: string, meta: BotMessageMeta): Promise<void> {
    if (action === 'edit') {
      await this.setState(user.id, { stage: 'CONTACT_METHOD' });
      await this.renderStage(user, meta);
      return;
    }
    if (action !== 'send') return;
    // Aloqa roziligisiz uzatish yo'q - 32-qadamga qaytamiz.
    if (!state.contactConsentGivenAt) {
      await this.setState(user.id, { stage: 'PREFLIGHT_VIDEO' });
      await this.renderStage(user, meta);
      return;
    }
    const blkSubmitted = await this.db.getBlockByKey(K.submitted, 'approved');
    if (state.salesStatus === 'in_sales' || state.salesStatus === 'purchased') {
      // Takroriy bosish - yangi ariza YO'Q, faqat tasdiq ko'rsatiladi.
      const fresh = await this.db.getState(user.id);
      if (blkSubmitted && fresh) await this.sendBlock(user, fresh, blkSubmitted, meta);
      return;
    }
    const existing = await this.db.getActiveLeadByUser(user.id);
    if (existing) {
      await this.setState(user.id, { stage: 'SUBMITTED', salesStatus: 'in_sales' });
      if (blkSubmitted) {
        const fresh = await this.db.getState(user.id);
        if (fresh) await this.sendBlock(user, fresh, blkSubmitted, meta);
      }
      return;
    }
    try {
      const views = await this.db.listProductViews(user.id);
      const lastView = views[views.length - 1];
      const lead = await this.db.createSalesLead({
        userId: user.id,
        siteLeadId: user.siteLeadId,
        productId: state.interestedProductId ?? lastView?.productId ?? null,
        productVersionId:
          state.interestedProductId
            ? (views.find((v) => v.productId === state.interestedProductId)?.productVersionId ?? null)
            : (lastView?.productVersionId ?? null),
        task: state.taskAnswer,
        problem: state.answers.problem ?? null,
        businessType: state.answers.business ?? null,
        decisionMaker: state.answers.decision ?? null,
        timeline: state.answers.timeline ?? null,
        contactMethod: state.contactMethod,
        preferredTime: state.preferredTime,
        contactConsent: true,
        openQuestion: state.answers.question ?? null,
      });
      await this.setState(user.id, { stage: 'SUBMITTED', salesStatus: 'in_sales' });
      await this.db.cancelPendingOutboxForUser(user.id, ['reminder', 'marketing']);
      const groupId = (await this.setting(SETTING_KEYS.salesGroupChatId)) as string | null;
      if (groupId) {
        const card = await this.leadCard(user, lead.id);
        await this.db.enqueueOutbox({
          userId: user.id,
          type: 'notification',
          dedupeKey: `sales:notify:${lead.id}`,
          payload: { chatId: Number(groupId), text: card, buttons: [{ label: "O'zimga olish", action: `claim:${lead.id}` }] },
          scheduledFor: new Date(),
        });
      } else {
        this.log('warn', 'sales_group_chat_id sozlanmagan - lead faqat panelda ko\'rinadi');
      }
      await this.db.recordEvent('sales_lead_created', { userId: user.id, dedupeKey: `${user.id}:sales_created` });
      if (blkSubmitted) {
        const fresh = await this.db.getState(user.id);
        if (fresh) await this.sendBlock(user, fresh, blkSubmitted, meta);
      }
    } catch (e) {
      // Uzatish bo'lmadi - soxta tasdiq YUBORILMAYDI; jamaga tekshirish xabari.
      this.log('error', `sales handoff failed: ${(e as Error).message.slice(0, 200)}`);
      const groupId = (await this.setting(SETTING_KEYS.salesGroupChatId)) as string | null;
      if (groupId) {
        await this.db
          .enqueueOutbox({
            userId: user.id,
            type: 'notification',
            dedupeKey: `sales:handoff_failed:${user.id}:${Date.now()}`,
            payload: { chatId: Number(groupId), text: `Diqqat: lead uzatishda xatolik (user ${user.telegramId}). Tekshirib, paneldan qayta yuboring.` },
            scheduledFor: new Date(),
          })
          .catch(() => undefined);
      }
      const pend = await this.db.getBlockByKey(K.submittedPending, 'approved');
      const fresh = await this.db.getState(user.id);
      if (pend && fresh) await this.sendBlock(user, fresh, pend, meta);
    }
  }

  private async leadCard(user: TelegramUser, leadId: string): Promise<string> {
    const lead = await this.db.getSalesLead(leadId);
    const state = await this.db.getState(user.id);
    const parts: string[] = ['Yangi tayyor lead (lead ' + leadId.slice(0, 8) + ')'];
    parts.push(`Manba: ${user.siteLeadId ? 'sayt + bot' : 'Telegram bot'}`);
    parts.push(`Telegram: ${user.username ? '@' + user.username : String(user.telegramId)}`);
    const phone = await this.userPhone(user);
    if (phone) parts.push('Telefon: ' + maskPhone(phone));
    if (lead?.businessType) parts.push('Biznes: ' + toPlainText(lead.businessType));
    if (lead?.problem) parts.push('Muammo: ' + this.problemLabel(lead.problem));
    if (lead?.productId) {
      const p = (await this.db.listProducts(true)).find((x) => x.id === lead.productId);
      if (p) {
        const price = p.priceType === 'fixed' && p.priceUsd !== null ? `${p.priceUsd.toLocaleString('en-US')} ${p.currency}` : 'kelishilgan narx';
        parts.push(`Mahsulot: ${p.name} (${price})`);
      }
    }
    if (state?.answers.readiness) parts.push('Tayyorgarlik: ' + state.answers.readiness);
    if (lead?.decisionMaker) parts.push('Qaror: ' + toPlainText(lead.decisionMaker));
    if (lead?.timeline) parts.push('Muddat: ' + this.timelineLabel(lead.timeline));
    if (lead?.openQuestion) parts.push('Ochiq savol: ' + toPlainText(lead.openQuestion).slice(0, 160));
    parts.push(`Aloqa roziligi: bor; usul: ${lead?.contactMethod ?? 'telegram'}${lead?.preferredTime ? '; vaqt: ' + toPlainText(lead.preferredTime).slice(0, 60) : ''}`);
    parts.push("Darsni ko'rgani (o'zi): " + (state?.lessonWatchedAt ? 'ha' : 'yo\'q'));
    return parts.join('\n');
  }

  // ==========================================================================
  // Sotuvchi claims (guruhda) - atomik, faqat ro'yxatdagi xodimlar
  // ==========================================================================

  private async handleClaim(user: TelegramUser, meta: BotMessageMeta & { callbackId: string }, leadId: string): Promise<void> {
    const staffIds = this.opts.salesStaffTelegramIds ?? [];
    const mappingRaw = (await this.setting('sales_staff')) as { telegramId: number; adminEmail: string }[] | null;
    const mapping = Array.isArray(mappingRaw) ? mappingRaw : [];
    const entry = mapping.find((m) => m.telegramId === user.telegramId);
    const inStaffList = staffIds.includes(user.telegramId);
    if (!entry || !inStaffList) {
      await this.safeAnswer(meta.callbackId, 'Siz sotuvchilar ro\'yxatida yo\'qsiz.');
      return;
    }
    const admin = await this.db.getAdminByEmail(entry.adminEmail);
    if (!admin) {
      await this.safeAnswer(meta.callbackId, 'Admin topilmadi - panel sozlamalarini tekshiring.');
      return;
    }
    const res = await this.db.claimSalesLead(leadId, admin.id);
    if (res.ok) {
      await this.db.appendSalesEvent(leadId, 'claimed', { via: 'telegram_claim' });
      await this.safeAnswer(meta.callbackId, 'Qabul qilindi - lead sizga biriktirildi.');
      const lead = await this.db.getSalesLead(leadId);
      if (lead) {
        const buyer = await this.db.getUserById(lead.userId);
        if (buyer) await this.msg.sendText(buyer.telegramId, "Sotuvchi arizangizni qabul qildi - belgilangan vaqtda bog'lanadi.");
      }
    } else {
      await this.safeAnswer(meta.callbackId, res.reason === 'already_claimed' ? 'Bu lead allaqachon olingan.' : 'Lead topilmadi.');
    }
  }

  // ==========================================================================
  // Buyruq tugmalari va erkin matn
  // ==========================================================================

  private async handleCommandAction(user: TelegramUser, state: ConversationState, cmd: string, meta: BotMessageMeta): Promise<void> {
    if (cmd === 'menu') {
      await this.setState(user.id, { stage: 'MENU' });
      const blk = await this.db.getBlockByKey(K.menu, 'approved');
      if (blk) await this.sendBlock(user, state, blk, meta);
      return;
    }
    if (cmd === 'stop') {
      await this.db.revokeConsent(user.id, 'marketing');
      await this.db.cancelPendingOutboxForUser(user.id);
      await this.msg.sendText(meta.chatId, 'Barcha eslatmalar bekor qilindi. Davom etish uchun /start.');
      return;
    }
    if (cmd === 'ask') {
      await this.setState(user.id, { stage: 'ASK_QUESTION' });
      await this.renderStage(user, meta);
      return;
    }
    if (cmd === 'edit') {
      await this.setState(user.id, { stage: 'CONTACT_METHOD' });
      await this.renderStage(user, meta);
    }
  }

  /** Erkin matn: faqat free-text bosqichlarida qabul qilinadi. */
  async handleText(meta: BotMessageMeta, raw: string, contact?: { phone?: string }): Promise<void> {
    return this.enqueue(meta.telegramId, async () => {
      const user = await this.db.getUserByTelegramId(meta.telegramId);
      if (!user) return;
      const state = await this.db.getState(user.id);
      if (!state) return;
      if (contact?.phone) {
        const phone = contact.phone.replace(/[^\d+]/g, '').slice(0, 20);
        await this.setState(user.id, { contactMethod: 'phone', answers: { ...state.answers, phone }, stage: 'PREFERRED_TIME' });
        await this.renderStage(user, meta);
        return;
      }
      const text = toPlainText(raw).slice(0, 500);
      if (!text) return;
      const stage = state.stage;
      if (!(FREE_TEXT_STAGES as readonly string[]).includes(stage) && stage !== 'MENU') {
        const blk = await this.db.getBlockByKey('unknown', 'approved');
        if (blk) await this.sendBlock(user, state, blk, meta);
        return;
      }
      const go = async (patch: Partial<ConversationState>): Promise<void> => {
        await this.setState(user.id, patch);
        await this.renderStage(user, meta);
      };
      switch (stage) {
        case 'SURVEY_ROLE_TEXT':
          await go({ answers: { ...state.answers, role: text.slice(0, 60) }, stage: 'SURVEY_PROBLEM' });
          return;
        case 'SURVEY_PROBLEM_TEXT':
          await go({ answers: { ...state.answers, problem: text.slice(0, 120) }, stage: 'SURVEY_PATH' });
          return;
        case 'BUSINESS_TYPE': {
          const pending = state.answers.pending_path && this.isStage(state.answers.pending_path) ? (state.answers.pending_path as Stage) : 'PATH_SELF';
          const answers: Answers = { ...state.answers, business: text.slice(0, 120) };
          delete answers.pending_path;
          await go({ answers, stage: pending });
          return;
        }
        case 'PREFERRED_TIME':
          await go({ preferredTime: text.slice(0, 120), stage: 'REVIEW_SUBMIT' });
          return;
        case 'ASK_QUESTION':
        case 'TECH_HELP': {
          await this.db.createHelpRequest(user.id, text);
          await this.db.recordEvent('help_request_created', { userId: user.id });
          await go({ answers: { ...state.answers, question: text.slice(0, 300) }, stage: 'ANSWER_FOLLOWUP' });
          return;
        }
        case 'OFFER_SERVICE':
        case 'OBJECTION_EMPLOYEE':
        case 'OBJECTION_PRICE':
        case 'OBJECTION_START': {
          await this.db.createHelpRequest(user.id, text);
          await this.msg.sendText(meta.chatId, "Holatingizni yozib oldik - savol bo'yicha javob beramiz. Xohlasangiz 'Sotuv bilan suhbat' bo'limidan davom eting.");
          await go({ answers: { ...state.answers, question: text.slice(0, 300) }, stage: 'READINESS' });
          return;
        }
        case 'DECISION_LEADER': {
          await go({ answers: { ...state.answers, decision: 'rahbar orqali: ' + text.slice(0, 80) }, stage: 'PREFLIGHT_VIDEO' });
          return;
        }
        default: {
          // MENU holatida yozilgan xabar - savol sifatida qabul qilinadi
          await this.db.createHelpRequest(user.id, text);
          await this.db.recordEvent('help_request_created', { userId: user.id });
          await go({ answers: { ...state.answers, question: text.slice(0, 300) }, stage: 'ANSWER_FOLLOWUP' });
        }
      }
    });
  }
}

const KNOWN_STAGES = new Set<string>([
  'START',
  'EXPERIENCE_VIDEO',
  'CLIENT_REVIEW',
  'METHOD_VIDEO',
  'SURVEY_ROLE',
  'SURVEY_ROLE_TEXT',
  'SURVEY_PROBLEM',
  'SURVEY_PROBLEM_TEXT',
  'SURVEY_PATH',
  'BUSINESS_TYPE',
  'PATH_SELF',
  'PATH_EMPLOYEE',
  'PATH_UNSURE',
  'LESSON_INTRO',
  'TASK',
  'TASK_CORRECT',
  'TASK_WRONG',
  'AFTER_LESSON_VIDEO',
  'STUDENT_REVIEW',
  'CONSENT_REMINDERS',
  'OFFERS',
  'OFFER_COURSE',
  'OFFER_VIDEOS',
  'OFFER_SERVICE',
  'COMPARE',
  'OBJECTION_TIME',
  'OBJECTION_EMPLOYEE',
  'OBJECTION_PRICE',
  'OBJECTION_START',
  'ASK_QUESTION',
  'ANSWER_FOLLOWUP',
  'READINESS',
  'TIMELINE',
  'DECISION_MAKER',
  'DECISION_LEADER',
  'PREFLIGHT_VIDEO',
  'CONSENT_CONTACT',
  'CONTACT_METHOD',
  'PREFERRED_TIME',
  'REVIEW_SUBMIT',
  'SUBMITTED',
  'NOT_READY',
  'MENU',
  'NOTIF_SETTINGS',
  'REMINDERS_OFF',
  'TECH_HELP',
  'UNKNOWN',
  'PURCHASE_START',
]);
