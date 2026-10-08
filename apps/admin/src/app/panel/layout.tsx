'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, setCsrf } from '@/lib/api';

const NAV: [string, string][] = [
  ['dashboard', 'Statistika'],
  ['funnel', 'Voronka'],
  ['campaigns', 'Kampaniyalar'],
  ['sms', 'SMS'],
  ['stages', 'Bosqichlar'],
  ['leads', 'Arizalar'],
  ['users', 'Foydalanuvchilar'],
  ['content', 'Kontent'],
  ['media', 'Media'],
  ['products', 'Mahsulot/narx'],
  ['settings', 'Sozlamalar'],
  ['help', 'Yordam'],
  ['outbox', 'Navbat'],
  ['audit', 'Audit'],
];

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<{ role: string; email: string } | null>(null);
  const [checking, setChecking] = useState(true);
  const path = usePathname();
  const router = useRouter();
  useEffect(() => {
    (async () => {
      const r = await api<{ ok: boolean; role: string; email: string; csrf: string }>('/admin/me');
      if (r.status !== 200) {
        router.replace('/');
        return;
      }
      const j = r.json as { role: string; email: string; csrf: string };
      setCsrf(j.csrf);
      setMe({ role: j.role, email: j.email });
      setChecking(false);
    })();
  }, [router]);
  async function logout() {
    await api('/admin/logout', { method: 'POST' });
    setCsrf(null);
    router.replace('/');
  }
  if (checking) return <main className="main">Tekshirilmoqda...</main>;
  return (
    <div className="wrap">
      <nav className="nav">
        <div className="brand">Moy Sklad</div>
        {NAV.map(([k, l]) => (
          <Link key={k} href={'/panel/' + k} className={path === '/panel/' + k ? 'on' : ''}>
            {l}
          </Link>
        ))}
        <div style={{ padding: '14px 18px', fontSize: 12 }}>
          <div className="muted" style={{ color: '#94a3b8' }}>{me?.email}</div>
          <div className="muted" style={{ color: '#94a3b8' }}>rol: {me?.role}</div>
          <button style={{ marginTop: 8 }} onClick={logout}>
            Chiqish
          </button>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
