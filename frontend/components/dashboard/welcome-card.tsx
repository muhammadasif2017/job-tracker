import Link from 'next/link';
import { ArrowRight, Bell, Building2, Sparkles } from 'lucide-react';

/** One first-run step: where it goes and why a new user would go there. */
const STEPS = [
  {
    href: '/jobs',
    icon: Sparkles,
    title: 'Track your first job',
    body: 'Paste a posting URL into Quick Add, or fill in the form yourself.',
  },
  {
    href: '/companies',
    icon: Building2,
    title: 'Save your target companies',
    body: 'Each one gets researched for you: stack, size, culture, remote policy.',
  },
  {
    href: '/profile',
    icon: Bell,
    title: 'Turn on reminders',
    body: 'Interview reminders and a digest of applications that went quiet.',
  },
] as const;

/**
 * First-run panel on the dashboard, shown only while the account has no jobs,
 * so a new user sees where to start instead of a row of zeros.
 */
export function WelcomeCard() {
  return (
    <section
      aria-labelledby="welcome-heading"
      className="rounded-md border border-accent/30 bg-accent-soft/60 p-5 sm:p-6"
    >
      <h2
        id="welcome-heading"
        className="font-display text-xl font-semibold tracking-tight text-ink"
      >
        Welcome, let&apos;s set up your search
      </h2>
      <p className="mt-1 text-sm text-muted">
        Three steps and this page starts telling you what needs attention.
      </p>
      <ol className="mt-5 grid gap-3 sm:grid-cols-3">
        {STEPS.map(({ href, icon: Icon, title, body }, i) => (
          <li key={href}>
            <Link
              href={href}
              className="group flex h-full flex-col rounded-md border border-line bg-paper p-4 transition-colors hover:border-accent"
            >
              <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wide text-accent-ink">
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                Step {i + 1}
              </span>
              <span className="mt-2 font-medium text-ink">{title}</span>
              <span className="mt-1 flex-1 text-sm text-muted">{body}</span>
              <ArrowRight
                className="mt-3 h-4 w-4 text-muted-2 transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
                aria-hidden="true"
              />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
