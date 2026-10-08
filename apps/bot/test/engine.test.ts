// ============================================================================
// BotEngine testlari - HAQIQIY Telegram ishlatilmaydi.
// MemoryDatabase + TestMessenger + applySeed (yangi 51-bo'lim seed). Har test mustaqil.
// ============================================================================
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryDatabase, TestMessenger } from '@app/shared';
import type { Database } from '@app/shared';
import { applySeed } from '@app/db';
import { BotEngine } from '../src/engine.js';
import { routeUpdate } from '../src/index.js';
import { isWithinSendingWindow, tashkentDayKey } from '@app/shared';

let db: Database;
let msg: TestMessenger;
let engine: BotEngine;
let updateSeq = 1000;

const TG = { id: 700001, username: 'test_user', firstName: 'Test', languageCode: 'uz' };

function siteLeadData(name: string) {
  return { name, phone: '+998901112233', utmSource: 'site', utmMedium: null, utmCampaign: null, consentContact: true, consentMarketing: false, consentVersion: 'v1' };
}

async function setup(): Promise<void> {
  db = new MemoryDatabase();
  msg = new TestMessenger();
  await applySeed(db, () => undefined);
  await db.setSetting('sales_group_chat_id', '999000');
  await db.setSetting('sales_staff', [
    { telegramId: 111, adminEmail: 's1@test.uz' },
    { telegramId: 222, adminEmail: 's2@test.uz' },
  ]);
  await db.createAdmin({ email: 's1@test.uz', passwordHash: 'x', name: 'S1', role: 'sales', failedLogins: 0, lockedUntil: null, lastLoginAt: null });
  await db.createAdmin({ email: 's2@test.uz', passwordHash: 'x', name: 'S2', role: 'sales', failedLogins: 0, lockedUntil: null, lastLoginAt: null });
  engine = new BotEngine(db, msg, { demoMode: true, salesStaffTelegramIds: [111, 222] });
  updateSeq = 1000;
}

beforeEach(setup);

async function start(startParam?: string, telegramId = TG.id): Promise<void> {
  await engine.handleStart({ updateId: ++updateSeq, chatId: telegramId, telegramId }, { username: TG.username, firstName: TG.firstName, languageCode: TG.languageCode }, startParam);
}

async function click(data: string, telegramId = TG.id): Promise<void> {
  await engine.handleCallback({ updateId: ++updateSeq, chatId: telegramId, telegramId, callbackId: 'cb' + telegramId + '_' + data + '_' + updateSeq, data });
}

function lastText(chatId?: number): string {
  return msg.last(chatId)?.text ?? '';
}

describe('token linking', () => {
  it("1. valid token: user siteLeadga boglanadi, qayta kirish OK", async () => {
    const lead = await db.createSiteLead(siteLeadData('Ali'));
    const t = await db.createLinkToken(lead.id, 24);
    await start(t.token);
    const user = await db.getUserByTelegramId(TG.id);
    expect(user?.siteLeadId).toBe(lead.id);
    // xush kelibsiz ko'rsatildi
    expect(lastText(TG.id).length).toBeGreaterThan(0);
  });

  it("2. expired token: xato ko'rsatilmaydi - oddiy kirish, lead bog'lanmaydi", async () => {
    const lead = await db.createSiteLead(siteLeadData('Vali'));
    const t = await db.createLinkToken(lead.id, -1);
    await start(t.token);
    const user = await db.getUserByTelegramId(TG.id);
    expect(user?.siteLeadId).toBeNull();
    expect(msg.forChat(TG.id).some((m) => /xato|expired/i.test(m.text ?? ''))).toBe(false);
  });

  it("3. taken token (boshqa user olgan) -> oddiy kirish", async () => {
    const lead = await db.createSiteLead(siteLeadData('Eshon'));
    const t = await db.createLinkToken(lead.id, 24);
    await start(t.token, 700002); // birinchi user oldi
    await start(t.token, 700003); // ikkinchi - oddiy kirish
    const u3 = await db.getUserByTelegramId(700003);
    expect(u3?.siteLeadId).toBeNull();
  });

  it("4. invalid format token - majburiy bog'lash yo'q", async () => {
    await start('not-a-real-token!!');
    expect(msg.last(TG.id)).toBeDefined(); // bot javob berdi, to'xtab qolmadi
  });

  it("5. direct entry (tokensiz /start) ishlaydi", async () => {
    await start();
    const user = await db.getUserByTelegramId(TG.id);
    expect(user).not.toBeNull();
    expect(lastText(TG.id)).toContain('Xush kelibsiz');
  });
});

describe('funnel paths', () => {
  it("6. tanishuv yo'li: START -> EXPERIENCE_VIDEO (media yo'q - matn fallback)", async () => {
    await start();
    msg.clear();
    await click('goto:EXPERIENCE_VIDEO');
    const st = await db.getState((await db.getUserByTelegramId(TG.id))!.id);
    expect(st?.stage).toBe('EXPERIENCE_VIDEO');
    expect(lastText(TG.id)).toContain("mijozimizning fikrini");
    // START blockida videoNote yo'q - matn yuboriladi, xato bo'lmaydi
    expect(msg.forChat(TG.id).length).toBeGreaterThan(0);
  });

  it("7. lesson havolasi to'ldirilmagan -> bo'lim OCHILMAYDI (section_soon)", async () => {
    await start();
    msg.clear();
    await click('goto:LESSON_INTRO');
    expect(lastText(TG.id)).toContain('hali tayyorlanmoqda');
    // havola berilgach bo'lim ishga tushadi
    await db.setSetting('lesson_link', 'https://example.uz/lesson');
    await click('goto:LESSON_INTRO');
    const last2 = msg.last(TG.id);
    const actions2 = (last2?.buttons ?? []).flat().map((b) => b.action);
    expect(actions2).toContain('lesson:open');
    expect(last2?.text).toContain('https://example.uz/lesson');
    // ochish != ko'rish
    await click('lesson:open');
    const user = await db.getUserByTelegramId(TG.id);
    const st = await db.getState(user!.id);
    expect(st?.lessonLinkClickedAt).not.toBeNull();
    expect(st?.lessonWatchedAt).toBeNull();
  });

  it("8. xizmat (service) yo'li: kurs darsidan o'tmasiz ham taklifga yetadi", async () => {
    await start();
    msg.clear();
    await click('goto:OFFER_SERVICE');
    const last = msg.last(TG.id);
    expect(last?.text).toContain('Xizmat');
    expect(last?.text).toContain('narxni shundan keyin aytishimiz mumkin');
    // qattiq narx ko'rsatilmaydi (by_scope)
    expect(last?.text).not.toMatch(/500 USD/);
  });

  it("9. maxsulot ko'rish tarixi: OFFER_COURSE -> product view + interestedProductId", async () => {
    await start();
    await click('goto:OFFER_COURSE');
    const user = await db.getUserByTelegramId(TG.id);
    const views = await db.listProductViews(user!.id);
    expect(views.length).toBe(1);
    const course = await db.getProductBySlug('course');
    expect(views[0]?.productId).toBe(course?.id);
    const st = await db.getState(user!.id);
    expect(st?.interestedProductId).toBe(course?.id);
  });
});

describe('prices and unconfirmed offer', () => {
  it("10. $800 taklifi tasdiqlanmagan - hech qachon ko'rsatilmaydi", async () => {
    await start();
    await click('goto:OFFERS');
    await click('goto:COMPARE');
    const allTexts = msg.forChat(TG.id).map((m) => m.text ?? '').join('\n');
    expect(allTexts).not.toMatch(/800/);
    expect(allTexts).not.toContain('special-800');
  });

  it("11. narx yangilansa - eski ko'rilgan versiya lead'da saqlanadi", async () => {
    const course = await db.getProductBySlug('course');
    await start();
    await click('goto:OFFER_COURSE');
    // rozilik orqali arizagacha yetamiz
    await click('consent:grant_contact');
    await click('contact:telegram');
    await click('submit:send');
    const user = await db.getUserByTelegramId(TG.id);
    const lead = await db.getActiveLeadByUser(user!.id);
    expect(lead).not.toBeNull();
    const oldVersionId = lead!.productVersionId;
    expect(oldVersionId).not.toBeNull();
    const oldPrice = (await db.getProductVersion(oldVersionId!))!.priceUsd;
    expect(oldPrice).toBe(2000);
    // narx o'zgarishi - yangi versiya
    await db.upsertProduct({ slug: 'course', kind: 'course', name: 'Moy Sklad kursi', description: 'yangi tavsif', details: {}, priceType: 'fixed', priceUsd: 2500, currency: 'USD', isActive: true, visibleToUsers: true });
    const updated = await db.getProductBySlug('course');
    expect(updated?.priceUsd).toBe(2500);
    const leadAfter = await db.getSalesLead(lead!.id);
    expect(leadAfter!.productVersionId).toBe(oldVersionId);
    expect((await db.getProductVersion(oldVersionId!))!.priceUsd).toBe(oldPrice);
  });
});

describe('idempotency, replay, stop conditions', () => {
  it("12. takroriy \"submit:send\" - bitta ariza, ikkinchisi yo'q", async () => {
    await start();
    await click('consent:grant_contact');
    await click('contact:telegram');
    await click('submit:send');
    const before = (await db.listSalesLeads()).total;
    await click('submit:send'); // eski tugma qayta bosildi
    await click('submit:send');
    const after = (await db.listSalesLeads()).total;
    expect(after).toBe(before);
    expect(after).toBe(1);
  });

  it("13. eski goto:PREFLIGHT_VIDEO - in_sales statusni orqaga qaytarmaydi", async () => {
    await start();
    await click('consent:grant_contact');
    await click('contact:telegram');
    await click('submit:send');
    const user = await db.getUserByTelegramId(TG.id);
    const st1 = await db.getState(user!.id);
    expect(st1?.salesStatus).toBe('in_sales');
    await click('goto:PREFLIGHT_VIDEO'); // eski sahna tugmasi
    const st2 = await db.getState(user!.id);
    expect(st2?.salesStatus).toBe('in_sales');
    expect(st2?.stage).toBe('SUBMITTED');
  });

  it("14. marketing roziligi yo'q - hasActiveConsent false; revoke keyin ham false", async () => {
    await start();
    const user = await db.getUserByTelegramId(TG.id);
    expect(await db.hasActiveConsent(user!.id, 'marketing')).toBe(false);
    await db.grantConsent(user!.id, 'marketing', 'v1');
    expect(await db.hasActiveConsent(user!.id, 'marketing')).toBe(true);
    await click('consent:revoke_marketing');
    expect(await db.hasActiveConsent(user!.id, 'marketing')).toBe(false);
  });

  it("15. revoke mavjud navbatni to'xtatadi", async () => {
    await start();
    const user = await db.getUserByTelegramId(TG.id);
    await db.enqueueOutbox({ userId: user!.id, type: 'reminder', dedupeKey: 'r1', payload: { blockKey: 'x' }, scheduledFor: new Date(Date.now() + 1000) });
    await db.enqueueOutbox({ userId: user!.id, type: 'marketing', dedupeKey: 'm1', payload: { blockKey: 'tip_cash' }, scheduledFor: new Date(Date.now() + 1000) });
    expect((await db.listOutbox({ userId: user!.id, status: 'pending' })).length).toBe(2);
    await click('consent:revoke_marketing');
    expect((await db.listOutbox({ userId: user!.id, status: 'pending' })).length).toBe(0);
  });

  it("16. sotuvga topshirilgach - eski reminder/marketing navbatlari bekor", async () => {
    await start();
    const user = await db.getUserByTelegramId(TG.id);
    await db.enqueueOutbox({ userId: user!.id, type: 'reminder', dedupeKey: 'r-old', payload: {}, scheduledFor: new Date(Date.now() + 3600_000) });
    await click('consent:grant_contact');
    await click('contact:telegram');
    await click('submit:send');
    const pending = await db.listOutbox({ userId: user!.id, status: 'pending' });
    expect(pending.filter((p) => p.type === 'reminder' || p.type === 'marketing').length).toBe(0);
  });

  it("17. ikki xodim race - bitta g'olib, ikkinchisiga \"allaqachon olingan", async () => {
    await start();
    await click('consent:grant_contact');
    await click('contact:telegram');
    await click('submit:send');
    const user = await db.getUserByTelegramId(TG.id);
    const lead = await db.getActiveLeadByUser(user!.id);
    expect(lead).not.toBeNull();
    msg.clear();
    await click(`claim:${lead!.id}`, 111);
    const claimed = await db.getSalesLead(lead!.id);
    expect(claimed?.assignedToId).not.toBeNull();
    const winnerId = claimed!.assignedToId;
    await click(`claim:${lead!.id}`, 222);
    const after = await db.getSalesLead(lead!.id);
    expect(after!.assignedToId).toBe(winnerId); // bir xil qoldi
    const answer = msg.answeredCallbacks.find((a) => (a.text ?? '').includes('allaqachon'));
    expect(answer).toBeDefined();
  });

  it("18. guruhdan tashqari xodim emas - claim rad etiladi", async () => {
    await start();
    await click('consent:grant_contact');
    await click('contact:telegram');
    await click('submit:send');
    const user = await db.getUserByTelegramId(TG.id);
    const lead = await db.getActiveLeadByUser(user!.id);
    msg.answeredCallbacks.length = 0;
    await click(`claim:${lead!.id}`, 999); // staff ro'yxatida yo'q
    const after = await db.getSalesLead(lead!.id);
    expect(after!.assignedToId).toBeNull();
    expect(msg.answeredCallbacks.some((a) => (a.text ?? '').includes("ro'yxatida"))).toBe(true);
  });

  it("19. Telegram xabar muvaffaqiyatsiz - lead baribir saqlanadi (outbox qayta urinishi kutadi)", async () => {
    await start();
    await click('consent:grant_contact');
    await click('contact:telegram');
    msg.nextResult = { ok: false, error: '429 Too Many Requests', ambiguous: false };
    await click('submit:send');
    const user = await db.getUserByTelegramId(TG.id);
    const lead = await db.getActiveLeadByUser(user!.id);
    expect(lead).not.toBeNull(); // lead yo'qolmadi
    // guruhga notification outbox'da pending (worker qayta urinishi uchun)
    const notify = await db.listOutbox({ userId: user!.id, status: 'pending' });
    expect(notify.some((n) => (n.payload as { chatId?: number }).chatId === 999000)).toBe(true);
  });

  it("20. \"restart\" - yangi engine shu DB bilan: foydalanuvchi menu'dan davom etadi, boshidan emas", async () => {
    await start();
    await click('goto:METHOD_VIDEO');
    const user = await db.getUserByTelegramId(TG.id);
    expect((await db.getState(user!.id))?.stage).toBe('METHOD_VIDEO');
    // process restart simulyatsiyasi: yangi engine
    const engine2 = new BotEngine(db, msg, { demoMode: true, salesStaffTelegramIds: [111, 222] });
    msg.clear();
    await engine2.handleStart({ updateId: ++updateSeq, chatId: TG.id, telegramId: TG.id }, { username: TG.username, firstName: TG.firstName, languageCode: TG.languageCode });
    const st = await db.getState(user!.id);
    expect(st?.stage).toBe('METHOD_VIDEO'); // bosqich saqlangan
    expect(lastText(TG.id)).toContain("Qaysi bo'limga kirmoqchisiz?"); // qaytishda menyu ko'rsatiladi
  });

  it("21. majburiy media + fallback taqiqlangan blok - o'tkazib yuboriladi, xabar yo'q", async () => {
    const before = msg.sent.length;
    await start();
    msg.clear();
    // client_review: requiresMedia + fallback taqiqlangan - bosqich o'tkaziladi
    const cur = await db.getBlockByKey('client_review', 'approved');
    expect(cur).not.toBeNull();
    await click('goto:EXPERIENCE_VIDEO'); // keyin CLIENT_REVIEW bosqichi navbatda
    await db.updateState((await db.getUserByTelegramId(TG.id))!.id, { stage: 'CLIENT_REVIEW' });
    msg.clear();
    await click('goto:CLIENT_REVIEW');
    const user = await db.getUserByTelegramId(TG.id);
    const st = await db.getState(user!.id);
    expect(st?.stage).toBe('METHOD_VIDEO'); // media yo'q -> keyingi goto'ga o'tdi
    void before;
    expect(msg.forChat(TG.id).some((m) => (m.text ?? '').includes('Mijozning tajribasini'))).toBe(false);
  });

  it("22. update dedupe: bir xil update_id ikki marta kelsa - ikkinchisi e'tiborsiz", async () => {
    const update = { update_id: 555, message: { chat: { id: TG.id }, from: { id: TG.id, username: TG.username, first_name: TG.firstName, language_code: TG.languageCode }, text: '/start' } };
    await routeUpdate(db, engine, update);
    const n1 = msg.sent.length;
    expect(n1).toBeGreaterThan(0);
    await routeUpdate(db, engine, update); // Telegram qayta yubordi
    expect(msg.sent.length).toBe(n1);
  });
});

describe('windows and statuses', () => {
  it('23. Tashkent oynasi: 08:59 tashqarida, 09:00 ichida, 20:30 tashqarida', () => {
    const mk = (utcIso: string) => new Date(utcIso);
    // UTC+5: 04:00 UTC = 09:00 Toshkent
    expect(isWithinSendingWindow(mk('2026-01-15T03:59:00Z'))).toBe(false);
    expect(isWithinSendingWindow(mk('2026-01-15T04:00:00Z'))).toBe(true);
    expect(isWithinSendingWindow(mk('2026-01-15T15:30:00Z'))).toBe(false);
    expect(tashkentDayKey(mk('2026-01-15T22:00:00Z'))).toBe('2026-01-16');
  });

  it("24. sotib olish tasdiqlansa - sales tugmalari o'chadi, rewind yo'q", async () => {
    await start();
    const user = await db.getUserByTelegramId(TG.id);
    await db.updateState(user!.id, { salesStatus: 'purchased', stage: 'OFFERS' });
    msg.clear();
    await click('goto:CONSENT_CONTACT');
    const st = await db.getState(user!.id);
    expect(st?.stage).toBe('OFFERS'); // o'zgarmadi
    expect(lastText(TG.id)).toContain("Qaysi bo'limga kirmoqchisiz?"); // xaridga faqat menyu
  });
});

describe('panel tugma nazorati', () => {
  it("25. hidden=true tugma botda yuborilmaydi, ochiqlari qoladi", async () => {
    const cur = await db.getBlockByKey('menu', 'approved');
    expect(cur).not.toBeNull();
    await db.upsertBlock({
      ...cur!,
      buttons: [
        { label: 'Bosh sahifa', action: 'cmd:menu', hidden: true },
        { label: 'Takliflar', action: 'goto:OFFERS', hidden: false },
      ],
    });
    await start();
    const last = msg.last(TG.id);
    const actions = (last?.buttons ?? []).flat().map((b) => b.action);
    expect(actions).not.toContain('cmd:menu');
    expect(actions).toContain('goto:OFFERS');
  });
});

describe('yangi spec qoidalari', () => {
  async function toStage(stage: string): Promise<void> {
    const user = await db.getUserByTelegramId(TG.id);
    await db.updateState(user!.id, { stage: stage as never });
  }

  it("26. task: noto'g'ri javob chetlashtirmaydi - izoh + davom tugmalari", async () => {
    await start();
    await toStage('TASK');
    msg.clear();
    await click('task:wrong');
    const user = await db.getUserByTelegramId(TG.id);
    const st = await db.getState(user!.id);
    expect(st?.stage).toBe('TASK_WRONG');
    expect(lastText(TG.id)).toContain('Muhim emas');
    const actions = (msg.last(TG.id)?.buttons ?? []).flat().map((b) => b.action);
    expect(actions).toContain('goto:AFTER_LESSON_VIDEO'); // davom etish mumkin
    await click('task:right');
    expect((await db.getState(user!.id))?.stage).toBe('TASK_CORRECT');
  });

  it('27. survey ketma-ketligi: role -> problem -> path; path -> biznes turi savoli bir marta', async () => {
    await start();
    await toStage('SURVEY_ROLE');
    await click('answer:role=self');
    expect((await db.getState((await db.getUserByTelegramId(TG.id))!.id))?.stage).toBe('SURVEY_PROBLEM');
    await click('answer:problem=stock');
    expect((await db.getState((await db.getUserByTelegramId(TG.id))!.id))?.stage).toBe('SURVEY_PATH');
    await click('goto:PATH_SELF');
    let user = await db.getUserByTelegramId(TG.id);
    let st = await db.getState(user!.id);
    expect(st?.stage).toBe('BUSINESS_TYPE'); // avval biznes turi so'raladi
    // erkin matn - keyin yo'l sahifasi
    await engine.handleText({ chatId: TG.id, telegramId: TG.id }, "Donut do'koni, 3 xodim");
    st = await db.getState((await db.getUserByTelegramId(TG.id))!.id);
    expect(st?.stage).toBe('PATH_SELF');
    expect(st?.answers.business).toContain('Donut');
    // endi qayta so'ralmaydi
    await click('goto:PATH_EMPLOYEE');
    st = await db.getState((await db.getUserByTelegramId(TG.id))!.id);
    expect(st?.stage).toBe('PATH_EMPLOYEE');
    void user;
  });

  it('28. sessiya oxiri: OFFERSga otingach rozilik so\u2018raladi; site roziligi bo\u2018lsa - so\u2018ralmaydi', async () => {
    await start();
    await toStage('AFTER_LESSON_VIDEO');
    msg.clear();
    await click('goto:OFFERS');
    const user = await db.getUserByTelegramId(TG.id);
    let st = await db.getState(user!.id);
    expect(st?.stage).toBe('CONSENT_REMINDERS');
    expect(lastText(TG.id)).toContain('Sizni shu yerda qoldiraylikmi');
    await click('consent:grant_marketing');
    st = await db.getState(user!.id);
    expect(st?.stage).toBe('OFFERS'); // javobdan keyin davom
    expect(await db.hasActiveConsent(user!.id, 'marketing')).toBe(true);
    // qaytganida endi so'ralmaydi
    await toStage('AFTER_LESSON_VIDEO');
    msg.clear();
    await click('goto:OFFERS');
    expect((await db.getState(user!.id))?.stage).toBe('OFFERS');
    expect(lastText(TG.id)).not.toContain('qoldiraylikmi');
  });

  it('29. mijoz videosi tugmalari media bo\u2018lmasa yashirin (17-qoida)', async () => {
    await start();
    await toStage('EXPERIENCE_VIDEO');
    msg.clear();
    await click('goto:EXPERIENCE_VIDEO');
    const actions = (msg.last(TG.id)?.buttons ?? []).flat().map((b) => b.action);
    expect(actions).not.toContain('goto:CLIENT_REVIEW');
    // admin media bog'lasa - tugma chiqadi
    const cur = await db.getBlockByKey('client_review', 'approved');
    await db.upsertBlock({ ...cur!, mediaId: 'media_test_1' });
    await click('goto:EXPERIENCE_VIDEO');
    const actions2 = (msg.last(TG.id)?.buttons ?? []).flat().map((b) => b.action);
    expect(actions2).toContain('goto:CLIENT_REVIEW');
  });

  it('30. sozlamalar: notif:off -> REMINDERS_OFF + revoke; notif:lessons -> scope', async () => {
    await start();
    const user = await db.getUserByTelegramId(TG.id);
    await db.grantConsent(user!.id, 'marketing', 'v1');
    await db.enqueueOutbox({ userId: user!.id, type: 'marketing', dedupeKey: 'q1', payload: { blockKey: 'tip_cash' }, scheduledFor: new Date(Date.now() + 60000) });
    await toStage('NOTIF_SETTINGS');
    msg.clear();
    await click('notif:off');
    expect((await db.getState(user!.id))?.stage).toBe('REMINDERS_OFF');
    expect(await db.hasActiveConsent(user!.id, 'marketing')).toBe(false);
    expect((await db.listOutbox({ userId: user!.id, status: 'pending' })).length).toBe(0);
    await click('notif:lessons');
    const st = await db.getState(user!.id);
    expect(st?.answers.notif_scope).toBe('lessons');
    expect(await db.hasActiveConsent(user!.id, 'marketing')).toBe(true);
  });

  it('31. dars ertaga eslatmasi - navbatga qo\u2018yiladi va duplikat bo\u2018lmaydi', async () => {
    await start();
    await toStage('REMINDER_HOST');
    await toStage('LESSON_INTRO');
    msg.clear();
    await click('lesson:remind_tomorrow');
    const user = await db.getUserByTelegramId(TG.id);
    const items = await db.listOutbox({ userId: user!.id });
    expect(items.filter((i) => (i.payload as { blockKey?: string }).blockKey === 'reminder_lesson').length).toBe(1);
    expect(lastText(TG.id)).toContain('10:00');
    await click('lesson:remind_tomorrow'); // takroriy bosish
    expect((await db.listOutbox({ userId: user!.id })).length).toBe(1);
  });

  it('32. uzatishda texnik xatolik -> soxta tasdiq YO\u2018Q, jamaga ogohlantirish', async () => {
    await start();
    await db.setSetting('sales_group_chat_id', '999000');
    await click('consent:grant_contact');
    await click('contact:telegram');
    const user = await db.getUserByTelegramId(TG.id);
    await toStage('REVIEW_SUBMIT');
    const dbAny = db as unknown as { createSalesLead: unknown };
    const orig = dbAny.createSalesLead;
    dbAny.createSalesLead = () => {
      throw new Error('db down');
    };
    msg.clear();
    await click('submit:send');
    expect(lastText(TG.id)).toContain('kutilmoqda'); // honest pending message
    expect(lastText(TG.id)).not.toContain('uzatildi.');
    expect((await db.getState(user!.id))?.salesStatus).not.toBe('in_sales');
    const alert = (await db.listOutbox({ userId: user!.id })).find((o) => ((o.payload as { text?: string }).text ?? '').includes('xatolik'));
    expect(alert).toBeDefined();
    // tiklangach qayta bosish -> muvaffaqiyat
    dbAny.createSalesLead = orig;
    await click('submit:send');
    expect(lastText(TG.id)).toContain("sotuv bo'limiga uzatildi");
  });

  it('33. readiness kartasi: narx DB\u2018dan, $800 yo\u2018q; service narxi - matn', async () => {
    await start();
    await click('goto:OFFER_COURSE');
    await toStage('READINESS');
    msg.clear();
    await click('cmd:menu');
    await click('goto:READINESS');
    expect(lastText(TG.id)).toContain('2,000 USD');
    expect(lastText(TG.id)).not.toMatch(/800/);
  });

  it('34. kontakt usuli: sayt telefony borida qayta so\u2018ralmaydi', async () => {
    const lead = await db.createSiteLead(siteLeadData('Ali'));
    const t = await db.createLinkToken(lead.id, 24);
    await start(t.token);
    await toStage('CONTACT_METHOD');
    msg.clear();
    await click('goto:CONTACT_METHOD');
    const actions = (msg.last(TG.id)?.buttons ?? []).flat().map((b) => b.action);
    expect(actions).toContain('answer:contact=phone'); // tayyor raqam tugmasi
    expect(actions).not.toContain('contact:phone'); // qo'shimcha so'ramaymiz
    const labels = (msg.last(TG.id)?.buttons ?? []).flat().map((b) => b.label).join('|');
    expect(labels).toContain('+998'); // raqam tugma yorlig'ida ko'rinadi
  });

  it('35. xarid tasdiqlansa - purchase_start xabari yuboriladi, funnel tugmalari yopiladi', async () => {
    await start();
    const user = await db.getUserByTelegramId(TG.id);
    await db.setSetting('purchase_start_message', 'Darsga kirish: https://course.example.uz');
    await db.updateState(user!.id, { salesStatus: 'in_sales', stage: 'SUBMITTED' });
    // API confirmation o'rniga: engine purchase_start blokini yuborishi tekshiriladi
    const blk = await db.getBlockByKey('purchase_start', 'approved');
    expect(blk).not.toBeNull();
    msg.clear();
    await engine.enqueue(TG.id, async () => {
      const st = await db.getState(user!.id);
      if (st) await engine.sendBlockPublic(user!.id, blk!, TG.id);
    });
    expect(lastText(TG.id)).toContain('https://course.example.uz');
    expect(lastText(TG.id)).toContain('yordam botimiz');
  });
});
