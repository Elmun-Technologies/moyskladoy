import { beforeEach, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { MemoryDatabase, TestMessenger } from '@app/shared';
import type { Database } from '@app/shared';
import { applySeed } from '@app/db';
import { loadApiConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

let db: Database;
let app: FastifyInstance;
let sid = '';
let csrf = '';

const cfg = { ...loadApiConfig({}), demoMode: true, botUsername: 'demo_bot', formMinFillMs: 0, formRateLimitMax: 100 };

beforeEach(async () => {
  db = new MemoryDatabase();
  await applySeed(db, () => undefined);
  app = await buildApp({ db, cfg });
  await db.createAdmin({ email: 'ed@test.uz', passwordHash: await bcrypt.hash('password123', 4), name: 'Ed', role: 'content_editor', failedLogins: 0, lockedUntil: null, lastLoginAt: null });
  const r = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { email: 'ed@test.uz', password: 'password123' } });
  sid = /sid=([^;]+)/.exec(r.headers['set-cookie'] as string)?.[1] ?? '';
  csrf = (r.json() as { csrf: string }).csrf;
});

const h = () => ({ cookie: `sid=${sid}`, 'x-csrf-token': csrf });

describe('blok tugmalari nazorati', () => {
  it('goto: mavjud bo\'lmagan sahna -> 422 + detal ro\'yxati', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/admin/blocks', headers: h(), payload: { key: 'menu', title: 'Menyu', body: 'x', buttons: [{ label: 'Yolg\'on', action: 'goto:NOT_A_STAGE' }] } });
    expect(r.statusCode).toBe(422);
    const j = r.json() as { details: string[] };
    expect(j.details.join(' ')).toContain('goto:NOT_A_STAGE');
  });

  it('ruxsat etilmagan amal formati -> 422', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/admin/blocks', headers: h(), payload: { key: 'menu', title: 'Menyu', body: 'x', buttons: [{ label: 'Hack', action: 'eval:alert(1)' }] } });
    expect(r.statusCode).toBe(422);
  });

  it('hidden+boshqariladigan tugmalar saqlanadi (yangi draft)', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/admin/blocks', headers: h(), payload: { key: 'menu', title: 'Menyu', body: 'yangi', buttons: [{ label: 'Takliflar', action: 'goto:OFFERS', hidden: true }, { label: 'Dars', action: 'goto:LESSON_INTRO' }] } });
    expect(r.statusCode).toBe(200);
    const blocks = await db.listBlocks({ status: 'draft' });
    const d = blocks.find((b) => b.key === 'menu');
    expect(d?.buttons.length).toBe(2);
    expect(d?.buttons[0]?.hidden).toBe(true);
  });

  it('katalogda yo\'q mediaId -> 422 (avval Media registry)', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/admin/blocks', headers: h(), payload: { key: 'menu', title: 'Menyu', body: 'x', mediaType: 'video_note', mediaId: 'FAKE_ID_123', buttons: [] } });
    expect(r.statusCode).toBe(422);
    expect((r.json() as { error: string }).error).toBe('media_not_in_catalog');
  });

  it('katalogdagi mediaId qabul qilinadi', async () => {
    await db.createMedia({ originalName: 'intro.mp4', mimeType: 'video/mp4', sizeBytes: 100, durationSec: 10, isVideoNote: true, fileId: 'REAL_ID_1', sourceUrl: null, status: 'approved', formatChecked: true, uploadedById: null });
    const r = await app.inject({ method: 'POST', url: '/api/admin/blocks', headers: h(), payload: { key: 'intro_video', stage: 'CLIENT_REVIEW', title: 'Mijoz fikri uchun media', body: 'x', mediaType: 'video_note', mediaId: 'REAL_ID_1', requiresMedia: true, buttons: [] } });
    expect(r.statusCode).toBe(200);
  });
});

describe('media upload', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');

  it('kengayma/mime mos kelmasa -> 422', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/admin/media/upload', headers: h(), payload: { originalName: 'evil.exe', mime: 'image/png', dataBase64: png, isVideoNote: false } });
    expect(r.statusCode).toBe(422);
    expect((r.json() as { error: string }).error).toBe('ext_mismatch');
  });

  it('mime ruxsat etilmagan -> 422', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/admin/media/upload', headers: h(), payload: { originalName: 'a.pdf', mime: 'application/pdf', dataBase64: png } });
    expect(r.statusCode).toBe(422);
    expect((r.json() as { error: string }).error).toBe('mime_forbidden');
  });

  it('demo (tokensiz): fayl saqlanadi, katalogga tushadi, file_id keyin boglanadi', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/admin/media/upload', headers: h(), payload: { originalName: 'intro.mp4', mime: 'video/mp4', dataBase64: png, isVideoNote: true } });
    expect(r.statusCode).toBe(200);
    const j = r.json() as { via: string; fileId: string | null };
    expect(j.via).toBe('local');
    expect(j.fileId).toBeNull();
    const list = await db.listMedia();
    expect(list.length).toBe(1);
    expect(list[0]?.status).toBe('uploaded');
  });

  it('katalogga qo\'lda file_id qo\'shish mumkin va blok uni ishlatadi', async () => {
    const reg = await app.inject({ method: 'POST', url: '/api/admin/media', headers: h(), payload: { originalName: 'meth.mp4', isVideoNote: true, fileId: 'TID_9', status: 'approved' } });
    expect(reg.statusCode).toBe(200);
    const r = await app.inject({ method: 'POST', url: '/api/admin/blocks', headers: h(), payload: { key: 'method_video', stage: 'METHOD_VIDEO', title: 'Metod', body: 'x', mediaType: 'video_note', mediaId: 'TID_9', requiresMedia: true, buttons: [] } });
    expect(r.statusCode).toBe(200);
  });
});
