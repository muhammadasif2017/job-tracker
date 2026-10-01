'use client';

import type { UseFormRegisterReturn } from 'react-hook-form';

/**
 * Every timezone the browser knows, with UTC first.
 *
 * Intl.supportedValuesOf('timeZone') and resolvedOptions().timeZone depend on
 * the runtime's bundled ICU data — Node (SSR) and the browser (hydration) can
 * genuinely disagree on the zone list/order, which produced a real hydration
 * mismatch on this <select>'s <option> list. This component is loaded via
 * next/dynamic({ ssr: false }) in profile/page.tsx so it never renders on the
 * server at all — both computations only ever run in the browser.
 */
const IANA_TIMEZONES = [
  'UTC',
  ...Intl.supportedValuesOf('timeZone').filter((tz) => tz !== 'UTC'),
];
/** The browser's own timezone, offered as a one-click choice. */
const BROWSER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Timezone select for the notification settings form. Browser-only; see
 * `IANA_TIMEZONES`.
 */
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
        className="text-xs font-medium text-muted"
      >
        Timezone
      </label>
      <select
        id="notification-timezone"
        className="h-9 w-full max-w-xs rounded-md border border-line bg-paper px-3 text-sm text-ink"
        {...registerProps}
      >
        {IANA_TIMEZONES.map((tz) => (
          <option key={tz} value={tz}>
            {tz}
          </option>
        ))}
      </select>
      {/* Hint and link in one paragraph: as two flex children they split
          into side-by-side columns on a phone. text-left because a button
          centres its text, which shows once a long zone name wraps it. */}
      <p className="text-xs text-muted">
        Used to time interview reminder and digest emails.{' '}
        <button
          type="button"
          className="text-left text-accent hover:underline"
          onClick={() => onUseBrowserTimezone(BROWSER_TIMEZONE)}
        >
          Use my timezone ({BROWSER_TIMEZONE})
        </button>
      </p>
    </div>
  );
}
