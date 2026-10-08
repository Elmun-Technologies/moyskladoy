import type { Stage } from './types.js';

/** Tashkent (Asia/Tashkent) bo'yicha marketing oynasi. */
export const MARKETING_WINDOW = { start: '09:00', end: '20:00' } as const;

/** Bir foydalanuvchi kuniga maks. marketing xabari. */
export const MARKETING_MAX_PER_DAY = 1;

/** Tanishuv bosqichlari - "Qaysi bo'lim kerak?" eslatmasi uchun. */
export const INTRO_STAGES: readonly Stage[] = [
  'START',
  'INTRO_VIDEO',
  'EXPERIENCE_VIDEO',
  'CLIENT_REVIEW',
  'METHOD_VIDEO',
];

/** Sinov dersi bosqichlari - "Ko'rdim?" eslatmasi uchun. */
export const LESSON_STAGES: readonly Stage[] = ['LESSON_INTRO', 'LESSON_OFFER'];

/** Taklif bosqichlari - "Qaysi savol ochiq?" eslatmasi uchun. */
export const OFFER_STAGES: readonly Stage[] = [
  'OFFERS',
  'OFFER_COURSE',
  'OFFER_VIDEOS',
  'OFFER_SERVICE',
  'COMPARE',
  'OBJECTION',
  'OBJECTION_TIME',
  'OBJECTION_PRICE',
  'OBJECTION_EMPLOYEE',
  'OBJECTION_START',
];

/** Sotuvga topshirishdan oldingi bosqichlar - eslatma yubormaslik. */
export const SALES_FLOW_STAGES: readonly Stage[] = [
  'READINESS',
  'TIMELINE',
  'DECISION_MAKER',
  'DECISION_MAKER_LEADER',
  'CONSENT_CONTACT',
  'CONTACT_METHOD',
  'PREFERRED_TIME',
  'REVIEW_SUBMIT',
  'SUBMITTED',
];

/** Erkin matn kutiladigan bosqichlar - foydalanuvchi matn yozadi. */
export const FREE_TEXT_STAGES: readonly Stage[] = [
  'BUSINESS_TYPE',
  'OBJECTION_EMPLOYEE',
  'OBJECTION_START',
  'PREFERRED_TIME',
  'ASK_QUESTION',
  'TECH_HELP',
];

/** Boshlang'ich mahsulotlar (seed). */
export const PRODUCT_SLUGS = {
  course: 'course',
  videoLessons: 'video-lessons',
  service: 'service',
  /** $800 taklifi - tarkibi va qaysi mahsulotga tegishli ekanligi TASDIQLANMAGAN. */
  special800: 'special-800',
} as const;

/** Rozilik matni versiyasi (boshlang'ich). */
export const CONSENT_TEXT_VERSION = 'v1';

/**
 * Settings kalitlari (yagona manba). Qiymatlar DB `Setting` jadvalida;
 * admin panelidan tahrirlanadi. Bot hech qachon tasdiqlanmagan qiymatni
 * foydalanuvchiga ko'rsatmaydi.
 */
export const SETTING_KEYS = {
  lessonLink: 'lesson_link',
  servicePricingText: 'service_pricing_text',
  specialOffer800: 'special_offer_800',
  marketingWindow: 'marketing_window',
  marketingMaxPerDay: 'marketing_max_per_day',
  salesGroupChatId: 'sales_group_chat_id',
  consentTextVersion: 'consent_text_version',
  botMaintenance: 'bot_maintenance',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/** special_offer_800 qiymatining ko'rinishi - tasdiqlanmagan holat (seed default). */
export const SPECIAL_800_UNCONFIRMED = {
  status: 'unconfirmed',
  priceUsd: 800,
  name: null,
  composition: null,
  note: 'Ma\'lumot mijoz bergandan so\'ng admin panelida tasdiqlanadi. Tasdiqlanmagunicha bot uni HECH QAYERDA ko\'rsatmaydi.',
} as const;
