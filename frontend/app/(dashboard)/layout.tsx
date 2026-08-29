'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import { Sidebar } from '../../components/layout/sidebar';
import { ThemeToggle } from '../../components/layout/theme-toggle';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-full">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-between gap-4 border-b border-line bg-paper px-4 sm:justify-end">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setSidebarOpen(true)}
            className="rounded-md p-1.5 text-muted hover:bg-paper-raised sm:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <ThemeToggle />
        </header>
        <main className="flex-1 overflow-y-auto bg-surface p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
