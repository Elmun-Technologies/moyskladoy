'use client';
/** API yordamchisi: relative /api/* (Next rewrite orqali proxirlanadi). */
let csrfToken: string | null = null;

export function setCsrf(t: string | null): void {
  csrfToken = t;
}
export function getCsrf(): string | null {
  return csrfToken;
}

export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown } ): Promise<{ status: number; json: T | { ok: false; error: string } }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init?.method && init.method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;
  const r = await fetch('/api' + path, {
    method: init?.method ?? 'GET',
    headers,
    credentials: 'same-origin',
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const json = (await r.json().catch(() => ({ ok: false, error: 'bad_json' }))) as T | { ok: false; error: string };
  return { status: r.status, json };
}
