'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Stats {
  funnel: Record<string, { total: number; users: number }>;
  leads: { total: number; byStatus: Record<string, number> };
  periods?: Record<string, { newUsers: number; completed: number; conversionPct: number; active: number; leads: number; messagesSent: number }>;
  topStages?: { stageKey: string; viewed: number; completed: number; stuck: number; conversionPct: number }[];
  campaigns?: { id: string; name: string; channel: string; status: string; stats: { planned: number; sent: number; pending: number; failed: number } }[];
}

export default function Dashboard() {
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api<Stats>('/admin/stats').then((r) => (r.status === 200 ? setS(r.json as Stats) : setErr('stats xato')));
  }, []);
  if (err) return <p className="err">{err}</p>;
  if (!s) return <p>Tegilmoqda...</p>;
  const NAMES: Record<string, string> = {
    bot_start: 'Bot boshladi',
    'link_token_claimed': 'Havola orqali keldi',
    'stage:START': 'Kirishni ko\'rdi',
    'stage:EXPERIENCE_VIDEO': 'Tajriba videosini ko\'rdi',
    'stage:LESSON_INTRO': 'Sinov darsiga kirdi',
    task_answered: 'Task javob berdi',
    lesson_self_reported_watched: 'Darsni ko\'rdim dedi',
    'stage:OFFERS': 'Takliflarni ko\'rdi',
    sales_lead_created: 'Sotuvga ariza',
  };
  return (
    <>
      <h1>Statistika (qayta kirishlar bilan, noyob foydalanuvchi alohida)</h1>
      <div className="grid">
        {Object.entries(s.funnel).map(([k, v]) => (
          <div key={k} className="kpi">
            <b>{v.users}</b>
            <span className="muted">{NAMES[k] ?? k}</span>
            <div className="muted" style={{ fontSize: 11 }}>{v.total} hodisa</div>
          </div>
        ))}
      </div>
      {s.periods && <>
        <h2>Davr kesimidagi ko‘rsatkichlar</h2>
        <div className="grid">
          {Object.entries(s.periods).map(([period, value]) => <div key={period} className="card">
            <b>{period === 'today' ? 'Bugun' : period === '7d' ? '7 kun' : '30 kun'}</b>
            <div className="muted" style={{ marginTop: 6 }}>Yangi: {value.newUsers} · Faol: {value.active}</div>
            <div className="muted">Lead: {value.leads} · Xabar: {value.messagesSent}</div>
            <div className="muted">Ariza: {value.completed} · Konversiya: {value.conversionPct.toFixed(1)}%</div>
          </div>)}
        </div>
      </>}
      {s.topStages && <div className="card" style={{ overflowX: 'auto' }}>
        <h2>Ko‘p ko‘rilgan bosqichlar (30 kun)</h2>
        <table><thead><tr><th>Bosqich</th><th>Ko‘rildi</th><th>Tugallandi</th><th>Stuck</th><th>O‘tish</th></tr></thead>
          <tbody>{s.topStages.map((row) => <tr key={row.stageKey}><td>{row.stageKey}</td><td>{row.viewed}</td><td>{row.completed}</td><td>{row.stuck}</td><td>{row.conversionPct.toFixed(1)}%</td></tr>)}</tbody>
        </table>
      </div>}
      {s.campaigns && <div className="card" style={{ overflowX: 'auto' }}>
        <h2>So‘nggi kampaniyalar</h2>
        {!s.campaigns.length ? <p className="muted">Kampaniyalar yo‘q.</p> : <table><thead><tr><th>Nomi</th><th>Kanali</th><th>Holat</th><th>Yuborildi</th><th>Navbat</th></tr></thead>
          <tbody>{s.campaigns.map((c) => <tr key={c.id}><td>{c.name}</td><td>{c.channel}</td><td>{c.status}</td><td>{c.stats.sent}/{c.stats.planned}</td><td>{c.stats.pending}</td></tr>)}</tbody>
        </table>}
      </div>}
      <h2>Ariza holatlari (jami: {s.leads.total})</h2>
      <div className="row">
        {Object.entries(s.leads.byStatus).map(([k, v]) => (
          <span key={k} className="tag">{k}: {v}</span>
        ))}
      </div>
    </>
  );
}
