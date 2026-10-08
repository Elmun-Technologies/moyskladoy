// Seed: products. Prices are admin-editable in the panel; nothing here is
// final commercial terms. The special-800 offer is UNCONFIRMED and must
// never be shown to users (visibleToUsers=false).
import type { PriceType, ProductKind } from '@app/shared';

export interface ProductSeed {
  /** product slug */
  key: string;
  kind: ProductKind;
  name: string;
  description: string;
  priceType: PriceType;
  priceUsd: number | null;
  pricingText: string | null;
  visibleToUsers: boolean;
  confirmed: boolean;
}

export const PRODUCTS: ProductSeed[] = [
  {
    key: 'course',
    kind: 'course',
    name: 'Moy Sklad kursi',
    description: "To'liq kurs: nazariya va amaliyot. Davomiylik va shartlar admin panelida tasdiqlanadi.",
    priceType: 'fixed',
    priceUsd: 2000,
    pricingText: null,
    visibleToUsers: true,
    confirmed: false,
  },
  {
    key: 'video_lessons',
    kind: 'video_lessons',
    name: 'Video darslar',
    description: "Tayyor video darslar to'plami. Amaliy joriy qilish kirmaydi.",
    priceType: 'fixed',
    priceUsd: 500,
    pricingText: null,
    visibleToUsers: true,
    confirmed: false,
  },
  {
    key: 'service',
    kind: 'service',
    name: 'Amaliy joriy qilish xizmati',
    description: "Biznesingizda Moy Skladni amaliy joriy qilish. Narx ko'lam bo'yicha, sotuvchi baholaydi.",
    priceType: 'by_scope',
    priceUsd: null,
    pricingText: 'Narx ish ko\'lami bo\'yicha belgilanadi. Sotuvchi bilan suhbatda aniqlanadi.',
    visibleToUsers: true,
    confirmed: false,
  },
  {
    key: 'special-800',
    kind: 'special_offer',
    name: 'Maxsus taklif (tasdiqlanmagan)',
    description: "800 USD lik taklif haqida ma'lumot hali tasdiqlanmagan. Foydalanuvchilarga ko'rsatilmaydi.",
    priceType: 'unconfirmed',
    priceUsd: 800,
    pricingText: null,
    visibleToUsers: false,
    confirmed: false,
  },
];
