import { registerDecorator, ValidationOptions } from 'class-validator';

// 'UTC' is the User.timezone column default but Intl.supportedValuesOf
// doesn't list it (it's a legacy alias, not a canonical IANA zone name) —
// without adding it back explicitly, the DB default itself fails this
// validator the moment a user round-trips it through PATCH /users/me/notifications.
const VALID_TIMEZONES = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);

// A bad IANA name doesn't fail loudly at write time — it throws inside
// Intl.DateTimeFormat the next time the notifications scheduler/templates
// render a date for this user, silently breaking their digest fan-out.
// Reject it at the DTO boundary instead.
export function IsIanaTimezone(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isIanaTimezone',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && VALID_TIMEZONES.has(value);
        },
        defaultMessage() {
          return 'must be a valid IANA timezone name (e.g. "Asia/Karachi")';
        },
      },
    });
  };
}
