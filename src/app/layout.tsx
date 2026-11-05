import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { AppShell } from '@/components/app-shell';
import { SessionProvider } from '@/lib/client/session';
import { ToastProvider } from '@/lib/client/toast';

export const metadata: Metadata = {
  title: {
    default: 'Recall — spaced repetition with narrow AI',
    template: '%s · Recall',
  },
  description:
    'Capture notes and articles into recall cards, grade free-recall answers, and keep the ladder on plain code.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-paper text-ink antialiased">
        <ToastProvider>
          <SessionProvider>
            <AppShell>{children}</AppShell>
          </SessionProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
