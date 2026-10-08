import type { ContentBlock } from '@app/shared';

// ============================================================================
// Seed content - "Endi tayyor" versiyasi (fungal 1-51 raqamli xabarlar).
// Barcha matn admin panelida tahrirlanadi: draft -> preview -> approve.
// Media bloklari mediaId=null bilan seed qilinadi - material panel'dan
// bog'languncha tegishli bo'lim ishga tushmaydi yoki o'tkazib yuboriladi.
// [Kvadrat qavsdagi] havolalar sozlamalardan o'qiladi: {{settings:kalit}}.
// Uzbek matni pure ASCII (O' / G').
// ============================================================================

type BlockSeed = Omit<ContentBlock, 'id' | 'version' | 'createdAt' | 'updatedAt'>;

function B(b: Pick<BlockSeed, 'key' | 'stage' | 'body'> & Partial<BlockSeed>): BlockSeed {
  return {
    title: b.key,
    mediaType: null,
    mediaId: null,
    mediaSourceUrl: null,
    buttons: [],
    showCondition: null,
    status: 'approved',
    textFallbackAllowed: true,
    requiresMedia: false,
    ...b,
  };
}

export const CONTENT_BLOCKS: BlockSeed[] = [
  // --- 01. Kirish (1-video shu xabardan oldin yuboriladi) ---
  B({
    key: 'welcome', stage: 'START', title: 'Xush kelibsiz',
    mediaType: 'video_note',
    videoScript: "Biznesingizda tovar qoldig'ini bilish uchun bir odamga, mijoz qarzinig bilish uchun boshqa odamga qo'ng'iroq qilasizmi? Oxirida ikkita har xil raqam eshitishingiz ham mumkin. Assalomu alaykum, men Jamshidman. Moy Skladni bizneslarga joriy qilish va undan foydalanishni o'rgatish bilan shug'ullanaman. Ellikdan ortiq loyiha tajribamiz bor. Biz savdo, ombor va ishlab chiqarish hisobidagi vazifalar bilan ishlaymiz. Qaysi tovar bor, kim qancha qariz, mahsulot qayerga ketdi - shu ma'lumotlarni tartibga solishga yordam beramiz. Bu botda avval qanday ishlashimizni ko'rasiz. Keyin bitta vazifani amalda bajaradigan sinov darsini olasiz. Pastdagi \"Davom etish\" tugmasini bosing. Mijozlar bilan qanday vazifalar ustida ishlaganimizni aytib beraman.",
    body: "Xush kelibsiz! Bu yerda Jamshidning tajribasi bilan tanishasiz, Moy Sklad bo'yicha sinov darsini ko'rasiz va sizga mos yo'lni tanlaysiz.\n\nQayerdan boshlaymiz?",
    buttons: [
      { label: 'Davom etish', action: 'goto:EXPERIENCE_VIDEO' },
      { label: 'Sinov darsi', action: 'goto:LESSON_INTRO' },
      { label: "Takliflarni ko'rish", action: 'goto:OFFERS' },
    ],
  }),
  // --- 02. Ekspert tajribasi (2-video) ---
  B({
    key: 'experience_video', stage: 'EXPERIENCE_VIDEO', title: 'Tajriba',
    mediaType: 'video_note',
    videoScript: "Mijoz bizga \"Moy Sklad kerak\" deb yozadi. Lekin gaplashganimizda unga aynan nima kerakligini aniqlashimiz kerak bo'ladi: qoldiqni ko'rishmi, qarzni tekshirishmi yoki xodimlarning ishini tartibga solishmi? Masalan, Nefrit korxonasiga konsultatsiyaga borganmiz. Ularning ombor nazorati Moy Sklad orqali yuritiladi. Mijozimiz suhbatda kerakli savollar bo'yicha bizga murojaat qilishini aytgan. Men uchun tajriba degani faqat loyihalar soni emas. Tadbirkorning savolini tushunish va uning jarayonida qaysi ishni o'zgartirish kerakligini aniqlash ham muhim. Shuning uchun biz hammaga bir xil yechimni tavsiya qilmaymiz. Keyingi videoda mijozimizning o'z fikrini ko'rasiz. Men aytgan gap bilan cheklanmay, u nimaga e'tibor berganini ham eshitingiz.",
    body: "Endi mijozimizning fikrini ko'ring. Unga biz bilan ishlashda nima muhim bo'lgan?",
    buttons: [
      { label: "Mijoz videosini ko'rish", action: 'goto:CLIENT_REVIEW' },
      { label: 'Keyingi bosqich', action: 'goto:METHOD_VIDEO' },
    ],
  }),
  // --- 03. Mijozning haqiqiy fikri (ruxsat etilgan video; bo'lmasa bosqich o'tkaziladi) ---
  B({
    key: 'client_review', stage: 'CLIENT_REVIEW', title: 'Mijoz fikri',
    mediaType: 'video_note',
    videoScript: "[Ruxsat olingan Nefrit mijoz videosi yoki boshqa tasdiqlangan mijoz fikri - jamoa to'ldiradi. Mijoz nomidan fikr yozilmaydi.]",
    body: "Mijozning tajribasini ko'rdingiz. Keyingi videoda hisobni tartibga solishda nimadan boshlashimizni tushuntiramiz.",
    requiresMedia: true, textFallbackAllowed: false,
    buttons: [
      { label: "Qanday ishlaysiz?", action: 'goto:METHOD_VIDEO' },
      { label: "Takliflarni ko'rish", action: 'goto:OFFERS' },
    ],
  }),
  // --- 04. Ish usuli va kurs sababi (3-video) ---
  B({
    key: 'method_video', stage: 'METHOD_VIDEO', title: 'Ish usulimiz',
    mediaType: 'video_note',
    videoScript: "Dastur o'rnatildi, lekin xodim kirimni kiritmadi. Sotuv boshqa joyda yozildi. Keyin rahbar hisobotni ochib, \"Nega raqamlar noto'g'ri?\" deb so'raydi. Shuning uchun biz ishni vazifadan boshlaymiz. Nima nazorat qilinishi kerak? Ma'lumotni kim kiritadi? Kim tekshiradi? Boshlang'ich ma'lumotlar to'g'rimi? Shular aniqlangandan keyin tizimdagi ishni yo'lga qo'yish mumkin. Loyihalarda yana bitta muammoni ko'rganmiz: tizim bilan ishlaydigan odam yetishmaydi. Kurs ochishimizning sabablaridan biri ham shu. Kimdir o'zi o'rganmoqchi, kimdir xodimini o'rgatadi, kimdir ishni bizga topshiradi. Hozir uchta qisqa savolga javob bering. Sizga qaysi yo'lni ko'rsatishimiz kerakligini aniqlab olamiz.",
    body: "Sizdagi vazifani aniqlab olaylik. Uchta qisqa savolga javob bering, keyingi ma'lumotlarni shunga mos ko'rsatamiz.",
    buttons: [
      { label: 'Boshlaymiz', action: 'goto:SURVEY_ROLE' },
      { label: 'Avval sinov darsi', action: 'goto:LESSON_INTRO' },
    ],
  }),
  // --- 05. Birinchi savol: kim bajaradi ---
  B({
    key: 'survey_role', stage: 'SURVEY_ROLE', title: 'Savol 1 - rol',
    body: "Bu ishni sizning biznesingizda kim bajaradi?",
    buttons: [
      { label: "O'zim boshqaraman", action: 'answer:role=self' },
      { label: 'Xodimlar kiritadi', action: 'answer:role=staff' },
      { label: 'Ikkalasi ham', action: 'answer:role=both' },
      { label: 'Boshqa', action: 'goto:SURVEY_ROLE_TEXT' },
    ],
  }),
  B({
    key: 'survey_role_text', stage: 'SURVEY_ROLE_TEXT', title: 'Rol - erkin javob',
    body: "Qisqacha yozing - bu ishni kim bajaradi?",
    buttons: [{ label: 'Orqaga', action: 'goto:SURVEY_ROLE' }],
  }),
  // --- 06. Ikkinchi savol: eng og'riqli vazifa ---
  B({
    key: 'survey_problem', stage: 'SURVEY_PROBLEM', title: 'Savol 2 - muammo',
    body: "Hozir eng ko'p chalkashlik qaysi ishda bo'ladi?",
    buttons: [
      { label: "Tovar qoldig'ini bilish", action: 'answer:problem=stock' },
      { label: 'Mijoz qarzi va tolovi', action: 'answer:problem=payments' },
      { label: "Xodimlarning ishini tekshirish", action: 'answer:problem=staff' },
      { label: 'Kirim va chiqim hujatlari', action: 'answer:problem=docs' },
      { label: 'Ishlab chiqarish xarajatlari', action: 'answer:problem=production' },
      { label: 'Boshqa', action: 'goto:SURVEY_PROBLEM_TEXT' },
    ],
  }),
  B({
    key: 'survey_problem_text', stage: 'SURVEY_PROBLEM_TEXT', title: 'Muammo - erkin javob',
    body: "O'zingizning eng noqulay vazifangizni qisqa yozib qoldiring.",
    buttons: [{ label: 'Orqaga', action: 'goto:SURVEY_PROBLEM' }],
  }),
  // --- 07. Uchinchi savol: qaysi yo'l ---
  B({
    key: 'survey_path', stage: 'SURVEY_PATH', title: 'Savol 3 - yo\'l',
    body: "Sizga hozir qaysi biri kerakroq?",
    buttons: [
      { label: "O'zim o'rganaman", action: 'goto:PATH_SELF' },
      { label: 'Xodimim o\'rgansin', action: 'goto:PATH_EMPLOYEE' },
      { label: 'Ishni biz bajarib beraylik', action: 'goto:OFFER_SERVICE' },
      { label: 'Bilmayman - siz ayting', action: 'goto:PATH_UNSURE' },
    ],
  }),
  // --- 08. Savol: biznes turi (bir marta so'raladi, takrorlanmaydi) ---
  B({
    key: 'business_type', stage: 'BUSINESS_TYPE', title: 'Biznes turi',
    body: "Qaysi biznesni boshqarasiz?\n\nMasalan: nonushta do\'koni, qurilish materiallari yoki don muddatli to\'lovi.",
    buttons: [{ label: 'Keyingi bosqich', action: 'goto:PATH_SELF' }],
  }),
  // --- 09-11. Yo'l sahifalari ---
  B({
    key: 'path_self', stage: 'PATH_SELF', title: 'O\'zingiz o\'rganasiz',
    body: "Siz o'rganib, o'zingiz ishlatmoqchisiz.\n\nSiz bilan dasturning biznis jarayoningizga mos ishlashini sozlaymiz va uni qanday boshqarishni ko'rsatamiz. Avval bitta amaliy ishni ko'rib chiqamiz.\n\nKeyingi qadam - Moy Sklad darsini ko'rish.",
    buttons: [
      { label: 'Sinov darsini ko\'rish', action: 'goto:LESSON_INTRO' },
      { label: "Takliflarni ko'rish", action: 'goto:OFFERS' },
    ],
  }),
  B({
    key: 'path_employee', stage: 'PATH_EMPLOYEE', title: 'Xodim o\'rganadi',
    body: "Siz hisobotlarni tekshirasiz, ma'lumotni esa xodimingiz kiritadi.\n\nAvval xodimingiz bilan darsni ko'ring. Keyin o'zingiz qanday tekshirishni bilish uchun darsni qayta ko'rasiz. Shundan so'ng xodimingizning bir necha kunlik ishini ko'rib chiqamiz.\n\nXohlasangiz, xodimingiz uchun ham darsni va tekshirish tartibini ko'rsatamiz.",
    buttons: [
      { label: "Xodim uchun darsni ko'rish", action: 'goto:LESSON_INTRO' },
      { label: 'Ishni bizga topshirish', action: 'goto:OFFER_SERVICE' },
      { label: "Takliflarni ko'rish", action: 'goto:OFFERS' },
    ],
  }),
  B({
    key: 'path_unsure', stage: 'PATH_UNSURE', title: 'Aniql emas',
    body: "Avval bitta amaliy ishni ko'rib chiqamiz. Buni ko'rganingizdan keyin qaysi yo'l sizga mos kelishini birga aniqlaymiz.",
    buttons: [{ label: 'Sinov darsini ko\'rish', action: 'goto:LESSON_INTRO' }],
  }),
  // --- 12. Sinov darsi (dars havolasi sozlamalarda to'ldirilmasa bo'lim ishga tushmaydi) ---
  B({
    key: 'lesson_intro', stage: 'LESSON_INTRO', title: 'Sinov darsi',
    mediaType: 'video',
    videoScript: "[Bitta amaliy misol bo'yicha sinov darsi videosi - jamoa to'ldiradi.]",
    body: "Bu darsda bitta amaliy ishni ko'rsatamiz.\n\nDarsni bu yerdan ko'ring: {{settings:lesson_link}}\n\nTayyor bo'lgach pastdagi tugmani bosing.",
    showCondition: { requiredSettings: ['lesson_link'] },
    buttons: [
      { label: "Darsni ochish", action: 'lesson:open' },
      { label: 'Ko\'rdim', action: 'lesson:watched' },
      { label: 'Savolim bor', action: 'cmd:ask' },
    ],
  }),
  // --- 13. Task ---
  B({
    key: 'task', stage: 'TASK', title: 'Topshiriq',
    body: "Amaliy misol bo'yicha kichik savol: darsda ko'rsatilgan hujatda nechta mahsulot qatori bo'lgan?\n\nBu savol sizning diqqatingizni tekshirish uchun. Javob noto'g'ri bo'lsa ham darsdan chetlashtirilmaysiz.",
    buttons: [
      { label: '11 dona', action: 'task:right' },
      { label: '15 dona', action: 'task:wrong' },
      { label: '9 dona', action: 'task:wrong' },
      { label: "Tushuntirish kerak", action: 'task:help' },
    ],
  }),
  // --- 14. Task to'g'ri ---
  B({
    key: 'task_correct', stage: 'TASK_CORRECT', title: 'Task - to\'g\'ri',
    body: "To'g'ri topdingiz.\n\nAgar Moy Sklad'da avtomatik hisoblagich bo'lmasa, bundagi xatolik qanchalik qimmatga tushishi mumkinligini bir tasavvur qiling.",
    buttons: [
      { label: 'Davom etish', action: 'goto:AFTER_LESSON_VIDEO' },
      { label: "Takliflarni ko'rish", action: 'goto:OFFERS' },
    ],
  }),
  // --- 15. Task noto'g'ri - tushuntirish va davom ettirish (hech kim chetlashtirilmaydi) ---
  B({
    key: 'task_wrong', stage: 'TASK_WRONG', title: 'Task - izoh',
    body: "Muhim emas. Bu yerda asosiysi javob topish emas - shunga o'xshagan xatolik ishda qayerda paydo bo'lishini sezib ko'rish.\n\nBitta qator ko'pincha alohida bir xarajat, qarz yoki kirim hujatiga tegishli bo'ladi.\n\nYana bitta amaliy misolni ko'ramizmi yoki davom etamizmi?",
    buttons: [
      { label: 'Darsni qayta ko\'rish', action: 'goto:LESSON_INTRO' },
      { label: 'Davom etish', action: 'goto:AFTER_LESSON_VIDEO' },
      { label: "Takliflarni ko'rish", action: 'goto:OFFERS' },
    ],
  }),
  // --- 16. Darsdan keyin ---
  B({
    key: 'after_lesson_video', stage: 'AFTER_LESSON_VIDEO', title: 'Darsdan keyin',
    mediaType: 'video_note',
    videoScript: "Bugun faqat bitta vazifani ko'rdik. Lekin Moy Sklad'da savdo, ombor va ishlab chiqarish bo'yicha boshqa ishlar ham bor. Tizim to'liq yo'lga qo'yilganda kerakli ma'lumotni topish ancha oson bo'ladi. Buni bir necha yo'l bilan qilishimiz mumkin. Kurs orqali o'zingiz o'rganib, keyin Moy Sklad bilan ishlashingiz mumkin. Biz bilan birga o'rnatib va ishni birga yo'lga qo'yishimiz mumkin. Shuningdek, Moy Sklad bo'yicha mas'ul xodimni biz o'rgatishimiz mumkin. Qaysi biri sizga mos keladi?",
    body: "Sizga mos takliflarni ko'rsatamiz.",
    buttons: [
      { label: "Takliflarni ko'rish", action: 'goto:OFFERS' },
      { label: 'Savol beraman', action: 'cmd:ask' },
    ],
  }),
  // --- 17. O'quvchi natijasi (faqat ruxsat etilgan video; bo'lmasa bosqich ochilmaydi) ---
  B({
    key: 'student_review', stage: 'STUDENT_REVIEW', title: "O'quvchi natijasi",
    mediaType: 'video_note',
    videoScript: "[Fikr va ruxsatni olgandan keyingina foydalanish mumkin bo'lgan o'quvchi videosi - jamoa to'ldiradi.]",
    body: "Kurs bitiruvchisining amaliy natijasini tinglang.",
    requiresMedia: true, textFallbackAllowed: false,
    buttons: [
      { label: "Takliflarni ko'rish", action: 'goto:OFFERS' },
      { label: 'Savol beraman', action: 'cmd:ask' },
    ],
  }),
  // --- 18. Eslatmalar roziligi - sessiya oxirida so'raladi ---
  B({
    key: 'consent_reminders', stage: 'CONSENT_REMINDERS', title: 'Eslatmalar',
    body: "Sizni shu yerda qoldiraylikmi?\n\nAgar xohlasangiz, amaliy maslahatlar va takliflar bo'yicha eslatib turaman. Kerak bo'lmasa, o'zingiz qachonkir dir kelishingiz mumkin.",
    showCondition: { skipIfMarketingConsent: true },
    buttons: [
      { label: 'Ha, yuboring', action: 'consent:grant_marketing' },
      { label: "O'zim qaytaman", action: 'consent:no_reminders' },
    ],
  }),
  // --- 19. Takliflar menyusi ---
  B({
    key: 'offers', stage: 'OFFERS', title: 'Takliflar',
    body: "Sinov darsini ko'rdingiz. Endi qaysi yo'l sizga mos kelishini tanlang.",
    buttons: [
      { label: "Kurs - o'zim o'rganaman", action: 'goto:OFFER_COURSE' },
      { label: "Videodarslar - xodimim o'rganadi", action: 'goto:OFFER_VIDEOS' },
      { label: "Xizmat - ishni bizga topshiraman", action: 'goto:OFFER_SERVICE' },
      { label: 'Farqi va shartlarni ko\'rish', action: 'goto:COMPARE' },
    ],
  }),
  // --- 20. Kurs ---
  B({
    key: 'offer_course', stage: 'OFFER_COURSE', title: 'Kurs - $2.000',
    mediaType: 'video_note',
    videoScript: "[Kurs haqidagi video - jamoa to'ldiradi.]",
    body: "Kurs - Moy Skladni o'zingiz mustaqil boshqarish uchun.\n\nSiz bilan birga: Moy Sklad'da asosiy sozlamalarni ko'rib chiqamiz; kirim va chiqim hujjatlarini to'g'ri rasmiylashtirishni ko'rsatamiz; ombor qoldiqlari, savdo va to'lovlar bo'yicha amaliy misollar bajaramiz; hisobotlarni qanday tekshirishni ko'rsatamiz; xodimlarga topshiriq berish va ulardan hisob olish tartibini o'rganamiz. Bular orqali Moy Skladni tanib, o'zingiz ishlashingizni boshlaysiz.\n\nAgar savol bo'lsa, yozing. Shundan keyin qo'ng'iroq vaqtini kelishamiz.\n\nKurs shartlari: {{settings:terms_course_url}}",
    showCondition: { requiredSettings: ['terms_course_url'] },
    buttons: [
      { label: 'Men uchun', action: 'goto:READINESS' },
      { label: 'Savol bor', action: 'cmd:ask' },
    ],
  }),
  // --- 21. Videodarslar ---
  B({
    key: 'offer_videos', stage: 'OFFER_VIDEOS', title: 'Videodarslar - $500',
    mediaType: 'video_note',
    videoScript: "[Videodarslar haqidagi video - jamoa to'ldiradi.]",
    body: "Videodarslar - Moy Skladni xodimingiz o'rganadi.\n\nXodimingiz Moy Sklad bo'yicha tayyor videodarslarni ko'radi va amaliy topshiriqlarni bajaradi. Kursda biz bilan bajariladigan ishlar bu yerda tayyor video va materiallar orqali o'rganiladi.\n\nSiz xodimning bajarilgan vazifalarini biz bilan birga tekshirasiz. Shu tarzda xodim darsni ko'rganmi, amaliy topshiriqni bajarganmi va ishni to'g'ri tushunganmi - buni birga aniqlaymiz.\n\nAgar xodimingiz darsni ko'rib, vazifani bajarsa - Moy Skladni mustaqil ishlatishi mumkin bo'ladi. Bundan keyin o'zingiz hisobotni tekshirib borasiz.\n\nVideodarslar shartlari: {{settings:terms_videos_url}}",
    showCondition: { requiredSettings: ['terms_videos_url'] },
    buttons: [
      { label: 'Men uchun', action: 'goto:READINESS' },
      { label: 'Savol bor', action: 'cmd:ask' },
    ],
  }),
  // --- 22. Xizmat - narx so'raladi (darhol taklif qilinmaydi) ---
  B({
    key: 'offer_service', stage: 'OFFER_SERVICE', title: 'Xizmat - kelishilgan narx',
    mediaType: 'video_note',
    videoScript: "[Xizmat haqidagi video - jamoa to'ldiradi.]",
    body: "Xizmat - Moy Sklad bilan ishlashni o'rganish, amaliy sozlash va o'z ishingizga moslash.\n\nBizning maqsadimiz - tizim orqali siz kerakli ma'lumotni tez topadigan, xatolarni o'z vaqtida ko'radigan va xodimlarning bajarilgan ishini tekshiradigan bo'lishingiz.\n\nSizga shunchaki bir nechta dars yuborib qo'ymaymiz. Avval biznes jarayoningizni birga ko'rib chiqamiz.\n\nSo'ngra Moy Sklad orqali birga amaliy ish bajarib ko'ramiz: tovar qoldig'i, mijoz qarzi, xodimning kiritgan ma'lumoti va hisobotni tekshirish.\n\nShu ishlar orqali Moy Sklad bilan qanday ishlashni va o'zingizning biznesingizda uni qanday to'g'ri yo'lga qo'yishni o'rganib olasiz.\n\nSizning holatingizga qancha vaqtimiz ketishi va narxni shundan keyin aytishimiz mumkin.\n\nXohlasangiz, shu yo'nalish bo'yicha suhbatlashamiz.",
    buttons: [
      { label: "Holatimni yozaman", action: 'goto:ASK_QUESTION' },
      { label: "Sotuv bilan gaplashaman", action: 'goto:READINESS' },
    ],
  }),
  // --- 23. Taqqoslash ---
  B({
    key: 'compare', stage: 'COMPARE', title: 'Farqi va shartlar',
    body: "Uch xil yo'l bor - barchasida Moy Sklad orqali ishni yo'lga qo'yish, lekin kim bajaradi - shunda farq bor.\n\nKurs - o'zingiz o'rganasiz va o'zingiz boshqarasiz. Moy Skladni tanib, kerakli amaliy ishlarni bajara boshlaysiz. Biz bilan asosiy sozlamalar, kirim-chiqim hujjatlari, qoldiq, to'lov va hisobot ishlari bo'yicha ishlaymiz.\n\nVideodarslar - o'rganishni xodimingiz bajaradi. Xodimingiz Moy Sklad bo'yicha ko'rsatmalarni oladi va vazifa bajaradi. Siz natijani ko'rasiz va kerak bo'lsa, biz orqali tekshirtirasiz.\n\nXizmat - Moy Sklad bilan ishlashni o'rganish va o'z ishingizga moslash. Siz bilan biznes jarayoningizni ko'rib chiqamiz va Moy Sklad orqali kerakli ishlarni birga bajarib ko'ramiz.\n\nUchta variantni ko'rdingiz. Endi o'zingizga mosini tanlang. Har bir variantni bosib ko'ring. Hech biri mos kelmasa - o'zingizning holatingizni yozib qoldiring.",
    buttons: [
      { label: 'Kurs', action: 'goto:OFFER_COURSE' },
      { label: 'Videodarslar', action: 'goto:OFFER_VIDEOS' },
      { label: 'Xizmat', action: 'goto:OFFER_SERVICE' },
      { label: "Holatimni yozaman", action: 'goto:ASK_QUESTION' },
    ],
  }),
  // --- 24-27. E'tiroz videolari ---
  B({
    key: 'objection_time', stage: 'OBJECTION_TIME', title: "Vaqt yo'q",
    mediaType: 'video_note',
    videoScript: "Ko'pincha \"keyinroq qilaman\" deb qoldiriladigan ishlar oxirida bir kunni, ba'zan bir haftani yeydi. Bitta hujatni qidirish, telefon orqali bilish va xatoni tekshirish - bularning barchasi kundalik ishdagi vaqtingizni oladi. Moy Sklad'da kerakli ma'lumot bir joyda bo'ladi va uni tekshirish ancha tez bo'ladi. Kursni o'rganib bo'lgach, uni ishlatish sizning ish vaqtingizni tejaydi. Videodarslar variantida esa xodimingiz o'rganadi va sizning vaqtinchalik ishni bajaradi.",
    body: "Bu videoni ko'ring va shundan keyin ham \"vaqtim yo'q\" deb o'ylasangiz, bizga yozing.",
    buttons: [
      { label: 'Xa, tushunarli', action: 'goto:OFFERS' },
      { label: "Baribir vaqt topolmayman", action: 'cmd:ask' },
      { label: "Taklifni ko'rib chiqaman", action: 'goto:READINESS' },
    ],
  }),
  B({
    key: 'objection_employee', stage: 'OBJECTION_EMPLOYEE', title: "Xodimning vaqti yo'q",
    mediaType: 'video_note',
    videoScript: "Ba'zida \"xodimga dars ko'rsangiz bo'ladi\" deyiladi, lekin uning ham kundalik ishi bor. Masalan, ombor ishlayapti - sotuvchi yugurapti - hisobchi qarz bilan band. Shu sababli biz xodimga ham bir zumda hamma narsani yuklamaslikni tavsiya qilamiz. Avval bitta vazifani ko'ring. Keyin uni hayotiy holatda bajaring. Birinchi kunda hammasi bir zumda o'rganilishi shart emas. Bitta amaliy ishni to'g'ri bajarish - bir haftaga yetadi.",
    body: "Xodimingiz uchun qulay tartibni birga tanlaymiz - quyidagilardan birini tanlang.",
    buttons: [
      { label: 'Videodarslar', action: 'goto:OFFER_VIDEOS' },
      { label: 'Kurs', action: 'goto:OFFER_COURSE' },
      { label: 'Xizmat', action: 'goto:OFFER_SERVICE' },
    ],
  }),
  B({
    key: 'objection_price', stage: 'OBJECTION_PRICE', title: 'Qimmat',
    mediaType: 'video_note',
    videoScript: "Narxni solishtirayotgan bo'lsangiz, o'zingizga savol bering: biz nima uchun to'layapmiz? Biz nafaqat darslarga, balki Moy Sklad bilan qanday ishlashni o'rganishga ham to'laymiz. Xodimni qanday o'rgatish, tekshirish va topshirilayotgan ishni boshqarishni ham ko'rsatamiz. Endi ikkinchi savol - Moy Sklad'siz ish qancha turadi? Kerakli tovarni topa olmay boshqa do'kondan sotib olish, mijozga qancha to'latishni aniqlay olmaslik, xodimning noto'g'ri kiritgan hujatini tekshirish yoki yo'qotilgan buyurtmani qidirish. Shu narsalarning har biri ish vaqti va pul. Kurs narxi ham, nima uchun shu narx ekanini ham bilishingiz kerak.",
    body: "Narx bo'yicha savolingiz bo'lsa - yozing.",
    buttons: [
      { label: 'Savolim bor', action: 'cmd:ask' },
      { label: "Taklifni ko'rish", action: 'goto:READINESS' },
      { label: 'Vaqtinchalik to\'xtatib turaman', action: 'goto:NOT_READY' },
    ],
  }),
  B({
    key: 'objection_start', stage: 'OBJECTION_START', title: 'Hozir boshlamayman',
    mediaType: 'video_note',
    videoScript: "Hozir bo'sh emasligingizni tushunamiz. Lekin Moy Sklad'ga o'tishni keyinga qoldirish bilan bugungi chalkashlik ham o'rnida qoladi. Tovar qoldig'i va mijoz qarzini yana bir necha oy eski usulda bilishga harakat qilasiz. Shuning uchun biz hozir ishni boshlashga majburlamaymiz. Sizga bir amaliy dars va keyinchalik ishlatishingiz mumkin bo'lgan bir nechta maslahat qoldiramiz. O'zingiz tayyor bo'lgan vaqtda bizni xabardor qilasiz.",
    body: "To'g'ri qaror qabul qiling va quyidagilardan birini tanlang.",
    buttons: [
      { label: 'Amaliy maslahatlar qoldiring', action: 'consent:grant_marketing' },
      { label: "O'zim qaytaman", action: 'goto:NOT_READY' },
      { label: 'Savolim bor', action: 'cmd:ask' },
    ],
  }),
  // --- 28. Savol qabul qilish ---
  B({
    key: 'ask_question', stage: 'ASK_QUESTION', title: 'Savol',
    body: "Savolingizni shu yerga yozib qoldiring. Uni saqlab olamiz.\n\nAgar javob berish uchun qo'shimcha ma'lumot kerak bo'lsa, keyinroq yozamiz. Shu orada tanishuvni davom ettirishingiz mumkin.",
    buttons: [
      { label: 'Menyu', action: 'cmd:menu' },
      { label: "Takliflarni ko'rish", action: 'goto:OFFERS' },
    ],
  }),
  B({
    key: 'answer_followup', stage: 'ANSWER_FOLLOWUP', title: 'Javob kutilmoqda',
    body: "Savolingizni qabul qildik.\n\nSotuv bo'limi javob berishi uchun savolingizni ishga ulaymiz.",
    buttons: [
      { label: 'Menyu', action: 'cmd:menu' },
      { label: "Takliflarni ko'rish", action: 'goto:OFFERS' },
    ],
  }),
  // --- 29. Narx va tayyorgarlik ---
  B({
    key: 'readiness', stage: 'READINESS', title: 'Tayyorgarlik',
    body: "Tanlangan taklif bo'yicha narx va shartlar:\n\n{{products:chosen}}\n\nSiz hozir qanday bosqichdasiz?",
    buttons: [
      { label: "Hozir boshlashga tayyorman", action: 'goto:TIMELINE' },
      { label: "Avval sotuv bilan gaplashaman", action: 'goto:TIMELINE' },
      { label: 'Hali o\'ylab ko\'raman', action: 'goto:NOT_READY' },
    ],
  }),
  // --- 30. Ishni qachon boshlash ---
  B({
    key: 'timeline', stage: 'TIMELINE', title: 'Muddat',
    body: "Ishni qachon boshlamoqchisiz?",
    buttons: [
      { label: 'Bir-ikki hafta ichida', action: 'answer:timeline=2weeks' },
      { label: 'Oyiga', action: 'answer:timeline=month' },
      { label: 'Aniql emas', action: 'answer:timeline=unsure' },
      { label: 'Keyinroq', action: 'answer:timeline=later' },
    ],
  }),
  // --- 31. Qaror qabul qiluvchi ---
  B({
    key: 'decision_maker', stage: 'DECISION_MAKER', title: 'Qaror egasi',
    body: "Bu ish bo'yicha qarorni siz qabul qilasizmi yoki sizga yana kimadir kerakmi?",
    buttons: [
      { label: "O'zim qabul qilaman", action: 'goto:PREFLIGHT_VIDEO' },
      { label: "Rahbar / sherik bilan ko'rishim kerak", action: 'goto:DECISION_LEADER' },
      { label: 'Birga ko\'ramiz', action: 'goto:DECISION_LEADER' },
    ],
  }),
  B({
    key: 'decision_leader', stage: 'DECISION_LEADER', title: 'Rahbarga uzatish',
    body: "Tushunarli. Rahbaringizning aloqa raqamini so'ramaymiz.\n\nXohlasangiz, barcha ma'lumotni siz orqangiz yuboramiz - xohlasangiz biz yuboramiz. Quyidagilardan birini tanlang.",
    buttons: [
      { label: "Men orqam yuboring", action: 'goto:PREFLIGHT_VIDEO' },
      { label: "Ma'lumotni rahbarimga yuboraman", action: 'goto:PREFLIGHT_VIDEO' },
    ],
  }),
  // --- 32. Suhbat oldidan + aloqa roziligi ---
  B({
    key: 'preflight_video', stage: 'PREFLIGHT_VIDEO', title: 'Suhbat oldidan',
    mediaType: 'video_note',
    videoScript: "Siz bilan qisqa suhbat orqali biznesingizni birinchi bosqichda taniymiz. Suhbatda odatda shu narsalarni so'raymiz: biznes turi va necha xodim ishlashi; ombor va savdo qancha; qaysi ma'lumotni hozir qiyin bilasiz - tovar qoldig'i, qarzdorlik yoki xarajatlar; Moy Sklad'da nimani ko'rish va tekshirishni istashingiz; ishni qachon boshlamoqchisiz. Suhbatning maqsadi - sizga mos yo'nalish va qanday ish bajarishimizni aniqlash. Endi aloqa usulini tanlaymiz.",
    body: "Qo'ng'iroqdan avval quyidagi videoni ko'ring. Shunda nima so'ralishini bilasiz va o'zingizni shay his qilasiz.\n\nRozilik: qo'ng'iroq vaqtini kelishish uchun raqamingiz yoki Telegram profilingiz faqat bizning sotuv bo'limimiz uchun ishlatiladi.",
    buttons: [
      { label: "Ha, aloqa qilishingiz mumkin", action: 'consent:grant_contact' },
      { label: "Faqat shu chatda qoling", action: 'goto:ASK_QUESTION' },
      { label: "Ma'lumot yuborilmasin", action: 'consent:decline' },
    ],
  }),
  // --- 33. Aloqa usuli (saytdan telefon bo'lsa qayta so'ralmaydi) ---
  B({
    key: 'contact_method', stage: 'CONTACT_METHOD', title: 'Aloqa usuli',
    body: "Siz bilan qanday bog'lansak qulay?",
    buttons: [
      { label: "Telefon orqali +{{user.phone}}", action: 'answer:contact=phone' },
      { label: "Telegram orqali (shu yerda)", action: 'answer:contact=telegram' },
      { label: "Telefon raqamimni ko'rsataman", action: 'contact:phone' },
    ],
  }),
  // --- 34. Qulay vaqt (so'raladi, va'da qilinmaydi) ---
  B({
    key: 'preferred_time', stage: 'PREFERRED_TIME', title: 'Qulay vaqt',
    body: "Siz bilan qachon bog'lanish qulay bo'ladi?\n\nIshonchli bo'lishi uchun kun va soatni yozing. Aniq vaqt haqida siz bilan bog'lanishdan oldin kelishib olamiz.",
    buttons: [{ label: 'Vaqt tanlashni keyinga qoldiraman', action: 'goto:REVIEW_SUBMIT' }],
  }),
  // --- 35. Ko'rib chiqish kartasi (ma'lumotlar engine tomonidan qo'shiladi) ---
  B({
    key: 'review_submit', stage: 'REVIEW_SUBMIT', title: 'Ma\'lumotni tekshirish',
    body: "Suhbat uchun quyidagi ma'lumotlaringiz saqlanadi. To'g'rimi?\n\n{{review:card}}\n\nMa'lumot sotuv bo'limiga sizning roziligiz bilan uzatiladi.",
    buttons: [
      { label: "Ha, sotuvga uzating", action: 'submit:send' },
      { label: "Xato - o'zgartiraman", action: 'cmd:edit' },
    ],
  }),
  // --- 36. Yuborish tasdiqlangan xabari (faqat uzatish bo'lsa) ---
  B({
    key: 'submitted', stage: 'SUBMITTED', title: 'Sotuvga uzatildi',
    body: "Ma'lumotlaringiz sotuv bo'limiga uzatildi. Tez orada siz bilan bog'lanish uchun bog'lanadigan bo'limdan tasdiqlab javob berishadi.\n\nXohlasangiz: qo'shimcha savol yuboring, tanishuvni davom ettiring yoki menyu orqali kerakli bo'limga kiring.",
    buttons: [
      { label: "Qo'shimcha savol yuborish", action: 'cmd:ask' },
      { label: 'Tanishuvni davom ettirish', action: 'cmd:menu' },
    ],
  }),
  B({
    key: 'submitted_pending', stage: null, title: 'Uzatish kutilmoqda',
    body: "Ma'lumotlaringiz qabul qilindi.\n\nSotuv bo'limiga uzatish hozircha kutilmoqda - jamaga tekshirish uchun xabar berildi. Uzatish tasdiqlangach, sizga alohida xabar yuboramiz.\n\nXohlasangiz: qo'shimcha savol yuboring yoki menyu orqali kerakli bo'limga kiring.",
    buttons: [
      { label: "Qo'shimcha savol yuborish", action: 'cmd:ask' },
      { label: 'Tanishuvni davom ettirish', action: 'cmd:menu' },
    ],
  }),
  // --- 37. Tayyor emasman ---
  B({
    key: 'not_ready', stage: 'NOT_READY', title: 'Tayyor emasman',
    body: "Mayli, shoshirmaymiz.\n\nHozir qulay bo'lmagani uchun ishni keyinga qoldirish - bu ham o'ylab qabul qilingan qaror.\n\nBizningcha, Moy Skladni tanlash uchun eng yaxshi yo'l - hozir bitta amaliy ishni ko'rish yoki maslahatlar bilan tanishish. Tayyor bo'lganingizda botni oching va suhbatni davom ettiring. Hech narsa yo'qolmaydi.",
    buttons: [
      { label: 'Keyinroq eslatib qo\'ying', action: 'consent:grant_marketing' },
      { label: "O'zim qaytaman", action: 'cmd:menu' },
    ],
  }),
  // --- 46. Menyu ---
  B({
    key: 'menu', stage: 'MENU', title: 'Menyu',
    body: "Qaysi bo'limga kirmoqchisiz?",
    buttons: [
      { label: 'Jamshid bilan tanishuv', action: 'goto:START' },
      { label: 'Sinov darsi', action: 'goto:LESSON_INTRO' },
      { label: "Takliflar", action: 'goto:OFFERS' },
      { label: 'Sotuv bilan suhbat', action: 'goto:READINESS' },
      { label: 'Savol yuborish', action: 'cmd:ask' },
      { label: 'Bildirishnoma sozlamalari', action: 'goto:NOTIF_SETTINGS' },
    ],
  }),
  // --- 47-48. Bildirishnoma sozlamalari ---
  B({
    key: 'notif_settings', stage: 'NOTIF_SETTINGS', title: 'Bildirishnomalar',
    body: "Qanday xabarlarni olmoqchisiz?",
    buttons: [
      { label: 'Maslahat va yangiliklar', action: 'notif:marketing' },
      { label: "Sinov darsi va eslatmalar", action: 'notif:lessons' },
      { label: 'Hech narsa kerak emas', action: 'notif:off' },
    ],
  }),
  B({
    key: 'reminders_off', stage: 'REMINDERS_OFF', title: 'Eslatmalar o\'chdi',
    body: "Tushunarli. Sizga hech qanday eslatma yuborilmaydi.\n\nBot kerak bo'lganda ochiladi va suhbat shu yerdan davom etadi.",
    buttons: [
      { label: "Qachonlardir eslatib qo'ying", action: 'notif:on' },
      { label: 'Menyu', action: 'cmd:menu' },
    ],
  }),
  // --- 49. Havola ishlamadi ---
  B({
    key: 'tech_help', stage: 'TECH_HELP', title: 'Texnik yordam',
    body: "Havola yoki video ishlamadi degani uchun uzr. Muammoni yozing - masalan, qaysi havola va qanday xato chiqdi.\n\nMuammoni tekshiramiz va qayta ishlaymiz. Agar hozir boshqa qulay yo'l bo'lsa, uni ham yozing.",
    buttons: [
      { label: 'Menyu', action: 'cmd:menu' },
      { label: 'Boshqa havola so\'rayman', action: 'cmd:ask' },
    ],
  }),
  // --- 50. Tushunarsiz xabar ---
  B({
    key: 'unknown', stage: 'UNKNOWN', title: 'Tushunmovchi',
    body: "Xabaringizni qabul qildim.\n\nHozircha bu savolni avtomatik javobsiz qoldiraman - chunki javobni o'ylab topib, noto'g'ri ma'lumot bermaslikni xohlaymiz.\n\nSizning so'rovingiz saqlab qilindi. Uni shu yerda davom ettirishingiz yoki quyidagi bo'limlardan birini tanlashingiz mumkin.",
    buttons: [
      { label: "Sinov darsini ko'rish", action: 'goto:LESSON_INTRO' },
      { label: "Takliflarni ko'rish", action: 'goto:OFFERS' },
      { label: "Savolni qayta yozaman", action: 'cmd:ask' },
      { label: 'Menyu', action: 'cmd:menu' },
    ],
  }),
  // --- 38. Tanishuv eslatmasi (darsdan qochganlar va tanishuvni tugatmaganlar) ---
  B({
    key: 'reminder_intro', stage: null, title: 'Eslatma: tanishuv',
    body: "Tanishuvni yakunigacha olib boramizmi?\n\nSizga Moy Sklad'ni birinchi marta ochayotgandek ko'rinishi mumkin. Lekin avval sinov darsi orqali bir amaliy ishni ko'rib olamiz.",
    buttons: [
      { label: 'Ha, daqm etaman', action: 'goto:EXPERIENCE_VIDEO' },
      { label: 'Yo\'q', action: 'cmd:menu' },
    ],
  }),
  // --- 39. Sinov darsi eslatmasi ---
  B({
    key: 'reminder_lesson', stage: null, title: 'Eslatma: sinov darsi',
    body: "Sinov darsini ko'rib bo'ldingizmi?\n\nAgar darsga kirmagan bo'lsangiz - hozir kiring va bitta amaliy ishni tugating. Agar darsni ko'rgan bo'lsangiz - keyingi bosqichga o'tamiz.",
    buttons: [
      { label: "Ko'rmadim - havolani qayta yuboring", action: 'lesson:resend' },
      { label: 'Ko\'rdim', action: 'lesson:watched' },
      { label: 'Hozir imkoniyat yo\'q', action: 'goto:NOT_READY' },
    ],
  }),
  B({
    key: 'reminder_lesson_again', stage: null, title: 'Eslatma: ertaga',
    body: "Mayli, bugun ishlar band bo'lsa kerak.\n\nErtaga shu vaqtda eslatib qo'yaman.",
    buttons: [
      { label: "Keling - ertaga eslang", action: 'lesson:remind_tomorrow' },
      { label: "Eslatma kerak emas", action: 'goto:NOT_READY' },
      { label: "Hozir ko'raman", action: 'goto:LESSON_INTRO' },
    ],
  }),
  // --- 40. Taklif eslatmasi (sotuv bilan suhbatdan keyin) ---
  B({
    key: 'reminder_offers', stage: null, title: 'Eslatma: takliflar',
    body: "Birga kelishganimizdek - Moy Sklad haqidagi ma'lumotni bir necha variant bo'yicha ko'rib chiqish mumkin.\n\nSizga qaysi biri ma'qul - xabar bering.",
    buttons: [
      { label: 'Kurs', action: 'goto:OFFER_COURSE' },
      { label: 'Videodarslar', action: 'goto:OFFER_VIDEOS' },
      { label: 'Xizmat', action: 'goto:OFFER_SERVICE' },
      { label: 'Hozir tayyor emasman', action: 'goto:NOT_READY' },
      { label: 'Savolim bor', action: 'cmd:ask' },
    ],
  }),
  // --- 41. Birinchi hafta oxiri xabari ---
  B({
    key: 'reminder_week1', stage: null, title: 'Xabar: hafta oxiri',
    body: "Tanishuvdan keyin birinchi hafta oxiriga chiqdik.\n\nAgar bizga o'zingizning holatingizni yozsangiz, sizga Moy Sklad bo'yicha shartlarni birga ko'rib chiqishimiz mumkin.\n\nQulay bo'lsa, hozir yozing yoki suhbat vaqtini belgilang.",
    buttons: [
      { label: "Shartlarni muhokama qilish", action: 'goto:READINESS' },
      { label: 'Faqat maslahatlar olaman', action: 'cmd:menu' },
      { label: 'Eslatmalarni to\'xtating', action: 'notif:off' },
    ],
  }),
  // --- 42-45. Foydali maslahatlar (haftiga 1-2 marta) ---
  B({
    key: 'tip_cash', stage: null, title: 'Maslahat: naqd pul',
    body: "Kichik biznesda ba'zan eng ko'p vaqtni pul oqimining o'zi emas, balki uning qayerda ekanini bilish oladi.\n\nKassa qayerda? Pul kimda? Qaysi mijozda qarzdorlik bor-yo'qligi nima bo'lishi mumkin?\n\nMoy Sklad'da kirim-chiqimni hujjatga bog'lab yurilsa, pulning harakatini har kuni ko'rish mumkin bo'ladi. Bu kassa tekshiruvi uchun emas, balki pulning qayerda ekanini bilish uchun kerak.",
    buttons: [
      { label: 'Savolim bor', action: 'cmd:ask' },
      { label: "Takliflarni ko'rish", action: 'goto:OFFERS' },
    ],
  }),
  B({
    key: 'tip_debt', stage: null, title: 'Maslahat: qarzdorlik',
    body: "Agar mijozga \"menda qancha qoldi?\" deb bir necha marta qo'ng'iroq qilishga to'g'ri kelsa - bu muhim ma'lumot hujjatlarda tartibli kiritilmaganidan darak beradi.\n\nBiznesda mijozning qarzi alohida daftarda emas, balki savdo va to'lov hujjatlari bilan bog'lab yuritilsa, xatolik kamayadi va tekshirish osonlashadi. Moy Sklad'da qarz yuzaga kelgan savdo hujjati va uni to'lov hujjati birga bog'lanadi.",
    buttons: [
      { label: 'Savolim bor', action: 'cmd:ask' },
      { label: 'Joriy qilish xizmati', action: 'goto:OFFER_SERVICE' },
    ],
  }),
  B({
    key: 'tip_slow', stage: null, title: 'Maslahat: sekin ish',
    body: "Kundalik ishda eng sekin joy qayerda?\n\nOmborda qidirishdami? Telefon orqali qarzni aniqlashdami? Yoki xodimning hujjatini tekshirishdami?\n\nBiznesni avtomatlashtirishda hammamasini bir zumda almashtirish shart emas. Moy Sklad bo'yicha maslahat olganlarning ko'pi birinchi qadamda eng ko'p vaqt oladigan bitta vazifani oladi va uni tartibga soladi.",
    buttons: [
      { label: 'Savolim bor', action: 'cmd:ask' },
      { label: "Sinov darsini ko'rish", action: 'goto:LESSON_INTRO' },
    ],
  }),
  B({
    key: 'tip_owner', stage: null, title: 'Maslahat: rahbar uchun',
    body: "Xodim ishlayapti. Lekin rahbar uchun eng qiyin savol ko'pincha shunday bo'ladi: ish to'g'ri kiryaptimi?\n\nRahbarning ishi - har bir hujjatni qayta yozish emas, balki kerakli hisobotni ochib, zaxira ma'lumotni tekshirish va muammoni ish bo'layotganda ko'rish.\n\nShuning uchun Moy Sklad'da faqat ma'lumot kiritish emas, balki rahbar uchun tekshirish imkoniyatini ham sozlashni taklif qilamiz.",
    buttons: [
      { label: 'Savolim bor', action: 'cmd:ask' },
      { label: "Menga mos taklif", action: 'goto:OFFERS' },
    ],
  }),
  // --- 51. Xarid qilingandan keyin boshlash ---
  B({
    key: 'purchase_start', stage: null, title: "Xarid - boshlash",
    body: "Sotuv bo'limi xabarni qabul qildi va uni qayta ishladi.\n\nXarid qilingan mahsulot bo'yicha boshlash ma'lumoti:\n\n{{purchase:info}}\n\nAgar bog'lanishda qiyinchilik bo'lsa: bizning yordam botimiz: {{settings:help_path}}",
    buttons: [
      { label: 'Yordam', action: 'cmd:ask' },
      { label: 'Menyu', action: 'cmd:menu' },
    ],
  }),
  // --- Xizmat qiziqishi (03 bosqichdan o'tish) ---
  B({
    key: 'section_soon', stage: null, title: 'Bo\'lim tez orada',
    body: "Bu bo'lim hali tayyorlanmoqda - uni ishga tushirish uchun material va havolalar jamoa tomonidan tasdiqlanishi kerak.\n\nHozircha tanishuvni davom ettirishingiz yoki savol yuborishingiz mumkin.",
    buttons: [
      { label: 'Menyu', action: 'cmd:menu' },
      { label: 'Savol yuborish', action: 'cmd:ask' },
    ],
  }),
];
