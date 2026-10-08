'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface StageRow { stageKey: string; stepOrder: number; viewed: number; completed: number; stuck: number; conversionPct: number; medianMinutes: number | null }
interface FunnelData { ok: boolean; from: string; to: string; by: 'day' | 'week'; hasData: boolean; stages: StageRow[]; series: (StageRow & { bucket: string })[]; cohorts: { bucket: string; users: number; d1: number; d7: number; d30: number }[] }
interface SourceRow { source: string; starts: number; uniqueUsers: number }
interface ButtonRow { stageKey: string; blockId: string; action: string; clicks: number; uniqueUsers: number }

export default function Funnel() {
  const [by, setBy] = useState<'day' | 'week'>('day');
  const [data, setData] = useState<FunnelData | null>(null);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [buttons, setButtons] = useState<ButtonRow[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    const [f, s, b] = await Promise.all([
      api<FunnelData>('/admin/funnel?by=' + by + '&cohort=weekly'),
      api<{ sources: SourceRow[] }>('/admin/analytics/sources'),
      api<{ buttons: ButtonRow[] }>('/admin/analytics/buttons'),
    ]);
    if (f.status === 200) setData(f.json as FunnelData); else setError('Voronka yuklanmadi.');
    if (s.status === 200) setSources((s.json as { sources: SourceRow[] }).sources ?? []);
    if (b.status === 200) setButtons((b.json as { buttons: ButtonRow[] }).buttons ?? []);
  }, [by]);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <h1>Bosqich voronkasi</h1>
      <div className="row" style={{ marginBottom: 10 }}>
        <label style={{ width: 80, margin: 0 }}>Davr</label>
        <select style={{ width: 140 }} value={by} onChange={(e) => setBy(e.target.value as 'day' | 'week')}>
          <option value="day">Kunlik</option><option value="week">Haftalik</option>
        </select>
        <button onClick={() => void load()}>Yangilash</button>
        {data && <span className="muted">{new Date(data.from).toLocaleDateString()} — {new Date(data.to).toLocaleDateString()}</span>}
      </div>
      {error && <p className="err">{error}</p>}
      {!data ? <p>Yuklanmoqda…</p> : <>
        {!data.hasData && <div className="card muted">Tanlangan davrda StageProgress ma&apos;lumoti yo&apos;q. Bosqichlar ro&apos;yxati saqlanadi; sonlar 0 sifatida ko&apos;rsatiladi.</div>}
        <div className="card" style={{ overflowX: 'auto' }}>
          <h2>StageProgress — {data.stages.length} bosqich</h2>
          <table>
            <thead><tr><th>#</th><th>Bosqich</th><th>Ko&apos;rildi</th><th>Tugallandi</th><th>O&apos;tish %</th><th>Uzoq qolgan</th><th>Median (daq.)</th></tr></thead>
            <tbody>{data.stages.map((row) => <tr key={row.stageKey}>
              <td>{row.stepOrder + 1}</td><td>{row.stageKey}</td><td>{row.viewed}</td><td>{row.completed}</td>
              <td>{row.conversionPct.toFixed(1)}%</td><td>{row.stuck}</td><td>{row.medianMinutes === null ? '—' : Math.round(row.medianMinutes)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="grid">
          <div className="card" style={{ overflowX: 'auto' }}>
            <h2>Start manbalari</h2>
            {!sources.length ? <p className="muted">Manba hodisalari yo&apos;q.</p> : <table>
              <thead><tr><th>Manba</th><th>/start</th><th>Noyob foydalanuvchi</th></tr></thead>
              <tbody>{sources.map((row) => <tr key={row.source}><td>{row.source}</td><td>{row.starts}</td><td>{row.uniqueUsers}</td></tr>)}</tbody>
            </table>}
          </div>
          <div className="card" style={{ overflowX: 'auto' }}>
            <h2>Tugma bosishlar</h2>
            {!buttons.length ? <p className="muted">Tugma hodisalari yo&apos;q.</p> : <table>
              <thead><tr><th>Bosqich</th><th>Amal</th><th>Bosildi</th><th>Noyob</th></tr></thead>
              <tbody>{buttons.slice(0, 12).map((row) => <tr key={row.blockId + row.action}><td>{row.stageKey}</td><td>{row.action}</td><td>{row.clicks}</td><td>{row.uniqueUsers}</td></tr>)}</tbody>
            </table>}
          </div>
        </div>
        <div className="card" style={{ overflowX: 'auto' }}>
          <h2>Haftalik retention kohortlari</h2>
          {!data.cohorts.length ? <p className="muted">Kohort ma&apos;lumoti yo&apos;q.</p> : <table>
            <thead><tr><th>Hafta</th><th>Foydalanuvchi</th><th>D1</th><th>D7</th><th>D30</th></tr></thead>
            <tbody>{data.cohorts.map((row) => <tr key={row.bucket}><td>{row.bucket}</td><td>{row.users}</td><td>{row.d1}</td><td>{row.d7}</td><td>{row.d30}</td></tr>)}</tbody>
          </table>}
        </div>
      </>}
    </>
  );
}
