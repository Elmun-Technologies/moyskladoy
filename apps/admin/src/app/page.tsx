'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, setCsrf } from '@/lib/api';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const r = await api<{ ok: boolean; csrf: string }>('/admin/login', { method: 'POST', body: { email, password } });
    setBusy(false);
    if (r.status === 200 && 'csrf' in (r.json as object)) {
      setCsrf((r.json as { csrf: string }).csrf);
      router.push('/dashboard');
    } else {
      const j = r.json as { error?: string };
      setErr(j.error === 'locked' ? 'Hisob vaqtincha bloklandgan (5 urinish).' : j.error === 'bad_credentials' ? 'Email yoki parol xato.' : 'Kirib bo\'lmadi.');
    }
  }
  return (
    <main style={{ maxWidth: 380, margin: '10vh auto', padding: '0 16px' }}>
      <h1>Moy Sklad - admin</h1>
      <form onSubmit={submit} className="card">
        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required autoComplete="username" />
        <label>Parol</label>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required autoComplete="current-password" />
        <div style={{ marginTop: 12 }}>
          <button className="pri" disabled={busy}>{busy ? '...' : 'Kirish'}</button>
        </div>
        {err && <p className="err">{err}</p>}
      </form>
      <p className="muted">Demo: ADMIN_EMAIL/ADMIN_PASSWORD orqali seed qilingan hisob.</p>
    </main>
  );
}
