import { DateTime, IANAZone } from 'luxon';

/** Loyiha bo'yicha main Vaqt - Asia/Tashkent. */
export const TASHKENT_ZONE = 'Asia/Tashkent';

const zone = new IANAZone(TASHKENT_ZONE);

export function nowInTashkent(): DateTime {
  return DateTime.now().setZone(zone);
}

export function toTashkent(date: Date): DateTime {
  return DateTime.fromJSDate(date).setZone(zone);
}

/**
 * Marketing/xabar yuborish oynasi: 09:00-20:00 (Toshkent bo'yicha).
 * @param start 'HH:mm' formatda
 * @param end   'HH:mm' formatda
 */
export function isWithinSendingWindow(
  date: Date,
  start = '09:00',
  end = '20:00',
): boolean {
  const dt = toTashkent(date);
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const minutes = dt.hour * 60 + dt.minute;
  return minutes >= sh! * 60 + sm! && minutes < eh! * 60 + em!;
}

/** "yyyy-MM-dd" - Tashkent bo'yicha (kun chegarasi bo'yicha). */
export function tashkentDayKey(date: Date): string {
  return toTashkent(date).toFormat('yyyy-MM-dd');
}

export function hoursAgo(date: Date, hours: number): Date {
  return new Date(date.getTime() - hours * 3600_000);
}

export function daysAgo(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 86_400_000);
}

/** Kechiktirish - job'lar uchun. */
export function msFromNow(ms: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + ms);
}
