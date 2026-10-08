// ============================================================================
// BotEngine - DB-driven state machine. NO grammY import here: yagona
// chiqish - Messenger interfeysi orqali (prod: grammY, test: TestMessenger).
// Qoidalar:
//  - Har bir update updateId bo'yicha bir marta qayta ishlanadi (dedupe).
//  - Har bir foydalanuvchi uchun xabarlar ketma-ket (per-user queue) ishlaydi.
//  - Eski/takror bosilgan tugmalar sales status'ni orqaga qaytarmaydi.
//  - Media yo'q va majburiy bo'lsa - blok o'tkazib yuboriladi (keyingi
//    bosqichga o'tadi), admin panelida ogohlantirish ko'rinadi.
//  - Tasdiqlanmagan narx/taklif (special-800) foydalanuvchiga HECH QACHON
//    ko'rsatilmaydi.
// ============================================================================
import type {
  ButtonDef,
  ContentBlock,
  ConversationState,
  Database,
  Messenger,
  Stage,
  TelegramUser,
} from '@app/shared';
import { SETTING_KEYS, maskPhone, toPlainText } from '@app/shared';

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

const NEXT_AFTER_ANSWER: Record<string, Stage> = {
  role: 'SURVEY_PROBLEM',
  problem: 'SURVEY_PATH',
  timeline: 'DECISION_MAKER',
  decision: 'CONSENT_CONTACT',
};

const PATH_BY_ANSWER: Record<string, Stage> = {
  self: 'PATH_SELF',
  employee: 'PATH_EMPLOYEE',
  unsure: 'PATH_UNSURE',
};

/** Majburiy media bloki media yo'qligi sababli o'tkazib yuborilsa, qayerga? */
const SKIP_TARGETS: Partial<Record<Stage, Stage>> = {
  INTRO_VIDEO: 'EXPERIENCE_VIDEO',
  EXPERIENCE_VIDEO: 'CLIENT_REVIEW',
  METHOD_VIDEO: 'SURVEY_ROLE',
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
  // Blok render: media mantig'i + tugmalar filtr + funnel event
  // ==========================================================================

  private async renderStage(user: TelegramUser, meta: BotMessageMeta): Promise<void> {
    const state = await this.db.getState(user.id);
    if (!state) return;
    for (let guard = 0; guard < 8; guard++) {
      const block = await this.db.getBlockByStage(state.stage, 'approved');
      if (!block) {
        // Blok yo'q yoki tasdiqlanmagan - keyingi bosqichga o'tamiz.
        const nxt = SKIP_TARGETS[state.stage];
        if (!nxt) {
          this.log('warn', `no approved block for stage ${state.stage}; held`);
          return;
        }
        await this.setState(user.id, { stage: nxt });
        continue;
      }
      const ok = await this.sendBlock(user, state, block, meta);
      if (ok) {
        await this.db.recordEvent(`stage:${state.stage}`, {
          userId: user.id,
          dedupeKey: `${user.id}:stage:${state.stage}`,
        });
        return;
      }
      const nxt = SKIP_TARGETS[state.stage] ?? block.buttons[0]?.action.match(/^goto:([A-Z_]+)$/)?.[1];
      if (!nxt) return;
      await this.setState(user.id, { stage: nxt as Stage });
    }
    this.log('warn', 'renderStage guard loop exceeded');
  }

  /** @returns true - xabar yuborildi; false - blok o'tkazib yuborildi. */
  private async sendBlock(user: TelegramUser, state: ConversationState, block: ContentBlock, meta: BotMessageMeta): Promise<boolean> {
    let body = block.body;
    const buttons = await this.filterButtons(user, state, block);

    // Product kartalari - narxlar faqat DB'dan, tasdiqlanmaganlari yashirin.
    if (block.stage === 'OFFER_COURSE' || block.stage === 'OFFER_VIDEOS' || block.stage === 'OFFER_SERVICE' || block.stage === 'COMPARE') {
      const card = await this.productCard(block.stage);
      if (card) body = body + '\n\n' + card;
    }
    if (block.stage === 'LESSON_INTRO') {
      const link = await this.setting(SETTING_KEYS.lessonLink);
      if (typeof link === 'string' && link) body = body + '\n' + link;
    }

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
      // media muvaffaqiyatsiz - matn fallback'ga tushamiz
    }
    if (block.requiresMedia && !block.textFallbackAllowed) {
      return false; // majburiy material yo'q - blok yuborilmaydi
    }
    const r = await this.msg.sendText(meta.chatId, body, buttons);
    return r.ok;
  }

  private async filterButtons(user: TelegramUser, state: ConversationState, block: ContentBlock): Promise<ButtonDef[]> {
    const cond = block.showCondition;
    // Panel'dan 'o'chirilgan' (hidden) tugmalar yuborilmaydi.
    let buttons = block.buttons.filter((b) => b.hidden !== true);
    if (cond?.lessonLinkRequired) {
      const link = await this.setting(SETTING_KEYS.lessonLink);
      if (typeof link !== 'string' || !link) buttons = buttons.filter((b) => b.action !== 'lesson:open');
    }
    if (cond?.requiresVisibleProducts) {
      const visible = (await this.db.listProducts(true)).filter((p) => p.visibleToUsers && p.priceType !== 'unconfirmed');
      if (visible.length === 0) buttons = buttons.filter((b) => !b.action.startsWith('goto:OFFER_'));
    }
    // Sotuvga topshirilgan/xarid qilingan foydalanuvchiga sales tugmalari kerak emas.
    if (state.salesStatus === 'in_sales' || state.salesStatus === 'purchased') {
      buttons = buttons.filter((b) => !['goto:CONSENT_CONTACT', 'goto:READINESS', 'submit:send'].includes(b.action));
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
          // expired/taken/not_found - oddiy kirish davom etadi (xato ko'rsatilmaydi)
          this.log('info', `link token not usable: ${claim.reason ?? 'invalid'} for user ${user.id}`);
        }
      }
      await this.db.recordEvent('bot_start', { userId: user.id, dedupeKey: `${user.id}:first_start` });
      const state = await this.db.getState(user.id);
      if (state && state.stage !== 'START') {
        // Qaytgan foydalanuvchini boshidan o'tkazmaymiz - menyu ko'rsatamiz.
        const menu = await this.db.getBlockByKey('menu', 'approved');
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
      // Sotuvchi guruhdan claim qilishi mumkin - u hali bot foydalanuvchisi
      // bo'lmasligi shart emas: minimum profil yaratamiz.
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
            await this.handleGoto(user, state, arg as Stage, meta);
            break;
          case 'answer': {
            const [field = '', value = ''] = arg.split('=');
            await this.handleAnswer(user, state, field, value, meta);
            break;
          }
          case 'task':
            await this.setState(user.id, { taskAnswer: arg, stage: 'TASK_RESULT' });
            await this.renderStage(user, meta);
            break;
          case 'lesson':
            await this.handleLesson(user, state, arg, meta);
            break;
          case 'consent':
            await this.handleConsent(user, state, arg, meta);
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
            await this.msg.answerCallback(meta.callbackId);
            // noto'g'ri data - joriy sahnani qayta ko'rsatamiz
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

  private async handleGoto(user: TelegramUser, state: ConversationState, stage: Stage, meta: BotMessageMeta): Promise<void> {
    // Rewind himoyasi: sotuv bosqichlaridan orqaga qaytarilmaydi.
    const SALES_LOCKED: Stage[] = ['READINESS', 'CONSENT_CONTACT', 'REVIEW_SUBMIT', 'SUBMITTED'];
    if (state.salesStatus === 'in_sales' && SALES_LOCKED.includes(stage)) {
      await this.renderStage(user, meta); // joriy sahna qayta ko'rsatiladi, status o'zgarmaydi
      return;
    }
    if (state.salesStatus === 'purchased') {
      const blk = await this.db.getBlockByKey('menu', 'approved');
      if (blk) await this.sendBlock(user, state, blk, meta);
      return;
    }
    await this.setState(user.id, { stage });
    await this.noteProductInterest(user, stage);
    await this.renderStage(user, meta);
  }

  private async handleAnswer(user: TelegramUser, state: ConversationState, field: string, value: string, meta: BotMessageMeta): Promise<void> {
    if (!field || !value || field.length > 40 || value.length > 60) return;
    const answers = { ...state.answers, [field]: value };
    let stage: Stage | null = null;
    if (field === 'path') stage = PATH_BY_ANSWER[value] ?? null;
    if (!stage) stage = NEXT_AFTER_ANSWER[field] ?? null;
    if (!stage) {
      await this.setState(user.id, { answers });
      return;
    }
    await this.setState(user.id, { answers, stage });
    await this.renderStage(user, meta);
  }

  private async handleLesson(user: TelegramUser, state: ConversationState, action: string, meta: BotMessageMeta): Promise<void> {
    if (action === 'open') {
      const link = (await this.setting(SETTING_KEYS.lessonLink)) as string | null;
      if (!link) return;
      await this.setState(user.id, { lessonLinkClickedAt: new Date() });
      await this.db.recordEvent('lesson_link_clicked', { userId: user.id, dedupeKey: `${user.id}:lesson_clicked` });
      await this.msg.sendText(meta.chatId, 'Dars havolasi quyida. Ko\'rgach "Ko\'rdim" tugmasini bosing.\n' + link);
      return;
    }
    if (action === 'watched') {
      // "watched" - faqat foydalanuvchining o'zi belgilaydi (self-report).
      await this.setState(user.id, { lessonWatchedAt: new Date(), stage: 'LESSON_OFFER' });
      await this.db.recordEvent('lesson_self_reported_watched', { userId: user.id, dedupeKey: `${user.id}:lesson_watched` });
      await this.renderStage(user, meta);
    }
  }

  private async handleConsent(user: TelegramUser, state: ConversationState, action: string, meta: BotMessageMeta): Promise<void> {
    if (action === 'grant') {
      await this.setState(user.id, { contactConsentGivenAt: new Date(), stage: 'CONTACT_METHOD' });
      await this.db.recordEvent('contact_consent_granted', { userId: user.id, dedupeKey: `${user.id}:contact_consent` });
      await this.renderStage(user, meta);
      return;
    }
    if (action === 'decline') {
      await this.setState(user.id, { stage: 'NOT_READY', salesStatus: 'not_ready' });
      await this.renderStage(user, meta);
      return;
    }
    if (action === 'revoke_marketing') {
      await this.db.revokeConsent(user.id, 'marketing');
      const n = await this.db.cancelPendingOutboxForUser(user.id, ['marketing', 'reminder']);
      this.log('info', `marketing revoked; cancelled ${n} queued for ${user.id}`);
      await this.msg.sendText(meta.chatId, 'Tushunarli - eslatmalar yuborilmaydi.');
    }
  }

  private async handleContactChoice(user: TelegramUser, state: ConversationState, method: string, meta: BotMessageMeta): Promise<void> {
    if (method === 'phone') {
      await this.setState(user.id, { contactMethod: 'phone', stage: 'PREFERRED_TIME' });
      const blk = await this.db.getBlockByStage('PREFERRED_TIME', 'approved');
      if (blk) {
        await this.sendBlock(user, state, blk, meta);
        await this.msg.requestContact(meta.chatId, 'Telefon raqamingizni yuboring (xohlasangiz yozing ham).');
      }
      return;
    }
    await this.setState(user.id, { contactMethod: 'telegram', stage: 'REVIEW_SUBMIT' });
    await this.renderStage(user, meta);
  }

  // ==========================================================================
  // Ariza yuborish (sales handoff) - idempotent
  // ==========================================================================

  private static OFFER_SLUG: Partial<Record<Stage, string>> = {
    OFFER_COURSE: 'course',
    OFFER_VIDEOS: 'video-lessons',
    OFFER_SERVICE: 'service',
  };

  private async noteProductInterest(user: TelegramUser, stage: Stage): Promise<void> {
    const slug = BotEngine.OFFER_SLUG[stage];
    if (!slug) return;
    const p = await this.db.getProductBySlug(slug);
    if (!p || !p.visibleToUsers || p.priceType === 'unconfirmed') return;
    await this.setState(user.id, { interestedProductId: p.id });
    if (p.currentVersionId) await this.db.recordProductView(user.id, p.id, p.currentVersionId);
  }

  private async productCard(stage: Stage): Promise<string | null> {
    const slug = BotEngine.OFFER_SLUG[stage];
    const all = await this.db.listProducts(true);
    const visible = all.filter((p) => p.visibleToUsers && p.isActive && p.priceType !== 'unconfirmed');
    const shown = stage === 'COMPARE' ? visible : visible.filter((p) => p.slug === slug);
    if (shown.length === 0) return null;
    const lines: string[] = [];
    for (const p of shown) {
      lines.push('* ' + p.name);
      if (p.priceType === 'fixed' && p.priceUsd !== null) {
        lines.push(`  Narxi: ${p.priceUsd.toLocaleString('en-US')} ${p.currency}`);
      } else {
        const dt = (p.details?.pricingText as string | undefined) ?? (await this.setting(SETTING_KEYS.servicePricingText));
        lines.push('  ' + (typeof dt === 'string' && dt ? dt : 'Narx suhbatda aniqlanadi.'));
      }
      lines.push('  ' + 'Taklif shartlari admin tomonidan tasdiqlangach ko\'rsatiladi.');
    }
    return lines.join('\n');
  }

  private async handleSubmit(user: TelegramUser, state: ConversationState, action: string, meta: BotMessageMeta): Promise<void> {
    if (action === 'edit') {
      await this.setState(user.id, { stage: 'CONTACT_METHOD' });
      await this.renderStage(user, meta);
      return;
    }
    if (action !== 'send') return;
    // Roziliksiz ariza yaratilmaydi.
    if (!state.contactConsentGivenAt) {
      await this.setState(user.id, { stage: 'CONSENT_CONTACT' });
      await this.renderStage(user, meta);
      return;
    }
    if (state.salesStatus === 'in_sales' || state.salesStatus === 'purchased') {
      // Takroriy bosish - yangi ariza YO'Q, foydalanuvchiga faqat tasdiq.
      const blk = await this.db.getBlockByKey('submitted', 'approved');
      if (blk) await this.sendBlock(user, state, blk, meta);
      return;
    }
    const existing = await this.db.getActiveLeadByUser(user.id);
    if (existing) {
      await this.setState(user.id, { stage: 'SUBMITTED', salesStatus: 'in_sales' });
      return;
    }
    const views = await this.db.listProductViews(user.id);
    const lastView = views[views.length - 1];
    const lead = await this.db.createSalesLead({
      userId: user.id,
      siteLeadId: user.siteLeadId,
      productId: state.interestedProductId ?? lastView?.productId ?? null,
      productVersionId: state.interestedProductId ? (views.find((v) => v.productId === state.interestedProductId)?.productVersionId ?? null) : (lastView?.productVersionId ?? null),
      task: state.taskAnswer,
      problem: state.answers.problem ?? null,
      businessType: state.answers.businessType ?? null,
      decisionMaker: state.answers.decision ?? null,
      timeline: state.answers.timeline ?? null,
      contactMethod: state.contactMethod,
      preferredTime: state.preferredTime,
      contactConsent: true,
      openQuestion: state.answers.question ?? null,
    });
    await this.setState(user.id, { stage: 'SUBMITTED', salesStatus: 'in_sales' });
    // Sotuvga o'tgan foydalanuvchiga reminder/marketing to'xtatiladi.
    await this.db.cancelPendingOutboxForUser(user.id, ['reminder', 'marketing']);
    // Sales group xabari - outbox orqali (muvaffaqiyatsiz bo'lsa ham lead yo'qolmaydi).
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
    const blk = await this.db.getBlockByKey('submitted', 'approved');
    if (blk) await this.sendBlock(user, state, blk, meta);
  }

  private async leadCard(user: TelegramUser, leadId: string): Promise<string> {
    const lead = await this.db.getSalesLead(leadId);
    const state = await this.db.getState(user.id);
    const parts = [
      'Yangi ariza (lead ' + leadId.slice(0, 8) + ')',
      `Ism: ${toPlainText(user.firstName) || '-'} ${toPlainText(user.lastName) || ''}`.trim(),
      `Telegram: ${user.username ? '@' + user.username : String(user.telegramId)}`,
    ];
    const siteLead = user.siteLeadId ? await this.db.getSiteLeadById(user.siteLeadId) : null;
    if (siteLead) parts.push(`Sayt: ${toPlainText(siteLead.name)}, ${maskPhone(siteLead.phone)}`);
    if (lead) {
      if (lead.businessType) parts.push('Biznes: ' + toPlainText(lead.businessType));
      if (lead.problem) parts.push('Muammo: ' + toPlainText(lead.problem));
      if (lead.timeline) parts.push('Muddat: ' + lead.timeline);
      if (lead.contactMethod === 'phone' && lead.userId && siteLead?.phone) parts.push('Tel: ' + siteLead.phone);
      if (lead.preferredTime) parts.push('Qulay vaqt: ' + toPlainText(lead.preferredTime));
    }
    if (state?.taskAnswer) parts.push('Vazifa: ' + state.taskAnswer);
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
        if (buyer) {
          await this.msg.sendText(buyer.telegramId, 'Sotuvchi arizangizni qabul qildi - tez orada bog\'lanadi.');
        }
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
      const blk = await this.db.getBlockByKey('menu', 'approved');
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
    if (cmd === 'back') {
      await this.setState(user.id, { stage: 'MENU' });
      const blk = await this.db.getBlockByKey('menu', 'approved');
      if (blk) await this.sendBlock(user, state, blk, meta);
    }
  }

  /** Erkin matn: faqat Free-text bosqichlarida qabul qilinadi. */
  async handleText(meta: BotMessageMeta, raw: string, contact?: { phone?: string }): Promise<void> {
    return this.enqueue(meta.telegramId, async () => {
      const user = await this.db.getUserByTelegramId(meta.telegramId);
      if (!user) return;
      const state = await this.db.getState(user.id);
      if (!state) return;
      if (contact?.phone) {
        const phone = contact.phone.replace(/[^\d+]/g, '').slice(0, 20);
        await this.setState(user.id, { answers: { ...state.answers, phone }, stage: 'REVIEW_SUBMIT' });
        await this.renderStage(user, meta);
        return;
      }
      const text = toPlainText(raw).slice(0, 500);
      if (!text) return;
      const stage = state.stage;
      const go = async (patch: Partial<ConversationState>): Promise<void> => {
        await this.setState(user.id, patch);
        await this.renderStage(user, meta);
      };
      switch (stage) {
        case 'BUSINESS_TYPE':
          await go({ stage: 'NEED_CHECK', answers: { ...state.answers, businessType: text } });
          break;
        case 'PREFERRED_TIME':
          await go({ stage: 'REVIEW_SUBMIT', preferredTime: text, answers: { ...state.answers, time: 'custom' } });
          break;
        case 'ASK_QUESTION':
        case 'TECH_HELP':
          await this.db.createHelpRequest(user.id, text);
          await this.db.recordEvent('help_request_created', { userId: user.id });
          await go({ stage: 'MENU' });
          break;
        case 'OBJECTION':
        case 'OBJECTION_TIME':
        case 'OBJECTION_PRICE':
        case 'OBJECTION_EMPLOYEE':
        case 'OBJECTION_START':
          await go({ stage: 'READINESS', answers: { ...state.answers, objection: text } });
          break;
        case 'DECISION_MAKER_LEADER':
          await go({ stage: 'CONSENT_CONTACT', answers: { ...state.answers, decision: 'leader:' + text } });
          break;
        default: {
          const blk = await this.db.getBlockByKey('unknown', 'approved');
          if (blk) await this.sendBlock(user, state, blk, meta);
        }
      }
    });
  }
}
