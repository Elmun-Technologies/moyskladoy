'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function PanelIndex() {
  const router = useRouter();
  useEffect(() => { router.replace('/panel/dashboard'); }, [router]);
  return null;
}
