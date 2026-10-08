'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface A { id: string; actorId: string | null; action: string; entity: string; entityId: string | null; after: Record<string, unknown> | null; createdAt: string }

export default function Audit() {
  const [items, setItems] = useState<A[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    api<{ entries: A[] }>('/admin/audit').then((r) => {
      if (r.status === 200) setItems((r.json as { entries: A[] }).entries);
      else setErr('Audit faqat admin uchun.');
    });
  }, []);
  return (
    <>
      <h1>Audit jurnali</h1>
      {err && <p className="err">{err}</p>}
      <table>
        <thead><tr><th> Vaqt</th><th>Aktor</th><th>Amal</th><th>Obyekt</th><th>Qayd</th></tr></thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id}>
              <td>{new Date(a.createdAt).toLocaleString()}</td>
              <td>{a.actorId?.slice(0, 8) ?? '-'}</td>
              <td><span className="tag">{a.action}</span></td>
              <td>{a.entity} {a.entityId ? '(' + a.entityId.slice(0, 8) + ')' : ''}</td>
              <td className="muted" style={{ fontSize: 11 }}>{a.after ? JSON.stringify(a.after).slice(0, 120) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
