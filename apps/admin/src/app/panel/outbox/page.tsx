'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface O { id: string; userId: string; type: string; dedupeKey: string; status: string; attempts: number; scheduledFor: string; lastError: string | null }

export default function Outbox() {
  const [items, setItems] = useState<O[]>([]);
  async function load() {
    const r = await api<{ outbox: O[] }>('/admin/outbox');
    if (r.status === 200) setItems((r.json as { outbox: O[] }).outbox);
  }
  useEffect(() => { const t = setInterval(load, 5000); void load(); return () => clearInterval(t); }, []);
  async function cancel(id: string) {
    await api('/admin/outbox/' + id + '/cancel', { method: 'POST' });
    void load();
  }
  return (
    <>
      <h1>Xabarlar navbati (outbox)</h1>
      <p className="muted">Avto-yangilanadi (5s). &quot;failed&quot; - qayta urinishlar tugagan; &quot;cancelled&quot; - to&apos;xtatilgan.</p>
      <table>
        <thead><tr><th>Holat</th><th>Turi</th><th>Dedupe</th><th>Reja</th><th>Urinish</th><th>Xato</th><th></th></tr></thead>
        <tbody>
          {items.map((o) => (
            <tr key={o.id}>
              <td><span className={'tag ' + (o.status === 'sent' ? 'ok' : o.status === 'failed' ? 'bad' : o.status === 'pending' ? 'warn' : '')}>{o.status}</span></td>
              <td>{o.type}</td>
              <td className="muted" style={{ fontSize: 11 }}>{o.dedupeKey}</td>
              <td>{new Date(o.scheduledFor).toLocaleString()}</td>
              <td>{o.attempts}</td>
              <td className="err" style={{ fontSize: 11 }}>{o.lastError ?? ''}</td>
              <td>{(o.status === 'pending') && <button onClick={() => cancel(o.id)}>bekor</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
