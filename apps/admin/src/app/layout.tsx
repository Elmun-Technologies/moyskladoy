import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Moy Sklad admin', description: 'Admin panel' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz">
      <body>{children}</body>
    </html>
  );
}
