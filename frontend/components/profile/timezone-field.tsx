'use client';

import type { UseFormRegisterReturn } from 'react-hook-form';

// Intl.supportedValuesOf('timeZone') and resolvedOptions().timeZone depend on
// the runtime's bundled ICU data — Node (SSR) and the browser (hydration) can
// genuinely disagree on the zone list/order, which produced a real hydration
// mismatch on this <select>'s <option> list. This component is loaded via
// next/dynamic({ ssr: false }) in profile/page.tsx so it never renders on the
// server at all — both computations only ever run in the browser.
const IANA_TIMEZONES = [
  'UTC',
  ...Intl.supportedValuesOf('timeZone').filter((tz) => tz !== 'UTC'),
];
const BROWSER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function TimezoneField({
  registerProps,
  onUseBrowserTimezone,
}: {
  registerProps: UseFormRegisterReturn<'timezone'>;
  onUseBrowserTimezone: (timezone: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor="notification-timezone"
        className="text-sm font-medium text-slate-700 dark:text-slate-300"
      >
        Timezone
      </label>
      <select
        id="notification-timezone"
        className="h-9 w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        {...registerProps}
      >
        {IANA_TIMEZONES.map((tz) => (
          <option key={tz} value={tz}>
            {tz}
          </option>
        ))}
      </select>
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Used to time interview reminder and digest emails.
        </p>
        <button
          type="button"
          className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
          onClick={() => onUseBrowserTimezone(BROWSER_TIMEZONE)}
        >
          Use my timezone ({BROWSER_TIMEZONE})
        </button>
      </div>
    </div>
  );
}
