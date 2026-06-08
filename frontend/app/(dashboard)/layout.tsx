import { Sidebar } from '../../components/layout/sidebar';
import { ThemeToggle } from '../../components/layout/theme-toggle';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-end border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900">
          <ThemeToggle />
        </header>
        <main className="flex-1 overflow-y-auto bg-slate-50 p-6 dark:bg-slate-950">
          {children}
        </main>
      </div>
    </div>
  );
}
