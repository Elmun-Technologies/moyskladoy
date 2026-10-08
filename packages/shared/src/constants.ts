import type { Stage } from './types.js';

/** Engine state order (dashboard/funnel ordering only; bot flow is unchanged). */
export const ENGINE_STAGE_ORDER = [
  'START', 'EXPERIENCE_VIDEO', 'CLIENT_REVIEW', 'METHOD_VIDEO', 'SURVEY_ROLE', 'SURVEY_ROLE_TEXT',
  'SURVEY_PROBLEM', 'SURVEY_PROBLEM_TEXT', 'SURVEY_PATH', 'BUSINESS_TYPE', 'PATH_SELF', 'PATH_EMPLOYEE',
  'PATH_UNSURE', 'LESSON_INTRO', 'TASK', 'TASK_CORRECT', 'TASK_WRONG', 'AFTER_LESSON_VIDEO', 'STUDENT_REVIEW',
  'CONSENT_REMINDERS', 'OFFERS', 'OFFER_COURSE', 'OFFER_VIDEOS', 'OFFER_SERVICE', 'COMPARE', 'OBJECTION_TIME',
  'OBJECTION_EMPLOYEE', 'OBJECTION_PRICE', 'OBJECTION_START', 'ASK_QUESTION', 'ANSWER_FOLLOWUP', 'READINESS',
  'TIMELINE', 'DECISION_MAKER', 'DECISION_LEADER', 'PREFLIGHT_VIDEO', 'CONSENT_CONTACT', 'CONTACT_METHOD',
  'PREFERRED_TIME', 'REVIEW_SUBMIT', 'SUBMITTED', 'NOT_READY', 'MENU', 'NOTIF_SETTINGS', 'REMINDERS_OFF',
  'TECH_HELP', 'UNKNOWN', 'PURCHASE_START',
] as const satisfies readonly Stage[];

/** Tashkent (Asia/Tashkent) bo'yicha marketing oynasi. */
export const MARKETING_WINDOW = { start: '09:00', end: '20:00' } as const;

/** Bir foydalanuvchi kuniga maks. marketing xabari. */
export const MARKETING_MAX_PER_DAY = 1;

  /** Tanishuv bosqichlari - intro eslatma uchun (38). */
export const INTRO_STAGES: readonly Stage[] = ['START', 'EXPERIENCE_VIDEO', 'CLIENT_REVIEW', 'METHOD_VIDEO'];

/** Sinov darsi bosqichlari - dars eslatmasi uchun (39). */
export const LESSON_STAGES: readonly Stage[] = ['LESSON_INTRO', 'TASK', 'TASK_CORRECT', 'TASK_WRONG'];

/** Taklif bosqichlari - taklif eslatmasi uchun (40). */
export const OFFER_STAGES: readonly Stage[] = [
  'OFFERS',
  'OFFER_COURSE',
  'OFFER_VIDEOS',
  'OFFER_SERVICE',
  'COMPARE',
  'OBJECTION_TIME',
  'OBJECTION_EMPLOYEE',
  'OBJECTION_PRICE',
  'OBJECTION_START',
];

/** Sotuvga topshirish yo'li - avtomatik sotuv eslatmalari to'xtaydi. */
export const SALES_FLOW_STAGES: readonly Stage[] = [
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

/** Erkin matn kutiladigan bosqichlar. */
export const FREE_TEXT_STAGES: readonly Stage[] = [
  'SURVEY_ROLE_TEXT',
  'SURVEY_PROBLEM_TEXT',
  'BUSINESS_TYPE',
  'OFFER_SERVICE',
  'OBJECTION_EMPLOYEE',
  'OBJECTION_START',
  'ASK_QUESTION',
  'TECH_HELP',
  'PREFERRED_TIME',
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
  termsCourseUrl: 'terms_course_url',
  termsVideosUrl: 'terms_videos_url',
  helpPath: 'help_path',
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
