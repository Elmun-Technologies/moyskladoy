'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface H { id: string; userId: string; question: string; status: 'open' | 'answered' | 'closed'; answer: string | null; createdAt: string }

export default function Help() {
  const [items, setItems] = useState<H[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  async function load() {
    const r = await api<{ requests: H[] }>('/admin/help');
    if (r.status === 200) setItems((r.json as { requests: H[] }).requests);
  }
  useEffect(() => { void load(); }, []);
  async function answer(id: string) {
    await api('/admin/help/' + id + '/answer', { method: 'POST', body: { answer: drafts[id] ?? '' } });
    void load();
  }
  return (
    <>
      <h1>Yordam so&apos;rovlari</h1>
      {items.length === 0 && <p className="muted">Hozircha so&apos;rov yo&apos;q.</p>}
      {items.map((h) => (
        <div key={h.id} className="card">
          <div className="row">
            <span className={'tag ' + (h.status === 'open' ? 'warn' : 'ok')}>{h.status}</span>
            <span className="muted">{new Date(h.createdAt).toLocaleString()}</span>
            <span className="muted">user {h.userId.slice(0, 8)}</span>
          </div>
          <p style={{ whiteSpace: 'pre-wrap' }}>{h.question}</p>
          {h.answer ? <p><b>Javob:</b> {h.answer}</p> : (
            <div className="row">
              <textarea rows={2} style={{ width: '70%' }} value={drafts[h.id] ?? ''} onChange={(e) => setDrafts({ ...drafts, [h.id]: e.target.value })} />
              <button className="pri" onClick={() => answer(h.id)}>Javob yuborish</button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}
