'use client';

import { Suspense } from 'react';
import { LibraryScreen } from '@/components/library/library-screen';
import { Skeleton } from '@/components/ui';

function LibraryFallback() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-3">
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-3 w-80" />
      </div>
      <div className="card-surface h-20 animate-pulse bg-paper-soft/40" />
      <div className="card-surface h-64 animate-pulse bg-paper-soft/40" />
    </div>
  );
}

export default function LibraryPage() {
  return (
    <Suspense fallback={<LibraryFallback />}>
      <LibraryScreen />
    </Suspense>
  );
}
