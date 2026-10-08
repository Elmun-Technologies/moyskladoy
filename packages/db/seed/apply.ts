/**
 * applySeed - idempotent seed (blocks/tips/products/settings/admin).
 * seed.ts CLI va bot demo rejimi shu funksiyani ishlatadi.
 */
import bcrypt from 'bcryptjs';
import {
  SETTING_KEYS,
  SPECIAL_800_UNCONFIRMED,
  MARKETING_WINDOW,
  MARKETING_MAX_PER_DAY,
  CONSENT_TEXT_VERSION,
  PRODUCT_SLUGS,
  type Database,
} from '@app/shared';
import { CONTENT_BLOCKS } from './content-uz.js';
import { PRODUCTS } from './products.js';

export async function applySeed(db: Database, onLog: (m: string) => void = (m) => console.log(m)): Promise<void> {

  // 1) Content blocks (har biri uchun yangi versiya).
  for (const b of CONTENT_BLOCKS) {
    await db.upsertBlock(b);
  }
  onLog(`[seed] content blocks upserted: ${CONTENT_BLOCKS.length}`);

  // 2) Nurture tips - endi CONTENT_BLOCKS ichida (tip_cash/debt/slow/owner, 42-45).

  // 3) Products + initial version.
  for (const p of PRODUCTS) {
    const product = await db.upsertProduct({
      slug: p.key,
      kind: p.kind,
      name: p.name,
      description: p.description,
      details: { pricingText: p.pricingText ?? null, seedConfirmed: p.confirmed },
      priceType: p.priceType,
      priceUsd: p.priceUsd,
      currency: 'USD',
      isActive: true,
      visibleToUsers: p.visibleToUsers,
    });
    await db.createProductVersion(product.id, {
      name: p.name,
      description: p.description,
      details: { pricingText: p.pricingText ?? null },
      priceType: p.priceType,
      priceUsd: p.priceUsd,
    });
  }
  onLog(`[seed] products upserted: ${PRODUCTS.length} (special-800 visibleToUsers=false)`);

  // 4) Default settings (faqat yo'q bo'lsa - mavjudni bosmaymiz).
  const seedSettingIfAbsent = async (key: string, value: unknown): Promise<void> => {
    const cur = await db.getSetting(key);
    if (cur === null || cur === undefined) {
      await db.setSetting(key, value);
      onLog(`[seed] setting ${key} = default`);
    }
  };
  await seedSettingIfAbsent(SETTING_KEYS.specialOffer800, SPECIAL_800_UNCONFIRMED);
  await seedSettingIfAbsent(SETTING_KEYS.marketingWindow, MARKETING_WINDOW);
  await seedSettingIfAbsent(SETTING_KEYS.marketingMaxPerDay, MARKETING_MAX_PER_DAY);
  await seedSettingIfAbsent(SETTING_KEYS.consentTextVersion, CONSENT_TEXT_VERSION);
  await seedSettingIfAbsent(SETTING_KEYS.lessonLink, process.env.LESSON_LINK ?? null);
  await seedSettingIfAbsent(SETTING_KEYS.servicePricingText, process.env.SERVICE_PRICING_TEXT ?? null);
  await seedSettingIfAbsent(SETTING_KEYS.salesGroupChatId, process.env.SALES_GROUP_CHAT_ID ?? null);
  await seedSettingIfAbsent('product_terms:' + PRODUCT_SLUGS.course, {
    duration: 'tasdiqlanmagan',
    accessPeriod: 'tasdiqlanmagan',
    support: 'tasdiqlanmagan',
    installment: 'tasdiqlanmagan',
    refund: 'tasdiqlanmagan',
  });

  // 5) Admin (ixtiyoriy).
  const email = process.env.ADMIN_EMAIL;
  const pass = process.env.ADMIN_PASSWORD;
  if (email && pass) {
    const existing = await db.getAdminByEmail(email);
    if (!existing) {
      const hash = await bcrypt.hash(pass, 10);
      await db.createAdmin({
        email,
        passwordHash: hash,
        name: process.env.ADMIN_NAME ?? 'Admin',
        role: 'admin',
        failedLogins: 0,
        lockedUntil: null,
        lastLoginAt: null,
      });
      onLog(`[seed] admin created: ${email}`);
    } else {
      onLog(`[seed] admin already exists: ${email}`);
    }
  } else {
    onLog('[seed] ADMIN_EMAIL/ADMIN_PASSWORD berilmadi - admin yaratilmadi (keyinchalar admin panel/API orqali).');
  }

  onLog('[seed] done');
}

