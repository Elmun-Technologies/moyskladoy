'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Block { id: string; key: string; stage: string | null; title: string; status: string; version: number }
interface StageRow { stageKey: string; stepOrder: number; viewed: number; completed: number; stuck: number; conversionPct: number; medianMinutes: number | null }

export default function Stages() {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [hasData, setHasData] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    (async () => {
      const [b, f] = await Promise.all([
        api<{ blocks: Block[] }>('/admin/blocks?status=all'),
        api<{ stages: StageRow[]; hasData: boolean }>('/admin/funnel'),
      ]);
      if (b.status === 200) setBlocks((b.json as { blocks: Block[] }).blocks ?? []);
      else setError('Kontent bloklari olinmadi.');
      if (f.status === 200) {
        const j = f.json as { stages: StageRow[]; hasData: boolean };
        setStages(j.stages ?? []); setHasData(j.hasData);
      }
    })();
  }, []);
  const blockCount = new Map<string, number>();
  for (const block of blocks) if (block.stage) blockCount.set(block.stage, (blockCount.get(block.stage) ?? 0) + 1);
  return (
    <>
      <h1>Bosqichlar va kontent</h1>
      <p className="muted">Bosqich holatlari — StageProgress instrumentatsiyasi. Kontent bloklari alohida ro‘yxatda; bot oqimiga ta’sir qilmaydi.</p>
      {error && <p className="err">{error}</p>}
      {!hasData && <div className="card muted">Tanlangan 30 kunlik davrda StageProgress ma’lumoti yo‘q. Barcha engine bosqichlari ro‘yxati ko‘rsatiladi.</div>}
      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>Engine bosqichlari: {stages.length}</h2>
        <table><thead><tr><th>#</th><th>Bosqich kaliti</th><th>Kontent bloklari</th><th>Ko‘rildi</th><th>Tugallandi</th><th>Stuck</th><th>O‘tish</th></tr></thead>
          <tbody>{stages.map((row) => <tr key={row.stageKey}>
            <td>{row.stepOrder + 1}</td><td>{row.stageKey}</td><td>{blockCount.get(row.stageKey) ?? 0}</td><td>{row.viewed}</td><td>{row.completed}</td><td>{row.stuck}</td><td>{row.conversionPct.toFixed(1)}%</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>Kontent bloklari: {blocks.length}</h2>
        {!blocks.length ? <p className="muted">Bloklar yo‘q.</p> : <table>
          <thead><tr><th>Kalit</th><th>Bosqich</th><th>Sarlavha</th><th>Holat</th><th>Versiya</th></tr></thead>
          <tbody>{blocks.map((block) => <tr key={block.id}><td>{block.key}</td><td>{block.stage ?? '—'}</td><td>{block.title}</td><td><span className={'tag ' + (block.status === 'approved' ? 'ok' : 'warn')}>{block.status}</span></td><td>{block.version}</td></tr>)}</tbody>
        </table>}
      </div>
    </>
  );
}
