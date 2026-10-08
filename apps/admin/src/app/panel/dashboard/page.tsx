'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Stats {
  funnel: Record<string, { total: number; users: number }>;
  leads: { total: number; byStatus: Record<string, number> };
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
    'stage:INTRO_VIDEO': 'Tanishuv videoni ko\'rdi',
    'stage:LESSON_INTRO': 'Sinov darsiga kirdi',
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
      <h2>Ariza holatlari (jami: {s.leads.total})</h2>
      <div className="row">
        {Object.entries(s.leads.byStatus).map(([k, v]) => (
          <span key={k} className="tag">{k}: {v}</span>
        ))}
      </div>
    </>
  );
}
