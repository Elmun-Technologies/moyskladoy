'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface U { id: string; telegramId: number; username: string | null; firstName: string | null; stage: string; salesStatus: string; blockedAt: string | null; phone: string | null }

export default function Users() {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<U[]>([]);
  const [total, setTotal] = useState(0);
  const [note, setNote] = useState('');
  async function load(search = q) {
    const r = await api<{ users: U[]; total: number }>('/admin/users?limit=50&search=' + encodeURIComponent(search));
    if (r.status === 200) { setUsers((r.json as { users: U[] }).users); setTotal((r.json as { total: number }).total); }
  }
  useEffect(() => { void load(''); }, []);
  async function marketing(id: string, action: 'grant' | 'revoke') {
    const r = await api('/admin/users/' + id + '/marketing', { method: 'POST', body: { action } });
    setNote(r.status === 200 ? (action === 'grant' ? 'Rozilik berildi (mijoz so&apos;rovi bo&apos;yicha)' : 'Rozilik bekor qilindi, navbat to&apos;xtatildi') : 'Ruxsat yo\'q (faqat admin)');
  }
  async function del(id: string) {
    if (!confirm('Foydalanuvchini belgilash va barcha navbatlarni to\'xtatish?')) return;
    await api('/admin/users/' + id + '/delete', { method: 'POST' });
    void load();
  }
  return (
    <>
      <h1>Foydalanuvchilar ({total})</h1>
      <div className="row" style={{ marginBottom: 10 }}>
        <input style={{ width: 260 }} placeholder="Ism/username qidirish" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <button onClick={() => load()}>Qidirish</button>
        <span className="muted">{note}</span>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>ID</th><th>Telegram</th><th>Ism</th><th>Telefon</th><th>Bosqich</th><th>Sotuv</th><th>Holat</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.id.slice(0, 8)}</td>
                <td>{u.username ? '@' + u.username : String(u.telegramId)}</td>
                <td>{u.firstName ?? '-'}</td>
                <td>{u.phone ?? <span className="muted">yashirin</span>}</td>
                <td>{u.stage}</td>
                <td><span className="tag">{u.salesStatus}</span></td>
                <td>{u.blockedAt ? <span className="tag bad">blok</span> : <span className="tag ok">faol</span>}</td>
                <td className="row">
                  <button onClick={() => marketing(u.id, 'grant')} title="Mijoz so'rovi bilan marketing roziligi">rozilik+</button>
                  <button onClick={() => marketing(u.id, 'revoke')}>rozilik-</button>
                  <button onClick={() => del(u.id)}>o&apos;chirish</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
