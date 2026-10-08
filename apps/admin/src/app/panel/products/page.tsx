'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface P {
  id: string;
  slug: string;
  kind: string;
  name: string;
  description: string;
  priceType: 'fixed' | 'by_scope' | 'unconfirmed';
  priceUsd: number | null;
  currency: string;
  visibleToUsers: boolean;
  isActive: boolean;
  details: { pricingText?: string | null };
}

export default function Products() {
  const [items, setItems] = useState<P[]>([]);
  const [role, setRole] = useState('');
  const [note, setNote] = useState('');
  const load = useCallback(async () => {
    const me = await api<{ role: string }>('/admin/me');
    if (me.status === 200) setRole((me.json as { role: string }).role);
    const r = await api<{ products: P[] }>('/admin/products');
    if (r.status === 200) setItems((r.json as { products: P[] }).products);
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function save(p: P, patch: Partial<P>) {
    const body = { slug: p.slug, kind: p.kind, name: p.name, description: p.description, priceType: p.priceType, priceUsd: p.priceUsd, visibleToUsers: p.visibleToUsers, pricingText: p.details?.pricingText ?? null, details: p.details, ...patch };
    const r = await api('/admin/products', { method: 'POST', body });
    if (r.status === 403) { setNote('Narxni faqat admin o\'zgartiradi (sizning rol: ' + role + ')'); return; }
    setNote('Saqlandi - eski versiyalar tarixda qoldi');
    void load();
  }
  const canEdit = role === 'admin';
  return (
    <>
      <h1>Mahsulotlar va narxlar</h1>
      <p className="muted">Narx o&apos;zgarsa ham, avvalgi arizalarga eski versiya yozib qo&apos;yiladi. Tasdiqlanmagan takliflar botda ko&apos;rsatilmaydi.</p>
      {note && <p className="tag">{note}</p>}
      {items.map((p) => (
        <div key={p.id} className="card">
          <div className="row">
            <b style={{ fontSize: 15 }}>{p.name}</b>
            <span className="tag">{p.slug}</span>
            <span className={'tag ' + (p.visibleToUsers ? 'ok' : 'bad')}>{p.visibleToUsers ? 'ko\'rinadi' : 'YASHIRIN (tasdiqlanmagan)'}</span>
            <span className="tag warn">{p.priceType}</span>
          </div>
          <p className="muted">{p.description}</p>
          <div className="row">
            <label style={{ width: 140 }}>Narx (USD)</label>
            <input type="number" disabled={!canEdit} value={p.priceUsd ?? ''} placeholder={p.priceType === 'by_scope' ? 'ko\'lam bo\'yicha' : ''} onBlur={(e) => canEdit && save(p, { priceUsd: e.target.value ? Number(e.target.value) : null })} />
            <label style={{ width: 220 }}>Narx matni (by_scope / qo'shimcha)</label>
            <input disabled={!canEdit} value={p.details?.pricingText ?? ''} onBlur={(e) => canEdit && save(p, { details: { ...p.details, pricingText: e.target.value || null } })} />
            <button disabled={!canEdit} onClick={() => save(p, { visibleToUsers: !p.visibleToUsers })}>{p.visibleToUsers ? 'Yashirish' : 'Ko\'rsatish'}</button>
          </div>
        </div>
      ))}
    </>
  );
}
