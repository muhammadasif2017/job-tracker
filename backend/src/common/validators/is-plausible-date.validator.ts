import {
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;

// For user-entered date-string fields that are otherwise unbounded — a
// typo'd year (e.g. 2062 instead of 2026) would silently pass @IsDateString
// and then corrupt anything derived from it downstream.
export function IsPlausibleDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isPlausibleDate',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          const time = Date.parse(value);
          if (Number.isNaN(time)) return true; // let @IsDateString own format errors
          const now = Date.now();
          return time >= now - TWO_YEARS_MS && time <= now + TWO_YEARS_MS;
        },
        defaultMessage() {
          return 'must be within 2 years of today';
        },
      },
    });
  };
}
