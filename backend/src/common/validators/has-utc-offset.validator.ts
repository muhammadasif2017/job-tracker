import { registerDecorator, ValidationOptions } from 'class-validator';

// `2026-03-22T14:00` and `2026-03-22T14:00:00` carry no UTC offset. Both are
// valid ISO 8601, so `@IsDateString()` accepts them, but `new Date(value)`
// resolves a *date-time* without an offset against the server's local zone
// while a bare `2026-03-22` resolves against UTC. The same request therefore
// stores two different instants depending on the host's TZ, and every check
// passes on a UTC dev container and CI runner.
//
// `<input type="datetime-local">` produces exactly that offset-less shape, so
// this rejects it at the edge and forces the client to send a real instant
// instead (see ADR-043). A bare date is allowed through: it is unambiguous.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;

export function HasUtcOffset(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'hasUtcOffset',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          if (DATE_ONLY.test(value)) return true;
          return HAS_OFFSET.test(value.trim());
        },
        defaultMessage() {
          return 'must include a UTC offset (e.g. 2026-03-22T14:00:00.000Z)';
        },
      },
    });
  };
}
