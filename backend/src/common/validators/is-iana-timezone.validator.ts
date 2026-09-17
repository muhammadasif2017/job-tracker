import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Accepts any timezone name `Intl.DateTimeFormat` can resolve.
 *
 * Membership of Intl.supportedValuesOf('timeZone') is the wrong test: that
 * list carries exactly one name per zone, and on Node it is the legacy alias.
 * It contains 'Asia/Calcutta' but not 'Asia/Kolkata', 'Europe/Kiev' but not
 * 'Europe/Kyiv', and not 'UTC' at all (the column's own default). Browsers
 * report the modern names, so a set check rejected zones that work perfectly
 * well and blocked users in India and Ukraine from saving their own timezone.
 *
 * Constructing a formatter is the test that matches what the value is
 * actually used for: Intl.DateTimeFormat throws RangeError on a name it
 * cannot resolve and accepts every alias it can. A bad name doesn't fail
 * loudly at write time — it throws inside the notifications scheduler and
 * templates the next time they render a date for this user, silently breaking
 * their digest fan-out. Reject it at the DTO boundary instead.
 */
export function IsIanaTimezone(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isIanaTimezone',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string' || !value) return false;
          try {
            new Intl.DateTimeFormat('en-US', { timeZone: value });
            return true;
          } catch {
            return false;
          }
        },
        defaultMessage() {
          return 'must be a valid IANA timezone name (e.g. "Asia/Karachi")';
        },
      },
    });
  };
}
