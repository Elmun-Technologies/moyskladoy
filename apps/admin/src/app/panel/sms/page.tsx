'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Estimate { recipientCount: number; partsPerRecipient: number; unitPriceUzs: number; totalUzs: number; isAccountQuote?: boolean }
interface SmsRow { id: string; campaignId: string | null; phone: string; status: string; attempts: number; lastError: string | null; skippedReason: string | null; sentAt: string | null; reportedAt: string | null; isTest: boolean }
interface Balance { configured: boolean; missingEnv: string[]; balance: number | null; currency: string }

export default function SmsPage() {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [text, setText] = useState('Assalomu alaykum! Siz uchun yangilik bor.');
  const [stage, setStage] = useState('');
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [reports, setReports] = useState<SmsRow[]>([]);
  const [note, setNote] = useState('');
  const load = useCallback(async () => {
    const [b, p, r] = await Promise.all([
      api<Balance>('/admin/sms/balance'),
      api<{ unitPriceUzs: number }>('/admin/sms/price'),
      api<{ messages: SmsRow[] }>('/admin/sms/reports?limit=50'),
    ]);
    if (b.status === 200) setBalance(b.json as Balance);
    if (p.status === 200) setPrice((p.json as { unitPriceUzs: number }).unitPriceUzs);
    if (r.status === 200) setReports((r.json as { messages: SmsRow[] }).messages ?? []);
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 20000); return () => clearInterval(t); }, [load]);
  async function runEstimate() {
    const filters = stage ? { stageKey: stage, hasPhone: true, smsConsent: true } : { hasPhone: true, smsConsent: true };
    const r = await api<Estimate>('/admin/sms/estimate', { method: 'POST', body: { filters, text } });
    if (r.status === 200) { setEstimate(r.json as Estimate); setNote('SMS segment hisoblandi.'); }
    else setNote('Hisob-kitob xato. Matn va filterni tekshiring.');
  }
  return (
    <>
      <h1>SMS yuborish va hisobotlar</h1>
      {note && <p className="tag">{note}</p>}
      <div className="grid">
        <div className="kpi"><b>{balance?.configured ? (balance.balance ?? '—') : 'Sozlanmagan'}</b><span>Eskiz balansi (UZS)</span></div>
        <div className="kpi"><b>{price ?? '—'}</b><span>Hisob-kitob narxi / SMS qismi (UZS)</span></div>
      </div>
      {balance && !balance.configured && <div className="card"><b>SMS yuborish o‘chiq.</b> Worker ilovasida Fly secrets orqali quyidagilarni sozlang: <code>{balance.missingEnv.join(', ')}</code>. Qiymatlarni chatga yoki panelga yozmang.</div>}
      {balance?.configured && <div className="card muted">Balans Eskiz’dan real vaqtda o‘qiladi. Narx hisob-kitobi faqat taxmin: SMS_PRICE_PER_PART_UZS; bu hisobingiz uchun provayder kotirovkasi emas.</div>}
      <div className="card">
        <h2>SMS narxini oldindan hisoblash</h2>
        <label>Matn</label><textarea rows={3} maxLength={3500} value={text} onChange={(e) => setText(e.target.value)} />
        <label>Bosqich filtri (ixtiyoriy)</label><input value={stage} onChange={(e) => setStage(e.target.value.trim().toUpperCase())} placeholder="Masalan, OFFERS" />
        <div className="row" style={{ marginTop: 8 }}><button className="pri" onClick={() => void runEstimate()}>Hisoblash</button>{estimate && <span className="tag ok">{estimate.recipientCount} raqam · {estimate.partsPerRecipient} qism · taxmin {estimate.totalUzs.toLocaleString()} UZS</span>}</div>
        <p className="muted">Hisob faqat SMS roziligi faol va telefoni bor foydalanuvchilarni oladi. Kampaniyani tasdiqlashdan oldin son qayta tekshiriladi.</p>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <div className="row"><h2 style={{ marginRight: 'auto' }}>Yuborish hisobotlari</h2><button onClick={() => void load()}>Yangilash</button></div>
        {!reports.length ? <p className="muted">SMS yuborish qaydlari hozircha yo‘q.</p> : <table>
          <thead><tr><th>Telefon</th><th>Holat</th><th>Urinish</th><th>Yuborilgan</th><th>Hisobot vaqti</th><th>Sabab/xato</th><th>Turi</th></tr></thead>
          <tbody>{reports.map((row) => <tr key={row.id}>
            <td>{row.phone}</td><td><span className={'tag ' + (row.status === 'delivered' ? 'ok' : row.status === 'failed' ? 'bad' : row.status === 'queued' ? 'warn' : '')}>{row.status}</span></td>
            <td>{row.attempts}</td><td>{row.sentAt ? new Date(row.sentAt).toLocaleString() : '—'}</td><td>{row.reportedAt ? new Date(row.reportedAt).toLocaleString() : '—'}</td>
            <td className="err">{row.skippedReason ?? row.lastError ?? ''}</td><td>{row.isTest ? 'sinov' : 'kampaniya'}</td>
          </tr>)}</tbody>
        </table>}
      </div>
    </>
  );
}
