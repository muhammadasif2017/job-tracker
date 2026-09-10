import { validate } from 'class-validator';
import { IsDateString } from 'class-validator';
import { HasUtcOffset } from './has-utc-offset.validator.js';

class Subject {
  @IsDateString()
  @HasUtcOffset()
  when: string;
}

async function check(value: unknown): Promise<boolean> {
  const subject = new Subject();
  subject.when = value as string;
  const errors = await validate(subject);
  return errors.length === 0;
}

describe('HasUtcOffset', () => {
  it('accepts an instant with a Z suffix', async () => {
    await expect(check('2026-03-22T14:00:00.000Z')).resolves.toBe(true);
  });

  it('accepts an instant with a numeric offset', async () => {
    await expect(check('2026-03-22T14:00:00+05:00')).resolves.toBe(true);
    await expect(check('2026-03-22T14:00:00-0800')).resolves.toBe(true);
  });

  it('accepts a bare date, which is unambiguous', async () => {
    await expect(check('2026-03-22')).resolves.toBe(true);
  });

  // The whole point: `new Date('2026-03-22T14:00')` resolves against the
  // server's zone, so this shape means different instants on different hosts.
  // It is exactly what `<input type="datetime-local">` produces.
  it('rejects a date-time with no offset', async () => {
    await expect(check('2026-03-22T14:00')).resolves.toBe(false);
    await expect(check('2026-03-22T14:00:00')).resolves.toBe(false);
    await expect(check('2026-03-22T14:00:00.000')).resolves.toBe(false);
  });

  it('rejects a non-string', async () => {
    await expect(check(42)).resolves.toBe(false);
  });
});
