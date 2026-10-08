// ============================================================================
// Xavfsiz matn funksiyalari:
//  - Telegram HTML parse mode uchun ekranlash
//  - Loglarda telefon/token/maxfiy ma'lumotlarni yashirish
//  - Foydalanuvchi matnini administrator panelida xavfsiz ko'rsatish
// ============================================================================

/** Telegram HTML parse mode uchun maxsus belgilarni ekranlash. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Telegram MarkdownV2 parse mode uchun ekranlash. */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/** Loglar uchun telefon raqamlarni yashirish: +998901234567 -> +998***4567 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return '***';
  const head = digits.slice(0, -4).replace(/\d/g, '*');
  return `+${head}${digits.slice(-4)}`;
}

/** Tokenlarni loglarda yashirish: abcdef123456 -> abc***456 */
export function maskToken(token: string): string {
  if (token.length < 8) return '***';
  return `${token.slice(0, 3)}***${token.slice(-3)}`;
}

/**
 * Foydalanuvchi matnini panelda/xatolarda xavfsiz ko'rsatish:
 * oddiy matn ko'rinishida, boshqaruv belgilarisiz, uzunligi cheklangan.
 */
export function toPlainText(input: unknown): string {
  if (input === null || input === undefined) return '';
  const s = String(input);
  const cleaned = s
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 2000);
}

/** Telefon raqami formatini tekshirish (yengil, permissive format). */
export function isPlausiblePhone(phone: string): boolean {
  return /^\+?[0-9]{9,15}$/.test(phone.replace(/[\s()-]/g, ''));
}

/** Callback action formatini tekshirish - action string'lari cheklangan. */
export function isSafeAction(action: string): boolean {
  return /^[a-z0-9_:=|.\-]{1,128}$/i.test(action);
}
