import type { ContentBlock } from '@app/shared';

// ============================================================================
// Seed content blocks: 44 bot messages + 3 video transcripts.
// All seeded as 'approved'. Text present does NOT mean media is ready:
// media blocks are seeded with mediaId=null and uploaded via the admin panel.
// All copy is editable in the admin panel (draft -> preview -> approve).
// Uzbek copy is written in plain ASCII (O' / G' instead of O'/G').
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
  // --- Tanishuv (intro) yo'li ---
  B({
    key: 'welcome', stage: 'START', title: 'Kirish',
    body: "Xush kelibsiz! Bu yerda o'zingizga mos yo'lni tanlaysiz.",
    buttons: [
      { label: 'Davom ettirish', action: 'goto:INTRO_VIDEO' },
      { label: 'Sinov darsi', action: 'goto:LESSON_INTRO' },
      { label: 'Takliflar', action: 'goto:OFFERS' },
      { label: 'Sotuv bilan suhbat', action: 'goto:CONSENT_CONTACT' },
    ],
  }),
  B({
    key: 'intro_video', stage: 'INTRO_VIDEO', title: 'Tanishuv',
    body: "Assalomu alaykum! Men Jamshidman.\nBu videoda mening biznes yo'lim haqida gapiraman.\nKeyin sinov darsini ko'rasiz.",
    mediaType: 'video_note', requiresMedia: true,
    buttons: [{ label: 'Davom ettirish', action: 'goto:EXPERIENCE_VIDEO' }],
  }),
  B({
    key: 'experience_video', stage: 'EXPERIENCE_VIDEO', title: 'Tajriba',
    body: "50 dan ortiq proyecto ustida ishlaganman.\nHar bir biznesda bir xil ish.\nMoy Sklad shu ish yordam beradi.",
    mediaType: 'video_note', requiresMedia: true,
    buttons: [{ label: 'Davom ettirish', action: 'goto:CLIENT_REVIEW' }],
  }),
  B({
    key: 'client_review', stage: 'CLIENT_REVIEW', title: 'Mijoz fikri',
    body: "Mijozlar mening ishimdan mamnun. Ularning fikrlarini ko'rishni xohlaysizmi?",
    buttons: [
      { label: 'Ha, davom', action: 'goto:METHOD_VIDEO' },
      { label: "O'tkazib yuborish", action: 'goto:METHOD_VIDEO' },
    ],
  }),
  B({
    key: 'method_video', stage: 'METHOD_VIDEO', title: 'Metod',
    body: "Bu videoda mening metodim haqida gapiraman.\nQanday ishlashimni ko'rasiz.\nKeyin sinov darsiga o'tamiz.",
    mediaType: 'video_note', requiresMedia: true,
    buttons: [{ label: 'Davom ettirish', action: 'goto:SURVEY_ROLE' }],
  }),
  // --- So'rovnoma (survey) ---
  B({
    key: 'survey_role', stage: 'SURVEY_ROLE', title: 'Rol',
    body: 'Siz kim sifatida ishlaysiz?',
    buttons: [
      { label: 'Biznes egasi', action: 'answer:role=owner' },
      { label: 'Xodim', action: 'answer:role=employee' },
      { label: 'Boshqa', action: 'answer:role=other' },
    ],
  }),
  B({
    key: 'survey_problem', stage: 'SURVEY_PROBLEM', title: 'Muammo',
    body: 'Sizda qanday muammo bor?',
    buttons: [
      { label: "Tovar qoldig'i", action: 'answer:problem=stock' },
      { label: 'Mijoz qarzi', action: 'answer:problem=debt' },
      { label: 'Hisobotlar', action: 'answer:problem=reports' },
      { label: 'Boshqa', action: 'answer:problem=other' },
    ],
  }),
  B({
    key: 'survey_path', stage: 'SURVEY_PATH', title: "Yo'l",
    body: "Qaysi yo'l sizga mos?",
    buttons: [
      { label: "O'zim o'rganaman", action: 'answer:path=self' },
      { label: "Jamoamiz o'rgatadi", action: 'answer:path=employee' },
      { label: 'Bilmayman', action: 'answer:path=unsure' },
    ],
  }),
  B({
    key: 'business_type', stage: 'BUSINESS_TYPE', title: 'Biznes turi',
    body: 'Biznesingiz qanday soha? (qisqa matn yozing)',
    buttons: [],
  }),
  B({
    key: 'path_self', stage: 'PATH_SELF', title: "O'zim o'rganaman",
    body: "Siz o'zingiz o'rganmoqchisiz. Sinov darsi sizga mos.",
    buttons: [
      { label: "Sinov darsiga o'tish", action: 'goto:LESSON_INTRO' },
      { label: 'Takliflar', action: 'goto:OFFERS' },
    ],
  }),
  B({
    key: 'path_employee', stage: 'PATH_EMPLOYEE', title: 'Jamoa yordami',
    body: "Sizga jamoamiz yordam beradi. Tayyor bo'lsangiz, davom eting.",
    buttons: [{ label: 'Davom ettirish', action: 'goto:NEED_CHECK' }],
  }),
  B({
    key: 'path_unsure', stage: 'PATH_UNSURE', title: 'Aniq emas',
    body: 'Hali aniq emasmi? Sinov darsi sizga yordam beradi.',
    buttons: [
      { label: "Sinov darsiga o'tish", action: 'goto:LESSON_INTRO' },
      { label: 'Takliflar', action: 'goto:OFFERS' },
    ],
  }),
  // --- Sinov darsi yo'li ---
  B({
    key: 'lesson_intro', stage: 'LESSON_INTRO', title: 'Sinov darsi',
    body: "Sinov darsini ko'ring. Havolani bosing va ko'rgach, 'Ko'rdim' tugmasini bosing.",
    buttons: [
      { label: 'Darsni ochish', action: 'lesson:open' },
      { label: "Ko'rdim", action: 'lesson:watched' },
    ],
    showCondition: { lessonLinkRequired: true },
  }),
  B({
    key: 'lesson_offer', stage: 'LESSON_OFFER', title: "Darsdan so'ng",
    body: "Darsni ko'rdingizmi? Endi Amaliyot boshlaymiz.",
    buttons: [{ label: 'Amaliyotni boshlash', action: 'goto:TASK' }],
  }),
  B({
    key: 'task', stage: 'TASK', title: 'Vazifa',
    body: "Amaliyot: o'z biznesingiz uchun bitta vazifa tanlang.",
    buttons: [
      { label: 'Vazifa A', action: 'task:a' },
      { label: 'Vazifa B', action: 'task:b' },
      { label: 'Vazifa C', action: 'task:c' },
    ],
  }),
  B({
    key: 'task_result', stage: 'TASK_RESULT', title: 'Natija',
    body: 'Yaxshi! Vazifangiz qabul qilindi.',
    buttons: [{ label: 'Davom ettirish', action: 'goto:AFTER_TASK' }],
  }),
  B({
    key: 'after_task', stage: 'AFTER_TASK', title: 'Keyingi qadam',
    body: "Endi talabalar fikri bilan tanishamiz.",
    buttons: [{ label: 'Davom ettirish', action: 'goto:STUDENT_REVIEW' }],
  }),
  B({
    key: 'student_review', stage: 'STUDENT_REVIEW', title: 'Talaba fikri',
    body: "O'quvchilar mening darslarimdan mamnun. Ularning fikrini ko'rasizmi?",
    buttons: [
      { label: 'Ha', action: 'goto:NEED_CHECK' },
      { label: "Yo'q", action: 'goto:NEED_CHECK' },
    ],
  }),
  // --- Ehtiyoj tekshiruvi ---
  B({
    key: 'need_check', stage: 'NEED_CHECK', title: 'Ehtiyoj',
    body: 'Sizga hozir nima kerak?',
    buttons: [
      { label: "Takliflarni ko'rish", action: 'goto:OFFERS' },
      { label: 'Hali erta', action: 'goto:NOT_READY' },
    ],
  }),
  // --- Takliflar (narhlar DB'dan; engine product kartini qo'shib ko'rsatadi) ---
  B({
    key: 'offers', stage: 'OFFERS', title: 'Takliflar',
    body: "Bizning takliflar bilan tanishmoqchisiz?",
    buttons: [
      { label: 'Kurs', action: 'goto:OFFER_COURSE' },
      { label: 'Video darslar', action: 'goto:OFFER_VIDEOS' },
      { label: 'Xizmat (joriy qilish)', action: 'goto:OFFER_SERVICE' },
    ],
    showCondition: { requiresVisibleProducts: true },
  }),
  B({
    key: 'offer_course', stage: 'OFFER_COURSE', title: 'Kurs',
    body: 'Kurs taklifi (narh va shartlar pastda):',
    buttons: [
      { label: "Sotuv bilan bog'lanish", action: 'goto:READINESS' },
      { label: 'Orqaga', action: 'goto:OFFERS' },
    ],
  }),
  B({
    key: 'offer_videos', stage: 'OFFER_VIDEOS', title: 'Video darslar',
    body: 'Video darslar taklifi (narh va shartlar pastda):',
    buttons: [
      { label: "Sotuv bilan bog'lanish", action: 'goto:READINESS' },
      { label: 'Orqaga', action: 'goto:OFFERS' },
    ],
  }),
  B({
    key: 'offer_service', stage: 'OFFER_SERVICE', title: 'Xizmat',
    body: 'Xizmat (joriy qilish) taklifi (narh pastda):',
    buttons: [
      { label: "Sotuv bilan bog'lanish", action: 'goto:READINESS' },
      { label: 'Orqaga', action: 'goto:OFFERS' },
    ],
  }),
  B({
    key: 'compare', stage: 'COMPARE', title: 'Taqqoslash',
    body: "Takliflarni taqqoslang va o'zingizga mosini tanlang.",
    buttons: [
      { label: 'Kurs', action: 'goto:OFFER_COURSE' },
      { label: 'Video darslar', action: 'goto:OFFER_VIDEOS' },
      { label: 'Xizmat', action: 'goto:OFFER_SERVICE' },
    ],
  }),
  // --- E'tirozlar (objections) ---
  B({
    key: 'objection', stage: 'OBJECTION', title: 'Savol',
    body: 'Sizda biror savol yoki shubha bormi? Erkin ayting.',
    buttons: [
      { label: 'Savolim bor', action: 'goto:ASK_QUESTION' },
      { label: "Yo'q, tushunarli", action: 'goto:READINESS' },
    ],
  }),
  B({
    key: 'objection_time', stage: 'OBJECTION_TIME', title: 'Vaqt',
    body: "Vaqtingiz bo'lmasa, boshqa kunga qoldiramiz.",
    buttons: [
      { label: 'Keyinroq', action: 'goto:PREFERRED_TIME' },
      { label: 'Hozir', action: 'goto:READINESS' },
    ],
  }),
  B({
    key: 'objection_price', stage: 'OBJECTION_PRICE', title: 'Narx',
    body: "Narx bo'yicha to'liq ma'lumot takliflar bo'limida.",
    buttons: [
      { label: "Takliflarni ko'rish", action: 'goto:OFFERS' },
      { label: 'Davom', action: 'goto:READINESS' },
    ],
  }),
  B({
    key: 'objection_employee', stage: 'OBJECTION_EMPLOYEE', title: 'Jamoa',
    body: 'Sizga jamoamiz yordam beradi.',
    buttons: [{ label: 'Davom', action: 'goto:READINESS' }],
  }),
  B({
    key: 'objection_start', stage: 'OBJECTION_START', title: 'Boshlash',
    body: 'Qachongacha kutmoqchisiz?',
    buttons: [
      { label: 'Hozir', action: 'goto:READINESS' },
      { label: 'Keyinroq', action: 'goto:PREFERRED_TIME' },
    ],
  }),
  // --- Tayyorlik va qaror egasi ---
  B({
    key: 'readiness', stage: 'READINESS', title: 'Tayyorlik',
    body: 'Xarid qilishga tayyormisiz?',
    buttons: [
      { label: "Ha, bog'lanmoqchiman", action: 'goto:CONSENT_CONTACT' },
      { label: "Hali yo'q", action: 'goto:NOT_READY' },
    ],
  }),
  B({
    key: 'timeline', stage: 'TIMELINE', title: 'Reja',
    body: 'Qancha vaqt ichida boshlamoqchisiz?',
    buttons: [
      { label: 'Bir kun', action: 'answer:timeline=day' },
      { label: 'Bir hafta', action: 'answer:timeline=week' },
      { label: 'Bir oy', action: 'answer:timeline=month' },
    ],
  }),
  B({
    key: 'decision_maker', stage: 'DECISION_MAKER', title: 'Qaror',
    body: "Qarorni o'zingiz qabul qilasizmi?",
    buttons: [
      { label: "O'zim", action: 'answer:decision=self' },
      { label: 'Rahbar bilan', action: 'goto:DECISION_MAKER_LEADER' },
    ],
  }),
  B({
    key: 'decision_maker_leader', stage: 'DECISION_MAKER_LEADER', title: 'Rahbar',
    body: "Rahbarni ham taklif qilamiz. Qulay vaqtni ayting.",
    buttons: [{ label: 'Davom', action: 'goto:CONSENT_CONTACT' }],
  }),
  // --- Rozilik va kontakt ---
  B({
    key: 'consent_contact', stage: 'CONSENT_CONTACT', title: 'Rozilik',
    body: "Sotuv mutaxassisi siz bilan bog'lanishi uchun telefon raqamingizni saqlashga rozimisiz?",
    buttons: [
      { label: 'Ha, roziman', action: 'consent:grant' },
      { label: "Yo'q", action: 'consent:decline' },
    ],
  }),
  B({
    key: 'contact_method', stage: 'CONTACT_METHOD', title: "Bog'lanish",
    body: "Siz bilan qanday bog'lansak qulay?",
    buttons: [
      { label: 'Telefon orqali', action: 'contact:phone' },
      { label: 'Telegram orqali', action: 'contact:telegram' },
    ],
  }),
  B({
    key: 'preferred_time', stage: 'PREFERRED_TIME', title: 'Qulay vaqt',
    body: "Qaysi vaqtda qo'ng'iroq qilsak qulay? (09:00-20:00 oralig'ida)",
    buttons: [
      { label: 'Ertalab', action: 'answer:time=morning' },
      { label: 'Kunduzi', action: 'answer:time=afternoon' },
      { label: 'Kechqurun', action: 'answer:time=evening' },
    ],
  }),
  B({
    key: 'review_submit', stage: 'REVIEW_SUBMIT', title: 'Tekshirish',
    body: "Ma'lumotlaringizni tekshiring. To'g'ri bo'lsa yuboring.",
    buttons: [
      { label: 'Yuborish', action: 'submit:send' },
      { label: "O'zgartirish", action: 'submit:edit' },
    ],
  }),
  B({
    key: 'submitted', stage: 'SUBMITTED', title: 'Qabul qilindi',
    body: "Arizangiz qabul qilindi. Sotuv mutaxassisi tez orada bog'lanadi.",
    buttons: [{ label: 'Bosh menyu', action: 'cmd:menu' }],
  }),
  B({
    key: 'not_ready', stage: 'NOT_READY', title: 'Keyinroq',
    body: "Bo'ldi, sizni bezovta qilmaymiz. Xohlagan vaqtda /start bosing.",
    buttons: [{ label: 'Bosh menyu', action: 'cmd:menu' }],
  }),
  // --- Yordam va servis bloklar ---
  B({
    key: 'menu', stage: 'MENU', title: 'Menyu',
    body: 'Qaysini tanlaysiz?',
    buttons: [
      { label: 'Bosh sahifa', action: 'cmd:menu' },
      { label: "Sinov darsi", action: 'goto:LESSON_INTRO' },
      { label: 'Takliflar', action: 'goto:OFFERS' },
      { label: 'Savol berish', action: 'goto:ASK_QUESTION' },
      { label: "Sotuv bilan bog'lanish", action: 'goto:CONSENT_CONTACT' },
    ],
  }),
  B({
    key: 'ask_question', stage: 'ASK_QUESTION', title: 'Savol',
    body: "Savolingizni yozing. Jamoamiz javob beradi.",
    buttons: [{ label: 'Bosh menyu', action: 'cmd:menu' }],
  }),
  B({
    key: 'notifications', stage: 'NOTIFICATIONS', title: 'Bildirishnoma',
    body: "Eslatmalar va yangiliklarni yubormaslikimizni xohlaysizmi?",
    buttons: [
      { label: "Ha, yubormang", action: 'consent:revoke_marketing' },
      { label: 'Joyida qolsin', action: 'cmd:menu' },
    ],
  }),
  B({
    key: 'tech_help', stage: 'TECH_HELP', title: 'Texnik yordam',
    body: "Muammo tavsifini yozing. Yordam beramiz.",
    buttons: [{ label: 'Bosh menyu', action: 'cmd:menu' }],
  }),
  B({
    key: 'unknown', stage: 'UNKNOWN', title: 'Tushunmovchi',
    body: "Kechirasiz, bu xabarni tushunmadim. Quyidagi menyudan foydalaning.",
    buttons: [{ label: 'Bosh menyu', action: 'cmd:menu' }],
  }),

  // --- Reminder shablonlari (stage=null - funnel bosqichi emas, worker oladi) ---
  B({
    key: 'reminder_intro', stage: null, title: 'Eslatma: bosh sahifa',
    body: "Salom! Savolingiz bo'lsa, bemalol yozing. Tanishuvni davom ettirish uchun /start bosing.",
    buttons: [{ label: 'Davom etish', action: 'cmd:menu' }],
  }),
  B({
    key: 'reminder_lesson', stage: null, title: 'Eslatma: dars',
    body: "Sinov darsini ko'rdingizmi? Ko'rmagan bo'lsangiz, havola kutilmoqda.",
    buttons: [{ label: "Ko'rdim", action: 'lesson:watched' }],
  }),
  B({
    key: 'reminder_offers', stage: null, title: 'Eslatma: takliflar',
    body: "Takliflar haqida savolingiz bormi? Sotuvchi batafsil javob beradi.",
    buttons: [{ label: 'Takliflar', action: 'goto:OFFERS' }],
  }),
  B({
    key: 'reminder_review', stage: null, title: "Fikr so\'rash",
    body: "Biznesimiz qanday ketmoqda? Bir-ikki gap yozsangiz, juda qadrli.",
    buttons: [],
  }),
];