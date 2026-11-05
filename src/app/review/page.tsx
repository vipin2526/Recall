'use client';

import { Suspense } from 'react';
import { ReviewScreen } from '@/components/review/review-screen';
import { Skeleton } from '@/components/ui';

function ReviewFallback() {
  return (
    <div className="mx-auto max-w-3xl space-y-4" aria-busy="true">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-1.5 w-full rounded-full" />
      <div className="card-surface space-y-4 p-6">
        <Skeleton className="h-5 w-24 rounded-full" />
        <Skeleton className="h-8 w-3/5" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}

export default function ReviewPage() {
  return (
    <Suspense fallback={<ReviewFallback />}>
      <ReviewScreen />
    </Suspense>
  );
}
