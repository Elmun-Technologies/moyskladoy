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
  mediaType: 'video_note' | 'video' | 'image' | 'text' | null;
  mediaId: string | null;
  requiresMedia: boolean;
  textFallbackAllowed: boolean;
  buttons: { label: string; action: string; hidden?: boolean }[];
  videoScript?: string | null;
  showCondition?: {
    lessonLinkRequired?: boolean;
    requiresVisibleProducts?: boolean;
    requiresAnswer?: string;
    skipIfMarketingConsent?: boolean;
    requiredSettings?: string[];
    onlyStages?: string[];
  } | null;
}
interface MediaItem {
  id: string;
  originalName: string | null;
  fileId: string | null;
  isVideoNote: boolean;
  status: string;
}
interface BtnDraft {
  label: string;
  action: string;
  hidden: boolean;
}

const ACTION_KINDS: [string, string][] = [
  ['goto', 'Sahnaga o\'tish'],
  ['answer', 'Javob yozish'],
  ['task', 'Vazifa tanlash'],
  ['lesson', 'Sinov darsi'],
  ['consent', 'Rozilik'],
  ['contact', 'Kontakt'],
  ['submit', 'Aritiga yuborish'],
  ['notif', 'Bildirishnoma sozlamasi'],
  ['cmd', 'Buyruq'],
];

function parseAction(a: string): { kind: string; rest: string } {
  const i = a.indexOf(':');
  return i < 0 ? { kind: 'goto', rest: a } : { kind: a.slice(0, i), rest: a.slice(i + 1) };
}

export default function Content() {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [filter, setFilter] = useState<'all' | 'draft' | 'approved'>('all');
  const [edit, setEdit] = useState<Block | null>(null);
  const [btns, setBtns] = useState<BtnDraft[]>([]);
  const [stageOptions, setStageOptions] = useState<string[]>([]);
  const [cond, setCond] = useState<NonNullable<Block['showCondition']>>({});
  const [settingsCsv, setSettingsCsv] = useState('');
  const [preview, setPreview] = useState<{ text: string; warning: string | null } | null>(null);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    const r = await api<{ blocks: Block[]; missingMedia: string[] }>('/admin/blocks?status=' + filter);
    if (r.status === 200) {
      setBlocks((r.json as { blocks: Block[] }).blocks);
      setMissing((r.json as { missingMedia: string[] }).missingMedia ?? []);
    }
    const m = await api<{ media: MediaItem[] }>('/admin/media');
    if (m.status === 200) setMedia((m.json as { media: MediaItem[] }).media);
  }, [filter]);
  useEffect(() => {
    void load();
    api<{ blocks: Block[] }>('/admin/blocks?status=approved').then((r) => {
      if (r.status === 200) setStageOptions([...new Set(((r.json as { blocks: Block[] }).blocks ?? []).map((b) => b.stage).filter(Boolean) as string[])]);
    });
  }, [load]);

  function openEditor(b: Block) {
    setEdit({ ...b });
    setBtns((b.buttons ?? []).map((x) => ({ label: x.label, action: x.action, hidden: x.hidden === true })));
    setCond(b.showCondition ?? {});
    setSettingsCsv((b.showCondition?.requiredSettings ?? []).join(', '));
    setPreview(null);
    setErrors([]);
    setNote('');
  }
  function setBtn(i: number, patch: Partial<BtnDraft>) {
    setBtns(btns.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }
  function moveBtn(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= btns.length) return;
    const arr = [...btns];
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    setBtns(arr);
  }
  async function save() {
    if (!edit) return;
    setErrors([]);
    const r = await api<{ id?: string; error?: string; details?: string[] }>('/admin/blocks', {
      method: 'POST',
      body: {
        key: edit.key,
        stage: edit.stage,
        title: edit.title,
        body: edit.body,
        mediaType: edit.mediaType,
        mediaId: edit.mediaId || null,
        requiresMedia: edit.requiresMedia,
        textFallbackAllowed: edit.textFallbackAllowed,
        videoScript: edit.videoScript ?? null,
        buttons: btns,
        showCondition: (() => {
          const sc: Record<string, unknown> = {};
          if (cond.lessonLinkRequired) sc.lessonLinkRequired = true;
          if (cond.requiresVisibleProducts) sc.requiresVisibleProducts = true;
          if (cond.skipIfMarketingConsent) sc.skipIfMarketingConsent = true;
          if (cond.requiresAnswer) sc.requiresAnswer = cond.requiresAnswer;
          if (cond.onlyStages?.length) sc.onlyStages = cond.onlyStages;
          const rs = settingsCsv.split(',').map((x) => x.trim()).filter(Boolean);
          if (rs.length) sc.requiredSettings = rs;
          return Object.keys(sc).length > 0 ? sc : null;
        })(),
      },
    });
    if (r.status === 422) {
      const j = r.json as { details?: string[]; error?: string; hint?: string };
      setErrors([...(j.details ?? []), j.hint ?? ''].filter(Boolean));
      setNote('Saqlanmadi - quyidagi xatolarni tuzating');
      return;
    }
    if (r.status !== 200) {
      setNote('Saqlash rad etildi (ruxsat yoki validatsiya)');
      return;
    }
    setNote('DRAFT saqlandi - tasdiqlash talab qilinadi');
    void load();
  }
  async function doPreview(b: Block) {
    const r = await api<{ ok: boolean; preview?: { text: string; mediaWarning: string | null } }>('/admin/blocks/' + b.id + '/preview');
    if (r.status === 200) setPreview({ text: (r.json as { preview: { text: string } }).preview.text, warning: (r.json as { preview: { mediaWarning: string | null } }).preview.mediaWarning });
  }
  async function approve(b: Block) {
    const r = await api('/admin/blocks/' + b.id + '/approve', { method: 'POST' });
    if (r.status === 409) {
      setNote("Media yetishmaydi - avval material bog'lang yoki matn fallback'ga ruxsat bering");
      return;
    }
    setNote(r.status === 200 ? 'Tasdiqlandi (yangi versiya)' : "Ruxsat yo'q yoki xato");
    void load();
  }
  const mediaForType = media.filter((m) => m.fileId && (edit?.mediaType !== 'video_note' || m.isVideoNote));

  return (
    <>
      <h1>Kontent bloklari</h1>
      {missing.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--warn)' }}>
          <b>Diqqat:</b> tasdiqlangan, lekin majburiy materiali yo&apos;q bloklar:{' '}
          {missing.map((m) => (
            <span key={m} className="tag warn" style={{ marginRight: 4 }}>{m}</span>
          ))}
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
          <thead>
            <tr><th>Kalit</th><th>Bosqich</th><th>Sarlavha</th><th>Matn</th><th>Media</th><th>Tugmalar</th><th>Holat</th><th></th></tr>
          </thead>
          <tbody>
            {blocks.map((b) => (
              <tr key={b.id}>
                <td>{b.key} <span className="muted">v{b.version}</span></td>
                <td>{b.stage ?? '-'}</td>
                <td>{b.title}</td>
                <td style={{ maxWidth: 260 }}>{b.body.slice(0, 70)}{b.body.length > 70 ? '...' : ''}</td>
                <td>
                  {b.mediaId ? <span className="tag ok">{b.mediaType}</span> : b.requiresMedia ? <span className="tag bad">yo&apos;q!</span> : <span className="muted">{b.mediaType ?? '-'}</span>}
                </td>
                <td>
                  {(b.buttons ?? []).slice(0, 3).map((x) => (
                    <span key={x.action} className="tag" style={{ marginRight: 3, opacity: x.hidden ? 0.35 : 1, textDecoration: x.hidden ? 'line-through' : 'none' }}>{x.label}</span>
                  ))}
                  {(b.buttons ?? []).length > 3 ? <span className="muted">+{b.buttons.length - 3}</span> : null}
                </td>
                <td><span className={'tag ' + (b.status === 'approved' ? 'ok' : 'warn')}>{b.status}</span></td>
                <td className="row">
                  <button onClick={() => openEditor(b)}>tahrir</button>
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
          <h2>Tahrir: {edit.key} <span className="muted">(media va tugmalar nazorati)</span></h2>
          <label>Sarlavha</label>
          <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
          <label>Matn (bot yuboradigan xabar)</label>
          <textarea rows={6} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
          <label>Kamera matni (video skripti) - bot uni yubormaydi, faqat panelda saqlanadi</label>
          <textarea rows={4} value={edit.videoScript ?? ''} onChange={(e) => setEdit({ ...edit, videoScript: e.target.value })} />

          <h2>Media turi</h2>
          <div className="row">
            <select style={{ width: 190 }} value={edit.mediaType ?? 'text'} onChange={(e) => setEdit({ ...edit, mediaType: e.target.value as 'video_note', mediaId: null })}>
              <option value="text">Matn (media yo&apos;q)</option>
              <option value="video_note">Dumaloq video (video_note)</option>
              <option value="video">Video fayl</option>
              <option value="image">Rasm</option>
            </select>
            {edit.mediaType !== 'text' && (
              <select style={{ width: 260 }} value={edit.mediaId ?? ''} onChange={(e) => setEdit({ ...edit, mediaId: e.target.value || null })}>
                <option value="">- katalogdan tanlang -</option>
                {mediaForType.map((m) => (
                  <option key={m.id} value={m.fileId ?? ''}>
                    {m.originalName} {m.isVideoNote ? '(round)' : ''} {m.fileId ? '' : '- file_id yo\'q'}
                  </option>
                ))}
              </select>
            )}
            <input style={{ width: 260 }} placeholder="yoki file_id ni qo&apos;lda kiriting" value={edit.mediaId ?? ''} onChange={(e) => setEdit({ ...edit, mediaId: e.target.value || null })} />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <label className="row">
              <input style={{ width: 16 }} type="checkbox" checked={edit.requiresMedia} onChange={(e) => setEdit({ ...edit, requiresMedia: e.target.checked })} /> media majburiy
            </label>
            <label className="row">
              <input style={{ width: 16 }} type="checkbox" checked={edit.textFallbackAllowed} onChange={(e) => setEdit({ ...edit, textFallbackAllowed: e.target.checked })} /> media bo&apos;lmasa matn yuborilsin
            </label>
            {!edit.mediaId && edit.mediaType !== 'text' && <span className="tag warn">Media tanlanmagan</span>}
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            Fayl yo&apos;qmi? <a href="/panel/media">Media bo&apos;limiga yuklang</a> - round video uchun mp4 60s gacha.
          </p>

          <h2>Ko&apos;rsatish shartlari</h2>
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            <label className="row">
              <input style={{ width: 16 }} type="checkbox" checked={cond.requiredSettings !== undefined || cond.lessonLinkRequired === true} onChange={() => undefined} disabled /> shart(alar) qo&apos;yilgan
            </label>
            <label className="row" title="Settings&apos;dagi kalitlar to&apos;ldirilmaguncha bo&apos;lim umuman ochilmaydi">
              <input style={{ width: 16 }} type="checkbox" checked={(cond.requiredSettings?.length ?? 0) > 0} onChange={(e) => { if (!e.target.checked) setSettingsCsv(''); else if (!settingsCsv) setSettingsCsv('lesson_link'); }} /> settings kalitlari shart
            </label>
            <label className="row" title="Foydalanuvchida tasdiqlangan narxli mahsulot bo&apos;lmasa taklif tugmalari yashirin">
              <input style={{ width: 16 }} type="checkbox" checked={cond.requiresVisibleProducts === true} onChange={(e) => setCond({ ...cond, requiresVisibleProducts: e.target.checked })} /> faqat tasdiqlangan takliflar bo&apos;lsa
            </label>
            <label className="row" title="Marketing roziligi allaqachon bo&apos;lsa bu bosqich o&apos;tkaziladi">
              <input style={{ width: 16 }} type="checkbox" checked={cond.skipIfMarketingConsent === true} onChange={(e) => setCond({ ...cond, skipIfMarketingConsent: e.target.checked })} /> rozilik bo&apos;lsa o&apos;tkazilsin
            </label>
          </div>
          <label>Settings kalitlari (vergul bilan) - qiymati to&apos;ldirilmagacha bo&apos;lim ishlamaydi</label>
          <input value={settingsCsv} onChange={(e) => setSettingsCsv(e.target.value)} placeholder="lesson_link, terms_course_url, terms_videos_url" />

          <h2>Tugmalar ({btns.length}/12)</h2>
          {btns.map((x, i) => {
            const { kind, rest } = parseAction(x.action);
            return (
              <div key={i} className="row" style={{ marginBottom: 6, opacity: x.hidden ? 0.55 : 1 }}>
                <input style={{ width: 170 }} placeholder="Tugma matni" value={x.label} onChange={(e) => setBtn(i, { label: e.target.value })} />
                <select style={{ width: 150 }} value={kind} onChange={(e) => {
                  const k = e.target.value;
                  const def = k === 'goto' ? 'goto:' + (stageOptions[0] ?? 'MENU') : k === 'answer' ? 'answer:role=self' : k === 'task' ? 'task:right' : k === 'lesson' ? 'lesson:watched' : k === 'consent' ? 'consent:grant_marketing' : k === 'contact' ? 'contact:telegram' : k === 'submit' ? 'submit:send' : k === 'notif' ? 'notif:marketing' : 'cmd:menu';
                  setBtn(i, { action: def });
                }}>
                  {ACTION_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                {kind === 'goto' ? (
                  <select style={{ width: 210 }} value={x.action.replace(/^goto:/, '')} onChange={(e) => setBtn(i, { action: 'goto:' + e.target.value })}>
                    {stageOptions.map((st) => <option key={st} value={st}>{st}</option>)}
                  </select>
                ) : (
                  <input style={{ width: 210 }} value={rest} onChange={(e) => setBtn(i, { action: kind + ':' + e.target.value })} placeholder={kind === 'answer' ? 'field=value' : kind === 'cmd' ? 'menu|stop|ask|back|edit' : kind === 'consent' ? 'grant_marketing|no_reminders|grant_contact|decline|revoke_marketing' : kind === 'notif' ? 'marketing|lessons|off|on' : kind === 'contact' ? 'phone|telegram' : kind === 'lesson' ? 'open|watched|resend|remind_tomorrow' : kind === 'submit' ? 'send|edit' : 'right|wrong|help'} />
                )}
                <label className="row" title="O'chirilgan tugma botda ko'rsatilmaydi, lekin saqlanadi">
                  <input style={{ width: 15 }} type="checkbox" checked={x.hidden} onChange={(e) => setBtn(i, { hidden: e.target.checked })} /> o&apos;chiq
                </label>
                <button onClick={() => moveBtn(i, -1)}>Yuqori</button>
                <button onClick={() => moveBtn(i, 1)}>Past</button>
                <button onClick={() => setBtns(btns.filter((_, j) => j !== i))}>olib tashlash</button>
              </div>
            );
          })}
          <div className="row">
            <button onClick={() => setBtns([...btns, { label: 'Yangi tugma', action: 'goto:' + (stageOptions[0] ?? 'MENU'), hidden: false }])}>+ Tugma qo&aposshish</button>
            <button className="pri" onClick={save}>Saqlash (yangi qoralama)</button>
            <button onClick={() => setEdit(null)}>Bekor</button>
          </div>
          {errors.length > 0 && (
            <div className="card err" style={{ background: '#fff5f5' }}>
              {errors.map((e, i) => <div key={i}>* {e}</div>)}
            </div>
          )}
          {preview && (
            <div className="card" style={{ background: '#f0f6ff' }}>
              <b>Oldindan ko&apos;rish:</b>
              <p style={{ whiteSpace: 'pre-wrap' }}>{preview.text}</p>
              {btns.filter((x) => !x.hidden).map((bt) => (
                <span key={bt.action} className="tag" style={{ marginRight: 4 }}>{bt.label}</span>
              ))}
              {preview.warning && <p className="err">{preview.warning}</p>}
            </div>
          )}
        </div>
      )}
    </>
  );
}
