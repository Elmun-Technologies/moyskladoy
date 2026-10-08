'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Lead {
  id: string;
  userId: string;
  productId: string | null;
  status: string;
  assignedToId: string | null;
  contactMethod: string | null;
  preferredTime: string | null;
  businessType: string | null;
  problem: string | null;
  timeline: string | null;
  contactConsent: boolean;
  createdAt: string;
}
const STATUSES = ['new', 'assigned', 'contacting', 'talked', 'later', 'purchased', 'not_fit', 'no_contact'];

export default function Leads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [canWrite, setCanWrite] = useState(true);
  const load = useCallback(async () => {
    const r = await api<{ leads: Lead[]; total: number }>('/admin/leads');
    if (r.status === 200) setLeads((r.json as { leads: Lead[] }).leads);
    if (r.status === 403) setCanWrite(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function act(id: string, path: string, body?: unknown) {
    await api(path, { method: 'POST', body });
    void load();
  }
  return (
    <>
      <h1>Arizalar ({leads.length})</h1>
      {!canWrite && <p className="warn tag">Sizda (content_editor) arizalarga ruxsat yo&apos;q.</p>}
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr><th>#</th><th>Yaratilgan</th><th>Biznes</th><th>Muammo</th><th>Muddat</th><th>Kontakt</th><th>Holat</th><th></th></tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id}>
                <td>{l.id.slice(0, 8)}</td>
                <td>{new Date(l.createdAt).toLocaleString()}</td>
                <td>{l.businessType ?? '-'}</td>
                <td>{l.problem ?? '-'}</td>
                <td>{l.timeline ?? '-'}</td>
                <td>{l.contactMethod ?? '-'} {l.contactConsent ? <span className="tag ok">rozi</span> : <span className="tag bad">yo&apos;q</span>}</td>
                <td><span className={'tag ' + (l.status === 'purchased' ? 'ok' : l.status === 'new' ? 'warn' : '')}>{l.status}</span>{l.assignedToId ? <div className="muted" style={{ fontSize: 11 }}>olgan: {l.assignedToId.slice(0, 6)}</div> : null}</td>
                <td>
                  {canWrite && !l.assignedToId ? <button onClick={() => act(l.id, '/admin/leads/' + l.id + '/claim')}>O&apos;zimga</button> : null}{' '}
                  {canWrite ? (
                    <select defaultValue={l.status} style={{ width: 130 }} onChange={(e) => act(l.id, '/admin/leads/' + l.id + '/status', { status: e.target.value })}>
                      {STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                    </select>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
