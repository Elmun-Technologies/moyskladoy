// Seed: long-term nurture tips. Each tip is sent at most once per user
// (only to users with marketing consent, inside the allowed window).
// Content status: approved => eligible for sending. Admin edits freely.
export interface TipSeed {
  key: string;
  title: string;
  body: string;
}

export const TIPS: TipSeed[] = [
  {
    key: 'tip_cash_reconciliation',
    title: 'Pul qoldig\'ini tekshirish',
    body: "Bugun kassada qancha pul bor? Hujjatdagi raqam bilan solishtiring. Farq bo'lsa, sababini shu kuni toping. Kichik farq o'sib katta muommoga aylanadi.",
  },
  {
    key: 'tip_debt_deadlines',
    title: 'Qarz muddatlari',
    body: "Mijozlar qarzini muddati bo'yicha saralang: bugun, bu hafta, kechikkan. Har kuni faqat kechikkan qarzlar bo'yicha qo'ng'iroq qiling. Muntazam eslatib turish qarzni tez qaytaradi.",
  },
  {
    key: 'tip_slow_moving',
    title: 'Sekin sotiladigan tovarlar',
    body: "30 kun sotilmagan tovarlar ro'yxatini tuzing. Ularga cheyirni yoki jamoa uchun rag'batni o'ylab ko'ring. Muzlab turgan ombor puli - biznesning yo'qolgan imkoniyati.",
  },
  {
    key: 'tip_task_assignment',
    title: 'Vazifa topshirish',
    body: "Har bir xodimga kun oxirida tekshiradigan aniq bitta vazifa bering. Vazifa og'zaki emas, yozma bo'lsin. Javobgar aniqlig'i nazoratni osonlashtiradi.",
  },
];
