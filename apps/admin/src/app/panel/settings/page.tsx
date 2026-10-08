'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Staff { telegramId: number; adminEmail: string }

export default function Settings() {
  const [s, setS] = useState<Record<string, unknown>>({});
  const [note, setNote] = useState('');
  const [role, setRole] = useState('');
  const [staff, setStaff] = useState<Staff[]>([]);
  const [sid, setSid] = useState('');
  const [link, setLink] = useState('');
  const [pricing, setPricing] = useState('');
  const [newStaff, setNewStaff] = useState<Staff>({ telegramId: 0, adminEmail: '' });
  async function load() {
    const me = await api<{ role: string }>('/admin/me');
    if (me.status === 200) setRole((me.json as { role: string }).role);
    const r = await api<{ settings: Record<string, unknown> }>('/admin/settings');
    if (r.status === 200) {
      const j = (r.json as { settings: Record<string, unknown> }).settings;
      setS(j);
      setSid(String(j.sales_group_chat_id ?? ''));
      setLink(String(j.lesson_link ?? ''));
      setPricing(String(j.service_pricing_text ?? ''));
      setStaff(Array.isArray(j.sales_staff) ? (j.sales_staff as Staff[]) : []);
    }
  }
  useEffect(() => { void load(); }, []);
  async function put(key: string, value: unknown) {
    const r = await api('/admin/settings', { method: 'POST', body: { key, value } });
    setNote(r.status === 200 ? 'Saqlandi' : r.status === 403 ? 'Faqat admin sozlama o\'zgartira oladi' : 'Xato');
    void load();
  }
  const admin = role === 'admin';
  const offer = s.special_offer_800 as { status?: string; priceUsd?: number } | undefined;
  return (
    <>
      <h1>Sozlamalar</h1>
      {note && <p className="tag">{note}</p>}
      <div className="card">
        <h2>$800 maxsus taklif</h2>
        <p>Hozirgi holat: <span className={'tag ' + (offer?.status === 'unconfirmed' ? 'bad' : 'ok')}>{offer?.status ?? 'yo\'q'}</span></p>
        <p className="muted">Tarkibi tasdiqlanmagan - bot uni ko&apos;rsatmaydi. Tasdiqlasangiz: mahsulot ro&apos;yxatida &quot;special-800&quot;ni ko&apos;rinadigan qiling.</p>
        {admin && <button onClick={() => put('special_offer_800', { ...(offer ?? {}), status: 'confirmed', priceUsd: offer?.priceUsd ?? 800 })}>Tasdiqlangan deb belgilash</button>}
      </div>
      <div className="card">
        <h2>Sinov darsi havolasi</h2>
        <input disabled={!admin} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..." />
        {admin && <button style={{ marginTop: 8 }} onClick={() => put('lesson_link', link || null)}>Saqlash</button>}
        <p className="muted">Havola bo&apos;lmasa botda &quot;Darsni ochish&quot; tugmasi chiqmaydi.</p>
      </div>
      <div className="card">
        <h2>Xizmat narxi matni</h2>
        <textarea disabled={!admin} rows={3} value={pricing} onChange={(e) => setPricing(e.target.value)} />
        {admin && <button style={{ marginTop: 8 }} onClick={() => put('service_pricing_text', pricing || null)}>Saqlash</button>}
      </div>
      <div className="card">
        <h2>Sotuv guruh va xodimlar</h2>
        <label>Guruh chat_id (manfiy son bo&apos;lishi mumkin)</label>
        <input disabled={!admin} value={sid} onChange={(e) => setSid(e.target.value)} style={{ width: 220 }} />
        <h2>Xodimlar (telegram id -&gt; admin email)</h2>
        <table>
          <thead><tr><th>Telegram ID</th><th>Admin email</th><th></th></tr></thead>
          <tbody>
            {staff.map((x, i) => (
              <tr key={i}><td>{x.telegramId}</td><td>{x.adminEmail}</td><td>{admin && <button onClick={() => put('sales_staff', staff.filter((_, j) => j !== i))}>olib tashlash</button>}</td></tr>
            ))}
            {admin && (
              <tr>
                <td><input type="number" value={newStaff.telegramId || ''} onChange={(e) => setNewStaff({ ...newStaff, telegramId: Number(e.target.value) })} /></td>
                <td><input value={newStaff.adminEmail} onChange={(e) => setNewStaff({ ...newStaff, adminEmail: e.target.value })} /></td>
                <td><button onClick={() => newStaff.telegramId > 0 && newStaff.adminEmail && put('sales_staff', [...staff, newStaff])}>qo'shish</button></td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 8 }}>{admin && <button onClick={() => put('sales_group_chat_id', sid || null)}>Saqlash</button>}</div>
      </div>
      <div className="card">
        <h2>Marketing oynasi / limit</h2>
        <p className="muted">Window: {JSON.stringify(s.marketing_window ?? null)} / kuniga: {String(s.marketing_max_per_day ?? 1)}</p>
        <p className="muted">Oyna va limit env orqali sozlanadi (MARKETING_WINDOW_START/END, MARKETING_MAX_PER_DAY) - worker qayta ishga tushirilsa yangilanadi.</p>
      </div>
    </>
  );
}
