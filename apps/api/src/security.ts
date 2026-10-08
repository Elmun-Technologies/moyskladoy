import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** IP hash (loglarda ochiq IP saqlamaslik uchun). */
export function hashIp(ip: string, salt: string): string {
  return createHash('sha256').update(salt + ':' + ip).digest('hex').slice(0, 32);
}

function ipIsPrivate(ip: string): boolean {
  return (
    /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/.test(ip) ||
    /^::1$/.test(ip) ||
    /^f[cd]/i.test(ip) ||
    /^fe80/i.test(ip)
  );
}

/**
 * SSRF guard: media manba URL'lari faqat http(s) va faqat PUBLIC IP ga.
 * redirect'lar ham tekshiriladi (fetch'da redirect: 'error').
 */
export async function assertSafeExternalUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('invalid_url');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol_forbidden');
  const host = u.hostname;
  if (isIP(host)) {
    if (ipIsPrivate(host)) throw new Error('private_address');
    return u;
  }
  const addrs = await lookup(host, { all: true });
  if (addrs.length === 0) throw new Error('dns_empty');
  for (const a of addrs) if (ipIsPrivate(a.address)) throw new Error('private_address');
  return u;
}

/** Upload validatsiyasi: cheklangan o'lcham + ruxsat etilgan turlar. */
export const ALLOWED_UPLOAD_MIME: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'video/mp4': ['.mp4'],
  'video/quicktime': ['.mov'],
};

export function validateUploadName(name: string, mime: string, size: number, maxBytes: number): string | null {
  if (size <= 0 || size > maxBytes) return 'size_invalid';
  const exts = ALLOWED_UPLOAD_MIME[mime];
  if (!exts) return 'mime_forbidden';
  const ext = '.' + (name.split('.').pop() ?? '').toLowerCase();
  if (!exts.includes(ext)) return 'ext_mismatch';
  return null;
}
