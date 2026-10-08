'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface M { id: string; originalName: string | null; fileId: string | null; sourceUrl: string | null; isVideoNote: boolean; status: string; sizeBytes: number | null }

export default function MediaPage() {
  const [items, setItems] = useState<M[]>([]);
  const [note, setNote] = useState('');
  const [f, setF] = useState({ originalName: '', fileId: '', sourceUrl: '', isVideoNote: true });
  async function load() {
    const r = await api<{ media: M[] }>('/admin/media');
    if (r.status === 200) setItems((r.json as { media: M[] }).media);
  }
  useEffect(() => { void load(); }, []);
  async function add() {
    const r = await api('/admin/media', { method: 'POST', body: { originalName: f.originalName, fileId: f.fileId || null, sourceUrl: f.sourceUrl || null, isVideoNote: f.isVideoNote, status: 'approved' } });
    if (r.status === 422) { setNote('Manba URL xavfsizlik tekshiruvidan o\'tmadi (ichki tarmoq taqiqlanadi)'); return; }
    setNote(r.status === 200 ? 'Qo\'shildi' : 'Xato/ruxsat yo\'q');
    void load();
  }
  async function attachToBlock(id: string, key: string) {
    const b = prompt('Blok kaliti (masalan intro_video):', key || '');
    if (!b) return;
    const cur = await api<{ blocks: { id: string; key: string; version: number; status: string }[] }>('/admin/blocks?status=all');
    const block = ((cur.json as { blocks: { key: string }[] }).blocks ?? []).find((x) => x.key === b);
    if (!block) { setNote('Blok topilmadi: ' + b); return; }
    const m = items.find((x) => x.id === id);
    const save = await api('/admin/blocks', { method: 'POST', body: { key: b, title: b, body: '(matn o\'zgartirmang - faqat media bog\'landi)', mediaType: m?.isVideoNote ? 'video_note' : 'video', mediaId: m?.fileId, buttons: [] } });
    setNote(save.status === 200 ? 'Media qoralamaga bog\'landi - keyin tasdiqlang' : 'Ruxsat yo\'q');
  }
  return (
    <>
      <h1>Media katalog</h1>
      <p className="muted">Telegram&apos;ga video yuklash alohida: faylni Bot API orqali yuborib file_id olinadi (docs/CONTENT_CHECKLIST.md). Bu yerda file_id ro&apos;yxati.</p>
      {note && <p className="tag">{note}</p>}
      <div className="card row">
        <input style={{ width: 180 }} placeholder="Ism.mp4" value={f.originalName} onChange={(e) => setF({ ...f, originalName: e.target.value })} />
        <input style={{ width: 260 }} placeholder="Telegram file_id" value={f.fileId} onChange={(e) => setF({ ...f, fileId: e.target.value })} />
        <input style={{ width: 220 }} placeholder="(ixtiyoriy) manba URL" value={f.sourceUrl} onChange={(e) => setF({ ...f, sourceUrl: e.target.value })} />
        <label className="row"><input style={{ width: 16 }} type="checkbox" checked={f.isVideoNote} onChange={(e) => setF({ ...f, isVideoNote: e.target.checked })} /> video_note (round)</label>
        <button className="pri" onClick={add}>Qo&apos;shish</button>
      </div>
      <table>
        <thead><tr><th>Ism</th><th>file_id</th><th>Turi</th><th>Holat</th><th></th></tr></thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.id}>
              <td>{m.originalName}</td>
              <td className="muted">{(m.fileId ?? '').slice(0, 24)}...</td>
              <td>{m.isVideoNote ? 'round video' : 'video'}</td>
              <td><span className="tag ok">{m.status}</span></td>
              <td><button onClick={() => attachToBlock(m.id, '')}>blokka biriktirish</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
