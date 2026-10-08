'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface M {
  id: string;
  originalName: string | null;
  fileId: string | null;
  sourceUrl: string | null;
  isVideoNote: boolean;
  mimeType: string | null;
  sizeBytes: number | null;
  status: string;
}
interface Blk {
  key: string;
  stage: string | null;
  mediaType: string | null;
  mediaId: string | null;
  title: string;
  body: string;
  buttons: { label: string; action: string; hidden?: boolean }[];
  requiresMedia: boolean;
  textFallbackAllowed: boolean;
  status: string;
}

function fileToB64(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = rej;
    r.readAsDataURL(f);
  });
}

export default function MediaPage() {
  const [items, setItems] = useState<M[]>([]);
  const [blocks, setBlocks] = useState<Blk[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(true);
  const [chatId, setChatId] = useState('');
  const [attach, setAttach] = useState<{ media: M; blockKey: string } | null>(null);

  async function load() {
    const r = await api<{ media: M[] }>('/admin/media');
    if (r.status === 200) setItems((r.json as { media: M[] }).media);
    const b = await api<{ blocks: Blk[] }>('/admin/blocks?status=approved');
    if (b.status === 200) setBlocks((b.json as { blocks: Blk[] }).blocks);
  }
  useEffect(() => {
    void load();
  }, []);

  async function upload(f: File) {
    setBusy(true);
    setNote('');
    const dataBase64 = await fileToB64(f);
    const r = await api<{ via?: string; fileId?: string | null; note?: string; error?: string; reason?: string; hint?: string }>('/admin/media/upload', {
      method: 'POST',
      body: {
        originalName: f.name,
        mime: f.type || 'application/octet-stream',
        dataBase64,
        isVideoNote: round,
        targetChatId: chatId ? Number(chatId) : null,
      },
    });
    setBusy(false);
    const j = r.json as { via?: string; fileId?: string | null; note?: string; error?: string; reason?: string; hint?: string };
    if (r.status === 200 && j.via === 'telegram') setNote("Yuklandi va file_id olindi: " + String(j.fileId).slice(0, 22) + '... - endi blokka boglang');
    else if (r.status === 200) setNote('Fayl saqlandi: ' + (j.note ?? 'file_id keyin boglanadi'));
    else if (r.status === 422) setNote("Rad etildi (" + String(j.error) + '). ' + (j.hint ?? ''));
    else setNote("Xato: " + (j.reason ?? j.error ?? 'noma\'lum'));
    void load();
  }

  async function doAttach() {
    if (!attach) return;
    const bl = blocks.find((x) => x.key === attach.blockKey);
    if (!bl) {
      setNote('Blok topilmadi');
      return;
    }
    const r = await api('/admin/blocks', {
      method: 'POST',
      body: {
        key: bl.key,
        stage: bl.stage,
        title: bl.title,
        body: bl.body,
        mediaType: attach.media.isVideoNote ? 'video_note' : attach.media.mimeType?.startsWith('image/') ? 'image' : 'video',
        mediaId: attach.media.fileId ?? '',
        requiresMedia: true,
        textFallbackAllowed: bl.textFallbackAllowed,
        buttons: bl.buttons,
      },
    });
    if (r.status === 200) setNote("Media qoralamaga bog'landi - Kontent bo'limida tasdiqlang");
    else if (r.status === 422) setNote("Bog'lab bo'lmadi: media'da file_id yo'q yoki validatsiya xatosi");
    else setNote("Ruxsat yo'q");
    setAttach(null);
  }

  return (
    <>
      <h1>Media katalog va yuklash</h1>
      <p className="muted">
        Round video = dumaloq video_note (Telegram talabi: mp4, 60 sekundgacha). Token va chat_id berilsa - fayl
        Telegram&apos;ga yuborilib <b>file_id avtomatik olinadi</b>; bo&apos;lmasa fayl serverda saqlanadi.
        Instagram&apos;dan avtomatik yuklash qasddan yo&apos;q.
      </p>
      <div className="card">
        <div className="row">
          <input type="file" accept="video/mp4,video/quicktime,image/jpeg,image/png" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <label className="row" title="Round video_note sifatida yuborish">
            <input style={{ width: 15 }} type="checkbox" checked={round} onChange={(e) => setRound(e.target.checked)} /> dumaloq video
          </label>
          <input style={{ width: 200 }} placeholder="target chat_id (ixtiyoriy)" value={chatId} onChange={(e) => setChatId(e.target.value)} />
          {busy && <span className="muted">yuklanmoqda...</span>}
        </div>
        {note && <p className="tag">{note}</p>}
      </div>

      <table>
        <thead>
          <tr><th>Ism</th><th>Turi</th><th>file_id</th><th>Holat</th><th>O&apos;lcham</th><th></th></tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.id}>
              <td>{m.originalName}</td>
              <td>{m.isVideoNote ? 'round video' : m.mimeType?.startsWith('image/') ? 'rasm' : 'video'}</td>
              <td className="muted">{m.fileId ? m.fileId.slice(0, 26) + '...' : <span className="tag bad">yo&apos;q</span>}</td>
              <td><span className={'tag ' + (m.status === 'approved' ? 'ok' : 'warn')}>{m.status}</span></td>
              <td className="muted">{m.sizeBytes ? Math.round(m.sizeBytes / 1024) + ' KB' : '-'}</td>
              <td>
                {m.fileId ? (
                  <button onClick={() => setAttach({ media: m, blockKey: '' })}>blokka bog&apos;lash</button>
                ) : (
                  <span className="muted" style={{ fontSize: 11 }}>file_id kutilmoqda</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {attach && (
        <div className="card">
          <h2>Blokka bog&apos;lash: {attach.media.originalName}</h2>
          <div className="row">
            <select style={{ width: 280 }} value={attach.blockKey} onChange={(e) => setAttach({ ...attach, blockKey: e.target.value })}>
              <option value="">- blok tanlang -</option>
              {blocks.map((b) => (
                <option key={b.key} value={b.key}>{b.key} ({b.stage ?? '-'})</option>
              ))}
            </select>
            <button className="pri" onClick={doAttach} disabled={!attach.blockKey}>Bog&apos;lash (qoralama yaratadi)</button>
            <button onClick={() => setAttach(null)}>Bekor</button>
          </div>
          <p className="muted">Bog&apos;lashdan so&apos&apos;ng Kontent bo&apos;limida versiyani tasdiqlang (approve).</p>
        </div>
      )}
    </>
  );
}
