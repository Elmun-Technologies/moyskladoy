'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Block {
  id: string;
  key: string;
  version: number;
  stage: string | null;
  title: string;
  body: string;
  status: 'draft' | 'approved';
  mediaType: string | null;
  mediaId: string | null;
  requiresMedia: boolean;
  textFallbackAllowed: boolean;
  buttons: { label: string; action: string }[];
}

export default function Content() {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [filter, setFilter] = useState<'all' | 'draft' | 'approved'>('all');
  const [edit, setEdit] = useState<Block | null>(null);
  const [preview, setPreview] = useState<{ text: string; warning: string | null } | null>(null);
  const [note, setNote] = useState('');
  const load = useCallback(async () => {
    const r = await api<{ blocks: Block[]; missingMedia: string[] }>('/admin/blocks?status=' + filter);
    if (r.status === 200) { setBlocks((r.json as { blocks: Block[] }).blocks); setMissing((r.json as { missingMedia: string[] }).missingMedia ?? []); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);
  async function save() {
    if (!edit) return;
    const r = await api<{ id?: string }>('/admin/blocks', { method: 'POST', body: { key: edit.key, stage: edit.stage, title: edit.title, body: edit.body, mediaType: edit.mediaType, mediaId: edit.mediaId, requiresMedia: edit.requiresMedia, textFallbackAllowed: edit.textFallbackAllowed, buttons: edit.buttons } });
    setNote(r.status === 200 ? 'DRAFT saqlandi - tasdiqlash talab qilinadi' : 'Saqlash rad etildi (ruxsat?)');
    void load();
  }
  async function doPreview(b: Block) {
    const r = await api<{ ok: boolean; preview?: { text: string; mediaWarning: string | null } }>('/admin/blocks/' + b.id + '/preview');
    if (r.status === 200) setPreview({ text: (r.json as { preview: { text: string } }).preview.text, warning: (r.json as { preview: { mediaWarning: string | null } }).preview.mediaWarning });
  }
  async function approve(b: Block) {
    const r = await api('/admin/blocks/' + b.id + '/approve', { method: 'POST' });
    if (r.status === 409) { setNote('Media yetishmaydi - avval material boglang yoki matn fallback\'ga ruxsat bering'); return; }
    setNote(r.status === 200 ? 'Tasdiqlandi (yangi versiya)' : 'Ruxsat yo\'q yoki xato');
    void load();
  }
  return (
    <>
      <h1>Kontent bloklari</h1>
      {missing.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--warn)' }}>
          <b>Diqqat:</b> quyidagi tasdiqlangan bloklarda majburiy material yo&apos;q: {missing.map((m) => <span key={m} className="tag warn" style={{ marginRight: 4 }}>{m}</span>)}
        </div>
      )}
      <div className="row" style={{ marginBottom: 10 }}>
        <select style={{ width: 160 }} value={filter} onChange={(e) => setFilter(e.target.value as 'all')}>
          <option value="all">hammasi</option>
          <option value="draft">faqat qoralama</option>
          <option value="approved">tasdiqlangan</option>
        </select>
        <span className="muted">{note}</span>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Kalit</th><th>Bosqich</th><th>Sarlavha</th><th>Matn</th><th>Media</th><th>Holat</th><th></th></tr></thead>
          <tbody>
            {blocks.map((b) => (
              <tr key={b.id}>
                <td>{b.key} <span className="muted">v{b.version}</span></td>
                <td>{b.stage ?? '-'}</td>
                <td>{b.title}</td>
                <td style={{ maxWidth: 320 }}>{b.body.slice(0, 90)}{b.body.length > 90 ? '...' : ''}</td>
                <td>{b.mediaId ? <span className="tag ok">bor</span> : b.requiresMedia ? <span className="tag bad">yo&apos;q!</span> : <span className="muted">-</span>}</td>
                <td><span className={'tag ' + (b.status === 'approved' ? 'ok' : 'warn')}>{b.status}</span></td>
                <td className="row">
                  <button onClick={() => { setEdit({ ...b }); setPreview(null); }}>tahrir</button>
                  <button onClick={() => doPreview(b)}>ko&apos;rish</button>
                  {b.status === 'draft' && <button className="pri" onClick={() => approve(b)}>tasdiqlash</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <div className="card">
          <h2>Tahrir: {edit.key}</h2>
          <label>Sarlavha</label>
          <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
          <label>Matn (bot yuboradigan xabar)</label>
          <textarea rows={6} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
          <div className="row">
            <label style={{ flex: 1 }}>Media file_id (Telegram)</label>
            <input value={edit.mediaId ?? ''} onChange={(e) => setEdit({ ...edit, mediaId: e.target.value || null })} placeholder="bo'sh = material yo'q" />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <label><input style={{ width: 16 }} type="checkbox" checked={edit.requiresMedia} onChange={(e) => setEdit({ ...edit, requiresMedia: e.target.checked })} /> media majburiy</label>
            <label><input style={{ width: 16 }} type="checkbox" checked={edit.textFallbackAllowed} onChange={(e) => setEdit({ ...edit, textFallbackAllowed: e.target.checked })} /> media bo'lmasa matn yuborilsin</label>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="pri" onClick={save}>Saqlash (yangi qoralama)</button>
            <button onClick={() => setEdit(null)}>Bekor</button>
          </div>
          {preview && (
            <div className="card" style={{ background: '#f0f6ff' }}>
              <b>Oldindan ko&apos;rish:</b>
              <p style={{ whiteSpace: 'pre-wrap' }}>{preview.text}</p>
              {edit.buttons.map((bt) => <span key={bt.action} className="tag" style={{ marginRight: 4 }}>{bt.label}</span>)}
              {preview.warning && <p className="err">{preview.warning}</p>}
            </div>
          )}
        </div>
      )}
    </>
  );
}
