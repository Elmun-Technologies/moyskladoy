'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Filters { stageKey?: string; stuckLongerThanDays?: number; consentMarketing?: boolean; hasPhone?: boolean; smsConsent?: boolean }
interface SavedSegment { id: string; name: string; filtersJson: Filters }
interface Delivery { planned: number; sent: number; pending: number; failed: number; skipped: Record<string, number> }
interface Campaign { id: string; name: string; channel: 'telegram' | 'sms'; status: string; scheduledFor: string | null; smsConfirmedAt?: string | null; templateText: string; segmentJson: Filters; stats?: Delivery }
interface Estimate { recipientCount: number; partsPerRecipient: number; unitPriceUzs: number; totalUzs: number }

const STAGES = ['START','EXPERIENCE_VIDEO','CLIENT_REVIEW','METHOD_VIDEO','SURVEY_ROLE','SURVEY_ROLE_TEXT','SURVEY_PROBLEM','SURVEY_PROBLEM_TEXT','SURVEY_PATH','BUSINESS_TYPE','PATH_SELF','PATH_EMPLOYEE','PATH_UNSURE','LESSON_INTRO','TASK','TASK_CORRECT','TASK_WRONG','AFTER_LESSON_VIDEO','STUDENT_REVIEW','CONSENT_REMINDERS','OFFERS','OFFER_COURSE','OFFER_VIDEOS','OFFER_SERVICE','COMPARE','OBJECTION_TIME','OBJECTION_EMPLOYEE','OBJECTION_PRICE','OBJECTION_START','ASK_QUESTION','ANSWER_FOLLOWUP','READINESS','TIMELINE','DECISION_MAKER','DECISION_LEADER','PREFLIGHT_VIDEO','CONSENT_CONTACT','CONTACT_METHOD','PREFERRED_TIME','REVIEW_SUBMIT','SUBMITTED','NOT_READY','MENU','NOTIF_SETTINGS','REMINDERS_OFF','TECH_HELP','UNKNOWN','PURCHASE_START'];

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [segments, setSegments] = useState<SavedSegment[]>([]);
  const [channel, setChannel] = useState<'telegram' | 'sms'>('telegram');
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [stageKey, setStageKey] = useState('');
  const [savedId, setSavedId] = useState('');
  const [scheduled, setScheduled] = useState('');
  const [buttonLabel, setButtonLabel] = useState('');
  const [buttonAction, setButtonAction] = useState('cmd:menu');
  const [preview, setPreview] = useState<{ count: number; sample: { firstName: string | null; stage: string }[] } | null>(null);
  const [estimates, setEstimates] = useState<Record<string, Estimate>>({});
  const [detail, setDetail] = useState<{ campaign: Campaign; stats: Delivery; attribution: Record<string, number> } | null>(null);
  const [smsMissingEnv, setSmsMissingEnv] = useState<string[]>([]);
  const [role, setRole] = useState('');
  const [note, setNote] = useState('');

  const filters: Filters = savedId ? (segments.find((x) => x.id === savedId)?.filtersJson ?? {}) : stageKey ? { stageKey } : {};
  const load = useCallback(async () => {
    const [c, s, me] = await Promise.all([
      api<{ campaigns: Campaign[]; smsMissingEnv?: string[] }>('/admin/campaigns?limit=50'),
      api<{ segments: SavedSegment[] }>('/admin/segments'),
      api<{ role: string }>('/admin/me'),
    ]);
    if (c.status === 200) {
      const j = c.json as { campaigns: Campaign[]; smsMissingEnv?: string[] };
      setCampaigns(j.campaigns ?? []);
      setSmsMissingEnv(j.smsMissingEnv ?? []);
    }
    if (s.status === 200) setSegments((s.json as { segments: SavedSegment[] }).segments ?? []);
    if (me.status === 200) setRole((me.json as { role: string }).role);
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 15000); return () => clearInterval(t); }, [load]);

  async function previewSegment() {
    const r = await api<{ count: number; sample: { firstName: string | null; stage: string }[] }>('/admin/segments/preview', { method: 'POST', body: { channel, filters } });
    if (r.status === 200) { setPreview(r.json as { count: number; sample: { firstName: string | null; stage: string }[] }); setNote('Segment yangilandi.'); }
    else setNote('Segment filtri tekshirilmagan.');
  }
  async function saveSegment() {
    const segmentName = window.prompt('Saqlanadigan segment nomi?');
    if (!segmentName?.trim()) return;
    const r = await api('/admin/segments', { method: 'POST', body: { name: segmentName.trim(), filters } });
    setNote(r.status === 201 ? 'Segment saqlandi.' : 'Segmentni saqlash rad etildi.');
    void load();
  }
  async function createCampaign() {
    if (!name.trim() || !text.trim()) { setNote('Nomi va matnni kiriting.'); return; }
    const buttons = channel === 'telegram' && buttonLabel.trim() ? [{ label: buttonLabel.trim(), action: buttonAction }] : [];
    const body = {
      name: name.trim(), channel, filters, templateText: text, buttons,
      scheduledFor: scheduled ? new Date(scheduled).toISOString() : null,
    };
    const r = await api<{ campaign?: Campaign; error?: string }>('/admin/campaigns', { method: 'POST', body });
    if (r.status === 201) {
      setNote('Kampaniya qoralama/rejaga saqlandi.'); setName(''); setText(''); setScheduled(''); setButtonLabel(''); setPreview(null); void load();
    } else setNote('Yaratilmadi: ' + ((r.json as { error?: string }).error ?? 'tekshiruv xatosi'));
  }
  async function estimate(c: Campaign): Promise<Estimate | null> {
    const r = await api<Estimate>('/admin/sms/estimate', { method: 'POST', body: { campaignId: c.id } });
    if (r.status !== 200) { setNote('SMS hisob-kitobi olinmadi.'); return null; }
    const e = r.json as Estimate; setEstimates((old) => ({ ...old, [c.id]: e })); return e;
  }
  async function start(c: Campaign) {
    if (role !== 'admin') return setNote('Kampaniyani faqat admin boshqaradi.');
    if (c.channel === 'sms' && !c.smsConfirmedAt) {
      const e = await estimate(c); if (!e) return;
      if (!window.confirm(`${e.recipientCount} ta raqam × ${e.partsPerRecipient} qism = ${e.totalUzs.toLocaleString()} UZS. Davom etasizmi?`)) return;
      const confirmed = await api('/admin/sms/confirm', { method: 'POST', body: { campaignId: c.id, expectedRecipientCount: e.recipientCount, expectedCostUzs: e.totalUzs } });
      if (confirmed.status !== 200) { setNote('Tasdiq xato yoki segment soni o‘zgardi; qayta hisoblang.'); return; }
      // Confirming a scheduled campaign must not discard its planned send time.
      if (c.status === 'scheduled') {
        setNote('SMS narxi tasdiqlandi; kampaniya belgilangan vaqtda boshlanadi.');
        void load();
        return;
      }
    }
    const r = await api('/admin/campaigns/' + c.id + '/start', { method: 'POST' });
    setNote(r.status === 200 ? 'Kampaniya ishga tushdi.' : 'Ishga tushmadi: ' + ((r.json as { error?: string }).error ?? 'xato'));
    void load();
  }
  async function action(c: Campaign, what: 'pause' | 'resume' | 'cancel') {
    if (role !== 'admin') return setNote('Kampaniyani faqat admin boshqaradi.');
    if (what === 'cancel' && !window.confirm('Kampaniyani va navbatdagi xabarlarni bekor qilasizmi?')) return;
    const r = await api('/admin/campaigns/' + c.id + '/' + what, { method: 'POST' });
    setNote(r.status === 200 ? 'Holat yangilandi.' : 'Amal rad etildi: ' + ((r.json as { error?: string }).error ?? 'xato'));
    void load();
  }
  async function testSend(c: Campaign) {
    if (role !== 'admin') return setNote('Test yuborishni faqat admin bajaradi.');
    const target = window.prompt(c.channel === 'telegram' ? 'Faol marketing roziligiga ega Telegram foydalanuvchisining ID raqami:' : 'SMS roziligi faol bo‘lgan foydalanuvchining +998 telefoni:');
    if (!target) return;
    const body = c.channel === 'telegram' ? { telegramId: Number(target) } : { phone: target };
    const r = await api('/admin/campaigns/' + c.id + '/test', { method: 'POST', body });
    setNote(r.status === 202 ? 'Test xabari navbatga qo‘yildi.' : 'Test navbatga qo‘yilmadi.');
    void load();
  }
  async function showDetail(c: Campaign) {
    const r = await api<{ campaign: Campaign; stats: Delivery; attribution: Record<string, number> }>('/admin/campaigns/' + c.id);
    if (r.status === 200) setDetail(r.json as { campaign: Campaign; stats: Delivery; attribution: Record<string, number> });
  }

  return (
    <>
      <h1>Kampaniyalar</h1>
      <p className="muted">Telegram va SMS kampaniyalari. Navbat/holat 15 soniyada yangilanadi. SMS uchun narxni admin tasdiqlashi shart.</p>
      {note && <p className="tag">{note}</p>}
      {smsMissingEnv.length > 0 && <div className="card"><b>SMS yuborish o‘chiq.</b> Fly secrets’da {smsMissingEnv.join(', ')} nomlarini sozlang; maxfiy qiymatlarni panelga kiritmang.</div>}

      <div className="card">
        <h2>Yangi kampaniya</h2>
        <div className="grid">
          <div><label>Nomi</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Masalan, darsga taklif" /></div>
          <div><label>Kanali</label><select value={channel} onChange={(e) => { setChannel(e.target.value as 'telegram' | 'sms'); setPreview(null); }}><option value="telegram">Telegram</option><option value="sms">SMS</option></select></div>
          <div><label>Saqlangan segment</label><select value={savedId} onChange={(e) => { setSavedId(e.target.value); setStageKey(''); setPreview(null); }}><option value="">Qo‘lda filtrlash</option>{segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div><label>Joriy bosqich filtri</label><select disabled={!!savedId} value={stageKey} onChange={(e) => { setStageKey(e.target.value); setPreview(null); }}><option value="">Barcha bosqichlar</option>{STAGES.map((x) => <option key={x} value={x}>{x}</option>)}</select></div>
          <div><label>Rejalashtirish (ixtiyoriy)</label><input type="datetime-local" value={scheduled} onChange={(e) => setScheduled(e.target.value)} /></div>
        </div>
        <label>Xabar matni ({'{{ism}}'}, {'{{bosqich}}'} o‘rinbosarlari)</label>
        <textarea rows={4} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Assalomu alaykum, {{ism}}! Sizga yangi ma’lumot…" />
        {channel === 'telegram' && <div className="grid">
          <div><label>Tugma nomi (ixtiyoriy)</label><input value={buttonLabel} onChange={(e) => setButtonLabel(e.target.value)} placeholder="Menyuni ochish" /></div>
          <div><label>Tugma amali</label><select value={buttonAction} onChange={(e) => setButtonAction(e.target.value)}><option value="cmd:menu">Menyu</option><option value="goto:OFFERS">Takliflarga o‘tish</option><option value="goto:LESSON_INTRO">Sinov darsiga o‘tish</option></select></div>
        </div>}
        <div className="row" style={{ marginTop: 10 }}>
          <button onClick={() => void previewSegment()}>Segmentni ko‘rish</button>
          <button onClick={() => void saveSegment()}>Segmentni saqlash</button>
          <button className="pri" disabled={role !== 'admin'} onClick={() => void createCampaign()}>Kampaniyani saqlash</button>
          {preview && <span className="tag ok">mos keladi: {preview.count}</span>}
        </div>
        {preview && preview.sample.length > 0 && <p className="muted">Namuna: {preview.sample.map((x) => `${x.firstName ?? 'Ismsiz'} (${x.stage})`).join(', ')}</p>}
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>Kampaniyalar ro‘yxati</h2>
        <table><thead><tr><th>Nomi</th><th>Kanal</th><th>Holat</th><th>Jo‘natilgan</th><th>Navbat</th><th>Xato</th><th>Reja</th><th>Amallar</th></tr></thead>
          <tbody>{campaigns.map((c) => <tr key={c.id}>
            <td>{c.name}<br /><span className="muted" style={{ fontSize: 11 }}>{c.id.slice(0, 10)}</span></td><td>{c.channel}</td>
            <td><span className={'tag ' + (c.status === 'running' ? 'ok' : c.status === 'cancelled' ? 'bad' : 'warn')}>{c.status}</span>{c.channel === 'sms' && !c.smsConfirmedAt && <div className="muted">narx tasdiqlanmagan</div>}</td>
            <td>{c.stats?.sent ?? 0}/{c.stats?.planned ?? 0}</td><td>{c.stats?.pending ?? 0}</td><td>{c.stats?.failed ?? 0}</td><td>{c.scheduledFor ? new Date(c.scheduledFor).toLocaleString() : '—'}</td>
            <td><div className="row">
              {['draft','paused','scheduled'].includes(c.status) && <button disabled={role !== 'admin'} onClick={() => void start(c)}>{c.channel === 'sms' && !c.smsConfirmedAt ? 'Hisobla/tasdiqla va boshlash' : 'Boshlash'}</button>}
              {['running','scheduled'].includes(c.status) && <button disabled={role !== 'admin'} onClick={() => void action(c, 'pause')}>To‘xtatib turish</button>}
              {c.status === 'paused' && <button disabled={role !== 'admin'} onClick={() => void action(c, 'resume')}>Davom ettirish</button>}
              {!['done','cancelled'].includes(c.status) && <button disabled={role !== 'admin'} onClick={() => void action(c, 'cancel')}>Bekor qilish</button>}
              <button disabled={role !== 'admin'} onClick={() => void testSend(c)}>Test</button>
              <button onClick={() => void showDetail(c)}>Hisobot</button>
              <a className="tag" href={'/api/admin/campaigns/' + c.id + '/export.csv'}>CSV</a>
            </div></td>
          </tr>)}</tbody>
        </table>
      </div>
      {detail && <div className="card">
        <div className="row"><h2 style={{ marginRight: 'auto' }}>{detail.campaign.name} — hisobot</h2><button onClick={() => setDetail(null)}>Yopish</button></div>
        <div className="grid">
          <div className="kpi"><b>{detail.stats.sent}</b><span>Yuborildi</span></div><div className="kpi"><b>{detail.stats.pending}</b><span>Navbatda</span></div><div className="kpi"><b>{detail.attribution.clicks ?? 0}</b><span>Bosish</span></div><div className="kpi"><b>{detail.attribution.replies ?? 0}</b><span>Javob (48 soat)</span></div><div className="kpi"><b>{detail.attribution.linkOpens ?? 0}</b><span>Havola ochish</span></div>
        </div>
        {Object.entries(detail.stats.skipped ?? {}).length > 0 && <p className="muted">O‘tkazib yuborildi: {Object.entries(detail.stats.skipped).map(([k,v]) => `${k}: ${v}`).join(' · ')}</p>}
      </div>}
    </>
  );
}
