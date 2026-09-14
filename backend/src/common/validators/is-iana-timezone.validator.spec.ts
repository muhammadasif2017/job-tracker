import { IsOptional, validate } from 'class-validator';
import { IsIanaTimezone } from './is-iana-timezone.validator.js';

class Subject {
  @IsOptional()
  @IsIanaTimezone()
  timezone?: string;
}

async function accepts(value: unknown): Promise<boolean> {
  const subject = new Subject();
  subject.timezone = value as string;
  return (await validate(subject)).length === 0;
}

describe('IsIanaTimezone', () => {
  it('accepts a canonical zone name', async () => {
    await expect(accepts('Asia/Karachi')).resolves.toBe(true);
    await expect(accepts('America/New_York')).resolves.toBe(true);
  });

  // Intl.supportedValuesOf('timeZone') lists one name per zone, and on Node
  // that is the legacy alias. Browsers report the modern name, so testing set
  // membership rejected these and blocked users in India and Ukraine from
  // saving the timezone their own browser told the app about.
  it('accepts the modern names Intl.supportedValuesOf omits', async () => {
    await expect(accepts('Asia/Kolkata')).resolves.toBe(true);
    await expect(accepts('Europe/Kyiv')).resolves.toBe(true);
    await expect(accepts('Australia/Canberra')).resolves.toBe(true);
  });

  it('accepts UTC, the column default', async () => {
    await expect(accepts('UTC')).resolves.toBe(true);
  });

  it('rejects a name Intl cannot resolve', async () => {
    await expect(accepts('Not/AZone')).resolves.toBe(false);
    await expect(accepts('')).resolves.toBe(false);
    await expect(accepts(42)).resolves.toBe(false);
  });
});
